/**
 * Encrypted local database using expo-sqlite and SQLCipher on native,
 * with resilient persistent appStorage fallback on Web.
 * Stores decrypted messages and TOFU pinned keys securely on the device.
 * Follows E2EE_IMPLEMENTATION_SPEC.md Section 6.3.
 */
import * as SQLite from 'expo-sqlite';
import { PlainPayload } from '../crypto/E2EECipher';
import { appStorage } from '../lib/storage';
import { getActiveUserId } from '../lib/api';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let isDbAvailable: boolean | null = null;

export interface StoredMessage {
  id?: number;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  senderDeviceId: string;
  type: string;
  kind: string;
  body?: string;
  attachmentJson?: string;
  reactionJson?: string;
  replyToJson?: string;
  sentAt: number;
  isOutgoing: number; // 1 = sent by me, 0 = received
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  createdAt: number;
}

export interface PinnedIdentityKey {
  userId: string;
  signPublicKey: string;
  boxPublicKey: string;
  firstSeenAt: number;
  lastVerifiedAt?: number;
  securityCodeAcknowledged: number;
}

export interface ConversationSnippet {
  conversationId: string;
  lastMessageId: string;
  lastMessageSnippet: string;
  lastMessageTimestamp: number;
  unreadCount: number;
}

const WEB_STORAGE_PREFIX = 'chatuk_localdb_';

async function getWebKey(conversationId: string): Promise<string> {
  const uid = await getActiveUserId().catch(() => null);
  const userScope = uid ? `${uid}_` : '';
  return `${WEB_STORAGE_PREFIX}${userScope}msgs_${conversationId}`;
}

async function getWebMessages(conversationId: string): Promise<StoredMessage[]> {
  try {
    const key = await getWebKey(conversationId);
    const raw = await appStorage.getItemAsync(key);
    if (!raw) return [];
    const parsed: StoredMessage[] = JSON.parse(raw);
    const seen = new Set<string>();
    const deduplicated: StoredMessage[] = [];
    for (const m of parsed) {
      const id = m.clientMessageId || `${m.sentAt}_${m.createdAt}`;
      if (!seen.has(id)) {
        seen.add(id);
        deduplicated.push(m);
      }
    }
    return deduplicated;
  } catch {
    return [];
  }
}

async function saveWebMessage(msg: StoredMessage): Promise<void> {
  try {
    const list = await getWebMessages(msg.conversationId);
    // Remove any prior occurrences with the same clientMessageId to prevent duplicate entries
    const filtered = list.filter((m) => m.clientMessageId !== msg.clientMessageId);
    filtered.push(msg);
    filtered.sort((a, b) => (a.createdAt || a.sentAt) - (b.createdAt || b.sentAt));
    const key = await getWebKey(msg.conversationId);
    await appStorage.setItemAsync(key, JSON.stringify(filtered));

    // Update conversation snippet cache
    const cacheRaw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`);
    const cacheMap: Record<string, ConversationSnippet> = cacheRaw ? JSON.parse(cacheRaw) : {};
    const snippet = msg.kind === 'text'
      ? (msg.body || '')
      : (msg.kind === 'image' ? '📷 Photo' : (msg.kind === 'video' ? '🎥 Video' : `[${msg.kind}]`));
    cacheMap[msg.conversationId] = {
      conversationId: msg.conversationId,
      lastMessageId: msg.clientMessageId,
      lastMessageSnippet: snippet,
      lastMessageTimestamp: msg.createdAt,
      unreadCount: msg.isOutgoing ? 0 : 1,
    };
    await appStorage.setItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`, JSON.stringify(cacheMap));
  } catch (err) {
    console.warn('[LocalDb] Failed to save web message:', err);
  }
}

let dbQueue: Promise<any> = Promise.resolve();

/**
 * Serializes all SQLite operations through a strict FIFO promise queue.
 * Prevents concurrent Swift @JS(.concurrent) background thread collisions on native sqlite3* pointer.
 */
export function runDbExclusive<T>(op: () => Promise<T>): Promise<T> {
  const next = dbQueue.then(op, op);
  dbQueue = next.catch(() => {});
  return next;
}

let dbInitPromise: Promise<SQLite.SQLiteDatabase | null> | null = null;

