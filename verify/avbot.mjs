import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.state.cash = 1e7; for(let i=0;i<8;i++)window.__buy('truck'); for(let i=0;i<3;i++)window.__buy('bay'); for(let i=0;i<6;i++)window.__buy('capacity'); window.__econ.add(1); });
await p.waitForTimeout(5000);

// run the "Avalanche emergency" example via the panel
await p.click('.bot-toggle');
await p.selectOption('.bot-examples', 'Avalanche emergency');
const running = await p.evaluate(() => window.WhiteoutBot.isRunning());

// force an avalanche; bot should hold through warning+impact+SETTLE
await p.evaluate(() => { window.__lastBuried = 0; window.__avalanche.forceWarning(); });
// sample the hold state + avalanche state across the whole event
const samples = [];
for (let i=0;i<16;i++){
  await p.waitForTimeout(1000);
  const s = await p.evaluate(() => ({ st: __avalanche.state(), held: window.WhiteoutBot.state().avalancheDanger }));
  samples.push(s.st + (s.held?'(hold)':'(release)'));
  if (s.st === 'idle' && i>3) break;
}
const buried = await p.evaluate(() => window.__lastBuried||0);
await b.close();
console.log(JSON.stringify({ running, buried, samples, errors }, null, 2));
