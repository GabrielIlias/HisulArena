/* ==========================================================
   scripts/screenshot-pass2.js — Pass 2 Screenshot Verification
   Takes viewport-only shots of all 5 pages at 1280x800 desktop
   and 390x844 mobile. Waits longer for animated content.
   Usage: node scripts/screenshot-pass2.js
   ========================================================== */

const puppeteer = require('puppeteer');
const path      = require('path');
const fs        = require('fs');

const BASE_URL  = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS_DIR = path.join(__dirname, '..', 'temporary_screenshots');

if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

const PAGES = [
  { name: 'pass2-index',   url: '/',                    waitFor: 1500 },
  { name: 'pass2-memory',  url: '/games/memory.html',   waitFor: 2400 }, // 30 cards × 0.04s = 1.2s + 0.4s anim + buffer
  { name: 'pass2-betting', url: '/games/betting.html',  waitFor: 1200 },
  { name: 'pass2-war',     url: '/games/war.html',      waitFor: 1200 },
  { name: 'pass2-whack',   url: '/games/whack.html',    waitFor: 1200 },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile',  width: 390,  height: 844 },
];

async function run() {
  console.log('\n🎯 HisulArena Pass-2 Screenshot Loop\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // Disable service worker to avoid caching issues
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes('service-worker')) req.abort();
    else req.continue();
  });

  let total = 0;

  for (const vp of VIEWPORTS) {
    console.log(`  📐 ${vp.name} (${vp.width}×${vp.height})`);
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2 });

    for (const pg of PAGES) {
      try {
        await page.goto(`${BASE_URL}${pg.url}`, { waitUntil: 'networkidle0', timeout: 15000 });
        await page.waitForTimeout(pg.waitFor);

        const filepath = path.join(SHOTS_DIR, `${pg.name}-${vp.name}.png`);
        await page.screenshot({ path: filepath, fullPage: false }); // viewport-only
        console.log(`     ✓ ${pg.name}-${vp.name}.png`);
        total++;
      } catch (err) {
        console.error(`     ✗ ${pg.name} (${vp.name}): ${err.message}`);
      }
    }
    console.log('');
  }

  await browser.close();
  console.log(`  ✅ Done! ${total} screenshots → ${SHOTS_DIR}\n`);
}

run().catch(err => {
  console.error('\n❌ Failed:', err.message);
  process.exit(1);
});