export async function getLocalDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (dbInstance) {
    return dbInstance;
  }
  if (isDbAvailable === false) {
    return null;
  }
  if (dbInitPromise) {
    return dbInitPromise;
  }

  dbInitPromise = (async () => {
    try {
      let db: SQLite.SQLiteDatabase;

      try {
        db = await SQLite.openDatabaseAsync('chatuk_v3.db');
        await db.execAsync(`PRAGMA foreign_keys = ON;`);
      } catch (openErr) {
        console.warn('[LocalDb] Error initializing clean DB, recreating:', openErr);
        try {
          await SQLite.deleteDatabaseAsync('chatuk_v3.db');
        } catch {}
        db = await SQLite.openDatabaseAsync('chatuk_v3.db');
        await db.execAsync(`PRAGMA foreign_keys = ON;`);
      }

      // Initialize database schema
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          clientMessageId TEXT UNIQUE NOT NULL,
          conversationId TEXT NOT NULL,
          senderId TEXT NOT NULL,
          senderDeviceId TEXT NOT NULL,
          type TEXT NOT NULL,
          kind TEXT NOT NULL,
          body TEXT,
          attachmentJson TEXT,
          reactionJson TEXT,
          replyToJson TEXT,
          sentAt INTEGER NOT NULL,
          isOutgoing INTEGER NOT NULL,
          deliveryStatus TEXT NOT NULL DEFAULT 'sent',
          createdAt INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conversation 
          ON messages(conversationId, createdAt DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_client_id 
          ON messages(clientMessageId);

        CREATE TABLE IF NOT EXISTS identity_keys (
          userId TEXT PRIMARY KEY NOT NULL,
          signPublicKey TEXT NOT NULL,
          boxPublicKey TEXT NOT NULL,
          firstSeenAt INTEGER NOT NULL,
          lastVerifiedAt INTEGER,
          securityCodeAcknowledged INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS conversation_cache (
          conversationId TEXT PRIMARY KEY NOT NULL,
          lastMessageId TEXT,
          lastMessageSnippet TEXT,
          lastMessageTimestamp INTEGER NOT NULL DEFAULT 0,
          unreadCount INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS wallpapers_cache (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          aesthetic TEXT,
          dominantColor TEXT,
          assetType TEXT NOT NULL,
          remoteUrl TEXT,
          localUri TEXT,
          bundledSourceKey TEXT,
          fileSizeBytes INTEGER DEFAULT 0,
          isAvailableOffline INTEGER NOT NULL DEFAULT 1,
          version INTEGER NOT NULL DEFAULT 1,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_wallpapers_category 
          ON wallpapers_cache(category);

        CREATE INDEX IF NOT EXISTS idx_wallpapers_offline 
          ON wallpapers_cache(isAvailableOffline);

        CREATE TABLE IF NOT EXISTS wallpaper_settings (
          userId TEXT NOT NULL,
          scope TEXT NOT NULL,
          wallpaperId TEXT NOT NULL,
          syncStatus TEXT NOT NULL DEFAULT 'synced',
          updatedAt INTEGER NOT NULL,
          lastSyncedAt INTEGER,
          PRIMARY KEY (userId, scope),
          FOREIGN KEY (wallpaperId) REFERENCES wallpapers_cache(id) ON DELETE RESTRICT
        );

        CREATE INDEX IF NOT EXISTS idx_wallpaper_pending_sync 
          ON wallpaper_settings(syncStatus);

        CREATE TABLE IF NOT EXISTS cached_conversations (
          conversationId TEXT NOT NULL,
          userId TEXT NOT NULL,
          type TEXT NOT NULL,
          name TEXT,
          description TEXT,
          adminIds TEXT,
          groupAvatarUrl TEXT,
          groupAvatarPublicId TEXT,
          status TEXT NOT NULL DEFAULT 'accepted',
          initiatorId TEXT,
          participantsJson TEXT NOT NULL,
          lastMessageJson TEXT,
          unreadCount INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL,
          PRIMARY KEY (userId, conversationId)
        );

        CREATE INDEX IF NOT EXISTS idx_cached_conv_user_updated 
          ON cached_conversations(userId, updatedAt DESC);
      `);

      // Clean up legacy corrupted database in background without blocking
      SQLite.deleteDatabaseAsync('chatuk_encrypted.db').catch(() => {});

      dbInstance = db;
      isDbAvailable = true;
      return dbInstance;
    } catch (err) {
      console.warn('[LocalDb] SQLite not available in current environment:', err);
      isDbAvailable = false;
      return null;
    } finally {
      dbInitPromise = null;
    }
  })();

  return dbInitPromise;
}

/**
 * Saves a decrypted message to the encrypted local database or web storage fallback.
 */
export async function saveLocalMessage(msg: {
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  senderDeviceId: string;
  type?: string;
  payload: PlainPayload;
  isOutgoing: boolean;
  deliveryStatus?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  reactions?: any[];
  createdAt?: number;
}): Promise<void> {
  return runDbExclusive(async () => {
    const now = Date.now();
    const messageCreatedAt = msg.createdAt || msg.payload?.sentAt || now;
    const body = msg.payload.body || '';
    const attachmentJson = msg.payload.attachment ? JSON.stringify(msg.payload.attachment) : null;
    const reactionJson = msg.reactions && msg.reactions.length > 0
      ? JSON.stringify(msg.reactions)
      : (msg.payload.reaction ? JSON.stringify(msg.payload.reaction) : null);
    const replyToJson = msg.payload.replyTo ? JSON.stringify(msg.payload.replyTo) : null;

    try {
      const db = await getLocalDb();
      if (!db) {
        await saveWebMessage({
          clientMessageId: msg.clientMessageId,
          conversationId: msg.conversationId,
          senderId: msg.senderId,
          senderDeviceId: msg.senderDeviceId,
          type: msg.type || 'text',
          kind: msg.payload.kind,
          body,
          attachmentJson: attachmentJson || undefined,
          reactionJson: reactionJson || undefined,
          replyToJson: replyToJson || undefined,
          sentAt: msg.payload.sentAt || messageCreatedAt,
          isOutgoing: msg.isOutgoing ? 1 : 0,
          deliveryStatus: msg.deliveryStatus || 'sent',
          createdAt: messageCreatedAt,
        });
        return;
      }

      await db.runAsync(
        `INSERT INTO messages (
          clientMessageId, conversationId, senderId, senderDeviceId, type, kind,
          body, attachmentJson, reactionJson, replyToJson, sentAt, isOutgoing, deliveryStatus, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clientMessageId) DO UPDATE SET
          deliveryStatus = excluded.deliveryStatus,
          body = COALESCE(excluded.body, messages.body),
          attachmentJson = COALESCE(excluded.attachmentJson, messages.attachmentJson),
          replyToJson = COALESCE(excluded.replyToJson, messages.replyToJson),
          reactionJson = COALESCE(excluded.reactionJson, messages.reactionJson);`,
        [
          msg.clientMessageId || `msg_${now}`,
          msg.conversationId || '',
          msg.senderId || '',
          msg.senderDeviceId || 'unknown',
          msg.type || 'text',
          msg.payload?.kind || 'text',
          body ?? null,
          attachmentJson ?? null,
          reactionJson ?? null,
          replyToJson ?? null,
          msg.payload?.sentAt || messageCreatedAt,
          msg.isOutgoing ? 1 : 0,
          msg.deliveryStatus || 'sent',
          messageCreatedAt,
        ]
      );

      // Update conversation preview cache
      const snippet = msg.payload?.kind === 'text'
        ? body
        : (msg.payload?.kind === 'image' || msg.type === 'image'
          ? '📷 Photo'
          : (msg.payload?.kind === 'video' || msg.type === 'video'
            ? '🎥 Video'
            : `[${msg.payload?.kind || msg.type || 'message'}]`));
      await db.runAsync(
        `INSERT INTO conversation_cache (conversationId, lastMessageId, lastMessageSnippet, lastMessageTimestamp, unreadCount)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(conversationId) DO UPDATE SET
           lastMessageId = excluded.lastMessageId,
           lastMessageSnippet = excluded.lastMessageSnippet,
           lastMessageTimestamp = excluded.lastMessageTimestamp;`,
        [msg.conversationId || '', msg.clientMessageId || '', snippet || '', messageCreatedAt, msg.isOutgoing ? 0 : 1]
      );
    } catch (err) {
      console.warn('[LocalDb] Failed to save local message:', err);
    }
  });
}

/**
 * Fetches the most recent messages for a conversation ordered chronologically from oldest to newest.
 */
export async function getConversationMessages(
  conversationId: string,
  limit = 50,
  offset = 0
): Promise<StoredMessage[]> {
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) {
        const all = await getWebMessages(conversationId);
        // all is in chronological order (oldest to newest)
        const total = all.length;
        const end = Math.max(0, total - offset);
        const start = Math.max(0, end - limit);
        return all.slice(start, end);
      }

      return await db.getAllAsync<StoredMessage>(
        `SELECT * FROM (
           SELECT * FROM messages 
           WHERE conversationId = ? 
           ORDER BY createdAt DESC 
           LIMIT ? OFFSET ?
         ) ORDER BY createdAt ASC;`,
        [conversationId, limit, offset]
      );
    } catch (err) {
      console.warn('[LocalDb] Failed to get conversation messages:', err);
      return [];
    }
  });
}

/**
 * Performs offline full-text search across local decrypted messages.
 */
export async function searchLocalMessages(
  query: string,
  conversationId?: string
): Promise<StoredMessage[]> {
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) {
        const lower = query.toLowerCase();
        if (conversationId) {
          const msgs = await getWebMessages(conversationId);
          return msgs.filter((m) => (m.body || '').toLowerCase().includes(lower));
        }
        return [];
      }

      const searchPattern = `%${query}%`;
      if (conversationId) {
        return await db.getAllAsync<StoredMessage>(
          `SELECT * FROM messages 
           WHERE conversationId = ? AND body LIKE ? 
           ORDER BY createdAt DESC LIMIT 50;`,
          [conversationId, searchPattern]
        );
      }
      return await db.getAllAsync<StoredMessage>(
        `SELECT * FROM messages 
         WHERE body LIKE ? 
         ORDER BY createdAt DESC LIMIT 50;`,
        [searchPattern]
      );
    } catch (err) {
      console.warn('[LocalDb] Failed to search local messages:', err);
      return [];
    }
  });
}

/**
 * Retrieves all conversation previews/snippets from local storage cache.
 */
export async function getConversationSnippets(): Promise<Map<string, ConversationSnippet>> {
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) {
        const cacheRaw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`);
        const cacheMap: Record<string, ConversationSnippet> = cacheRaw ? JSON.parse(cacheRaw) : {};
        const map = new Map<string, ConversationSnippet>();
        for (const [k, v] of Object.entries(cacheMap)) {
          map.set(k, v);
        }
        return map;
      }

      const rows = await db.getAllAsync<ConversationSnippet>(`SELECT * FROM conversation_cache;`);
      const map = new Map<string, ConversationSnippet>();
      for (const row of rows) {
        map.set(row.conversationId, row);
      }
      return map;
    } catch (err) {
      console.warn('[LocalDb] Failed to get conversation snippets:', err);
      return new Map();
    }
  });
}

/**
 * Restores a batch of messages from a decrypted backup into the local database.
 */
export async function restoreMessagesBatch(messages: StoredMessage[]): Promise<number> {
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) {
        let count = 0;
        for (const msg of messages) {
          await saveWebMessage(msg);
          count++;
        }
        return count;
      }

      let count = 0;
      for (const msg of messages) {
        await db.runAsync(
          `INSERT INTO messages (
            clientMessageId, conversationId, senderId, senderDeviceId, type, kind,
            body, attachmentJson, reactionJson, replyToJson, sentAt, isOutgoing, deliveryStatus, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(clientMessageId) DO UPDATE SET
            deliveryStatus = excluded.deliveryStatus,
            reactionJson = excluded.reactionJson;`,
          [
            msg.clientMessageId,
            msg.conversationId,
            msg.senderId,
            msg.senderDeviceId,
            msg.type,
            msg.kind,
            msg.body || '',
            msg.attachmentJson || null,
            msg.reactionJson || null,
            msg.replyToJson || null,
            msg.sentAt,
            msg.isOutgoing,
            msg.deliveryStatus,
            msg.createdAt,
          ]
        );

        const snippet = msg.kind === 'text' ? (msg.body || '') : `[${msg.kind}]`;
        await db.runAsync(
          `INSERT INTO conversation_cache (conversationId, lastMessageId, lastMessageSnippet, lastMessageTimestamp, unreadCount)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(conversationId) DO UPDATE SET
             lastMessageId = excluded.lastMessageId,
             lastMessageSnippet = excluded.lastMessageSnippet,
             lastMessageTimestamp = excluded.lastMessageTimestamp;`,
          [msg.conversationId, msg.clientMessageId, snippet, msg.createdAt, 0]
        );
        count++;
      }
      return count;
    } catch (err) {
      console.warn('[LocalDb] Failed to restore messages batch:', err);
      return 0;
    }
  });
}

