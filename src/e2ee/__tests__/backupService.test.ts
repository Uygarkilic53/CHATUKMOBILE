import { exportEncryptedBackup, importEncryptedBackup } from '../backupService';
import * as localDb from '../localDb';

jest.mock('../../lib/auth-client', () => ({
  getOrigin: jest.fn(() => 'http://localhost:3000'),
}));

jest.mock('../../lib/api', () => ({
  getSessionAuth: jest.fn().mockResolvedValue({ token: 'mock-token', cookie: null }),
}));

jest.mock('../localDb', () => ({
  getAllStoredMessages: jest.fn(),
  restoreMessagesBatch: jest.fn(),
}));

describe('E2EE Zero-Knowledge Cloud Backup Service', () => {
  const sampleMessages: any[] = [
    {
      id: 1,
      clientMessageId: 'msg_001',
      conversationId: 'conv_123',
      senderId: 'user_alice',
      senderDeviceId: 'dev_alice_1',
      type: 'text',
      kind: 'text',
      body: 'Top secret rendezvous at 0900',
      sentAt: 1700000000,
      isOutgoing: 1,
      deliveryStatus: 'sent',
      createdAt: 1700000000,
    },
    {
      id: 2,
      clientMessageId: 'msg_002',
      conversationId: 'conv_123',
      senderId: 'user_bob',
      senderDeviceId: 'dev_bob_1',
      type: 'text',
      kind: 'text',
      body: 'Roger that, message encrypted.',
      sentAt: 1700000005,
      isOutgoing: 0,
      deliveryStatus: 'delivered',
      createdAt: 1700000005,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (localDb.getAllStoredMessages as jest.Mock).mockResolvedValue(sampleMessages);
    (localDb.restoreMessagesBatch as jest.Mock).mockImplementation((msgs) => Promise.resolve(msgs.length));
  });

  it('exports and restores encrypted backup correctly with correct password', async () => {
    const password = 'SuperSecretUserPassword123!';
    const backupPkg = await exportEncryptedBackup(password);

    expect(backupPkg.version).toBe(1);
    expect(backupPkg.salt).toBeTruthy();
    expect(backupPkg.nonce).toBeTruthy();
    expect(backupPkg.ciphertext).toBeTruthy();
    expect(backupPkg.messageCount).toBe(2);

    // Verify restore
    const result = await importEncryptedBackup(password, backupPkg);
    expect(result.restoredCount).toBe(2);
    expect(localDb.restoreMessagesBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ clientMessageId: 'msg_001', body: 'Top secret rendezvous at 0900' }),
        expect.objectContaining({ clientMessageId: 'msg_002', body: 'Roger that, message encrypted.' }),
      ])
    );
  });

  it('fails decryption if wrong password is provided', async () => {
    const password = 'CorrectPassword999';
    const backupPkg = await exportEncryptedBackup(password);

    await expect(importEncryptedBackup('WrongPassword000', backupPkg)).rejects.toThrow(
      'Incorrect backup password or corrupted backup file'
    );
  });

  it('fails decryption if ciphertext has been tampered with', async () => {
    const password = 'ValidPassword123';
    const backupPkg = await exportEncryptedBackup(password);

    // Flip bits in ciphertext
    const rawCt = Buffer.from(backupPkg.ciphertext, 'base64');
    rawCt[10] ^= 0xff;
    const tamperedPkg = { ...backupPkg, ciphertext: rawCt.toString('base64') };

    await expect(importEncryptedBackup(password, tamperedPkg)).rejects.toThrow(
      'Incorrect backup password or corrupted backup file'
    );
  });

  it('fails decryption if nonce has been tampered with', async () => {
    const password = 'ValidPassword123';
    const backupPkg = await exportEncryptedBackup(password);

    // Flip bits in nonce
    const rawNonce = Buffer.from(backupPkg.nonce, 'base64');
    rawNonce[2] ^= 0xff;
    const tamperedPkg = { ...backupPkg, nonce: rawNonce.toString('base64') };

    await expect(importEncryptedBackup(password, tamperedPkg)).rejects.toThrow(
      'Incorrect backup password or corrupted backup file'
    );
  });
});
