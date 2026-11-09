# End-to-End Encryption Spec: React Native Chat App

**Audience:** AI coding agent working in this repository.
**Stack:** React Native client, Node.js + Mongoose backend, Cloudinary for media.
**Status of this document:** normative. Where it says MUST / MUST NOT, treat it as a hard requirement.

---

## 0. Agent working rules

1. **Do not invent cryptography.** Use only the primitives and constructions in Section 3. If a required primitive is missing from the chosen library, STOP and write the problem down in `docs/e2ee/DECISIONS.md`. Do not substitute a different algorithm or hand-assemble one from lower-level pieces.
2. **Work phase by phase** (Section 7). Finish a phase, run its tests, commit, then continue. Never start Phase N+1 with failing tests in Phase N.
3. **Tests first for the crypto core.** The crypto module must have passing unit tests before any UI or network code depends on it.
4. **Discover before assuming.** Phase 0 requires inspecting the repo (Expo or bare RN, RN version, Hermes on/off, backend framework, realtime transport, auth mechanism). Adapt every path and snippet here to what actually exists.
5. **Stop and ask the owner** (do not guess) when:
   - a needed libsodium function is not available in the React Native binding,
   - a change would break existing API clients or stored data,
   - a library's license is incompatible with a closed-source app,
   - anything in Section 12 (open questions) blocks the current task.
6. **Never log, print, or persist plaintext messages or key material**, including in debug builds, crash reporters, analytics, Redux devtools, or test fixtures that look like real data.
7. Keep the crypto code small, isolated, and readable. A reviewer should be able to audit it in one sitting.

---

## 1. Goals, threat model, and honest claims

### Goals
- The server, database, Cloudinary, network observers, and backups MUST NOT be able to read message content or attachments.
- Only the devices of conversation participants can decrypt.
- Tampering, replay, and cross-conversation substitution MUST be detected by the client.

### Protects against
- A database leak or a malicious or curious server operator reading content.
- Network eavesdroppers (in addition to TLS).
- Cloudinary or any third-party storage reading attachments.

### Does NOT protect against (document these; do not hide them)
- A compromised or unlocked user device.
- A malicious app update shipped through the app stores.
- **Metadata:** who talks to whom, when, message sizes, group membership, group names (in v1).
- A malicious server lying about public keys or group membership. Mitigation is key verification (safety numbers, Section 3.8), not cryptography alone.
- **No forward secrecy in v1** (see Section 2).

### Claims policy
Do NOT describe the app as "the same as WhatsApp" or "Signal-grade" in code, UI strings, or docs until the v2 upgrade (Section 11) ships and an independent audit is done. Accurate wording for v1:
> "Messages are end-to-end encrypted. Our servers store only ciphertext and cannot read your messages."

---

## 2. Architecture decision

WhatsApp's guarantees come from the **Signal Protocol** (X3DH + Double Ratchet, plus Sender Keys for groups). That protocol is subtle, and a hand-written implementation is a liability. Mature implementations exist (see Section 11), but several have licensing and React Native integration constraints that need an owner decision. So the plan is staged:

| | **v1 (this document)** | **v2 (roadmap)** |
|---|---|---|
| Scheme | Per-message random key, wrapped separately for each recipient device (hybrid / envelope encryption) | Signal Protocol or MLS via an audited library |
| Server can read content | No | No |
| Forward secrecy / post-compromise security | **No** | Yes |
| Group key rotation on membership change | Not needed (recipient set is fixed at send time) | Handled by protocol |
| Complexity / risk of bugs | Low (standard primitives, small surface) | Library-dependent |

**Critical v1 limitation:** if an attacker obtains a device's long-term private key *and* a copy of stored ciphertext (for example a server DB dump), they can decrypt past messages addressed to that device. v1 is real E2EE, but weaker than WhatsApp in this specific scenario.

**Design rule:** everything crypto-related sits behind the `E2EECipher` interface (Section 6.1) and every ciphertext carries a version number `v`, so v2 can be introduced without a flag-day migration.

---

## 3. Cryptographic design (normative)

### 3.1 Primitives (libsodium)

