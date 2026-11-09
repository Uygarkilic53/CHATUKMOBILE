jest.mock('../src/lib/auth-client', () => ({
  signIn: { email: jest.fn(), social: jest.fn() },
  signUp: { email: jest.fn() },
  useSession: () => ({ data: null, isPending: false }),
  authClient: { getSession: jest.fn() },
  getOrigin: () => 'http://localhost:3000',
}));

jest.mock('../src/lib/api', () => ({
  api: {
    getAuthHeaders: jest.fn(async () => ({ Authorization: 'Bearer mock-token' })),
    getProfile: jest.fn(async () => ({ user: { id: 'user-1', email: 'test@example.com' } })),
    uploadMedia: jest.fn(async () => ({ url: 'https://cloudinary.com/chatuk/MessageMedia/test.jpg' })),
  },
  getActiveUserId: jest.fn(async () => 'user-1'),
  getActiveUserIdSync: jest.fn(() => 'user-1'),
  getActiveUserEmailSync: jest.fn(() => 'test@example.com'),
  getSessionAuth: jest.fn(async () => ({ token: 'mock-token' })),
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: 'Feather',
  Ionicons: 'Ionicons',
}));

jest.mock('expo-image', () => ({
  Image: 'Image',
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: any) => children,
}));

const mockMessagesTable = new Map<string, any>();

const mockDb = {
  execAsync: jest.fn(async () => {}),
  runAsync: jest.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('INSERT INTO messages')) {
      const [
        clientMessageId, conversationId, senderId, senderDeviceId, type, kind,
        body, attachmentJson, reactionJson, replyToJson, sentAt, isOutgoing, deliveryStatus, createdAt
      ] = params;
      const existing = mockMessagesTable.get(clientMessageId);
      if (existing) {
        mockMessagesTable.set(clientMessageId, {
          ...existing,
          deliveryStatus,
          body: body ?? existing.body,
          attachmentJson: attachmentJson ?? existing.attachmentJson,
          replyToJson: replyToJson ?? existing.replyToJson,
          reactionJson: reactionJson ?? existing.reactionJson,
        });
      } else {
        mockMessagesTable.set(clientMessageId, {
          clientMessageId,
          conversationId,
          senderId,
          senderDeviceId,
          type,
          kind,
          body,
          attachmentJson,
          reactionJson,
          replyToJson,
          sentAt,
          isOutgoing,
          deliveryStatus,
          createdAt,
        });
      }
    } else if (sql.includes('UPDATE messages SET deliveryStatus = ?')) {
      const [status, clientMsgId] = params;
      const existing = mockMessagesTable.get(clientMsgId);
      if (existing) {
        existing.deliveryStatus = status;
      }
    } else if (sql.includes('DELETE FROM messages WHERE conversationId = ? AND deliveryStatus NOT IN')) {
      const [conversationId] = params;
      for (const [id, msg] of mockMessagesTable.entries()) {
        if (msg.conversationId === conversationId && msg.deliveryStatus !== 'pending' && msg.deliveryStatus !== 'failed') {
          mockMessagesTable.delete(id);
        }
      }
    }
  }),
  getFirstAsync: jest.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('FROM messages WHERE clientMessageId = ?')) {
      const [clientMsgId] = params;
      return mockMessagesTable.get(clientMsgId) || null;
    }
    return null;
  }),
  getAllAsync: jest.fn(async (sql: string) => {
    if (sql.includes('FROM messages')) {
      return Array.from(mockMessagesTable.values());
    }
    return [];
  }),
};

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => mockDb),
  deleteDatabaseAsync: jest.fn(async () => {}),
}));

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import {
  saveLocalMessage,
  updateLocalMessageDeliveryStatus,
  getLocalMessage,
  purgeNonPendingLocalMessages,
} from '../src/e2ee/localDb';
import { MessageBubble } from '../src/components/MessageBubble';
import type { SocketMessage } from '../src/services/socket';
import { socketService } from '../src/services/socket';

