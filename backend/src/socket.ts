import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import Message from './models/Message.js';
import MessageKey from './models/MessageKey.js';
import Device from './models/Device.js';
import Conversation from './models/Conversation.js';
import CallLog from './models/CallLog.js';
import cloudinary from './config/cloudinary.js';
import { extractCloudinaryPublicId } from './controllers/message.controller.js';
import { auth, secondaryStorage } from './auth.js';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
  userName?: string;
}

let io: Server | null = null;

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.IO has not been initialized');
  }
  return io;
};

// In-memory registry of active user socket connections and activity timestamps
export const activeUserSockets = new Map<string, number>();
export const userLastActiveMap = new Map<string, number>();

/**
 * Checks whether a user is currently online or was active within 1 minute (60 seconds)
 */
export const isUserOnline = (userId: string, dbLastActiveAt?: Date | string | null): boolean => {
  const socketCount = activeUserSockets.get(userId) || 0;
  if (socketCount > 0) return true;

  const memLastActive = userLastActiveMap.get(userId);
  if (memLastActive && Date.now() - memLastActive < 60000) {
    return true;
  }

  if (dbLastActiveAt) {
    const dbTime = new Date(dbLastActiveAt).getTime();
    if (!isNaN(dbTime) && Date.now() - dbTime < 60000) {
      return true;
    }
  }

  return false;
};

export const getOnlineUserIds = async (): Promise<string[]> => {
  const onlineSet = new Set<string>();
  const now = Date.now();
  for (const [userId, count] of activeUserSockets.entries()) {
    if (count > 0) {
      onlineSet.add(userId);
    }
  }
  for (const [userId, lastTime] of userLastActiveMap.entries()) {
    if (now - lastTime < 60000) {
      onlineSet.add(userId);
    }
  }
  if (mongoose.connection.db) {
    try {
      const activeDocs = await mongoose.connection.db.collection('user')
        .find({ lastActiveAt: { $gte: new Date(now - 60000) } })
        .project({ _id: 1 })
        .toArray();
      for (const doc of activeDocs) {
        onlineSet.add(doc._id.toString());
      }
    } catch {}
  }
  return Array.from(onlineSet);
};

interface PersistMessageOptions {
  convObjectId: ObjectId;
  callerObjectId: ObjectId;
  type: string;
  msgId: string;
  content: string;
  encrypted?: any;
  fileUrl?: string | undefined;
  envelopes?: Array<{
    userId: string;
    deviceId: string;
    nonce: string;
    wrappedKey: string;
  }> | undefined;
  conversationId: string;
  socketUserId: string;
  socket: AuthenticatedSocket;
}

