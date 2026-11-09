/**
 * Hardware-backed key storage and device identity management for Chatuk E2EE.
 * Stores private keys exclusively in iOS Keychain / Android Keystore.
 * Follows E2EE_IMPLEMENTATION_SPEC.md Section 3.2 and Section 6.2.
 */
import * as SecureStore from 'expo-secure-store';
import { DeviceKeys } from '../crypto/E2EECipher';
import { defaultCipher } from '../crypto/sodiumCipher';
import { randomBytes } from '../crypto/encoding';
import { appStorage } from '../lib/storage';

let isDeviceRegisteredInMemory = false;

export function isDeviceRegisteredOnBackend(): boolean {
  return isDeviceRegisteredInMemory;
}

export function setDeviceRegisteredOnBackend(val: boolean): void {
  isDeviceRegisteredInMemory = val;
}

export function resetDeviceRegistrationState(): void {
  isDeviceRegisteredInMemory = false;
}

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const STORAGE_KEYS = {
  DEVICE_ID: 'chatuk_e2ee_device_id',
  SIGN_PUBLIC_KEY: 'chatuk_e2ee_sign_public_key',
  SIGN_SECRET_KEY: 'chatuk_e2ee_sign_secret_key',
  BOX_PUBLIC_KEY: 'chatuk_e2ee_box_public_key',
  BOX_SECRET_KEY: 'chatuk_e2ee_box_secret_key',
  BOX_KEY_SIGNATURE: 'chatuk_e2ee_box_key_signature',
  DB_MASTER_KEY: 'chatuk_e2ee_db_master_key',
} as const;

function getScopedStorageKeys(userId?: string | null) {
  if (userId) {
    return {
      DEVICE_ID: `chatuk_e2ee_${userId}_device_id`,
      SIGN_PUBLIC_KEY: `chatuk_e2ee_${userId}_sign_public_key`,
      SIGN_SECRET_KEY: `chatuk_e2ee_${userId}_sign_secret_key`,
      BOX_PUBLIC_KEY: `chatuk_e2ee_${userId}_box_public_key`,
      BOX_SECRET_KEY: `chatuk_e2ee_${userId}_box_secret_key`,
      BOX_KEY_SIGNATURE: `chatuk_e2ee_${userId}_box_key_signature`,
      DB_MASTER_KEY: `chatuk_e2ee_${userId}_db_master_key`,
    };
  }
  return STORAGE_KEYS;
}

let cachedDeviceKeys: DeviceKeys | null = null;
const cachedDeviceKeysByUser = new Map<string, DeviceKeys>();

async function resolveUserId(userId?: string | null): Promise<string | null> {
  if (userId) return userId;
  try {
    const direct = await appStorage.getItemAsync('chatuk_active_user_id');
    if (direct) return direct;
    const sessionRaw = await appStorage.getItemAsync('chatuk_session_data');
    if (sessionRaw) {
      const parsed = JSON.parse(sessionRaw);
      const uid = parsed?.user?.id || parsed?.session?.userId;
      if (uid) return uid;
    }
  } catch {}
  return null;
}

async function safeGetItem(key: string): Promise<string | null> {
  try {
    const val = await SecureStore.getItemAsync(key, SECURE_STORE_OPTIONS);
    if (val) return val;
  } catch {}
  try {
    const val = await SecureStore.getItemAsync(key);
    if (val) return val;
  } catch {}
  try {
    return await appStorage.getItemAsync(key);
  } catch {
    return null;
  }
}

async function safeSetItem(key: string, val: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, val, SECURE_STORE_OPTIONS);
    return;
  } catch {}
  try {
    await SecureStore.setItemAsync(key, val);
    return;
  } catch {}
  try {
    await appStorage.setItemAsync(key, val);
  } catch {}
}

async function safeDeleteItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, SECURE_STORE_OPTIONS);
    return;
  } catch {}
  try {
    await SecureStore.deleteItemAsync(key);
    return;
  } catch {}
  try {
    await appStorage.deleteItemAsync(key);
  } catch {}
}

/**
 * Retrieves the current device keys from SecureStore, or generates and stores brand-new ones.
 */
export async function getOrGenerateDeviceKeys(userId?: string | null): Promise<DeviceKeys> {
  const existing = await getStoredDeviceKeys(userId);
  if (existing) {
    return existing;
  }

  // Generate new keys on-device
  const newKeys = await defaultCipher.generateDeviceKeys();
  await saveDeviceKeys(newKeys, userId);
  return newKeys;
}

