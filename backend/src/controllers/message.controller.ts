import type { Response } from 'express';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { isUserOnline, getIO } from '../socket.js';
import Message from '../models/Message.js';
import MessageKey from '../models/MessageKey.js';
import Device from '../models/Device.js';
import Conversation from '../models/Conversation.js';
import cloudinary from '../config/cloudinary.js';

/**
 * POST /api/messages/conversations
 * Create or find an existing direct conversation with a user by email.
 * Body: { email: string }
 */
export const createOrFindConversation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Recipient email is required', code: 'MISSING_EMAIL' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;

    // Don't allow chatting with yourself
    if (email.toLowerCase() === req.user.email?.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot create a conversation with yourself', code: 'SELF_CHAT' });
    }

    // Find the recipient user
    const recipient = await db.collection('user').findOne({
      email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });

    if (!recipient) {
      return res.status(404).json({ error: 'User not found with that email', code: 'USER_NOT_FOUND' });
    }

    const currentUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Invalid user ID', code: 'INVALID_USER' });
    }
    const recipientId = recipient._id as ObjectId;

    // Check if a direct conversation already exists between these two users
    const existingConversation = await db.collection('conversations').findOne({
      type: 'direct',
      participants: { $all: [currentUserId, recipientId], $size: 2 },
    });

    if (existingConversation) {
      // Return existing conversation with populated participant info
      const participantDocs = await db.collection('user')
        .find({ _id: { $in: existingConversation.participants } })
        .project({ _id: 1, name: 1, email: 1, image: 1 })
        .toArray();

      return res.status(200).json({
        success: true,
        conversation: {
          _id: existingConversation._id.toString(),
          type: existingConversation.type,
          status: existingConversation.status || 'accepted',
          initiatorId: existingConversation.initiatorId ? existingConversation.initiatorId.toString() : null,
          participants: participantDocs.map(p => ({
            _id: p._id.toString(),
            name: p.name,
            email: p.email,
            image: p.image || null,
          })),
          lastMessage: existingConversation.lastMessage?.toString() || null,
          createdAt: existingConversation.createdAt,
          updatedAt: existingConversation.updatedAt,
        },
        isNew: false,
      });
    }

    // Create a new direct conversation
    const now = new Date();
    const conversationDoc = {
      type: 'direct',
      participants: [currentUserId, recipientId],
      status: 'pending',
      initiatorId: currentUserId,
      clearedBy: [],
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection('conversations').insertOne(conversationDoc);

    const participantDocs = await db.collection('user')
      .find({ _id: { $in: [currentUserId, recipientId] } })
      .project({ _id: 1, name: 1, email: 1, image: 1 })
      .toArray();

    return res.status(201).json({
      success: true,
      conversation: {
        _id: result.insertedId.toString(),
        type: 'direct',
        status: 'pending',
        initiatorId: currentUserId.toString(),
        participants: participantDocs.map(p => ({
          _id: p._id.toString(),
          name: p.name,
          email: p.email,
          image: p.image || null,
        })),
        lastMessage: null,
        createdAt: now,
        updatedAt: now,
      },
      isNew: true,
    });
  } catch (error: any) {
    console.error('Error creating/finding conversation:', error);
    return res.status(500).json({
      error: error.message || 'Failed to create conversation',
      code: 'CREATE_FAILED',
    });
  }
};

/**
 * GET /api/messages/conversations
 * List all conversations for the authenticated user, sorted by most recent activity.
 */
export const getConversations = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const currentUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Invalid user ID', code: 'INVALID_USER' });
    }

    // Find all conversations where the user is a participant
    const conversations = await db.collection('conversations')
      .find({ participants: { $in: [currentUserId, req.user.id] } })
      .sort({ updatedAt: -1 })
      .toArray();

    // Collect all participant IDs and last message IDs
    const allParticipantIds = new Set<string>();
    const lastMessageIds: ObjectId[] = [];

    for (const conv of conversations) {
      for (const pid of conv.participants) {
        allParticipantIds.add(pid.toString());
      }
      if (conv.lastMessage) {
        lastMessageIds.push(conv.lastMessage);
      }
    }

    // Batch-fetch participant details with lastActiveAt
    const userQueryIds = Array.from(allParticipantIds).flatMap(id =>
      ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id]
    );
    const participantDocs = await db.collection('user')
      .find({ _id: { $in: userQueryIds as any } })
      .project({ _id: 1, name: 1, email: 1, image: 1, lastActiveAt: 1 })
      .toArray();

    const participantMap = new Map(participantDocs.map(p => [p._id.toString(), p]));

    // Batch-fetch last messages
    const lastMessages = lastMessageIds.length > 0
      ? await db.collection('messages')
        .find({ _id: { $in: lastMessageIds } })
        .toArray()
      : [];

    const lastMessageMap = new Map(lastMessages.map(m => [m._id.toString(), m]));

    // Count unread messages per conversation using a single aggregation pipeline instead of N+1 countDocuments calls
    const userObjId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    const unreadFilterUserIds = [userObjId, req.user.id].filter(Boolean);
    const unreadMap = new Map<string, number>();

    if (conversations.length > 0) {
      const conversationMatchIds = conversations.flatMap((conv) => [
        conv._id,
        conv._id.toString(),
      ]);

      const unreadPipeline = [
        {
          $match: {
            conversationId: { $in: conversationMatchIds },
            senderId: { $nin: unreadFilterUserIds as any },
            readBy: { $nin: unreadFilterUserIds as any },
            deletedBy: { $nin: unreadFilterUserIds as any },
          },
        },
        {
          $group: {
            _id: { $toString: '$conversationId' },
            count: { $sum: 1 },
          },
        },
      ];

      const unreadResults = await db.collection('messages').aggregate(unreadPipeline).toArray();
      for (const r of unreadResults) {
        if (r._id) {
          unreadMap.set(r._id.toString(), r.count);
        }
      }
    }


    const result = conversations.map(conv => {
      const participants = conv.participants.map((pid: ObjectId) => {
        const p = participantMap.get(pid.toString());
        const online = p ? isUserOnline(p._id.toString(), p.lastActiveAt) : false;
        return p
          ? {
              _id: p._id.toString(),
              name: p.name,
              email: p.email,
              image: p.image || null,
              isOnline: online,
              lastActiveAt: p.lastActiveAt ? new Date(p.lastActiveAt).toISOString() : null,
            }
          : { _id: pid.toString(), name: 'Unknown', email: '', image: null, isOnline: false, lastActiveAt: null };
      });

      const rawLastMsg = conv.lastMessage ? lastMessageMap.get(conv.lastMessage.toString()) : null;
      const isDeletedByMe = rawLastMsg?.deletedBy?.some((id: any) =>
        id?.toString() === currentUserId.toString() || (req.user?.id && id?.toString() === req.user.id)
      );
      const lastMsg = isDeletedByMe ? null : rawLastMsg;

      return {
        _id: conv._id.toString(),
        type: conv.type,
        name: conv.name || null,
        description: conv.description || null,
        adminIds: (conv.adminIds || []).map((a: any) => a.toString()),
        groupAvatarUrl: conv.groupAvatarUrl || null,
        groupAvatarPublicId: conv.groupAvatarPublicId || null,
        status: conv.status || 'accepted',
        initiatorId: conv.initiatorId ? conv.initiatorId.toString() : null,
        participants,
        lastMessage: lastMsg
          ? {
            _id: lastMsg._id.toString(),
            senderId: lastMsg.senderId.toString(),
            type: lastMsg.type,
            content: lastMsg.content,
            createdAt: lastMsg.createdAt,
          }
          : null,
        unreadCount: unreadMap.get(conv._id.toString()) || 0,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      };
    });

    return res.status(200).json({
      success: true,
      currentUserId: req.user.id,
      currentUserEmail: req.user.email,
      conversations: result,
    });
  } catch (error: any) {
    console.error('Error fetching conversations:', error);
    return res.status(500).json({
      error: error.message || 'Failed to fetch conversations',
      code: 'FETCH_FAILED',
    });
  }
};

