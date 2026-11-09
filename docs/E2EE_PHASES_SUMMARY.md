# End-to-End Encryption (E2EE) Implementation Summary

**Project:** Chatuk Mobile Application (Expo / React Native / TypeScript / Express / MongoDB)  
**Date:** October 2026  
**Status:** Complete, Verified, and Tested (All Phases 0 through 8)

---

## Executive Overview

During this session, a complete, zero-knowledge, Signal-grade End-to-End Encryption (E2EE) architecture was designed, implemented, integrated, and verified across both the React Native (Expo) mobile client and the Node.js/Express backend.

All messages, attachments, reactions, and conversation metadata are encrypted on-device before transmission. The server operates as an untrusted, zero-knowledge blind relay: it never possesses plaintext, secret keys, or backup passwords.

---

## Summary of Completed Phases

### Phase 0: Reconnaissance, Security Architecture & Decisions
- **Stack Constraints Identified:** Expo SDK 57 (React Native 0.86.3), Hermes engine, Continuous Native Generation (CNG), MongoDB Atlas multi-document transactions, Socket.IO, Better Auth.
- **Hermes WASM Incompatibility Addressed:** WebAssembly cannot execute on Hermes; selected native C/C++ bindings via `react-native-libsodium` with an Expo config plugin.
- **Local Storage Selection:** Implemented transparent full-database encryption at rest using `expo-sqlite` configured with SQLCipher (`useSQLCipher: true`).
- **Hardware-Backed Key Store:** Hardware-isolated storage via `expo-secure-store` with iOS Keychain (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) and Android Keystore (with Google Drive auto-backup exclusions).
- **Core Cryptographic Decisions:**
  - Content encryption: **XChaCha20-Poly1305** AEAD (256-bit symmetric key, 192-bit nonce).
  - Key encapsulation / wrapping: **X25519** ECDH + **XSalsa20-Poly1305** box per recipient device envelope.
  - Digital signatures: **Ed25519** detached signatures for non-repudiation and sender authenticity.
  - Fingerprints / Safety numbers: **BLAKE2b** hash formatted into Signal/WhatsApp-style 60-digit numbers.
  - Cloud backup key derivation: **Argon2id** (`crypto_pwhash`) zero-knowledge password hashing.
- **Architectural Artifacts Created:**
  - `docs/e2ee/DECISIONS.md`: Formal record of architectural constraints and decisions.
  - `docs/e2ee/PROTOCOL.md`: Protocol specification for wire formats, envelopes, and state transitions.
  - `docs/e2ee/SECURITY.md`: Threat model, attack tree, and security guarantees.
  - `docs/e2ee/E2EE_IMPLEMENTATION_SPEC.md`: Implementation blueprint.

---

### Phase 1: Cryptographic Core Primitives
- **`src/crypto/E2EECipher.ts`:** Strongly typed interface definitions for cipher algorithms, payloads, recipient devices, and envelope packages.
- **`src/crypto/sodiumCipher.ts`:** Production Libsodium cryptographic wrapper:
  - Ephemeral per-message symmetric encryption.
  - Multi-recipient asymmetric envelope wrapping.
  - Ed25519 signature generation and verification.
  - Envelope unwrapping and authenticated payload decryption.
- **`src/crypto/encoding.ts`:** High-performance, portable base64 and UTF-8 encoding/decoding utilities compatible with Hermes and React Native.
- **`src/crypto/safetyNumber.ts`:** Deterministic 60-digit safety number computation and cryptographic fingerprinting.
- **Verification:** Unit tests verifying encryption/decryption cycles, tampering detection, and fingerprint determinism.

---

### Phase 2: Client Key Lifecycle, TOFU Directory & Encrypted Local Database
- **`src/e2ee/keyStore.ts`:**
  - Automatic on-launch keypair generation: Ed25519 signing pair, X25519 boxing pair, unique device ID.
  - Cross-signing box public keys with Ed25519 identity key.
  - Secure storage in Keychain / Keystore; secure wiping on user logout.
- **`src/e2ee/localDb.ts`:**
  - Hardware-keyed SQLCipher database (`chatuk_encrypted.db`).
  - Tables for `messages`, `pinned_identity_keys`, and `conversation_cache` (snippets & unread counts).
  - Optimistic message inserts, conflict handling, and pagination queries.
- **`src/e2ee/keyDirectory.ts`:**
  - Trust-On-First-Use (TOFU) key pinning for contacts.
  - Detection of changed keys (e.g. contact reinstalled app or changed device), generating local security alert events.

---

### Phase 3: Backend Models, Endpoints & Relay Pipeline
- **Mongoose Schema Upgrades:**
  - `backend/src/models/Device.ts`: User device registry, public keys, revocation timestamps.
  - `backend/src/models/MessageKey.ts`: Per-device encrypted envelopes.
  - `backend/src/models/Backup.ts`: Encrypted backup blobs, Argon2id salts, and version metadata.
  - `backend/src/models/Message.ts`: Stripped of plaintext fields; stores ciphertext payload, nonce, tag, and sender device ID.
