import type { Response } from 'express';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import cloudinary from '../config/cloudinary.js';
import { getIO, isUserOnline } from '../socket.js';

const MAX_GROUP_PARTICIPANTS = 100;

const parseParam = (p: unknown): string => {
  if (Array.isArray(p)) return p[0] ? String(p[0]) : '';
  if (typeof p === 'string') return p;
  return '';
};

/**
 * Helper to emit system message into a conversation and broadcast to all members
 */
async function createAndBroadcastSystemMessage(
  conversationId: string,
  content: string,
  participantIds: string[]
) {
  try {
    const io = getIO();
    const convObjectId = new mongoose.Types.ObjectId(conversationId);
    const msgId = new ObjectId().toString();
    const now = new Date();

    const systemMsg = new Message({
      conversationId: convObjectId,
      type: 'system',
      clientMessageId: msgId,
      content,
      readBy: [],
      deliveredTo: [],
      deletedBy: [],
      createdAt: now,
    });
    await systemMsg.save();

    // Update conversation lastMessage and updatedAt
    await Conversation.updateOne(
      { _id: convObjectId },
      { $set: { lastMessage: systemMsg._id, updatedAt: now } }
    );

    const basePayload = {
      _id: msgId,
      conversationId,
      senderId: 'system',
      senderName: 'System',
      senderEmail: '',
      type: 'system',
      clientMessageId: msgId,
      content,
      readBy: [],
      deliveredTo: [],
      createdAt: now.toISOString(),
    };

    if (io) {
      // Broadcast to active conversation room
      io.to(`conversation:${conversationId}`).emit('new_message', {
        message: basePayload,
        envelope: null,
      });

      // Update snippet preview in chats list for each member
      for (const pid of participantIds) {
        io.to(`user:${pid}`).emit('conversation_updated', {
          conversationId,
          action: 'new_message',
          lastMessage: {
            _id: msgId,
            senderId: 'system',
            type: 'system',
            content,
            createdAt: now.toISOString(),
          },
        });
      }
    }
    return systemMsg;
  } catch (err) {
    console.error('[Group] Error creating system message:', err);
    return null;
  }
}

/**
 * Helper to build populated participant list
 */
async function getPopulatedParticipants(
  participantIds: (mongoose.Types.ObjectId | string)[],
  adminIds: (mongoose.Types.ObjectId | string)[] = []
) {
  if (!mongoose.connection.db) return [];
  const db = mongoose.connection.db;

  const adminIdStrings = new Set(adminIds.map((a) => a.toString()));
  const queryIds = participantIds.flatMap((id) => {
    const str = id.toString();
    return ObjectId.isValid(str) ? [str, new ObjectId(str)] : [str];
  });

  const docs = await db
    .collection('user')
    .find({ _id: { $in: queryIds as any } })
    .project({ _id: 1, name: 1, email: 1, image: 1, lastActiveAt: 1 })
    .toArray();

  return docs.map((doc) => {
    const idStr = doc._id.toString();
    return {
      _id: idStr,
      name: doc.name || doc.email?.split('@')[0] || 'Member',
      email: doc.email || '',
      image: doc.image || null,
      isAdmin: adminIdStrings.has(idStr),
      isOnline: isUserOnline(idStr, doc.lastActiveAt),
      lastActiveAt: doc.lastActiveAt ? new Date(doc.lastActiveAt).toISOString() : null,
    };
  });
}

/**
 * POST /api/groups
 * Create a new group conversation
 */