/**
 * GET /api/messages/conversations/:id
 * Get details for a single conversation.
 */
export const getConversation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const idParam = req.params.id;
    const conversationId = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!conversationId || !ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID', code: 'INVALID_ID' });
    }

    const currentUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Invalid user ID', code: 'INVALID_USER' });
    }

    const conversation = await db.collection('conversations').findOne({
      _id: new ObjectId(conversationId),
      participants: { $in: [currentUserId, req.user.id] },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    }

    const participantDocs = await db.collection('user')
      .find({ _id: { $in: conversation.participants } })
      .project({ _id: 1, name: 1, email: 1, image: 1, lastActiveAt: 1, blockedUsers: 1 })
      .toArray();

    const currentUserDoc = participantDocs.find(p => p._id.toString() === currentUserId.toString()) ||
      await db.collection('user').findOne({ _id: currentUserId });
    const otherParticipantDoc = participantDocs.find(p => p._id.toString() !== currentUserId.toString());

    const myBlocked = (currentUserDoc?.blockedUsers || []).map((b: any) => b.toString());
    const otherBlocked = (otherParticipantDoc?.blockedUsers || []).map((b: any) => b.toString());

    const isBlocked = otherParticipantDoc ? myBlocked.includes(otherParticipantDoc._id.toString()) : false;
    const isBlockedBy = otherParticipantDoc ? otherBlocked.includes(currentUserId.toString()) : false;

    return res.status(200).json({
      success: true,
      currentUserId: req.user.id,
      currentUserEmail: req.user.email,
      conversation: {
        _id: conversation._id.toString(),
        type: conversation.type,
        name: conversation.name || null,
        description: conversation.description || null,
        adminIds: (conversation.adminIds || []).map((a: any) => a.toString()),
        groupAvatarUrl: conversation.groupAvatarUrl || null,
        groupAvatarPublicId: conversation.groupAvatarPublicId || null,
        status: conversation.status || 'accepted',
        initiatorId: conversation.initiatorId ? conversation.initiatorId.toString() : null,
        isBlocked,
        isBlockedBy,
        participants: participantDocs.map(p => ({
          _id: p._id.toString(),
          name: p.name,
          email: p.email,
          image: p.image || null,
          isOnline: isUserOnline(p._id.toString(), p.lastActiveAt),
          lastActiveAt: p.lastActiveAt ? new Date(p.lastActiveAt).toISOString() : null,
        })),
        lastMessage: conversation.lastMessage?.toString() || null,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
    });
  } catch (error: any) {
    console.error('Error fetching conversation:', error);
    return res.status(500).json({
      error: error.message || 'Failed to fetch conversation',
      code: 'FETCH_FAILED',
    });
  }
};

/**
 * GET /api/messages/conversations/:id/messages
 * Get paginated messages for a conversation.
 * Query params: page (default 1), limit (default 50)
 */
