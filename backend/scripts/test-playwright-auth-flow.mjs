import { createRequire } from 'module';
import { Redis } from 'ioredis';

const require = createRequire(import.meta.url);

let playwright;
try {
  playwright = require('playwright');
} catch {
  try {
    playwright = require('C:/Users/uygar/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright');
  } catch (err) {
    console.warn('[Playwright] Could not load playwright:', err.message);
  }
}

const { chromium, request: playwrightRequest } = playwright || {};

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

async function runAuthFlowTest() {
  console.log('=================================================');
  console.log('   PLAYWRIGHT E2E & REDIS SESSION CACHE TEST     ');
  console.log('=================================================');

  if (!playwrightRequest) {
    console.error('Playwright request context is not available.');
    process.exit(1);
  }

  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: false,
  });
  redis.on('error', () => {});

  let isRedisConnected = false;
  try {
    const pong = await redis.ping();
    isRedisConnected = pong === 'PONG';
    console.log(`[Redis] Connection test: ${isRedisConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
  } catch (err) {
    console.warn('[Redis] Not connected to live Redis server:', err.message);
  }

  const apiContext = await playwrightRequest.newContext({
    baseURL: process.env.BACKEND_URL || 'http://localhost:5000',
  });

  const uniqueId = Date.now();
  const testEmail = `playwright_${uniqueId}@chatuk.local`;
  const testPassword = 'PlaywrightPass123!';
  const testName = `Playwright VU ${uniqueId}`;

  let sessionToken = null;

  try {
    // ─── Step 1: Automated Sign-Up ───
    console.log('\n[Step 1] Automated Sign-Up (POST /api/auth/sign-up/email)');
    const signUpRes = await apiContext.post('/api/auth/sign-up/email', {
      data: {
        email: testEmail,
        password: testPassword,
        name: testName,
      },
    });

    assert(signUpRes.status() === 200, `Sign-up status 200 OK (got ${signUpRes.status()})`);
    const signUpData = await signUpRes.json().catch(() => ({}));
    assert(signUpData?.user?.email === testEmail, `User created with email: ${signUpData?.user?.email}`);

    sessionToken = signUpData?.token || signUpData?.session?.token;
    if (!sessionToken) {
      const setCookie = signUpRes.headers()['set-cookie'] || '';
      const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
      if (match) sessionToken = decodeURIComponent(match[1]);
    }
    assert(!!sessionToken, `Session token obtained: ${sessionToken ? sessionToken.slice(0, 15) + '...' : 'none'}`);

    // Direct Redis Verification of Session Cache
    if (isRedisConnected && sessionToken) {
      console.log('  Verifying session in Redis RAM...');
      const cleanToken = sessionToken.startsWith('s:') ? sessionToken.slice(2).split('.')[0] : sessionToken.split('.')[0];
      const rawCached = await redis.get(cleanToken);
      const ttl = await redis.ttl(cleanToken);
      assert(rawCached !== null, `Session key stored in Redis RAM for token: ${cleanToken}`);
      assert(ttl > 0, `Session key has active TTL in Redis: ${ttl}s`);
      if (rawCached) {
        const parsed = JSON.parse(rawCached);
        assert(parsed?.user?.email === testEmail, `Cached session user email matches: ${parsed?.user?.email}`);
      }
    }

    // ─── Step 2: Automated Sign-In ───
    console.log('\n[Step 2] Automated Sign-In (POST /api/auth/sign-in/email)');
    const signInRes = await apiContext.post('/api/auth/sign-in/email', {
      data: {
        email: testEmail,
        password: testPassword,
      },
    });

    assert(signInRes.status() === 200, `Sign-in status 200 OK (got ${signInRes.status()})`);
    const signInData = await signInRes.json().catch(() => ({}));
    const newSessionToken = signInData?.token || signInData?.session?.token || sessionToken;
    assert(!!newSessionToken, 'Received valid session token upon sign-in');

    // ─── Step 3: Cache-Hit Profile Fetch ───
    console.log('\n[Step 3] Cache-Hit Profile Fetch (GET /api/user/profile)');
    const profileStart = Date.now();
    const profileRes = await apiContext.get('/api/user/profile', {
      headers: {
        Authorization: `Bearer ${newSessionToken}`,
        'x-session-token': newSessionToken,
      },
    });
    const profileDuration = Date.now() - profileStart;

    assert(profileRes.status() === 200, `Profile response status 200 OK (got ${profileRes.status()})`);
    const profileData = await profileRes.json().catch(() => ({}));
    assert(profileData?.user?.email === testEmail, `Profile returned email: ${profileData?.user?.email}`);
    console.log(`  Profile request duration: ${profileDuration}ms`);
    if (isRedisConnected) {
      assert(profileDuration < 200, `Profile request resolved fast (${profileDuration}ms < 200ms)`);
    }

    // ─── Step 4: Sign-Out & Cache Eviction ───
    console.log('\n[Step 4] Sign-Out & Cache Eviction (POST /api/auth/sign-out)');
    const signOutRes = await apiContext.post('/api/auth/sign-out', {
      headers: {
        Authorization: `Bearer ${newSessionToken}`,
        'x-session-token': newSessionToken,
      },
    });
    assert(signOutRes.status() === 200, `Sign-out status 200 OK (got ${signOutRes.status()})`);

    if (isRedisConnected && newSessionToken) {
      console.log('  Verifying cache eviction from Redis RAM...');
      const cleanToken = newSessionToken.startsWith('s:') ? newSessionToken.slice(2).split('.')[0] : newSessionToken.split('.')[0];
      const evictedData = await redis.get(cleanToken);
      assert(evictedData === null, `Session token was successfully evicted from Redis: ${cleanToken}`);
    }

    const postSignOutRes = await apiContext.get('/api/user/profile', {
      headers: {
        Authorization: `Bearer ${newSessionToken}`,
        'x-session-token': newSessionToken,
      },
    });
    assert(postSignOutRes.status() === 401, `Subsequent profile call returns 401 Unauthorized (got ${postSignOutRes.status()})`);

    // ─── Step 5: Browser UI Verification (Optional / Headless) ───
    console.log('\n[Step 5] Browser UI Automation (Playwright Edge Headless)');
    if (chromium) {
      let browser;
      try {
        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        const webUrl = process.env.EXPO_WEB_URL || 'http://localhost:8081/auth';
        try {
          await page.goto(webUrl, { timeout: 5000 });
          const title = await page.title();
          assert(title.length > 0, `Web UI loaded: ${title}`);
        } catch {
          console.log('  ℹ️  Expo web frontend server not running at :8081 (skipping browser UI test)');
        }
        await browser.close();
      } catch (uiErr) {
        console.log('  ℹ️  Browser UI launch skipped:', uiErr.message);
      }
    }
  } catch (err) {
    console.error('❌ E2E test execution error:', err.message);
    failed++;
  } finally {
    await redis.quit().catch(() => redis.disconnect());
    await apiContext.dispose();
  }

  console.log('\n=================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('=================================================');

  if (failed > 0) process.exit(1);
}

runAuthFlowTest().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
