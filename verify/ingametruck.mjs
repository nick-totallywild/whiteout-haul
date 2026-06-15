import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick', 'Nick'); localStorage.setItem('whiteout-email', 'n@gmail.com'); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.state.cash = 1e7; for (let i = 0; i < 4; i++) window.__buy('truck'); for (let i = 0; i < 6; i++) window.__buy('capacity'); window.__econ.add(1); });
await p.waitForTimeout(6000); // trucks drive in, queue and load (fill shows)
// frame the loading bay closer
await p.evaluate(() => { const c = window.__world.camera; c.position.set(20, 14, 24); c.lookAt(-2, 1, -7); });
await p.waitForTimeout(500);
await p.screenshot({ path: 'verify/ingametruck.png' });
await b.close();
console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