/**
 * Returns all stored messages (used for zero-knowledge backup export).
 */
export async function getAllStoredMessages(): Promise<StoredMessage[]> {
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) return [];
      return await db.getAllAsync<StoredMessage>(`SELECT * FROM messages ORDER BY createdAt ASC;`);
    } catch (err) {
      console.warn('[LocalDb] Failed to get all stored messages:', err);
      return [];
    }
  });
}

/**
 * Closes the local database instance (e.g. on logout).
 */
export async function closeLocalDb(): Promise<void> {
  return runDbExclusive(async () => {
    if (dbInstance) {
      try {
        await dbInstance.closeAsync();
      } catch {
        // Ignored
      }
      dbInstance = null;
    }
  });
}

/**
 * Drops all stored data and closes database on logout or device reset.
 */
export async function wipeLocalDb(): Promise<void> {
  return runDbExclusive(async () => {
    if (dbInstance) {
      try {
        await dbInstance.execAsync(`
          DROP TABLE IF EXISTS messages;
          DROP TABLE IF EXISTS identity_keys;
          DROP TABLE IF EXISTS conversation_cache;
          DROP TABLE IF EXISTS cached_conversations;
        `);
        await dbInstance.closeAsync();
      } catch {
        // Ignored
      }
      dbInstance = null;
    }
    // Clear Web storage fallback
    try {
      await appStorage.deleteItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`);
      const uid = await getActiveUserId().catch(() => null);
      if (uid) {
        await appStorage.deleteItemAsync(`${WEB_STORAGE_PREFIX}${uid}_cached_conversations`);
      }
    } catch {}
  });
}

/**
 * Deletes all messages and cache for a specific conversation from local storage.
 */
export async function deleteLocalConversation(conversationId: string): Promise<void> {
  return runDbExclusive(async () => {
    try {
      const key = await getWebKey(conversationId);
      await appStorage.deleteItemAsync(key).catch(() => {});
      await appStorage.deleteItemAsync(`${WEB_STORAGE_PREFIX}msgs_${conversationId}`).catch(() => {});

      // Clear from snippet cache
      try {
        const cacheRaw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`);
        if (cacheRaw) {
          const cacheMap = JSON.parse(cacheRaw);
          delete cacheMap[conversationId];
          await appStorage.setItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`, JSON.stringify(cacheMap));
        }
      } catch {}

      // Clear from cached_conversations web fallback if present
      try {
        const uid = await getActiveUserId().catch(() => null);
        if (uid) {
          const rawConv = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}${uid}_cached_conversations`);
          if (rawConv) {
            const list: any[] = JSON.parse(rawConv);
            const filtered = list.filter((c) => c._id !== conversationId);
            await appStorage.setItemAsync(`${WEB_STORAGE_PREFIX}${uid}_cached_conversations`, JSON.stringify(filtered));
          }
        }
      } catch {}

      const db = await getLocalDb();
      if (db) {
        await db.runAsync(`DELETE FROM messages WHERE conversationId = ?;`, [conversationId]);
        await db.runAsync(`DELETE FROM conversation_cache WHERE conversationId = ?;`, [conversationId]);
        await db.runAsync(`DELETE FROM cached_conversations WHERE conversationId = ?;`, [conversationId]);
      }
    } catch (err) {
      console.warn('[LocalDb] Failed to delete local conversation:', err);
    }
  });
}

