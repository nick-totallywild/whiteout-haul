import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 800 } });
const errors = [];
p.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
const st = await p.evaluate(() => ({
  guards: window.__world.guards.length,
  hasGuardPoll: typeof window.__bears.pollGuardInjuries === 'function',
  cash: Math.floor(window.__econ.state.cash),
  avState: window.__avalanche.state(),
}));
await b.close();
console.log(JSON.stringify({ st, errors }, null, 2));
