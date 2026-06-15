import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/preview-characters.html';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ready === true, { timeout: 10000 }).catch(() => {});
await p.waitForTimeout(800);
await p.screenshot({ path: 'verify/charshot.png' });
await b.close();
console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
