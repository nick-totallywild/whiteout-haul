import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com');
  // fresh bot state
  localStorage.removeItem('whiteout-bot-code'); localStorage.removeItem('whiteout-bot-running');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('.bot-toggle');
const lib = await p.$$eval('.bot-examples option', els => els.map(e=>e.value).filter(Boolean));
const defaultIsFull = await p.$eval('.bot-code', el => el.value.includes('FULL STRATEGY'));

// give cash, run the (default) full strategy
await p.evaluate(() => { window.__econ.state.cash = 5000; window.__econ.add(1); });
await p.click('.bot-run');
const running = await p.evaluate(() => window.WhiteoutBot.isRunning());
const lvlBefore = await p.evaluate(() => __econ.getTruckCount()+__econ.getBayCount()+__econ.getCapacityLevel()+__econ.getSpeedLevel());
await p.waitForTimeout(6000); // let it grow
const lvlAfter = await p.evaluate(() => __econ.getTruckCount()+__econ.getBayCount()+__econ.getCapacityLevel()+__econ.getSpeedLevel());

// force an avalanche -> full strategy should hold (0 buried)
await p.evaluate(() => { window.__lastBuried = 0; window.__avalanche.forceWarning(); });
for (let i=0;i<16;i++){ if ((await p.evaluate(()=>__avalanche.state()))==='idle') break; await p.waitForTimeout(1000); }
const buried = await p.evaluate(() => window.__lastBuried||0);

await b.close();
console.log(JSON.stringify({ lib, defaultIsFull, running, grewBy: lvlAfter - lvlBefore, buriedDuringAvalanche: buried, errors }, null, 2));
