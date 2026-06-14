import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.state.cash = 1e7; for(let i=0;i<8;i++)window.__buy('truck'); for(let i=0;i<3;i++)window.__buy('bay'); window.__econ.add(1); });
await p.waitForTimeout(5000);
await p.evaluate(() => window.__avalanche.forceWarning());
// poll until impact, then a touch into it so the snow is on the lane
for (let i=0;i<40;i++){ const s = await p.evaluate(()=>__avalanche.state()); if (s==='impact') break; await p.waitForTimeout(500); }
await p.waitForTimeout(1500);
await p.screenshot({ path: 'verify/avalanche-impact.png' });
// zoom the exit corridor
await p.screenshot({ path: 'verify/avalanche-impact-zoom.png', clip: { x: 120, y: 360, width: 620, height: 360 } });
const st = await p.evaluate(()=>__avalanche.state());
await b.close();
console.log('state at shot:', st);