| Purpose | Primitive | libsodium function(s) |
|---|---|---|
| Content encryption | XChaCha20-Poly1305 (IETF AEAD) | `crypto_aead_xchacha20poly1305_ietf_encrypt` / `_decrypt` |
| Key wrapping (per recipient) | X25519 + XSalsa20-Poly1305 authenticated box | `crypto_box_easy` / `crypto_box_open_easy` |
| Sender signature | Ed25519 | `crypto_sign_detached` / `crypto_sign_verify_detached` |
| Randomness | OS CSPRNG | `randombytes_buf` |
| Hashing / fingerprints | BLAKE2b | `crypto_generichash` |
| Padding | ISO/IEC 7816-4 | `sodium_pad` / `sodium_unpad` (or exact manual equivalent) |
| Attachments (preferred) | secretstream XChaCha20-Poly1305 | `crypto_secretstream_xchacha20poly1305_*` |
| Zeroing | best effort | `sodium_memzero` (`memzero`) |

**Library:** `react-native-libsodium` is the primary candidate. It is a native binding with the `libsodium-wrappers` API, actively released, and its example app tracks recent React Native versions. **However, it implements only a subset of the `libsodium-wrappers` API.** Phase 0 MUST include a spike that calls every function in the table above on a real iOS device and a real Android device (release build, Hermes). If any is missing, follow rule 0.1 and 0.5.

Notes:
- Hermes has no WebAssembly support. Do NOT use `libsodium-wrappers` (WASM) directly in the app.
- Install `react-native-get-random-values` if any dependency expects `crypto.getRandomValues`.
- Never use `Math.random()` for anything security-relevant.
- Random 24-byte nonces are safe with XChaCha20 and `crypto_box`. Never reuse a (key, nonce) pair.

### 3.2 Keys

Each **device** (not each user) generates on first launch, on the device only:

| Key | Type | Use | Leaves device? |
|---|---|---|---|
| `signSk` / `signPk` | Ed25519 | Sign messages, bind `boxPk` | Public key only |
| `boxSk` / `boxPk` | X25519 | Unwrap per-message content keys | Public key only |
| `deviceId` | random UUIDv4 | Identify the device | Yes |

- Registration uploads `signPk`, `boxPk`, `deviceId`, and `boxKeySignature = Sign(signSk, "e2ee-v1-boxkey|" || deviceId || boxPk)`. The server verifies this signature (proof of possession and binding).
- **Private keys MUST be stored only in iOS Keychain / Android Keystore** (via `react-native-keychain` or `expo-secure-store`). Never in AsyncStorage, MMKV, SQLite, files, or the JS bundle.
  - iOS: use `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (or stricter) so keys are not synced to iCloud or restored onto another device.
  - Android: ensure key material is excluded from auto-backup (`android:allowBackup="false"` or explicit `dataExtractionRules`/`fullBackupContent` exclusions).
- v1 policy: **one active device per user** (the schema supports many; enforcement is server-side and removable later). Logging in on a new device revokes the old device's key record. No history transfer between devices in v1.

### 3.3 Encrypting a message (sender)

```
Inputs: plaintextPayload (Section 3.5), conversationId, clientMessageId (UUIDv4, generated on client),
        senderId, senderDeviceId, type, recipientDevices[] (see Section 3.7), own signSk/boxSk

1. contentKey  = randombytes_buf(32)
2. bytes       = utf8(JSON.stringify(plaintextPayload)), then pad to a multiple of 160 bytes (ISO/IEC 7816-4)
3. nonce       = randombytes_buf(24)
4. aad         = utf8("e2ee-msg-v1|" + conversationId + "|" + clientMessageId + "|" +
                      senderId + "|" + senderDeviceId + "|" + type)
