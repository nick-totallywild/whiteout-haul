// Playwright verification helper: loads the game, waits for it to render,
// captures console errors, and screenshots the canvas.
// Usage: node verify/shot.mjs [outfile.png] [waitMs]
import { chromium } from 'playwright';

const out = process.argv[2] || 'verify/shot.png';
const waitMs = Number(process.argv[3] || 2500);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(waitMs);

// read the live currency value for economy checks
const currency = await page.locator('#currency-value').textContent().catch(() => null);
const upgradeCount = await page.locator('.upgrade-btn').count().catch(() => 0);

await page.screenshot({ path: out });
await browser.close();

console.log(JSON.stringify({ out, currency, upgradeCount, errors }, null, 2));
