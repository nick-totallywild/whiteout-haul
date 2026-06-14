import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
const base = await p.evaluate(() => ({
  tonnes: document.querySelector('[data-load="t"]').textContent,
  gold: document.querySelector('[data-load="gold"]').textContent,
  silver: document.querySelector('[data-load="silver"]').textContent,
  truck: document.querySelector('[data-load="truck"]').textContent,
  lv: window.prices ? null : undefined,
}));
// raw values via the module getter (exposed through main? not exposed; recompute)
const raw = await p.evaluate(() => {
  const cap = window.__econ.getCapacityLevel();
  return { capacityLevel: cap };
});
// buy capacity a few times -> tonnes + load value should grow
await p.evaluate(() => { window.__econ.state.cash = 1e7; for (let i=0;i<6;i++) window.__buy('capacity'); });
await p.waitForTimeout(1300);
const upgraded = await p.evaluate(() => ({
  tonnes: document.querySelector('[data-load="t"]').textContent,
  gold: document.querySelector('[data-load="gold"]').textContent,
  silver: document.querySelector('[data-load="silver"]').textContent,
}));
await p.screenshot({ path: 'verify/realecon.png', clip: { x: 6, y: 6, width: 250, height: 320 } });
await b.close();
console.log(JSON.stringify({ base, raw, upgraded, errors }, null, 2));
