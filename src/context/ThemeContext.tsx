import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { ThemeColors, ThemeMode, THEMES, OBSIDIAN_SKY_THEME } from '../constants/theme';
import { appStorage } from '../lib/storage';
import { api } from '../lib/api';
import { useSession } from '../lib/auth-client';

interface ThemeContextType {
  theme: ThemeColors;
  themeMode: ThemeMode;
  setTheme: (mode: ThemeMode) => Promise<void>;
  toggleTheme: () => Promise<void>;
  isSyncing: boolean;
}

const STORAGE_KEY = 'chatuk_selected_theme';

const ThemeContext = createContext<ThemeContextType>({
  theme: OBSIDIAN_SKY_THEME,
  themeMode: 'obsidian-sky',
  setTheme: async () => {},
  toggleTheme: async () => {},
  isSyncing: false,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('obsidian-sky');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const { data: session } = useSession();

  // 1. Initial fast local load from appStorage
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const saved = await appStorage.getItemAsync(STORAGE_KEY);
        if (saved && (saved === 'light' || saved === 'obsidian-sky') && isMounted) {
          setThemeModeState(saved as ThemeMode);
        }
      } catch (e) {
        console.warn('Failed to load local theme cache:', e);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Sync from backend account when authenticated
  useEffect(() => {
    let isMounted = true;
    if (!session?.user) return;

    (async () => {
      try {
        const token = (session as any)?.session?.token || (session as any)?.token;
        const res = await api.getProfile(token);
        if (res?.user?.theme && (res.user.theme === 'light' || res.user.theme === 'obsidian-sky')) {
          const accountTheme = res.user.theme as ThemeMode;
          if (isMounted) {
            setThemeModeState(accountTheme);
            await appStorage.setItemAsync(STORAGE_KEY, accountTheme);
          }
        }
      } catch (err) {
        // Silent fail if offline or initial load
        console.warn('Could not sync user theme from account:', err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [session]);

  const setTheme = useCallback(
    async (mode: ThemeMode) => {
      setThemeModeState(mode);
      setIsSyncing(true);

      try {
        // Save locally first
        await appStorage.setItemAsync(STORAGE_KEY, mode);

        // Save to user account if logged in
        if (session?.user) {
          const token = (session as any)?.session?.token || (session as any)?.token;
          await api.updateTheme(mode, token);
        }
      } catch (err) {
        console.warn('Failed to persist theme to account:', err);
      } finally {
        setIsSyncing(false);
      }
    },
    [session]
  );

  const toggleTheme = useCallback(async () => {
    const nextMode: ThemeMode = themeMode === 'light' ? 'obsidian-sky' : 'light';
    await setTheme(nextMode);
  }, [themeMode, setTheme]);

  const activeTheme = THEMES[themeMode] || OBSIDIAN_SKY_THEME;

  return (
    <ThemeContext.Provider
      value={{
        theme: activeTheme,
        themeMode,
        setTheme,
        toggleTheme,
        isSyncing,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
