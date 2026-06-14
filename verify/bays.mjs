import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Tester');
  localStorage.setItem('whiteout-email', 'tester@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
// ramp ~55s auto-buying cheapest
for (let i=0;i<55;i++){
  await p.waitForTimeout(1000);
  await p.evaluate(() => {
    const e = window.__econ;
    let go=true;
    while(go){ go=false;
      const aff = e.upgradeKeys.filter(k=>e.canAfford(k));
      if(!aff.length) break;
      const k = aff.sort((a,b)=>e.costOf(a)-e.costOf(b))[0];
      if(window.__buy(k)) go=true; else break;
    }
  });
}
// now force bays up while affordable
await p.evaluate(() => { while(window.__econ.canAfford('bay') && window.__buy('bay')){} });
const lvls = await p.evaluate(() => ({ bays: window.__econ.getBayCount(), trucks: window.__econ.getTruckCount(), score: window.__econ.getScore() }));
await p.waitForTimeout(2500); // let trucks fill the bays
await p.screenshot({ path: 'verify/bays.png', clip: { x: 200, y: 330, width: 620, height: 320 } });
await b.close();
console.log(JSON.stringify({ lvls, errors }, null, 2));
