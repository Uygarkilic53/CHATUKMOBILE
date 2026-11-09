# Chatuk E2EE Protocol Specification (v1)

**Status:** Normative Specification  
**Protocol Version:** `1`  
**Wire Encoding:** UTF-8 JSON / Base64 Binary Buffers  

---

## 1. Overview & Data Structures

Chatuk E2EE v1 uses a hybrid envelope encryption scheme. For each message, the client generates a unique, single-use 256-bit symmetric content key (`contentKey`). The plaintext payload is encrypted with this key using XChaCha20-Poly1305 AEAD. The `contentKey` is then independently wrapped for each recipient device (and the sender's own device) using X25519 authenticated public-key boxing (`crypto_box_easy`).

### 1.1 Wire Payload Schema (`POST /api/conversations/:id/messages`)

```json
{
  "clientMessageId": "7d9b990e-8fb8-4e89-a764-969c3a37c152",
  "type": "text",
  "encrypted": {
    "v": 1,
    "senderDeviceId": "550e8400-e29b-41d4-a716-446655440000",
    "nonce": "aB3...24bytesBase64...",
    "ct": "xZ8...paddedCiphertextBase64...",
    "sig": "kM2...64bytesEd25519SignatureBase64..."
  },
  "envelopes": [
    {
      "userId": "67123456789abcdef0123456",
      "deviceId": "550e8400-e29b-41d4-a716-446655440000",
      "nonce": "n1X...24bytesBase64...",
      "wrappedKey": "wK9...48bytesBase64..."
    },
    {
      "userId": "67123456789abcdef0123457",
      "deviceId": "661f9511-f30c-42e5-b827-557766551111",
      "nonce": "n2Y...24bytesBase64...",
      "wrappedKey": "wL0...48bytesBase64..."
    }
  ],
  "fileUrl": null
}
```

### 1.2 Plaintext Payload Schema (Inside Ciphertext)

Before encryption, the message payload is formatted as a JSON object, serialized to UTF-8 bytes, and padded to a multiple of 160 bytes using ISO/IEC 7816-4:

```typescript
interface PlainPayload {
  kind: 'text' | 'image' | 'audio' | 'reaction' | 'control';
  body?: string;
  replyTo?: { clientMessageId: string };
  attachment?: {
    url: string;        // Cloudinary URL of the raw encrypted blob
    key: string;        // 32-byte file key (Base64)
    size: number;       // Encrypted payload byte size
    mime: string;       // Original MIME type (e.g., "image/jpeg")
    width?: number;
    height?: number;
    durationMs?: number;
  };
}
```

---

## 2. Cryptographic Construction & Algorithms

### 2.1 AAD Construction
Additional Authenticated Data (AAD) binds the ciphertext to the exact conversation context, preventing ciphertext replaying, moving across conversations, or forging sender identities:

$$\text{AAD} = \text{utf8}("e2ee-msg-v1|" + \text{conversationId} + "|" + \text{clientMessageId} + "|" + \text{senderId} + "|" + \text{senderDeviceId} + "|" + \text{type})$$

### 2.2 Signature Construction
To guarantee sender authenticity, the sender signs the concatenated AAD, nonce, and ciphertext using their long-term Ed25519 signing secret key:

$$\text{sigBytes} = \text{utf8}("e2ee-sig-v1|") \mathbin{\Vert} \text{AAD} \mathbin{\Vert} \text{nonce} \mathbin{\Vert} \text{ct}$$
$$\text{sig} = \text{crypto\_sign\_detached}(\text{sigBytes}, \text{signSk})$$

### 2.3 Sender Encryption Steps
1. Generate single-use symmetric key: `contentKey = randombytes_buf(32)`.
2. Serialize `PlainPayload` to UTF-8 bytes, pad to multiple of 160 bytes with `sodium_pad`.
3. Generate 24-byte nonce: `nonce = randombytes_buf(24)`.
4. Construct `AAD` as defined in 2.1.
5. Compute ciphertext: `ct = crypto_aead_xchacha20poly1305_ietf_encrypt(padded, AAD, null, nonce, contentKey)`.
6. Compute signature: `sig = crypto_sign_detached("e2ee-sig-v1|" || AAD || nonce || ct, signSk)`.
7. For each recipient device $d \in \text{recipients}$ (including sender's own device):
   - Generate per-recipient nonce: $n_d = \text{randombytes\_buf}(24)$.
   - Wrap content key: $w_d = \text{crypto\_box\_easy}(\text{contentKey}, n_d, d.\text{boxPk}, \text{senderBoxSk})$.
8. Zeroize temporary keys: `sodium_memzero(contentKey)`.

### 2.4 Receiver Decryption Steps
1. Look up sender device's `signPk` and `boxPk` (from local pinned cache or `/api/e2ee/users/:userId/devices`).
2. Verify sender's device key binding: `crypto_sign_verify_detached(boxKeySig, "e2ee-v1-boxkey|" || deviceId || boxPk, signPk)`.
3. Check TOFU pinning: if `signPk` differs from a pinned key, raise a `KEY_CHANGED` security notice.
4. Construct `AAD` using server-provided conversation metadata (never parse unauthenticated client fields).
5. Verify Ed25519 signature: `crypto_sign_verify_detached(sig, "e2ee-sig-v1|" || AAD || nonce || ct, senderSignPk)`. If verification fails, reject immediately.
6. Unwrap content key: `contentKey = crypto_box_open_easy(envelope.wrappedKey, envelope.nonce, senderBoxPk, ownBoxSk)`.
7. Decrypt ciphertext: `padded = crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, AAD, nonce, contentKey)`.
8. Unpad bytes with `sodium_unpad` (block size 160), parse UTF-8 JSON into `PlainPayload`.
9. Store decrypted message in local SQLCipher SQLite database.

---

## 3. Attachment Encryption

1. Sender selects image/media file.
2. Generate random 32-byte symmetric file key: `fileKey = randombytes_buf(32)`.
3. Generate 24-byte nonce: `fileNonce = randombytes_buf(24)`.
4. Encrypt file with XChaCha20-Poly1305 authenticated with AAD `"chatuk-attachment-v1"`.
5. Prepend the 24-byte nonce to the encrypted file bytes: `payload = fileNonce || ciphertext`.
6. Request signed Cloudinary upload params (`POST /api/uploads/sign`, resource type: `raw`).
7. Upload encrypted binary directly to Cloudinary.
8. Embed `fileKey` (Base64) and Cloudinary URL into `PlainPayload.attachment`.
9. Transmit message via E2EE message flow.
10. Recipient downloads encrypted blob from Cloudinary, extracts leading 24 bytes as nonce, decrypts with `fileKey`, and caches in app-private storage.

---

## 4. Zero-Knowledge Cloud Backup Format

Backups are encrypted using keys derived from a user-provided passphrase:

1. Generate random 16-byte salt: `salt = randombytes_buf(16)`.
2. Derive 32-byte key using **Argon2id**:
   - `opsLimit = crypto_pwhash_OPSLIMIT_INTERACTIVE` (2)
   - `memLimit = crypto_pwhash_MEMLIMIT_INTERACTIVE` (67,108,864 bytes)
   - `algorithm = crypto_pwhash_ALG_ARGON2ID13`
3. Export local messages to JSON: `{ version: 1, exportedAt, messages: [...] }`.
4. Encrypt snapshot using XChaCha20-Poly1305 with AAD `"chatuk-backup-v1"` and a 24-byte random nonce.
5. Zeroize derived key in memory.
6. Upload `{ version: 1, salt, nonce, ciphertext, exportedAt }` to `POST /api/e2ee/backup`.

---

## 5. Safety Number Derivation

Safety numbers allow two users to verify out-of-band that no MITM has manipulated their public keys:

1. Take the two Ed25519 signing public keys $A$ and $B$.
2. Sort them lexicographically so $K_1 = \min(A, B)$ and $K_2 = \max(A, B)$.
3. Compute BLAKE2b hash: $H = \text{crypto\_generichash}(32, K_1 \mathbin{\Vert} K_2)$.
4. Extract 12 sequential 16-bit unsigned integers from $H[0..23]$.
5. Compute each 5-digit block: $B_i = \text{leftPad}((V_i \pmod{100000}), 5)$.
6. Format into 12 space-separated blocks of 5 digits (total 60 digits):
   `XXXXX XXXXX XXXXX XXXXX XXXXX XXXXX XXXXX XXXXX XXXXX XXXXX XXXXX XXXXX`

---

## 6. API Endpoints Reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/e2ee/devices` | Bearer / Session | Register or rotate device public keys (`signPk`, `boxPk`, `boxKeySignature`) |
| `GET` | `/api/e2ee/users/:userId/devices` | Bearer / Session | Fetch active device public keys of a contact |
| `GET` | `/api/e2ee/conversations/:id/recipients` | Bearer / Session | Fetch all active recipient devices for a conversation |
| `POST` | `/api/conversations/:id/messages` | Bearer / Session | Send an E2EE message with envelopes |
| `GET` | `/api/conversations/:id/messages` | Bearer / Session | Fetch conversation history with caller's envelope |
| `POST` | `/api/uploads/sign` | Bearer / Session | Obtain signed Cloudinary upload credentials for raw blobs |
| `POST` | `/api/e2ee/backup` | Bearer / Session | Store zero-knowledge encrypted backup blob |
| `GET` | `/api/e2ee/backup` | Bearer / Session | Retrieve user's encrypted backup blob |
| `DELETE` | `/api/e2ee/backup` | Bearer / Session | Permanently delete encrypted backup from cloud |
