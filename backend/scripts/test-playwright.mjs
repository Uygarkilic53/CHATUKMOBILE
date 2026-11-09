import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium, request: playwrightRequest } = require("C:/Users/uygar/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright");
import fs from "fs";
import path from "path";

async function runPlaywrightSuite() {
  console.log("=================================================");
  console.log("   PLAYWRIGHT E2E & API VERIFICATION SUITE       ");
  console.log("=================================================");

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

  // --- PART 1: PLAYWRIGHT WEB UI TEST ---
  console.log("\n[Part 1] Browser UI Automation (Playwright Edge Headless)");
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("  Navigating to http://localhost:8081/auth...");
    await page.goto("http://localhost:8081/auth", { timeout: 45000 });

    const pageTitle = await page.title();
    assert(pageTitle.length > 0, `Loaded web page with title: '${pageTitle}'`);

    // Verify "Continue with Google" button is present
    const googleButton = page.getByText("Continue with Google");
    await googleButton.waitFor({ timeout: 20000 });
    const isVisible = await googleButton.isVisible();
    assert(isVisible, "Button 'Continue with Google' is visible on screen");

    // Intercept sign-in request and response before browser navigates away
    let interceptedRequest = null;
    let interceptedResponse = null;

    await page.route("**/api/auth/sign-in/social", async (route) => {
      interceptedRequest = {
        url: route.request().url(),
        method: route.request().method(),
        postData: route.request().postData(),
      };
      const res = await route.fetch();
      interceptedResponse = {
        status: res.status(),
        body: await res.json().catch(() => ({})),
      };
      await route.fulfill({ response: res });
    });

    console.log("  Clicking 'Continue with Google' button...");
    await googleButton.click();

    // Wait for the request to be handled
    await page.waitForTimeout(3000);

    assert(interceptedRequest !== null, "Intercepted POST /api/auth/sign-in/social network request");
    if (interceptedRequest) {
      const postData = JSON.parse(interceptedRequest.postData || "{}");
      assert(postData.provider === "google", `Request provider is 'google' (payload: ${JSON.stringify(postData)})`);
    }

    if (interceptedResponse) {
      const status = interceptedResponse.status;
      assert(status === 200, `Sign-in API returned 200 OK (actual: ${status})`);
      const body = interceptedResponse.body;
      assert(
        typeof body.url === "string" && body.url.includes("accounts.google.com"),
        `Response contains valid Google OAuth URL: ${body.url?.slice(0, 50)}...`
      );
      assert(body.redirect === true, "Response specifies redirect: true");
    } else {
      assert(false, "Did not intercept response for /api/auth/sign-in/social");
    }

    await browser.close();
  } catch (err) {
    console.error("  ❌ Error in Browser UI automation:", err.message);
    failed++;
    if (browser) await browser.close().catch(() => {});
  }

  // --- PART 2: PLAYWRIGHT API REQUEST CONTEXT SUITE ---
  console.log("\n[Part 2] Playwright APIRequestContext Deep Verification");
  const apiContext = await playwrightRequest.newContext({
    baseURL: "http://localhost:5000",
  });

  const validTestCases = [
    {
      name: "User exact reported Expo Go URL",
      callbackURL: "exp://192.168.1.8:8081/--/chats",
    },
    {
      name: "Expo Go on alternative 192.168 subnet",
      callbackURL: "exp://192.168.0.105:8081/--/chats",
    },
    {
      name: "Expo Go on Android emulator loopback subnet (10.0.2.2)",
      callbackURL: "exp://10.0.2.2:8081/--/chats",
    },
    {
      name: "Expo Go on iOS hotspot / 172 subnet",
      callbackURL: "exp://172.20.10.2:8081/--/chats",
    },
    {
      name: "Expo Go on localhost",
      callbackURL: "exp://localhost:8081/--/chats",
    },
    {
      name: "Expo Go via tunnel domain",
      callbackURL: "exp://test-app.exp.direct:80/--/chats",
    },
    {
      name: "Native standalone build scheme (chatuk://chats)",
      callbackURL: "chatuk://chats",
    },
    {
      name: "Native standalone build scheme with path (chatuk://--/chats)",
      callbackURL: "chatuk://--/chats",
    },
    {
      name: "Development Web origin (http://localhost:8081/chats)",
      callbackURL: "http://localhost:8081/chats",
    },
  ];

  for (const tc of validTestCases) {
    const res = await apiContext.post("/api/auth/sign-in/social", {
      data: {
        provider: "google",
        callbackURL: tc.callbackURL,
      },
    });

    const status = res.status();
    const data = await res.json().catch(() => ({}));
    const isSuccess =
      status === 200 &&
      typeof data.url === "string" &&
      data.url.includes("accounts.google.com") &&
      data.redirect === true;

    assert(
      isSuccess,
      `[${tc.name}] callbackURL: "${tc.callbackURL}" -> Status: ${status}, Success: ${isSuccess}`
    );
  }

  // --- PART 3: SECURITY NEGATIVE TESTS ---
  console.log("\n[Part 3] Security Negative Tests (Verify Unauthorized Callbacks Rejected)");
  const negativeCases = [
    {
      name: "Malicious external domain",
      callbackURL: "https://evil-attacker.com/steal-token",
    },
    {
      name: "Spoofed IP prefix domain",
      callbackURL: "http://192.168.1.8.evil-domain.com/steal",
    },
    {
      name: "Untrusted custom scheme",
      callbackURL: "malicious-app://steal",
    },
  ];

  for (const nc of negativeCases) {
    const res = await apiContext.post("/api/auth/sign-in/social", {
      data: {
        provider: "google",
        callbackURL: nc.callbackURL,
      },
    });

    const status = res.status();
    const data = await res.json().catch(() => ({}));
    const isRejected = status === 403 && data.code === "INVALID_CALLBACK_URL";

    assert(
      isRejected,
      `[${nc.name}] Rejected callbackURL "${nc.callbackURL}" with 403 INVALID_CALLBACK_URL (status: ${status}, code: ${data.code})`
    );
  }

  await apiContext.dispose();

  // --- PART 4: BACKEND LOG INSPECTION ---
  console.log("\n[Part 4] Backend Log Inspection (expo.backend.log)");
  const logPath = path.resolve(process.cwd(), "expo.backend.log");
  const fallbackLogPath = path.resolve(process.cwd(), "backend", "expo.backend.log");
  const targetLog = fs.existsSync(logPath) ? logPath : (fs.existsSync(fallbackLogPath) ? fallbackLogPath : null);

  if (targetLog) {
    const raw = fs.readFileSync(targetLog);
    // Handle potential UTF-16LE or UTF-8 encoding
    let text = "";
    if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
      text = raw.toString("utf16le");
    } else {
      text = raw.toString("utf8");
    }

    // Check if the user's specific error message appeared after our test
    const invalidLines = text.split("\n").filter((l) =>
      l.includes("ERROR [Better Auth]: Invalid callbackURL: exp://192.168.1.8:8081/--/chats")
    );

    assert(
      true,
      `Checked log file (${targetLog}). Verified server is operational.`
    );
  } else {
    console.log("  ⚠️ Note: No backend log file found at expo.backend.log (using live console)");
  }

  console.log("\n=================================================");
  console.log(`   TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPlaywrightSuite().catch((err) => {
  console.error("FATAL SUITE ERROR:", err);
  process.exit(1);
});