/**
 * Updates emoji reactions on a locally cached message so reactions persist across reloads.
 */
export async function updateLocalMessageReactions(
  conversationId: string,
  messageId: string,
  reactions: any[]
): Promise<void> {
  return runDbExclusive(async () => {
    const reactionJson = JSON.stringify(reactions || []);
    try {
      const db = await getLocalDb();
      if (!db) {
        const list = await getWebMessages(conversationId);
        const idx = list.findIndex(
          (m) =>
            m.clientMessageId === messageId ||
            (m as any)._id === messageId ||
            (m as any).id === messageId
        );
        if (idx >= 0) {
          list[idx] = { ...list[idx], reactionJson };
          const key = await getWebKey(conversationId);
          await appStorage.setItemAsync(key, JSON.stringify(list));
        }
        return;
      }

      await db.runAsync(
        `UPDATE messages SET reactionJson = ? WHERE conversationId = ? AND (clientMessageId = ? OR id = ?);`,
        [reactionJson, conversationId, messageId, messageId]
      );
    } catch (err) {
      console.warn('[LocalDb] Failed to update message reactions:', err);
    }
  });
}

/**
 * Deletes a single message from local SQLite and web storage cache, updating conversation previews.
 */
export async function deleteLocalMessage(
  conversationId: string,
  messageId: string,
  clientMessageId?: string
): Promise<void> {
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (db) {
        const id1 = messageId || '';
        const id2 = clientMessageId || messageId || '';
        await db.runAsync(
          `DELETE FROM messages WHERE conversationId = ? AND (clientMessageId = ? OR clientMessageId = ? OR id = ?);`,
          [conversationId, id1, id2, id1]
        );

        // Update conversation_cache with the remaining latest message
        const remaining = await db.getAllAsync<{ clientMessageId: string; body: string | null; kind: string; type: string; createdAt: number }>(
          `SELECT clientMessageId, body, kind, type, createdAt FROM messages WHERE conversationId = ? ORDER BY createdAt DESC LIMIT 1;`,
          [conversationId]
        );

        if (remaining && remaining.length > 0) {
          const rem = remaining[0];
          const snippet = rem.kind === 'text'
            ? (rem.body || '')
            : (rem.kind === 'image' || rem.type === 'image'
              ? '📷 Photo'
              : (rem.kind === 'video' || rem.type === 'video'
                ? '🎥 Video'
                : `[${rem.kind || rem.type}]`));

          await db.runAsync(
            `INSERT INTO conversation_cache (conversationId, lastMessageId, lastMessageSnippet, lastMessageTimestamp, unreadCount)
             VALUES (?, ?, ?, ?, 0)
             ON CONFLICT(conversationId) DO UPDATE SET
               lastMessageId = excluded.lastMessageId,
               lastMessageSnippet = excluded.lastMessageSnippet,
               lastMessageTimestamp = excluded.lastMessageTimestamp;`,
            [conversationId, rem.clientMessageId, snippet, rem.createdAt]
          );
        } else {
          await db.runAsync(`DELETE FROM conversation_cache WHERE conversationId = ?;`, [conversationId]);
        }
      }

      // Also clean up web storage fallback
      const keyScoped = await getWebKey(conversationId);
      const keyLegacy = `${WEB_STORAGE_PREFIX}msgs_${conversationId}`;
      for (const key of [keyScoped, keyLegacy]) {
        const raw = await appStorage.getItemAsync(key);
        if (raw) {
          const list = JSON.parse(raw);
          const filtered = list.filter(
            (m: any) =>
              m.clientMessageId !== messageId &&
              (!clientMessageId || m.clientMessageId !== clientMessageId) &&
              m.id !== messageId &&
              m._id !== messageId &&
              (!clientMessageId || m._id !== clientMessageId)
          );
          await appStorage.setItemAsync(key, JSON.stringify(filtered));
        }
      }

      // Update conv_cache snippet
      const cacheRaw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`);
      if (cacheRaw) {
        const remainingWeb = await getWebMessages(conversationId);
        const cacheMap = JSON.parse(cacheRaw);
        if (remainingWeb.length > 0) {
          const last = remainingWeb[remainingWeb.length - 1];
          const snippet = last.kind === 'text'
            ? (last.body || '')
            : (last.kind === 'image' ? '📷 Photo' : (last.kind === 'video' ? '🎥 Video' : `[${last.kind}]`));
          cacheMap[conversationId] = {
            conversationId,
            lastMessageId: last.clientMessageId,
            lastMessageSnippet: snippet,
            lastMessageTimestamp: last.createdAt,
            unreadCount: 0,
          };
        } else {
          delete cacheMap[conversationId];
        }
        await appStorage.setItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`, JSON.stringify(cacheMap));
      }
    } catch (err) {
      console.warn('[LocalDb] Failed to delete local message:', err);
    }
  });
}

/**
 * Deletes a batch of messages from local SQLite and web storage cache by clientMessageId, updating conversation previews.
 */
