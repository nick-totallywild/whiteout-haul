import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick', 'Nick'); localStorage.setItem('whiteout-email', 'n@gmail.com'); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.add(1); });

// Bears spawn at the treeline and must navigate through the trees to the fence.
// If they reach it, the fence takes damage (fenceFrac < 1) — proof they're not
// stuck behind trees. Sample over time.
let minFrac = 1, sawBears = 0;
for (let i = 0; i < 30; i++) {
  await p.waitForTimeout(1000);
  const s = await p.evaluate(() => ({ frac: window.__bears.fenceFrac(), n: window.__bears.bearsActive() }));
  sawBears = Math.max(sawBears, s.n);
  minFrac = Math.min(minFrac, s.frac);
  if (minFrac < 0.999) break; // a bear reached the fence and started clawing
}
await b.close();
console.log(JSON.stringify({ reachedFence: minFrac < 0.999, minFenceFrac: +minFrac.toFixed(3), maxBears: sawBears, errors }, null, 2));
