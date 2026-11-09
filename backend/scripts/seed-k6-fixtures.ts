import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';

dotenv.config();

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests', 'k6', 'fixtures');
const FIXTURES_FILE = path.join(FIXTURES_DIR, 'test-users.json');

const NUM_USERS = parseInt(process.env.NUM_USERS || '120', 10);

interface SeedUser {
  id: string;
  name: string;
  email: string;
  token: string;
  deviceId: string;
  signPublicKey: string;
  boxPublicKey: string;
}

interface SeedConversation {
  id: string;
  type: 'direct' | 'group';
  name?: string;
  participantIds: string[];
  sampleMessageId?: string;
}

async function connectToDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not defined in environment variables.');
    process.exit(1);
  }
  await mongoose.connect(uri);
}

async function cleanFixtures(db: any) {
  console.log('🧹 Cleaning existing k6 test fixtures...');
  const resUsers = await db.collection('user').deleteMany({ isK6Fixture: true });
  const resSessions = await db.collection('session').deleteMany({ isK6Fixture: true });
  const resDevices = await db.collection('devices').deleteMany({ isK6Fixture: true });
  const resConvs = await db.collection('conversations').deleteMany({ isK6Fixture: true });
  const resMsgs = await db.collection('messages').deleteMany({ isK6Fixture: true });
  const resKeys = await db.collection('messagekeys').deleteMany({ isK6Fixture: true });

  console.log(`   Deleted: ${resUsers.deletedCount} users, ${resSessions.deletedCount} sessions, ${resConvs.deletedCount} convs, ${resMsgs.deletedCount} msgs, ${resDevices.deletedCount} devices, ${resKeys.deletedCount} keys.`);

  if (fs.existsSync(FIXTURES_FILE)) {
    try {
      const fixtureData = JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf-8'));
      if (Array.isArray(fixtureData?.users) && fixtureData.users.length > 0) {
        const { Redis } = await import('ioredis');
        const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
          maxRetriesPerRequest: 1,
          connectTimeout: 1000,
          retryStrategy: () => null,
        });
        redis.on('error', () => {});
        const pipeline = redis.pipeline();
        for (const u of fixtureData.users) {
          if (u.token) pipeline.del(u.token);
        }
        await pipeline.exec();
        await redis.quit().catch(() => redis.disconnect());
      }
    } catch {}
    fs.unlinkSync(FIXTURES_FILE);
    console.log(`   Removed fixture file: ${FIXTURES_FILE}`);
  }
}

