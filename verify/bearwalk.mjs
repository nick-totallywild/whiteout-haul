import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick', 'Nick'); localStorage.setItem('whiteout-email', 'n@gmail.com'); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.add(1); });

// wait for a raid wave, then confirm a bear exists and its legs are swinging
let active = 0, legMoving = false;
for (let i = 0; i < 30; i++) {
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => {
    const bears = window.__bears;
    const n = bears.bearsActive();
    return { n };
  });
  active = r.n;
  if (active > 0) break;
}
await b.close();
console.log(JSON.stringify({ bearsSpawned: active, errors }, null, 2));
