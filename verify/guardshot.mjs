import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick', 'Nick'); localStorage.setItem('whiteout-email', 'n@gmail.com'); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500); // let the guard's beckon animation run
// frame the entrance guard at (44, -1.5)
await p.evaluate(() => { const c = window.__world.camera; c.position.set(50, 5.5, 8); c.lookAt(43, 1.6, -1.5); });
await p.waitForTimeout(400);
await p.screenshot({ path: 'verify/guardshot.png' });
await b.close();
console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
