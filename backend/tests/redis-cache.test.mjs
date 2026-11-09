import { initRedis, getRedis, closeRedis, isRedisAvailable, invalidateUserSessionCache } from '../dist/config/redis.js';
import { secondaryStorage } from '../dist/auth.js';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('=================================================');
  console.log('   REDIS SESSION CACHING & FALLBACK TEST SUITE   ');
  console.log('=================================================');

  // Suite 1: Disabled mode (ENABLE_REDIS=false)
  console.log('\n[Suite 1] Graceful Disabled Mode (ENABLE_REDIS=false)');
  process.env.ENABLE_REDIS = 'false';
  const disabledClient = initRedis();
  assert(disabledClient === null, 'initRedis returns null when ENABLE_REDIS=false');
  assert(getRedis() === null, 'getRedis returns null when ENABLE_REDIS=false');
  assert(isRedisAvailable() === false, 'isRedisAvailable returns false when ENABLE_REDIS=false');

  // Reset env
  delete process.env.ENABLE_REDIS;

  // Suite 2: Real secondaryStorage adapter fallback (When Redis is offline/null)
  console.log('\n[Suite 2] Real secondaryStorage Adapter Fallback (When Redis is offline)');
  const fallbackGet = await secondaryStorage.get('session:test_token');
  assert(fallbackGet === null, 'secondaryStorage.get returns null gracefully when Redis is disabled/offline');

  const fallbackSetResult = await secondaryStorage.set('session:test_token', '{"session":{}}', 300);
  assert(fallbackSetResult === undefined, 'secondaryStorage.set completes safely without throwing');

  const fallbackDeleteResult = await secondaryStorage.delete('session:test_token');
  assert(fallbackDeleteResult === undefined, 'secondaryStorage.delete completes safely without throwing');

  const fallbackGetDel = await secondaryStorage.getAndDelete('session:test_token');
  assert(fallbackGetDel === null, 'secondaryStorage.getAndDelete returns null gracefully');

  const fallbackIncr = await secondaryStorage.increment('rate_limit:test', 60);
  assert(fallbackIncr === 0, 'secondaryStorage.increment returns 0 gracefully when Redis is offline');

  // Suite 3: Better Auth Hybrid Persistence & Transparent Mongo Fallback
  console.log('\n[Suite 3] Better Auth Hybrid Persistence & Transparent Mongo Fallback');
  let mongoFindSessionCalls = 0;
  const mockMongoDb = {
    collection: (name) => ({
      findOne: async (query) => {
        if (name === 'session') {
          mongoFindSessionCalls++;
          return {
            _id: 'sess_1',
            token: 'fallback_token_123',
            userId: 'user_fallback_abc',
            expiresAt: new Date(Date.now() + 86400 * 1000),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        if (name === 'user') {
          return {
            _id: 'user_fallback_abc',
            id: 'user_fallback_abc',
            email: 'fallback@chatuk.local',
            name: 'Fallback User',
            createdAt: new Date(),
            updatedAt: new Date(),
            emailVerified: true,
          };
        }
        return null;
      },
      aggregate: (pipeline) => ({
        toArray: async () => {
          if (name === 'session') {
            mongoFindSessionCalls++;
            return [{
              _id: 'sess_1',
              token: 'fallback_token_123',
              userId: 'user_fallback_abc',
              expiresAt: new Date(Date.now() + 86400 * 1000),
              createdAt: new Date(),
              updatedAt: new Date(),
            }];
          }
          if (name === 'user') {
            return [{
              _id: 'user_fallback_abc',
              email: 'fallback@chatuk.local',
              name: 'Fallback User',
              createdAt: new Date(),
              updatedAt: new Date(),
              emailVerified: true,
            }];
          }
          return [];
        }
      }),
      insertOne: async () => ({ insertedId: '1' }),
      deleteMany: async () => ({ deletedCount: 0 }),
    })
  };

  const testAuthInstance = betterAuth({
    secret: '12345678901234567890123456789012',
    baseURL: 'http://localhost:5000',
    database: mongodbAdapter(mockMongoDb),
    session: {
      storeSessionInDatabase: true, // Crucial architectural fix!
      expiresIn: 60 * 60 * 24 * 7,
    },
    secondaryStorage, // Wire secondaryStorage
  });

  const ctx = await testAuthInstance.$context;
  const resolvedSession = await ctx.internalAdapter.findSession('fallback_token_123');
  assert(resolvedSession !== null, 'Better Auth successfully resolves session from MongoDB when Redis misses');
  assert(resolvedSession?.user?.email === 'fallback@chatuk.local', 'Resolved user profile matches MongoDB record');
  assert(mongoFindSessionCalls > 0, 'MongoDB query executed as transparent fallback');

  // Suite 4: User Session Cache Invalidation (invalidateUserSessionCache)
  console.log('\n[Suite 4] User Session Cache Invalidation');
  // Safe execution when Redis is offline
  await invalidateUserSessionCache('user_test_123');
  assert(true, 'invalidateUserSessionCache safely handles offline Redis without throwing');

  // Suite 5: Unreachable Host Resilience & Safe Teardown
  console.log('\n[Suite 5] Unreachable Host Resilience & Safe Teardown');
  process.env.REDIS_URL = 'redis://127.0.0.1:65530'; // Invalid port
  const unreachableClient = initRedis();
  assert(unreachableClient !== null, 'Client initializes with retry strategy for offline redis');
  assert(getRedis() === null, 'getRedis returns null while connection is not ready');
  assert(isRedisAvailable() === false, 'isRedisAvailable returns false while connection is not ready');

  const startClose = Date.now();
  await closeRedis();
  const closeDuration = Date.now() - startClose;
  assert(getRedis() === null, 'closeRedis cleans up client properly');
  assert(closeDuration < 2000, `closeRedis terminates quickly without hanging (${closeDuration}ms < 2000ms)`);

  console.log('\n=================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('=================================================');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
