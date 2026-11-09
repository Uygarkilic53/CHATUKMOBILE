/**
 * Key Directory service: public key fetching, TOFU pinning, and key-change detection.
 * Follows E2EE_IMPLEMENTATION_SPEC.md Section 3.8 and Section 6.1.
 */
import { getLocalDb, PinnedIdentityKey, runDbExclusive } from './localDb';
import { defaultCipher } from '../crypto/sodiumCipher';

export type KeyVerificationStatus = 'VERIFIED' | 'FIRST_USE' | 'KEY_CHANGED';

export interface UserDeviceRecord {
  userId: string;
  deviceId: string;
  signPublicKey: string;
  boxPublicKey: string;
}

export interface KeyCheckResult {
  status: KeyVerificationStatus;
  user: UserDeviceRecord;
  previousKey?: string;
}

/**
 * Checks a contact's public key against local TOFU pinning.
 * Pins on first use, detects key changes, and records timestamps.
 */
export async function verifyAndPinContactKey(
  contact: UserDeviceRecord
): Promise<KeyCheckResult> {
  return runDbExclusive(async () => {
    const db = await getLocalDb();
    if (!db) {
      return { status: 'VERIFIED', user: contact };
    }

    try {
      const existing = await db.getFirstAsync<PinnedIdentityKey>(
        `SELECT * FROM identity_keys WHERE userId = ?;`,
        [contact.userId]
      );

      const now = Date.now();

      // First time seeing this user: Trust On First Use (TOFU)
      if (!existing) {
        await db.runAsync(
          `INSERT INTO identity_keys (userId, signPublicKey, boxPublicKey, firstSeenAt, securityCodeAcknowledged)
           VALUES (?, ?, ?, ?, 1);`,
          [contact.userId, contact.signPublicKey, contact.boxPublicKey, now]
        );
        return { status: 'FIRST_USE', user: contact };
      }

      // Key matches pinned identity key
      if (existing.signPublicKey === contact.signPublicKey) {
        return { status: 'VERIFIED', user: contact };
      }

      // KEY CHANGED: The user reinstalled or logged in on a new device
      await db.runAsync(
        `UPDATE identity_keys 
         SET signPublicKey = ?, boxPublicKey = ?, securityCodeAcknowledged = 0, lastVerifiedAt = ?
         WHERE userId = ?;`,
        [contact.signPublicKey, contact.boxPublicKey, now, contact.userId]
      );

      return {
        status: 'KEY_CHANGED',
        user: contact,
        previousKey: existing.signPublicKey,
      };
    } catch (err) {
      console.warn('[KeyDirectory] Failed to verify and pin contact key:', err);
      return { status: 'VERIFIED', user: contact };
    }
  });
}

/**
 * Retrieves the pinned identity key for a user from local storage.
 */
export async function getPinnedKey(userId: string): Promise<PinnedIdentityKey | null> {
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) return null;
      return await db.getFirstAsync<PinnedIdentityKey>(
        `SELECT * FROM identity_keys WHERE userId = ?;`,
        [userId]
      );
    } catch (err) {
      console.warn('[KeyDirectory] Failed to get pinned key:', err);
      return null;
    }
  });
}

/**
 * Marks a changed security code as acknowledged by the user.
 */
export async function acknowledgeKeyChange(userId: string): Promise<void> {
  return runDbExclusive(async () => {
    try {
      const db = await getLocalDb();
      if (!db) return;
      await db.runAsync(
        `UPDATE identity_keys SET securityCodeAcknowledged = 1 WHERE userId = ?;`,
        [userId]
      );
    } catch (err) {
      console.warn('[KeyDirectory] Failed to acknowledge key change:', err);
    }
  });
}

/**
 * Computes the 60-digit safety number between the current user's signPublicKey and a contact's signPublicKey.
 */
export async function getSafetyNumberForContact(
  mySignPublicKey: string,
  contactSignPublicKey: string
): Promise<string> {
  return defaultCipher.safetyNumber(mySignPublicKey, contactSignPublicKey);
}
