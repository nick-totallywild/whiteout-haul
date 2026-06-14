// Drives the game: loads, then repeatedly buys affordable upgrades (favouring
// trucks, then capacity, then speed) to build up a visible queue, capturing a
// screenshot at the end. Reports currency progression + console errors.
import { chromium } from 'playwright';

const out = process.argv[2] || 'verify/play.png';
const seconds = Number(process.argv[3] || 25);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

const samples = [];
for (let i = 0; i < seconds; i++) {
  await page.waitForTimeout(1000);
  const cur = await page.locator('#currency-value').textContent().catch(() => '?');
  samples.push(cur);
  // try to buy: click any enabled upgrade button (truck first)
  const btns = page.locator('.upgrade-btn');
  const n = await btns.count();
  for (let b = 0; b < n; b++) {
    const btn = btns.nth(b);
    const cls = (await btn.getAttribute('class')) || '';
    if (!cls.includes('disabled')) {
      await btn.click();
      break;
    }
  }
}

await page.screenshot({ path: out });
await browser.close();
console.log(JSON.stringify({ out, samples, errors }, null, 2));
