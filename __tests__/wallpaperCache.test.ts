import {
  initWallpaperDatabase,
  getCachedWallpapers,
  getWallpaperPreference,
  saveWallpaperPreference,
  getPendingWallpaperSyncs,
  markWallpaperSynced,
  markWallpaperSyncing,
  markWallpaperFailed,
} from '../src/services/wallpaperCacheService';
import * as localDb from '../src/e2ee/localDb';
import { appStorage } from '../src/lib/storage';
import { WALLPAPERS, DEFAULT_WALLPAPER_ID } from '../src/constants/wallpapers';

// In-memory mock tables for SQLite
interface MockWallpaperRow {
  id: string;
  name: string;
  category: string;
  aesthetic: string;
  dominantColor: string;
  assetType: string;
  remoteUrl: string | null;
  localUri: string | null;
  bundledSourceKey: string | null;
  fileSizeBytes: number;
  isAvailableOffline: number;
  version: number;
  createdAt: number;
  updatedAt: number;
}

interface MockSettingRow {
  userId: string;
  scope: string;
  wallpaperId: string;
  syncStatus: 'synced' | 'pending' | 'syncing' | 'failed';
  updatedAt: number;
  lastSyncedAt: number | null;
}

const mockWallpapersCache = new Map<string, MockWallpaperRow>();
const mockWallpaperSettings = new Map<string, MockSettingRow>();
const mockStorageMap = new Map<string, string>();

jest.mock('../src/e2ee/localDb', () => ({
  runDbExclusive: jest.fn((fn: () => any) => fn()),
  getLocalDb: jest.fn(async () => ({
    getAllAsync: jest.fn(async (query: string) => {
      if (query.includes('FROM wallpapers_cache')) {
        return Array.from(mockWallpapersCache.values());
      }
      if (query.includes("FROM wallpaper_settings WHERE syncStatus = 'pending'")) {
        return Array.from(mockWallpaperSettings.values()).filter(
          (s) => s.syncStatus === 'pending'
        );
      }
      return [];
    }),
    getFirstAsync: jest.fn(async (query: string, params: any[]) => {
      if (query.includes('FROM wallpapers_cache WHERE id = ?')) {
        const [id] = params;
        return mockWallpapersCache.get(id) || null;
      }
      if (query.includes('FROM wallpaper_settings WHERE userId = ? AND scope = ?')) {
        const [userId, scope] = params;
        return mockWallpaperSettings.get(`${userId}_${scope}`) || null;
      }
      return null;
    }),
    runAsync: jest.fn(async (query: string, params: any[]) => {
      if (query.includes('INSERT OR IGNORE INTO wallpapers_cache') || query.includes('INSERT INTO wallpapers_cache')) {
        const [
          id,
          name,
          category,
          aesthetic,
          dominantColor,
          assetType,
          remoteUrl,
          localUri,
          bundledSourceKey,
          fileSizeBytes,
          isAvailableOffline,
          version,
          createdAt,
          updatedAt,
        ] = params;
        if (!mockWallpapersCache.has(id)) {
          mockWallpapersCache.set(id, {
            id,
            name,
            category,
            aesthetic,
            dominantColor,
            assetType,
            remoteUrl: remoteUrl || null,
            localUri: localUri || null,
            bundledSourceKey: bundledSourceKey || id,
            fileSizeBytes: fileSizeBytes || 0,
            isAvailableOffline: isAvailableOffline !== undefined ? isAvailableOffline : 1,
            version: version || 1,
            createdAt: createdAt || Date.now(),
            updatedAt: updatedAt || Date.now(),
          });
        }
      } else if (query.includes('INSERT INTO wallpaper_settings')) {
        const [userId, scope, wallpaperId, syncStatus, updatedAt, lastSyncedAt] = params;
        mockWallpaperSettings.set(`${userId}_${scope}`, {
          userId,
          scope,
          wallpaperId,
          syncStatus,
          updatedAt,
          lastSyncedAt: lastSyncedAt || null,
        });
      } else if (query.includes("UPDATE wallpaper_settings SET syncStatus = 'synced'")) {
        const [lastSyncedAt, userId, scope] = params;
        const key = `${userId}_${scope}`;
        const existing = mockWallpaperSettings.get(key);
        if (existing) {
          mockWallpaperSettings.set(key, {
            ...existing,
            syncStatus: 'synced',
            lastSyncedAt,
          });
        }
      } else if (query.includes("UPDATE wallpaper_settings SET syncStatus = 'syncing'")) {
        const [userId, scope] = params;
        const key = `${userId}_${scope}`;
        const existing = mockWallpaperSettings.get(key);
        if (existing) {
          mockWallpaperSettings.set(key, { ...existing, syncStatus: 'syncing' });
        }
      } else if (query.includes("UPDATE wallpaper_settings SET syncStatus = 'failed'")) {
        const [userId, scope] = params;
        const key = `${userId}_${scope}`;
        const existing = mockWallpaperSettings.get(key);
        if (existing) {
          mockWallpaperSettings.set(key, { ...existing, syncStatus: 'failed' });
        }
      }
      return { changes: 1 };
    }),
  })),
}));

