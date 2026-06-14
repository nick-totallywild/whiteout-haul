import { chromium } from 'playwright';
const b = await chromium.launch();
const VW = 1200, VH = 1100;
const p = await b.newPage({ viewport: { width: VW, height: VH } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Nick');
  localStorage.setItem('whiteout-email', 'n@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
// no towers; give cash so we can repair later
await p.evaluate(() => { window.__econ.state.cash = 1e7; window.__buy('truck'); window.__buy('truck'); window.__buy('capacity'); });

let sawBlock = false, sawBreach = false, blockX = null;
let scoreAtBreach = null, scoreDuringBreach = null;
for (let i = 0; i < 70; i++) {
  await p.waitForTimeout(1000);
  const s = await p.evaluate(() => {
    const st = window.WhiteoutBot.state();
    return { breached: st.fenceBroken, lane: window.__bears.laneBlockX(), score: st.score, bears: st.bearsActive };
  });
  if (s.breached) {
    sawBreach = true;
    if (scoreAtBreach === null) scoreAtBreach = s.score;
    scoreDuringBreach = s.score;
  }
  if (s.lane !== null) { sawBlock = true; blockX = s.lane; }
  // once bears are inside and on the lane, capture the scene
  if (sawBreach && sawBlock) { await p.screenshot({ path: 'verify/invasion-raid.png' }); break; }
}

// hold a few more seconds to confirm trucks are stalled (score not rising much)
const sBefore = await p.evaluate(() => window.WhiteoutBot.state().score);
await p.waitForTimeout(5000);
const sAfter = await p.evaluate(() => window.WhiteoutBot.state().score);
const earnedWhileBreached = sAfter - sBefore;
await p.screenshot({ path: 'verify/invasion-stalled.png' });

// repair: should drive off invaders and clear the lane
const repaired = await p.evaluate(() => window.WhiteoutBot.repairFence());
await p.waitForTimeout(500);
const post = await p.evaluate(() => {
  const st = window.WhiteoutBot.state();
  return { breached: st.fenceBroken, lane: window.__bears.laneBlockX(), health: +st.fenceHealth.toFixed(2) };
});
await p.screenshot({ path: 'verify/invasion-repaired.png' });

await b.close();
console.log(JSON.stringify({ sawBreach, sawBlock, blockX: blockX && +blockX.toFixed(1), earnedWhileBreached, repaired, post, errors }, null, 2));
