import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Nick');
  localStorage.setItem('whiteout-email', 'n@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

// lots of traffic so trucks keep entering the corridor during the hazard
await p.evaluate(() => {
  window.__econ.state.cash = 1e7;
  for (let i = 0; i < 8; i++) window.__buy('truck');
  for (let i = 0; i < 3; i++) window.__buy('bay');
  for (let i = 0; i < 6; i++) window.__buy('capacity');
  window.__econ.add(1);
});
await p.waitForTimeout(6000);

async function waitIdle() {
  for (let i = 0; i < 25; i++) { if ((await p.evaluate(() => __avalanche.state())) === 'idle') return; await p.waitForTimeout(1000); }
}

async function runAvalanche(hold) {
  await p.evaluate(() => { window.__lastBuried = 0; window.__lastAvLoss = 0; window.__econ.state.cash = 5e5; });
  const active = await p.evaluate(() => document.getElementById('hold-btn').classList.contains('active'));
  if (hold && !active) await p.click('#hold-btn');
  if (!hold && active) await p.click('#hold-btn');
  const cashBefore = await p.evaluate(() => Math.floor(__econ.state.cash));
  await p.evaluate(() => window.__avalanche.forceWarning());
  await waitIdle();
  const r = await p.evaluate(() => ({
    cashAfter: Math.floor(__econ.state.cash),
    buried: window.__lastBuried || 0,
    loss: window.__lastAvLoss || 0,
  }));
  return { hold, buried: r.buried, loss: r.loss, cashDrop: cashBefore - r.cashAfter };
}

const noHold = await runAvalanche(false);
await waitIdle();
const withHold = await runAvalanche(true);
await p.evaluate(() => { if (document.getElementById('hold-btn').classList.contains('active')) document.getElementById('hold-btn').click(); });

await b.close();
console.log(JSON.stringify({ noHold, withHold, errors }, null, 2));