jest.mock('../src/lib/storage', () => ({
  appStorage: {
    getItemAsync: jest.fn(async (key: string) => mockStorageMap.get(key) || null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      mockStorageMap.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      mockStorageMap.delete(key);
    }),
  },
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///data/user/0/com.chatuk/files/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  downloadAsync: jest.fn().mockResolvedValue({ status: 200 }),
}));

describe('WallpaperCacheService & Offline Sync Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWallpapersCache.clear();
    mockWallpaperSettings.clear();
    mockStorageMap.clear();
  });

  it('1. Initializes SQLite database and seeds default wallpapers', async () => {
    await initWallpaperDatabase();

    const wallpapers = await getCachedWallpapers();
    expect(wallpapers.length).toBeGreaterThanOrEqual(WALLPAPERS.length);

    const defaultPreset = wallpapers.find((w) => w.id === DEFAULT_WALLPAPER_ID);
    expect(defaultPreset).toBeDefined();
    expect(defaultPreset?.name).toBe('Default (None)');

    const auroraPreset = wallpapers.find((w) => w.id === 'wallpaper_aurora');
    expect(auroraPreset).toBeDefined();
    expect(auroraPreset?.category).toBe('Dark / Celestial');
    expect(auroraPreset?.isAvailableOffline).toBe(true);
  });

  it('2. Saves wallpaper preference offline with pending sync status', async () => {
    const userId = 'usr_offline_456';
    const wallpaperId = 'wallpaper_midnight';
    const timestamp = 1730388900000;

    // Save with isOnline = false
    await saveWallpaperPreference(userId, wallpaperId, false, 'global', timestamp);

    const pref = await getWallpaperPreference(userId, 'global');
    expect(pref).not.toBeNull();
    expect(pref?.wallpaperId).toBe(wallpaperId);
    expect(pref?.syncStatus).toBe('pending');
    expect(pref?.updatedAt).toBe(timestamp);

    // Verify it appears in pending queue
    const pendingList = await getPendingWallpaperSyncs();
    expect(pendingList).toHaveLength(1);
    expect(pendingList[0].userId).toBe(userId);
    expect(pendingList[0].wallpaperId).toBe(wallpaperId);
    expect(pendingList[0].syncStatus).toBe('pending');
  });

  it('3. Marks pending wallpaper setting as synced upon network restoration', async () => {
    const userId = 'usr_sync_789';
    const wallpaperId = 'wallpaper_nordic';

    await saveWallpaperPreference(userId, wallpaperId, false, 'global');
    let pending = await getPendingWallpaperSyncs();
    expect(pending).toHaveLength(1);

    // Reconnection occurs -> syncs
    await markWallpaperSyncing(userId, 'global');
    let pref = await getWallpaperPreference(userId, 'global');
    expect(pref?.syncStatus).toBe('syncing');

    const syncedAt = Date.now();
    await markWallpaperSynced(userId, 'global', syncedAt);

    pref = await getWallpaperPreference(userId, 'global');
    expect(pref?.syncStatus).toBe('synced');
    expect(pref?.lastSyncedAt).toBe(syncedAt);

    pending = await getPendingWallpaperSyncs();
    expect(pending).toHaveLength(0);
  });

  it('4. Handles online preference save immediately marking it synced', async () => {
    const userId = 'usr_online_101';
    const wallpaperId = 'wallpaper_zen';
    const now = Date.now();

    await saveWallpaperPreference(userId, wallpaperId, true, 'global', now);

    const pref = await getWallpaperPreference(userId, 'global');
    expect(pref).not.toBeNull();
    expect(pref?.syncStatus).toBe('synced');
    expect(pref?.wallpaperId).toBe('wallpaper_zen');

    const pending = await getPendingWallpaperSyncs();
    expect(pending).toHaveLength(0);
  });

  it('5. Marks failed syncs so they remain queued for next retry', async () => {
    const userId = 'usr_fail_102';
    const wallpaperId = 'wallpaper_sunset';

    await saveWallpaperPreference(userId, wallpaperId, false, 'global');
    await markWallpaperFailed(userId, 'global');

    const pref = await getWallpaperPreference(userId, 'global');
    expect(pref?.syncStatus).toBe('failed');
  });

  it('6. Fallback behavior: Gracefully falls back when SQLite encounters an error', async () => {
    (localDb.getLocalDb as jest.Mock).mockRejectedValueOnce(
      new Error('Corrupt SQLite database pointer')
    );

    const fallbackWallpapers = await getCachedWallpapers();
    expect(fallbackWallpapers).toBeDefined();
    expect(fallbackWallpapers.length).toBe(WALLPAPERS.length);
    expect(fallbackWallpapers[0].id).toBe(DEFAULT_WALLPAPER_ID);
  });
});
