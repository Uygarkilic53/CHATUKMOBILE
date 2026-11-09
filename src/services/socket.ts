import { Platform } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { getOrigin } from '../lib/auth-client';
import { getSessionAuth } from '../lib/api';
import { deleteLocalMessage, updateLocalMessageDeliveryStatus } from '../e2ee/localDb';
import { appStorage } from '../lib/storage';

export interface MessageReaction {
  userId: string;
  userName?: string;
  emoji: string;
  createdAt?: string;
}

export interface SocketMessage {
  _id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  senderEmail?: string;
  senderImage?: string | null;
  type: 'text' | 'image' | 'video' | 'audio' | 'reaction' | 'control' | 'system';
  content?: string;
  clientMessageId?: string;
  encrypted?: any;
  envelope?: { deviceId?: string; nonce: string; wrappedKey: string } | null;
  envelopes?: { deviceId: string; nonce: string; wrappedKey: string }[] | null;
  fileUrl?: string | null;
  readBy: string[];
  deliveredTo?: string[];
  reactions?: MessageReaction[];
  isOutgoing?: boolean;
  deliveryStatus?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  createdAt: string;
}

export interface TypingData {
  userId: string;
  userName?: string;
  conversationId: string;
}

export interface OutboundMessagePayload {
  conversationId: string;
  clientMessageId: string;
  type?: 'text' | 'image' | 'video' | 'audio' | 'reaction' | 'control' | 'system';
  content?: string;
  encrypted?: any;
  fileUrl?: string;
  envelopes?: {
    userId: string;
    deviceId: string;
    nonce: string;
    wrappedKey: string;
  }[];
}

export interface ConfirmedMessageData {
  clientMessageId: string;
  _id: string;
  createdAt: string;
  conversationId?: string;
}

export interface PersistFailedData {
  clientMessageId: string;
  conversationId: string;
  error: string;
}

export interface IncomingCallData {
  callLogId: string;
  callerId: string;
  callerName: string;
  callerImage: string | null;
  conversationId: string;
  type: 'audio';
}

export interface CallEndedData {
  callLogId: string;
  reason: string;
}

export interface CallOfferData {
  callLogId: string;
  sdp: any;
}

export interface CallAnswerData {
  callLogId: string;
  sdp: any;
}

export interface CallCandidateData {
  callLogId: string;
  candidate: any;
}

class SocketService {
  private socket: Socket | null = null;
  private isConnecting: boolean = false;
  private currentConversationId: string | null = null;
  private currentToken: string | null = null;
  private pendingMessages: Map<string, OutboundMessagePayload> = new Map();
  private confirmedListeners: Set<(data: ConfirmedMessageData) => void> = new Set();
  private persistFailedListeners: Set<(data: PersistFailedData) => void> = new Set();
  private connectListeners: Set<() => void> = new Set();

