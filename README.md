<img src="./assets/icon.png" alt="ChatUK" width="120" />

> **Ultra-Fast, Secure & Zero-Knowledge End-to-End Encrypted (E2EE) Mobile Messaging and Voice Calling Platform.**

Built with **React Native (Expo SDK 58)**, **TypeScript**, **Node.js (Express 5)**, **Socket.IO**, **Redis**, and **MongoDB Atlas**, featuring Signal-grade cryptography via **Libsodium** and hardware-keyed **SQLCipher** local storage.

---

## Table of Contents

- [Overview](#overview)
- [Application Screenshots](#application-screenshots)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Interactive API Documentation (Swagger / OpenAPI)](#interactive-api-documentation-swagger--openapi)
- [Performance Deep Dive: Redis In-Memory Auth Cache](#performance-deep-dive-redis-in-memory-auth-cache)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Clone & Install Dependencies](#1-clone--install-dependencies)
  - [2. Environment Variables Configuration](#2-environment-variables-configuration)
  - [3. Start Backend Services](#3-start-backend-services)
    - [Option A: Docker Compose (Recommended)](#option-a-docker-compose-recommended)
    - [Option B: Manual Node.js Development](#option-b-manual-nodejs-development)
  - [4. Start the Mobile Client](#4-start-the-mobile-client)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Project Structure](#project-structure)
- [Security & Cryptography](#security--cryptography)
- [License](#license)

---

## Overview

**ChatUK** is a privacy-first mobile messaging and calling platform engineered for high performance, reliability, and security. All messages, media attachments, and reactions are encrypted directly on the client before being sent across the network. The backend server acts strictly as an untrusted, zero-knowledge blind relay — it never has access to plaintext message contents or cryptographic private keys.

---

## Application Screenshots

| Welcome & Onboarding | Secure Authentication | Chats & Invitations |
| :---: | :---: | :---: |
| <img src="./git-images/app/img1.jpeg" width="240" alt="Welcome & Onboarding" /><br><sub>Privacy-first onboarding & security highlights</sub> | <img src="./git-images/app/img2.jpeg" width="240" alt="Secure Authentication" /><br><sub>Credentials & Google OAuth sign-in</sub> | <img src="./git-images/app/img3.jpeg" width="240" alt="Chats & Invitations" /><br><sub>Encrypted previews & invitation workflows</sub> |

| E2EE Chat & Voice Notes | Security & Safety Numbers | Group Chat Creation | Profile & Settings |
| :---: | :---: | :---: | :---: |
| <img src="./git-images/app/img4.jpeg" width="240" alt="E2EE Chat & Voice Notes" /><br><sub>Real-time messaging, audio waveform & reactions</sub> | <img src="./git-images/app/img5.jpeg" width="240" alt="Contact Info & Security Verification" /><br><sub>Safety number verification & media gallery</sub> | <img src="./git-images/app/img6.jpeg" width="240" alt="Group Chat Creation" /><br><sub>Multi-participant group setup & email invites</sub> | <img src="./git-images/app/img7.jpeg" width="240" alt="Profile & Settings" /><br><sub>Profile customization, privacy & preferences</sub> |

---

## Key Features

- **Signal-Grade End-to-End Encryption (E2EE)**:
  - **Symmetric Cipher**: XChaCha20-Poly1305 AEAD with 256-bit keys and 192-bit nonces.
  - **Asymmetric Key Wrapping**: X25519 ECDH + XSalsa20-Poly1305 multi-recipient envelope encryption.
  - **Identity & Authenticity**: Ed25519 digital signatures to protect against impersonation and MITM attacks.
  - **Zero-Knowledge Cloud Backups**: User passphrase key derivation via Argon2id (`crypto_pwhash`).
  - **Encrypted Local Storage**: Hardware-isolated key storage via iOS Keychain / Android Keystore, paired with on-device database encryption via **SQLCipher** (`expo-sqlite`).
- **Real-Time Communication**:
  - WebSocket messaging via **Socket.IO** with automatic reconnection and fallback mechanisms.
  - Instant message delivery receipts, read status indicators, live typing indicators, and user presence.
  - Live emoji reactions synchronized in real-time.
- **WebRTC Voice Calling**:
  - Low-latency, peer-to-peer encrypted voice calling with real-time signaling handled over Socket.IO.
- **Group Chats & Conversation Management**:
  - 1-on-1 direct conversations with request acceptance/denial workflows.
  - Multi-user group conversations with administrative controls (promote/demote admins, remove participants).
- **Rich Customization & Media**:
  - Direct client-to-Cloudinary signed uploads strictly organized under `chatuk/` storage namespaces.
  - Multi-theme support (Dark, Light, and System themes) and customizable chat wallpapers with caching.
- **High-Throughput In-Memory Caching**:
  - Redis cache-aside layer powering sub-millisecond session validation and identity caching.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                   ChatUK Mobile Client (React Native / Expo)           │
│                                                                        │
│   ┌─────────────────────┐   ┌──────────────────┐   ┌───────────────┐   │
│   │   Libsodium Crypto  │   │  SQLCipher Local │   │  Better Auth  │   │
│   │   (XChaCha20/X25519)│   │  Encrypted SQLite│   │  Expo Client  │   │
│   └─────────────────────┘   └──────────────────┘   └───────────────┘   │
└──────────────────┬─────────────────────────────────────┬───────────────┘
                   │                                     │
      HTTPS REST API Calls                 Socket.IO & WebRTC Signaling
                   │                                     │
                   ▼                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   ChatUK Backend (Node.js / Express 5)                 │
│                                                                        │
│   ┌──────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │
│   │ Better Auth Core │    │ Socket.IO Server│    │ Swagger / OpenAPI│  │
│   │ (Session Engine) │    │ (Presence/State)│    │ Documentation   │   │
│   └────────┬─────────┘    └─────────────────┘    └─────────────────┘   │
└────────────┼───────────────────────────────────────────────────────────┘
             │
      ┌──────┴──────────────────────────────────────┐
      │                                             │
      ▼                                             ▼
┌───────────────────────────────┐     ┌───────────────────────────────────┐
│   In-Memory Cache (Redis)     │     │   Primary Database (MongoDB Atlas)│
│                               │     │                                   │
│  • Sub-2ms Session Validation │     │  • User & Device Identity Records │
│  • secondaryStorage Engine    │     │  • Blind Encrypted Message Store  │
│  • Instant Invalidation       │     │  • Multi-document Transactions    │
└───────────────────────────────┘     └───────────────────────────────────┘
```

---

## Interactive API Documentation (Swagger / OpenAPI)

The ChatUK backend includes a comprehensive, interactive OpenAPI 3.0 specification served directly from the Express server.

### Accessing Swagger Docs

Once the backend is running, open the following endpoints in your browser:

* **Interactive Swagger UI Dashboard**:  
  [`http://localhost:5000/api-docs`](http://localhost:5000/api-docs)
* **Raw OpenAPI 3.0 JSON Specification**:  
  [`http://localhost:5000/api-docs.json`](http://localhost:5000/api-docs.json)

### Documented Modules (34 Endpoints)

| Module | Route Prefix | Description |
| :--- | :--- | :--- |
| **Auth** | `/api/auth` | Sign-up, email/password login, active session inspection, and logout (Better-Auth). |
| **User & Profile** | `/api/user` | Profile details, avatar uploads (Cloudinary), bio, themes, and user blocking/unblocking. |
| **Messages & Conversations** | `/api/messages` | 1-on-1 chat initialization, cursor-paginated chat history, media feeds, reactions, and HTTP fallback. |
| **Group Chats** | `/api/groups` | Group creation, member additions/removals, admin role promotions, and exit workflows. |
| **E2EE & Devices** | `/api/e2ee` | Multi-device identity & prekey registration, recipient key discovery, and zero-knowledge cloud backups. |
| **Uploads** | `/api/uploads` | Cryptographically signed HMAC direct-upload tokens for Cloudinary and fallback uploads. |
| **Contact** | `/api/contact` | User feedback and bug report submissions via Nodemailer. |

> **Testing Authenticated Routes**: Click the **Authorize** button in Swagger UI and provide your session token (as a Bearer token or cookie) to run requests directly from the browser.

---

## Performance Deep Dive: Redis In-Memory Auth Cache

To prevent database bottlenecks under heavy chat concurrency, ChatUK integrates **Redis** as an in-memory caching layer via Better Auth's `secondaryStorage` interface. 

Every authenticated API request (`/profile`, `/conversations`, `/messages`, `/recipients`, `/reaction`) verifies session validity and retrieves user identity in sub-millisecond RAM rather than making network round-trips to MongoDB Atlas over TLS.

### Benchmark Results: MongoDB vs. Redis (100 Concurrent Virtual Users)

Tested with **Grafana k6** simulating 100 concurrent users executing realistic end-to-end chat cycles (authenticating, loading chats, fetching device keys, sending messages, and submitting reactions).

| Performance Metric | Before Redis (MongoDB Only) | After Redis (In-Memory Cache) | Performance Delta |
| :--- | :--- | :--- | :--- |
| **Total Requests Handled** | 1,324 requests | **1,465 requests** | **+10.6% more requests (+141 reqs)** |
| **Completed User Journeys** | 198 full cycles | **213 full cycles** | **+7.6% more cycles (+15 users)** |
| **System Throughput** | 7.59 req/sec | **8.37 req/sec** | **+10.3% higher throughput** |
| **Data Processed** | 10.01 MB (54 kB/s) | **11.57 MB (65 kB/s)** | **+20.4% higher network volume** |
| **Average Response Time (`avg`)** | 7.57 s | **6.96 s** | **~610 ms faster (-8.1%)** |
| **Median Response Time (`med`)** | 6.14 s | **5.58 s** | **~560 ms faster (-9.1%)** |
| **90th Percentile Latency ($p_{90}$)** | 12.10 s | **10.67 s** | **1.43 s faster (-11.8%)** |
| **95th Percentile Latency ($p_{95}$)** | 16.74 s | **13.43 s** | **3.31 s faster tail latency (-19.8%)** |
| **Average Full Cycle Duration** | 46.85 s | **42.10 s** | **4.75 s faster per user cycle** |
| **Redundant DB Auth Queries** | 2,648 Atlas queries | **0 queries (Served in RAM)** | **~2,930 queries 100% eliminated** |

### Key Takeaways

1. **Elimination of Database Saturation**: Over **2,900 redundant authentication queries** were completely removed from MongoDB Atlas during peak concurrency.
2. **Reduced Tail Latency ($p_{95}$)**: 95% of users experienced responses **3.31 seconds faster** under peak stress.
3. **Zero-Downtime Fallback**: If Redis becomes temporarily unavailable or disconnected, the backend automatically and transparently falls back to MongoDB Atlas without throwing errors or dropping sessions.
4. **Immediate Invalidation**: Upon logout, session tokens are purged from Redis immediately, ensuring strict security.

*(For full load-testing methodology and logs, refer to [docs/BENCHMARK_BEFORE_AFTER_REDIS.md](file:///d:/code_files/native-react/chatuk/docs/BENCHMARK_BEFORE_AFTER_REDIS.md)).*

---

## Tech Stack

### Mobile Application
- **Framework**: [React Native](https://reactnative.dev/) `0.88.0` with [Expo SDK 58](https://expo.dev/)
- **Routing**: [Expo Router](https://docs.expo.dev/router/introduction/) (File-based navigation)
- **Language**: TypeScript `6.0+`
- **Cryptography**: [`react-native-libsodium`](https://github.com/lyallp/react-native-libsodium) / `tweetnacl` / `@noble/curves`
- **Encrypted Storage**: [`expo-sqlite`](https://docs.expo.dev/versions/latest/sdk/sqlite/) (SQLCipher) & [`expo-secure-store`](https://docs.expo.dev/versions/latest/sdk/securestore/)
- **Voice Calling**: [`react-native-webrtc`](https://github.com/react-native-webrtc/react-native-webrtc)
- **Real-Time Client**: [`socket.io-client`](https://socket.io/) `4.8.4`
- **Authentication Client**: [`better-auth`](https://www.better-auth.com/) & [`@better-auth/expo`](https://www.better-auth.com/docs/integrations/expo)

### Backend Services
- **Runtime & Server**: Node.js `20+` (ESM) with [Express](https://expressjs.com/) `5.2.1`
- **Database**: [MongoDB](https://www.mongodb.com/) with [Mongoose](https://mongoosejs.com/) `9.10+`
- **In-Memory Cache**: [Redis](https://redis.io/) via [`ioredis`](https://github.com/redis/ioredis) `6.0+`
- **Authentication Engine**: [Better-Auth](https://www.better-auth.com/) `1.7.7` with secondary storage caching
- **Real-Time Gateway**: [Socket.IO](https://socket.io/) `4.8.4`
- **Media & File Storage**: [Cloudinary](https://cloudinary.com/) SDK (scoped strictly under `chatuk/`)
- **Email Service**: [Nodemailer](https://nodemailer.com/)
- **API Documentation**: [`swagger-ui-express`](https://github.com/scottie1984/swagger-ui-express) (OpenAPI 3.0)

---

## Getting Started

### Prerequisites

- **Node.js**: `v20.x` or later
- **npm** or **bun**
- **Docker & Docker Compose**: *(Recommended)* To run backend and Redis services automatically
- **MongoDB**: Local MongoDB instance or free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster
- **Redis**: Local Redis server (`redis-server`), cloud Redis instance (e.g. [Upstash](https://upstash.com/)), or Docker
- **Expo CLI**: Installed via `npx expo`

---

### 1. Clone & Install Dependencies

Clone the repository and install dependencies for both the mobile app and backend:

```bash
# Clone the repository
git clone https://github.com/your-username/chatuk.git
cd chatuk

# Install mobile dependencies
npm install

# Install backend dependencies
cd backend
npm install
cd ..
```

---

### 2. Environment Variables Configuration

Both the **Mobile App** and the **Backend** use separate `.env` files. Templates are provided via `.env.example`.

#### Backend Setup (`backend/.env`)

Create `backend/.env` by copying `backend/.env.example`:

```bash
cp backend/.env.example backend/.env
```

Configure the following variables in `backend/.env`:

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `PORT` | HTTP port for the Express backend | `5000` |
| `NODE_ENV` | Application environment | `development` |
| `MONGODB_URI` | MongoDB Atlas or local connection string | `mongodb+srv://user:pass@cluster.mongodb.net/chatuk` |
| `ENABLE_REDIS` | Enable or disable Redis in-memory cache | `true` |
| `REDIS_URL` | Redis server connection URL | `redis://127.0.0.1:6379` |
| `BETTER_AUTH_SECRET` | 32+ character cryptographic secret string | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Base URL of the backend authentication server | `http://localhost:5000` |
| `TRUSTED_ORIGINS` | Comma-separated list of trusted client origins | `http://localhost:5000,chatuk://,exp://` |
| `CLOUDINARY_URL` | Cloudinary API access credentials | `cloudinary://api_key:api_secret@cloud_name` |
| `MAIL_DOG_HOST` | *(Optional)* SMTP host for contact emails | `mail.maildog.io` |
| `MAIL_DOG_PORT` | *(Optional)* SMTP port | `2525` |
| `MAIL_DOG_USERNAME` | *(Optional)* SMTP username | `your_username` |
| `MAIL_DOG_PASSWORD` | *(Optional)* SMTP password | `your_password` |

#### Mobile Client Setup (`.env`)

Create `.env` in the root of the project by copying `.env.example`:

```bash
cp .env.example .env
```

Configure the backend connectivity parameters in `.env`:

| Variable | Description | Target Environment |
| :--- | :--- | :--- |
| `EXPO_PUBLIC_BACKEND_URL` | Backend URL for web browser or iOS Simulator | `http://localhost:5000` |
| `EXPO_PUBLIC_BACKEND_HOST` | Android Emulator loopback alias | `10.0.2.2` |
| `EXPO_PUBLIC_BACKEND_PORT` | Backend port number | `5000` |

>  **Physical Device Testing**: If testing with Expo Go on a physical phone over local Wi-Fi, set `EXPO_PUBLIC_BACKEND_URL=http://<YOUR_LOCAL_IP>:5000` (e.g. `http://192.168.1.150:5000`).

---

### 3. Start Backend Services

You can run the backend services using **Docker Compose** (recommended for an automated, containerized setup) or manually via **Node.js**:

#### Option A: Docker Compose (Recommended)

Docker Compose automatically orchestrates the Node.js Express & Socket.IO backend alongside the Redis caching engine within an isolated network with automated health checks.

```bash
# Start all backend services in the background
docker compose up -d
```

##### Docker Compose Command Reference

| Command | Description |
| :--- | :--- |
| `docker compose up` | Start all services in the foreground with live streamed logs (stop with `Ctrl+C`). |
| `docker compose up -d` | Start all services in the background (detached mode). |
| `docker compose up -d --build` | Rebuild backend image after code changes and recreate containers. |
| `docker compose logs -f` | Follow live logs from all services (`-f backend` for API only). |
| `docker compose ps` | Display status, health checks, and port mappings of all running containers. |
| `docker compose stop` | Pause running containers without removing them or deleting data. |
| `docker compose start` | Resume previously stopped containers. |
| `docker compose down` | Stop and remove containers and network (named volume data persists). |
| `docker compose --profile with-mongo up -d` | Launch backend + Redis + local MongoDB for 100% offline development. |

#### Option B: Manual Node.js Development

1. Ensure **Redis** is running:
   ```bash
   # If running locally via Redis CLI / service:
   redis-server
   ```
2. Launch the backend in development mode:
   ```bash
   cd backend
   npm run dev
   ```
   The backend will connect to MongoDB, initialize Redis caching, bind Socket.IO, and start listening on port `5000`.
3. Verify that the **Swagger documentation** is reachable:
   - Visit [`http://localhost:5000/api-docs`](http://localhost:5000/api-docs)

---

### 4. Start the Mobile Client

From the root project directory:

```bash
# Start the Expo development server
npx expo start
```

Press:
- `a` to open on an **Android Emulator**
- `i` to open on an **iOS Simulator**
- `w` to open on the **Web Browser**
- Or scan the QR code with **Expo Go** on your physical device.

---

## Testing & Quality Assurance

### Mobile Tests (Jest & Testing Library)
Run unit and integration tests across crypto components, SQLite caching, and UI flows:
```bash
npm test
```

### Backend Benchmark & Concurrency Tests (Grafana k6)
Run simulated load scenarios against the backend:
```bash
cd backend
npm run test:k6:smoke   # Quick sanity smoke test
npm run test:k6:load    # 100 virtual user load test
npm run test:k6:burst   # High-concurrency traffic burst
```

### Redis Cache Validation
Verify Redis cache-aside functionality, secondary storage sets, and fallbacks:
```bash
cd backend
npm run test:redis
```

### Type Checking & Linting
```bash
# Mobile Client Check
npx tsc --noEmit
npx expo lint

# Backend Check
cd backend
npx tsc --noEmit
```

---

## Project Structure

```
chatuk/
├── .env.example                  # Mobile client environment template
├── AGENTS.md                     # Agent engineering & codebase guidelines
├── app.json                      # Expo application manifest & config plugins
├── assets/                       # Global images, fonts, and brand assets
├── docs/                         # Architecture, E2EE protocol, and benchmark docs
│   ├── BENCHMARK_BEFORE_AFTER_REDIS.md
│   └── E2EE_PHASES_SUMMARY.md
├── git-images/                   # Media & screenshot storage for documentation
├── src/                          # Mobile Client Source Code
│   ├── app/                      # Expo Router screens & route layouts
│   ├── components/               # Reusable UI components & Toast notifications
│   ├── constants/                # Themes, styling constants, wallpaper configs
│   ├── context/                  # React contexts (Theme, Socket, Auth)
│   ├── crypto/                   # Libsodium primitives & XChaCha20-Poly1305 engine
│   ├── e2ee/                     # Device key stores, SQLCipher DB, Safety numbers
│   ├── lib/                      # Better Auth client & network configurations
│   ├── services/                 # Socket.IO client, WebRTC engine, Wallpaper cache
│   └── utils/                    # Formatting & crypto helpers
│
└── backend/                      # Node.js Express Backend
    ├── .env.example              # Backend environment template
    ├── package.json              # Backend dependencies & k6 test scripts
    ├── tsconfig.json             # Backend TypeScript configuration
    └── src/
        ├── app.ts                # Express setup, middleware, and Swagger routes
        ├── auth.ts               # Better Auth initialization & Redis secondaryStorage
        ├── server.ts             # HTTP server entrypoint & DB connection
        ├── socket.ts             # Socket.IO gateway, presence, and signaling
        ├── config/               # Cloudinary and Redis client configuration
        ├── controllers/          # Request handlers (User, Message, Group, E2EE, etc.)
        ├── docs/                 # OpenAPI 3.0 specification (`swagger.ts`)
        ├── middleware/           # Better Auth session & route protection middleware
        ├── models/               # Mongoose data schemas (User, Message, Device, etc.)
        ├── routes/               # Express modular route definitions
        └── services/             # Email dispatch & auxiliary services
```

---

## Security & Cryptography

ChatUK implements a zero-knowledge security architecture:

1. **Client-Side Key Generation**: Private signing (Ed25519) and exchange (X25519) keys are created on-device using secure hardware random number generators (`libsodium`). Private keys never leave the device.
2. **Untrusted Blind Server**: The Express backend and MongoDB database only store encrypted payloads, public keys, and nonces. It cannot decrypt conversations or view attachments.
3. **Hardware Storage**: Symmetric database encryption keys are stored in the platform's secure enclave (iOS Keychain / Android Keystore).
4. **Cloud Backup Confidentiality**: Backups are encrypted with a key derived through Argon2id with random salt; the server cannot decrypt backups without the user's master passphrase.

---

## License

This project is licensed under the [ISC License](LICENSE).

