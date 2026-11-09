import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import * as Network from 'expo-network';
import { appStorage } from '../lib/storage';
import { getActiveUserId, updateUserWallpaper } from '../lib/api';
import { socketService } from '../services/socket';
import {
  initWallpaperDatabase,
  getWallpaperPreference,
  saveWallpaperPreference,
  getPendingWallpaperSyncs,
  markWallpaperSynced,
  markWallpaperSyncing,
  markWallpaperFailed,
  getCachedWallpapers,
} from '../services/wallpaperCacheService';
import {
  WallpaperItem,
  WALLPAPERS,
  DEFAULT_WALLPAPER_ID,
  getWallpaperById,
} from '../constants/wallpapers';

export interface WallpaperContextType {
  selectedWallpaper: string;
  currentWallpaper: WallpaperItem;
  wallpaperSource: any; // ImageSourcePropType | { uri: string } | number | null
  syncStatus: 'synced' | 'pending' | 'syncing' | 'failed';
  isOffline: boolean;
  setWallpaper: (wallpaperId: string) => Promise<void>;
  resetWallpaper: () => Promise<void>;
  syncPendingWallpapers: () => Promise<void>;
}

const STORAGE_KEY = 'chatuk_chat_wallpaper';

const WallpaperContext = createContext<WallpaperContextType>({
  selectedWallpaper: DEFAULT_WALLPAPER_ID,
  currentWallpaper: WALLPAPERS[0],
  wallpaperSource: null,
  syncStatus: 'synced',
  isOffline: false,
  setWallpaper: async () => {},
  resetWallpaper: async () => {},
  syncPendingWallpapers: async () => {},
});