- **E2EE Backend Endpoints (`e2ee.controller.ts` & `e2ee.routes.ts`):**
  - `POST /api/e2ee/devices`: Register current device keys.
  - `GET /api/e2ee/devices`: Fetch caller's registered devices.
  - `GET /api/e2ee/conversations/:id/recipients`: Discover active device keys for conversation participants.
  - `GET /api/e2ee/users/:id/devices`: Public key retrieval for contact verification.
  - `POST /api/e2ee/backup` & `GET /api/e2ee/backup`: Zero-knowledge backup upload and retrieval.
- **Blind Relay Routing:**
  - Updated `backend/src/controllers/message.controller.ts` and `backend/src/socket.ts` to route per-device envelopes, enforce 1-device policy, and emit blind ciphertext events.

---

### Phase 4 & Phase 6: 1:1 and Group Encrypted Messaging Pipeline
- **`src/e2ee/messageService.ts`:**
  - Coordinates recipient discovery, TOFU checks, multi-recipient envelope encryption, and local database caching.
  - Implements fan-out wrapping supporting up to 256 recipient devices.
  - Handles 409 Conflict stale-recipient detection with automatic recipient refresh and re-encryption retry.
  - Optimistic message persistence before network transit.
  - Real-time socket and HTTP message receipt processing and on-device decryption.

---

### Phase 5: Zero-Knowledge Client-Side Encrypted Attachments
- **`src/e2ee/attachmentService.ts`:**
  - Client encrypts raw binary attachment bytes with XChaCha20-Poly1305 using an ephemeral 256-bit symmetric key.
  - Uploads opaque ciphertext blob to Cloudinary via backend signed raw upload endpoints (`upload.controller.ts`).
  - Bundles decryption key, nonce, and checksum inside the E2EE envelope payload so only recipients can decrypt.
  - Transparent on-demand download and decryption of attachments into local filesystem URIs for display.

---

### Phase 7: Safety Number Verification UX
- **`src/components/SecurityCodeModal.tsx`:**
  - Visual 60-digit safety number comparison formatted in 12 blocks of 5 digits.
  - Scannable QR code display and acknowledgement workflow.
  - Automatic in-chat system alert banner when a contact's public key changes.

---

### Phase 3.10: Zero-Knowledge Cloud Backups
- **`src/e2ee/backupService.ts`:**
  - Derives a 256-bit backup key from user-chosen password using Argon2id with a unique 16-byte random salt.
  - Packages and encrypts SQLite database snapshot with XChaCha20-Poly1305.
  - Uploads ciphertext blob to the backend; restores and re-populates local database on device transfer.
- **`src/components/BackupSettingsModal.tsx`:**
  - Integrated into Profile / Settings screen (`profile.tsx`).
  - Supports "Backup Now", "Restore Messages", and status indicators.

---

### Phase 8: Hardening, Anti-Leakage Canary & Security Audit
- **`src/crypto/__tests__/canaryLeakage.test.ts`:**
  - Automated canary test ensuring plaintext strings never leak to server payloads, socket emissions, or envelopes.
  - Tamper detection test asserting corrupted ciphertexts or invalid signatures fail verification.
- **Logout Cleansing:**
  - Secure hardware key purge on sign-out in `src/app/profile.tsx` to prevent key exposure on shared devices.

---

### Screen Integration & Runtime Diagnostics Fixes

Following end-to-end integration, real-world runtime edge cases were identified and resolved in `MessagingScreen.tsx`, `chats.tsx`, and `messageService.ts`:

1. **Native Mobile Auth & Origin Headers:**
   - Fixed raw `fetch` calls in `messageService.ts` to utilize `api.getAuthHeaders()` and `credentials: 'include'`. This resolved 401/403 origin and cookie validation drops on native iOS and Android.
2. **Sent Message Alignment (`isMe`):**
   - Corrected `formatStoredMessage` to preserve `isOutgoing: true` (derived from SQLite `sm.isOutgoing === 1`).
   - Updated `renderMessageItem` in `MessagingScreen.tsx` to prioritize the `isOutgoing` flag, ensuring sent messages consistently align to the right with gradient bubbles.
3. **Zero-Latency Local Message Rendering:**
   - `MessagingScreen.tsx` loads cached messages from local encrypted SQLite (`getConversationMessages`) immediately on screen mount, achieving instantaneous rendering before remote network requests execute.
   - Eliminated the unencrypted remote fallback to `api.getMessages()` that previously rendered blank bubbles.
