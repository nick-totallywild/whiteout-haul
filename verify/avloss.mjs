import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.state.cash = 1e7; for(let i=0;i<8;i++)window.__buy('truck'); for(let i=0;i<3;i++)window.__buy('bay'); for(let i=0;i<6;i++)window.__buy('capacity'); window.__econ.add(1); });
await p.waitForTimeout(6000);
await p.evaluate(() => window.__avalanche.forceWarning());
// wait into the hazard/settle so the snow is on the lane and a truck has been hit
for (let i=0;i<40;i++){ const s = await p.evaluate(()=>__avalanche.state()); if (s==='impact') break; await p.waitForTimeout(400); }
await p.waitForTimeout(1800);
await p.screenshot({ path: 'verify/avloss-full.png' });
await p.screenshot({ path: 'verify/avloss-zoom.png', clip: { x: 120, y: 360, width: 640, height: 360 } });
const lf = await p.evaluate(() => { const e=document.getElementById('loss-flash'); return { disp:e.style.display, text:e.textContent }; });
await b.close();
console.log(JSON.stringify(lf));
