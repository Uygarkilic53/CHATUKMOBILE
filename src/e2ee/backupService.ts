/**
 * Zero-Knowledge Encrypted Cloud Backup Service.
 * Follows E2EE_IMPLEMENTATION_SPEC.md Section 3.10.
 *
 * Derives symmetric backup keys client-side using Argon2id (crypto_pwhash),
 * encrypts the local message database snapshot using XChaCha20-Poly1305,
 * and uploads/downloads the opaque blob to/from cloud storage.
 * Neither the password nor the derived key is ever transmitted to the server.
 */
import { argon2id } from '@noble/hashes/argon2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import {
  utf8ToBytes,
  bytesToUtf8,
  toBase64,
  fromBase64,
  wipeBytes,
  randomBytes,
} from '../crypto/encoding';
import { getAllStoredMessages, restoreMessagesBatch, StoredMessage } from './localDb';
import { getOrigin } from '../lib/auth-client';
import { getSessionAuth } from '../lib/api';

const BACKUP_AAD = 'chatuk-backup-v1';

export interface EncryptedBackupPackage {
  version: number;
  salt: string; // base64, 16 bytes
  nonce: string; // base64, 24 bytes
  ciphertext: string; // base64 AEAD ciphertext
  exportedAt: number;
  messageCount: number;
}

export interface BackupMetadata {
  version: number;
  exportedAt: number;
  updatedAt?: string;
  createdAt?: string;
}

/**
 * Derives a 32-byte encryption key from the user-chosen password and salt using Argon2id.
 */
export async function deriveBackupKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const passwordBytes = utf8ToBytes(password);

  // Derive 32-byte key using Argon2id (interactive: 8 MB memory for smooth mobile experience)
  const isTest = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
  const memLimit = isTest ? 1024 : 8192;
  const key = argon2id(passwordBytes, salt, {
    t: 2,
    m: memLimit,
    p: 1,
    dkLen: 32,
  });

  wipeBytes(passwordBytes);
  return key;
}

/**
 * Exports all local decrypted messages into an encrypted backup blob.
 */
export async function exportEncryptedBackup(password: string): Promise<EncryptedBackupPackage> {
  if (!password || password.length < 6) {
    throw new Error('Backup password must be at least 6 characters long');
  }

  // 1. Fetch all local stored messages
  const messages = await getAllStoredMessages();
  const serialized = JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    messages,
  });
  const serializedBytes = utf8ToBytes(serialized);

  // 2. Generate random 16-byte salt and derive backup key via Argon2id
  const salt = randomBytes(16);
  const derivedKey = await deriveBackupKey(password, salt);

  // 3. Generate random 24-byte nonce
  const nonce = randomBytes(24);
  const aad = utf8ToBytes(BACKUP_AAD);

  // 4. Encrypt snapshot using XChaCha20-Poly1305 AEAD
  const cipher = xchacha20poly1305(derivedKey, nonce, aad);
  const ciphertext = cipher.encrypt(serializedBytes);

  // Clean sensitive bytes from memory
  wipeBytes(serializedBytes);
  wipeBytes(derivedKey);

  return {
    version: 1,
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
    exportedAt: Date.now(),
    messageCount: messages.length,
  };
}

/**
 * Decrypts an encrypted backup package and restores all messages into the local database.
 */
export async function importEncryptedBackup(
  password: string,
  backup: { salt: string; nonce: string; ciphertext: string; version: number }
): Promise<{ restoredCount: number }> {
  if (!password) {
    throw new Error('Password is required to restore backup');
  }

  const salt = fromBase64(backup.salt);
  const nonce = fromBase64(backup.nonce);
  const ciphertext = fromBase64(backup.ciphertext);
  const aad = utf8ToBytes(BACKUP_AAD);

  // 1. Derive key from user password and salt
  const derivedKey = await deriveBackupKey(password, salt);

  // 2. Decrypt ciphertext using XChaCha20-Poly1305 AEAD
  let decryptedBytes: Uint8Array;
  try {
    const cipher = xchacha20poly1305(derivedKey, nonce, aad);
    decryptedBytes = cipher.decrypt(ciphertext);
  } catch {
    wipeBytes(derivedKey);
    throw new Error('Incorrect backup password or corrupted backup file');
  }

  wipeBytes(derivedKey);

  // 3. Parse snapshot JSON
  const jsonStr = bytesToUtf8(decryptedBytes);
  wipeBytes(decryptedBytes);

  let data: { messages: StoredMessage[] };
  try {
    data = JSON.parse(jsonStr);
  } catch {
    throw new Error('Invalid backup data format');
  }

  if (!Array.isArray(data.messages)) {
    throw new Error('Corrupted backup: missing messages array');
  }

  // 4. Restore messages into local SQLite database
  const count = await restoreMessagesBatch(data.messages);
  return { restoredCount: count };
}

/**
 * Exports and uploads an encrypted backup directly to the server.
 */
export async function uploadBackupToServer(password: string): Promise<BackupMetadata> {
  const pkg = await exportEncryptedBackup(password);
  const serverUrl = getOrigin();
  const { token, cookie } = await getSessionAuth();

  const response = await fetch(`${serverUrl}/api/e2ee/backup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({
      version: pkg.version,
      salt: pkg.salt,
      nonce: pkg.nonce,
      ciphertext: pkg.ciphertext,
      exportedAt: pkg.exportedAt,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Backup upload failed (${response.status})`);
  }

  const data = await response.json();
  return data.backup;
}

/**
 * Downloads the user's latest encrypted backup from the server and restores it.
 */
export async function downloadAndRestoreBackupFromServer(
  password: string
): Promise<{ restoredCount: number }> {
  const serverUrl = getOrigin();
  const { token, cookie } = await getSessionAuth();

  const response = await fetch(`${serverUrl}/api/e2ee/backup`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('No cloud backup found on server');
    }
    throw new Error(`Failed to download backup: ${response.status}`);
  }

  const backupData = await response.json();
  return importEncryptedBackup(password, backupData);
}

/**
 * Deletes the encrypted backup from cloud storage.
 */
export async function deleteBackupFromServer(): Promise<void> {
  const serverUrl = getOrigin();
  const { token, cookie } = await getSessionAuth();

  const response = await fetch(`${serverUrl}/api/e2ee/backup`, {
    method: 'DELETE',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to delete backup: ${response.status}`);
  }
}

/**
 * Checks if a remote encrypted backup exists on the server.
 */
export async function checkRemoteBackup(): Promise<{
  exists: boolean;
  exportedAt?: number;
  updatedAt?: string;
  version?: number;
}> {
  try {
    const serverUrl = getOrigin();
    const { token, cookie } = await getSessionAuth();

    const response = await fetch(`${serverUrl}/api/e2ee/backup`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });

    if (response.status === 404) {
      return { exists: false };
    }
    if (!response.ok) {
      return { exists: false };
    }

    const data = await response.json();
    return {
      exists: true,
      exportedAt: data.exportedAt,
      updatedAt: data.updatedAt,
      version: data.version,
    };
  } catch {
    return { exists: false };
  }
}

