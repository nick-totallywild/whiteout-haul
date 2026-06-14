import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
const errors = [];
p.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.evaluate(() => {
  window.__econ.state.cash = 1e7;
  for (let i=0;i<4;i++) window.__buy('truck');
  window.__econ.add(1);
  window.__botRuns = 0;
  window.WhiteoutBot.setStrategy((s) => { window.__botRuns++; window.WhiteoutBot.holdTrucks(s.avalancheDanger); if (s.fenceBroken && s.cash>=s.repairCost) window.WhiteoutBot.repairFence(); });
});

// Simulate a hidden tab: requestAnimationFrame stops firing (browser pauses it).
// The render loop will stop rescheduling — only the Web Worker can keep the sim alive.
await p.evaluate(() => { window.requestAnimationFrame = () => 0; });
await new Promise(r => setTimeout(r, 800)); // let any in-flight rAF drain

const before = await p.evaluate(() => ({ ticks: window.__simTicks||0, botRuns: window.__botRuns||0, cash: Math.floor(window.__econ.state.cash) }));
await new Promise(r => setTimeout(r, 5000)); // 5s with rAF dead
const after = await p.evaluate(() => ({ ticks: window.__simTicks||0, botRuns: window.__botRuns||0, cash: Math.floor(window.__econ.state.cash) }));

// also: force an avalanche with rAF dead and confirm the bot reacts (holds -> no loss)
await p.evaluate(() => { window.__lastBuried = 0; window.__avalanche.forceWarning(); });
for (let i=0;i<16;i++){ if ((await p.evaluate(()=>__avalanche.state()))==='idle') break; await new Promise(r=>setTimeout(r,1000)); }
const buriedWithBot = await p.evaluate(() => window.__lastBuried||0);

await b.close();
console.log(JSON.stringify({
  rafDead: true,
  ticksDuring5s: after.ticks - before.ticks,
  botRunsDuring5s: after.botRuns - before.botRuns,
  upkeepDrainedCash: before.cash - after.cash,
  avalancheWhileRafDead_trucksBuried: buriedWithBot,
  errors,
}, null, 2));