5. ct          = AEAD_encrypt(bytes, aad, nonce, contentKey)
6. sig         = Ed25519_sign(signSk, "e2ee-sig-v1|" || aad || nonce || ct)
7. for each recipient device d (INCLUDING the sender's own device, so history is readable after reload):
       n_d       = randombytes_buf(24)
       wrapped_d = crypto_box_easy(contentKey, n_d, d.boxPk, senderBoxSk)      // 48 bytes
8. memzero(contentKey)
Output: encrypted = { v:1, senderDeviceId, nonce, ct, sig } and envelopes = [{ userId, deviceId, nonce:n_d, wrappedKey:wrapped_d }]
```

The AAD binds the ciphertext to its conversation, sender, message ID, and type, so the server cannot move a ciphertext to another conversation or attribute it to another sender.

### 3.4 Decrypting a message (receiver)

1. Fetch the message and **only this device's** envelope.
2. Look up the sender device's `signPk` and `boxPk` from the local key store. If unknown, fetch from the key directory and verify `boxKeySignature`. Enforce pinning (Section 3.8).
3. Rebuild `aad` from the **server-provided** `conversationId`, `senderId`, `type` and the message's `clientMessageId`. Do not read these from inside the payload.
4. Verify `sig` BEFORE decrypting. Reject on failure.
5. `contentKey = crypto_box_open_easy(wrappedKey, envelopeNonce, sender.boxPk, mySk)`, then AEAD-decrypt, unpad, parse.
6. Any failure shows an "Unable to decrypt this message" placeholder. It MUST NOT crash, retry forever, or fall back to any plaintext field.
7. Reject duplicates by `clientMessageId`.

### 3.5 Plaintext payload (inside the encryption)

```ts
type PlainPayload = {
  kind: 'text' | 'image' | 'audio' | 'reaction' | 'control';
  body?: string;                              // text
  replyTo?: { clientMessageId: string };      // moved out of the server schema
  attachment?: {                              // image / audio
    url: string;                              // Cloudinary URL of the ENCRYPTED blob
    key: string;                              // base64, 32-byte file key
    size: number; mime: string;
    width?: number; height?: number; durationMs?: number;
    thumb?: { url: string; key: string; size: number; width: number; height: number };
  };
  reaction?: { targetClientMessageId: string; emoji: string; action: 'add' | 'remove' };
  control?: { action: 'delete_for_everyone' | 'edit'; targetClientMessageId: string; newBody?: string };
  sentAt: number;                             // client timestamp, informational only
};
```

Reactions and edits are themselves encrypted messages (`type: 'reaction'` / `'control'`). Clients fold them into local state. The server never learns the emoji. Only accept a `delete_for_everyone` or `edit` control message if its verified sender is the original message's sender.

### 3.6 Attachments (images and audio)

Cloudinary MUST only ever receive ciphertext.

1. Generate a random 32-byte `fileKey` per attachment.
2. Encrypt the file on-device. Preferred: `crypto_secretstream_xchacha20poly1305` in 64 KiB chunks (avoids loading large files fully into JS memory). Acceptable v1 fallback only if secretstream is unavailable and the owner approves: single-shot XChaCha20-Poly1305 with the nonce prefixed to the blob and a hard size cap (default 10 MB).
3. Upload the encrypted blob as a **raw** resource with a **server-signed** upload (no unsigned presets), `type: "authenticated"` (or `private`), and a random UUID `public_id`. No transformations, no auto-tagging, no moderation add-ons (they cannot work on ciphertext and may leak data).
4. Put `url`, `fileKey`, `size`, `mime`, dimensions inside the encrypted message payload (Section 3.5). Set `Message.fileUrl` to the blob URL only for lifecycle management (e.g. deleting the asset).
5. Thumbnails and previews MUST be generated client-side, encrypted separately, and uploaded as a second blob. Cloudinary-side resizing is not possible.
6. Strip EXIF/GPS metadata from images before encryption.
7. On download: fetch the blob, decrypt, cache decrypted bytes only in app-private storage (preferably encrypted at rest, Section 6.3).

### 3.7 Groups and recipient sets

- **v1 uses per-message envelopes for every current device of every current participant.** There is no persistent group key, so adding or removing members needs no key rotation. New members cannot read earlier messages. Removed members cannot read later ones.
- The client obtains the recipient device list from the key directory (Section 5). The server MUST reject a send whose envelope set does not exactly match the active devices of the conversation's current participants plus the sender's own devices. It returns `409` with `{ missingDevices, extraDevices }` so the client can refetch keys and retry. This prevents silent exclusion and stale-key sends.
- **Cap:** 256 recipient devices per message in v1. Above that, require the v2 Sender Keys / MLS upgrade.
- Clients MUST show a visible system notice when group membership changes.
- Known v1 limitation: the server is authoritative on membership. A malicious server could add a participant. Mitigations (v2): signed membership changes by admins; users can compare safety numbers.

### 3.8 Identity pinning and verification

- **TOFU (trust on first use):** the first time a client sees a user's `signPk`, it pins it locally.
- If a user's `signPk` later changes (reinstall or new device), show an in-conversation notice ("Security code with X changed") and deliver the message. Provide a setting "Require approval when security codes change" (default off, like WhatsApp). With the setting on, block sending until the user approves.
- **Safety number:** a deterministic fingerprint of both users' `signPk` values. Compute it as `crypto_generichash(64, "e2ee-safety-v1|" || sort(pkA, pkB))`, render it as a 60-digit number in 5-digit groups, and also as a QR code. Add a "Verify security code" screen per direct conversation.

### 3.9 Limitations to put in `docs/e2ee/SECURITY.md`
No forward secrecy in v1; metadata visible to server; one active device per user in v1; server can lie about keys/membership unless users verify; endpoint compromise out of scope.

### 3.10 Encrypted Cloud Backups (Zero-Knowledge)
To allow chat history continuity across device switches/reinstalls without sacrificing E2EE:
1. **Key Derivation (Argon2id):**
   - The user chooses a backup password.
   - The client generates a random 16-byte `salt`.
   - The backup key is derived using Argon2id (`crypto_pwhash`) with `OPSLIMIT_MODERATE` and `MEMLIMIT_MODERATE`.
   - Neither the password nor the derived key is ever sent to the server.
2. **Backup Encryption:**
   - The client exports a serialized snapshot of the local message database.
   - The snapshot is encrypted with XChaCha20-Poly1305 (`crypto_aead_xchacha20poly1305_ietf_encrypt`) using the derived backup key and a random 24-byte nonce.
   - The encrypted payload (alongside the salt and nonce) is uploaded to the backend/cloud storage.
3. **Restore on New Device:**
   - User inputs their backup password on the new device.
   - App downloads the encrypted backup blob and salt, derives the key, decrypts the snapshot, and re-populates the local database.
   - If the user forgets their password, the backup cannot be recovered (zero-knowledge principle).

---

## 4. Data model changes

### 4.1 Field-by-field disposition

**Message**

| Field | Decision | Reason |
|---|---|---|
| `conversationId`, `senderId` | Keep, plaintext | Routing and authorization. Bound into AAD. |
| `type` | Keep, plaintext. Enum becomes `'text'\|'image'\|'audio'\|'reaction'\|'control'\|'system'` | Needed for unread counts and push policy. Accepted metadata leak. |
| `clientMessageId` | **Add** | Idempotency, replay detection, AAD binding. |
| `content` | **Only for `type:'system'`.** MUST be empty for all other types | Prevents accidental plaintext storage. |
| `encrypted` | **Add** `{v, senderDeviceId, nonce, ct, sig}` | The ciphertext. |
| envelopes | **Move to new `MessageKey` collection** | Each recipient fetches only their own wrapped key. |
| `fileUrl` | Keep | Points to the encrypted blob. Key is in the payload. |
| `readBy`, `deliveredTo` | Keep, plaintext | Receipt metadata. Accepted. |
| `deletedBy` | Keep | Per-user local deletion flag. |
| `replyTo` | **Remove** (moved into encrypted payload) | The reply graph is sensitive metadata. |
| `reactions[]` | **Remove** (become encrypted `reaction` messages) | Emoji and `userName` are content and PII. Do not store `userName` on the server. |

**Conversation**

| Field | Decision |
|---|---|
| `type`, `participants`, `adminIds`, `clearedBy` | Keep. Server needs them for authorization. |
| `name`, `groupAvatarUrl` | Keep in plaintext for v1 and list in the "visible metadata" section of SECURITY.md. (Hardening option: encrypt under a group metadata key in v2.) |
| `lastMessage` | Keep as a reference. The client decrypts it for the chat list preview. The server MUST NOT generate previews or snippets. |

Delete `Message.content` plaintext usage everywhere in server code, including search, previews, notifications, and moderation. Full-text search over message content is no longer possible server-side. Any search feature must be client-side over the local decrypted DB.

### 4.2 `Message.ts` (reference implementation; adapt to the repo's Mongoose version)

```typescript
import mongoose, { Schema, Document } from 'mongoose';

export interface IEncryptedPayload {
  v: number;                // protocol version, 1
  senderDeviceId: string;
  nonce: string;            // base64, 24 bytes
  ct: string;               // base64, AEAD ciphertext
  sig: string;              // base64, 64 bytes, Ed25519
}

export interface IMessage extends Document {
  conversationId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  type: 'text' | 'image' | 'audio' | 'reaction' | 'control' | 'system';
  clientMessageId: string;  // UUIDv4 from the client
  content: string;          // system messages ONLY; '' otherwise
  encrypted?: IEncryptedPayload;
  fileUrl?: string;         // Cloudinary URL of an ENCRYPTED blob
  readBy: mongoose.Types.ObjectId[];
  deliveredTo: mongoose.Types.ObjectId[];
  deletedBy: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const EncryptedSchema = new Schema(
  {
    v: { type: Number, required: true },
    senderDeviceId: { type: String, required: true },
    nonce: { type: String, required: true },
    ct: { type: String, required: true, maxlength: 90_000 },
    sig: { type: String, required: true },
  },
  { _id: false }
);

const MessageSchema = new Schema<IMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['text', 'image', 'audio', 'reaction', 'control', 'system'],
      required: true,
    },
    clientMessageId: { type: String, required: true },
    content: { type: String, default: '' },
    encrypted: { type: EncryptedSchema },
    fileUrl: { type: String },
    readBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    deletedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true } // idempotent sends + replay protection
);