async function seed() {
  const isCleanOnly = process.argv.includes('--clean');

  console.log('====================================================');
  console.log('        CHATUK k6 TEST FIXTURES SEEDER             ');
  console.log('====================================================');

  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection failed.');
  }

  if (isCleanOnly) {
    await cleanFixtures(db);
    console.log('✅ Cleanup complete. Exiting.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Always clean previous fixtures first for deterministic state
  await cleanFixtures(db);

  console.log(`\n🌱 Seeding ${NUM_USERS} test users with active sessions...`);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days valid

  const userDocs: any[] = [];
  const sessionDocs: any[] = [];
  const deviceDocs: any[] = [];
  const seedUsers: SeedUser[] = [];

  for (let i = 1; i <= NUM_USERS; i++) {
    const userObjectId = new ObjectId();
    const token = `k6_session_tok_${i}_${crypto.randomBytes(16).toString('hex')}`;
    const deviceId = `k6-device-uuid-${i}-${crypto.randomBytes(4).toString('hex')}`;
    const signPublicKey = crypto.randomBytes(32).toString('base64');
    const boxPublicKey = crypto.randomBytes(32).toString('base64');
    const boxKeySignature = crypto.randomBytes(64).toString('base64');

    const email = `k6_user_${i}@chatuk.local`;
    const name = `K6 User ${i}`;

    userDocs.push({
      _id: userObjectId,
      email,
      name,
      emailVerified: true,
      image: null,
      avatarPublicId: null,
      bio: `Automated load test account #${i}`,
      theme: i % 2 === 0 ? 'dark' : 'light',
      wallpaper: 'default',
      isK6Fixture: true,
      createdAt: now,
      updatedAt: now,
    });

    sessionDocs.push({
      _id: new ObjectId(),
      token,
      userId: userObjectId.toString(),
      expiresAt,
      createdAt: now,
      updatedAt: now,
      isK6Fixture: true,
    });

    deviceDocs.push({
      _id: new ObjectId(),
      userId: userObjectId,
      deviceId,
      signPublicKey,
      boxPublicKey,
      boxKeySignature,
      registeredAt: now,
      createdAt: now,
      updatedAt: now,
      isK6Fixture: true,
    });

    seedUsers.push({
      id: userObjectId.toString(),
      name,
      email,
      token,
      deviceId,
      signPublicKey,
      boxPublicKey,
    });
  }

  await db.collection('user').insertMany(userDocs);
  await db.collection('session').insertMany(sessionDocs);
  await db.collection('devices').insertMany(deviceDocs);
  console.log(`   ✅ Inserted ${userDocs.length} users, sessions, and devices.`);

  // Create Direct Conversations (Pairs: 1<->2, 3<->4, etc.)
  console.log('\n💬 Seeding conversations and sample message feeds...');
  const convDocs: any[] = [];
  const seedConversations: SeedConversation[] = [];
  const messageDocs: any[] = [];

  for (let i = 0; i < NUM_USERS; i += 2) {
    const u1 = seedUsers[i];
    const u2 = seedUsers[i + 1];
    if (!u1 || !u2) break;

    const convId = new ObjectId();
    const u1ObjId = new ObjectId(u1.id);
    const u2ObjId = new ObjectId(u2.id);

    // Seed 5 messages per conversation
    const msgIds: ObjectId[] = [];
    for (let m = 1; m <= 5; m++) {
      const msgId = new ObjectId();
      msgIds.push(msgId);
      const isSenderU1 = m % 2 === 1;

      messageDocs.push({
        _id: msgId,
        conversationId: convId,
        senderId: isSenderU1 ? u1ObjId : u2ObjId,
        type: 'text',
        clientMessageId: `k6-msg-init-${convId}-${m}`,
        content: '',
        encrypted: {
          v: 1,
          senderDeviceId: isSenderU1 ? u1.deviceId : u2.deviceId,
          nonce: crypto.randomBytes(24).toString('base64'),
          ct: crypto.randomBytes(64).toString('base64'),
          sig: crypto.randomBytes(64).toString('base64'),
        },
        readBy: [u1ObjId, u2ObjId],
        deliveredTo: [u1ObjId, u2ObjId],
        deletedBy: [],
        reactions: [
          {
            userId: isSenderU1 ? u2ObjId : u1ObjId,
            userName: isSenderU1 ? u2.name : u1.name,
            emoji: '👍',
            createdAt: now,
          },
        ],
        createdAt: new Date(now.getTime() - (6 - m) * 60000),
        updatedAt: new Date(now.getTime() - (6 - m) * 60000),
        isK6Fixture: true,
      });
    }

    const lastMsgId = msgIds[msgIds.length - 1];

    convDocs.push({
      _id: convId,
      type: 'direct',
      participants: [u1ObjId, u2ObjId],
      status: 'accepted',
      initiatorId: u1ObjId,
      lastMessage: lastMsgId,
      clearedBy: [],
      createdAt: now,
      updatedAt: now,
      isK6Fixture: true,
    });

    seedConversations.push({
      id: convId.toString(),
      type: 'direct',
      participantIds: [u1.id, u2.id],
      sampleMessageId: lastMsgId.toString(),
    });
  }

  // Create Global Benchmark Group with ALL users
  const globalGroupId = new ObjectId();
  const allParticipantObjIds = seedUsers.map((u) => new ObjectId(u.id));
  const globalLastMsgId = new ObjectId();

  messageDocs.push({
    _id: globalLastMsgId,
    conversationId: globalGroupId,
    senderId: allParticipantObjIds[0],
    type: 'system',
    clientMessageId: `k6-global-init-1`,
    content: 'Welcome to K6 Global Concurrency Benchmark Channel',
    readBy: allParticipantObjIds,
    deliveredTo: allParticipantObjIds,
    deletedBy: [],
    reactions: [],
    createdAt: now,
    updatedAt: now,
    isK6Fixture: true,
  });

  convDocs.push({
    _id: globalGroupId,
    type: 'group',
    name: 'K6 Global Concurrency Group',
    description: 'Shared channel for 100+ concurrent virtual users',
    participants: allParticipantObjIds,
    adminIds: [allParticipantObjIds[0]],
    status: 'accepted',
    initiatorId: allParticipantObjIds[0],
    lastMessage: globalLastMsgId,
    clearedBy: [],
    createdAt: now,
    updatedAt: now,
    isK6Fixture: true,
  });

  seedConversations.push({
    id: globalGroupId.toString(),
    type: 'group',
    name: 'K6 Global Concurrency Group',
    participantIds: seedUsers.map((u) => u.id),
    sampleMessageId: globalLastMsgId.toString(),
  });

  await db.collection('conversations').insertMany(convDocs);
  await db.collection('messages').insertMany(messageDocs);

  console.log(`   ✅ Inserted ${convDocs.length} conversations and ${messageDocs.length} test messages.`);

  // If Redis is reachable, pre-warm secondaryStorage with k6 sessions for sub-2ms benchmarks
  try {
    const { Redis } = await import('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      retryStrategy: () => null,
    });
    redis.on('error', () => {});
    const pong = await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
    ]).catch(() => null);

    if (pong === 'PONG') {
      console.log('\n⚡ Pre-warming Redis secondaryStorage with k6 test sessions...');
      const pipeline = redis.pipeline();
      const ttlSeconds = 30 * 24 * 3600;
      for (let i = 0; i < seedUsers.length; i++) {
        const u = seedUsers[i];
        const s = sessionDocs[i];
        if (u && s) {
          const payload = JSON.stringify({
            session: s,
            user: userDocs[i],
          });
          pipeline.set(u.token, payload, 'EX', ttlSeconds);
        }
      }
      await pipeline.exec();
      console.log(`   ✅ Pre-warmed ${seedUsers.length} session keys in Redis RAM.`);
      await redis.quit().catch(() => redis.disconnect());
    }
  } catch {
    // Redis pre-warming skipped if offline
  }

  // Write out test-users.json fixture file
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  const fixtureOutput = {
    generatedAt: now.toISOString(),
    baseUrl: process.env.BETTER_AUTH_URL || 'http://localhost:5000',
    users: seedUsers,
    conversations: seedConversations,
  };

  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(fixtureOutput, null, 2), 'utf-8');
  console.log(`\n📁 Fixture saved successfully to: ${FIXTURES_FILE}`);
  console.log('✨ All fixtures seeded and ready for k6 execution!');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});