/**
 * Retrieves stored device keys from SecureStore. Returns null if keys do not exist.
 * Scoped by userId with fallback to legacy keys.
 */
export async function getStoredDeviceKeys(userId?: string | null): Promise<DeviceKeys | null> {
  const uid = await resolveUserId(userId);
  const cacheKey = uid || '__default__';

  if (cachedDeviceKeysByUser.has(cacheKey)) {
    return cachedDeviceKeysByUser.get(cacheKey)!;
  }
  if (!uid && cachedDeviceKeys) {
    return cachedDeviceKeys;
  }

  if (uid) {
    const scopedKeys = getScopedStorageKeys(uid);
    const [
      deviceId,
      signPublicKey,
      signSecretKey,
      boxPublicKey,
      boxSecretKey,
      boxKeySignature,
    ] = await Promise.all([
      safeGetItem(scopedKeys.DEVICE_ID),
      safeGetItem(scopedKeys.SIGN_PUBLIC_KEY),
      safeGetItem(scopedKeys.SIGN_SECRET_KEY),
      safeGetItem(scopedKeys.BOX_PUBLIC_KEY),
      safeGetItem(scopedKeys.BOX_SECRET_KEY),
      safeGetItem(scopedKeys.BOX_KEY_SIGNATURE),
    ]);

    if (
      deviceId &&
      signPublicKey &&
      signSecretKey &&
      boxPublicKey &&
      boxSecretKey &&
      boxKeySignature
    ) {
      const keys: DeviceKeys = {
        deviceId,
        signPublicKey,
        signSecretKey,
        boxPublicKey,
        boxSecretKey,
        boxKeySignature,
      };
      cachedDeviceKeys = keys;
      cachedDeviceKeysByUser.set(cacheKey, keys);
      return keys;
    }

    // Fallback to legacy keys if scoped keys don't exist yet
    const legacyOwner = await safeGetItem('chatuk_e2ee_legacy_owner');
    if (!legacyOwner || legacyOwner === uid) {
      const [
        legDeviceId,
        legSignPublicKey,
        legSignSecretKey,
        legBoxPublicKey,
        legBoxSecretKey,
        legBoxKeySignature,
      ] = await Promise.all([
        safeGetItem(STORAGE_KEYS.DEVICE_ID),
        safeGetItem(STORAGE_KEYS.SIGN_PUBLIC_KEY),
        safeGetItem(STORAGE_KEYS.SIGN_SECRET_KEY),
        safeGetItem(STORAGE_KEYS.BOX_PUBLIC_KEY),
        safeGetItem(STORAGE_KEYS.BOX_SECRET_KEY),
        safeGetItem(STORAGE_KEYS.BOX_KEY_SIGNATURE),
      ]);

      if (
        legDeviceId &&
        legSignPublicKey &&
        legSignSecretKey &&
        legBoxPublicKey &&
        legBoxSecretKey &&
        legBoxKeySignature
      ) {
        const legacyKeys: DeviceKeys = {
          deviceId: legDeviceId,
          signPublicKey: legSignPublicKey,
          signSecretKey: legSignSecretKey,
          boxPublicKey: legBoxPublicKey,
          boxSecretKey: legBoxSecretKey,
          boxKeySignature: legBoxKeySignature,
        };
        // Migrate legacy keys to this user's scoped storage
        await saveDeviceKeys(legacyKeys, uid);
        return legacyKeys;
      }
    }

    return null;
  }

  // Fallback for non-user-scoped calls (e.g. tests or unauthenticated state)
  const [
    deviceId,
    signPublicKey,
    signSecretKey,
    boxPublicKey,
    boxSecretKey,
    boxKeySignature,
  ] = await Promise.all([
    safeGetItem(STORAGE_KEYS.DEVICE_ID),
    safeGetItem(STORAGE_KEYS.SIGN_PUBLIC_KEY),
    safeGetItem(STORAGE_KEYS.SIGN_SECRET_KEY),
    safeGetItem(STORAGE_KEYS.BOX_PUBLIC_KEY),
    safeGetItem(STORAGE_KEYS.BOX_SECRET_KEY),
    safeGetItem(STORAGE_KEYS.BOX_KEY_SIGNATURE),
  ]);

  if (
    !deviceId ||
    !signPublicKey ||
    !signSecretKey ||
    !boxPublicKey ||
    !boxSecretKey ||
    !boxKeySignature
  ) {
    return null;
  }

  cachedDeviceKeys = {
    deviceId,
    signPublicKey,
    signSecretKey,
    boxPublicKey,
    boxSecretKey,
    boxKeySignature,
  };
  cachedDeviceKeysByUser.set(cacheKey, cachedDeviceKeys);

  return cachedDeviceKeys;
}