export const createGroup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const { name, description, groupAvatarUrl, groupAvatarPublicId, participantEmails, participantIds } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required', code: 'MISSING_NAME' });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 100) {
      return res.status(400).json({ error: 'Group name must not exceed 100 characters', code: 'NAME_TOO_LONG' });
    }

    const trimmedDesc = typeof description === 'string' ? description.trim() : '';
    if (trimmedDesc.length > 512) {
      return res.status(400).json({ error: 'Group description must not exceed 512 characters', code: 'DESC_TOO_LONG' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const callerIdStr = req.user.id;
    const callerObjectId = ObjectId.isValid(callerIdStr) ? new ObjectId(callerIdStr) : null;
    if (!callerObjectId) {
      return res.status(401).json({ error: 'Invalid user ID', code: 'INVALID_USER' });
    }

    const resolvedMemberIds = new Set<string>();
    resolvedMemberIds.add(callerIdStr);

    // Resolve by participantIds
    if (Array.isArray(participantIds)) {
      for (const id of participantIds) {
        if (typeof id === 'string' && ObjectId.isValid(id)) {
          resolvedMemberIds.add(id);
        }
      }
    }

    // Resolve by participantEmails
    if (Array.isArray(participantEmails) && participantEmails.length > 0) {
      const emailRegexes = participantEmails
        .filter((e) => typeof e === 'string' && e.trim().length > 0)
        .map((e) => new RegExp(`^${e.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));

      if (emailRegexes.length > 0) {
        const usersByEmail = await db
          .collection('user')
          .find({ email: { $in: emailRegexes } })
          .project({ _id: 1 })
          .toArray();

        for (const u of usersByEmail) {
          resolvedMemberIds.add(u._id.toString());
        }
      }
    }

    const finalParticipantObjectIds = Array.from(resolvedMemberIds).map((id) => new mongoose.Types.ObjectId(id));

    if (finalParticipantObjectIds.length > MAX_GROUP_PARTICIPANTS) {
      return res.status(400).json({
        error: `A group cannot have more than ${MAX_GROUP_PARTICIPANTS} participants`,
        code: 'PARTICIPANT_LIMIT_EXCEEDED',
      });
    }

    const newGroup = new Conversation({
      type: 'group',
      name: trimmedName,
      description: trimmedDesc,
      groupAvatarUrl: typeof groupAvatarUrl === 'string' ? groupAvatarUrl : undefined,
      groupAvatarPublicId: typeof groupAvatarPublicId === 'string' ? groupAvatarPublicId : undefined,
      participants: finalParticipantObjectIds,
      adminIds: [callerObjectId],
      initiatorId: callerObjectId,
      status: 'accepted',
      clearedBy: [],
    });

    await newGroup.save();

    const populatedMembers = await getPopulatedParticipants(newGroup.participants, newGroup.adminIds);
    const creatorName = req.user.name || req.user.email?.split('@')[0] || 'You';

    // Broadcast system message: "Alice created group 'Designers'"
    await createAndBroadcastSystemMessage(
      newGroup._id.toString(),
      `${creatorName} created group "${trimmedName}"`,
      Array.from(resolvedMemberIds)
    );

    const io = getIO();
    const groupPayload = {
      _id: newGroup._id.toString(),
      type: 'group',
      name: newGroup.name,
      description: newGroup.description,
      groupAvatarUrl: newGroup.groupAvatarUrl || null,
      groupAvatarPublicId: newGroup.groupAvatarPublicId || null,
      adminIds: (newGroup.adminIds || []).map((a) => a.toString()),
      initiatorId: callerIdStr,
      status: 'accepted',
      participants: populatedMembers,
      unreadCount: 0,
      createdAt: newGroup.createdAt,
      updatedAt: newGroup.updatedAt,
    };

    if (io) {
      // Emit group_created to all members so their chats list renders immediately
      for (const pid of resolvedMemberIds) {
        io.to(`user:${pid}`).emit('group_created', {
          conversation: groupPayload,
        });
      }
    }

    return res.status(201).json({
      success: true,
      conversation: groupPayload,
    });
  } catch (error: any) {
    console.error('Error creating group:', error);
    return res.status(500).json({
      error: error.message || 'Failed to create group',
      code: 'CREATE_GROUP_FAILED',
    });
  }
};

/**
 * GET /api/groups/:id
 * Fetch group details and populated participants
 */
export const getGroupDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const id = parseParam(req.params.id);
    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid group ID', code: 'INVALID_ID' });
    }

    const callerIdStr = req.user.id;
    const callerObjectId = new mongoose.Types.ObjectId(callerIdStr);

    const group = await Conversation.findOne({
      _id: new mongoose.Types.ObjectId(id),
      type: 'group',
      participants: callerObjectId,
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found or you are not a member', code: 'NOT_FOUND' });
    }

    const populatedMembers = await getPopulatedParticipants(group.participants, group.adminIds);
    const adminIds = (group.adminIds || []).map((a) => a.toString());

    // Resolve creator name
    let creatorName = 'Someone';
    if (group.initiatorId && mongoose.connection.db) {
      const creatorDoc = await mongoose.connection.db
        .collection('user')
        .findOne({ _id: new ObjectId(group.initiatorId.toString()) });
      if (creatorDoc) {
        creatorName = creatorDoc.name || creatorDoc.email?.split('@')[0] || 'Member';
      }
    }

    return res.status(200).json({
      success: true,
      group: {
        _id: group._id.toString(),
        type: 'group',
        name: group.name,
        description: group.description,
        groupAvatarUrl: group.groupAvatarUrl || null,
        groupAvatarPublicId: group.groupAvatarPublicId || null,
        adminIds,
        isAdmin: adminIds.includes(callerIdStr),
        initiatorId: group.initiatorId ? group.initiatorId.toString() : null,
        creatorName,
        participants: populatedMembers,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Error fetching group details:', error);
    return res.status(500).json({
      error: error.message || 'Failed to fetch group details',
      code: 'FETCH_FAILED',
    });
  }
};

/**
 * PUT /api/groups/:id
 * Update group metadata (subject, description, avatar) - Admin only
 */
export const updateGroupDetails = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const id = parseParam(req.params.id);
    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid group ID', code: 'INVALID_ID' });
    }

    const callerIdStr = req.user.id;
    const group = await Conversation.findOne({
      _id: new mongoose.Types.ObjectId(id),
      type: 'group',
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found', code: 'NOT_FOUND' });
    }

    const adminIds = (group.adminIds || []).map((a) => a.toString());
    if (!adminIds.includes(callerIdStr)) {
      return res.status(403).json({ error: 'Only group admins can modify group details', code: 'FORBIDDEN' });
    }

    const { name, description, groupAvatarUrl, groupAvatarPublicId } = req.body;
    const updates: any = {};
    const systemNoticeParts: string[] = [];
    const callerName = req.user.name || req.user.email?.split('@')[0] || 'An admin';

    if (typeof name === 'string' && name.trim().length > 0) {
      const trimmedName = name.trim();
      if (trimmedName.length > 100) {
        return res.status(400).json({ error: 'Group name must not exceed 100 characters', code: 'NAME_TOO_LONG' });
      }
      if (trimmedName !== group.name) {
        updates.name = trimmedName;
        systemNoticeParts.push(`${callerName} changed the group subject to "${trimmedName}"`);
      }
    }

    if (typeof description === 'string') {
      const trimmedDesc = description.trim();
      if (trimmedDesc.length > 512) {
        return res.status(400).json({ error: 'Group description must not exceed 512 characters', code: 'DESC_TOO_LONG' });
      }
      updates.description = trimmedDesc;
    }

    if (groupAvatarUrl !== undefined) {
      // If previous avatar existed and was replaced, destroy previous asset in Cloudinary
      if (
        group.groupAvatarPublicId &&
        groupAvatarPublicId &&
        group.groupAvatarPublicId !== groupAvatarPublicId
      ) {
        try {
          await cloudinary.uploader.destroy(group.groupAvatarPublicId);
        } catch (delErr) {
          console.warn('[Group] Failed to destroy old group avatar:', delErr);
        }
      }

      updates.groupAvatarUrl = groupAvatarUrl || null;
      updates.groupAvatarPublicId = groupAvatarPublicId || null;
      systemNoticeParts.push(`${callerName} changed this group's icon`);
    }

    updates.updatedAt = new Date();

    const updatedGroup = await Conversation.findByIdAndUpdate(
      group._id,
      { $set: updates },
      { new: true }
    );

    if (!updatedGroup) {
      return res.status(500).json({ error: 'Failed to update group', code: 'UPDATE_FAILED' });
    }

    const participantIdStrings = (updatedGroup.participants || []).map((p) => p.toString());

    // Broadcast system notices
    for (const notice of systemNoticeParts) {
      await createAndBroadcastSystemMessage(id, notice, participantIdStrings);
    }

    const io = getIO();
    if (io) {
      const updatePayload = {
        conversationId: id,
        name: updatedGroup.name,
        description: updatedGroup.description,
        groupAvatarUrl: updatedGroup.groupAvatarUrl || null,
      };

      io.to(`conversation:${id}`).emit('group_updated', updatePayload);
      for (const pid of participantIdStrings) {
        io.to(`user:${pid}`).emit('group_updated', updatePayload);
      }
    }

    return res.status(200).json({
      success: true,
      group: {
        _id: updatedGroup._id.toString(),
        name: updatedGroup.name,
        description: updatedGroup.description,
        groupAvatarUrl: updatedGroup.groupAvatarUrl || null,
        groupAvatarPublicId: updatedGroup.groupAvatarPublicId || null,
        adminIds: (updatedGroup.adminIds || []).map((a) => a.toString()),
        updatedAt: updatedGroup.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Error updating group:', error);
    return res.status(500).json({
      error: error.message || 'Failed to update group details',
      code: 'UPDATE_FAILED',
    });
  }
};

/**
 * POST /api/groups/:id/participants
 * Add member(s) to group - Admin only
 */
export const addParticipants = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const id = parseParam(req.params.id);
    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid group ID', code: 'INVALID_ID' });
    }

    const callerIdStr = req.user.id;
    const group = await Conversation.findOne({
      _id: new mongoose.Types.ObjectId(id),
      type: 'group',
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found', code: 'NOT_FOUND' });
    }

    const adminIds = (group.adminIds || []).map((a) => a.toString());
    if (!adminIds.includes(callerIdStr)) {
      return res.status(403).json({ error: 'Only group admins can add participants', code: 'FORBIDDEN' });
    }

    const { emails, userIds, email, userId } = req.body;
    const targetEmails: string[] = Array.isArray(emails) ? emails : email ? [email] : [];
    const targetUserIds: string[] = Array.isArray(userIds) ? userIds : userId ? [userId] : [];

    if (targetEmails.length === 0 && targetUserIds.length === 0) {
      return res.status(400).json({ error: 'Please provide user emails or user IDs to add', code: 'MISSING_USERS' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }
    const db = mongoose.connection.db;

    const existingParticipantIds = new Set(group.participants.map((p) => p.toString()));
    const newMemberObjectIds: mongoose.Types.ObjectId[] = [];
    const newMemberDocs: any[] = [];

    // Find users by ID
    for (const uid of targetUserIds) {
      if (typeof uid === 'string' && ObjectId.isValid(uid) && !existingParticipantIds.has(uid)) {
        const uDoc = await db.collection('user').findOne({ _id: new ObjectId(uid) });
        if (uDoc && !existingParticipantIds.has(uDoc._id.toString())) {
          existingParticipantIds.add(uDoc._id.toString());
          newMemberObjectIds.push(new mongoose.Types.ObjectId(uDoc._id.toString()));
          newMemberDocs.push(uDoc);
        }
      }
    }

    // Find users by Email
    for (const em of targetEmails) {
      if (typeof em === 'string' && em.trim().length > 0) {
        const uDoc = await db.collection('user').findOne({
          email: { $regex: new RegExp(`^${em.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        });
        if (uDoc && !existingParticipantIds.has(uDoc._id.toString())) {
          existingParticipantIds.add(uDoc._id.toString());
          newMemberObjectIds.push(new mongoose.Types.ObjectId(uDoc._id.toString()));
          newMemberDocs.push(uDoc);
        }
      }
    }

    if (newMemberObjectIds.length === 0) {
      return res.status(400).json({
        error: 'No valid new users to add (users may already be in the group or do not exist)',
        code: 'NO_NEW_USERS',
      });
    }

    if (group.participants.length + newMemberObjectIds.length > MAX_GROUP_PARTICIPANTS) {
      return res.status(400).json({
        error: `Cannot exceed maximum group limit of ${MAX_GROUP_PARTICIPANTS} participants`,
        code: 'PARTICIPANT_LIMIT_EXCEEDED',
      });
    }

    await Conversation.updateOne(
      { _id: group._id },
      {
        $addToSet: { participants: { $each: newMemberObjectIds } },
        $set: { updatedAt: new Date() },
      }
    );

    const updatedGroup = await Conversation.findById(group._id);
    const populatedMembers = await getPopulatedParticipants(
      updatedGroup?.participants || [],
      updatedGroup?.adminIds || []
    );
    const adminIdStrings = (updatedGroup?.adminIds || []).map((a) => a.toString());
    const allParticipantStrings = (updatedGroup?.participants || []).map((p) => p.toString());

    const callerName = req.user.name || req.user.email?.split('@')[0] || 'An admin';
    const addedNames = newMemberDocs.map((u) => u.name || u.email?.split('@')[0] || 'Member').join(', ');

    // Broadcast system notice: "Alice added Bob"
    await createAndBroadcastSystemMessage(
      id,
      `${callerName} added ${addedNames}`,
      allParticipantStrings
    );

    const io = getIO();
    if (io) {
      for (const newDoc of newMemberDocs) {
        const addedPayload = {
          conversationId: id,
          user: {
            _id: newDoc._id.toString(),
            name: newDoc.name,
            email: newDoc.email,
            image: newDoc.image || null,
          },
          addedBy: {
            _id: callerIdStr,
            name: callerName,
          },
          participants: populatedMembers,
          adminIds: adminIdStrings,
        };

        io.to(`conversation:${id}`).emit('group_member_added', addedPayload);
        io.to(`user:${newDoc._id.toString()}`).emit('group_member_added', addedPayload);
      }
    }

    return res.status(200).json({
      success: true,
      participants: populatedMembers,
      adminIds: adminIdStrings,
    });
  } catch (error: any) {
    console.error('Error adding group participants:', error);
    return res.status(500).json({
      error: error.message || 'Failed to add participants',
      code: 'ADD_PARTICIPANTS_FAILED',
    });
  }
};

/**
 * DELETE /api/groups/:id/participants/:userId
 * Remove a member from group - Admin only
 */
export const removeParticipant = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const id = parseParam(req.params.id);
    const userId = parseParam(req.params.userId);

    if (!id || !ObjectId.isValid(id) || !userId || !ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid group or user ID', code: 'INVALID_ID' });
    }

    const callerIdStr = req.user.id;
    if (callerIdStr === userId) {
      return res.status(400).json({
        error: 'Cannot remove yourself via this endpoint. Use leave endpoint instead.',
        code: 'CANNOT_REMOVE_SELF',
      });
    }

    const group = await Conversation.findOne({
      _id: new mongoose.Types.ObjectId(id),
      type: 'group',
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found', code: 'NOT_FOUND' });
    }

    const adminIds = (group.adminIds || []).map((a) => a.toString());
    if (!adminIds.includes(callerIdStr)) {
      return res.status(403).json({ error: 'Only group admins can remove members', code: 'FORBIDDEN' });
    }

    const targetObjectId = new mongoose.Types.ObjectId(userId);
    const isMember = group.participants.some((p) => p.toString() === userId);
    if (!isMember) {
      return res.status(400).json({ error: 'User is not a member of this group', code: 'NOT_A_MEMBER' });
    }

    // Fetch removed user details for system notice
    let removedUserName = 'Member';
    if (mongoose.connection.db) {
      const uDoc = await mongoose.connection.db.collection('user').findOne({ _id: new ObjectId(userId) });
      if (uDoc) {
        removedUserName = uDoc.name || uDoc.email?.split('@')[0] || 'Member';
      }
    }

    await Conversation.updateOne(
      { _id: group._id },
      {
        $pull: {
          participants: targetObjectId,
          adminIds: targetObjectId,
        },
        $set: { updatedAt: new Date() },
      }
    );

    const updatedGroup = await Conversation.findById(group._id);
    const populatedMembers = await getPopulatedParticipants(
      updatedGroup?.participants || [],
      updatedGroup?.adminIds || []
    );
    const remainingAdminIds = (updatedGroup?.adminIds || []).map((a) => a.toString());
    const remainingParticipantStrings = (updatedGroup?.participants || []).map((p) => p.toString());

    const callerName = req.user.name || req.user.email?.split('@')[0] || 'An admin';

    // Broadcast system notice: "Alice removed Bob"
    await createAndBroadcastSystemMessage(
      id,
      `${callerName} removed ${removedUserName}`,
      remainingParticipantStrings
    );

    const io = getIO();
    if (io) {
      const removedPayload = {
        conversationId: id,
        userId,
        removedBy: {
          _id: callerIdStr,
          name: callerName,
        },
        participants: populatedMembers,
        adminIds: remainingAdminIds,
      };

      io.to(`conversation:${id}`).emit('group_member_removed', removedPayload);
      io.to(`user:${userId}`).emit('group_member_removed', removedPayload);
    }

    return res.status(200).json({
      success: true,
      participants: populatedMembers,
      adminIds: remainingAdminIds,
    });
  } catch (error: any) {
    console.error('Error removing group participant:', error);
    return res.status(500).json({
      error: error.message || 'Failed to remove participant',
      code: 'REMOVE_PARTICIPANT_FAILED',
    });
  }
};

/**
 * PUT /api/groups/:id/admins/:userId
 * Promote or demote an admin - Admin only
 */
export const changeAdminRole = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const id = parseParam(req.params.id);
    const userId = parseParam(req.params.userId);
    const { action } = req.body;

    if (!id || !ObjectId.isValid(id) || !userId || !ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid group or user ID', code: 'INVALID_ID' });
    }

    if (action !== 'promote' && action !== 'demote') {
      return res.status(400).json({ error: "Action must be 'promote' or 'demote'", code: 'INVALID_ACTION' });
    }

    const callerIdStr = req.user.id;
    const group = await Conversation.findOne({
      _id: new mongoose.Types.ObjectId(id),
      type: 'group',
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found', code: 'NOT_FOUND' });
    }

    const adminIds = (group.adminIds || []).map((a) => a.toString());
    if (!adminIds.includes(callerIdStr)) {
      return res.status(403).json({ error: 'Only group admins can manage admin roles', code: 'FORBIDDEN' });
    }

    const isMember = group.participants.some((p) => p.toString() === userId);
    if (!isMember) {
      return res.status(400).json({ error: 'User is not a member of this group', code: 'NOT_A_MEMBER' });
    }

    const targetObjectId = new mongoose.Types.ObjectId(userId);

    if (action === 'promote') {
      await Conversation.updateOne(
        { _id: group._id },
        {
          $addToSet: { adminIds: targetObjectId },
          $set: { updatedAt: new Date() },
        }
      );
    } else {
      // Demote
      if (adminIds.length <= 1 && adminIds.includes(userId)) {
        return res.status(400).json({
          error: 'Cannot demote the sole admin of the group',
          code: 'SOLE_ADMIN',
        });
      }

      await Conversation.updateOne(
        { _id: group._id },
        {
          $pull: { adminIds: targetObjectId },
          $set: { updatedAt: new Date() },
        }
      );
    }

    const updatedGroup = await Conversation.findById(group._id);
    const newAdminIds = (updatedGroup?.adminIds || []).map((a) => a.toString());
    const participantStrings = (updatedGroup?.participants || []).map((p) => p.toString());

    // Resolve target user name
    let targetUserName = 'Member';
    if (mongoose.connection.db) {
      const uDoc = await mongoose.connection.db.collection('user').findOne({ _id: new ObjectId(userId) });
      if (uDoc) {
        targetUserName = uDoc.name || uDoc.email?.split('@')[0] || 'Member';
      }
    }

    const callerName = req.user.name || req.user.email?.split('@')[0] || 'An admin';
    const notice =
      action === 'promote'
        ? `${callerName} made ${targetUserName} a group admin`
        : `${callerName} dismissed ${targetUserName} as admin`;

    await createAndBroadcastSystemMessage(id, notice, participantStrings);

    const io = getIO();
    if (io) {
      const payload = {
        conversationId: id,
        userId,
        action: action === 'promote' ? 'promoted' : 'demoted',
        adminIds: newAdminIds,
      };

      io.to(`conversation:${id}`).emit('group_admin_changed', payload);
      for (const pid of participantStrings) {
        io.to(`user:${pid}`).emit('group_admin_changed', payload);
      }
    }

    return res.status(200).json({
      success: true,
      adminIds: newAdminIds,
    });
  } catch (error: any) {
    console.error('Error changing admin role:', error);
    return res.status(500).json({
      error: error.message || 'Failed to change admin role',
      code: 'CHANGE_ADMIN_FAILED',
    });
  }
};

/**
 * POST /api/groups/:id/leave
 * Member leaves the group. If last admin leaves, oldest remaining member becomes admin.
 */
export const leaveGroup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const id = parseParam(req.params.id);
    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid group ID', code: 'INVALID_ID' });
    }

    const callerIdStr = req.user.id;
    const callerObjectId = new mongoose.Types.ObjectId(callerIdStr);

    const group = await Conversation.findOne({
      _id: new mongoose.Types.ObjectId(id),
      type: 'group',
      participants: callerObjectId,
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found or you are not a member', code: 'NOT_FOUND' });
    }

    // Remove caller from participants and adminIds
    const remainingParticipants = group.participants.filter((p) => p.toString() !== callerIdStr);
    const remainingAdmins = (group.adminIds || []).filter((a) => a.toString() !== callerIdStr);

    let newAdminPromotedId: string | null = null;

    if (remainingParticipants.length === 0) {
      // Group is empty; delete conversation
      await Conversation.deleteOne({ _id: group._id });
      await Message.deleteMany({ conversationId: group._id });

      const io = getIO();
      if (io) {
        io.to(`conversation:${id}`).emit('group_member_left', {
          conversationId: id,
          userId: callerIdStr,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Left and deleted empty group',
      });
    }

    // If no admins left among remaining members, promote the first remaining member
    if (remainingAdmins.length === 0 && remainingParticipants.length > 0) {
      const nextAdminObjId = remainingParticipants[0];
      if (nextAdminObjId) {
        remainingAdmins.push(nextAdminObjId);
        newAdminPromotedId = nextAdminObjId.toString();
      }
    }

    await Conversation.updateOne(
      { _id: group._id },
      {
        $set: {
          participants: remainingParticipants,
          adminIds: remainingAdmins,
          updatedAt: new Date(),
        },
      }
    );

    const callerName = req.user.name || req.user.email?.split('@')[0] || 'Someone';
    const remainingIdStrings = remainingParticipants.map((p) => p.toString());

    // Broadcast system notice: "Alice left"
    await createAndBroadcastSystemMessage(
      id,
      `${callerName} left`,
      remainingIdStrings
    );

    if (newAdminPromotedId && mongoose.connection.db) {
      const newAdminDoc = await mongoose.connection.db
        .collection('user')
        .findOne({ _id: new ObjectId(newAdminPromotedId) });
      const newAdminName = newAdminDoc?.name || newAdminDoc?.email?.split('@')[0] || 'A member';
      await createAndBroadcastSystemMessage(
        id,
        `${newAdminName} is now an admin`,
        remainingIdStrings
      );
    }

    const io = getIO();
    if (io) {
      const leavePayload = {
        conversationId: id,
        userId: callerIdStr,
        newAdminId: newAdminPromotedId || undefined,
      };

      io.to(`conversation:${id}`).emit('group_member_left', leavePayload);
      for (const pid of remainingIdStrings) {
        io.to(`user:${pid}`).emit('group_member_left', leavePayload);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Left group successfully',
      newAdminId: newAdminPromotedId || undefined,
    });
  } catch (error: any) {
    console.error('Error leaving group:', error);
    return res.status(500).json({
      error: error.message || 'Failed to leave group',
      code: 'LEAVE_GROUP_FAILED',
    });
  }
};