export const getMessages = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const idParam = req.params.id;
    const conversationId = Array.isArray(idParam) ? idParam[0] : idParam;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));

    if (!conversationId || !ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID', code: 'INVALID_ID' });
    }

    const currentUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Invalid user ID', code: 'INVALID_USER' });
    }

    const convObjectId = new ObjectId(conversationId);

    // Verify user is a participant
    const conversation = await db.collection('conversations').findOne({
      _id: convObjectId,
      participants: { $in: [currentUserId, req.user.id] },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    }

    const userQueryIds = [currentUserId, req.user.id].filter(Boolean);
    const convQuery = { $in: [convObjectId, conversationId] as any };

    const totalMessages = await db.collection('messages').countDocuments({
      conversationId: convQuery,
      deletedBy: { $nin: userQueryIds },
    });

    // Fetch messages newest-first, then reverse for chronological display
    const messages = await db.collection('messages')
      .find({
        conversationId: convQuery,
        deletedBy: { $nin: userQueryIds },
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    // Batch-fetch sender details
    const senderIds = [...new Set(messages.map(m => m.senderId.toString()))];
    const senderQueryIds = senderIds.flatMap(id => ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id]);
    const senderDocs = await db.collection('user')
      .find({ _id: { $in: senderQueryIds as any } })
      .project({ _id: 1, name: 1, email: 1, image: 1 })
      .toArray();
    const senderMap = new Map(senderDocs.map(s => [s._id.toString(), s]));

    // Batch-fetch caller device's envelopes from messagekeys
    const callerDeviceId = (req.headers['x-device-id'] as string) || (req.query.deviceId as string) || null;
    const keyMap = new Map<string, { nonce: string; wrappedKey: string }>();

    if (messages.length > 0) {
      const msgObjectIds = messages.map(m => m._id);
      const callerUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : req.user.id;

      // Fetch envelopes strictly targeted to caller's device
      if (callerDeviceId) {
        const messageKeys = await db.collection('messagekeys')
          .find({
            messageId: { $in: msgObjectIds },
            recipientDeviceId: callerDeviceId,
          })
          .toArray();
        for (const k of messageKeys) {
          keyMap.set(k.messageId.toString(), {
            nonce: k.nonce,
            wrappedKey: k.wrappedKey,
          });
        }
      }
    }

    const formattedMessages = messages.reverse().map(m => {
      const sender = senderMap.get(m.senderId.toString());
      const envelope = keyMap.get(m._id.toString()) || null;
      return {
        _id: m._id.toString(),
        conversationId: m.conversationId.toString(),
        senderId: m.senderId.toString(),
        senderName: sender?.name || 'Unknown',
        senderEmail: sender?.email || '',
        senderImage: sender?.image || null,
        type: m.type,
        clientMessageId: m.clientMessageId || null,
        content: m.type === 'system' || !m.encrypted ? m.content : '',
        encrypted: m.encrypted || null,
        envelope,
        fileUrl: m.fileUrl || null,
        readBy: m.readBy?.map((id: ObjectId) => id.toString()) || [],
        deliveredTo: m.deliveredTo?.map((id: ObjectId) => id.toString()) || [],
        reactions: (m.reactions || []).map((r: any) => ({
          userId: r.userId?.toString() || '',
          userName: r.userName || '',
          emoji: r.emoji,
          createdAt: r.createdAt,
        })),
        createdAt: m.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      currentUserId: req.user.id,
      currentUserEmail: req.user.email,
      messages: formattedMessages,
      pagination: {
        page,
        limit,
        total: totalMessages,
        totalPages: Math.ceil(totalMessages / limit),
        hasMore: page * limit < totalMessages,
      },
    });
  } catch (error: any) {
    console.error('Error fetching messages:', error);
    return res.status(500).json({
      error: error.message || 'Failed to fetch messages',
      code: 'FETCH_FAILED',
    });
  }
};

/**
 * POST /api/messages/conversations/:id/clear
 * Clear all conversation history (text, voice, media) for the current user.
 */
export const clearConversation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const idParam = req.params.id;
    const conversationId = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!conversationId || !ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID', code: 'INVALID_ID' });
    }

    const convObjId = new ObjectId(conversationId);
    const currentUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Invalid user ID', code: 'INVALID_USER' });
    }

    // Verify user is participant
    const conversation = await db.collection('conversations').findOne({
      _id: convObjId,
      participants: { $in: [currentUserId, req.user.id] },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    }

    const now = new Date();

    const userQueryIds = [currentUserId, req.user.id].filter(Boolean);

    // Mark all existing messages as deleted by this user (both query formats for safety)
    await db.collection('messages').updateMany(
      { conversationId: { $in: [convObjId, conversationId] as any } },
      { $addToSet: { deletedBy: { $each: userQueryIds } } }
    );

    // Record in conversation.clearedBy
    await db.collection('conversations').updateOne(
      { _id: convObjId },
      {
        $push: {
          clearedBy: {
            userId: currentUserId,
            clearedAt: now,
          },
        } as any,
        $set: {
          updatedAt: now,
        },
      }
    );

    // Notify ONLY the clearing user so other participants' message history is unaffected
    try {
      const ioInstance = getIO();
      ioInstance.to(`user:${req.user.id}`).emit('conversation_cleared', {
        conversationId,
        clearedBy: req.user.id,
      });
    } catch {}

    return res.status(200).json({
      success: true,
      message: 'Conversation cleared successfully',
      conversationId,
    });
  } catch (error: any) {
    console.error('Error clearing conversation:', error);
    return res.status(500).json({
      error: error.message || 'Failed to clear conversation',
      code: 'CLEAR_FAILED',
    });
  }
};

/**
 * GET /api/messages/conversations/:id/media
 * Retrieve media attachments (images, audio, files) for a conversation.
 */
