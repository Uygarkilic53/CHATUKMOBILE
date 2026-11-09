jest.mock('../src/lib/auth-client', () => ({
  signIn: {
    email: jest.fn(),
    social: jest.fn(),
  },
  signUp: {
    email: jest.fn(),
  },
  useSession: () => ({
    data: null,
    isPending: false,
  }),
  authClient: {
    getSession: jest.fn(),
  },
}));

import * as SQLite from 'expo-sqlite';
import {
  getCachedConversations,
  upsertCachedConversation,
  upsertCachedConversationsBatch,
  updateCachedConversationMetadata,
  updateCachedConversationLastMessage,
  deleteCachedConversation,
  deleteLocalConversation,
  wipeLocalDb,
  ConversationItem,
  CachedConversationRecord,
} from '../src/e2ee/localDb';
import { appStorage } from '../src/lib/storage';

const mockCachedConversations = new Map<string, CachedConversationRecord>();
const mockMessages = new Map<string, any>();
const mockConversationCache = new Map<string, any>();

const mockDb = {
  execAsync: jest.fn(async (sql: string) => {
    if (sql.includes('DROP TABLE IF EXISTS cached_conversations')) {
      mockCachedConversations.clear();
    }
  }),
  getAllAsync: jest.fn(async (query: string, params: any[] = []) => {
    if (query.includes('FROM cached_conversations')) {
      const [userId] = params;
      const rows = Array.from(mockCachedConversations.values()).filter(
        (r) => r.userId === userId
      );
      return rows.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    }
    return [];
  }),
  runAsync: jest.fn(async (query: string, params: any[] = []) => {
    if (query.includes('INSERT INTO cached_conversations')) {
      const [
        conversationId,
        userId,
        type,
        name,
        description,
        adminIds,
        groupAvatarUrl,
        groupAvatarPublicId,
        status,
        initiatorId,
        participantsJson,
        lastMessageJson,
        unreadCount,
        createdAt,
        updatedAt,
      ] = params;
      const key = `${userId}_${conversationId}`;
      mockCachedConversations.set(key, {
        conversationId,
        userId,
        type,
        name,
        description,
        adminIds,
        groupAvatarUrl,
        groupAvatarPublicId,
        status,
        initiatorId,
        participantsJson,
        lastMessageJson,
        unreadCount,
        createdAt,
        updatedAt,
      });
    } else if (query.includes('UPDATE cached_conversations')) {
      if (query.includes('unreadCount = ?')) {
        const [lastMessageJson, effectiveUpdatedAt, forceUnread, userId, conversationId] = params;
        const key = `${userId}_${conversationId}`;
        const existing = mockCachedConversations.get(key);
        if (existing) {
          mockCachedConversations.set(key, {
            ...existing,
            lastMessageJson,
            updatedAt: effectiveUpdatedAt,
            unreadCount: forceUnread,
          });
        }
      } else if (query.includes('unreadCount = MAX(0, unreadCount + ?)')) {
        const [lastMessageJson, effectiveUpdatedAt, unreadDelta, userId, conversationId] = params;
        const key = `${userId}_${conversationId}`;
        const existing = mockCachedConversations.get(key);
        if (existing) {
          mockCachedConversations.set(key, {
            ...existing,
            lastMessageJson,
            updatedAt: effectiveUpdatedAt,
            unreadCount: Math.max(0, existing.unreadCount + unreadDelta),
          });
        }
      } else if (query.includes('name = ?')) {
        const [name, description, groupAvatarUrl, userId, conversationId] = params;
        const key = `${userId}_${conversationId}`;
        const existing = mockCachedConversations.get(key);
        if (existing) {
          mockCachedConversations.set(key, {
            ...existing,
            name,
            description,
            groupAvatarUrl,
          });
        }
      } else if (query.includes('status = ?')) {
        const [status, userId, conversationId] = params;
        const key = `${userId}_${conversationId}`;
        const existing = mockCachedConversations.get(key);
        if (existing) {
          mockCachedConversations.set(key, {
            ...existing,
            status,
          });
        }
      } else if (query.includes('unreadCount = ?') || query.includes('SET unreadCount = ?')) {
        const [unreadCount, userId, conversationId] = params;
        const key = `${userId}_${conversationId}`;
        const existing = mockCachedConversations.get(key);
        if (existing) {
          mockCachedConversations.set(key, {
            ...existing,
            unreadCount,
          });
        }
      }
    } else if (query.includes('DELETE FROM cached_conversations')) {
      if (params.length === 2) {
        const [conversationId, userId] = params;
        mockCachedConversations.delete(`${userId}_${conversationId}`);
      } else if (params.length === 1) {
        const [conversationId] = params;
        for (const [k, v] of mockCachedConversations.entries()) {
          if (v.conversationId === conversationId) {
            mockCachedConversations.delete(k);
          }
        }
      }
    } else if (query.includes('DELETE FROM messages')) {
      const [conversationId] = params;
      mockMessages.delete(conversationId);
    } else if (query.includes('DELETE FROM conversation_cache')) {
      const [conversationId] = params;
      mockConversationCache.delete(conversationId);
    }
  }),
  withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => {
    await cb();
  }),
  closeAsync: jest.fn(async () => {}),
};

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => mockDb),
  deleteDatabaseAsync: jest.fn(async () => {}),
}));

