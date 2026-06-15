import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick', 'Nick'); localStorage.setItem('whiteout-email', 'n@gmail.com'); });
await p.goto(URL, { waitUntil: 'networkidle' });
// buy a gun tower so a gunner appears, then frame the first tower spot (-30, 11)
await p.evaluate(() => { window.__econ.state.cash = 1e7; window.__buy('tower'); });
await p.waitForTimeout(800);
await p.evaluate(() => {
  const c = window.__world.camera;
  c.position.set(-22, 7.5, 20);
  c.lookAt(-30, 5.2, 11);
});
await p.waitForTimeout(500);
await p.screenshot({ path: 'verify/towershot.png' });
await b.close();
console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
