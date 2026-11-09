# E2EE Architecture Decisions & Recon Record

**Project:** Chatuk App  
**Date:** 2026-10-18  
**Status:** Approved & Normative  

---

## 1. Stack Reconnaissance

| Dimension | Discovery / Reality | Notes |
| :--- | :--- | :--- |
| **Client Framework** | Expo Managed Workflow (SDK 57) | Continuous Native Generation (`CNG`). No manual `ios/` or `android/` folders. |
| **React / React Native** | React 19.2.3, React Native 0.86.3 | Latest architecture. |
| **Engine / Hermes** | Hermes enabled | WebAssembly (`WASM`) is **not** supported on Hermes. Native C/C++ bindings must be used for crypto. |
| **Routing** | Expo Router (`~57.0.24`) | File-based routing in `src/app/`. |
| **Target Platforms** | Mobile-only: iOS and Android | Web builds are out of scope for E2EE native primitives. Dev builds (`npx expo run:android` / `run:ios` or EAS) required. |
| **Backend Framework** | Node.js + Express 5.2.1 + TypeScript (`tsx`) | Runs on port 5000. |
| **Database** | MongoDB Atlas (`mongodb+srv://...`) | Cluster deployment. **Multi-document transactions (`session.withTransaction`) are fully supported.** |
| **Realtime Transport** | Socket.IO 4.8.4 | Custom auth middleware via Better Auth session tokens. |
| **Auth System** | Better Auth 1.7.7 | Session token passed via HTTP header or handshake auth. |
| **Attachment Storage** | Cloudinary 2.11.0 | Backend currently configures signed uploads / resource management. |

---

## 2. Answers to Specification Open Questions (Section 12)

1. **Expo (managed) or bare?**  
   Expo Managed Workflow (SDK 57, CNG). Requires Development Builds (`expo prebuild`) for native C libraries (`react-native-libsodium` and SQLCipher).
2. **Device policy for v1?**  
   **1 active device per user.** Logging in on a new device revokes the old device's key registration.
3. **Maximum group size?**  
   256 recipient devices per message in v1.
4. **Chat history backup on device loss?**  
   **Encrypted Cloud Backup is in scope.** Uses a zero-knowledge user-chosen password with Argon2id key derivation and XChaCha20-Poly1305 encryption. The server stores only ciphertext and cannot decrypt or reset it.
5. **Closed-source vs open-source?**  
   Proprietary/closed-source mobile chat app. Avoid GPL/AGPL dependencies.
6. **Web client planned?**  
   No. Mobile only (iOS & Android).
7. **Existing dev data in MongoDB?**  
   Managed manually by owner. No automatic database wipe or complex legacy migration script needed.
8. **MongoDB replica set?**  
   Yes. Confirmed MongoDB Atlas replica set; native atomic transactions work.
9. **Legal / compliance conflicts?**  
   None specified; zero-knowledge design is the priority.

---

## 3. Cryptographic & Storage Selections

### 3.1 Local Storage
- **Choice:** `expo-sqlite` with the SQLCipher config plugin (`["expo-sqlite", { "useSQLCipher": true }]`).
- **Rationale:** Native to Expo SDK 57, maintained directly by Expo team, avoids third-party patch friction, and provides transparent full-database encryption at rest.
- **Master DB Key:** 32 random bytes generated on first launch and stored in `expo-secure-store` (iOS Keychain / Android Keystore).

### 3.2 Hardware-Backed Key Storage
- **Choice:** `expo-secure-store`.
- **Configuration:**
  - iOS: `KeychainAccessible.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (ensures keys do not sync to iCloud or restore across devices).
  - Android: `dataExtractionRules` and auto-backup exclusions so key material is never backed up to Google Drive in plaintext.

### 3.3 Core Cryptography
- **Choice:** `react-native-libsodium` (with Expo config plugin).
- **Primitives:**
  - Content Encryption: XChaCha20-Poly1305 AEAD (`crypto_aead_xchacha20poly1305_ietf_encrypt` / `decrypt`).
  - Key Wrapping: X25519 + XSalsa20-Poly1305 box (`crypto_box_easy` / `crypto_box_open_easy`).
  - Signatures: Ed25519 (`crypto_sign_detached` / `crypto_sign_verify_detached`).
  - Key Derivation for Backups: Argon2id (`crypto_pwhash`).
  - Fingerprints / Safety Numbers: BLAKE2b (`crypto_generichash`).

---

## 4. Encrypted Cloud Backup Design (Zero-Knowledge)

1. **User Password Derivation:**
   - Password provided by user at backup setup.
   - Salt: 16 random bytes (stored alongside backup metadata).
   - Algorithm: Argon2id (`crypto_pwhash`, `OPSLIMIT_MODERATE`, `MEMLIMIT_MODERATE`).
   - Output: 32-byte symmetric backup key.
2. **Backup Packaging:**
   - Client creates a snapshot of the local database.
   - Encrypted with XChaCha20-Poly1305 using the backup key and a random 24-byte nonce.
   - Uploaded as an authenticated raw blob.
3. **Restore Flow:**
   - On new device, user inputs their backup password.
   - App downloads encrypted blob + salt, derives key, decrypts payload, and restores local SQLite database.
   - *Zero-Knowledge Guarantee:* The server never possesses the password, the derived key, or the plaintext backup. If the user forgets their password, the backup cannot be recovered.

---

## 5. Implementation Milestones Completed & Verification

| Phase | Description | Components & Deliverables | Verification Status |
| :--- | :--- | :--- | :--- |
| **Phase 0** | Recon & Decisions | `docs/e2ee/DECISIONS.md`, stack constraints | **Complete & Approved** |
| **Phase 1** | Crypto Core | `E2EECipher.ts`, `sodiumCipher.ts`, `encoding.ts`, `safetyNumber.ts` | **Complete** (23 unit tests pass) |
| **Phase 2** | Client Key & Local DB | `keyStore.ts` (SecureStore), `localDb.ts` (SQLCipher), `keyDirectory.ts` (TOFU) | **Complete** (Tests pass) |
| **Phase 3** | Backend Models & Endpoints | `Message.ts`, `Device.ts`, `MessageKey.ts`, `Backup.ts`, `e2ee.controller.ts`, `socket.ts` | **Complete** (Typecheck pass) |
| **Phase 4** | 1:1 Messaging Pipeline | `messageService.ts`, `MessagingScreen.tsx`, decrypted previews in `chats.tsx` | **Complete** |
| **Phase 5** | Encrypted Attachments | `attachmentService.ts`, Cloudinary raw signed upload, local decryption | **Complete** |
| **Phase 6** | Group Messaging Support | 256 recipient device fan-out wrapping, 409 stale-recipient detection | **Complete** |
| **Phase 7** | Verification UX | `SecurityCodeModal.tsx`, 60-digit safety numbers, key change alert banners | **Complete** |
| **Phase 3.10**| Cloud Backups UX & Logic | `backupService.ts`, `BackupSettingsModal.tsx` in `ProfileScreen` (Settings) | **Complete** (Tests pass) |
| **Phase 8** | Hardening & Canary | `SECURITY.md`, `PROTOCOL.md`, `canaryLeakage.test.ts`, logout key wipe | **Complete** (Canary passes) |

**Final Verification Summary:**
- Root TypeScript: 0 errors (`npx tsc --noEmit`)
- Backend TypeScript: 0 errors (`npx tsc --noEmit` in `backend`)
- Root ESLint: 0 errors, 0 warnings (`npx expo lint`)
- Automated Jest Suite: 8 test suites passed, 41 out of 41 tests passing (`npm test`)

