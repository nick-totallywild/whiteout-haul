import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
// ramp income only (no defenses) ~28s
for (let i=0;i<28;i++){ await p.waitForTimeout(1000);
  await p.evaluate(() => { const e=window.__econ; const inc=['truck','capacity','speed','bay']; let go=true; while(go){go=false; const aff=inc.filter(k=>e.canAfford(k)); if(!aff.length)break; const k=aff.sort((a,b)=>e.costOf(a)-e.costOf(b))[0]; if(window.__buy(k))go=true;else break;} }); }
// accumulate, then buy towers + fence
for (let i=0;i<8;i++){ await p.waitForTimeout(1000); }
const bought = await p.evaluate(() => { let t=0,f=0; while(window.__buy('tower'))t++; while(window.__buy('fence'))f++; return { towersBought:t, fenceBought:f, towers:__econ.getTowerCount(), fence:__econ.getFenceLevel() }; });
// capture a few frames to catch bears/tracers
const samples=[];
for (let k=0;k<4;k++){ await p.waitForTimeout(900);
  samples.push(await p.evaluate(()=>({ bears: window.WhiteoutBot.state().bearsActive, attack: window.WhiteoutBot.state().underAttack })));
  await p.screenshot({ path: `verify/towers-${k}.png`, clip: { x: 120, y: 300, width: 760, height: 380 } });
}
await b.close();
console.log(JSON.stringify({ bought, samples, errors }, null, 2));