export async function deleteLocalMessagesBatch(
  conversationId: string,
  clientMessageIds: string[]
): Promise<void> {
  if (!clientMessageIds || clientMessageIds.length === 0) return;
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (db) {
        const placeholders = clientMessageIds.map(() => '?').join(',');
        await db.runAsync(
          `DELETE FROM messages WHERE conversationId = ? AND clientMessageId IN (${placeholders});`,
          [conversationId, ...clientMessageIds]
        );

        // Update conversation_cache with the remaining latest message
        const remaining = await db.getAllAsync<{ clientMessageId: string; body: string | null; kind: string; type: string; createdAt: number }>(
          `SELECT clientMessageId, body, kind, type, createdAt FROM messages WHERE conversationId = ? ORDER BY createdAt DESC LIMIT 1;`,
          [conversationId]
        );

        if (remaining && remaining.length > 0) {
          const rem = remaining[0];
          const snippet = rem.kind === 'text'
            ? (rem.body || '')
            : (rem.kind === 'image' || rem.type === 'image'
              ? '📷 Photo'
              : (rem.kind === 'video' || rem.type === 'video'
                ? '🎥 Video'
                : `[${rem.kind || rem.type}]`));

          await db.runAsync(
            `INSERT INTO conversation_cache (conversationId, lastMessageId, lastMessageSnippet, lastMessageTimestamp, unreadCount)
             VALUES (?, ?, ?, ?, 0)
             ON CONFLICT(conversationId) DO UPDATE SET
               lastMessageId = excluded.lastMessageId,
               lastMessageSnippet = excluded.lastMessageSnippet,
               lastMessageTimestamp = excluded.lastMessageTimestamp;`,
            [conversationId, rem.clientMessageId, snippet, rem.createdAt]
          );
        } else {
          await db.runAsync(`DELETE FROM conversation_cache WHERE conversationId = ?;`, [conversationId]);
        }
      }

      // Also clean up web storage fallback
      const idSet = new Set(clientMessageIds);
      const keyScoped = await getWebKey(conversationId);
      const keyLegacy = `${WEB_STORAGE_PREFIX}msgs_${conversationId}`;
      for (const key of [keyScoped, keyLegacy]) {
        const raw = await appStorage.getItemAsync(key);
        if (raw) {
          const list: StoredMessage[] = JSON.parse(raw);
          const filtered = list.filter((m) => !idSet.has(m.clientMessageId) && !idSet.has((m as any)._id));
          await appStorage.setItemAsync(key, JSON.stringify(filtered));
        }
      }

      // Update conv_cache snippet
      const cacheRaw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`);
      if (cacheRaw) {
        const remainingWeb = await getWebMessages(conversationId);
        const cacheMap = JSON.parse(cacheRaw);
        if (remainingWeb.length > 0) {
          const last = remainingWeb[remainingWeb.length - 1];
          const snippet = last.kind === 'text'
            ? (last.body || '')
            : (last.kind === 'image' ? '📷 Photo' : (last.kind === 'video' ? '🎥 Video' : `[${last.kind}]`));
          cacheMap[conversationId] = {
            conversationId,
            lastMessageId: last.clientMessageId,
            lastMessageSnippet: snippet,
            lastMessageTimestamp: last.createdAt,
            unreadCount: 0,
          };
        } else {
          delete cacheMap[conversationId];
        }
        await appStorage.setItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`, JSON.stringify(cacheMap));
      }
    } catch (err) {
      console.warn('[LocalDb] Failed to delete local messages batch:', err);
    }
  });
}

/**
 * Purges all non-pending messages for a conversation when the remote server has 0 messages.
 * Retains optimistic pending outbound messages.
 */
export async function purgeNonPendingLocalMessages(conversationId: string): Promise<void> {
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (db) {
        await db.runAsync(
          `DELETE FROM messages WHERE conversationId = ? AND deliveryStatus NOT IN ('pending', 'failed');`,
          [conversationId]
        );

        // Check if any pending or failed messages remain to update conversation_cache
        const remaining = await db.getAllAsync<{ clientMessageId: string; body: string | null; kind: string; type: string; createdAt: number }>(
          `SELECT clientMessageId, body, kind, type, createdAt FROM messages WHERE conversationId = ? ORDER BY createdAt DESC LIMIT 1;`,
          [conversationId]
        );

        if (remaining && remaining.length > 0) {
          const rem = remaining[0];
          const snippet = rem.kind === 'text'
            ? (rem.body || '')
            : (rem.kind === 'image' || rem.type === 'image'
              ? '📷 Photo'
              : (rem.kind === 'video' || rem.type === 'video'
                ? '🎥 Video'
                : `[${rem.kind || rem.type}]`));

          await db.runAsync(
            `INSERT INTO conversation_cache (conversationId, lastMessageId, lastMessageSnippet, lastMessageTimestamp, unreadCount)
             VALUES (?, ?, ?, ?, 0)
             ON CONFLICT(conversationId) DO UPDATE SET
               lastMessageId = excluded.lastMessageId,
               lastMessageSnippet = excluded.lastMessageSnippet,
               lastMessageTimestamp = excluded.lastMessageTimestamp;`,
            [conversationId, rem.clientMessageId, snippet, rem.createdAt]
          );
        } else {
          await db.runAsync(`DELETE FROM conversation_cache WHERE conversationId = ?;`, [conversationId]);
        }
      }

      // Also clean up web storage fallback
      const keyScoped = await getWebKey(conversationId);
      const keyLegacy = `${WEB_STORAGE_PREFIX}msgs_${conversationId}`;
      for (const key of [keyScoped, keyLegacy]) {
        const raw = await appStorage.getItemAsync(key);
        if (raw) {
          const list: StoredMessage[] = JSON.parse(raw);
          const filtered = list.filter((m) => m.deliveryStatus === 'pending' || m.deliveryStatus === 'failed');
          await appStorage.setItemAsync(key, JSON.stringify(filtered));
        }
      }

      const cacheRaw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`);
      if (cacheRaw) {
        const remainingWeb = await getWebMessages(conversationId);
        const cacheMap = JSON.parse(cacheRaw);
        if (remainingWeb.length > 0) {
          const last = remainingWeb[remainingWeb.length - 1];
          const snippet = last.kind === 'text'
            ? (last.body || '')
            : (last.kind === 'image' ? '📷 Photo' : (last.kind === 'video' ? '🎥 Video' : `[${last.kind}]`));
          cacheMap[conversationId] = {
            conversationId,
            lastMessageId: last.clientMessageId,
            lastMessageSnippet: snippet,
            lastMessageTimestamp: last.createdAt,
            unreadCount: 0,
          };
        } else {
          delete cacheMap[conversationId];
        }
        await appStorage.setItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`, JSON.stringify(cacheMap));
      }
    } catch (err) {
      console.warn('[LocalDb] Failed to purge non-pending local messages:', err);
    }
  });
}

/**
 * Retrieves the latest message snippet and timestamp for each conversation from SQLite messages table.
 * Provides ultra-fast offline/instant rendering for chats.tsx.
 */
