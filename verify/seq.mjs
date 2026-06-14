import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
for (const t of [1, 3, 5]) {
  await p.waitForTimeout(t === 1 ? 1000 : 2000);
  await p.screenshot({ path: `verify/seq-${t}.png`, clip: { x: 300, y: 360, width: 560, height: 260 } });
}
await b.close(); console.log('done');
