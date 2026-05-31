import { chromium } from "playwright";

async function testLogin() {
  console.log("🚀 Starting authentication test...\n");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Enable detailed logging
  page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
  page.on("response", (response) => {
    if (response.url().includes("/api/auth")) {
      console.log(`\n📡 ${response.request().method()} ${response.url()}`);
      console.log(`   Status: ${response.status()}`);
    }
  });

  try {
    // Navigate to login page
    console.log("1️⃣  Navigating to login page...");
    await page.goto("http://localhost:5173/login");
    await page.waitForLoadState("networkidle");

    // Check for test user in seed
    console.log("\n2️⃣  Filling login form...");
    await page.fill('input[type="email"]', "test@t.com");
    await page.fill('input[type="password"]', "123456");

    // Intercept the login request
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/auth/sign-in/email"),
    );

    console.log("\n3️⃣  Submitting form...");
    await page.click('button[type="submit"]');

    // Wait for response
    const response = await responsePromise;
    console.log(`\n📥 Login Response Status: ${response.status()}`);

    // Get ALL response headers (before consuming body)
    const allHeaders = await response.allHeaders();
    console.log("\n📋 ALL Response Headers:");
    Object.keys(allHeaders).forEach((key) => {
      console.log(`   ${key}: ${allHeaders[key]}`);
    });

    // Get all headers including duplicates (for multiple set-cookie)
    const setCookies = await response.headersArray();
    const cookieHeaders = setCookies.filter(
      (h) => h.name.toLowerCase() === "set-cookie",
    );
    if (cookieHeaders.length === 0) {
      console.log("   ❌ NO SET-COOKIE HEADERS FOUND!");
    } else {
      cookieHeaders.forEach((h) => {
        console.log(`   ✅ ${h.value}`);
      });
    }

    // Get response body
    try {
      const responseBody = await response.json();
      console.log(`\n📄 Response Body:`, JSON.stringify(responseBody, null, 2));
    } catch (e) {
      console.log(`\n📄 Response Body: (could not parse)`);
    }

    // Check cookies in context
    const cookies = await context.cookies();
    console.log("\n🍪 Cookies in browser:");
    cookies.forEach((cookie) => {
      console.log(
        `   ${cookie.name} = ${cookie.value.substring(0, 20)}... (domain: ${cookie.domain}, path: ${cookie.path})`,
      );
    });

    // Wait a bit for redirect
    await page.waitForTimeout(2000);

    console.log(`\n📍 Current URL: ${page.url()}`);

    // Try to call /me endpoint
    console.log("\n4️⃣  Checking /api/auth/me...");

    // Intercept the /me request to see what's being sent
    const meRequestPromise = page.waitForRequest((request) =>
      request.url().includes("/api/auth/me"),
    );

    const meResponse = await page.evaluate(async () => {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });
      const data = await response.json();
      return {
        status: response.status,
        data,
        headers: Object.fromEntries(response.headers.entries()),
      };
    });

    const meRequest = await meRequestPromise;
    console.log("\n🔍 /me Request Headers:");
    const meReqHeaders = meRequest.headers();
    console.log("   cookie:", meReqHeaders["cookie"] || "❌ NO COOKIE HEADER");

    console.log(`\n📥 /me Response Status: ${meResponse.status}`);
    console.log(
      "📄 /me Response Data:",
      JSON.stringify(meResponse.data, null, 2),
    );

    if (meResponse.data.user) {
      console.log(
        "\n✅ SUCCESS! User authenticated:",
        meResponse.data.user.email,
      );
    } else {
      console.log("\n❌ FAILED! User is null after login");

      // Check request headers
      console.log("\n🔍 Checking what cookies are being sent to /me:");
      const requestCookies = await page.evaluate(() => document.cookie);
      console.log("   document.cookie:", requestCookies || "(empty)");
    }

    // Keep browser open for inspection
    console.log(
      "\n⏸️  Browser will stay open for 30 seconds for inspection...",
    );
    await page.waitForTimeout(30000);
  } catch (error) {
    console.error("\n❌ Error during test:", error);
  } finally {
    await browser.close();
  }
}

testLogin().catch(console.error);
