import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick', 'Nick'); localStorage.setItem('whiteout-email', 'n@gmail.com'); });
await p.goto(URL, { waitUntil: 'networkidle' });
// buy all three gun towers and start the economy so raids come
await p.evaluate(() => { window.__econ.state.cash = 1e7; for (let i = 0; i < 3; i++) window.__buy('tower'); window.__econ.add(1); });

// wait for a raid and let bears walk into tower range (towers fire on approach)
let active = 0;
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(1000);
  active = await p.evaluate(() => window.__bears.bearsActive());
  if (active > 0 && i > 10) break; // give them time to reach the fence/range
}
// frame the right-front tower (36,11) and its line of fire toward the dock
await p.evaluate(() => { const c = window.__world.camera; c.position.set(58, 14, 30); c.lookAt(24, 4, 2); });
// burst of frames to catch a tracer/flash mid-flight
for (let k = 0; k < 8; k++) {
  await p.screenshot({ path: `verify/towerfire-${k}.png` });
  await p.waitForTimeout(110);
}
await b.close();
console.log(JSON.stringify({ bearsActive: active, errors }, null, 2));