export const getConversationMedia = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const idParam = req.params.id;
    const conversationId = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!conversationId || !ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID', code: 'INVALID_ID' });
    }

    const convObjId = new ObjectId(conversationId);
    const currentUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Invalid user ID', code: 'INVALID_USER' });
    }

    // Verify participant
    const conversation = await db.collection('conversations').findOne({
      _id: convObjId,
      participants: { $in: [currentUserId, req.user.id] },
    });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    }

    // Query messages that represent media (images, audio, or having fileUrl)
    const mediaMessages = await db.collection('messages')
      .find({
        conversationId: { $in: [convObjId, conversationId] as any },
        deletedBy: { $nin: [currentUserId] },
        $or: [
          { type: { $in: ['image', 'audio'] } },
          { fileUrl: { $exists: true, $nin: [null, ''] } },
          { content: { $regex: /\.(jpg|jpeg|png|webp|gif|mp3|m4a|wav|aac)(\?.*)?$/i } },
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Map sender info
    const senderIds = [...new Set(mediaMessages.map(m => m.senderId.toString()))];
    const senderQueryIds = senderIds.flatMap(id => ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id]);
    const senderDocs = await db.collection('user')
      .find({ _id: { $in: senderQueryIds as any } })
      .project({ _id: 1, name: 1, email: 1, image: 1 })
      .toArray();
    const senderMap = new Map(senderDocs.map(s => [s._id.toString(), s]));

    const formattedMedia = mediaMessages.map(m => {
      const sender = senderMap.get(m.senderId.toString());
      return {
        _id: m._id.toString(),
        conversationId: m.conversationId.toString(),
        senderId: m.senderId.toString(),
        senderName: sender?.name || 'Unknown',
        type: m.type,
        content: m.content,
        fileUrl: m.fileUrl || m.content,
        createdAt: m.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      media: formattedMedia,
    });
  } catch (error: any) {
    console.error('Error fetching conversation media:', error);
    return res.status(500).json({
      error: error.message || 'Failed to fetch conversation media',
      code: 'MEDIA_FAILED',
    });
  }
};

export function extractCloudinaryPublicId(url: string): { publicId: string; resourceType: 'image' | 'video' | 'raw' } | null {
  try {
    const isVideo = /\.(mp4|mov|webm|m4v|3gp|mkv)($|\?)/i.test(url) || url.includes('/video/upload/');
    const isRaw = url.includes('/raw/upload/');
    const resourceType: 'image' | 'video' | 'raw' = isVideo ? 'video' : isRaw ? 'raw' : 'image';

    const uploadIndex = url.indexOf('/upload/');
    if (uploadIndex !== -1) {
      let afterUpload = url.substring(uploadIndex + 8);
      // Strip any transformation parameter segments (e.g. f_mp3/ or c_scale,w_500/) and version prefix v\d+/
      afterUpload = afterUpload.replace(/^(?:[a-zA-Z0-9_,-]+\/)*v\d+\//, '');
      afterUpload = afterUpload.replace(/^(?:[a-zA-Z0-9_,-]+\/)?(?=chatuk\/)/, '');
      const qIdx = afterUpload.indexOf('?');
      if (qIdx !== -1) afterUpload = afterUpload.substring(0, qIdx);
      if (!isRaw) {
        afterUpload = afterUpload.replace(/\.[a-zA-Z0-9]+$/, '');
      }
      return { publicId: afterUpload, resourceType };
    }
  } catch (e) {
    console.warn('Failed to extract Cloudinary public_id:', e);
  }
  return null;
}

/**
 * DELETE /api/messages/:id
 * Delete a specific message. If deleted by sender, removes permanently from DB and destroys Cloudinary media.
 */
export const deleteMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const idParam = req.params.id;
    const messageId = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!messageId) {
      return res.status(400).json({ error: 'Message ID is required', code: 'MISSING_ID' });
    }

    const currentUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Invalid user ID', code: 'INVALID_USER' });
    }

    const userQueryIds = [currentUserId, req.user.id].filter(Boolean);

    const isMongoId = ObjectId.isValid(messageId);
    const query = isMongoId
      ? { $or: [{ _id: new ObjectId(messageId) }, { clientMessageId: messageId }] }
      : { clientMessageId: messageId };

    const message = await db.collection('messages').findOne(query);
    if (!message) {
      return res.status(404).json({ error: 'Message not found', code: 'NOT_FOUND' });
    }

    const msgObjId = message._id;
    const isSender =
      (message.senderId && currentUserId && message.senderId.toString() === currentUserId.toString()) ||
      message.senderId?.toString() === req.user.id;

    if (isSender) {
      // If message contains media uploaded to Cloudinary, destroy it immediately
      if (message.fileUrl) {
        const cInfo = extractCloudinaryPublicId(message.fileUrl);
        if (cInfo) {
          try {
            await cloudinary.uploader.destroy(cInfo.publicId, {
              resource_type: cInfo.resourceType,
              invalidate: true,
            });
            console.log(`[Cloudinary] Successfully deleted ${cInfo.resourceType} asset: ${cInfo.publicId}`);
          } catch (cErr) {
            console.warn('[Cloudinary] Failed to delete media asset:', cErr);
          }
        }
      }

      // Permanently remove the message from the collection
      await db.collection('messages').deleteOne({ _id: msgObjId });
      // Clean up message keys as well
      await db.collection('messagekeys').deleteMany({ messageId: msgObjId });
    } else {
      // If not sender, soft-delete only for this user
      await db.collection('messages').updateOne(
        { _id: msgObjId },
        { $addToSet: { deletedBy: { $each: userQueryIds } } }
      );
    }

    // Recompute latest message for the conversation
    const convId = message.conversationId;
    const convObjId = typeof convId === 'string' && ObjectId.isValid(convId) ? new ObjectId(convId) : convId;

    const remainingMessages = await db.collection('messages')
      .find({
        conversationId: { $in: [convId, convId.toString()] },
        deletedBy: { $nin: userQueryIds as any },
      })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    const newLastMsg = remainingMessages.length > 0 ? remainingMessages[0] : null;
    await db.collection('conversations').updateOne(
      { _id: convObjId },
      { $set: { lastMessage: newLastMsg ? newLastMsg._id : null, updatedAt: newLastMsg ? newLastMsg.createdAt : new Date() } }
    );

    try {
      const ioInstance = getIO();
      // Notify conversation room
      ioInstance.to(`conversation:${message.conversationId.toString()}`).emit('message_deleted', {
        messageId: msgObjId.toString(),
        clientMessageId: message.clientMessageId,
        conversationId: message.conversationId.toString(),
        deletedBy: req.user.id,
      });

      // Notify all participants' personal user rooms to purge local cache and update their chat list preview
      const conversation = await db.collection('conversations').findOne({ _id: convObjId });
      if (conversation?.participants) {
        for (const pid of conversation.participants) {
          ioInstance.to(`user:${pid.toString()}`).emit('message_deleted', {
            messageId: msgObjId.toString(),
            clientMessageId: message.clientMessageId,
            conversationId: message.conversationId.toString(),
            deletedBy: req.user.id,
          });
          ioInstance.to(`user:${pid.toString()}`).emit('conversation_updated', {
            conversationId: message.conversationId.toString(),
            action: 'message_deleted',
            lastMessage: newLastMsg
              ? {
                  _id: newLastMsg._id.toString(),
                  senderId: newLastMsg.senderId.toString(),
                  type: newLastMsg.type,
                  content: newLastMsg.content || (newLastMsg.type === 'image' ? '📷 Photo' : newLastMsg.type === 'video' ? '🎥 Video' : newLastMsg.type === 'audio' ? '🎤 Voice message' : ''),
                  createdAt: newLastMsg.createdAt instanceof Date ? newLastMsg.createdAt.toISOString() : new Date(newLastMsg.createdAt).toISOString(),
                }
              : null,
          });
        }
      }
    } catch (socketErr) {
      console.warn('[Socket] Realtime broadcast warning on delete:', socketErr);
    }

    return res.status(200).json({
      success: true,
      message: 'Message deleted successfully',
      messageId: msgObjId.toString(),
      clientMessageId: message.clientMessageId,
    });
  } catch (error: any) {
    console.error('Error deleting message:', error);
    return res.status(500).json({
      error: error.message || 'Failed to delete message',
      code: 'DELETE_FAILED',
    });
  }
};

