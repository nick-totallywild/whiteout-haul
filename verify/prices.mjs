import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500); // allow price fetch
const widget = await p.evaluate(() => {
  const g = document.querySelector('[data-m="gold"]'); const s = document.querySelector('[data-m="silver"]');
  const txt = el => el ? Array.from(el.children).map(c=>c.textContent).join(' ') : null;
  return { gold: txt(g), silver: txt(s), offline: document.getElementById('prices-panel').classList.contains('px-offline') };
});
await p.screenshot({ path: 'verify/prices-full.png' });
await p.screenshot({ path: 'verify/prices-zoom.png', clip: { x: 6, y: 6, width: 250, height: 230 } });
await b.close();
console.log(JSON.stringify({ widget, errors }, null, 2));
