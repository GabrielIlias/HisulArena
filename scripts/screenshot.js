/* ==========================================================
   scripts/screenshot.js — Puppeteer Screenshot Loop
   Usage: node scripts/screenshot.js
   Requires: server running at http://localhost:3000
             npm install puppeteer
   ========================================================== */

const puppeteer = require('puppeteer');
const path      = require('path');
const fs        = require('fs');

const BASE_URL     = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS_DIR    = path.join(__dirname, '..', 'temporary_screenshots');

/* Ensure output directory exists */
if (!fs.existsSync(SHOTS_DIR)) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
}

const PAGES = [
  { name: 'home',    url: '/',              waitFor: 1200 },
  { name: 'memory',  url: '/games/memory.html',  waitFor: 800 },
  { name: 'war',     url: '/games/war.html',     waitFor: 800 },
  { name: 'betting', url: '/games/betting.html', waitFor: 800 },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'mobile',  width: 390,  height: 844 },
];

async function run() {
  console.log('\n🎯 HisulArena Screenshot Loop\n');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Output:   ${SHOTS_DIR}\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // Disable service worker to avoid caching issues during screenshots
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes('service-worker')) {
      req.abort();
    } else {
      req.continue();
    }
  });

  let total = 0;

  for (const viewport of VIEWPORTS) {
    console.log(`  📐 Viewport: ${viewport.name} (${viewport.width}×${viewport.height})`);
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 2 });

    for (const pg of PAGES) {
      const url = `${BASE_URL}${pg.url}`;

      try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
        await page.waitForTimeout(pg.waitFor);

        const filename = `${pg.name}-${viewport.name}.png`;
        const filepath = path.join(SHOTS_DIR, filename);

        await page.screenshot({ path: filepath, fullPage: true });
        console.log(`     ✓ ${filename}`);
        total++;

        // Also capture viewport-only for home on desktop
        if (pg.name === 'home' && viewport.name === 'desktop') {
          const vpFile = path.join(SHOTS_DIR, 'home-desktop-viewport.png');
          await page.screenshot({ path: vpFile, fullPage: false });
          console.log(`     ✓ home-desktop-viewport.png`);
          total++;
        }

      } catch (err) {
        console.error(`     ✗ ${pg.name} (${viewport.name}): ${err.message}`);
      }
    }
    console.log('');
  }

  await browser.close();

  console.log(`  ✅ Done! ${total} screenshots saved to:`);
  console.log(`     ${SHOTS_DIR}\n`);
}

run().catch(err => {
  console.error('\n❌ Screenshot loop failed:', err.message);
  console.error('   Make sure the server is running: node server.js\n');
  process.exit(1);
});
