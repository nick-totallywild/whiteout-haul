import { chromium } from 'playwright';
const b = await chromium.launch();
const VW = 1100, VH = 1100;
const p = await b.newPage({ viewport: { width: VW, height: VH } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Nick');
  localStorage.setItem('whiteout-email', 'n@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

// No towers, level-0 fence: bears reach the wire and claw it down.
await p.evaluate(() => { window.__econ.state.cash = 1e7; });

let minHealth = 1, maxBears = 0, breached = false;
for (let i = 0; i < 35; i++) {
  await p.waitForTimeout(1000);
  const s = await p.evaluate(() => {
    const st = window.WhiteoutBot.state();
    return { h: st.fenceHealth, n: st.bearsActive, br: st.fenceBroken };
  });
  minHealth = Math.min(minHealth, s.h);
  maxBears = Math.max(maxBears, s.n);
  if (s.br) breached = true;
  if (s.h < 0.85 && minHealth >= 0.85 - 0.01) { /* first damage */ }
}

// snapshot mid-raid (damaged fence + bears)
await p.screenshot({ path: 'verify/fencedmg-raid.png' });

const before = await p.evaluate(() => { const s = window.WhiteoutBot.state(); return { fenceHealth: +s.fenceHealth.toFixed(2), repairCost: s.repairCost, broken: s.fenceBroken }; });
const repaired = await p.evaluate(() => window.WhiteoutBot.repairFence());
const after = await p.evaluate(() => { const s = window.WhiteoutBot.state(); return { fenceHealth: +s.fenceHealth.toFixed(2), repairCost: s.repairCost }; });
await p.screenshot({ path: 'verify/fencedmg-repaired.png' });

await b.close();
console.log(JSON.stringify({ minHealth: +minHealth.toFixed(2), maxBears, breached, before, repaired, after, errors }, null, 2));
