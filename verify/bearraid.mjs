import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console:'+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
// upgrade buttons
const btnLabels = await p.$$eval('.upgrade-btn .label', els => els.map(e => e.textContent));
// auto-buy cheapest for a while to fund defenses + let bears raid
for (let i=0;i<45;i++){
  await p.waitForTimeout(1000);
  await p.evaluate(() => { const e=window.__econ; let go=true; while(go){go=false; const aff=e.upgradeKeys.filter(k=>e.canAfford(k)); if(!aff.length)break; const k=aff.sort((a,b)=>e.costOf(a)-e.costOf(b))[0]; if(window.__buy(k))go=true; else break;} });
}
// force as many towers + barbed wire as affordable
await p.evaluate(() => { while(window.__buy('tower')){} while(window.__buy('fence')){} });
const eco = await p.evaluate(() => ({ towers: __econ.getTowerCount(), fence: __econ.getFenceLevel() }));
const botState = await p.evaluate(() => { const s = window.WhiteoutBot.state(); return { bearsActive: s.bearsActive, underAttack: s.underAttack, towers: s.towers, fenceLevel: s.fenceLevel, hasFenceCost: 'fence' in s.costs, hasTowerCost: 'tower' in s.costs }; });
await p.screenshot({ path: 'verify/bearraid.png' });
await b.close();
console.log(JSON.stringify({ btnLabels, eco, botState, errors }, null, 2));
