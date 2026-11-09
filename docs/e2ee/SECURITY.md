# Chatuk E2EE Security Model & Architecture

**Document Version:** 1.0.0  
**Target Architecture:** Expo / React Native Mobile (iOS & Android) + Node.js/Mongoose Backend + Cloudinary  
**Cryptographic Primitives Engine:** `libsodium` (via `react-native-libsodium` / `libsodium-wrappers-sumo`)  

---

## 1. Executive Summary & Claims Policy

Chatuk implements End-to-End Encryption (E2EE) for direct and group conversations. All message content and attachments are encrypted directly on the sender's device before transmission and can only be decrypted by the intended recipient devices. The central application servers, MongoDB databases, and Cloudinary media stores only ever handle opaque ciphertexts and encrypted blobs.

### Approved Communication Claims
> "Messages and attachments in Chatuk are end-to-end encrypted. Our servers store only ciphertext and cannot read your messages."

### Prohibited Claims
Do NOT describe Chatuk v1 as "the same as WhatsApp" or "Signal-grade". While Chatuk uses modern libsodium primitives, protocol version 1 uses envelope/hybrid encryption rather than the Double Ratchet with Forward Secrecy. Full forward secrecy is scheduled for protocol v2.

---

## 2. Threat Model

### 2.1 What Chatuk E2EE Protects Against

1. **Compromised or Curious Server Operators:**
   - Database administrators, cloud hosting providers, or an attacker with full root access or database dump access cannot read message content, inspect attachment images/audio, or derive content keys.
2. **Untrusted Third-Party Storage (Cloudinary):**
   - Attachments are encrypted on the client device with random 32-byte content keys before upload. Cloudinary stores only raw encrypted binary streams.
3. **Network Eavesdropping and Tampering:**
   - Even if TLS is terminated, inspected, or compromised by an adversary, message ciphertexts are cryptographically authenticated with Ed25519 signatures and XChaCha20-Poly1305 AEAD.
4. **Replay, Injection & Cross-Conversation Substitution:**
   - Additional Authenticated Data (AAD) cryptographically binds each message ciphertext to its `conversationId`, `clientMessageId`, `senderId`, `senderDeviceId`, and `type`. Ciphertext intercepted in one conversation cannot be replayed or moved into another.

### 2.2 What Chatuk E2EE Does NOT Protect Against (Explicit Limitations)

1. **Compromised or Unlocked Physical Devices:**
   - If an adversary gains root access, physical access to an unlocked phone, or installs spyware on the device OS, they can read messages cached in UI memory.
2. **Metadata Visibility:**
   - The server must route messages and therefore knows:
     - Who communicates with whom (participant user IDs).
     - Timestamps of message transmission.
     - Approximate size of messages and attachments.
     - Group membership lists.
3. **Lack of Forward Secrecy in Protocol v1:**
   - v1 uses long-term device public keys (`X25519`) to wrap per-message content keys. If an attacker compromises a device's long-term `boxSk` AND obtains stored past ciphertexts (e.g. from a past database dump), they could decrypt past messages received by that specific device. Forward secrecy with ephemeral prekey ratcheting (Signal Protocol) is planned for v2.
4. **Malicious Public Key Injection (Mitigated via TOFU & Safety Numbers):**
   - If a compromised server lies about a user's public keys, the client's Trust-On-First-Use (TOFU) pinning detects the key change, alerts both users with an inline security notice, and provides a 60-digit safety number for out-of-band verification.

---

## 3. Cryptographic Primitives

Chatuk strictly adheres to audited libsodium primitives and constructions. Custom ciphers or hand-rolled primitives are strictly forbidden.

| Purpose | Primitive / Algorithm | libsodium API |
|---|---|---|
| **Content Encryption** | XChaCha20-Poly1305 (IETF AEAD) | `crypto_aead_xchacha20poly1305_ietf_encrypt` / `decrypt` |
| **Key Wrapping** | X25519 + XSalsa20-Poly1305 | `crypto_box_easy` / `crypto_box_open_easy` |
| **Sender Signatures** | Ed25519 Detached Signatures | `crypto_sign_detached` / `crypto_sign_verify_detached` |
| **Entropy & Nonces** | OS CSPRNG (24-byte nonces) | `randombytes_buf` |
| **Fingerprints & Hashes** | BLAKE2b (32-byte generic hash) | `crypto_generichash` |
| **Payload Padding** | ISO/IEC 7816-4 (block size 160 bytes) | `sodium_pad` / `sodium_unpad` |
| **Backup Key Derivation** | Argon2id (`crypto_pwhash`) | OPSLIMIT_INTERACTIVE (2), MEMLIMIT_INTERACTIVE (64 MB) |
| **Memory Sanitation** | Best-effort zeroization | `sodium_memzero` |

---

## 4. Key Management & Storage Hierarchy

### 4.1 Device Identity Keys
Each device generates a unique device identity on first run:
- `deviceId`: Random UUIDv4 identifying the installation.
- `signPk` / `signSk`: Ed25519 keypair for message signing and identity binding.
- `boxPk` / `boxSk`: X25519 keypair for recipient envelope key exchange.
- `boxKeySignature`: Ed25519 detached signature over `"e2ee-v1-boxkey|" || deviceId || boxPk` proving possession and binding between identity and encryption keys.

### 4.2 Hardware Keystore Isolation
All private keys (`signSk`, `boxSk`) and the local database master key are stored exclusively in hardware-backed storage via `expo-secure-store`:
- **iOS:** Keychain with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. Keys are never synced to iCloud Keychain or transferred via device migration.
- **Android:** Android Keystore with OS auto-backup exclusions.
- **Rule:** Private keys NEVER touch `AsyncStorage`, plain SQLite, unencrypted MMKV, log files, or remote payloads.
- **Wipe on Logout:** When a user logs out, `wipeAllSecureKeys()` and `wipeLocalDb()` purge all local keys and drop all decrypted SQLite tables.

### 4.3 Local Encrypted Database (SQLCipher)
- All locally cached messages, decrypted payloads, and TOFU pinned keys are stored in an encrypted SQLite database managed by `expo-sqlite` with SQLCipher encryption.
- The 256-bit database key is randomly generated on first launch and preserved exclusively in hardware SecureStore.

---

## 5. Zero-Knowledge Cloud Backups

Chatuk provides zero-knowledge cloud backups so users can recover their chat history across devices without exposing plaintext to servers:
1. User provides a private backup passphrase (minimum 6 characters).
2. A random 16-byte salt and 24-byte nonce are generated via CSPRNG.
3. A 256-bit key is derived from the passphrase and salt using **Argon2id** (`crypto_pwhash`).
4. The local message history is exported to JSON, padded, and encrypted with **XChaCha20-Poly1305** authenticated with AAD `"chatuk-backup-v1"`.
5. The memory buffer holding the derived key is immediately zeroized (`sodium_memzero`).
6. The opaque ciphertext blob, salt, and nonce are stored in MongoDB. The server cannot derive the key or decrypt the backup without the user's password.

---

## 6. Security Canary & Verification

To prevent accidental regressions, Chatuk employs an automated Security Canary:
- Canary string tokens (`CANARY_7f3a91...`) and known plaintext media bytes are routed through client encryption, network serialization, database models, and local caching.
- Automated tests assert that raw canary markers appear in ZERO database fields, logs, or unencrypted payloads.
- Mongoose schema pre-validation hooks strictly reject any non-system message that contains a plaintext `content` field or lacks an `encrypted` payload.
