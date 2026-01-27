import { chromium } from 'playwright';

async function testLoginDirect() {
  console.log('🚀 Testing authentication DIRECTLY on port 3000...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('1️⃣  Making login request directly to API...');
    const response = await page.request.post('http://localhost:3000/api/auth/sign-in/email', {
      data: {
        email: 'test@t.com',
        password: '123456',
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`\n📥 Login Response Status: ${response.status()}`);

    const setCookies = response.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie');
    console.log('\n🍪 Set-Cookie headers:');
    setCookies.forEach(h => console.log(`   ${h.value}`));

    // Now check /me with the same context
    console.log('\n2️⃣  Checking /me endpoint...');
    const meResponse = await page.request.get('http://localhost:3000/api/auth/me');

    console.log(`\n📥 /me Response Status: ${meResponse.status()}`);
    const meData = await meResponse.json();
    console.log('📄 /me Response:', JSON.stringify(meData, null, 2));

    if (meData.user) {
      console.log('\n✅ SUCCESS! Direct API auth works!');
    } else {
      console.log('\n❌ FAILED! Even direct API returns null');
    }

    await page.waitForTimeout(5000);

  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    await browser.close();
  }
}

testLoginDirect().catch(console.error);