describe('SQLite Conversation Cache Architecture', () => {
  const user1 = 'usr_alice_123';
  const user2 = 'usr_bob_456';

  const sampleConversations: ConversationItem[] = [
    {
      _id: 'conv_1',
      type: 'direct',
      participants: [
        { _id: user1, name: 'Alice', email: 'alice@test.com', image: null },
        { _id: user2, name: 'Bob', email: 'bob@test.com', image: 'https://example.com/bob.png' },
      ],
      lastMessage: {
        _id: 'msg_101',
        senderId: user2,
        type: 'text',
        content: 'Hey Alice! Offline test message',
        createdAt: '2026-10-31T18:00:00.000Z',
      },
      unreadCount: 1,
      createdAt: '2026-10-30T10:00:00.000Z',
      updatedAt: '2026-10-31T18:00:00.000Z',
      status: 'accepted',
    },
    {
      _id: 'conv_2',
      type: 'group',
      name: 'Mobile Core Team',
      description: 'Expo SDK 58 discussion',
      adminIds: [user1],
      groupAvatarUrl: 'https://example.com/group.png',
      participants: [
        { _id: user1, name: 'Alice', email: 'alice@test.com', image: null },
        { _id: user2, name: 'Bob', email: 'bob@test.com', image: null },
      ],
      lastMessage: {
        _id: 'msg_102',
        senderId: user1,
        type: 'image',
        content: '📷 Photo',
        createdAt: '2026-10-31T19:00:00.000Z',
      },
      unreadCount: 0,
      createdAt: '2026-10-29T12:00:00.000Z',
      updatedAt: '2026-10-31T19:00:00.000Z',
      status: 'accepted',
    },
  ];

  beforeEach(() => {
    mockCachedConversations.clear();
    mockMessages.clear();
    mockConversationCache.clear();
    jest.clearAllMocks();
  });

  test('Batch upsert and retrieve cached conversations with descending chronological order', async () => {
    await upsertCachedConversationsBatch(sampleConversations, user1);

    expect(mockDb.runAsync).toHaveBeenCalled();

    const cached = await getCachedConversations(user1);
    expect(cached).toHaveLength(2);

    // Verify chronological order (conv_2 updatedAt 19:00 is more recent than conv_1 18:00)
    expect(cached[0]._id).toBe('conv_2');
    expect(cached[0].name).toBe('Mobile Core Team');
    expect(cached[0].lastMessage?.content).toBe('📷 Photo');
    expect(cached[0].adminIds).toEqual([user1]);

    expect(cached[1]._id).toBe('conv_1');
    expect(cached[1].lastMessage?.content).toBe('Hey Alice! Offline test message');
    expect(cached[1].unreadCount).toBe(1);
  });

  test('Multi-user isolation: User 2 cannot access User 1 cached conversations', async () => {
    await upsertCachedConversationsBatch(sampleConversations, user1);

    const user2Chats = await getCachedConversations(user2);
    expect(user2Chats).toHaveLength(0);

    const user1Chats = await getCachedConversations(user1);
    expect(user1Chats).toHaveLength(2);
  });

  test('Single upsert from real-time socket new message', async () => {
    await upsertCachedConversationsBatch(sampleConversations, user1);

    const updatedConv1: ConversationItem = {
      ...sampleConversations[0],
      lastMessage: {
        _id: 'msg_103',
        senderId: user2,
        type: 'text',
        content: 'Just arrived at the cafe!',
        createdAt: '2026-10-31T20:00:00.000Z',
      },
      updatedAt: '2026-10-31T20:00:00.000Z',
      unreadCount: 2,
    };

    await upsertCachedConversation(updatedConv1, user1);

    const cached = await getCachedConversations(user1);
    // conv_1 should now be at index 0 because 20:00 > 19:00
    expect(cached[0]._id).toBe('conv_1');
    expect(cached[0].lastMessage?.content).toBe('Just arrived at the cafe!');
    expect(cached[0].unreadCount).toBe(2);
  });

  test('Metadata update (group title, description, avatar)', async () => {
    await upsertCachedConversationsBatch(sampleConversations, user1);

    await updateCachedConversationMetadata('conv_2', user1, {
      name: 'Mobile Core Team V2',
      description: 'Updated description',
      groupAvatarUrl: 'https://example.com/new-avatar.png',
    });

    const cached = await getCachedConversations(user1);
    const group = cached.find((c) => c._id === 'conv_2');
    expect(group?.name).toBe('Mobile Core Team V2');
    expect(group?.description).toBe('Updated description');
    expect(group?.groupAvatarUrl).toBe('https://example.com/new-avatar.png');
  });

  test('Read receipt clears unread badge in SQLite', async () => {
    await upsertCachedConversationsBatch(sampleConversations, user1);

    await updateCachedConversationLastMessage({
      conversationId: 'conv_1',
      userId: user1,
      lastMessage: sampleConversations[0].lastMessage,
      forceUnread: 0,
    });

    const cached = await getCachedConversations(user1);
    const conv1 = cached.find((c) => c._id === 'conv_1');
    expect(conv1?.unreadCount).toBe(0);
  });

  test('Delete cached conversation removes row scoped by conversationId and userId', async () => {
    await upsertCachedConversationsBatch(sampleConversations, user1);

    await deleteCachedConversation('conv_1', user1);

    const cached = await getCachedConversations(user1);
    expect(cached).toHaveLength(1);
    expect(cached[0]._id).toBe('conv_2');
  });

  test('deleteLocalConversation wipes cached_conversations, messages and snippets', async () => {
    await upsertCachedConversationsBatch(sampleConversations, user1);

    await deleteLocalConversation('conv_2');

    const cached = await getCachedConversations(user1);
    expect(cached.find((c) => c._id === 'conv_2')).toBeUndefined();
  });

  test('wipeLocalDb clears cached_conversations table on account logout', async () => {
    await upsertCachedConversationsBatch(sampleConversations, user1);
    expect(mockCachedConversations.size).toBeGreaterThan(0);

    await wipeLocalDb();
    expect(mockCachedConversations.size).toBe(0);
  });

  test('Web fallback: saves and retrieves cached conversations via appStorage when SQLite is unavailable', async () => {
    (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValueOnce(null);

    // Call closeLocalDb or wipeLocalDb to reset dbInstance
    await wipeLocalDb();

    // Now with db as null:
    await upsertCachedConversationsBatch(sampleConversations, user1);

    const cached = await getCachedConversations(user1);
    expect(cached).toHaveLength(2);
    expect(cached[0]._id).toBe('conv_2');
    expect(cached[1]._id).toBe('conv_1');
  });
});
