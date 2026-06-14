import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1000, height: 1100 } });
const errors = [];
// 1) normal player — no admin flag
const p1 = await ctx.newPage();
p1.on('pageerror', e => errors.push('p1:'+e.message));
await p1.addInitScript(() => { localStorage.setItem('whiteout-nick','Tester'); localStorage.setItem('whiteout-email','t@gmail.com'); });
await p1.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p1.waitForTimeout(500);
const normalHasBtn = await p1.locator('#reset-btn').count();
// 2) admin — visit with ?admin=1
const p2 = await ctx.newPage();
p2.on('pageerror', e => errors.push('p2:'+e.message));
await p2.addInitScript(() => { localStorage.setItem('whiteout-nick','Admin'); localStorage.setItem('whiteout-email','a@gmail.com'); });
await p2.goto('http://localhost:5173/?admin=1', { waitUntil: 'networkidle' });
await p2.waitForTimeout(500);
const adminHasBtn = await p2.locator('#reset-btn').count();
// 3) same admin browser, revisit WITHOUT the param (flag persisted)
await p2.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(500);
const adminPersists = await p2.locator('#reset-btn').count();
await b.close();
console.log(JSON.stringify({ normalHasBtn, adminHasBtn, adminPersists, errors }, null, 2));
