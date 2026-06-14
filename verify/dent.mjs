import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.state.cash=1e7; for(let i=0;i<8;i++)window.__buy('truck'); for(let i=0;i<3;i++)window.__buy('bay'); for(let i=0;i<6;i++)window.__buy('capacity'); window.__econ.add(1); });
await p.waitForTimeout(5000); // trucks rolling, some in the exit corridor

// HOLD the convoy (freeze trucks in place), then drop an avalanche
await p.evaluate(() => { window.__lastBuried=0; window.__lastDentCost=0; });
await p.click('#hold-btn');
await p.evaluate(() => window.__avalanche.forceWarning());
for (let i=0;i<16;i++){ if ((await p.evaluate(()=>__avalanche.state()))==='idle') break; await p.waitForTimeout(1000); }
const r = await p.evaluate(() => ({ buried: window.__lastBuried||0, dentCost: window.__lastDentCost||0 }));
await b.close();
console.log(JSON.stringify({ heldTrucks_buried: r.buried, heldTrucks_dentRepairCost: r.dentCost, errors }, null, 2));
