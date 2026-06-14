import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Nick');
  localStorage.setItem('whiteout-email', 'n@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

const read = () => p.evaluate(() => ({
  cash: Math.floor(__econ.state.cash),
  burn: Math.round(__econ.getBurnRate()),
  net: Math.round(__econ.getNetRate()),
  income: Math.round(__econ.getIncomeRate()),
  breached: window.WhiteoutBot.state().fenceBroken,
}));

// 1) At load, before any sale: upkeep is shown but NOT charged yet.
const atStart = await read();

// 2) Early hauling (pre-breach): cash should climb as income beats upkeep.
await p.waitForTimeout(3000);
const t3 = await read();
await p.waitForTimeout(5000);
const t8 = await read();

// 3) Wait for a breach, then top up cash and watch it BLEED while we DON'T repair
//    (trucks halted by the bear on the lane -> no income -> upkeep drains cash).
let breached = false;
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(1000);
  if ((await read()).breached) { breached = true; break; }
}
let drain = null;
if (breached) {
  await p.evaluate(() => { window.__econ.state.cash = 800; });
  const before = await read();
  await p.waitForTimeout(6000);
  const after = await read();
  drain = { before: before.cash, after: after.cash, delta: after.cash - before.cash, stillBreached: after.breached, net: after.net };
}

await b.close();
console.log(JSON.stringify({ atStart, t3, t8, grewEarly: t8.cash - t3.cash, breached, drain, errors }, null, 2));
