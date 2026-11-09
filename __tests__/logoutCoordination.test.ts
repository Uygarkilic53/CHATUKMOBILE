// In-memory mock for expo-secure-store
const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) || null),
  setItemAsync: jest.fn(async (key: string, val: string) => {
    mockSecureStore.set(key, val);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

jest.mock('../src/lib/auth-client', () => ({
  getOrigin: () => 'http://localhost:3000',
  authClient: {
    getSession: jest.fn(),
  },
  useSession: () => ({
    data: null,
    isPending: false,
  }),
  signOut: jest.fn(),
}));

import { isLoggingOutState, setIsLoggingOut, clearSessionAuth } from '../src/lib/api';
import { appStorage } from '../src/lib/storage';
import * as SecureStore from 'expo-secure-store';

describe('Logout Redundant Redirect & Storage Coordination', () => {
  beforeEach(() => {
    setIsLoggingOut(false);
    mockSecureStore.clear();
    jest.clearAllMocks();
  });

  describe('isLoggingOut State Coordination', () => {
    it('initializes with isLoggingOut as false', () => {
      expect(isLoggingOutState()).toBe(false);
    });

    it('toggles isLoggingOut state correctly', () => {
      setIsLoggingOut(true);
      expect(isLoggingOutState()).toBe(true);

      setIsLoggingOut(false);
      expect(isLoggingOutState()).toBe(false);
    });
  });

  describe('appStorage Memory-First Cache', () => {
    it('returns memory-cached values synchronously on getItem', () => {
      appStorage.setItem('test_sync_key', 'test_sync_val');
      expect(appStorage.getItem('test_sync_key')).toBe('test_sync_val');
    });

    it('returns memory-cached value from getItemAsync without querying SecureStore when already cached', async () => {
      appStorage.setItem('cached_key', 'instant_value');
      
      const val = await appStorage.getItemAsync('cached_key');
      expect(val).toBe('instant_value');
      // SecureStore getItemAsync should NOT be called because memory cache served it
      expect(SecureStore.getItemAsync).not.toHaveBeenCalledWith('cached_key');
    });

    it('falls back to SecureStore when item is not in memory cache and populates memoryCache', async () => {
      mockSecureStore.set('unseen_key', 'from_secure_store');

      const val = await appStorage.getItemAsync('unseen_key');
      expect(val).toBe('from_secure_store');
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith('unseen_key');

      // Next read should hit memoryCache directly
      const cachedVal = await appStorage.getItemAsync('unseen_key');
      expect(cachedVal).toBe('from_secure_store');
      expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1);
    });

    it('deletes item from both memory cache and SecureStore', async () => {
      appStorage.setItem('to_delete', 'some_value');
      expect(appStorage.getItem('to_delete')).toBe('some_value');

      await appStorage.deleteItemAsync('to_delete');
      expect(appStorage.getItem('to_delete')).toBeNull();
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('to_delete');
    });
  });

  describe('clearSessionAuth', () => {
    it('sets chatuk_remember_me to "false" and removes session tokens', async () => {
      appStorage.setItem('chatuk_remember_me', 'true');
      appStorage.setItem('chatuk_cookie', 'some_cookie');

      await clearSessionAuth();

      // Memory cache should immediately reflect chatuk_remember_me = false
      expect(appStorage.getItem('chatuk_remember_me')).toBe('false');
      const asyncRemember = await appStorage.getItemAsync('chatuk_remember_me');
      expect(asyncRemember).toBe('false');

      // Cookie should be deleted
      expect(appStorage.getItem('chatuk_cookie')).toBeNull();
    });
  });
});
