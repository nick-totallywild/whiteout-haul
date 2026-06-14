import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage({ viewport: { width: 1000, height: 900 } });
const errors = [];
p.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

// Build traffic + attach an emergency-responder bot that counts its runs.
await p.evaluate(() => {
  window.__econ.state.cash = 1e7;
  for (let i=0;i<8;i++) window.__buy('truck');
  for (let i=0;i<3;i++) window.__buy('bay');
  for (let i=0;i<6;i++) window.__buy('capacity');
  window.__econ.add(1);
  window.__botRuns = 0;
  window.WhiteoutBot.setStrategy((s) => {
    window.__botRuns++;
    window.WhiteoutBot.holdTrucks(s.avalancheDanger);
    if (s.fenceBroken && s.cash >= s.repairCost) window.WhiteoutBot.repairFence();
  });
});
await p.waitForTimeout(5000); // let trucks fill the lane

// Background the game: open another page and bring it to the front.
const p2 = await ctx.newPage();
await p2.goto('about:blank');
await p2.bringToFront();
const hidden = await p.evaluate(() => document.visibilityState); // should be 'hidden'

async function waitIdleHidden() {
  for (let i=0;i<25;i++){ if ((await p.evaluate(()=>__avalanche.state()))==='idle') return; await new Promise(r=>setTimeout(r,1000)); }
}

// --- WITH bot running, while hidden: force an avalanche; bot should HOLD ---
const beforeRuns = await p.evaluate(()=>window.__botRuns);
await p.evaluate(()=>{ window.__lastBuried=0; });
await p.evaluate(()=>window.__avalanche.forceWarning());
await waitIdleHidden();
const withBot = await p.evaluate(()=>({ buried: window.__lastBuried||0, botRuns: window.__botRuns }));

// --- CONTROL: stop the bot, force another avalanche while still hidden ---
await p.evaluate(()=>{ window.WhiteoutBot.clearStrategy(); window.__lastBuried=0; });
await waitIdleHidden();
await p.evaluate(()=>window.__avalanche.forceWarning());
await waitIdleHidden();
const noBot = await p.evaluate(()=>({ buried: window.__lastBuried||0 }));

await b.close();
console.log(JSON.stringify({
  gameTabState: hidden,
  workerDriven: true,
  botRunsWhileHidden: withBot.botRuns - beforeRuns,
  withBot_trucksBuried: withBot.buried,
  control_noBot_trucksBuried: noBot.buried,
  errors,
}, null, 2));