/**
 * POST /api/messages/:id/reaction
 * Add or toggle an emoji reaction on a message (REST endpoint).
 */
export const toggleReaction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const { emoji, conversationId, action = 'toggle' } = req.body;
    const idParam = req.params.id;
    const messageId = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!messageId || !emoji) {
      return res.status(400).json({ error: 'Valid message ID and emoji are required', code: 'INVALID_INPUT' });
    }

    const db = mongoose.connection.db;
    const isMongoId = ObjectId.isValid(messageId);
    const query = isMongoId
      ? { $or: [{ _id: new ObjectId(messageId) }, { clientMessageId: messageId }] }
      : { clientMessageId: messageId };

    const message = await db.collection('messages').findOne(query);
    if (!message) {
      return res.status(404).json({ error: 'Message not found', code: 'NOT_FOUND' });
    }

    const currentUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    const currentReactions: any[] = message.reactions || [];
    const existingIndex = currentReactions.findIndex(
      r => r.userId?.toString() === req.user?.id
    );

    let updatedReactions = [...currentReactions];

    if (action === 'remove') {
      if (existingIndex !== -1) {
        updatedReactions.splice(existingIndex, 1);
      }
    } else if (action === 'add') {
      if (existingIndex !== -1) {
        updatedReactions[existingIndex] = {
          userId: currentUserId,
          userName: req.user.name || '',
          emoji,
          createdAt: new Date(),
        };
      } else {
        updatedReactions.push({
          userId: currentUserId,
          userName: req.user.name || '',
          emoji,
          createdAt: new Date(),
        });
      }
    } else {
      // toggle
      if (existingIndex !== -1) {
        if (updatedReactions[existingIndex].emoji === emoji) {
          // Toggle off
          updatedReactions.splice(existingIndex, 1);
        } else {
          // Switch emoji
          updatedReactions[existingIndex] = {
            userId: currentUserId,
            userName: req.user.name || '',
            emoji,
            createdAt: new Date(),
          };
        }
      } else {
        // Add reaction
        updatedReactions.push({
          userId: currentUserId,
          userName: req.user.name || '',
          emoji,
          createdAt: new Date(),
        });
      }
    }

    await db.collection('messages').updateOne(
      { _id: message._id },
      { $set: { reactions: updatedReactions, updatedAt: new Date() } }
    );

    const convId = conversationId || message.conversationId.toString();

    try {
      const ioInstance = getIO();
      const payload = {
        conversationId: convId,
        messageId: message._id.toString(),
        clientMessageId: message.clientMessageId || messageId,
        reactions: updatedReactions.map(r => ({
          userId: r.userId?.toString(),
          userName: r.userName,
          emoji: r.emoji,
          createdAt: r.createdAt,
        })),
      };

      ioInstance.to(`conversation:${convId}`).emit('message_reaction_updated', payload);
      const conv = await db.collection('conversations').findOne({ _id: new ObjectId(convId) });
      if (conv?.participants) {
        for (const pid of conv.participants) {
          ioInstance.to(`user:${pid.toString()}`).emit('message_reaction_updated', payload);
        }
      }
    } catch {}

    return res.status(200).json({
      success: true,
      reactions: updatedReactions.map(r => ({
        userId: r.userId?.toString(),
        userName: r.userName,
        emoji: r.emoji,
        createdAt: r.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('Error toggling reaction:', error);
    return res.status(500).json({
      error: error.message || 'Failed to toggle reaction',
      code: 'REACTION_FAILED',
    });
  }
};

/**
 * POST /api/messages/conversations/:id/messages
 * Send an end-to-end encrypted message with wrapped envelopes.
 */
export const sendMessageHttp = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }

    const idParam = req.params.id;
    const conversationId = Array.isArray(idParam) ? idParam[0] : idParam;
    const { clientMessageId, type, encrypted, fileUrl, envelopes, content } = req.body;

    if (!conversationId || !mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID', code: 'INVALID_ID' });
    }

    if (!clientMessageId || !type) {
      return res.status(400).json({ error: 'clientMessageId and type are required', code: 'MISSING_FIELDS' });
    }

    const callerObjectId = new mongoose.Types.ObjectId(req.user.id);
    const convObjectId = new mongoose.Types.ObjectId(conversationId);

    // 1. Verify caller is a participant
    const conversation = await Conversation.findOne({
      _id: convObjectId,
      participants: { $in: [callerObjectId, req.user.id] },
    });

    if (!conversation) {
      return res.status(403).json({ error: 'Not a participant of this conversation', code: 'FORBIDDEN' });
    }

    // 2. Check idempotency: if clientMessageId already exists for this sender and conversation
    const existingMessage = await Message.findOne({
      conversationId: convObjectId,
      senderId: callerObjectId,
      clientMessageId,
    });
    if (existingMessage) {
      return res.status(200).json({ success: true, message: existingMessage, isDuplicate: true });
    }

    // 3. For non-system messages, validate E2EE constraints
    if (type !== 'system') {
      if (!encrypted || !encrypted.ct || !encrypted.nonce || !encrypted.sig || !encrypted.senderDeviceId) {
        return res.status(400).json({
          error: 'Encrypted payload (ct, nonce, sig, senderDeviceId) is required for non-system messages',
          code: 'MISSING_CIPHERTEXT',
        });
      }

      if (encrypted.ct.length > 90000) {
        return res.status(413).json({ error: 'Ciphertext exceeds maximum allowed size (64 KB)', code: 'PAYLOAD_TOO_LARGE' });
      }

      if (!Array.isArray(envelopes) || envelopes.length === 0 || envelopes.length > 256) {
        return res.status(400).json({ error: 'Valid envelopes array (1-256 recipients) is required', code: 'INVALID_ENVELOPES' });
      }

      // Verify encrypted.senderDeviceId belongs to the caller and is active (auto-reactivate if revoked)
      const callerDevice = await Device.findOne({
        userId: callerObjectId,
        deviceId: encrypted.senderDeviceId,
      });
      if (!callerDevice) {
        return res.status(403).json({ error: 'senderDeviceId is not an active device of the caller', code: 'INVALID_DEVICE' });
      }
      if (callerDevice.revokedAt) {
        await Device.updateOne({ _id: callerDevice._id }, { $unset: { revokedAt: 1 } });
      }

      // Check recipient set completeness: must match active devices of participants
      const participantObjectIds = conversation.participants.map((p: any) =>
        mongoose.Types.ObjectId.isValid(p) ? new mongoose.Types.ObjectId(p) : p
      );
      const activeDevices = await Device.find({
        userId: { $in: participantObjectIds },
        revokedAt: { $exists: false },
      }).select('userId deviceId');

      const expectedDeviceIds = new Set(activeDevices.map(d => d.deviceId));
      const providedDeviceIds = new Set(envelopes.map(e => e.deviceId));

      const missingDevices = [...expectedDeviceIds].filter(id => !providedDeviceIds.has(id));
      const extraDevices = [...providedDeviceIds].filter(id => !expectedDeviceIds.has(id));

      if (missingDevices.length > 0 || extraDevices.length > 0) {
        return res.status(409).json({
          error: 'Recipient device set mismatch. Please refetch active devices and retry.',
          code: 'STALE_RECIPIENT_SET',
          missingDevices,
          extraDevices,
        });
      }
    }

    // 4. Transactional write of Message + MessageKey documents
    const session = await mongoose.startSession();
    let savedMessage: any = null;
    try {
      await session.withTransaction(async () => {
        const message = new Message({
          conversationId: convObjectId,
          senderId: callerObjectId,
          type,
          clientMessageId,
          content: type === 'system' ? (content || '') : '',
          encrypted: type !== 'system' ? encrypted : undefined,
          fileUrl: fileUrl || undefined,
          readBy: [callerObjectId],
          deliveredTo: [callerObjectId],
          deletedBy: [],
        });
        await message.save({ session });
        savedMessage = message;

        if (type !== 'system' && envelopes && envelopes.length > 0) {
          const seenDeviceIds = new Set<string>();
          const keyDocs: any[] = [];
          for (const e of envelopes) {
            if (!seenDeviceIds.has(e.deviceId)) {
              seenDeviceIds.add(e.deviceId);
              keyDocs.push({
                messageId: message._id,
                conversationId: convObjectId,
                recipientUserId: new mongoose.Types.ObjectId(e.userId),
                recipientDeviceId: e.deviceId,
                nonce: e.nonce,
                wrappedKey: e.wrappedKey,
              });
            }
          }
          if (keyDocs.length > 0) {
            await MessageKey.insertMany(keyDocs, { session });
          }
        }

        await Conversation.updateOne(
          { _id: convObjectId },
          { $set: { lastMessage: message._id, updatedAt: new Date() } },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    // 5. Emit realtime events to participants' personal rooms with their specific envelope
    try {
      const io = getIO();
      if (io) {
        const msgPayload = {
          _id: savedMessage._id.toString(),
          conversationId: conversationId.toString(),
          senderId: req.user.id,
          senderName: req.user.name || '',
          senderEmail: req.user.email || '',
          type: savedMessage.type,
          clientMessageId: savedMessage.clientMessageId,
          encrypted: savedMessage.encrypted,
          fileUrl: savedMessage.fileUrl,
          createdAt: savedMessage.createdAt.toISOString(),
        };

        if (envelopes && envelopes.length > 0) {
          for (const env of envelopes) {
            io.to(`user:${env.userId}`).emit('new_message', {
              message: msgPayload,
              envelope: {
                deviceId: env.deviceId,
                nonce: env.nonce,
                wrappedKey: env.wrappedKey,
              },
              envelopes,
            });
          }
          io.to(`conversation:${conversationId}`).emit('new_message', {
            message: msgPayload,
            envelope: null,
            envelopes,
          });
        } else {
          io.to(`conversation:${conversationId}`).emit('new_message', {
            message: msgPayload,
            envelope: null,
          });
        }

        // Notify participants to update conversation previews on chat list
        const participantIds = (conversation.participants as any[]).map(p => p.toString());
        for (const pid of participantIds) {
          if (pid !== req.user.id) {
            io.to(`user:${pid}`).emit('conversation_updated', {
              conversationId,
              action: 'new_message',
              lastMessage: {
                _id: savedMessage._id.toString(),
                senderId: req.user.id,
                type: savedMessage.type,
                createdAt: savedMessage.createdAt.toISOString(),
              },
            });
          }
        }
      }
    } catch (socketErr) {
      console.warn('[Socket] Realtime broadcast warning:', socketErr);
    }

    return res.status(201).json({ success: true, message: savedMessage });
  } catch (error: any) {
    console.error('Error sending message:', error);
    return res.status(500).json({
      error: error.message || 'Failed to send message',
      code: 'SEND_FAILED',
    });
  }
};

/**
 * POST /api/messages/conversations/:id/accept
 * Accept a pending chat invitation.
 */
export const acceptConversation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const idParam = req.params.id;
    const conversationId = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!conversationId || !ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID', code: 'INVALID_ID' });
    }

    const convObjId = new ObjectId(conversationId);
    const currentUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Invalid user ID', code: 'INVALID_USER' });
    }

    const conv = await db.collection('conversations').findOne({
      _id: convObjId,
      participants: { $in: [currentUserId, req.user.id] },
    });

    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    }

    await db.collection('conversations').updateOne(
      { _id: convObjId },
      { $set: { status: 'accepted', updatedAt: new Date() } }
    );

    // Notify participants via socket
    try {
      const ioInstance = getIO();
      for (const pid of conv.participants) {
        ioInstance.to(`user:${pid.toString()}`).emit('conversation_accepted', {
          conversationId,
        });
      }
    } catch (e) {
      console.warn('[Socket] Failed to emit conversation_accepted:', e);
    }

    return res.status(200).json({
      success: true,
      message: 'Conversation accepted successfully',
    });
  } catch (error: any) {
    console.error('Error accepting conversation:', error);
    return res.status(500).json({
      error: error.message || 'Failed to accept conversation',
      code: 'ACCEPT_FAILED',
    });
  }
};

