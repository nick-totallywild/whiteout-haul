import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/';
const b = await chromium.launch();

// Run one forced avalanche under a given defense and report the damage.
//   defense: 'none' | 'all' | 'escape'
async function run(defense) {
  const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await p.addInitScript(() => { localStorage.setItem('whiteout-nick', 'Nick'); localStorage.setItem('whiteout-email', 'n@gmail.com'); localStorage.removeItem('whiteout-bot-running'); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  // big operation: 9 trucks, 4 bays, capacity 10 — so a burial is expensive
  await p.evaluate(() => { window.__econ.state.cash = 1e7; for (let i = 0; i < 8; i++) window.__buy('truck'); for (let i = 0; i < 3; i++) window.__buy('bay'); for (let i = 0; i < 10; i++) window.__buy('capacity'); window.__econ.add(1); });
  await p.waitForTimeout(5000); // let the convoy roll; trucks fill the exit corridor

  // attach the chosen defense as the bot strategy
  await p.evaluate((mode) => {
    if (mode === 'none') return; // no defense at all
    window.WhiteoutBot.setStrategy(s => window.WhiteoutBot.holdTrucks(s.avalancheDanger, mode));
  }, defense);

  // wait until at least one truck is actually IN the death zone, then drop the
  // avalanche — so the run-or-freeze path is exercised, not just "all behind".
  for (let i = 0; i < 40; i++) {
    const inZone = await p.evaluate(() => __fleet.escapeTriage().inZone);
    if (inZone >= 1) break;
    await p.waitForTimeout(200);
  }
  const inZoneAtWarning = await p.evaluate(() => __fleet.escapeTriage().inZone);
  await p.evaluate(() => { window.__lastBuried = 0; window.__lastAvLoss = 0; window.__lastDentCost = 0; window.__avalanche.forceWarning(); });

  // sample the escape triage during the warning window
  const triage = [];
  for (let i = 0; i < 18; i++) {
    await p.waitForTimeout(700);
    const s = await p.evaluate(() => ({ st: __avalanche.state(), lethalIn: __avalanche.secondsUntilLethal(), tri: __fleet.escapeTriage() }));
    if (s.st === 'warning' || s.st === 'impact') triage.push({ st: s.st, lethalIn: Math.round(s.lethalIn * 10) / 10, ...s.tri });
    if (s.st === 'idle' && i > 4) break;
  }
  const r = await p.evaluate(() => ({ buried: window.__lastBuried || 0, avLoss: Math.round(window.__lastAvLoss || 0), dentCost: Math.round(window.__lastDentCost || 0) }));
  await p.close();
  return { defense, inZoneAtWarning, ...r, triageDuringWarning: triage.slice(0, 4), errors };
}

const none = await run('none');
const all = await run('all');
const escape = await run('escape');
await b.close();
console.log(JSON.stringify({ none, all, escape }, null, 2));