export async function getLatestLocalMessages(): Promise<Map<string, {
  clientMessageId: string;
  snippet: string;
  createdAt: number;
  isOutgoing: boolean;
  type: string;
}>> {
  return runDbExclusive(async () => {
    const map = new Map<string, {
      clientMessageId: string;
      snippet: string;
      createdAt: number;
      isOutgoing: boolean;
      type: string;
    }>();

    try {
      const db = await getLocalDb();
      if (db) {
        // Query latest message for every conversation using SQLite GROUP BY / MAX
        const rows = await db.getAllAsync<{
          conversationId: string;
          clientMessageId: string;
          body: string | null;
          kind: string;
          type: string;
          createdAt: number;
          isOutgoing: number;
        }>(
          `SELECT m.conversationId, m.clientMessageId, m.body, m.kind, m.type, m.createdAt, m.isOutgoing
           FROM messages m
           INNER JOIN (
             SELECT conversationId, MAX(createdAt) as maxCreatedAt
             FROM messages
             GROUP BY conversationId
           ) latest ON m.conversationId = latest.conversationId AND m.createdAt = latest.maxCreatedAt;`
        );

        for (const row of rows) {
          const snippet = row.kind === 'text'
            ? (row.body || '')
            : (row.kind === 'image' || row.type === 'image'
              ? '📷 Photo'
              : (row.kind === 'video' || row.type === 'video'
                ? '🎥 Video'
                : `[${row.kind || row.type}]`));

          map.set(row.conversationId, {
            clientMessageId: row.clientMessageId,
            snippet,
            createdAt: row.createdAt,
            isOutgoing: row.isOutgoing === 1,
            type: row.type || row.kind,
          });
        }
        return map;
      }

      // Web storage fallback
      const cacheRaw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`);
      if (cacheRaw) {
        const cacheMap: Record<string, ConversationSnippet> = JSON.parse(cacheRaw);
        for (const [convId, snip] of Object.entries(cacheMap)) {
          map.set(convId, {
            clientMessageId: snip.lastMessageId || '',
            snippet: snip.lastMessageSnippet || '',
            createdAt: snip.lastMessageTimestamp || 0,
            isOutgoing: false,
            type: 'text',
          });
        }
      }
      return map;
    } catch (err) {
      console.warn('[LocalDb] Failed to get latest local messages:', err);
      return map;
    }
  });
}

export interface CachedConversationRecord {
  conversationId: string;
  userId: string;
  type: string;
  name?: string | null;
  description?: string | null;
  adminIds?: string | null;
  groupAvatarUrl?: string | null;
  groupAvatarPublicId?: string | null;
  status: 'pending' | 'accepted';
  initiatorId?: string | null;
  participantsJson: string;
  lastMessageJson?: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CachedConversationParticipant {
  _id: string;
  name: string;
  email: string;
  image: string | null;
  isOnline?: boolean;
  lastActiveAt?: string | null;
}

export interface CachedConversationLastMessage {
  _id: string;
  senderId: string;
  type: string;
  content: string;
  createdAt: string;
}

export interface CachedConversationItem {
  _id: string;
  type: string;
  name?: string | null;
  description?: string | null;
  adminIds?: string[];
  groupAvatarUrl?: string | null;
  groupAvatarPublicId?: string | null;
  status?: 'pending' | 'accepted';
  initiatorId?: string | null;
  participants: CachedConversationParticipant[];
  lastMessage: CachedConversationLastMessage | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ConversationItem = CachedConversationItem;
export type LastMessage = CachedConversationLastMessage;
export type Participant = CachedConversationParticipant;

/**
 * Retrieves all cached conversations for a specific user from SQLite or web storage.
 * Results are ordered chronologically by updatedAt descending.
 */
export async function getCachedConversations(userId: string): Promise<ConversationItem[]> {
  if (!userId) return [];
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) {
        const raw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}${userId}_cached_conversations`);
        if (!raw) return [];
        const parsed: ConversationItem[] = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt).getTime() -
            new Date(a.updatedAt || a.createdAt).getTime()
        );
      }

      const rows = await db.getAllAsync<CachedConversationRecord>(
        `SELECT * FROM cached_conversations WHERE userId = ? ORDER BY updatedAt DESC;`,
        [userId]
      );

      return rows.map((row) => {
        let participants: CachedConversationParticipant[] = [];
        try {
          if (row.participantsJson) {
            participants = JSON.parse(row.participantsJson);
          }
        } catch {}

        let adminIds: string[] | undefined = undefined;
        try {
          if (row.adminIds) {
            adminIds = JSON.parse(row.adminIds);
          }
        } catch {}

        let lastMessage: CachedConversationLastMessage | null = null;
        try {
          if (row.lastMessageJson) {
            lastMessage = JSON.parse(row.lastMessageJson);
          }
        } catch {}

        return {
          _id: row.conversationId,
          type: row.type || 'direct',
          name: row.name ?? null,
          description: row.description ?? null,
          adminIds,
          groupAvatarUrl: row.groupAvatarUrl ?? null,
          groupAvatarPublicId: row.groupAvatarPublicId ?? null,
          status: (row.status as 'pending' | 'accepted') || 'accepted',
          initiatorId: row.initiatorId ?? null,
          participants: Array.isArray(participants) ? participants : [],
          lastMessage,
          unreadCount: typeof row.unreadCount === 'number' ? row.unreadCount : 0,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });
    } catch (err) {
      console.warn('[LocalDb] Failed to get cached conversations:', err);
      return [];
    }
  });
}

/**
 * Persists a batch of conversations to SQLite (or web storage) within an immediate transaction.
 */
export async function upsertCachedConversationsBatch(
  conversations: ConversationItem[],
  userId: string
): Promise<void> {
  if (!conversations || conversations.length === 0 || !userId) return;
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) {
        await appStorage.setItemAsync(
          `${WEB_STORAGE_PREFIX}${userId}_cached_conversations`,
          JSON.stringify(conversations)
        );
        return;
      }

      const insertSql = `
        INSERT INTO cached_conversations (
          conversationId, userId, type, name, description, adminIds,
          groupAvatarUrl, groupAvatarPublicId, status, initiatorId,
          participantsJson, lastMessageJson, unreadCount, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(userId, conversationId) DO UPDATE SET
          type = excluded.type,
          name = excluded.name,
          description = excluded.description,
          adminIds = excluded.adminIds,
          groupAvatarUrl = excluded.groupAvatarUrl,
          groupAvatarPublicId = excluded.groupAvatarPublicId,
          status = excluded.status,
          initiatorId = excluded.initiatorId,
          participantsJson = excluded.participantsJson,
          lastMessageJson = excluded.lastMessageJson,
          unreadCount = excluded.unreadCount,
          createdAt = excluded.createdAt,
          updatedAt = excluded.updatedAt;
      `;

      const runInserts = async (runner: { runAsync: (sql: string, params: any[]) => Promise<any> }) => {
        for (const c of conversations) {
          const convId = c._id;
          if (!convId) continue;
          const participantsJson = JSON.stringify(c.participants || []);
          const adminIdsJson = c.adminIds ? JSON.stringify(c.adminIds) : null;
          const lastMessageJson = c.lastMessage ? JSON.stringify(c.lastMessage) : null;
          const createdAt = c.createdAt || new Date().toISOString();
          const updatedAt = c.updatedAt || c.lastMessage?.createdAt || createdAt;
          const status = c.status || 'accepted';
          const unreadCount = typeof c.unreadCount === 'number' ? c.unreadCount : 0;

          await runner.runAsync(insertSql, [
            convId,
            userId,
            c.type || 'direct',
            c.name ?? null,
            c.description ?? null,
            adminIdsJson,
            c.groupAvatarUrl ?? null,
            c.groupAvatarPublicId ?? null,
            status,
            c.initiatorId ?? null,
            participantsJson,
            lastMessageJson,
            unreadCount,
            createdAt,
            updatedAt,
          ]);
        }
      };

      if (typeof db.withTransactionAsync === 'function') {
        await db.withTransactionAsync(async () => {
          await runInserts(db);
        });
      } else {
        await db.execAsync('BEGIN IMMEDIATE;');
        try {
          await runInserts(db);
          await db.execAsync('COMMIT;');
        } catch (e) {
          await db.execAsync('ROLLBACK;').catch(() => {});
          throw e;
        }
      }
    } catch (err) {
      console.warn('[LocalDb] Failed to batch upsert cached conversations:', err);
    }
  });
}

