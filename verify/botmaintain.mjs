import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Nick');
  localStorage.setItem('whiteout-email', 'n@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

// seed a starting bank, then turn the default maintenance bot ON via the panel
await p.evaluate(() => { window.__econ.state.cash = 1500; window.__econ.add(1); });
await p.click('.bot-toggle');
await p.click('.bot-run');
const botStatus = await p.$eval('.bot-status', el => el.textContent);

// run hands-off; sample cash + defenses + any breaches over time
let minCash = Infinity, repairs = 0, sawBreach = false, prevBroken = false;
const series = [];
for (let i = 0; i < 45; i++) {
  await p.waitForTimeout(1000);
  const s = await p.evaluate(() => {
    const st = window.WhiteoutBot.state();
    return { cash: st.cash, net: st.netPerSec, broken: st.fenceBroken, towers: st.towers, fence: st.fenceLevel, bays: st.bays, trucks: st.trucks };
  });
  minCash = Math.min(minCash, s.cash);
  if (s.broken) sawBreach = true;
  if (prevBroken && !s.broken) repairs++; // bot cleared a breach
  prevBroken = s.broken;
  if (i % 9 === 0) series.push(s);
}
const final = await p.evaluate(() => window.WhiteoutBot.state());

await b.close();
console.log(JSON.stringify({
  botStatus,
  minCash,
  survived: minCash > 0,
  sawBreach,
  repairs,
  final: { cash: final.cash, towers: final.towers, fence: final.fenceLevel, bays: final.bays, trucks: final.trucks, net: final.netPerSec },
  series,
  errors,
}, null, 2));
