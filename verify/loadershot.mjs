import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick', 'Nick'); localStorage.setItem('whiteout-email', 'n@gmail.com'); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.state.cash = 1e7; for (let i = 0; i < 4; i++) window.__buy('truck'); for (let i = 0; i < 6; i++) window.__buy('capacity'); window.__econ.add(1); });
await p.waitForTimeout(4000);
// close on the front bay to watch a loader raise its bucket over a truck
await p.evaluate(() => { const c = window.__world.camera; c.position.set(10, 5.5, 5); c.lookAt(-3, 2.2, -7.5); });
for (let kf = 0; kf < 10; kf++) {
  await p.screenshot({ path: `verify/loadershot-${kf}.png` });
  await p.waitForTimeout(350);
}
await b.close();
console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
