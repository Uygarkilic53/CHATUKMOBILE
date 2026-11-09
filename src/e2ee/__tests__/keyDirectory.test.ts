/**
 * Unit tests for keyDirectory.ts verifying TOFU key pinning and key change detection.
 */
import {
  verifyAndPinContactKey,
  getPinnedKey,
  acknowledgeKeyChange,
  getSafetyNumberForContact,
  UserDeviceRecord,
} from '../keyDirectory';
import { PinnedIdentityKey } from '../localDb';

// In-memory mock DB for identity_keys
const mockIdentityKeys = new Map<string, PinnedIdentityKey>();

jest.mock('../localDb', () => ({
  runDbExclusive: jest.fn((fn: () => any) => fn()),
  getLocalDb: jest.fn(async () => ({
    getFirstAsync: jest.fn(async (query: string, params: any[]) => {
      const [userId] = params;
      return mockIdentityKeys.get(userId) || null;
    }),
    runAsync: jest.fn(async (query: string, params: any[]) => {
      if (query.includes('INSERT INTO identity_keys')) {
        const [userId, signPublicKey, boxPublicKey, firstSeenAt] = params;
        mockIdentityKeys.set(userId, {
          userId,
          signPublicKey,
          boxPublicKey,
          firstSeenAt,
          securityCodeAcknowledged: 1,
        });
      } else if (query.includes('UPDATE identity_keys')) {
        if (query.includes('securityCodeAcknowledged = 1')) {
          const [userId] = params;
          const existing = mockIdentityKeys.get(userId)!;
          mockIdentityKeys.set(userId, {
            ...existing,
            securityCodeAcknowledged: 1,
          });
        } else {
          const [signPublicKey, boxPublicKey, , userId] = params;
          const existing = mockIdentityKeys.get(userId)!;
          mockIdentityKeys.set(userId, {
            ...existing,
            signPublicKey,
            boxPublicKey,
            securityCodeAcknowledged: 0,
          });
        }
      }
    }),
  })),
}));

describe('KeyDirectory TOFU Pinning', () => {
  beforeEach(() => {
    mockIdentityKeys.clear();
    jest.clearAllMocks();
  });

  const contactA: UserDeviceRecord = {
    userId: 'user-bob',
    deviceId: 'bob-device-1',
    signPublicKey: 'dGVzdC1zaWduLXBrLTE=',
    boxPublicKey: 'dGVzdC1ib3gtcGstMTIz',
  };

  it('pins contact key on first contact (TOFU)', async () => {
    const res = await verifyAndPinContactKey(contactA);
    expect(res.status).toBe('FIRST_USE');
    expect(res.user.userId).toBe('user-bob');

    const pinned = await getPinnedKey('user-bob');
    expect(pinned).not.toBeNull();
    expect(pinned?.signPublicKey).toBe(contactA.signPublicKey);
    expect(pinned?.securityCodeAcknowledged).toBe(1);
  });

  it('verifies successfully when contact key matches pinned key', async () => {
    await verifyAndPinContactKey(contactA);

    const res2 = await verifyAndPinContactKey(contactA);
    expect(res2.status).toBe('VERIFIED');
  });

  it('detects and flags KEY_CHANGED when contact identity key changes', async () => {
    await verifyAndPinContactKey(contactA);

    const contactANewDevice: UserDeviceRecord = {
      userId: 'user-bob',
      deviceId: 'bob-device-2',
      signPublicKey: 'TkVXLVNJR04tUFVCTElD', // Changed key!
      boxPublicKey: 'TkVXLUJPWC1QVUJMSUM=',
    };

    const res = await verifyAndPinContactKey(contactANewDevice);
    expect(res.status).toBe('KEY_CHANGED');
    expect(res.previousKey).toBe(contactA.signPublicKey);

    const pinned = await getPinnedKey('user-bob');
    expect(pinned?.signPublicKey).toBe('TkVXLVNJR04tUFVCTElD');
    expect(pinned?.securityCodeAcknowledged).toBe(0);

    // User acknowledges the changed security code
    await acknowledgeKeyChange('user-bob');
    const acknowledged = await getPinnedKey('user-bob');
    expect(acknowledged?.securityCodeAcknowledged).toBe(1);
  });

  it('generates a 60-digit safety number between two user keys', async () => {
    const myKey = 'TUlORV9TSUdOX1BLXzEyMzQ1Njc4OQ==';
    const sn = await getSafetyNumberForContact(myKey, contactA.signPublicKey);
    expect(sn).toBeDefined();
    expect(sn.split(' ')).toHaveLength(12);
  });
});
