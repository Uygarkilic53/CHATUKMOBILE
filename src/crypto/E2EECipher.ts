/**
 * E2EE cipher interface and type definitions.
 * Follows E2EE_IMPLEMENTATION_SPEC.md normative requirements.
 */

export type PayloadKind = 'text' | 'image' | 'video' | 'audio' | 'reaction' | 'control';


export interface PlainAttachment {
  url: string;           // Cloudinary URL of the ENCRYPTED blob
  key: string;           // base64, 32-byte symmetric file key
  size: number;
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
  thumb?: {
    url: string;
    key: string;
    size: number;
    width: number;
    height: number;
  };
}

export interface PlainReaction {
  targetClientMessageId: string;
  emoji: string;
  action: 'add' | 'remove';
}

export interface PlainControl {
  action: 'delete_for_everyone' | 'edit';
  targetClientMessageId: string;
  newBody?: string;
}

export interface PlainPayload {
  kind: PayloadKind;
  body?: string;
  replyTo?: { clientMessageId: string };
  attachment?: PlainAttachment;
  reaction?: PlainReaction;
  control?: PlainControl;
  sentAt: number;        // client timestamp (informational only)
}

export interface EncryptedPayload {
  v: 1;
  senderDeviceId: string;
  nonce: string;         // base64, 24 bytes
  ct: string;            // base64, AEAD ciphertext
  sig: string;           // base64, 64 bytes Ed25519 detached signature
}

export interface Envelope {
  userId: string;
  deviceId: string;
  nonce: string;         // base64, 24 bytes
  wrappedKey: string;    // base64, 48 bytes (crypto_box_easy)
}

export interface DeviceKeys {
  deviceId: string;
  signPublicKey: string; // base64 Ed25519
  signSecretKey: string; // base64 Ed25519
  boxPublicKey: string;  // base64 X25519
  boxSecretKey: string;  // base64 X25519
  boxKeySignature: string; // base64 detached Ed25519 signature of "e2ee-v1-boxkey|{deviceId}|{boxPublicKey}"
}

export interface RecipientDevice {
  userId: string;
  deviceId: string;
  boxPublicKey: string;  // base64 X25519
  signPublicKey?: string; // base64 Ed25519
}

export interface EncryptInput {
  plaintextPayload: PlainPayload;
  conversationId: string;
  clientMessageId: string;
  senderId: string;
  senderDeviceId: string;
  type: string;
  recipientDevices: RecipientDevice[]; // MUST include the sender's own device
  signSecretKey: string;              // base64 Ed25519
  boxSecretKey: string;               // base64 X25519
}

export interface DecryptInput {
  conversationId: string;
  clientMessageId: string;
  senderId: string;
  type: string;
  encrypted: EncryptedPayload;
  envelope: {
    nonce: string;
    wrappedKey: string;
  };
  senderSignPublicKey: string;        // base64 Ed25519
  senderBoxPublicKey: string;         // base64 X25519
  recipientBoxSecretKey: string;      // base64 X25519
}

export type DecryptErrorCode =
  | 'UNSUPPORTED_VERSION'
  | 'SIGNATURE_VERIFICATION_FAILED'
  | 'KEY_UNWRAP_FAILED'
  | 'AEAD_DECRYPT_FAILED'
  | 'INVALID_PADDING'
  | 'PAYLOAD_PARSE_FAILED';

export class DecryptError extends Error {
  readonly code: DecryptErrorCode;

  constructor(code: DecryptErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : `Decryption failed: ${code}`);
    this.name = 'DecryptError';
    this.code = code;
    Object.setPrototypeOf(this, DecryptError.prototype);
  }
}

export interface E2EECipher {
  readonly version: 1;
  generateDeviceKeys(): Promise<DeviceKeys>;
  encryptMessage(input: EncryptInput): Promise<{
    encrypted: EncryptedPayload;
    envelopes: Envelope[];
  }>;
  decryptMessage(input: DecryptInput): Promise<PlainPayload>;
  encryptFile(bytes: Uint8Array): Promise<{ blob: Uint8Array; key: Uint8Array }>;
  decryptFile(blob: Uint8Array, key: Uint8Array): Promise<Uint8Array>;
  safetyNumber(pkA: Uint8Array | string, pkB: Uint8Array | string): Promise<string>;
}