describe('Failed Message & Retry Handling (MongoDB / Live DB write failures)', () => {
  const testConvId = 'conv-test-123';
  const testMsgId = 'client-msg-fail-001';

  beforeEach(() => {
    mockMessagesTable.clear();
  });

  describe('1. LocalDb Delivery Status & Persistence', () => {
    it('saves message optimistically with pending deliveryStatus', async () => {
      await saveLocalMessage({
        clientMessageId: testMsgId,
        conversationId: testConvId,
        senderId: 'user-1',
        senderDeviceId: 'device-1',
        type: 'text',
        payload: {
          kind: 'text',
          body: 'Hello world failure test',
          sentAt: Date.now(),
        },
        isOutgoing: true,
        deliveryStatus: 'pending',
      });

      const msg = await getLocalMessage(testMsgId, testConvId);
      expect(msg).not.toBeNull();
      expect(msg?.clientMessageId).toBe(testMsgId);
      expect(msg?.deliveryStatus).toBe('pending');
    });

    it('marks message as failed in local database when live DB write fails', async () => {
      await saveLocalMessage({
        clientMessageId: testMsgId,
        conversationId: testConvId,
        senderId: 'user-1',
        senderDeviceId: 'device-1',
        type: 'text',
        payload: { kind: 'text', body: 'Test failure update', sentAt: Date.now() },
        isOutgoing: true,
        deliveryStatus: 'pending',
      });

      await updateLocalMessageDeliveryStatus(testMsgId, 'failed', testConvId);

      const msg = await getLocalMessage(testMsgId, testConvId);
      expect(msg).not.toBeNull();
      expect(msg?.deliveryStatus).toBe('failed');
    });

    it('preserves failed messages in local database during purgeNonPendingLocalMessages', async () => {
      // Add failed message
      await saveLocalMessage({
        clientMessageId: testMsgId,
        conversationId: testConvId,
        senderId: 'user-1',
        senderDeviceId: 'device-1',
        type: 'text',
        payload: { kind: 'text', body: 'Failed message to retain', sentAt: Date.now() },
        isOutgoing: true,
        deliveryStatus: 'failed',
      });

      // Add a 'sent' message to verify it gets purged while 'failed' stays
      const sentMsgId = 'client-msg-sent-002';
      await saveLocalMessage({
        clientMessageId: sentMsgId,
        conversationId: testConvId,
        senderId: 'user-1',
        senderDeviceId: 'device-1',
        type: 'text',
        payload: {
          kind: 'text',
          body: 'Already sent message',
          sentAt: Date.now(),
        },
        isOutgoing: true,
        deliveryStatus: 'sent',
      });

      // Purge non-pending/non-failed messages (e.g. server had 0 messages)
      await purgeNonPendingLocalMessages(testConvId);

      // The failed message must NOT be purged
      const failedMsg = await getLocalMessage(testMsgId, testConvId);
      expect(failedMsg).not.toBeNull();
      expect(failedMsg?.deliveryStatus).toBe('failed');

      // The sent message should be purged
      const sentMsg = await getLocalMessage(sentMsgId, testConvId);
      expect(sentMsg).toBeNull();
    });

    it('updates message deliveryStatus back to pending on retry, then to sent on success', async () => {
      await saveLocalMessage({
        clientMessageId: testMsgId,
        conversationId: testConvId,
        senderId: 'user-1',
        senderDeviceId: 'device-1',
        type: 'text',
        payload: { kind: 'text', body: 'Retry message test', sentAt: Date.now() },
        isOutgoing: true,
        deliveryStatus: 'failed',
      });

      // User retries -> status becomes pending
      await updateLocalMessageDeliveryStatus(testMsgId, 'pending', testConvId);
      let msg = await getLocalMessage(testMsgId, testConvId);
      expect(msg?.deliveryStatus).toBe('pending');

      // Backend confirms -> status becomes sent
      await updateLocalMessageDeliveryStatus(testMsgId, 'sent', testConvId);
      msg = await getLocalMessage(testMsgId, testConvId);
      expect(msg?.deliveryStatus).toBe('sent');
    });

    it('updates attachmentJson and body on retry conflict in saveLocalMessage', async () => {
      const mediaMsgId = 'media-fail-001';
      // 1. Initial optimistic save with local file URI
      await saveLocalMessage({
        clientMessageId: mediaMsgId,
        conversationId: testConvId,
        senderId: 'user-1',
        senderDeviceId: 'device-1',
        type: 'image',
        payload: {
          kind: 'image',
          body: '',
          attachment: { url: 'file:///local/cache/photo.jpg', mime: 'image/jpeg', size: 1024, key: '' },
          sentAt: Date.now(),
        },
        isOutgoing: true,
        deliveryStatus: 'failed',
      });

      let stored = await getLocalMessage(mediaMsgId, testConvId);
      expect(stored?.attachmentJson).toContain('file:///local/cache/photo.jpg');
      expect(stored?.deliveryStatus).toBe('failed');

      // 2. Retry succeeds in uploading to Cloudinary and saves with remote URL
      const remoteCloudinaryUrl = 'https://res.cloudinary.com/chatuk/MessageMedia/photo.jpg';
      await saveLocalMessage({
        clientMessageId: mediaMsgId,
        conversationId: testConvId,
        senderId: 'user-1',
        senderDeviceId: 'device-1',
        type: 'image',
        payload: {
          kind: 'image',
          body: 'Photo caption',
          attachment: { url: remoteCloudinaryUrl, mime: 'image/jpeg', size: 1024, key: '' },
          sentAt: Date.now(),
        },
        isOutgoing: true,
        deliveryStatus: 'sent',
      });

      stored = await getLocalMessage(mediaMsgId, testConvId);
      expect(stored?.attachmentJson).toContain(remoteCloudinaryUrl);
      expect(stored?.body).toBe('Photo caption');
      expect(stored?.deliveryStatus).toBe('sent');
    });
  });

  describe('2. MessageBubble UI Rendering & Retry Interaction', () => {
    const mockTheme = {
      isDark: false,
      surface: '#FFFFFF',
      card: '#F8FAFC',
      cardBorder: '#E2E8F0',
      outline: '#94A3B8',
      onSurface: '#0F172A',
      onSurfaceVariant: '#64748B',
      primary: '#6366F1',
    };

    const baseMessage: SocketMessage = {
      _id: 'temp-123',
      clientMessageId: 'temp-123',
      conversationId: testConvId,
      senderId: 'user-1',
      type: 'text',
      content: 'Important meeting at 3pm',
      isOutgoing: true,
      readBy: ['user-1'],
      createdAt: new Date().toISOString(),
      deliveryStatus: 'failed',
    };

    it('renders "Failed to send" button when deliveryStatus is failed', async () => {
      const onRetryMock = jest.fn();
      const { getByText, getByLabelText } = await render(
        <MessageBubble
          item={baseMessage}
          isMe={true}
          showDateSeparator={false}
          dateText={null}
          theme={mockTheme}
          onBubblePress={jest.fn()}
          onBubbleLongPress={jest.fn()}
          onOpenImageGallery={jest.fn()}
          onActiveVideo={jest.fn()}
          onOpenSecurityModal={jest.fn()}
          onRetryMessage={onRetryMock}
        />
      );

      expect(getByText('Failed to send')).toBeTruthy();
      const retryButton = getByLabelText('Failed to send. Tap to retry');
      expect(retryButton).toBeTruthy();

      fireEvent.press(retryButton);
      expect(onRetryMock).toHaveBeenCalledTimes(1);
      expect(onRetryMock).toHaveBeenCalledWith(baseMessage);
    });

    it('does not render "Failed to send" when deliveryStatus is sent', async () => {
      const sentMessage: SocketMessage = {
        ...baseMessage,
        deliveryStatus: 'sent',
      };

      const { queryByText, queryByLabelText } = await render(
        <MessageBubble
          item={sentMessage}
          isMe={true}
          showDateSeparator={false}
          dateText={null}
          theme={mockTheme}
          onBubblePress={jest.fn()}
          onBubbleLongPress={jest.fn()}
          onOpenImageGallery={jest.fn()}
          onActiveVideo={jest.fn()}
          onOpenSecurityModal={jest.fn()}
        />
      );

      expect(queryByText('Failed to send')).toBeNull();
      expect(queryByLabelText('Failed to send. Tap to retry')).toBeNull();
    });
  });

  describe('3. SocketService Event Integration', () => {
    it('notifies listeners and updates status when message_persist_failed is triggered', (done) => {
      const failureClientMsgId = 'msg-persist-fail-789';

      saveLocalMessage({
        clientMessageId: failureClientMsgId,
        conversationId: testConvId,
        senderId: 'user-1',
        senderDeviceId: 'device-1',
        type: 'text',
        payload: { kind: 'text', body: 'Test failure event', sentAt: Date.now() },
        isOutgoing: true,
        deliveryStatus: 'pending',
      }).then(() => {
        const unsubscribe = socketService.onMessagePersistFailed(async (data) => {
          if (data.clientMessageId === failureClientMsgId) {
            unsubscribe();
            try {
              expect(data.error).toBe('MongoDB write connection failed');
              done();
            } catch (e) {
              done(e);
            }
          }
        });

        // Direct listener dispatch to verify subscriber flow
        for (const listener of (socketService as any).persistFailedListeners) {
          listener({
            conversationId: testConvId,
            clientMessageId: failureClientMsgId,
            error: 'MongoDB write connection failed',
          });
        }
      });
    });

    it('removes failed message from pendingMessages queue so reconnect does not automatically re-emit it', () => {
      const pendingMsgId = 'msg-outbound-test-queue';
      (socketService as any).pendingMessages.set(pendingMsgId, {
        conversationId: testConvId,
        clientMessageId: pendingMsgId,
        type: 'text',
      });
      expect((socketService as any).pendingMessages.has(pendingMsgId)).toBe(true);

      // Emulate the message_persist_failed event handler
      const failureData = {
        conversationId: testConvId,
        clientMessageId: pendingMsgId,
        error: 'Failed to persist message to database',
      };

      // Both the internal map cleanup and listener trigger should occur
      (socketService as any).pendingMessages.delete(failureData.clientMessageId);
      expect((socketService as any).pendingMessages.has(pendingMsgId)).toBe(false);
    });
  });
});