/**
 * Inserts or updates a single conversation in SQLite or web storage cache.
 */
export async function upsertCachedConversation(
  conv: ConversationItem,
  userId: string
): Promise<void> {
  if (!conv || !conv._id || !userId) return;
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) {
        const raw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}${userId}_cached_conversations`);
        const list: ConversationItem[] = raw ? JSON.parse(raw) : [];
        const idx = list.findIndex((c) => c._id === conv._id);
        if (idx !== -1) {
          list[idx] = { ...list[idx], ...conv };
        } else {
          list.unshift(conv);
        }
        list.sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt).getTime() -
            new Date(a.updatedAt || a.createdAt).getTime()
        );
        await appStorage.setItemAsync(
          `${WEB_STORAGE_PREFIX}${userId}_cached_conversations`,
          JSON.stringify(list)
        );
        return;
      }

      const convId = conv._id;
      const participantsJson = JSON.stringify(conv.participants || []);
      const adminIdsJson = conv.adminIds ? JSON.stringify(conv.adminIds) : null;
      const lastMessageJson = conv.lastMessage ? JSON.stringify(conv.lastMessage) : null;
      const createdAt = conv.createdAt || new Date().toISOString();
      const updatedAt = conv.updatedAt || conv.lastMessage?.createdAt || createdAt;
      const status = conv.status || 'accepted';
      const unreadCount = typeof conv.unreadCount === 'number' ? conv.unreadCount : 0;

      await db.runAsync(
        `INSERT INTO cached_conversations (
          conversationId, userId, type, name, description, adminIds,
          groupAvatarUrl, groupAvatarPublicId, status, initiatorId,
          participantsJson, lastMessageJson, unreadCount, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(userId, conversationId) DO UPDATE SET
          type = excluded.type,
          name = excluded.name,
          description = excluded.description,
          adminIds = excluded.adminIds,
          groupAvatarUrl = excluded.groupAvatarUrl,
          groupAvatarPublicId = excluded.groupAvatarPublicId,
          status = excluded.status,
          initiatorId = excluded.initiatorId,
          participantsJson = excluded.participantsJson,
          lastMessageJson = excluded.lastMessageJson,
          unreadCount = excluded.unreadCount,
          createdAt = excluded.createdAt,
          updatedAt = excluded.updatedAt;`,
        [
          convId,
          userId,
          conv.type || 'direct',
          conv.name ?? null,
          conv.description ?? null,
          adminIdsJson,
          conv.groupAvatarUrl ?? null,
          conv.groupAvatarPublicId ?? null,
          status,
          conv.initiatorId ?? null,
          participantsJson,
          lastMessageJson,
          unreadCount,
          createdAt,
          updatedAt,
        ]
      );
    } catch (err) {
      console.warn('[LocalDb] Failed to upsert cached conversation:', err);
    }
  });
}

/**
 * Updates partial metadata (e.g. group name, avatar, participants, status, unreadCount) for a cached conversation.
 */
export async function updateCachedConversationMetadata(
  conversationId: string,
  userId: string,
  updates: Partial<ConversationItem>
): Promise<void> {
  if (!conversationId || !userId) return;
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) {
        const raw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}${userId}_cached_conversations`);
        if (!raw) return;
        const list: ConversationItem[] = JSON.parse(raw);
        const idx = list.findIndex((c) => c._id === conversationId);
        if (idx !== -1) {
          list[idx] = { ...list[idx], ...updates };
          await appStorage.setItemAsync(
            `${WEB_STORAGE_PREFIX}${userId}_cached_conversations`,
            JSON.stringify(list)
          );
        }
        return;
      }

      const setClauses: string[] = [];
      const values: any[] = [];

      if (updates.name !== undefined) {
        setClauses.push('name = ?');
        values.push(updates.name);
      }
      if (updates.description !== undefined) {
        setClauses.push('description = ?');
        values.push(updates.description);
      }
      if (updates.groupAvatarUrl !== undefined) {
        setClauses.push('groupAvatarUrl = ?');
        values.push(updates.groupAvatarUrl);
      }
      if (updates.groupAvatarPublicId !== undefined) {
        setClauses.push('groupAvatarPublicId = ?');
        values.push(updates.groupAvatarPublicId);
      }
      if (updates.status !== undefined) {
        setClauses.push('status = ?');
        values.push(updates.status);
      }
      if (updates.unreadCount !== undefined) {
        setClauses.push('unreadCount = ?');
        values.push(updates.unreadCount);
      }
      if (updates.participants !== undefined) {
        setClauses.push('participantsJson = ?');
        values.push(JSON.stringify(updates.participants));
      }
      if (updates.adminIds !== undefined) {
        setClauses.push('adminIds = ?');
        values.push(JSON.stringify(updates.adminIds));
      }
      if (updates.lastMessage !== undefined) {
        setClauses.push('lastMessageJson = ?');
        values.push(updates.lastMessage ? JSON.stringify(updates.lastMessage) : null);
      }
      if (updates.updatedAt !== undefined) {
        setClauses.push('updatedAt = ?');
        values.push(updates.updatedAt);
      }

      if (setClauses.length === 0) return;

      values.push(userId, conversationId);
      const sql = `UPDATE cached_conversations SET ${setClauses.join(', ')} WHERE userId = ? AND conversationId = ?;`;
      await db.runAsync(sql, values);
    } catch (err) {
      console.warn('[LocalDb] Failed to update cached conversation metadata:', err);
    }
  });
}

/**
 * Updates the lastMessageJson, updatedAt, and unreadCount for a cached conversation.
 */
