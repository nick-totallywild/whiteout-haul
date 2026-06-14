import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const r = await p.evaluate(() => ({
  goldName: document.querySelectorAll('.px-load .px-name')[0].textContent,
  gold: document.querySelector('[data-load="gold"]').textContent,
  silverName: document.querySelectorAll('.px-load .px-name')[1].textContent,
  silver: document.querySelector('[data-load="silver"]').textContent,
  truck: document.querySelector('[data-load="truck"]').textContent,
}));
await p.screenshot({ path:'verify/load1520.png', clip:{x:6,y:6,width:250,height:210} });
await b.close();
console.log(JSON.stringify({ r, errors }, null, 2));