/**
 * POST /api/messages/conversations/:id/deny
 * Deny a pending chat invitation, completely deleting the conversation and its messages.
 */
export const denyConversation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const idParam = req.params.id;
    const conversationId = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!conversationId || !ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID', code: 'INVALID_ID' });
    }

    const convObjId = new ObjectId(conversationId);
    const currentUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Invalid user ID', code: 'INVALID_USER' });
    }

    const conv = await db.collection('conversations').findOne({
      _id: convObjId,
      participants: { $in: [currentUserId, req.user.id] },
    });

    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    }

    // Delete all messages belonging to this conversation
    const messages = await db.collection('messages').find({
      conversationId: { $in: [convObjId, conversationId] as any },
    }).project({ _id: 1 }).toArray();

    const msgIds = messages.map(m => m._id);

    if (msgIds.length > 0) {
      await db.collection('messagekeys').deleteMany({
        messageId: { $in: msgIds },
      });
      await db.collection('messages').deleteMany({
        _id: { $in: msgIds },
      });
    }

    // Delete the conversation document
    await db.collection('conversations').deleteOne({ _id: convObjId });

    // Notify participants via socket
    try {
      const ioInstance = getIO();
      for (const pid of conv.participants) {
        ioInstance.to(`user:${pid.toString()}`).emit('conversation_deleted', {
          conversationId,
        });
      }
    } catch (e) {
      console.warn('[Socket] Failed to emit conversation_deleted:', e);
    }

    return res.status(200).json({
      success: true,
      message: 'Conversation and messages denied and deleted successfully',
    });
  } catch (error: any) {
    console.error('Error denying conversation:', error);
    return res.status(500).json({
      error: error.message || 'Failed to deny conversation',
      code: 'DENY_FAILED',
    });
  }
};

