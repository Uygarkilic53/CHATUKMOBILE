/**
 * Pure-JS implementation of E2EECipher using @noble/ciphers, @noble/curves, and TweetNaCl.
 * 100% compatible with React Native Hermes, Expo Go, Node, and Web (no WebAssembly required).
 * Follows E2EE_IMPLEMENTATION_SPEC.md normative requirements.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import nacl from 'tweetnacl';
import {
  utf8ToBytes,
  bytesToUtf8,
  toBase64,
  fromBase64,
  concatBytes,
  wipeBytes,
  pad,
  unpad,
  randomBytes,
} from './encoding';
import {
  E2EECipher,
  DeviceKeys,
  EncryptInput,
  DecryptInput,
  PlainPayload,
  EncryptedPayload,
  Envelope,
  DecryptError,
} from './E2EECipher';
import { computeSafetyNumber } from './safetyNumber';

const PADDING_BLOCK_SIZE = 160;
const SIG_PREFIX = 'e2ee-sig-v1|';
const MSG_AAD_PREFIX = 'e2ee-msg-v1|';
const BOXKEY_BINDING_PREFIX = 'e2ee-v1-boxkey|';

/**
 * Generates a standard RFC4122 v4 UUID from cryptographic randomness.
 */
function generateCryptoUuid(): string {
  const bytes = randomBytes(16);
  // Set version to 0100 (v4)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // Set variant to 10xx (RFC4122)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

export class SodiumCipher implements E2EECipher {
  readonly version = 1 as const;

  /**
   * Generates long-term device identity keys and key-binding signature.
   */
  async generateDeviceKeys(): Promise<DeviceKeys> {
    const signSeed = randomBytes(32);
    const signPublicKeyBytes = ed25519.getPublicKey(signSeed);

    // 64-byte secret key (32-byte seed + 32-byte public key) matching libsodium convention
    const signSecretKeyBytes = new Uint8Array(64);
    signSecretKeyBytes.set(signSeed, 0);
    signSecretKeyBytes.set(signPublicKeyBytes, 32);

    const boxKeypair = nacl.box.keyPair();
    const deviceId = generateCryptoUuid();

    const signPublicKey = toBase64(signPublicKeyBytes);
    const signSecretKey = toBase64(signSecretKeyBytes);
    const boxPublicKey = toBase64(boxKeypair.publicKey);
    const boxSecretKey = toBase64(boxKeypair.secretKey);

    // Bind boxPk to deviceId and signPk (proof of possession & binding)
    const bindingData = utf8ToBytes(`${BOXKEY_BINDING_PREFIX}${deviceId}|${boxPublicKey}`);
    const boxKeySignatureBytes = ed25519.sign(bindingData, signSeed);
    const boxKeySignature = toBase64(boxKeySignatureBytes);

    return {
      deviceId,
      signPublicKey,
      signSecretKey,
      boxPublicKey,
      boxSecretKey,
      boxKeySignature,
    };
  }

  /**
   * Encrypts a message for a set of recipient devices (envelope encryption).
   */
  async encryptMessage(input: EncryptInput): Promise<{
    encrypted: EncryptedPayload;
    envelopes: Envelope[];
  }> {
    if (!input.recipientDevices || input.recipientDevices.length === 0) {
      throw new Error('recipientDevices must contain at least one recipient device');
    }

    let contentKey: Uint8Array | null = null;
    try {
      // 1. Generate 32-byte ephemeral content encryption key
      contentKey = randomBytes(32);

      // 2. Serialize payload, encode as UTF-8, and pad to 160 bytes
      const jsonStr = JSON.stringify(input.plaintextPayload);
      const rawBytes = utf8ToBytes(jsonStr);
      const paddedBytes = pad(rawBytes, PADDING_BLOCK_SIZE);

      // 3. 24-byte random nonce for XChaCha20
      const nonce = randomBytes(24);

      // 4. AAD binds ciphertext to conversationId, clientMessageId, senderId, senderDeviceId, and type
      const aadStr = `${MSG_AAD_PREFIX}${input.conversationId}|${input.clientMessageId}|${input.senderId}|${input.senderDeviceId}|${input.type}`;
      const aad = utf8ToBytes(aadStr);

      // 5. Encrypt padded payload using XChaCha20-Poly1305 AEAD
      const cipher = xchacha20poly1305(contentKey, nonce, aad);
      const ct = cipher.encrypt(paddedBytes);

      // 6. Sign ciphertext, nonce, and AAD with sender's Ed25519 signing key
      const sigData = concatBytes(utf8ToBytes(SIG_PREFIX), aad, nonce, ct);
      const senderSignSkBytes = fromBase64(input.signSecretKey);
      const senderSignSeed = senderSignSkBytes.slice(0, 32);
      const sig = ed25519.sign(sigData, senderSignSeed);

      // 7. Wrap contentKey for each recipient device (including sender's own device)
      const senderBoxSk = fromBase64(input.boxSecretKey);
      const envelopes: Envelope[] = [];

      for (const device of input.recipientDevices) {
        const n_d = randomBytes(24);
        const recipientBoxPk = fromBase64(device.boxPublicKey);
        const wrappedKey = nacl.box(contentKey, n_d, recipientBoxPk, senderBoxSk);

        envelopes.push({
          userId: device.userId,
          deviceId: device.deviceId,
          nonce: toBase64(n_d),
          wrappedKey: toBase64(wrappedKey),
        });
      }

      return {
        encrypted: {
          v: 1,
          senderDeviceId: input.senderDeviceId,
          nonce: toBase64(nonce),
          ct: toBase64(ct),
          sig: toBase64(sig),
        },
        envelopes,
      };
    } finally {
      // 8. Always zero out contentKey from memory
      wipeBytes(contentKey);
    }
  }

  /**
   * Decrypts an encrypted message for this recipient device.
   */
  async decryptMessage(input: DecryptInput): Promise<PlainPayload> {
    if (input.encrypted.v !== 1) {
      throw new DecryptError(
        'UNSUPPORTED_VERSION',
        `Unsupported protocol version: ${input.encrypted.v}`
      );
    }

    const { conversationId, clientMessageId, senderId, type, encrypted, envelope } = input;

    // 1. Rebuild AAD from server-provided metadata (NOT from inside payload)
    const aadStr = `${MSG_AAD_PREFIX}${conversationId}|${clientMessageId}|${senderId}|${encrypted.senderDeviceId}|${type}`;
    const aad = utf8ToBytes(aadStr);

    const nonceBytes = fromBase64(encrypted.nonce);
    const ctBytes = fromBase64(encrypted.ct);
    const sigBytes = fromBase64(encrypted.sig);

    // 2. Verify detached Ed25519 signature BEFORE decrypting
    const sigData = concatBytes(utf8ToBytes(SIG_PREFIX), aad, nonceBytes, ctBytes);
    const senderSignPk = fromBase64(input.senderSignPublicKey);

    const isSigValid = ed25519.verify(sigBytes, sigData, senderSignPk);
    if (!isSigValid) {
      throw new DecryptError(
        'SIGNATURE_VERIFICATION_FAILED',
        'Message signature is invalid or sender key does not match'
      );
    }

    let contentKey: Uint8Array | null = null;
    try {
      // 3. Unwrap ephemeral content key using recipient's box secret key and sender's box public key
      const wrappedKeyBytes = fromBase64(envelope.wrappedKey);
      const envelopeNonceBytes = fromBase64(envelope.nonce);
      const senderBoxPk = fromBase64(input.senderBoxPublicKey);
      const recipientBoxSk = fromBase64(input.recipientBoxSecretKey);

      const unwrapped = nacl.box.open(
        wrappedKeyBytes,
        envelopeNonceBytes,
        senderBoxPk,
        recipientBoxSk
      );
      if (!unwrapped) {
        throw new DecryptError('KEY_UNWRAP_FAILED', 'Failed to unwrap message content key');
      }
      contentKey = unwrapped;

      // 4. AEAD decrypt ciphertext
      let decryptedPadded: Uint8Array;
      try {
        const cipher = xchacha20poly1305(contentKey, nonceBytes, aad);
        decryptedPadded = cipher.decrypt(ctBytes);
      } catch {
        throw new DecryptError('AEAD_DECRYPT_FAILED', 'Failed to decrypt ciphertext payload');
      }

      // 5. Unpad ISO/IEC 7816-4 padding
      let unpadded: Uint8Array;
      try {
        unpadded = unpad(decryptedPadded, PADDING_BLOCK_SIZE);
      } catch {
        throw new DecryptError('INVALID_PADDING', 'Invalid ciphertext padding');
      }

      // 6. Parse JSON payload
      try {
        const jsonStr = bytesToUtf8(unpadded);
        return JSON.parse(jsonStr) as PlainPayload;
      } catch {
        throw new DecryptError('PAYLOAD_PARSE_FAILED', 'Failed to parse decrypted JSON payload');
      }
    } finally {
      wipeBytes(contentKey);
    }
  }

  /**
   * Encrypts a binary file or attachment using XChaCha20-Poly1305.
   * Returns the random 32-byte fileKey and the ciphertext blob with prefixed 24-byte nonce.
   */
  async encryptFile(bytes: Uint8Array): Promise<{ blob: Uint8Array; key: Uint8Array }> {
    const fileKey = randomBytes(32);
    const nonce = randomBytes(24);

    const cipher = xchacha20poly1305(fileKey, nonce);
    const ciphertext = cipher.encrypt(bytes);

    // Prefix nonce (24 bytes) to the ciphertext
    const blob = concatBytes(nonce, ciphertext);

    return { blob, key: fileKey };
  }

  /**
   * Decrypts a binary file given its ciphertext blob (with prefixed nonce) and fileKey.
   */
  async decryptFile(blob: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
    if (blob.length < 24 + 16) {
      throw new Error('Invalid file blob: too short');
    }

    const nonce = blob.slice(0, 24);
    const ciphertext = blob.slice(24);

    const cipher = xchacha20poly1305(key, nonce);
    return cipher.decrypt(ciphertext);
  }

  /**
   * Computes a 60-digit deterministic safety number fingerprint.
   */
  async safetyNumber(pkA: Uint8Array | string, pkB: Uint8Array | string): Promise<string> {
    return computeSafetyNumber(pkA, pkB);
  }
}

export const defaultCipher = new SodiumCipher();