async function persistMessageAsync(options: PersistMessageOptions): Promise<void> {
  const {
    convObjectId,
    callerObjectId,
    type,
    msgId,
    content,
    encrypted,
    fileUrl,
    envelopes,
    conversationId,
    socketUserId,
    socket,
  } = options;

  const backoffDelays = [200, 400, 800];
  let lastError: any = null;

  for (let attempt = 0; attempt <= backoffDelays.length; attempt++) {
    const session = await mongoose.startSession();
    try {
      let savedMessage: any = null;
      await session.withTransaction(async () => {
        // Idempotency: verify if already stored
        const existing = await Message.findOne({
          conversationId: convObjectId,
          senderId: callerObjectId,
          clientMessageId: msgId,
        }).session(session);

        if (existing) {
          savedMessage = existing;
          return;
        }

        const message = new Message({
          conversationId: convObjectId,
          senderId: callerObjectId,
          type,
          clientMessageId: msgId,
          content: type === 'system' ? content : '',
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

      // Transaction completed successfully!
      if (savedMessage) {
        const confirmedData = {
          clientMessageId: msgId,
          _id: savedMessage._id.toString(),
          createdAt: savedMessage.createdAt ? savedMessage.createdAt.toISOString() : new Date().toISOString(),
          conversationId,
        };
        socket.emit('message_confirmed', confirmedData);
        io?.to(`user:${socketUserId}`).emit('message_confirmed', confirmedData);
      }
      return;
    } catch (err) {
      lastError = err;
      if (attempt < backoffDelays.length) {
        await new Promise((resolve) => setTimeout(resolve, backoffDelays[attempt]));
      }
    } finally {
      await session.endSession();
    }
  }

  // All retries failed
  console.error('[Socket] Failed to persist message after retries:', {
    conversationId,
    clientMessageId: msgId,
    senderId: socketUserId,
    error: lastError,
  });

  const failurePayload = {
    conversationId,
    clientMessageId: msgId,
    error: 'Failed to persist message to database',
  };
  socket.emit('message_persist_failed', failurePayload);
  io?.to(`user:${socketUserId}`).emit('message_persist_failed', failurePayload);
}

export const initSocket = (httpServer: HttpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Allow both websocket and polling for Expo/React Native compatibility
    transports: ['websocket', 'polling'],
  });

  // Authentication middleware — validates the session token on every connection
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      let token: string | null =
        (socket.handshake.auth?.token as string) ||
        (socket.handshake.auth?.sessionToken as string) ||
        (socket.handshake.headers?.['x-session-token'] as string) ||
        null;

      if (!token && socket.handshake.headers?.cookie) {
        const cookieHeader = socket.handshake.headers.cookie.trim();
        if (cookieHeader.startsWith('{')) {
          try {
            const parsed = JSON.parse(cookieHeader);
            token =
              parsed['better-auth.session_token']?.value ||
              parsed['chatuk.session_token']?.value ||
              null;
          } catch {}
        }

        if (!token) {
          const match =
            cookieHeader.match(/better-auth\.session_token=([^;]+)/) ||
            cookieHeader.match(/chatuk\.session_token=([^;]+)/);
          if (match && match[1]) {
            token = decodeURIComponent(match[1]);
          }
        }
      }

      if (token) {
        if (token.startsWith('s:')) {
          token = token.slice(2);
        }
        token = (token.split('.')[0] || '').trim();
      }

      if (!token) {
        return next(new Error('Authentication required'));
      }

      // 1. Try Better Auth's session lookup (hits Redis secondaryStorage in < 1ms!)
      if (auth?.api?.getSession) {
        try {
          const session = await auth.api.getSession({
            headers: new Headers({
              authorization: `Bearer ${token}`,
              'x-session-token': token,
            }),
          });
          if (session?.user) {
            socket.userId = session.user.id?.toString();
            socket.userEmail = session.user.email;
            socket.userName = session.user.name;
            return next();
          }
        } catch {
          // Fall back to direct Mongo check
        }
      }

      if (!mongoose.connection.db) {
        return next(new Error('Authentication required'));
      }

      // 2. Fallback to direct MongoDB session collection query
      const db = mongoose.connection.db;
      const sessionDoc = await db.collection('session').findOne({
        $or: [{ token }, { token: token.split('.')[0] || token }],
        expiresAt: { $gt: new Date() },
      });

      if (!sessionDoc || !sessionDoc.userId) {
        return next(new Error('Invalid or expired session'));
      }

      const userIdStr = sessionDoc.userId.toString();
      const userQuery: any = ObjectId.isValid(userIdStr)
        ? { $or: [{ _id: userIdStr }, { _id: new ObjectId(userIdStr) }] }
        : { _id: userIdStr };

      const userDoc = await db.collection('user').findOne(userQuery);
      if (!userDoc) {
        return next(new Error('User not found'));
      }

      socket.userId = userDoc._id.toString();
      socket.userEmail = userDoc.email;
      socket.userName = userDoc.name;

      // Backfill Redis cache on miss for subsequent sub-2ms lookups
      try {
        const ttl = Math.ceil((new Date(sessionDoc.expiresAt).getTime() - Date.now()) / 1000);
        if (ttl > 0) {
          secondaryStorage.set(
            token,
            JSON.stringify({
              session: {
                ...sessionDoc,
                id: sessionDoc._id.toString(),
              },
              user: {
                ...userDoc,
                id: userDoc._id.toString(),
              },
            }),
            ttl
          ).catch(() => {});
        }
      } catch {
        // Cache backfill error ignored
      }

      next();
    } catch (err) {
      console.error('Socket auth error:', err);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`Socket connected: ${socket.userId} (${socket.userEmail})`);

    const uid = socket.userId;
    if (uid) {
      const prevCount = activeUserSockets.get(uid) || 0;
      activeUserSockets.set(uid, prevCount + 1);
      userLastActiveMap.set(uid, Date.now());

      // Join a personal room so we can target messages and notifications to specific users
      socket.join(`user:${uid}`);

      // Auto-join group rooms for real-time synchronization
      if (mongoose.Types.ObjectId.isValid(uid)) {
        Conversation.find({
          type: 'group',
          participants: new mongoose.Types.ObjectId(uid),
        })
          .select('_id')
          .then((groups) => {
            for (const g of groups) {
              socket.join(`conversation:${g._id.toString()}`);
            }
          })
          .catch(() => {});
      }

      // Broadcast active status if this user newly came online
      if (prevCount === 0) {
        io!.emit('user_status_changed', {
          userId: uid,
          isOnline: true,
          lastActiveAt: new Date().toISOString(),
        });
      }

      // Update in DB
      if (mongoose.connection.db && ObjectId.isValid(uid)) {
        mongoose.connection.db.collection('user').updateOne(
          { _id: new ObjectId(uid) },
          { $set: { lastActiveAt: new Date() } }
        ).catch(() => {});
      }
    }

    // Send initial list of all currently online users to the newly connected client
    getOnlineUserIds().then(onlineIds => {
      socket.emit('online_users_list', onlineIds);
    });

    // Explicit request for online users
    socket.on('get_online_users', async () => {
      const onlineIds = await getOnlineUserIds();
      socket.emit('online_users_list', onlineIds);
    });

    // Heartbeat to refresh active timestamp
    socket.on('heartbeat', () => {
      if (socket.userId) {
        userLastActiveMap.set(socket.userId, Date.now());
      }
    });

    // ─── Join a conversation room ───
    socket.on('join_conversation', (conversationId: string) => {
      socket.join(`conversation:${conversationId}`);
      if (socket.userId) {
        userLastActiveMap.set(socket.userId, Date.now());
      }
      console.log(`User ${socket.userId} joined conversation:${conversationId}`);
    });

    // ─── Leave a conversation room ───
    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // ─── Send a message ───
    socket.on('send_message', async (data: {
      conversationId: string;
      clientMessageId?: string;
      content?: string;
      type?: 'text' | 'image' | 'video' | 'audio' | 'reaction' | 'control' | 'system';
      encrypted?: {
        v: number;
        senderDeviceId: string;
        nonce: string;
        ct: string;
        sig: string;
      };
      fileUrl?: string;
      envelopes?: Array<{
        userId: string;
        deviceId: string;
        nonce: string;
        wrappedKey: string;
      }>;
    }) => {
      try {
        if (!socket.userId || !mongoose.connection.db) return;

        userLastActiveMap.set(socket.userId, Date.now());
        const { conversationId, content = '', type = 'text', clientMessageId, encrypted, fileUrl, envelopes } = data;

        console.log(`[Socket] send_message from: ${socket.userId} (${socket.userEmail}) in conv: ${conversationId}`);

        if (!conversationId || !ObjectId.isValid(conversationId)) {
          socket.emit('error_message', { error: 'Invalid conversation ID' });
          return;
        }

        const callerObjectId = new ObjectId(socket.userId);
        const convObjectId = new ObjectId(conversationId);

        // Verify user is a participant of this conversation
        const conversation = await Conversation.findOne({
          _id: convObjectId,
          participants: callerObjectId,
        });

        if (!conversation) {
          socket.emit('error_message', { error: 'Not a participant of this conversation' });
          return;
        }

        // Check blocking between participants (enforced on 1:1 direct conversations only)
        const otherParticipantIds = (conversation.participants as any[])
          .filter(p => p.toString() !== socket.userId);

        if (conversation.type === 'direct' && otherParticipantIds.length > 0) {
          const userDocs = await mongoose.connection.db.collection('user')
            .find({ _id: { $in: [callerObjectId, ...otherParticipantIds] } })
            .project({ _id: 1, blockedUsers: 1 })
            .toArray();

          const senderDoc = userDocs.find(u => u._id.toString() === socket.userId);
          const senderBlocked = (senderDoc?.blockedUsers || []).map((b: any) => b.toString());

          for (const otherId of otherParticipantIds) {
            const otherDoc = userDocs.find(u => u._id.toString() === otherId.toString());
            const otherBlocked = (otherDoc?.blockedUsers || []).map((b: any) => b.toString());

            if (senderBlocked.includes(otherId.toString())) {
              socket.emit('error_message', { error: 'You have blocked this contact. Unblock to send messages.' });
              return;
            }
            if (otherBlocked.includes(socket.userId)) {
              socket.emit('error_message', { error: 'You cannot send messages to this contact.' });
              return;
            }
          }
        }

        // Check idempotency if clientMessageId is provided
        if (clientMessageId) {
          const existingMessage = await Message.findOne({
            conversationId: convObjectId,
            senderId: callerObjectId,
            clientMessageId,
          });
          if (existingMessage) {
            // Already processed; confirm back to client so it's not stuck on retry
            const confirmedData = {
              clientMessageId,
              _id: existingMessage._id.toString(),
              createdAt: existingMessage.createdAt ? existingMessage.createdAt.toISOString() : new Date().toISOString(),
              conversationId,
            };
            socket.emit('message_confirmed', confirmedData);
            return;
          }
        }

        // E2EE Validation for non-system messages
        if (type !== 'system' && encrypted && envelopes) {
          if (encrypted.ct.length > 90000) {
            socket.emit('error_message', { error: 'Ciphertext exceeds maximum allowed size' });
            return;
          }

          if (envelopes.length > 256) {
            socket.emit('error_message', { error: 'Recipient count exceeds maximum limit (256)' });
            return;
          }

          // Verify senderDeviceId belongs to the caller and is active (auto-reactivate if revoked)
          const callerDevice = await Device.findOne({
            userId: callerObjectId,
            deviceId: encrypted.senderDeviceId,
          });
          if (!callerDevice) {
            socket.emit('error_message', { error: 'senderDeviceId is not active for sender' });
            return;
          }
          if (callerDevice.revokedAt) {
            await Device.updateOne({ _id: callerDevice._id }, { $unset: { revokedAt: 1 } });
          }

          // Check recipient set completeness against conversation participants
          const participantObjectIds = (conversation.participants as any[]).map((p: any) =>
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
            socket.emit('error_message', {
              code: 'STALE_RECIPIENT_SET',
              error: 'Recipient devices mismatch',
              missingDevices,
              extraDevices,
            });
            return;
          }
        }

        const msgId = clientMessageId || new ObjectId().toString();
        const messageCreatedAt = new Date();

        // Build message payload for immediate delivery
        const basePayload = {
          _id: msgId,
          conversationId,
          senderId: socket.userId,
          senderName: socket.userName,
          senderEmail: socket.userEmail,
          type,
          clientMessageId: msgId,
          content: type === 'system' ? content : '',
          encrypted: type !== 'system' ? encrypted : undefined,
          fileUrl: fileUrl || undefined,
          readBy: [socket.userId],
          deliveredTo: [socket.userId],
          createdAt: messageCreatedAt.toISOString(),
        };

        // Realtime Delivery: Emit immediately to each recipient's user room WITH THEIR ENVELOPE
        if (envelopes && envelopes.length > 0) {
          for (const env of envelopes) {
            io!.to(`user:${env.userId}`).emit('new_message', {
              message: basePayload,
              envelope: {
                deviceId: env.deviceId,
                nonce: env.nonce,
                wrappedKey: env.wrappedKey,
              },
              envelopes,
            });
          }
          // Also broadcast to conversation room so any active screen receives it immediately
          io!.to(`conversation:${conversationId}`).emit('new_message', {
            message: {
              ...basePayload,
              envelopes,
            },
            envelope: null,
            envelopes,
          });
        } else {
          // System message fallback broadcast to conversation room
          io!.to(`conversation:${conversationId}`).emit('new_message', {
            message: basePayload,
            envelope: null,
          });
        }

        // Update conversation previews on chat lists in real-time with zero delay
        const participantIds = (conversation.participants as any[]).map(p => p.toString());
        const snippetText = content || (type === 'image' ? '📷 Photo' : type === 'video' ? '🎥 Video' : type === 'audio' ? '🎤 Voice message' : '');
        for (const pid of participantIds) {
          io!.to(`user:${pid}`).emit('conversation_updated', {
            conversationId,
            action: 'new_message',
            lastMessage: {
              _id: msgId,
              senderId: socket.userId,
              type,
              content: snippetText,
              createdAt: messageCreatedAt.toISOString(),
            },
          });
        }

        // Fire-and-forget DB persistence with exponential backoff retry
        persistMessageAsync({
          convObjectId,
          callerObjectId,
          type,
          msgId,
          content,
          encrypted,
          fileUrl,
          envelopes,
          conversationId,
          socketUserId: socket.userId,
          socket,
        }).catch((err) => {
          console.error('[Socket] Unexpected error in persistMessageAsync:', err);
        });


      } catch (err) {
        console.error('Error sending message via socket:', err);
        if (data?.clientMessageId) {
          const failurePayload = {
            conversationId: data.conversationId,
            clientMessageId: data.clientMessageId,
            error: 'Failed to save message to live database',
          };
          socket.emit('message_persist_failed', failurePayload);
        } else {
          socket.emit('error_message', { error: 'Failed to send message' });
        }
      }
    });


    // ─── Message Reactions (Emoji drop / Double-tap heart) ───
    socket.on('message_reaction', async (data: {
      conversationId: string;
      messageId: string;
      emoji: string;
      action?: 'add' | 'remove' | 'toggle';
    }) => {
      try {
        if (!socket.userId || !mongoose.connection.db) return;
        userLastActiveMap.set(socket.userId, Date.now());
        const db = mongoose.connection.db;
        const { conversationId, messageId, emoji, action = 'toggle' } = data;

        if (!messageId || !emoji) return;

        const isMongoId = ObjectId.isValid(messageId);
        const query = isMongoId
          ? { $or: [{ _id: new ObjectId(messageId) }, { clientMessageId: messageId }] }
          : { clientMessageId: messageId };

        const message = await db.collection('messages').findOne(query);
        if (!message) return;

        const currentReactions: any[] = message.reactions || [];
        const existingIndex = currentReactions.findIndex(
          (r: any) => r.userId?.toString() === socket.userId
        );

        let updatedReactions = [...currentReactions];

        if (action === 'remove') {
          if (existingIndex !== -1) {
            updatedReactions.splice(existingIndex, 1);
          }
        } else if (action === 'add') {
          if (existingIndex !== -1) {
            // Update reaction to current emoji
            updatedReactions[existingIndex] = {
              userId: new ObjectId(socket.userId),
              userName: socket.userName || '',
              emoji,
              createdAt: new Date(),
            };
          } else {
            // Add reaction
            updatedReactions.push({
              userId: new ObjectId(socket.userId),
              userName: socket.userName || '',
              emoji,
              createdAt: new Date(),
            });
          }
        } else {
          // Default toggle behavior
          if (existingIndex !== -1) {
            if (updatedReactions[existingIndex].emoji === emoji) {
              // Toggle off
              updatedReactions.splice(existingIndex, 1);
            } else {
              // Switch to new emoji
              updatedReactions[existingIndex] = {
                userId: new ObjectId(socket.userId),
                userName: socket.userName || '',
                emoji,
                createdAt: new Date(),
              };
            }
          } else {
            // Add new emoji reaction
            updatedReactions.push({
              userId: new ObjectId(socket.userId),
              userName: socket.userName || '',
              emoji,
              createdAt: new Date(),
            });
          }
        }

        await db.collection('messages').updateOne(
          { _id: message._id },
          { $set: { reactions: updatedReactions, updatedAt: new Date() } }
        );

        const payload = {
          conversationId,
          messageId: message._id.toString(),
          clientMessageId: message.clientMessageId || messageId,
          reactions: updatedReactions.map((r) => ({
            userId: r.userId?.toString(),
            userName: r.userName,
            emoji: r.emoji,
            createdAt: r.createdAt,
          })),
        };

        io!.to(`conversation:${conversationId}`).emit('message_reaction_updated', payload);
        const conversation = await Conversation.findById(message.conversationId);
        if (conversation?.participants) {
          for (const pid of conversation.participants) {
            io!.to(`user:${pid.toString()}`).emit('message_reaction_updated', payload);
          }
        }
      } catch (err) {
        console.error('Error processing message reaction:', err);
      }
    });

    // ─── Delete Message (real-time with Cloudinary media cleanup) ───
    socket.on('delete_message', async (data: { messageId?: string; clientMessageId?: string; conversationId?: string }) => {
      try {
        if (!socket.userId || !mongoose.connection.db) return;
        const targetId = data.messageId || data.clientMessageId;
        if (!targetId) return;

        const db = mongoose.connection.db;
        const isMongoId = ObjectId.isValid(targetId);
        const query = isMongoId
          ? { $or: [{ _id: new ObjectId(targetId) }, { clientMessageId: targetId }] }
          : { clientMessageId: targetId };

        const message = await db.collection('messages').findOne(query);
        if (!message) return;

        // Verify sender authorization
        if (message.senderId.toString() !== socket.userId) return;

        const msgObjId = message._id;

        // If message has media uploaded to Cloudinary, destroy it
        if (message.fileUrl) {
          const cInfo = extractCloudinaryPublicId(message.fileUrl);
          if (cInfo) {
            try {
              await cloudinary.uploader.destroy(cInfo.publicId, {
                resource_type: cInfo.resourceType,
                invalidate: true,
              });
              console.log(`[Socket/Cloudinary] Deleted ${cInfo.resourceType} asset: ${cInfo.publicId}`);
            } catch (err) {
              console.warn('[Socket/Cloudinary] Cloudinary destroy error:', err);
            }
          }
        }

        // Permanently remove from DB and clean up messagekeys
        await db.collection('messages').deleteOne({ _id: msgObjId });
        await db.collection('messagekeys').deleteMany({ messageId: msgObjId });

        const convId = message.conversationId;
        const convObjId = typeof convId === 'string' && ObjectId.isValid(convId) ? new ObjectId(convId) : convId;

        const remaining = await db.collection('messages')
          .find({ conversationId: { $in: [convId, convId.toString()] } })
          .sort({ createdAt: -1 })
          .limit(1)
          .toArray();
        const newLastMsg = remaining.length > 0 ? remaining[0] : null;

        await db.collection('conversations').updateOne(
          { _id: convObjId },
          { $set: { lastMessage: newLastMsg ? newLastMsg._id : null, updatedAt: newLastMsg ? newLastMsg.createdAt : new Date() } }
        );

        io!.to(`conversation:${convId.toString()}`).emit('message_deleted', {
          messageId: msgObjId.toString(),
          clientMessageId: message.clientMessageId,
          conversationId: convId.toString(),
          deletedBy: socket.userId,
        });

        const conversation = await db.collection('conversations').findOne({ _id: convObjId });
        if (conversation?.participants) {
          for (const pid of conversation.participants) {
            io!.to(`user:${pid.toString()}`).emit('message_deleted', {
              messageId: msgObjId.toString(),
              clientMessageId: message.clientMessageId,
              conversationId: convId.toString(),
              deletedBy: socket.userId,
            });
            io!.to(`user:${pid.toString()}`).emit('conversation_updated', {
              conversationId: convId.toString(),
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
      } catch (err) {
        console.error('[Socket] delete_message error:', err);
      }
    });

    // ─── Typing indicators ───
    socket.on('typing', (conversationId: string) => {
      if (socket.userId) {
        userLastActiveMap.set(socket.userId, Date.now());
      }
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        userId: socket.userId,
        userName: socket.userName,
        conversationId,
      });
    });

    socket.on('stop_typing', (conversationId: string) => {
      socket.to(`conversation:${conversationId}`).emit('user_stop_typing', {
        userId: socket.userId,
        conversationId,
      });
    });

    // ─── Mark messages as read ───
    socket.on('mark_read', async (data: { conversationId: string }) => {
      try {
        if (!socket.userId || !mongoose.connection.db) return;

        userLastActiveMap.set(socket.userId, Date.now());
        const db = mongoose.connection.db;
        const { conversationId } = data;

        const queryUserIds = ObjectId.isValid(socket.userId)
          ? [new ObjectId(socket.userId), socket.userId]
          : [socket.userId];

        const convQuery = ObjectId.isValid(conversationId)
          ? [new ObjectId(conversationId), conversationId]
          : [conversationId];

        // Mark all messages in this conversation as read by this user
        await db.collection('messages').updateMany(
          {
            conversationId: { $in: convQuery as any },
            senderId: { $nin: queryUserIds as any },
            readBy: { $nin: queryUserIds as any },
          },
          {
            $addToSet: { readBy: new ObjectId(socket.userId) },
          }
        );

        // Notify other participants in the room that messages were read
        socket.to(`conversation:${conversationId}`).emit('messages_read', {
          conversationId,
          readBy: socket.userId,
        });

        // Also notify the reading user's personal room to instantly clear unread counts on chats screen
        io!.to(`user:${socket.userId}`).emit('messages_read', {
          conversationId,
          readBy: socket.userId,
        });
      } catch (err) {
        console.error('Error marking messages as read:', err);
      }
    });

    // ─── Sync Wallpaper ───
    socket.on('sync_wallpaper', async (data: { wallpaperId: string; updatedAt: number }) => {
      try {
        if (!socket.userId || !mongoose.connection.db) return;
        const { wallpaperId, updatedAt } = data;
        if (!wallpaperId || typeof wallpaperId !== 'string') return;

        const db = mongoose.connection.db;
        const uid = socket.userId;
        const orConditions: any[] = [{ _id: uid }];
        if (ObjectId.isValid(uid)) {
          orConditions.push({ _id: new ObjectId(uid) });
        }
        if (socket.userEmail) {
          orConditions.push({ email: socket.userEmail });
        }
        const userFilter = { $or: orConditions };

        const user = await db.collection('user').findOne(userFilter);
        if (!user) return;

        const clientUpdatedAt = typeof updatedAt === 'number' ? new Date(updatedAt) : new Date();
        const serverUpdatedAt = user.wallpaperUpdatedAt ? new Date(user.wallpaperUpdatedAt) : null;

        if (serverUpdatedAt && serverUpdatedAt.getTime() > clientUpdatedAt.getTime()) {
          // Server is newer: emit server's wallpaper back to client
          socket.emit('wallpaper_updated', {
            wallpaperId: user.wallpaper || 'default',
            updatedAt: serverUpdatedAt.getTime(),
          });
          return;
        }

        await db.collection('user').updateOne(userFilter, {
          $set: {
            wallpaper: wallpaperId,
            wallpaperUpdatedAt: clientUpdatedAt,
            updatedAt: new Date(),
          },
        });

        const userIdStr = user._id.toString();
        io?.to(`user:${userIdStr}`).emit('wallpaper_updated', {
          wallpaperId,
          updatedAt: clientUpdatedAt.getTime(),
        });
        if (socket.userId && socket.userId !== userIdStr) {
          io?.to(`user:${socket.userId}`).emit('wallpaper_updated', {
            wallpaperId,
            updatedAt: clientUpdatedAt.getTime(),
          });
        }
      } catch (err) {
        console.warn('[Socket] sync_wallpaper error:', err);
      }
    });

    // ─── Voice Call Signaling ───

    socket.on('call:initiate', async (data: {
      calleeId: string;
      conversationId: string;
      type: 'audio';
    }) => {
      try {
        if (!socket.userId || !mongoose.connection.db) return;
        const { calleeId, conversationId, type } = data;

        // 1. Verify conversation exists, is accepted, and both are participants
        const conv = await Conversation.findOne({
          _id: new ObjectId(conversationId),
          participants: { $all: [new ObjectId(socket.userId), new ObjectId(calleeId)] },
          status: 'accepted',
        });
        if (!conv) {
          socket.emit('call:error', { error: 'Cannot call — conversation not accepted' });
          return;
        }

        // 2. Check blocking
        const db = mongoose.connection.db;
        const users = await db.collection('user')
          .find({ _id: { $in: [new ObjectId(socket.userId), new ObjectId(calleeId)] } })
          .project({ _id: 1, blockedUsers: 1, name: 1, image: 1 })
          .toArray();
        const caller = users.find(u => u._id.toString() === socket.userId);
        const callee = users.find(u => u._id.toString() === calleeId);
        const callerBlocked = (caller?.blockedUsers || []).map((b: any) => b.toString());
        const calleeBlocked = (callee?.blockedUsers || []).map((b: any) => b.toString());
        if (callerBlocked.includes(calleeId) || calleeBlocked.includes(socket.userId)) {
          socket.emit('call:error', { error: 'Cannot call this contact' });
          return;
        }

        // 3. Create CallLog entry (default result: 'missed', updated on accept/decline)
        const callLog = new CallLog({
          callerId: new ObjectId(socket.userId),
          calleeId: new ObjectId(calleeId),
          conversationId: new ObjectId(conversationId),
          type,
          result: 'missed',
        });
        await callLog.save();

        // 4. Notify callee
        io!.to(`user:${calleeId}`).emit('call:incoming', {
          callLogId: callLog._id.toString(),
          callerId: socket.userId,
          callerName: caller?.name || socket.userName || 'Caller',
          callerImage: caller?.image || null,
          conversationId,
          type,
        });

        // 5. Confirm to caller that call was initiated
        socket.emit('call:initiated', {
          callLogId: callLog._id.toString(),
        });
      } catch (err: any) {
        console.error('Error initiating call:', err);
        socket.emit('call:error', { error: err?.message || 'Failed to initiate call' });
      }
    });

    socket.on('call:accept', async (data: { callLogId: string }) => {
      try {
        if (!socket.userId) return;
        const callLog = await CallLog.findOneAndUpdate(
          { _id: new ObjectId(data.callLogId), calleeId: new ObjectId(socket.userId) },
          { $set: { result: 'answered' } },
          { new: true }
        );
        if (!callLog) return;
        io!.to(`user:${callLog.callerId.toString()}`).emit('call:accepted', {
          callLogId: data.callLogId,
        });
      } catch (err) {
        console.error('Error accepting call:', err);
      }
    });

    socket.on('call:decline', async (data: { callLogId: string }) => {
      try {
        if (!socket.userId) return;
        const callLog = await CallLog.findOneAndUpdate(
          { _id: new ObjectId(data.callLogId), calleeId: new ObjectId(socket.userId) },
          { $set: { result: 'rejected' } },
          { new: true }
        );
        if (!callLog) return;
        io!.to(`user:${callLog.callerId.toString()}`).emit('call:declined', {
          callLogId: data.callLogId,
        });
      } catch (err) {
        console.error('Error declining call:', err);
      }
    });

    socket.on('call:cancel', async (data: { callLogId: string }) => {
      try {
        if (!socket.userId) return;
        const callLog = await CallLog.findById(data.callLogId);
        if (!callLog || callLog.callerId.toString() !== socket.userId) return;
        io!.to(`user:${callLog.calleeId.toString()}`).emit('call:cancelled', {
          callLogId: data.callLogId,
        });
      } catch (err) {
        console.error('Error cancelling call:', err);
      }
    });

    socket.on('call:end', async (data: { callLogId: string }) => {
      try {
        if (!socket.userId) return;
        const callLog = await CallLog.findOneAndUpdate(
          { _id: new ObjectId(data.callLogId) },
          { $set: { endedAt: new Date() } },
          { new: true }
        );
        if (!callLog) return;
        const otherUserId = callLog.callerId.toString() === socket.userId
          ? callLog.calleeId.toString()
          : callLog.callerId.toString();
        io!.to(`user:${otherUserId}`).emit('call:ended', {
          callLogId: data.callLogId,
          reason: 'ended',
        });
      } catch (err) {
        console.error('Error ending call:', err);
      }
    });

    // WebRTC signaling relay — SDP and ICE candidates
    socket.on('call:offer', async (data: { callLogId: string; sdp: any }) => {
      try {
        if (!socket.userId) return;
        const callLog = await CallLog.findById(data.callLogId);
        if (!callLog) return;
        const targetId = callLog.calleeId.toString();
        io!.to(`user:${targetId}`).emit('call:offer', {
          callLogId: data.callLogId,
          sdp: data.sdp,
        });
      } catch (err) {
        console.error('Error relaying call:offer:', err);
      }
    });

    socket.on('call:answer', async (data: { callLogId: string; sdp: any }) => {
      try {
        if (!socket.userId) return;
        const callLog = await CallLog.findById(data.callLogId);
        if (!callLog) return;
        const targetId = callLog.callerId.toString();
        io!.to(`user:${targetId}`).emit('call:answer', {
          callLogId: data.callLogId,
          sdp: data.sdp,
        });
      } catch (err) {
        console.error('Error relaying call:answer:', err);
      }
    });

    socket.on('call:ice-candidate', async (data: { callLogId: string; candidate: any }) => {
      try {
        if (!socket.userId) return;
        const callLog = await CallLog.findById(data.callLogId);
        if (!callLog) return;
        const otherUserId = callLog.callerId.toString() === socket.userId
          ? callLog.calleeId.toString()
          : callLog.callerId.toString();
        io!.to(`user:${otherUserId}`).emit('call:ice-candidate', {
          callLogId: data.callLogId,
          candidate: data.candidate,
        });
      } catch (err) {
        console.error('Error relaying call:ice-candidate:', err);
      }
    });

    // ─── Disconnect ───
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.userId}`);
      if (socket.userId) {
        const uid = socket.userId;
        const currentCount = activeUserSockets.get(uid) || 0;
        const newCount = Math.max(0, currentCount - 1);
        if (newCount === 0) {
          activeUserSockets.delete(uid);
        } else {
          activeUserSockets.set(uid, newCount);
        }
        userLastActiveMap.set(uid, Date.now());

        const now = new Date();
        if (mongoose.connection.db && ObjectId.isValid(uid)) {
          mongoose.connection.db.collection('user').updateOne(
            { _id: new ObjectId(uid) },
            { $set: { lastActiveAt: now } }
          ).catch(() => {});
        }

        // If user has no more open socket connections, notify clients of status change after 60s grace period
        if (newCount === 0) {
          setTimeout(() => {
            const count = activeUserSockets.get(uid) || 0;
            const lastActive = userLastActiveMap.get(uid) || 0;
            if (count === 0 && Date.now() - lastActive >= 60000) {
              io?.emit('user_status_changed', {
                userId: uid,
                isOnline: false,
                lastActiveAt: new Date(lastActive).toISOString(),
              });
            }
          }, 60000);
        }
      }
    });
  });

  console.log('Socket.IO initialized');
  return io;
};