/**
 * DELETE /api/messages/conversations/:id
 * Permanently deletes a conversation and all its messages for both participants.
 */
export const deleteConversation = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const db = mongoose.connection.db;
    const idParam = req.params.id;
    const conversationId = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!conversationId || !ObjectId.isValid(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID', code: 'INVALID_ID' });
    }

    const convObjId = new ObjectId(conversationId);
    const currentUserId = ObjectId.isValid(req.user.id) ? new ObjectId(req.user.id) : null;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Invalid user ID', code: 'INVALID_USER' });
    }

    const conv = await db.collection('conversations').findOne({
      _id: convObjId,
      participants: { $in: [currentUserId, req.user.id] },
    });

    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found', code: 'NOT_FOUND' });
    }

    // Delete all messages belonging to this conversation
    const messages = await db.collection('messages').find({
      conversationId: { $in: [convObjId, conversationId] as any },
    }).project({ _id: 1 }).toArray();

    const msgIds = messages.map(m => m._id);

    if (msgIds.length > 0) {
      await db.collection('messagekeys').deleteMany({
        messageId: { $in: msgIds },
      });
      await db.collection('messages').deleteMany({
        _id: { $in: msgIds },
      });
    }

    // Delete the conversation document
    await db.collection('conversations').deleteOne({ _id: convObjId });

    // Notify ALL participants so this chat vanishes from both users' screens
    try {
      const ioInstance = getIO();
      for (const pid of conv.participants) {
        ioInstance.to(`user:${pid.toString()}`).emit('conversation_deleted', {
          conversationId,
        });
      }
    } catch (e) {
      console.warn('[Socket] Failed to emit conversation_deleted:', e);
    }

    return res.status(200).json({
      success: true,
      message: 'Conversation deleted successfully',
      conversationId,
    });
  } catch (error: any) {
    console.error('Error deleting conversation:', error);
    return res.status(500).json({
      error: error.message || 'Failed to delete conversation',
      code: 'DELETE_FAILED',
    });
  }
};