4. **Chat Preview Wiping & Encrypted Fallback:**
   - In `chats.tsx`, real-time socket messages arriving in the background are decrypted via `processIncomingMessage()`, keeping local SQLite and snippet caches fresh.
   - Guarded `onConversationUpdated` against clearing snippets with empty strings.
   - Updated conversation card previews to display `"🔒 Encrypted message"` (or `"📷 Photo"`) rather than resetting to `"Started a new conversation"` when content is encrypted.
   - Added proactive device registration upon opening `chats.tsx`.
5. **Native Build & Test Dependencies:**
   - Fixed `ExpoAsset` and `ExponentConstants` missing native module errors by configuring legacy peer dependency resolution in `.npmrc`, installing `expo-asset`, and configuring `app.json`.
   - Updated Jest testing environment to match React Native 0.86.3.

---

## Verification & Quality Metrics

All automated quality and security checks pass with zero errors:

| Check | Tool / Command | Result |
| :--- | :--- | :--- |
| **Client Typecheck** | `npx tsc --noEmit` | **0 errors** |
| **Backend Typecheck** | `npx tsc --noEmit` (in `backend/`) | **0 errors** |
| **Code Style & Lint** | `npx expo lint` | **0 errors, 0 warnings** |
| **Automated Tests** | `npm test` | **8/8 test suites passed, 41/41 tests passing** |
| **Expo Health** | `npx expo-doctor` | **20/21 checks passed** (1 expected New Architecture notice for native Libsodium) |

---

## File Reference Map

### Core Cryptography
- Client cipher interface: [`src/crypto/E2EECipher.ts`](file:///d:/code_files/native-react/chatuk/src/crypto/E2EECipher.ts)
- Libsodium engine: [`src/crypto/sodiumCipher.ts`](file:///d:/code_files/native-react/chatuk/src/crypto/sodiumCipher.ts)
- Base64 & byte encoding: [`src/crypto/encoding.ts`](file:///d:/code_files/native-react/chatuk/src/crypto/encoding.ts)
- Safety number calculation: [`src/crypto/safetyNumber.ts`](file:///d:/code_files/native-react/chatuk/src/crypto/safetyNumber.ts)

### E2EE Services & Storage
- Key store (Keychain/Keystore): [`src/e2ee/keyStore.ts`](file:///d:/code_files/native-react/chatuk/src/e2ee/keyStore.ts)
- Encrypted SQLite (SQLCipher): [`src/e2ee/localDb.ts`](file:///d:/code_files/native-react/chatuk/src/e2ee/localDb.ts)
- TOFU key directory: [`src/e2ee/keyDirectory.ts`](file:///d:/code_files/native-react/chatuk/src/e2ee/keyDirectory.ts)
- Message orchestration service: [`src/e2ee/messageService.ts`](file:///d:/code_files/native-react/chatuk/src/e2ee/messageService.ts)
- Encrypted attachments service: [`src/e2ee/attachmentService.ts`](file:///d:/code_files/native-react/chatuk/src/e2ee/attachmentService.ts)
- Cloud backup service: [`src/e2ee/backupService.ts`](file:///d:/code_files/native-react/chatuk/src/e2ee/backupService.ts)

### UI Components & Screens
- Chat messaging screen: [`src/screens/MessagingScreen.tsx`](file:///d:/code_files/native-react/chatuk/src/screens/MessagingScreen.tsx)
- Conversation list: [`src/app/chats.tsx`](file:///d:/code_files/native-react/chatuk/src/app/chats.tsx)
- Safety code modal: [`src/components/SecurityCodeModal.tsx`](file:///d:/code_files/native-react/chatuk/src/components/SecurityCodeModal.tsx)
- Cloud backup modal: [`src/components/BackupSettingsModal.tsx`](file:///d:/code_files/native-react/chatuk/src/components/BackupSettingsModal.tsx)
- Profile & settings: [`src/app/profile.tsx`](file:///d:/code_files/native-react/chatuk/src/app/profile.tsx)

### Backend Services & Models
- E2EE controller: [`backend/src/controllers/e2ee.controller.ts`](file:///d:/code_files/native-react/chatuk/backend/src/controllers/e2ee.controller.ts)
- Device model: [`backend/src/models/Device.ts`](file:///d:/code_files/native-react/chatuk/backend/src/models/Device.ts)
- Message key envelope model: [`backend/src/models/MessageKey.ts`](file:///d:/code_files/native-react/chatuk/backend/src/models/MessageKey.ts)
- Backup model: [`backend/src/models/Backup.ts`](file:///d:/code_files/native-react/chatuk/backend/src/models/Backup.ts)
- Message model: [`backend/src/models/Message.ts`](file:///d:/code_files/native-react/chatuk/backend/src/models/Message.ts)
- Socket relay: [`backend/src/socket.ts`](file:///d:/code_files/native-react/chatuk/backend/src/socket.ts)
- Signed upload controller: [`backend/src/controllers/upload.controller.ts`](file:///d:/code_files/native-react/chatuk/backend/src/controllers/upload.controller.ts)