export const WallpaperProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedWallpaper, setSelectedWallpaperState] = useState<string>(DEFAULT_WALLPAPER_ID);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'pending' | 'syncing' | 'failed'>('synced');
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [cachedWallpapersList, setCachedWallpapersList] = useState<WallpaperItem[]>(WALLPAPERS);

  const isSyncingRef = useRef(false);

  // Helper to determine connectivity
  const checkOnlineStatus = useCallback(async (): Promise<boolean> => {
    try {
      const net = await Network.getNetworkStateAsync();
      const isReachable = Boolean(net.isConnected && net.isInternetReachable !== false);
      const isSocketUp = socketService.isSocketConnected();
      const online = isReachable || isSocketUp;
      setIsOffline(!online);
      return online;
    } catch {
      const isSocketUp = socketService.isSocketConnected();
      setIsOffline(!isSocketUp);
      return isSocketUp;
    }
  }, []);

  // Sync mutation queue with backend
  const syncPendingWallpapers = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    try {
      const online = await checkOnlineStatus();
      if (!online) {
        return;
      }

      const activeUid = (await getActiveUserId().catch(() => null)) || 'local_user';
      const pendingItems = await getPendingWallpaperSyncs();

      if (pendingItems.length === 0) {
        return;
      }

      for (const item of pendingItems) {
        const isCurrentActive = item.userId === activeUid && item.scope === 'global';
        if (isCurrentActive) {
          setSyncStatus('syncing');
        }
        await markWallpaperSyncing(item.userId, item.scope);

        try {
          const res = await updateUserWallpaper(item.wallpaperId, item.updatedAt);
          if (res?.conflict) {
            // Last-Write-Wins: server has newer preference
            if (isCurrentActive && res.serverWallpaper) {
              setSelectedWallpaperState(res.serverWallpaper);
              await saveWallpaperPreference(
                item.userId,
                res.serverWallpaper,
                true,
                item.scope,
                res.serverUpdatedAt || Date.now()
              );
              setSyncStatus('synced');
            } else {
              await markWallpaperSynced(item.userId, item.scope, Date.now());
            }
          } else {
            await markWallpaperSynced(item.userId, item.scope, Date.now());
            socketService.syncWallpaper(item.wallpaperId, item.updatedAt);
            if (isCurrentActive) {
              setSyncStatus('synced');
            }
          }
        } catch (syncErr) {
          console.warn('[WallpaperContext] Failed to sync pending wallpaper:', syncErr);
          await markWallpaperFailed(item.userId, item.scope);
          if (isCurrentActive) {
            setSyncStatus('pending');
          }
        }
      }

      // Re-check active preference status
      const activePref = await getWallpaperPreference(activeUid);
      if (activePref) {
        setSyncStatus(activePref.syncStatus === 'syncing' ? 'pending' : activePref.syncStatus);
      }
    } finally {
      isSyncingRef.current = false;
    }
  }, [checkOnlineStatus]);

  // Bootstrapping: initialize SQLite database & seed presets
  useEffect(() => {
    let isMounted = true;

    (async () => {
      // 1. Instant local read for zero-delay initial frame
      try {
        const saved = await appStorage.getItemAsync(STORAGE_KEY);
        if (saved && isMounted) {
          setSelectedWallpaperState(saved);
        }
      } catch {}

      // 2. Initialize SQLite tables and directory
      await initWallpaperDatabase();

      // 3. Load catalog from SQLite
      try {
        const catalog = await getCachedWallpapers();
        if (isMounted && catalog.length > 0) {
          setCachedWallpapersList(catalog);
        }
      } catch {}

      // 4. Query user preference from SQLite
      try {
        const uid = (await getActiveUserId().catch(() => null)) || 'local_user';
        const pref = await getWallpaperPreference(uid);
        if (pref && isMounted) {
          setSelectedWallpaperState(pref.wallpaperId);
          setSyncStatus(pref.syncStatus === 'syncing' ? 'pending' : pref.syncStatus);
        }
      } catch {}

      // 5. Check connectivity & trigger sync if needed
      if (isMounted) {
        await checkOnlineStatus();
        await syncPendingWallpapers();
      }
    })();

    // 6. Hook into socket reconnect to flush pending syncs
    const unsubConnect = socketService.onConnect(() => {
      checkOnlineStatus();
      syncPendingWallpapers();
    });

    // 7. Hook into remote wallpaper updates broadcasted via Socket.IO
    const unsubUpdate = socketService.onWallpaperUpdated(async (data) => {
      if (!isMounted || !data?.wallpaperId) return;
      setSelectedWallpaperState(data.wallpaperId);
      setSyncStatus('synced');
      const uid = (await getActiveUserId().catch(() => null)) || 'local_user';
      await saveWallpaperPreference(uid, data.wallpaperId, true, 'global', data.updatedAt);
    });

    return () => {
      isMounted = false;
      unsubConnect();
      unsubUpdate();
    };
  }, [checkOnlineStatus, syncPendingWallpapers]);

  // Set wallpaper with optimistic update & offline queue
  const setWallpaper = useCallback(
    async (wallpaperId: string) => {
      // Optimistic update
      setSelectedWallpaperState(wallpaperId);

      const online = await checkOnlineStatus();
      const uid = (await getActiveUserId().catch(() => null)) || 'local_user';
      const now = Date.now();

      if (!online) {
        setSyncStatus('pending');
        await saveWallpaperPreference(uid, wallpaperId, false, 'global', now);
        return;
      }

      // Online path: persist and dispatch to backend
      setSyncStatus('syncing');
      await saveWallpaperPreference(uid, wallpaperId, false, 'global', now);

      try {
        const res = await updateUserWallpaper(wallpaperId, now);
        if (res?.conflict) {
          // Conflict: server is newer
          const serverId = res.serverWallpaper || DEFAULT_WALLPAPER_ID;
          setSelectedWallpaperState(serverId);
          await saveWallpaperPreference(
            uid,
            serverId,
            true,
            'global',
            res.serverUpdatedAt || now
          );
          setSyncStatus('synced');
        } else {
          await markWallpaperSynced(uid, 'global', now);
          socketService.syncWallpaper(wallpaperId, now);
          setSyncStatus('synced');
        }
      } catch (err) {
        console.warn('[WallpaperContext] Failed to save wallpaper online, queued as pending:', err);
        await markWallpaperFailed(uid, 'global');
        setSyncStatus('pending');
      }
    },
    [checkOnlineStatus]
  );

  const resetWallpaper = useCallback(async () => {
    await setWallpaper(DEFAULT_WALLPAPER_ID);
  }, [setWallpaper]);

  const currentWallpaper = useMemo(() => {
    const cached = cachedWallpapersList.find((w) => w.id === selectedWallpaper);
    if (cached) return cached;
    return getWallpaperById(selectedWallpaper);
  }, [selectedWallpaper, cachedWallpapersList]);

  const wallpaperSource = useMemo(() => {
    return currentWallpaper.source;
  }, [currentWallpaper]);

  return (
    <WallpaperContext.Provider
      value={{
        selectedWallpaper,
        currentWallpaper,
        wallpaperSource,
        syncStatus,
        isOffline,
        setWallpaper,
        resetWallpaper,
        syncPendingWallpapers,
      }}
    >
      {children}
    </WallpaperContext.Provider>
  );
};

export const useWallpaper = () => useContext(WallpaperContext);
