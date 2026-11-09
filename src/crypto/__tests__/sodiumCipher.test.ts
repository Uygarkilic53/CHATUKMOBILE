/**
 * Comprehensive test suite for SodiumCipher adhering to E2EE_IMPLEMENTATION_SPEC.md Phase 1 exit criteria.
 */
import { SodiumCipher } from '../sodiumCipher';
import { PlainPayload } from '../E2EECipher';
import { ensureSodiumReady, toBase64, fromBase64, utf8ToBytes } from '../encoding';

describe('SodiumCipher Phase 1 Verification', () => {
  let cipher: SodiumCipher;
  let aliceKeys: any;
  let bobKeys: any;
  let charlieKeys: any; // Device not in conversation

  beforeAll(async () => {
    await ensureSodiumReady();
    cipher = new SodiumCipher();

    aliceKeys = await cipher.generateDeviceKeys();
    bobKeys = await cipher.generateDeviceKeys();
    charlieKeys = await cipher.generateDeviceKeys();
  });

  describe('Key Generation & Binding', () => {
    it('generates valid key pairs and a verified box key binding signature', async () => {
      const keys = await cipher.generateDeviceKeys();
      expect(keys.deviceId).toBeDefined();
      expect(typeof keys.deviceId).toBe('string');
      expect(keys.deviceId.length).toBe(36); // UUIDv4 format

      const sodium = await ensureSodiumReady();
      const bindingData = utf8ToBytes(`e2ee-v1-boxkey|${keys.deviceId}|${keys.boxPublicKey}`);
      const isSigValid = sodium.crypto_sign_verify_detached(
        fromBase64(keys.boxKeySignature),
        bindingData,
        fromBase64(keys.signPublicKey)
      );
      expect(isSigValid).toBe(true);
    });

    it('rejects tampered deviceId or boxPublicKey in key binding signature', async () => {
      const keys = await cipher.generateDeviceKeys();
      const sodium = await ensureSodiumReady();

      const tamperedData = utf8ToBytes(`e2ee-v1-boxkey|tampered-device-id|${keys.boxPublicKey}`);
      const isSigValid = sodium.crypto_sign_verify_detached(
        fromBase64(keys.boxKeySignature),
        tamperedData,
        fromBase64(keys.signPublicKey)
      );
      expect(isSigValid).toBe(false);
    });
  });

  describe('Round-Trip Encryption & Decryption', () => {
    const testLengths = [0, 1, 159, 160, 161, 10000];

    test.each(testLengths)('successfully encrypts and decrypts text payload of length %i', async (len) => {
      const bodyText = 'A'.repeat(len);
      const plaintext: PlainPayload = {
        kind: 'text',
        body: bodyText,
        sentAt: Date.now(),
      };

      const conversationId = 'conv-123';
      const clientMessageId = 'msg-uuid-456';
      const senderId = 'user-alice';
      const type = 'text';

      const encryptedPackage = await cipher.encryptMessage({
        plaintextPayload: plaintext,
        conversationId,
        clientMessageId,
        senderId,
        senderDeviceId: aliceKeys.deviceId,
        type,
        recipientDevices: [
          { userId: 'user-alice', deviceId: aliceKeys.deviceId, boxPublicKey: aliceKeys.boxPublicKey },
          { userId: 'user-bob', deviceId: bobKeys.deviceId, boxPublicKey: bobKeys.boxPublicKey },
        ],
        signSecretKey: aliceKeys.signSecretKey,
        boxSecretKey: aliceKeys.boxSecretKey,
      });

      expect(encryptedPackage.encrypted.v).toBe(1);
      expect(encryptedPackage.envelopes).toHaveLength(2);

      // 1. Bob decrypts his envelope
      const bobEnvelope = encryptedPackage.envelopes.find((e) => e.deviceId === bobKeys.deviceId)!;
      const bobDecrypted = await cipher.decryptMessage({
        conversationId,
        clientMessageId,
        senderId,
        type,
        encrypted: encryptedPackage.encrypted,
        envelope: bobEnvelope,
        senderSignPublicKey: aliceKeys.signPublicKey,
        senderBoxPublicKey: aliceKeys.boxPublicKey,
        recipientBoxSecretKey: bobKeys.boxSecretKey,
      });

      expect(bobDecrypted.kind).toBe('text');
      expect(bobDecrypted.body).toBe(bodyText);

      // 2. Alice decrypts her own envelope (for history reload)
      const aliceEnvelope = encryptedPackage.envelopes.find((e) => e.deviceId === aliceKeys.deviceId)!;
      const aliceDecrypted = await cipher.decryptMessage({
        conversationId,
        clientMessageId,
        senderId,
        type,
        encrypted: encryptedPackage.encrypted,
        envelope: aliceEnvelope,
        senderSignPublicKey: aliceKeys.signPublicKey,
        senderBoxPublicKey: aliceKeys.boxPublicKey,
        recipientBoxSecretKey: aliceKeys.boxSecretKey,
      });

      expect(aliceDecrypted.body).toBe(bodyText);
    });

    it('encrypts and decrypts structured reactions and control payloads', async () => {
      const reactionPayload: PlainPayload = {
        kind: 'reaction',
        reaction: {
          targetClientMessageId: 'target-msg-789',
          emoji: '❤️',
          action: 'add',
        },
        sentAt: Date.now(),
      };

      const encrypted = await cipher.encryptMessage({
        plaintextPayload: reactionPayload,
        conversationId: 'c1',
        clientMessageId: 'r1',
        senderId: 'alice',
        senderDeviceId: aliceKeys.deviceId,
        type: 'reaction',
        recipientDevices: [{ userId: 'bob', deviceId: bobKeys.deviceId, boxPublicKey: bobKeys.boxPublicKey }],
        signSecretKey: aliceKeys.signSecretKey,
        boxSecretKey: aliceKeys.boxSecretKey,
      });

      const decrypted = await cipher.decryptMessage({
        conversationId: 'c1',
        clientMessageId: 'r1',
        senderId: 'alice',
        type: 'reaction',
        encrypted: encrypted.encrypted,
        envelope: encrypted.envelopes[0],
        senderSignPublicKey: aliceKeys.signPublicKey,
        senderBoxPublicKey: aliceKeys.boxPublicKey,
        recipientBoxSecretKey: bobKeys.boxSecretKey,
      });

      expect(decrypted.kind).toBe('reaction');
      expect(decrypted.reaction?.emoji).toBe('❤️');
      expect(decrypted.reaction?.targetClientMessageId).toBe('target-msg-789');
    });
  });

  describe('Negative & Tamper Tests', () => {
    let validPackage: any;
    const conversationId = 'conv-test';
    const clientMessageId = 'msg-uuid-999';
    const senderId = 'alice';
    const type = 'text';

    beforeEach(async () => {
      validPackage = await cipher.encryptMessage({
        plaintextPayload: { kind: 'text', body: 'Sensitive message', sentAt: 1000 },
        conversationId,
        clientMessageId,
        senderId,
        senderDeviceId: aliceKeys.deviceId,
        type,
        recipientDevices: [{ userId: 'bob', deviceId: bobKeys.deviceId, boxPublicKey: bobKeys.boxPublicKey }],
        signSecretKey: aliceKeys.signSecretKey,
        boxSecretKey: aliceKeys.boxSecretKey,
      });
    });

    it('fails when ciphertext (ct) is tampered', async () => {
      const tamperedEncrypted = { ...validPackage.encrypted };
      const ctBytes = fromBase64(tamperedEncrypted.ct);
      ctBytes[0] ^= 0xff; // Flip bits
      tamperedEncrypted.ct = toBase64(ctBytes);

      await expect(
        cipher.decryptMessage({
          conversationId,
          clientMessageId,
          senderId,
          type,
          encrypted: tamperedEncrypted,
          envelope: validPackage.envelopes[0],
          senderSignPublicKey: aliceKeys.signPublicKey,
          senderBoxPublicKey: aliceKeys.boxPublicKey,
          recipientBoxSecretKey: bobKeys.boxSecretKey,
        })
      ).rejects.toThrow('SIGNATURE_VERIFICATION_FAILED');
    });

    it('fails when nonce is tampered', async () => {
      const tamperedEncrypted = { ...validPackage.encrypted };
      const nonceBytes = fromBase64(tamperedEncrypted.nonce);
      nonceBytes[0] ^= 0xff;
      tamperedEncrypted.nonce = toBase64(nonceBytes);

      await expect(
        cipher.decryptMessage({
          conversationId,
          clientMessageId,
          senderId,
          type,
          encrypted: tamperedEncrypted,
          envelope: validPackage.envelopes[0],
          senderSignPublicKey: aliceKeys.signPublicKey,
          senderBoxPublicKey: aliceKeys.boxPublicKey,
          recipientBoxSecretKey: bobKeys.boxSecretKey,
        })
      ).rejects.toThrow('SIGNATURE_VERIFICATION_FAILED');
    });

    it('fails when signature (sig) is tampered', async () => {
      const tamperedEncrypted = { ...validPackage.encrypted };
      const sigBytes = fromBase64(tamperedEncrypted.sig);
      sigBytes[0] ^= 0x01;
      tamperedEncrypted.sig = toBase64(sigBytes);

      await expect(
        cipher.decryptMessage({
          conversationId,
          clientMessageId,
          senderId,
          type,
          encrypted: tamperedEncrypted,
          envelope: validPackage.envelopes[0],
          senderSignPublicKey: aliceKeys.signPublicKey,
          senderBoxPublicKey: aliceKeys.boxPublicKey,
          recipientBoxSecretKey: bobKeys.boxSecretKey,
        })
      ).rejects.toThrow('SIGNATURE_VERIFICATION_FAILED');
    });

    it('fails when wrappedKey in envelope is tampered', async () => {
      const tamperedEnvelope = { ...validPackage.envelopes[0] };
      const wrappedBytes = fromBase64(tamperedEnvelope.wrappedKey);
      wrappedBytes[0] ^= 0xff;
      tamperedEnvelope.wrappedKey = toBase64(wrappedBytes);

      await expect(
        cipher.decryptMessage({
          conversationId,
          clientMessageId,
          senderId,
          type,
          encrypted: validPackage.encrypted,
          envelope: tamperedEnvelope,
          senderSignPublicKey: aliceKeys.signPublicKey,
          senderBoxPublicKey: aliceKeys.boxPublicKey,
          recipientBoxSecretKey: bobKeys.boxSecretKey,
        })
      ).rejects.toThrow('KEY_UNWRAP_FAILED');
    });

    it('fails when AAD field (conversationId) is altered', async () => {
      await expect(
        cipher.decryptMessage({
          conversationId: 'different-conversation-id',
          clientMessageId,
          senderId,
          type,
          encrypted: validPackage.encrypted,
          envelope: validPackage.envelopes[0],
          senderSignPublicKey: aliceKeys.signPublicKey,
          senderBoxPublicKey: aliceKeys.boxPublicKey,
          recipientBoxSecretKey: bobKeys.boxSecretKey,
        })
      ).rejects.toThrow('SIGNATURE_VERIFICATION_FAILED');
    });

    it('fails when AAD field (clientMessageId) is altered', async () => {
      await expect(
        cipher.decryptMessage({
          conversationId,
          clientMessageId: 'replay-message-id',
          senderId,
          type,
          encrypted: validPackage.encrypted,
          envelope: validPackage.envelopes[0],
          senderSignPublicKey: aliceKeys.signPublicKey,
          senderBoxPublicKey: aliceKeys.boxPublicKey,
          recipientBoxSecretKey: bobKeys.boxSecretKey,
        })
      ).rejects.toThrow('SIGNATURE_VERIFICATION_FAILED');
    });

    it('fails when AAD field (senderId) is altered', async () => {
      await expect(
        cipher.decryptMessage({
          conversationId,
          clientMessageId,
          senderId: 'impersonated-user',
          type,
          encrypted: validPackage.encrypted,
          envelope: validPackage.envelopes[0],
          senderSignPublicKey: aliceKeys.signPublicKey,
          senderBoxPublicKey: aliceKeys.boxPublicKey,
          recipientBoxSecretKey: bobKeys.boxSecretKey,
        })
      ).rejects.toThrow('SIGNATURE_VERIFICATION_FAILED');
    });

    it('fails when wrong sender signing key is provided', async () => {
      await expect(
        cipher.decryptMessage({
          conversationId,
          clientMessageId,
          senderId,
          type,
          encrypted: validPackage.encrypted,
          envelope: validPackage.envelopes[0],
          senderSignPublicKey: charlieKeys.signPublicKey, // Wrong sender key!
          senderBoxPublicKey: aliceKeys.boxPublicKey,
          recipientBoxSecretKey: bobKeys.boxSecretKey,
        })
      ).rejects.toThrow('SIGNATURE_VERIFICATION_FAILED');
    });

    it('prevents a device not in the recipient set from decrypting', async () => {
      // Charlie tries to unwrap Bob's envelope with Charlie's secret key
      await expect(
        cipher.decryptMessage({
          conversationId,
          clientMessageId,
          senderId,
          type,
          encrypted: validPackage.encrypted,
          envelope: validPackage.envelopes[0],
          senderSignPublicKey: aliceKeys.signPublicKey,
          senderBoxPublicKey: aliceKeys.boxPublicKey,
          recipientBoxSecretKey: charlieKeys.boxSecretKey, // Charlie's key
        })
      ).rejects.toThrow('KEY_UNWRAP_FAILED');
    });
  });

  describe('Randomness & Nonce Uniqueness', () => {
    it('produces distinct ciphertexts, nonces, and wrapped keys for two encryptions of the same plaintext', async () => {
      const payload: PlainPayload = { kind: 'text', body: 'Identical plaintext', sentAt: 1000 };
      const params = {
        plaintextPayload: payload,
        conversationId: 'c1',
        clientMessageId: 'm1',
        senderId: 'alice',
        senderDeviceId: aliceKeys.deviceId,
        type: 'text',
        recipientDevices: [{ userId: 'bob', deviceId: bobKeys.deviceId, boxPublicKey: bobKeys.boxPublicKey }],
        signSecretKey: aliceKeys.signSecretKey,
        boxSecretKey: aliceKeys.boxSecretKey,
      };

      const enc1 = await cipher.encryptMessage(params);
      const enc2 = await cipher.encryptMessage(params);

      // Ciphertext must differ due to random contentKey and random nonce
      expect(enc1.encrypted.ct).not.toBe(enc2.encrypted.ct);
      expect(enc1.encrypted.nonce).not.toBe(enc2.encrypted.nonce);
      expect(enc1.envelopes[0].wrappedKey).not.toBe(enc2.envelopes[0].wrappedKey);
      expect(enc1.envelopes[0].nonce).not.toBe(enc2.envelopes[0].nonce);
    });
  });

  describe('Attachment Encryption', () => {
    it('encrypts and decrypts binary attachment files round-trip', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 42, 99, 255]);
      const { blob, key } = await cipher.encryptFile(data);

      expect(blob.length).toBeGreaterThan(data.length);
      expect(key.length).toBe(32);

      const decrypted = await cipher.decryptFile(blob, key);
      expect(decrypted).toEqual(data);
    });

    it('rejects tampered file attachment ciphertext', async () => {
      const data = new Uint8Array(1024).fill(0xaa);
      const { blob, key } = await cipher.encryptFile(data);

      // Tamper byte in ciphertext
      blob[30] ^= 0x01;

      await expect(cipher.decryptFile(blob, key)).rejects.toThrow();
    });
  });

  describe('Safety Number Verification', () => {
    it('is symmetric and deterministic regardless of key order', async () => {
      const sn1 = await cipher.safetyNumber(aliceKeys.signPublicKey, bobKeys.signPublicKey);
      const sn2 = await cipher.safetyNumber(bobKeys.signPublicKey, aliceKeys.signPublicKey);

      expect(sn1).toBe(sn2);
      // 12 groups of 5 digits separated by spaces: 12 * 5 + 11 = 71 characters
      expect(sn1.length).toBe(71);
      const groups = sn1.split(' ');
      expect(groups).toHaveLength(12);
      for (const g of groups) {
        expect(g).toMatch(/^\d{5}$/);
      }
    });

    it('produces different safety numbers for different key pairs', async () => {
      const snAB = await cipher.safetyNumber(aliceKeys.signPublicKey, bobKeys.signPublicKey);
      const snAC = await cipher.safetyNumber(aliceKeys.signPublicKey, charlieKeys.signPublicKey);

      expect(snAB).not.toBe(snAC);
    });
  });
});
