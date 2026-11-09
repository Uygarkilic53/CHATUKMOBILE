import { createRequire } from 'module';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

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

async function runResetPasswordPlaywrightTest() {
  console.log('===============================================================');
  console.log('   PLAYWRIGHT E2E FORGOT & RESET PASSWORD VERIFICATION SUITE   ');
  console.log('===============================================================');

  const testEmail = 'deneme@gmail.com';
  const initialPassword = 'InitialPass123!';
  const updatedPassword = 'NewSecretPass123!';
  const port = process.env.TEST_PORT || 5005;
  const baseUrl = `http://localhost:${port}`;

  process.env.PORT = String(port);
  process.env.BETTER_AUTH_URL = baseUrl;

  // 1. Connect to Database and start Express app
  console.log('\n[Phase 1] Starting backend test instance on port ' + port + '...');
  const { default: mongoose } = await import('mongoose');
  const { initAuth } = await import('../dist/auth.js');
  const { default: app } = await import('../dist/app.js');
  const { sendPasswordResetEmail, mailtrapTransporter } = await import('../dist/services/email.service.js');
  const { getRedis } = await import('../dist/config/redis.js');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('  Connected to MongoDB Atlas.');

  initAuth();
  console.log('  Better Auth initialized.');

  const server = await new Promise((resolve) => {
    const s = app.listen(port, () => {
      console.log(`  Backend test server listening on ${baseUrl}`);
      resolve(s);
    });
  });

  const apiContext = await playwrightRequest.newContext({
    baseURL: baseUrl,
  });

  let browser;
  try {
    // 2. Verify Mailtrap SMTP Connection
    console.log('\n[Phase 2] Verifying Mailtrap SMTP Configuration...');
    try {
      await mailtrapTransporter.verify();
      assert(true, 'Mailtrap SMTP transporter verified successfully');
    } catch (smtpErr) {
      assert(false, `Mailtrap SMTP verification failed: ${smtpErr.message}`);
    }

    // 3. Ensure test user (deneme@gmail.com) exists
    console.log(`\n[Phase 3] Ensuring test user '${testEmail}' exists in MongoDB...`);
    const usersCollection = mongoose.connection.db.collection('user');
    let user = await usersCollection.findOne({ email: testEmail });

    if (!user) {
      console.log(`  User '${testEmail}' not found. Registering new user...`);
      const signUpRes = await apiContext.post('/api/auth/sign-up/email', {
        data: {
          email: testEmail,
          password: initialPassword,
          name: 'Deneme User',
        },
      });
      assert(signUpRes.status() === 200, `Sign-up status for '${testEmail}' returned ${signUpRes.status()}`);
      user = await usersCollection.findOne({ email: testEmail });
    }
    assert(!!user, `Test user verified in database (ID: ${user?._id || user?.id})`);

    // 4. Test request-password-reset API
    console.log(`\n[Phase 4] Testing POST /api/auth/request-password-reset with '${testEmail}'...`);
    const resetReqRes = await apiContext.post('/api/auth/request-password-reset', {
      data: {
        email: testEmail,
      },
      headers: {
        Origin: baseUrl,
      },
    });

    assert(resetReqRes.status() === 200, `Request password reset returned HTTP 200 (got ${resetReqRes.status()})`);
    const resetReqData = await resetReqRes.json().catch(() => ({}));
    assert(resetReqData.status === true, `API returned status: true (${resetReqData.message || 'success'})`);

    // Also test alias /api/auth/forget-password
    console.log(`\n[Phase 4b] Testing alias POST /api/auth/forget-password with '${testEmail}'...`);
    const aliasRes = await apiContext.post('/api/auth/forget-password', {
      data: {
        email: testEmail,
      },
      headers: {
        Origin: baseUrl,
      },
    });
    assert(aliasRes.status() === 200, `Alias /api/auth/forget-password returned HTTP 200 (got ${aliasRes.status()})`);

    // 5. Verify reset token was generated in database or Redis session storage
    console.log('\n[Phase 5] Inspecting Redis / MongoDB for generated verification token...');
    let token = null;
    const redis = getRedis();
    if (redis) {
      const keys = await redis.keys('*reset-password*');
      console.log(`  Found ${keys.length} reset-password keys in Redis`);
      if (keys.length > 0) {
        const latestKey = keys[keys.length - 1];
        token = latestKey.split(':').pop();
      }
    }

    if (!token) {
      const verificationsCollection = mongoose.connection.db.collection('verification');
      const verification = await verificationsCollection.findOne(
        { identifier: { $regex: /^reset-password:/ } },
        { sort: { expiresAt: -1 } }
      );
      if (verification?.identifier) {
        token = verification.identifier.replace('reset-password:', '');
      }
    }

    assert(!!token, `Active reset token found: ${token ? token.slice(0, 10) + '...' : 'none'}`);

    // 6. Browser UI Automation with Playwright on /reset-password
    console.log('\n[Phase 6] Browser UI Automation on Reset Password Webpage...');
    browser = await chromium.launch({
      headless: true,
      channel: 'msedge',
    }).catch(async () => {
      return await chromium.launch({ headless: true });
    });

    const page = await browser.newPage();
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    console.log(`  Navigating Playwright browser to: ${resetUrl}`);
    await page.goto(resetUrl, { timeout: 30000 });

    const title = await page.title();
    assert(title.includes('Reset Password'), `Page title is '${title}'`);

    const headerText = await page.locator('.title').first().textContent();
    assert(headerText.includes('Reset Your Password'), `Header text is '${headerText}'`);

    // Fill in new password and confirm
    console.log('  Filling new password into web form...');
    await page.fill('#new-password', updatedPassword);
    await page.fill('#confirm-password', updatedPassword);

    const matchText = await page.locator('#match-status').textContent();
    assert(matchText.includes('Passwords match'), `Password match feedback displayed: '${matchText.trim()}'`);

    // Click submit button
    console.log("  Clicking 'Reset Password' button...");
    await page.click('#submit-btn');

    // Wait for success view
    await page.waitForSelector('#success-view', { state: 'visible', timeout: 15000 });
    const successHeader = await page.locator('#success-view .title').textContent();
    assert(successHeader.includes('Password Changed'), `Success view appeared: '${successHeader.trim()}'`);

    const appBtnVisible = await page.locator('#open-app-btn').isVisible();
    assert(appBtnVisible, "Button 'Open Chatuk App' is visible on success screen");

    // 8. Verify the user can sign in with the new password
    console.log(`\n[Phase 8] Verifying sign-in with updated password '${updatedPassword}'...`);
    const newSignInRes = await apiContext.post('/api/auth/sign-in/email', {
      data: {
        email: testEmail,
        password: updatedPassword,
      },
    });

    assert(newSignInRes.status() === 200, `Sign-in with new password returned HTTP 200 OK (got ${newSignInRes.status()})`);
    const newSignInData = await newSignInRes.json().catch(() => ({}));
    assert(
      newSignInData?.user?.email === testEmail,
      `Successfully signed in as user '${newSignInData?.user?.email}' with new password!`
    );

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (apiContext) {
      await apiContext.dispose().catch(() => {});
    }
    await new Promise((resolve) => server.close(resolve)).catch(() => {});
    await mongoose.disconnect().catch(() => {});
    console.log('\nCleaned up browser, server, and database connection.');
  }

  console.log('\n===============================================================');
  console.log(`   PLAYWRIGHT TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runResetPasswordPlaywrightTest().catch((err) => {
  console.error('\n❌ Unhandled Playwright Test Error:', err);
  process.exit(1);
});
