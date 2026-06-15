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

// Build a lively site: 2 gun towers + barbed wire (so bears survive to the
// fence), a busy bay, economy on.
await p.evaluate(() => {
  window.__econ.state.cash = 1e9;
  for (let i = 0; i < 2; i++) window.__buy('tower'); // gun towers visible
  for (let i = 0; i < 5; i++) window.__buy('truck');
  for (let i = 0; i < 2; i++) window.__buy('bay');
  for (let i = 0; i < 6; i++) window.__buy('capacity');
  window.__econ.add(1); // no barbed wire -> frequent raids, bears reach the fence
});
await p.waitForTimeout(6000); // trucks fill the bay, loaders start working

// wait for a sizeable raid, then let them advance to the fence (still on-screen)
let bearsActive = 0;
for (let i = 0; i < 80; i++) {
  bearsActive = await p.evaluate(() => window.__bears.bearsActive());
  if (bearsActive >= 3) break;
  await p.waitForTimeout(250);
}
await p.waitForTimeout(1800); // bears close on the fence (towers firing)

// 1) Operations overview — default isometric camera (whole site, towers + bears)
await p.screenshot({ path: 'docs/screenshots/01-overview.png' });

// 2) Bear raid — push in on the front-center fence/bay with a tower in frame
await p.evaluate(() => {
  const c = window.__world.camera;
  c.position.set(34, 17, 50);
  c.lookAt(6, 3, 13);
});
await p.waitForTimeout(150);
bearsActive = await p.evaluate(() => window.__bears.bearsActive());
await p.screenshot({ path: 'docs/screenshots/04-bear-raid.png' });

await b.close();
console.log(JSON.stringify({ bearsActive, errors }, null, 2));
