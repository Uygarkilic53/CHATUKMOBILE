import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { appStorage } from '../lib/storage';
import { api } from '../lib/api';

export type SenderToneId = 'sending1' | 'sending2' | 'sending3' | 'silent';
export type ReceiverToneId = 'default' | 'silent';

export interface UserPreferences {
  // Privacy
  readReceipts: boolean;
  showLastSeen: boolean;
  // Notifications & Sounds
  inAppSounds: boolean;
  sentMessageSound: boolean;
  senderTone: SenderToneId;
  receiverTone: ReceiverToneId;
  notificationTone: string;
  vibration: boolean;
  hapticFeedback: boolean;
  inAppBanners: boolean;
  messagePreview: boolean;
  callRingtone: boolean;
  callVibration: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  readReceipts: true,
  showLastSeen: true,
  inAppSounds: true,
  sentMessageSound: true,
  senderTone: 'sending1',
  receiverTone: 'default',
  notificationTone: 'default',
  vibration: true,
  hapticFeedback: true,
  inAppBanners: true,
  messagePreview: true,
  callRingtone: true,
  callVibration: true,
};

export interface PreferencesContextType {
  preferences: UserPreferences;
  isLoading: boolean;
  updatePreferences: (partial: Partial<UserPreferences>) => Promise<void>;
  resetPreferences: () => Promise<void>;
}

const STORAGE_KEY = 'chatuk_user_preferences';

const PreferencesContext = createContext<PreferencesContextType>({
  preferences: DEFAULT_PREFERENCES,
  isLoading: false,
  updatePreferences: async () => {},
  resetPreferences: async () => {},
});

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const isSyncingBackend = useRef<boolean>(false);

  // Load preferences from local storage and sync with backend on boot
  useEffect(() => {
    let isMounted = true;

    const loadPreferences = async () => {
      try {
        // 1. Instant local cache load
        const cached = await appStorage.getItemAsync(STORAGE_KEY);
        if (cached && isMounted) {
          try {
            const parsed = JSON.parse(cached);
            const initial = { ...DEFAULT_PREFERENCES, ...parsed };
            setPreferences(initial);
            appStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
          } catch {}
        }

        // 2. Background sync from backend
        const res = await api.getUserPreferences().catch(() => null);
        if (res?.preferences && isMounted) {
          const merged: UserPreferences = {
            ...DEFAULT_PREFERENCES,
            ...res.preferences,
          };
          setPreferences(merged);
          appStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          await appStorage.setItemAsync(STORAGE_KEY, JSON.stringify(merged));
        }
      } catch (err) {
        console.warn('[PreferencesContext] Error loading preferences:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadPreferences();

    return () => {
      isMounted = false;
    };
  }, []);

  const updatePreferences = useCallback(async (partial: Partial<UserPreferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...partial };
      // Synchronous in-memory & async durable storage update
      appStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      appStorage.setItemAsync(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });

    // Sync to backend
    if (!isSyncingBackend.current) {
      isSyncingBackend.current = true;
      try {
        await api.updateUserPreferences(partial);
      } catch (err) {
        console.warn('[PreferencesContext] Background sync to server failed:', err);
      } finally {
        isSyncingBackend.current = false;
      }
    }
  }, []);

  const resetPreferences = useCallback(async () => {
    setPreferences(DEFAULT_PREFERENCES);
    appStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PREFERENCES));
    await appStorage.setItemAsync(STORAGE_KEY, JSON.stringify(DEFAULT_PREFERENCES)).catch(() => {});
    try {
      await api.updateUserPreferences(DEFAULT_PREFERENCES);
    } catch (err) {
      console.warn('[PreferencesContext] Reset preferences sync failed:', err);
    }
  }, []);

  return (
    <PreferencesContext.Provider
      value={{
        preferences,
        isLoading,
        updatePreferences,
        resetPreferences,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
};

export const usePreferences = (): PreferencesContextType => {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
};
