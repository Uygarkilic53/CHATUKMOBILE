import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { getLocalDb, runDbExclusive } from '../e2ee/localDb';
import { appStorage } from '../lib/storage';
import {
  WALLPAPERS,
  WallpaperItem,
  DEFAULT_WALLPAPER_ID,
  getWallpaperById,
} from '../constants/wallpapers';

export const WALLPAPER_DIR =
  Platform.OS !== 'web' && FileSystem.documentDirectory
    ? `${FileSystem.documentDirectory}wallpapers/`
    : '';

const WEB_SETTINGS_KEY = 'chatuk_wallpaper_settings_v1';
const WEB_CACHE_KEY = 'chatuk_wallpapers_cache_v1';
const WEB_PENDING_QUEUE_KEY = 'chatuk_wallpaper_pending_queue_v1';

export interface WallpaperSettingRecord {
  userId: string;
  scope: string;
  wallpaperId: string;
  syncStatus: 'synced' | 'pending' | 'syncing' | 'failed';
  updatedAt: number;
  lastSyncedAt?: number | null;
}

let isInitialized = false;

/**
 * Ensures the target wallpapers/ directory exists on local disk.
 */
export async function ensureWallpaperDirectory(): Promise<string | null> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) {
    return null;
  }
  try {
    const dir = `${FileSystem.documentDirectory}wallpapers/`;
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    return dir;
  } catch (err) {
    console.warn('[WallpaperCacheService] Failed to create wallpaper directory:', err);
    return null;
  }
}

/**
 * Seed preset wallpapers from WALLPAPERS constant into SQLite or web storage.
 */
