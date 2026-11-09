/**
 * Unit tests for keyStore.ts ensuring secure key generation and persistence.
 */
import * as SecureStore from 'expo-secure-store';
import {
  getOrGenerateDeviceKeys,
  getStoredDeviceKeys,
  getOrGenerateDbMasterKey,
  wipeAllSecureKeys,
} from '../keyStore';

// In-memory mock for expo-secure-store
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) || null),
  setItemAsync: jest.fn(async (key: string, val: string) => {
    mockStore.set(key, val);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

describe('KeyStore Module', () => {
  beforeEach(async () => {
    await wipeAllSecureKeys();
    mockStore.clear();
    jest.clearAllMocks();
  });

  it('generates and stores device keys on first call', async () => {
    expect(await getStoredDeviceKeys()).toBeNull();

    const keys = await getOrGenerateDeviceKeys();
    expect(keys.deviceId).toBeDefined();
    expect(keys.signPublicKey).toBeDefined();
    expect(keys.boxPublicKey).toBeDefined();

    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(6);

    // Second call should return the stored keys without re-generating
    const retrieved = await getOrGenerateDeviceKeys();
    expect(retrieved.deviceId).toBe(keys.deviceId);
    expect(retrieved.signPublicKey).toBe(keys.signPublicKey);
  });

  it('generates a 32-byte hex DB master key and persists it', async () => {
    const key1 = await getOrGenerateDbMasterKey();
    expect(typeof key1).toBe('string');
    expect(key1.length).toBe(64); // 32 bytes in hex = 64 characters

    const key2 = await getOrGenerateDbMasterKey();
    expect(key2).toBe(key1);
  });

  it('wipes all device keys and master key on logout', async () => {
    await getOrGenerateDeviceKeys();
    await getOrGenerateDbMasterKey();
    expect(mockStore.size).toBe(7);

    await wipeAllSecureKeys();
    expect(mockStore.size).toBe(0);
    expect(await getStoredDeviceKeys()).toBeNull();
  });

  it('scopes device keys by userId so multiple accounts do not share the same device identity', async () => {
    const keysA = await getOrGenerateDeviceKeys('user_A');
    const keysB = await getOrGenerateDeviceKeys('user_B');

    expect(keysA.deviceId).toBeDefined();
    expect(keysB.deviceId).toBeDefined();
    expect(keysA.deviceId).not.toBe(keysB.deviceId);

    const retrievedA = await getStoredDeviceKeys('user_A');
    expect(retrievedA?.deviceId).toBe(keysA.deviceId);

    const retrievedB = await getStoredDeviceKeys('user_B');
    expect(retrievedB?.deviceId).toBe(keysB.deviceId);
  });

  it('falls back to legacy keys for existing user and adopts them into scoped keys', async () => {
    mockStore.set('chatuk_e2ee_device_id', 'legacy_device_123');
    mockStore.set('chatuk_e2ee_sign_public_key', 'legacy_sign_pk');
    mockStore.set('chatuk_e2ee_sign_secret_key', 'legacy_sign_sk');
    mockStore.set('chatuk_e2ee_box_public_key', 'legacy_box_pk');
    mockStore.set('chatuk_e2ee_box_secret_key', 'legacy_box_sk');
    mockStore.set('chatuk_e2ee_box_key_signature', 'legacy_box_sig');

    const migrated = await getStoredDeviceKeys('user_migrated');
    expect(migrated?.deviceId).toBe('legacy_device_123');
    expect(migrated?.signPublicKey).toBe('legacy_sign_pk');

    // Scoped storage now contains the adopted deviceId
    expect(mockStore.get('chatuk_e2ee_user_migrated_device_id')).toBe('legacy_device_123');
  });
});

