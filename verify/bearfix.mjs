import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1100 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Nick');
  localStorage.setItem('whiteout-email', 'n@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

// Mid-game defenses: 2 towers, 2 barbed-wire levels.
await p.evaluate(() => {
  window.__econ.state.cash = 1e7;
  window.__buy('tower'); window.__buy('tower');
  window.__buy('fence'); window.__buy('fence');
});
const eco = await p.evaluate(() => ({ towers: __econ.getTowerCount(), fence: __econ.getFenceLevel() }));

let maxBears = 0, minHealth = 1, sawAtFence = false, shotCaught = false;
for (let i = 0; i < 40; i++) {
  await p.waitForTimeout(1000);
  const s = await p.evaluate(() => {
    const st = window.WhiteoutBot.state();
    return { bears: st.bearsActive, health: st.fenceHealth };
  });
  maxBears = Math.max(maxBears, s.bears);
  minHealth = Math.min(minHealth, s.health);
  // grab a frame the first time a bear is actively on screen
  if (s.bears > 0 && !sawAtFence) { sawAtFence = true; await p.screenshot({ path: 'verify/bearfix-raid.png' }); }
}

// Confirm the fence took damage and repair restores it.
const before = await p.evaluate(() => { const s = window.WhiteoutBot.state(); return { fenceHealth: +s.fenceHealth.toFixed(2), repairCost: s.repairCost }; });
const repaired = await p.evaluate(() => window.WhiteoutBot.repairFence());
const after = await p.evaluate(() => { const s = window.WhiteoutBot.state(); return { fenceHealth: +s.fenceHealth.toFixed(2), repairCost: s.repairCost }; });

await p.screenshot({ path: 'verify/bearfix-after.png' });
await b.close();
console.log(JSON.stringify({ eco, maxBears, minHealth: +minHealth.toFixed(2), before, repaired, after, errors }, null, 2));
