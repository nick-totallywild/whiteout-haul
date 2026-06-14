// Builds up a few trucks, then captures the full frame plus zoomed-in clips so
// fine details (truck fronts, tunnel mouths, conveyor portal) are legible.
import { chromium } from 'playwright';

const seconds = Number(process.argv[2] || 16);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
for (let i = 0; i < seconds; i++) {
  await page.waitForTimeout(1000);
  const btns = page.locator('.upgrade-btn');
  const n = await btns.count();
  for (let b = 0; b < n; b++) {
    const cls = (await btns.nth(b).getAttribute('class')) || '';
    if (!cls.includes('disabled')) { await btns.nth(b).click(); break; }
  }
}

await page.screenshot({ path: 'verify/clip-full.png' });
await page.screenshot({ path: 'verify/clip-center.png', clip: { x: 140, y: 160, width: 700, height: 460 } });
await page.screenshot({ path: 'verify/clip-left.png', clip: { x: 0, y: 250, width: 460, height: 380 } });
await page.screenshot({ path: 'verify/clip-right.png', clip: { x: 560, y: 260, width: 440, height: 380 } });
await browser.close();
console.log(JSON.stringify({ errors }, null, 2));