async function seedDefaultWallpapers(): Promise<void> {
  const now = Date.now();
  try {
    const db = await getLocalDb();
    if (db) {
      for (const item of WALLPAPERS) {
        await db.runAsync(
          `INSERT OR IGNORE INTO wallpapers_cache (
            id, name, category, aesthetic, dominantColor, assetType,
            remoteUrl, localUri, bundledSourceKey, fileSizeBytes,
            isAvailableOffline, version, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            item.id,
            item.name,
            item.category,
            item.aesthetic || '',
            item.dominantColor || '',
            item.id === DEFAULT_WALLPAPER_ID ? 'bundled' : 'bundled',
            null,
            null,
            item.id,
            0,
            1,
            1,
            now,
            now,
          ]
        );
      }
      return;
    }
  } catch (err) {
    console.warn('[WallpaperCacheService] Error seeding default wallpapers into SQLite:', err);
  }

  // Web fallback: seed into appStorage if empty
  try {
    const raw = await appStorage.getItemAsync(WEB_CACHE_KEY);
    if (!raw) {
      const initialCache = WALLPAPERS.map((w) => ({
        ...w,
        assetType: 'bundled',
        bundledSourceKey: w.id,
        isAvailableOffline: true,
        createdAt: now,
        updatedAt: now,
      }));
      await appStorage.setItemAsync(WEB_CACHE_KEY, JSON.stringify(initialCache));
    }
  } catch (err) {
    console.warn('[WallpaperCacheService] Error seeding web wallpapers cache:', err);
  }
}

/**
 * Initializes the wallpaper database and filesystem structure.
 */
export async function initWallpaperDatabase(): Promise<void> {
  if (isInitialized) return;
  return runDbExclusive(async () => {
    if (isInitialized) return;
    try {
      await ensureWallpaperDirectory();
      await seedDefaultWallpapers();
      isInitialized = true;
    } catch (err) {
      console.warn('[WallpaperCacheService] initWallpaperDatabase error:', err);
    }
  });
}

/**
 * Retrieves all available wallpapers from SQLite cache (or defaults on fallback).
 */
export async function getCachedWallpapers(): Promise<WallpaperItem[]> {
  try {
    const db = await getLocalDb();
    if (db) {
      const rows = await db.getAllAsync<any>(
        'SELECT * FROM wallpapers_cache ORDER BY createdAt ASC;'
      );

      if (rows && rows.length > 0) {
        return rows.map((row) => {
          let source: number | { uri: string } | null = null;
          if (row.bundledSourceKey) {
            const preset = getWallpaperById(row.bundledSourceKey);
            source = preset.source;
          } else if (row.localUri && typeof row.localUri === 'string' && row.localUri.trim().length > 0) {
            source = { uri: row.localUri.trim() };
          } else if (row.remoteUrl && typeof row.remoteUrl === 'string' && row.remoteUrl.trim().length > 0) {
            source = { uri: row.remoteUrl.trim() };
          }

          return {
            id: row.id,
            name: row.name,
            aesthetic: row.aesthetic,
            category: row.category,
            dominantColor: row.dominantColor,
            assetType: row.assetType,
            remoteUrl: row.remoteUrl,
            localUri: row.localUri,
            bundledSourceKey: row.bundledSourceKey,
            isAvailableOffline: Boolean(row.isAvailableOffline),
            source,
          };
        });
      }
    }
  } catch (err) {
    console.warn('[WallpaperCacheService] Failed to load wallpapers from SQLite:', err);
  }

  // Web / fallback: check appStorage or return static WALLPAPERS
  try {
    const raw = await appStorage.getItemAsync(WEB_CACHE_KEY);
    if (raw) {
      const items: WallpaperItem[] = JSON.parse(raw);
      if (Array.isArray(items) && items.length > 0) {
        return items.map((w) => ({
          ...w,
          source: w.bundledSourceKey ? getWallpaperById(w.bundledSourceKey).source : w.source,
        }));
      }
    }
  } catch {}

  return WALLPAPERS;
}

/**
 * Gets the active wallpaper preference for a user and scope ('global' by default).
 */
export async function getWallpaperPreference(
  userId: string,
  scope = 'global'
): Promise<WallpaperSettingRecord | null> {
  const cleanUserId = userId || 'local_user';
  try {
    const db = await getLocalDb();
    if (db) {
      const row = await db.getFirstAsync<any>(
        'SELECT userId, scope, wallpaperId, syncStatus, updatedAt, lastSyncedAt FROM wallpaper_settings WHERE userId = ? AND scope = ? LIMIT 1;',
        [cleanUserId, scope]
      );

      if (row) {
        return {
          userId: row.userId,
          scope: row.scope,
          wallpaperId: row.wallpaperId,
          syncStatus: row.syncStatus,
          updatedAt: Number(row.updatedAt),
          lastSyncedAt: row.lastSyncedAt ? Number(row.lastSyncedAt) : null,
        };
      }
    }
  } catch (err) {
    console.warn('[WallpaperCacheService] Failed to query wallpaper preference from SQLite:', err);
  }

  // Web fallback: appStorage
  try {
    const raw = await appStorage.getItemAsync(`${WEB_SETTINGS_KEY}_${cleanUserId}_${scope}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}

  // Legacy key check as seamless migration
  try {
    const legacySaved = await appStorage.getItemAsync('chatuk_chat_wallpaper');
    if (legacySaved) {
      return {
        userId: cleanUserId,
        scope,
        wallpaperId: legacySaved,
        syncStatus: 'synced',
        updatedAt: Date.now(),
      };
    }
  } catch {}

  return null;
}

/**
 * Saves or updates a user's wallpaper preference.
 * When isOnline is false, sets syncStatus to 'pending' to be queued for auto-sync.
 */
export async function saveWallpaperPreference(
  userId: string,
  wallpaperId: string,
  isOnline: boolean,
  scope = 'global',
  updatedAt: number = Date.now()
): Promise<void> {
  const cleanUserId = userId || 'local_user';
  const syncStatus: WallpaperSettingRecord['syncStatus'] = isOnline ? 'synced' : 'pending';
  const lastSyncedAt = isOnline ? updatedAt : null;

  await runDbExclusive(async () => {
    // 1. Ensure presets are seeded so foreign key constraint holds
    try {
      const db = await getLocalDb();
      if (db) {
        // Guarantee foreign key exists before upsert
        const exists = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM wallpapers_cache WHERE id = ? LIMIT 1;',
          [wallpaperId]
        );
        if (!exists) {
          const preset = getWallpaperById(wallpaperId);
          await db.runAsync(
            `INSERT OR IGNORE INTO wallpapers_cache (
              id, name, category, aesthetic, dominantColor, assetType,
              bundledSourceKey, isAvailableOffline, version, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              wallpaperId,
              preset.name,
              preset.category,
              preset.aesthetic || '',
              preset.dominantColor || '',
              'bundled',
              wallpaperId,
              1,
              1,
              updatedAt,
              updatedAt,
            ]
          );
        }

        await db.runAsync(
          `INSERT INTO wallpaper_settings (userId, scope, wallpaperId, syncStatus, updatedAt, lastSyncedAt)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(userId, scope) DO UPDATE SET
             wallpaperId = excluded.wallpaperId,
             syncStatus = excluded.syncStatus,
             updatedAt = excluded.updatedAt,
             lastSyncedAt = CASE WHEN excluded.syncStatus = 'synced' THEN excluded.lastSyncedAt ELSE wallpaper_settings.lastSyncedAt END;`,
          [cleanUserId, scope, wallpaperId, syncStatus, updatedAt, lastSyncedAt]
        );
      }
    } catch (err) {
      console.warn('[WallpaperCacheService] Failed to upsert wallpaper preference in SQLite:', err);
    }

    // 2. Mirror to appStorage (for web fallback & instant synchronous boot)
    const record: WallpaperSettingRecord = {
      userId: cleanUserId,
      scope,
      wallpaperId,
      syncStatus,
      updatedAt,
      lastSyncedAt,
    };
    try {
      await appStorage.setItemAsync(
        `${WEB_SETTINGS_KEY}_${cleanUserId}_${scope}`,
        JSON.stringify(record)
      );
      // Keep track of pending queue on web fallback
      const rawQueue = await appStorage.getItemAsync(WEB_PENDING_QUEUE_KEY);
      let queue: WallpaperSettingRecord[] = rawQueue ? JSON.parse(rawQueue) : [];
      queue = queue.filter((q) => !(q.userId === cleanUserId && q.scope === scope));
      if (syncStatus === 'pending') {
        queue.push(record);
      }
      await appStorage.setItemAsync(WEB_PENDING_QUEUE_KEY, JSON.stringify(queue));

      // Keep legacy key synced for backward compatibility
      if (scope === 'global') {
        await appStorage.setItemAsync('chatuk_chat_wallpaper', wallpaperId);
      }
    } catch (err) {
      console.warn('[WallpaperCacheService] Failed to persist web wallpaper preference:', err);
    }
  });
}

/**
 * Returns all wallpaper settings with syncStatus = 'pending'.
 */
export async function getPendingWallpaperSyncs(): Promise<WallpaperSettingRecord[]> {
  try {
    const db = await getLocalDb();
    if (db) {
      const rows = await db.getAllAsync<any>(
        "SELECT userId, scope, wallpaperId, syncStatus, updatedAt, lastSyncedAt FROM wallpaper_settings WHERE syncStatus = 'pending' ORDER BY updatedAt ASC;"
      );
      if (rows && rows.length > 0) {
        return rows.map((r) => ({
          userId: r.userId,
          scope: r.scope,
          wallpaperId: r.wallpaperId,
          syncStatus: r.syncStatus,
          updatedAt: Number(r.updatedAt),
          lastSyncedAt: r.lastSyncedAt ? Number(r.lastSyncedAt) : null,
        }));
      }
      return [];
    }
  } catch (err) {
    console.warn('[WallpaperCacheService] Failed to query pending syncs from SQLite:', err);
  }

  // Web fallback: scan web storage pending queue
  try {
    const rawQueue = await appStorage.getItemAsync(WEB_PENDING_QUEUE_KEY);
    if (rawQueue) {
      const queue: WallpaperSettingRecord[] = JSON.parse(rawQueue);
      return Array.isArray(queue) ? queue : [];
    }
  } catch {
    return [];
  }
  return [];
}

/**
 * Marks a setting as successfully synced with the backend.
 */
export async function markWallpaperSynced(
  userId: string,
  scope = 'global',
  syncedAt: number = Date.now()
): Promise<void> {
  const cleanUserId = userId || 'local_user';
  await runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (db) {
        await db.runAsync(
          "UPDATE wallpaper_settings SET syncStatus = 'synced', lastSyncedAt = ? WHERE userId = ? AND scope = ?;",
          [syncedAt, cleanUserId, scope]
        );
      }
    } catch (err) {
      console.warn('[WallpaperCacheService] Failed to mark wallpaper synced in SQLite:', err);
    }

    try {
      const storageKey = `${WEB_SETTINGS_KEY}_${cleanUserId}_${scope}`;
      const raw = await appStorage.getItemAsync(storageKey);
      if (raw) {
        const rec: WallpaperSettingRecord = JSON.parse(raw);
        rec.syncStatus = 'synced';
        rec.lastSyncedAt = syncedAt;
        await appStorage.setItemAsync(storageKey, JSON.stringify(rec));
      }

      const rawQueue = await appStorage.getItemAsync(WEB_PENDING_QUEUE_KEY);
      if (rawQueue) {
        let queue: WallpaperSettingRecord[] = JSON.parse(rawQueue);
        queue = queue.filter((q) => !(q.userId === cleanUserId && q.scope === scope));
        await appStorage.setItemAsync(WEB_PENDING_QUEUE_KEY, JSON.stringify(queue));
      }
    } catch {}
  });
}

/**
 * Marks a setting as currently in-flight syncing.
 */
export async function markWallpaperSyncing(
  userId: string,
  scope = 'global'
): Promise<void> {
  const cleanUserId = userId || 'local_user';
  await runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (db) {
        await db.runAsync(
          "UPDATE wallpaper_settings SET syncStatus = 'syncing' WHERE userId = ? AND scope = ?;",
          [cleanUserId, scope]
        );
      }
    } catch (err) {
      console.warn('[WallpaperCacheService] Failed to mark wallpaper syncing in SQLite:', err);
    }
  });
}

/**
 * Marks a setting sync as failed so it remains queued.
 */
export async function markWallpaperFailed(
  userId: string,
  scope = 'global'
): Promise<void> {
  const cleanUserId = userId || 'local_user';
  await runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (db) {
        await db.runAsync(
          "UPDATE wallpaper_settings SET syncStatus = 'failed' WHERE userId = ? AND scope = ?;",
          [cleanUserId, scope]
        );
      }
    } catch (err) {
      console.warn('[WallpaperCacheService] Failed to mark wallpaper failed in SQLite:', err);
    }
  });
}

/**
 * Downloads and caches a remote / custom wallpaper image into the local wallpapers/ disk cache
 * and records its metadata in SQLite.
 */
export async function cacheRemoteWallpaper(wallpaper: WallpaperItem): Promise<string> {
  if (!wallpaper.remoteUrl || Platform.OS === 'web' || !FileSystem.documentDirectory) {
    return wallpaper.remoteUrl || '';
  }

  const dir = await ensureWallpaperDirectory();
  if (!dir) return wallpaper.remoteUrl;

  const localPath = `${dir}${wallpaper.id}.png`;

  try {
    // Check if already cached
    const fileInfo = await FileSystem.getInfoAsync(localPath);
    if (!fileInfo.exists) {
      const downloadResult = await FileSystem.downloadAsync(wallpaper.remoteUrl, localPath);
      if (downloadResult.status !== 200) {
        throw new Error(`Download failed with status ${downloadResult.status}`);
      }
    }

    const updatedInfo = await FileSystem.getInfoAsync(localPath);
    const fileSizeBytes = (updatedInfo.exists && updatedInfo.size) || 0;
    const now = Date.now();

    // Persist into SQLite
    const db = await getLocalDb();
    if (db) {
      await db.runAsync(
        `INSERT INTO wallpapers_cache (
          id, name, category, aesthetic, dominantColor, assetType,
          remoteUrl, localUri, bundledSourceKey, fileSizeBytes,
          isAvailableOffline, version, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          localUri = excluded.localUri,
          fileSizeBytes = excluded.fileSizeBytes,
          isAvailableOffline = 1,
          updatedAt = excluded.updatedAt;`,
        [
          wallpaper.id,
          wallpaper.name,
          wallpaper.category,
          wallpaper.aesthetic || '',
          wallpaper.dominantColor || '',
          'remote',
          wallpaper.remoteUrl,
          localPath,
          null,
          fileSizeBytes,
          1,
          1,
          now,
          now,
        ]
      );
    }

    return localPath;
  } catch (err) {
    console.warn('[WallpaperCacheService] Failed to cache remote wallpaper:', err);
    return wallpaper.remoteUrl;
  }
}
