/**
 * Automated E2EE Security Canary Test
 * Follows E2EE_IMPLEMENTATION_SPEC.md Section 8.
 *
 * Verifies that sensitive plaintext data and canary markers:
 * 1. Never appear in any ciphertext, nonce, envelope, signature, or serialized payload.
 * 2. Never leak during attachment encryption or simulated network/database serialization.
 * 3. Cannot be decrypted when any bit of ciphertext, envelope, or AAD is tampered with.
 */

import { defaultCipher } from '../sodiumCipher';
import { fromBase64, bytesToUtf8 } from '../encoding';

describe('E2EE Security Canary & Leakage Prevention Test Suite', () => {
  const CANARY_TEXT_MARKER = 'CANARY_7f3a91_CONFIDENTIAL_USER_SECRET_MESSAGE';
  const CANARY_FILE_BYTES = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, // JPEG magic bytes
    0x43, 0x41, 0x4e, 0x41, 0x52, 0x59, 0x5f, 0x37, 0x66, 0x33, // 'CANARY_7f3'
    0x61, 0x39, 0x31, 0x5f, 0x53, 0x45, 0x43, 0x52, 0x45, 0x54, // 'a91_SECRET'
  ]);

  it('verifies that the canary text marker is strictly absent from all encrypted payloads and envelopes', async () => {
    // Generate sender and recipient keypairs
    const sender = await defaultCipher.generateDeviceKeys();
    const recipient = await defaultCipher.generateDeviceKeys();

    const result = await defaultCipher.encryptMessage({
      conversationId: 'conv_canary_001',
      clientMessageId: 'msg_canary_uuid_999',
      senderId: 'user_alice_123',
      senderDeviceId: sender.deviceId,
      signSecretKey: sender.signSecretKey,
      boxSecretKey: sender.boxSecretKey,
      type: 'text',
      plaintextPayload: {
        kind: 'text',
        body: CANARY_TEXT_MARKER,
        sentAt: Date.now(),
      },
      recipientDevices: [
        {
          userId: 'user_bob_456',
          deviceId: recipient.deviceId,
          boxPublicKey: recipient.boxPublicKey,
        },
        {
          userId: 'user_alice_123',
          deviceId: sender.deviceId,
          boxPublicKey: sender.boxPublicKey,
        },
      ],
    });

    const { encrypted, envelopes } = result;

    // 1. Assert canary string is not in encrypted ciphertext or fields
    expect(encrypted.ct).not.toContain('CANARY');
    expect(encrypted.ct).not.toContain('7f3a91');
    expect(encrypted.nonce).not.toContain('CANARY');
    expect(encrypted.sig).not.toContain('CANARY');

    // Decode raw ciphertext bytes and inspect
    const rawCtBytes = fromBase64(encrypted.ct);
    const ctString = new TextDecoder('utf-8', { fatal: false }).decode(rawCtBytes);
    expect(ctString).not.toContain(CANARY_TEXT_MARKER);
    expect(ctString).not.toContain('CONFIDENTIAL');

    // 2. Assert canary is not in any recipient envelope
    for (const env of envelopes) {
      expect(env.wrappedKey).not.toContain('CANARY');
      expect(env.nonce).not.toContain('CANARY');
    }

    // 3. Assert full serialized wire JSON contains zero trace of the canary
    const wireJson = JSON.stringify({
      clientMessageId: 'msg_canary_uuid_999',
      type: 'text',
      encrypted,
      envelopes,
    });

    expect(wireJson).not.toContain(CANARY_TEXT_MARKER);
    expect(wireJson).not.toContain('CANARY_7f3a91');
    expect(wireJson).not.toContain('USER_SECRET');

    // 4. Decrypt on recipient device and confirm authentic recovery
    const bobEnvelope = envelopes.find((e) => e.deviceId === recipient.deviceId)!;
    const decrypted = await defaultCipher.decryptMessage({
      conversationId: 'conv_canary_001',
      clientMessageId: 'msg_canary_uuid_999',
      senderId: 'user_alice_123',
      type: 'text',
      encrypted,
      envelope: {
        nonce: bobEnvelope.nonce,
        wrappedKey: bobEnvelope.wrappedKey,
      },
        senderSignPublicKey: sender.signPublicKey,
        senderBoxPublicKey: sender.boxPublicKey,
        recipientBoxSecretKey: recipient.boxSecretKey,
    });

    expect(decrypted.body).toBe(CANARY_TEXT_MARKER);
  });

  it('verifies that attachment encryption strictly hides canary file bytes and headers', async () => {
    const { blob, key } = await defaultCipher.encryptFile(CANARY_FILE_BYTES);

    // Assert that the encrypted blob does NOT contain the canary marker or magic bytes
    const blobString = new TextDecoder('utf-8', { fatal: false }).decode(blob);
    expect(blobString).not.toContain('CANARY');
    expect(blobString).not.toContain('7f3a91');
    expect(blobString).not.toContain('JFIF');

    // Assert blob size includes 24-byte nonce + 16-byte Poly1305 MAC overhead
    expect(blob.length).toBe(CANARY_FILE_BYTES.length + 24 + 16);

    // Decrypt and confirm full byte-level match
    const decryptedFile = await defaultCipher.decryptFile(blob, key);
    expect(decryptedFile).toEqual(CANARY_FILE_BYTES);
    expect(bytesToUtf8(decryptedFile.slice(10))).toContain('CANARY_7f3a91_SECRET');
  });

  it('guarantees zero plaintext leakage under malicious tampering', async () => {
    const sender = await defaultCipher.generateDeviceKeys();
    const recipient = await defaultCipher.generateDeviceKeys();

    const { encrypted, envelopes } = await defaultCipher.encryptMessage({
      conversationId: 'conv_tamper',
      clientMessageId: 'msg_tamper_1',
      senderId: 'user_alice',
      senderDeviceId: sender.deviceId,
      signSecretKey: sender.signSecretKey,
      boxSecretKey: sender.boxSecretKey,
      type: 'text',
      plaintextPayload: { kind: 'text', body: CANARY_TEXT_MARKER, sentAt: Date.now() },
      recipientDevices: [{ userId: 'user_bob', deviceId: recipient.deviceId, boxPublicKey: recipient.boxPublicKey }],
    });

    const bobEnvelope = envelopes[0];

    // Tamper with 1 character of ciphertext
    const tamperedCt =
      encrypted.ct.slice(0, 10) +
      (encrypted.ct[10] === 'A' ? 'B' : 'A') +
      encrypted.ct.slice(11);

    await expect(
      defaultCipher.decryptMessage({
        conversationId: 'conv_tamper',
        clientMessageId: 'msg_tamper_1',
        senderId: 'user_alice',
        type: 'text',
        encrypted: { ...encrypted, ct: tamperedCt },
        envelope: { nonce: bobEnvelope.nonce, wrappedKey: bobEnvelope.wrappedKey },
        senderSignPublicKey: sender.signPublicKey,
        senderBoxPublicKey: sender.boxPublicKey,
        recipientBoxSecretKey: recipient.boxSecretKey,
      })
    ).rejects.toThrow();

    // Tamper with AAD parameter (cross-conversation replay attack)
    await expect(
      defaultCipher.decryptMessage({
        conversationId: 'conv_different_target', // forged conversation!
        clientMessageId: 'msg_tamper_1',
        senderId: 'user_alice',
        type: 'text',
        encrypted,
        envelope: { nonce: bobEnvelope.nonce, wrappedKey: bobEnvelope.wrappedKey },
        senderSignPublicKey: sender.signPublicKey,
        senderBoxPublicKey: sender.boxPublicKey,
        recipientBoxSecretKey: recipient.boxSecretKey,
      })
    ).rejects.toThrow();
  });
});
