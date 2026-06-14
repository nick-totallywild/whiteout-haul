import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage({ viewport: { width: 900, height: 800 } });
const errors = [];
p.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.state.cash = 5000; window.__econ.add(1); });

const workerDriven = await p.evaluate(() => window.__workerDriven);

// Open a SECOND page and bring it to front, so the first page is genuinely a
// background tab (rAF should pause for it). Then check the first page's sim ticks.
const p2 = await ctx.newPage();
await p2.goto('about:blank');
await p2.bringToFront();

const before = await p.evaluate(() => ({ ticks: window.__simTicks||0, earned: window.__econ.state.totalEarned, t: performance.now() }));
await new Promise(r => setTimeout(r, 6000)); // 6s with page 1 backgrounded
const after = await p.evaluate(() => ({ ticks: window.__simTicks||0, earned: window.__econ.state.totalEarned, t: performance.now() }));

await b.close();
console.log(JSON.stringify({
  workerDriven,
  ticksWhileHidden: after.ticks - before.ticks,
  earnedWhileHidden: Math.round(after.earned - before.earned),
  errors,
}, null, 2));