/**
 * GET /api/messages/:id/info
 * Get detailed message delivery, read status, participants and metadata (WhatsApp-style Message Info).
 */
export const getMessageInfo = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (!mongoose.connection.db) {
      return res.status(500).json({ error: 'Database connection unavailable', code: 'DB_ERROR' });
    }

    const idParam = req.params.id;
    const messageId = Array.isArray(idParam) ? idParam[0] : idParam;
    if (!messageId) {
      return res.status(400).json({ error: 'Message ID is required', code: 'INVALID_INPUT' });
    }

    const db = mongoose.connection.db;
    const isMongoId = ObjectId.isValid(messageId);
    const query = isMongoId
      ? { $or: [{ _id: new ObjectId(messageId) }, { clientMessageId: messageId }] }
      : { clientMessageId: messageId };

    const message = await db.collection('messages').findOne(query);
    if (!message) {
      return res.status(404).json({ error: 'Message not found', code: 'NOT_FOUND' });
    }

    // Verify caller is a participant in this conversation
    const callerId = new ObjectId(req.user.id);
    const conv = await db.collection('conversations').findOne({
      _id: message.conversationId,
      participants: { $in: [callerId, req.user.id] },
    });

    if (!conv) {
      return res.status(403).json({ error: 'Access denied to this message', code: 'FORBIDDEN' });
    }

    // Collect all related user IDs to populate details
    const readByUserIds: ObjectId[] = (message.readBy || [])
      .map((id: any) => (ObjectId.isValid(id) ? new ObjectId(id) : null))
      .filter((id: ObjectId | null): id is ObjectId => id !== null);
    const deliveredToUserIds: ObjectId[] = (message.deliveredTo || [])
      .map((id: any) => (ObjectId.isValid(id) ? new ObjectId(id) : null))
      .filter((id: ObjectId | null): id is ObjectId => id !== null);
    const reactionUserIds: ObjectId[] = (message.reactions || [])
      .map((r: any) => (ObjectId.isValid(r.userId) ? new ObjectId(r.userId) : null))
      .filter((id: ObjectId | null): id is ObjectId => id !== null);
    const senderObjectId = ObjectId.isValid(message.senderId) ? new ObjectId(message.senderId) : null;

    const allUserIds = Array.from(
      new Set(
        [senderObjectId, ...readByUserIds, ...deliveredToUserIds, ...reactionUserIds]
          .filter((id: ObjectId | null): id is ObjectId => id !== null)
          .map((id: ObjectId) => id.toString())
      )
    );

    const userQueryIds = allUserIds.flatMap((id) => (ObjectId.isValid(id) ? [new ObjectId(id), id] : [id]));

    // Better Auth stores accounts in 'user' collection with name, email, and image
    const users = await db
      .collection('user')
      .find({ _id: { $in: userQueryIds as any } })
      .project({ _id: 1, name: 1, displayName: 1, email: 1, image: 1, avatarUrl: 1 })
      .toArray();

    const userMap = new Map<string, any>();
    for (const u of users) {
      const resolvedName = u.name || u.displayName || (u.email ? u.email.split('@')[0] : 'User');
      const entry = {
        _id: u._id.toString(),
        name: resolvedName,
        email: u.email || '',
        image: u.image || u.avatarUrl || null,
      };
      userMap.set(u._id.toString(), entry);
    }

    const populatedReadBy = readByUserIds.map((id) => {
      const u = userMap.get(id.toString());
      return u || { _id: id.toString(), name: 'User', email: '', image: null };
    });

    const populatedDeliveredTo = deliveredToUserIds.map((id) => {
      const u = userMap.get(id.toString());
      return u || { _id: id.toString(), name: 'User', email: '', image: null };
    });

    const sender = senderObjectId
      ? userMap.get(senderObjectId.toString()) || userMap.get(message.senderId?.toString())
      : null;

    const populatedReactions = (message.reactions || []).map((r: any) => {
      const u = r.userId ? userMap.get(r.userId.toString()) : null;
      return {
        emoji: r.emoji,
        userId: r.userId?.toString() || '',
        userName: u?.name || r.userName || 'User',
        userImage: u?.image || null,
        createdAt: r.createdAt || message.createdAt,
      };
    });

    const resolvedSenderName = sender?.name || (message.senderEmail ? message.senderEmail.split('@')[0] : null);

    return res.status(200).json({
      success: true,
      message: {
        _id: message._id.toString(),
        clientMessageId: message.clientMessageId || null,
        conversationId: message.conversationId.toString(),
        senderId: message.senderId.toString(),
        senderName: resolvedSenderName || null,
        senderEmail: sender?.email || message.senderEmail || '',
        senderImage: sender?.image || null,
        type: message.type,
        content: message.type === 'system' || !message.encrypted ? message.content : '',
        fileUrl: message.fileUrl || null,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt || message.createdAt,
        readBy: populatedReadBy,
        deliveredTo: populatedDeliveredTo,
        reactions: populatedReactions,
      },
    });
  } catch (error: any) {
    console.error('Error fetching message info:', error);
    return res.status(500).json({
      error: error.message || 'Failed to fetch message info',
      code: 'SERVER_ERROR',
    });
  }
};