// Hard guard against accidental plaintext storage.
MessageSchema.pre('validate', function (next) {
  if (this.type === 'system') {
    if (this.encrypted) return next(new Error('system messages must not be encrypted'));
  } else {
    if (!this.encrypted) return next(new Error('non-system messages require ciphertext'));
    if (this.content) return next(new Error('plaintext content is forbidden for E2EE messages'));
  }
  next();
});

export default mongoose.model<IMessage>('Message', MessageSchema);
```

### 4.3 New models

**`Device.ts`**
```typescript
export interface IDevice extends Document {
  userId: mongoose.Types.ObjectId;
  deviceId: string;          // UUIDv4
  signPublicKey: string;     // base64 Ed25519
  boxPublicKey: string;      // base64 X25519
  boxKeySignature: string;   // base64, Sign(signSk, "e2ee-v1-boxkey|" || deviceId || boxPk)
  registeredAt: Date;
  revokedAt?: Date;          // set when replaced/logged out
}
// Indexes: unique { userId, deviceId }; { userId, revokedAt }
```

**`MessageKey.ts`** (one document per recipient device per message)
```typescript
export interface IMessageKey extends Document {
  messageId: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  recipientUserId: mongoose.Types.ObjectId;
  recipientDeviceId: string;
  nonce: string;       // base64, 24 bytes
  wrappedKey: string;  // base64, 48 bytes
}
// Indexes: unique { messageId, recipientDeviceId }; { recipientDeviceId, conversationId }
```
Insert the `Message` and its `MessageKey` docs in one MongoDB transaction (`session.withTransaction`). If the deployment has no replica set, STOP and ask the owner. Do not fall back to non-atomic writes without approval.

### 4.4 Existing data
If the database contains plaintext messages from development, do not "encrypt them on the server" (the server must never hold keys). Either wipe dev data, or mark legacy rows (`encrypted` absent, `type` preserved) and show them as "Not encrypted (legacy)" in the UI. Ask the owner which.

---

## 5. API contract (adapt to the existing framework and auth)

All endpoints require authentication and TLS. None may log request bodies.

| Endpoint | Purpose | Rules |
|---|---|---|
| `POST /e2ee/devices` | Register device keys | Verify `boxKeySignature` against `signPublicKey`. Revoke the user's previous active device (v1 policy). |
| `GET /e2ee/users/:userId/devices` | Fetch a user's active device public keys | Authorize: caller must share a conversation with the target, or be creating one. Rate-limit per caller to prevent user enumeration. |
| `GET /e2ee/conversations/:id/recipients` | Active devices of all current participants, plus caller's own | Caller must be a participant. Returns the exact set the next send must cover. |
| `POST /conversations/:id/messages` | Send | Body: `{ clientMessageId, type, encrypted, fileUrl?, envelopes[] }`. Validate sender membership, size caps (ciphertext ≤ 64 KB, ≤ 256 envelopes), exact recipient-set match (409 with diff otherwise), `encrypted.senderDeviceId` belongs to the caller and is active, uniqueness of `clientMessageId`. Transactionally write `Message` + `MessageKey`. Return the existing message if `clientMessageId` repeats (idempotent). |
| `GET /conversations/:id/messages?cursor=` | History | Return messages plus **only the caller's device's** `MessageKey`. Never return other devices' keys. |
| `POST /uploads/sign` | Cloudinary signed upload params | Enforce raw resource type, authenticated delivery, random `public_id`, size cap. |

Realtime events (Socket.IO / WebSocket, whatever exists) carry only ciphertext plus the recipient's own envelope. Never emit plaintext, decrypted previews, or other recipients' envelopes.

---

## 6. Client architecture (React Native)

### 6.1 Module layout (adapt paths)
```
src/crypto/
  E2EECipher.ts        // interface + types (below)
  sodiumCipher.ts      // v1 implementation on react-native-libsodium
  encoding.ts          // base64, utf8, padding helpers
  safetyNumber.ts
  __tests__/           // vectors, tamper tests, round-trips
