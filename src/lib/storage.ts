import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const memoryCache = new Map<string, string>();

/**
 * Universal storage adapter that works seamlessly on both Native (Expo SecureStore)
 * and Web (localStorage / in-memory fallback).
 */
export const appStorage = {
  getItem: (key: string): string | null => {
    try {
      const cached = memoryCache.get(key);
      if (cached !== undefined && cached !== null) {
        return cached;
      }
      if (Platform.OS === 'web') {
        const item = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
        if (item !== null) {
          memoryCache.set(key, item);
          return item;
        }
      }
      return null;
    } catch {
      return memoryCache.get(key) || null;
    }
  },

  setItem: (key: string, value: string): void => {
    try {
      memoryCache.set(key, value);
      if (Platform.OS === 'web') {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      } else {
        SecureStore.setItemAsync(key, value).catch(() => {});
      }
    } catch {}
  },

  getItemAsync: async (key: string): Promise<string | null> => {
    try {
      // 1. Instant synchronous memory cache lookup
      const cached = memoryCache.get(key);
      if (cached !== undefined && cached !== null) {
        return cached;
      }
      if (Platform.OS === 'web') {
        const item = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
        if (item !== null) {
          memoryCache.set(key, item);
          return item;
        }
      }
      const val = await SecureStore.getItemAsync(key);
      if (val !== null) {
        memoryCache.set(key, val);
        return val;
      }
      return null;
    } catch {
      return memoryCache.get(key) || null;
    }
  },

  setItemAsync: async (key: string, value: string): Promise<void> => {
    try {
      memoryCache.set(key, value);
      if (Platform.OS === 'web') {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      } else {
        await SecureStore.setItemAsync(key, value);
      }
    } catch {}
  },

  deleteItemAsync: async (key: string): Promise<void> => {
    try {
      memoryCache.delete(key);
      if (Platform.OS === 'web') {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
      } else {
        await SecureStore.deleteItemAsync(key);
      }
    } catch {}
  },
};
