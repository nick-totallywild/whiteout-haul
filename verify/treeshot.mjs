import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick', 'Nick'); localStorage.setItem('whiteout-email', 'n@gmail.com'); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.screenshot({ path: 'verify/tree-overview.png' });
// close on a treeline cluster (front-left band)
await p.evaluate(() => { const c = window.__world.camera; c.position.set(8, 11, 44); c.lookAt(-34, 7, 22); });
await p.waitForTimeout(400);
await p.screenshot({ path: 'verify/tree-closeup.png' });
await b.close();
console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