src/e2ee/
  keyStore.ts          // Keychain/Keystore access; device key generation
  keyDirectory.ts      // fetch/verify/pin public keys (TOFU)
  messageService.ts    // encrypt-and-send, fetch-and-decrypt
  attachmentService.ts // encrypt/upload, download/decrypt
  localDb.ts           // encrypted local cache
```

```typescript
export interface E2EECipher {
  readonly version: 1;
  generateDeviceKeys(): Promise<DeviceKeys>;
  encryptMessage(i: EncryptInput): Promise<{ encrypted: EncryptedPayload; envelopes: Envelope[] }>;
  decryptMessage(i: DecryptInput): Promise<PlainPayload>;      // throws typed DecryptError
  encryptFile(bytes: Uint8Array): Promise<{ blob: Uint8Array; key: Uint8Array }>;
  decryptFile(blob: Uint8Array, key: Uint8Array): Promise<Uint8Array>;
  safetyNumber(pkA: Uint8Array, pkB: Uint8Array): string;
}
```
UI code MUST depend only on this interface, never on libsodium directly.

### 6.2 Keys
Private keys live only in Keychain/Keystore (Section 3.2). Load them just-in-time, keep them in memory only as long as needed, and `memzero` buffers best-effort. On logout, delete device private keys and the local DB (v1 has no cloud history).

### 6.3 Local storage of decrypted data
- Messages may be cached decrypted for UI speed, but only in an **encrypted** local database: SQLCipher-backed SQLite via `expo-sqlite` (using the `["expo-sqlite", { "useSQLCipher": true }]` config plugin). The DB key is random, 32 bytes, stored in Keychain/Keystore via `expo-secure-store`. Do not use AsyncStorage or unencrypted MMKV for message content.
- Cached decrypted attachments live in app-private storage, excluded from OS backups.
- Pinned identity keys (TOFU) are stored in the same encrypted DB.

### 6.4 Hygiene
- No message bodies, keys, or decrypted payloads in `console.*`, Sentry/Crashlytics breadcrumbs, analytics events, Redux/Zustand devtools, or error messages. Add a lint rule or a CI grep for forbidden patterns.
- Hide message content in the app-switcher snapshot (blur or privacy screen), and optionally add a "block screenshots" setting on Android (`FLAG_SECURE`).
- Optimistic UI: show the local plaintext immediately, mark it "sending", and reconcile via `clientMessageId`.

---

## 7. Phased task plan

### Phase 0: Recon and spike
- Inspect the repo and record in `docs/e2ee/DECISIONS.md`: Expo vs bare, RN version, Hermes, backend framework, realtime transport, auth, existing Cloudinary flow, whether MongoDB runs as a replica set.
- Spike: on **physical iOS and Android devices, release builds**, call every primitive in Section 3.1 (including a 5 MB file encrypt/decrypt timing).
- Check licenses of every proposed dependency. Flag anything GPL/AGPL (see Section 11).
- **Exit:** DECISIONS.md written; spike results recorded; owner questions in Section 12 answered or flagged.

### Phase 1: Crypto core
- Implement `E2EECipher` per Section 3 with unit tests.
- **Exit criteria (all MUST pass):**
  - round-trip for text of lengths 0, 1, 159, 160, 161, 10k bytes;
  - tampering with `ct`, `nonce`, `sig`, `wrappedKey`, or any AAD field (conversationId, senderId, clientMessageId, type) fails to decrypt;
  - a device not in the recipient set cannot decrypt;
  - wrong sender key fails signature verification;
  - two encryptions of the same plaintext produce different ciphertext, nonces, and wrapped keys;
  - known-answer tests for primitives against official libsodium vectors where the binding exposes them.

### Phase 2: Client key management
- Key generation on first launch, secure storage, device registration, TOFU key directory, encrypted local DB.
- **Exit:** reinstall produces a new device and key (verified); keys are not present in any backup or plain storage (manual inspection checklist).

### Phase 3: Backend
- Models (Section 4), indexes, validation, endpoints (Section 5), signature verification, recipient-set check, size limits, rate limits.
- Update every server code path that touched `Message.content`, `reactions`, `replyTo` (search, previews, notifications, sockets).
- **Exit:** integration tests for: plaintext rejection, duplicate `clientMessageId` idempotency, 409 on stale recipient set, caller receives only their own `MessageKey`, non-participant gets 403.

### Phase 4: 1:1 messaging end to end
- `messageService` encrypt and send, fetch and decrypt, sockets, chat-list previews decrypted client-side, receipts unchanged.
- Reactions and `delete_for_everyone` as encrypted messages.
- **Exit:** two real devices exchange text, replies, and reactions. The canary test (Section 8) passes.

### Phase 5: Attachments
- Client-side encryption, signed Cloudinary upload (raw, authenticated), encrypted thumbnails, EXIF stripping, download-and-decrypt, asset deletion on delete-for-everyone.
- **Exit:** images and audio round-trip. The Cloudinary asset is unreadable as an image. The canary test covers attachments.

### Phase 6: Groups
- Recipient-set fetch, fan-out wrapping, 256 device cap, membership-change system notices, correct behavior for added and removed members.
- **Exit:** a member added later cannot read earlier messages; a removed member cannot read later ones; stale-recipient-set 409 recovers automatically.

### Phase 7: Verification UX
- Safety number and QR screen, key-change banners, "require approval" setting.
- **Exit:** changing a test user's keys produces the banner on the peer's device.

### Phase 8: Hardening and documentation
- Push notifications: payloads contain no message content ("New message"). Optional later: iOS Notification Service Extension that decrypts locally.
- Log and crash-reporter scrubbing, privacy screen, rate limits, optional TLS certificate pinning (weigh the operational cost of key rotation).
- Write `docs/e2ee/SECURITY.md` (what is and isn't protected, Section 1 and 3.9) and `docs/e2ee/PROTOCOL.md` (the Section 3 spec as implemented, with wire-format examples).
- **Exit:** Section 9 checklist complete. Recommend an independent security review before public launch.

---

## 8. Testing and verification

**Canary test (automated, run in CI):** send text containing `CANARY_7f3a91`, an image, and an audio clip through the full stack in a test environment. Then assert the canary string and the original file bytes appear in NONE of: every MongoDB collection (dump and grep), server logs, captured socket/HTTP traffic, the Cloudinary mock upload body, and push payloads.

Other required tests:
- **Negative crypto tests:** see Phase 1 exit criteria. Must run in CI on every PR touching `src/crypto/`.
- **Authorization tests:** users cannot read other conversations' ciphertext or keys, and cannot fetch device keys of strangers.
- **Replay/idempotency:** resubmitting the same `clientMessageId` never creates duplicates.
- **Interop:** ciphertext produced on iOS decrypts on Android and vice versa.
- **Performance budget:** encrypting a text message to 256 devices stays under about 150 ms on a mid-range Android device (release build). Record actual numbers in DECISIONS.md.

---

## 9. Hardening checklist (Definition of Done)

- [ ] No non-system message has plaintext in any DB field (enforced by schema guard and canary test).
- [ ] Private keys exist only in Keychain/Keystore; excluded from backups.
- [ ] Local message cache is encrypted; DB key is in Keychain/Keystore.
- [ ] No sensitive data in logs, crash reports, analytics, push payloads.
- [ ] Cloudinary receives only ciphertext, via signed uploads, with authenticated delivery and random IDs.
- [ ] Signature verified before decryption; AAD rebuilt from server-provided fields.
- [ ] Server enforces exact recipient-set match; clients recover from 409.
- [ ] TOFU pinning, key-change banner, and safety-number screen implemented.
- [ ] Rate limits on key-directory and send endpoints.
- [ ] `SECURITY.md` and `PROTOCOL.md` written and accurate.
- [ ] Dependency licenses reviewed; lockfile committed; dependencies pinned.
- [ ] Independent security review scheduled or completed before public launch.

---

## 10. Forbidden list

- Writing your own cipher, mode, KDF, MAC, key exchange, or ratchet.
- AES-ECB, AES-CBC without MAC, RC4, MD5, SHA-1, RSA-PKCS1v1.5, unauthenticated encryption of any kind.
- Reusing a nonce with the same key; deterministic or counter nonces without a spec.
- `Math.random()` or timestamps as entropy.
- Deriving encryption keys from the user's password or any server-known secret.
- Storing keys or decrypted content in AsyncStorage, unencrypted MMKV, plain SQLite, plain files, or the JS bundle.
- Server-side decryption, key escrow, or "admin can read messages" features.
- Silently falling back to plaintext when encryption or decryption fails.
- Logging plaintext, keys, or full ciphertext blobs.
- Using WASM-based crypto on Hermes.
- Marketing language implying Signal/WhatsApp equivalence (Section 1).

---

## 11. Roadmap: v2 forward secrecy (do NOT start without owner approval)

Replace `sodiumCipher.ts` with a ratcheting protocol behind the same `E2EECipher` interface, using a vetted library and an independent audit. Requires: prekey upload and fetch endpoints, session state stored in the encrypted local DB, and plaintext caching (message keys are consumed on decrypt, so history must be cached locally).

Candidates for the agent to evaluate in a decision record (verify current license, maintenance, and React Native feasibility for each; do not assume):

| Option | Notes to verify |
|---|---|
| Signal's `libsignal` (Rust core; Swift/Java/Node bindings) | Strongest provenance. No official React Native bindings known, so a native module would be needed. **AGPL-3.0 licensing: likely incompatible with a closed-source app.** Get the owner's decision before use. |
| `@privacyresearch/libsignal-protocol-typescript` | TypeScript port. Check license (GPL family), maintenance status, audit status, and JS-crypto performance on Hermes. |
| Matrix `vodozemac` (Olm/Megolm) | Rust, Apache-2.0. JS bindings are WASM-based (not Hermes-friendly). A native binding would be required. |
| MLS (RFC 9420), for example OpenMLS | Designed for groups. Check for React Native bindings. |

Also in v2 scope: Sender Keys or MLS for large groups, signed group membership, multi-device linking, encrypted backups (user passphrase with Argon2id), key transparency.

---

## 12. Resolved decisions (confirmed with owner in Phase 0)

1. **Expo (managed) or bare React Native?** Expo managed workflow (SDK 57, CNG, React Native 0.86.3). Development builds required for native modules.
2. **Is a single active device per user acceptable for v1?** Yes. Logging into a new device revokes the previous device's active key.
3. **Maximum group size needed?** 256 recipient devices per message in v1.
4. **Is losing chat history on device loss acceptable, or is encrypted backup required for launch?** Encrypted cloud backups are required for launch. Implemented via zero-knowledge user password + Argon2id (Section 3.10).
5. **Is the app closed-source?** Closed-source mobile app. Strict rule against GPL/AGPL dependencies.
6. **Is there a web or desktop client planned?** Mobile only (iOS & Android).
7. **Existing plaintext dev data: wipe or keep as legacy?** Handled manually by owner. No automatic database wipe needed.
8. **Is MongoDB running as a replica set (needed for transactions)?** Yes, confirmed MongoDB Atlas replica set; multi-document transactions work out of the box.
9. **Legal and compliance:** Zero-knowledge privacy model prioritized. Full spec documented in `docs/e2ee/DECISIONS.md`.