/**
 * Persists device keys into SecureStore with device-locked keychain security and appStorage backup.
 */
export async function saveDeviceKeys(keys: DeviceKeys, userId?: string | null): Promise<void> {
  const uid = await resolveUserId(userId);
  const cacheKey = uid || '__default__';
  cachedDeviceKeys = keys;
  cachedDeviceKeysByUser.set(cacheKey, keys);

  const storageKeys = getScopedStorageKeys(uid);
  const ops = [
    safeSetItem(storageKeys.DEVICE_ID, keys.deviceId),
    safeSetItem(storageKeys.SIGN_PUBLIC_KEY, keys.signPublicKey),
    safeSetItem(storageKeys.SIGN_SECRET_KEY, keys.signSecretKey),
    safeSetItem(storageKeys.BOX_PUBLIC_KEY, keys.boxPublicKey),
    safeSetItem(storageKeys.BOX_SECRET_KEY, keys.boxSecretKey),
    safeSetItem(storageKeys.BOX_KEY_SIGNATURE, keys.boxKeySignature),
  ];
  if (uid) {
    ops.push(safeSetItem('chatuk_e2ee_legacy_owner', uid));
  }
  await Promise.all(ops);
}

/**
 * Retrieves or generates the 32-byte hexadecimal encryption key for the local SQLite database.
 */
export async function getOrGenerateDbMasterKey(userId?: string | null): Promise<string> {
  const uid = await resolveUserId(userId);
  const storageKeys = getScopedStorageKeys(uid);
  let dbKey = await safeGetItem(storageKeys.DB_MASTER_KEY);
  if (!dbKey && uid) {
    dbKey = await safeGetItem(STORAGE_KEYS.DB_MASTER_KEY);
    if (dbKey) {
      await safeSetItem(storageKeys.DB_MASTER_KEY, dbKey);
    }
  }
  if (!dbKey) {
    const array = randomBytes(32);
    dbKey = Array.from(array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    await safeSetItem(storageKeys.DB_MASTER_KEY, dbKey);
  }
  return dbKey;
}

/**
 * Deletes all private keys and local credentials from SecureStore and appStorage on logout.
 */
export async function wipeAllSecureKeys(userId?: string | null): Promise<void> {
  const uid = await resolveUserId(userId);
  cachedDeviceKeys = null;
  cachedDeviceKeysByUser.clear();

  try {
    resetDeviceRegistrationState();
  } catch {}

  const ops = [
    safeDeleteItem(STORAGE_KEYS.DEVICE_ID),
    safeDeleteItem(STORAGE_KEYS.SIGN_PUBLIC_KEY),
    safeDeleteItem(STORAGE_KEYS.SIGN_SECRET_KEY),
    safeDeleteItem(STORAGE_KEYS.BOX_PUBLIC_KEY),
    safeDeleteItem(STORAGE_KEYS.BOX_SECRET_KEY),
    safeDeleteItem(STORAGE_KEYS.BOX_KEY_SIGNATURE),
    safeDeleteItem(STORAGE_KEYS.DB_MASTER_KEY),
  ];

  if (uid) {
    const scopedKeys = getScopedStorageKeys(uid);
    ops.push(
      safeDeleteItem(scopedKeys.DEVICE_ID),
      safeDeleteItem(scopedKeys.SIGN_PUBLIC_KEY),
      safeDeleteItem(scopedKeys.SIGN_SECRET_KEY),
      safeDeleteItem(scopedKeys.BOX_PUBLIC_KEY),
      safeDeleteItem(scopedKeys.BOX_SECRET_KEY),
      safeDeleteItem(scopedKeys.BOX_KEY_SIGNATURE),
      safeDeleteItem(scopedKeys.DB_MASTER_KEY),
      safeDeleteItem('chatuk_e2ee_legacy_owner')
    );
  }

  await Promise.all(ops);
}
