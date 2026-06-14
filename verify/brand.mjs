import { chromium } from 'playwright';
const b = await chromium.launch();
// 1) fresh load -> registration modal with tagline
const p1 = await b.newPage({ viewport: { width: 1000, height: 900 } });
const errors = [];
p1.on('pageerror', e => errors.push(e.message));
p1.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p1.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p1.waitForTimeout(800);
const modal = await p1.evaluate(() => {
  const c = document.querySelector('.lb-card');
  return c ? { h2: c.querySelector('h2').textContent, tag: c.querySelector('.lb-tag')?.textContent } : null;
});
await p1.screenshot({ path:'verify/brand-modal.png', clip:{x:330,y:250,width:340,height:380} });
await p1.close();
// 2) registered -> wordmark bottom-right
const p2 = await b.newPage({ viewport: { width: 1000, height: 900 } });
await p2.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p2.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(500);
const wm = await p2.evaluate(() => { const w=document.getElementById('wordmark'); return w?{text:w.textContent.trim(), visible: getComputedStyle(w).opacity}:null; });
await p2.screenshot({ path:'verify/brand-wordmark.png', clip:{x:740,y:840,width:260,height:60} });
await p2.close();
await b.close();
console.log(JSON.stringify({ modal, wm, errors }, null, 2));
