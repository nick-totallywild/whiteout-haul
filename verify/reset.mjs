import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('dialog', d => d.accept()); // auto-confirm the reset prompt
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick','Tester'); localStorage.setItem('whiteout-email','tester@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
// buy a bunch via the hook to advance the counters
await p.evaluate(() => { for (let i=0;i<8;i++) window.__buy('truck'); for(let i=0;i<3;i++) window.__buy('capacity'); });
const before = await p.evaluate(() => ({ trucks: __econ.getTruckCount(), bays: __econ.getBayCount(), cap: __econ.getCapacityLevel(), score: __econ.getScore(), cash: Math.floor(__econ.state.cash) }));
await p.click('#reset-btn');
await p.waitForTimeout(400);
const after = await p.evaluate(() => ({ trucks: __econ.getTruckCount(), bays: __econ.getBayCount(), cap: __econ.getCapacityLevel(), score: __econ.getScore(), cash: Math.floor(__econ.state.cash) }));
await b.close();
console.log(JSON.stringify({ before, after, errors }, null, 2));
