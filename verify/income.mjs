import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1000 } });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
// keep fence maxed + towers so no breach skews the income measurement
await p.evaluate(() => { window.__econ.state.cash = 1e7; while(window.__buy('fence')){} while(window.__buy('tower')){} });
const samples = [];
for (let cfg of [{t:0,b:0},{t:1,b:0},{t:1,b:1},{t:3,b:1},{t:3,b:2}]) {
  // set trucks/bays via buys to reach cfg (truck level = t, bay level = b)
  await p.evaluate(({t,b}) => {
    // reset levels by reset then rebuy is messy; just buy up
    while (__econ.getLevel('truck') < t) __buy('truck');
    while (__econ.getLevel('bay') < b) __buy('bay');
  }, cfg);
  await p.waitForTimeout(16000); // let income rate settle at this config
  const r = await p.evaluate(() => ({ trucks: __econ.getTruckCount(), bays: __econ.getBayCount(), income: Math.round(__econ.getIncomeRate()), burn: Math.round(__econ.getBurnRate()), net: Math.round(__econ.getNetRate()) }));
  samples.push(r);
}
await b.close();
console.log(JSON.stringify(samples, null, 2));
