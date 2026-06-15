import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Nick');
  localStorage.setItem('whiteout-email', 'nick@totallywild.ai');
  localStorage.removeItem('whiteout-bot-running');
});
await p.goto(URL, { waitUntil: 'networkidle' });
await p.evaluate(() => {
  window.__econ.state.cash = 1e9;
  for (let i = 0; i < 2; i++) window.__buy('tower');
  for (let i = 0; i < 5; i++) window.__buy('truck');
  for (let i = 0; i < 2; i++) window.__buy('bay');
  for (let i = 0; i < 6; i++) window.__buy('capacity');
  window.__econ.add(1); // no wire -> bears reach the fence
});
const cam = (px, py, pz, lx, ly, lz) =>
  p.evaluate(([px, py, pz, lx, ly, lz]) => { const c = window.__world.camera; c.position.set(px, py, pz); c.lookAt(lx, ly, lz); }, [px, py, pz, lx, ly, lz]);

await p.waitForTimeout(4500); // bay busy + loaders working, before the first raid

// 01 — operations overview (default isometric camera; dense forest, towers, bay)
await cam(48, 55, 68, -6, 0, -11);
await p.waitForTimeout(120);
await p.screenshot({ path: 'docs/screenshots/01-overview.png' });

// 03 — gated checkpoint: from inside the site looking out at the entrance gate
await cam(16, 8, 8, 44, 3, -6);
await p.waitForTimeout(300);
await p.screenshot({ path: 'docs/screenshots/03-gate.png' });

// 04 — bear raid: wait until a bear emerges from the woods and reaches the
// fence (clawing it), so one is actually in frame at the wire, then capture.
let frac = 1;
for (let i = 0; i < 140; i++) { frac = await p.evaluate(() => window.__bears.fenceFrac()); if (frac < 0.995) break; await p.waitForTimeout(180); }
await cam(40, 16, 48, 10, 3, 14);
await p.waitForTimeout(120);
const bears = await p.evaluate(() => window.__bears.bearsActive());
await p.screenshot({ path: 'docs/screenshots/04-bear-raid.png' });

// 06 — avalanche: hold the convoy, force it, capture snow on the lane (impact)
await p.click('#hold-btn');
await p.evaluate(() => window.__avalanche.forceWarning());
for (let i = 0; i < 18; i++) { const st = await p.evaluate(() => window.__avalanche.state()); if (st === 'impact') break; await p.waitForTimeout(250); }
await cam(8, 12, 26, -26, 3, -7);
await p.waitForTimeout(120);
await p.screenshot({ path: 'docs/screenshots/06-avalanche.png' });

await b.close();
console.log(JSON.stringify({ bears, errors }, null, 2));