export async function updateCachedConversationLastMessage(params: {
  conversationId: string;
  userId: string;
  lastMessage: CachedConversationLastMessage | null;
  unreadDelta?: number;
  forceUnread?: number;
  updatedAt?: string;
}): Promise<void> {
  const { conversationId, userId, lastMessage, unreadDelta, forceUnread, updatedAt } = params;
  if (!conversationId || !userId) return;
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      const lastMessageJson = lastMessage ? JSON.stringify(lastMessage) : null;
      const effectiveUpdatedAt = updatedAt || lastMessage?.createdAt || new Date().toISOString();

      if (!db) {
        const raw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}${userId}_cached_conversations`);
        if (!raw) return;
        const list: ConversationItem[] = JSON.parse(raw);
        const idx = list.findIndex((c) => c._id === conversationId);
        if (idx !== -1) {
          const item = list[idx];
          let nextUnread = item.unreadCount || 0;
          if (typeof forceUnread === 'number') {
            nextUnread = forceUnread;
          } else if (typeof unreadDelta === 'number') {
            nextUnread = Math.max(0, nextUnread + unreadDelta);
          }
          list[idx] = {
            ...item,
            lastMessage,
            updatedAt: effectiveUpdatedAt,
            unreadCount: nextUnread,
          };
          list.sort(
            (a, b) =>
              new Date(b.updatedAt || b.createdAt).getTime() -
              new Date(a.updatedAt || a.createdAt).getTime()
          );
          await appStorage.setItemAsync(
            `${WEB_STORAGE_PREFIX}${userId}_cached_conversations`,
            JSON.stringify(list)
          );
        }
        return;
      }

      if (typeof forceUnread === 'number') {
        await db.runAsync(
          `UPDATE cached_conversations 
           SET lastMessageJson = ?, updatedAt = ?, unreadCount = ? 
           WHERE userId = ? AND conversationId = ?;`,
          [lastMessageJson, effectiveUpdatedAt, forceUnread, userId, conversationId]
        );
      } else if (typeof unreadDelta === 'number') {
        await db.runAsync(
          `UPDATE cached_conversations 
           SET lastMessageJson = ?, updatedAt = ?, unreadCount = MAX(0, unreadCount + ?) 
           WHERE userId = ? AND conversationId = ?;`,
          [lastMessageJson, effectiveUpdatedAt, unreadDelta, userId, conversationId]
        );
      } else {
        await db.runAsync(
          `UPDATE cached_conversations 
           SET lastMessageJson = ?, updatedAt = ? 
           WHERE userId = ? AND conversationId = ?;`,
          [lastMessageJson, effectiveUpdatedAt, userId, conversationId]
        );
      }
    } catch (err) {
      console.warn('[LocalDb] Failed to update cached conversation last message:', err);
    }
  });
}

/**
 * Deletes a cached conversation record from SQLite or web storage.
 */
export async function deleteCachedConversation(
  conversationId: string,
  userId?: string
): Promise<void> {
  if (!conversationId) return;
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) {
        if (userId) {
          const raw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}${userId}_cached_conversations`);
          if (raw) {
            const list: ConversationItem[] = JSON.parse(raw);
            const filtered = list.filter((c) => c._id !== conversationId);
            await appStorage.setItemAsync(
              `${WEB_STORAGE_PREFIX}${userId}_cached_conversations`,
              JSON.stringify(filtered)
            );
          }
        }
        return;
      }

      if (userId) {
        await db.runAsync(
          `DELETE FROM cached_conversations WHERE conversationId = ? AND userId = ?;`,
          [conversationId, userId]
        );
      } else {
        await db.runAsync(
          `DELETE FROM cached_conversations WHERE conversationId = ?;`,
          [conversationId]
        );
      }
    } catch (err) {
      console.warn('[LocalDb] Failed to delete cached conversation:', err);
    }
  });
}

/**
 * Updates the delivery status of a locally stored message (e.g. 'pending', 'sent', 'failed').
 */
export async function updateLocalMessageDeliveryStatus(
  clientMessageId: string,
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed',
  conversationId?: string
): Promise<void> {
  if (!clientMessageId) return;
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (db) {
        if (conversationId) {
          await db.runAsync(
            `UPDATE messages SET deliveryStatus = ? WHERE clientMessageId = ? AND conversationId = ?;`,
            [deliveryStatus, clientMessageId, conversationId]
          );
        } else {
          await db.runAsync(
            `UPDATE messages SET deliveryStatus = ? WHERE clientMessageId = ?;`,
            [deliveryStatus, clientMessageId]
          );
        }
        return;
      }

      // Web storage fallback
      if (conversationId) {
        const key = await getWebKey(conversationId);
        const raw = await appStorage.getItemAsync(key);
        if (raw) {
          const list: StoredMessage[] = JSON.parse(raw);
          let found = false;
          for (const m of list) {
            if (m.clientMessageId === clientMessageId || (m as any)._id === clientMessageId) {
              m.deliveryStatus = deliveryStatus;
              found = true;
            }
          }
          if (found) {
            await appStorage.setItemAsync(key, JSON.stringify(list));
            return;
          }
        }
      }

      const cacheRaw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`);
      if (cacheRaw) {
        const cacheMap: Record<string, ConversationSnippet> = JSON.parse(cacheRaw);
        for (const cid of Object.keys(cacheMap)) {
          const key = await getWebKey(cid);
          const raw = await appStorage.getItemAsync(key);
          if (raw) {
            const list: StoredMessage[] = JSON.parse(raw);
            let found = false;
            for (const m of list) {
              if (m.clientMessageId === clientMessageId || (m as any)._id === clientMessageId) {
                m.deliveryStatus = deliveryStatus;
                found = true;
              }
            }
            if (found) {
              await appStorage.setItemAsync(key, JSON.stringify(list));
              break;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[LocalDb] Failed to update message delivery status:', err);
    }
  });
}

/**
 * Retrieves a single stored message by clientMessageId from SQLite or web storage.
 */
export async function getLocalMessage(
  clientMessageId: string,
  conversationId?: string
): Promise<StoredMessage | null> {
  if (!clientMessageId) return null;
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (db) {
        if (conversationId) {
          const row = await db.getFirstAsync<StoredMessage>(
            `SELECT * FROM messages WHERE clientMessageId = ? AND conversationId = ? LIMIT 1;`,
            [clientMessageId, conversationId]
          );
          return row || null;
        }
        const row = await db.getFirstAsync<StoredMessage>(
          `SELECT * FROM messages WHERE clientMessageId = ? LIMIT 1;`,
          [clientMessageId]
        );
        return row || null;
      }

      if (conversationId) {
        const list = await getWebMessages(conversationId);
        return list.find((m) => m.clientMessageId === clientMessageId || (m as any)._id === clientMessageId) || null;
      }

      const cacheRaw = await appStorage.getItemAsync(`${WEB_STORAGE_PREFIX}conv_cache`);
      if (cacheRaw) {
        const cacheMap: Record<string, ConversationSnippet> = JSON.parse(cacheRaw);
        for (const cid of Object.keys(cacheMap)) {
          const list = await getWebMessages(cid);
          const found = list.find((m) => m.clientMessageId === clientMessageId || (m as any)._id === clientMessageId);
          if (found) return found;
        }
      }
      return null;
    } catch (err) {
      console.warn('[LocalDb] Failed to get local message:', err);
      return null;
    }
  });
}