  /**
   * Connect to Socket.IO server with the user's session token
   */
  async connect(): Promise<Socket | null> {
    try {
      const { token, cookie } = await getSessionAuth();
      const activeCredential = token || cookie;

      if (!activeCredential) {
        this.disconnect();
        return null;
      }

      // If already connected with this exact credential, safely reuse it
      if (this.socket?.connected && this.currentToken === activeCredential) {
        return this.socket;
      }

      if (this.isConnecting) {
        return null;
      }

      this.isConnecting = true;

      // If credentials changed or socket exists with a stale user session, disconnect it immediately
      if (this.socket) {
        console.log('[SocketService] User changed or stale connection detected, disconnecting previous socket...');
        this.socket.removeAllListeners();
        this.socket.disconnect();
        this.socket = null;
        this.currentToken = null;
      }

      const serverUrl = getOrigin();
      this.currentToken = activeCredential;

      this.socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        withCredentials: true,
        auth: { token },
        extraHeaders: {
          ...(token ? { 'x-session-token': token } : {}),
          ...(cookie && Platform.OS !== 'web' ? { Cookie: cookie } : {}),
        },
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 20,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      this.socket.on('connect', () => {
        console.log('[SocketService] Connected to server:', this.socket?.id);
        // Rejoin conversation if previously joined
        if (this.currentConversationId) {
          this.joinConversation(this.currentConversationId);
        }
        // Flush pending outbound queue on reconnection
        this.flushPendingMessages();
        // Notify connect listeners
        for (const listener of this.connectListeners) {
          try {
            listener();
          } catch (e) {
            console.warn('[SocketService] connectListener error:', e);
          }
        }
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[SocketService] Disconnected:', reason);
      });

      this.socket.on('connect_error', (error) => {
        console.warn('[SocketService] Connection error:', error.message);
      });

      this.socket.on('message_confirmed', (data: ConfirmedMessageData) => {
        if (data?.clientMessageId) {
          this.pendingMessages.delete(data.clientMessageId);
          updateLocalMessageDeliveryStatus(data.clientMessageId, 'sent', data.conversationId).catch((err) => {
            console.warn('[SocketService] Failed to mark message as sent in local db:', err);
          });
        }
        for (const listener of this.confirmedListeners) {
          try {
            listener(data);
          } catch (e) {
            console.error('[SocketService] Error in confirmedListener:', e);
          }
        }
      });

      this.socket.on('message_persist_failed', (data: PersistFailedData) => {
        console.warn('[SocketService] Message persist failed on backend:', data);
        if (data?.clientMessageId) {
          this.pendingMessages.delete(data.clientMessageId);
          updateLocalMessageDeliveryStatus(data.clientMessageId, 'failed', data.conversationId).catch((err) => {
            console.warn('[SocketService] Failed to mark message as failed in local db:', err);
          });
        }
        for (const listener of this.persistFailedListeners) {
          try {
            listener(data);
          } catch (e) {
            console.error('[SocketService] Error in persistFailedListener:', e);
          }
        }
      });

      // Global SQLite cache cleanup for deleted messages across entire app lifecycle
      this.socket.on('message_deleted', (data: { conversationId: string; messageId: string; clientMessageId?: string }) => {
        if (data?.conversationId && (data?.messageId || data?.clientMessageId)) {
          deleteLocalMessage(data.conversationId, data.messageId, data.clientMessageId).catch((err) => {
            console.warn('[SocketService] Failed to delete local message on global event:', err);
          });
        }
      });

      return this.socket;
    } catch (err) {
      console.error('[SocketService] Error during connect:', err);
      return null;
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Flush pending outbound messages across reconnects
   */
  private flushPendingMessages() {
    if (!this.socket?.connected || this.pendingMessages.size === 0) return;
    console.log(`[SocketService] Re-emitting ${this.pendingMessages.size} pending message(s) on reconnect`);
    for (const [clientMessageId, payload] of this.pendingMessages.entries()) {
      try {
        this.socket.emit('send_message', payload);
      } catch (err) {
        console.warn(`[SocketService] Failed to re-emit pending message ${clientMessageId}:`, err);
      }
    }
  }

  /**
   * Check whether socket is connected
   */
  isSocketConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  /**
   * Disconnect the socket
   */
  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.currentToken = null;
    this.currentConversationId = null;
  }

  /**
   * Get raw socket instance
   */
  getSocket(): Socket | null {
    return this.socket;
  }

  /**
   * Join a conversation room
   */
  joinConversation(conversationId: string) {
    this.currentConversationId = conversationId;
    if (this.socket?.connected) {
      this.socket.emit('join_conversation', conversationId);
    }
  }

  /**
   * Leave a conversation room
   */
  leaveConversation(conversationId: string) {
    if (this.currentConversationId === conversationId) {
      this.currentConversationId = null;
    }
    if (this.socket?.connected) {
      this.socket.emit('leave_conversation', conversationId);
    }
  }

  /**
   * Send an encrypted E2EE payload via socket with outbound queueing
   */
  sendEncryptedPayload(payload: OutboundMessagePayload): boolean {
    this.pendingMessages.set(payload.clientMessageId, payload);
    if (this.socket?.connected) {
      this.socket.emit('send_message', payload);
      return true;
    }
    console.warn('[SocketService] Socket not currently connected; message queued for reconnection');
    return false;
  }

  /**
   * Send a real-time message (queued in outbound buffer if disconnected)
   */
  sendMessage(
    conversationId: string,
    content: string,
    type: 'text' | 'image' | 'video' | 'audio' | 'system' = 'text',
    clientMessageId?: string
  ): string {
    const msgId = clientMessageId || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const payload: OutboundMessagePayload = {
      conversationId,
      content,
      type,
      clientMessageId: msgId,
    };
    this.pendingMessages.set(msgId, payload);
    if (this.socket?.connected) {
      this.socket.emit('send_message', payload);
    } else {
      console.warn('[SocketService] Socket not connected, queued message in outbound buffer');
    }
    return msgId;
  }

  /**
   * Subscribe to server message confirmation events
   */
  onMessageConfirmed(callback: (data: ConfirmedMessageData) => void): () => void {
    this.confirmedListeners.add(callback);
    return () => {
      this.confirmedListeners.delete(callback);
    };
  }

  /**
   * Subscribe to message persist failed events
   */
  onMessagePersistFailed(callback: (data: PersistFailedData) => void): () => void {
    this.persistFailedListeners.add(callback);
    return () => {
      this.persistFailedListeners.delete(callback);
    };
  }

  /**
   * Notify that user is typing
   */
  sendTyping(conversationId: string) {
    if (this.socket?.connected) {
      this.socket.emit('typing', conversationId);
    }
  }

  /**
   * Notify that user stopped typing
   */
  sendStopTyping(conversationId: string) {
    if (this.socket?.connected) {
      this.socket.emit('stop_typing', conversationId);
    }
  }

  /**
   * Mark messages as read
   */
  markRead(conversationId: string) {
    try {
      const prefsRaw = appStorage.getItem('chatuk_user_preferences');
      if (prefsRaw) {
        const prefs = JSON.parse(prefsRaw);
        if (prefs.readReceipts === false) {
          return; // Suppress emitting read receipt if user disabled read receipts
        }
      }
    } catch {}

    if (this.socket?.connected) {
      this.socket.emit('mark_read', { conversationId });
    }
  }

  /**
   * Subscribe to new incoming messages
   */
  onNewMessage(callback: (message: SocketMessage) => void): () => void {
    if (!this.socket) return () => {};
    const wrappedCallback = (data: any) => {
      if (data && data.message) {
        // Backend emitted { message, envelope, envelopes }
        const normalized: SocketMessage = {
          ...data.message,
          envelope: data.envelope || data.message.envelope || null,
          envelopes: data.envelopes || data.message.envelopes || null,
        };
        callback(normalized);
      } else if (data) {
        callback(data);
      }
    };
    this.socket.on('new_message', wrappedCallback);
    return () => {
      this.socket?.off('new_message', wrappedCallback);
    };
  }

  /**
   * Subscribe to conversation updates (e.g. for chat list)
   */
  onConversationUpdated(callback: (data: { conversationId: string; lastMessage: SocketMessage; action?: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('conversation_updated', callback);
    return () => {
      this.socket?.off('conversation_updated', callback);
    };
  }

  /**
   * Subscribe to group created events
   */
  onGroupCreated(callback: (data: { conversation: any }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('group_created', callback);
    return () => {
      this.socket?.off('group_created', callback);
    };
  }

  /**
   * Subscribe to group metadata updates
   */
  onGroupUpdated(callback: (data: { conversationId: string; name?: string; description?: string; groupAvatarUrl?: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('group_updated', callback);
    return () => {
      this.socket?.off('group_updated', callback);
    };
  }

  /**
   * Subscribe to member added to group
   */
  onGroupMemberAdded(callback: (data: { conversationId: string; user: any; addedBy: any; participants: any[]; adminIds: string[] }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('group_member_added', callback);
    return () => {
      this.socket?.off('group_member_added', callback);
    };
  }

  /**
   * Subscribe to member removed from group
   */
  onGroupMemberRemoved(callback: (data: { conversationId: string; userId: string; removedBy: any; participants: any[]; adminIds: string[] }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('group_member_removed', callback);
    return () => {
      this.socket?.off('group_member_removed', callback);
    };
  }

  /**
   * Subscribe to group admin role changes
   */
  onGroupAdminChanged(callback: (data: { conversationId: string; userId: string; action: 'promoted' | 'demoted'; adminIds: string[] }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('group_admin_changed', callback);
    return () => {
      this.socket?.off('group_admin_changed', callback);
    };
  }

  /**
   * Subscribe to member leaving group
   */
  onGroupMemberLeft(callback: (data: { conversationId: string; userId: string; newAdminId?: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('group_member_left', callback);
    return () => {
      this.socket?.off('group_member_left', callback);
    };
  }

  /**
   * Subscribe to user typing events
   */
  onUserTyping(callback: (data: TypingData) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('user_typing', callback);
    return () => {
      this.socket?.off('user_typing', callback);
    };
  }

  /**
   * Subscribe to user stopped typing events
   */
  onUserStopTyping(callback: (data: { userId: string; conversationId: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('user_stop_typing', callback);
    return () => {
      this.socket?.off('user_stop_typing', callback);
    };
  }

  /**
   * Subscribe to messages read receipts
   */
  onMessagesRead(callback: (data: { conversationId: string; readBy: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('messages_read', callback);
    return () => {
      this.socket?.off('messages_read', callback);
    };
  }

  /**
   * Subscribe to initial or requested list of online user IDs
   */
  onOnlineUsersList(callback: (userIds: string[]) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('online_users_list', callback);
    return () => {
      this.socket?.off('online_users_list', callback);
    };
  }

  /**
   * Subscribe to real-time status transitions (online/offline) of any user
   */
  onUserStatusChanged(callback: (data: { userId: string; isOnline: boolean; lastActiveAt: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('user_status_changed', callback);
    return () => {
      this.socket?.off('user_status_changed', callback);
    };
  }

  /**
   * Request the current set of online user IDs from the server
   */
  requestOnlineUsers() {
    if (this.socket?.connected) {
      this.socket.emit('get_online_users');
    }
  }

  /**
   * Send an emoji reaction or double-tap heart to a message
   */
  sendReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
    action: 'add' | 'remove' | 'toggle' = 'toggle'
  ): boolean {
    if (this.socket?.connected) {
      this.socket.emit('message_reaction', { conversationId, messageId, emoji, action });
      return true;
    }
    return false;
  }

  /**
   * Subscribe to real-time message reaction updates
   */
  onMessageReactionUpdated(
    callback: (data: { conversationId: string; messageId: string; clientMessageId?: string; reactions: MessageReaction[] }) => void
  ): () => void {
    if (!this.socket) return () => {};
    this.socket.on('message_reaction_updated', callback);
    return () => {
      this.socket?.off('message_reaction_updated', callback);
    };
  }

  /**
   * Subscribe to real-time conversation clear events
   */
  onConversationCleared(callback: (data: { conversationId: string; clearedBy: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('conversation_cleared', callback);
    return () => {
      this.socket?.off('conversation_cleared', callback);
    };
  }

  /**
   * Subscribe to real-time message deleted events
   */
  onMessageDeleted(
    callback: (data: { messageId: string; clientMessageId?: string; conversationId: string; deletedBy: string }) => void
  ): () => void {
    if (!this.socket) return () => {};
    this.socket.on('message_deleted', callback);
    return () => {
      this.socket?.off('message_deleted', callback);
    };
  }

  /**
   * Emit delete_message over socket for real-time deletion
   */
  deleteMessage(messageId: string, conversationId?: string, clientMessageId?: string) {
    if (this.socket?.connected) {
      this.socket.emit('delete_message', { messageId, clientMessageId, conversationId });
    }
  }

  /**
   * Subscribe to error messages from socket
   */
  onErrorMessage(callback: (data: { error: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('error_message', callback);
    return () => {
      this.socket?.off('error_message', callback);
    };
  }

  /**
   * Send heartbeat ping to keep user active timestamp fresh
   */
  sendHeartbeat() {
    if (this.socket?.connected) {
      this.socket.emit('heartbeat');
    }
  }

  /**
   * Subscribe to conversation accepted events
   */
  onConversationAccepted(callback: (data: { conversationId: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('conversation_accepted', callback);
    return () => {
      this.socket?.off('conversation_accepted', callback);
    };
  }

  /**
   * Subscribe to conversation deleted events
   */
  onConversationDeleted(callback: (data: { conversationId: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('conversation_deleted', callback);
    return () => {
      this.socket?.off('conversation_deleted', callback);
    };
  }

  // ─── Voice Call Signaling ───

  initiateCall(calleeId: string, conversationId: string): void {
    if (this.socket?.connected) {
      this.socket.emit('call:initiate', { calleeId, conversationId, type: 'audio' });
    }
  }

  acceptCall(callLogId: string): void {
    if (this.socket?.connected) {
      this.socket.emit('call:accept', { callLogId });
    }
  }

  declineCall(callLogId: string): void {
    if (this.socket?.connected) {
      this.socket.emit('call:decline', { callLogId });
    }
  }

  cancelCall(callLogId: string): void {
    if (this.socket?.connected) {
      this.socket.emit('call:cancel', { callLogId });
    }
  }

  endCall(callLogId: string): void {
    if (this.socket?.connected) {
      this.socket.emit('call:end', { callLogId });
    }
  }

  sendCallOffer(callLogId: string, sdp: any): void {
    if (this.socket?.connected) {
      this.socket.emit('call:offer', { callLogId, sdp });
    }
  }

  sendCallAnswer(callLogId: string, sdp: any): void {
    if (this.socket?.connected) {
      this.socket.emit('call:answer', { callLogId, sdp });
    }
  }

  sendIceCandidate(callLogId: string, candidate: any): void {
    if (this.socket?.connected) {
      this.socket.emit('call:ice-candidate', { callLogId, candidate });
    }
  }

  onCallInitiated(callback: (data: { callLogId: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('call:initiated', callback);
    return () => {
      this.socket?.off('call:initiated', callback);
    };
  }

  onCallIncoming(callback: (data: IncomingCallData) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('call:incoming', callback);
    return () => {
      this.socket?.off('call:incoming', callback);
    };
  }

  onCallAccepted(callback: (data: { callLogId: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('call:accepted', callback);
    return () => {
      this.socket?.off('call:accepted', callback);
    };
  }

  onCallDeclined(callback: (data: { callLogId: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('call:declined', callback);
    return () => {
      this.socket?.off('call:declined', callback);
    };
  }

  onCallCancelled(callback: (data: { callLogId: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('call:cancelled', callback);
    return () => {
      this.socket?.off('call:cancelled', callback);
    };
  }

  onCallEnded(callback: (data: CallEndedData) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('call:ended', callback);
    return () => {
      this.socket?.off('call:ended', callback);
    };
  }

  onCallOffer(callback: (data: CallOfferData) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('call:offer', callback);
    return () => {
      this.socket?.off('call:offer', callback);
    };
  }

  onCallAnswer(callback: (data: CallAnswerData) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('call:answer', callback);
    return () => {
      this.socket?.off('call:answer', callback);
    };
  }

  onCallIceCandidate(callback: (data: CallCandidateData) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('call:ice-candidate', callback);
    return () => {
      this.socket?.off('call:ice-candidate', callback);
    };
  }

  onCallError(callback: (data: { error: string }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('call:error', callback);
    return () => {
      this.socket?.off('call:error', callback);
    };
  }

  /**
   * Subscribe to socket connection / reconnection events
   */
  onConnect(callback: () => void): () => void {
    this.connectListeners.add(callback);
    if (this.socket?.connected) {
      try {
        callback();
      } catch (e) {
        console.warn('[SocketService] immediate connect callback error:', e);
      }
    }
    return () => {
      this.connectListeners.delete(callback);
    };
  }

  /**
   * Subscribe to real-time wallpaper preference updates
   */
  onWallpaperUpdated(callback: (data: { wallpaperId: string; updatedAt: number }) => void): () => void {
    if (!this.socket) return () => {};
    this.socket.on('wallpaper_updated', callback);
    return () => {
      this.socket?.off('wallpaper_updated', callback);
    };
  }

  /**
   * Emit sync_wallpaper event over socket for instant real-time synchronization
   */
  syncWallpaper(wallpaperId: string, updatedAt: number): void {
    if (this.socket?.connected) {
      this.socket.emit('sync_wallpaper', { wallpaperId, updatedAt });
    }
  }
}

export const socketService = new SocketService();

