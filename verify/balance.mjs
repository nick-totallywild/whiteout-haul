// Headless balance harness: runs the game, auto-buying upgrades with a chosen
// strategy, and logs the cash curve + upgrade levels + income rate over time.
import { chromium } from 'playwright';

const seconds = Number(process.argv[2] || 120);
const strategy = process.argv[3] || 'cheapest'; // 'cheapest' | 'truckfirst' | 'balanced'

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__econ);

const log = [];
let prevCash = 0;
for (let t = 0; t < seconds; t++) {
  await page.waitForTimeout(1000);
  const snap = await page.evaluate((strat) => {
    const e = window.__econ;
    const keys = e.upgradeKeys;
    // buy according to strategy until nothing affordable
    let bought = true;
    while (bought) {
      bought = false;
      const affordable = keys.filter((k) => e.canAfford(k));
      if (!affordable.length) break;
      let pick;
      if (strat === 'truckfirst') {
        pick = affordable.includes('truck') ? 'truck'
          : affordable.includes('capacity') ? 'capacity' : affordable[0];
      } else if (strat === 'balanced') {
        // buy the lowest-level upgrade (spread investment)
        pick = affordable.sort((a, b) => e.getLevel(a) - e.getLevel(b))[0];
      } else {
        // cheapest
        pick = affordable.sort((a, b) => e.costOf(a) - e.costOf(b))[0];
      }
      if (window.__buy(pick) !== false && e.getLevel) bought = true;
      else break;
    }
    return {
      cash: Math.floor(e.state.cash),
      earned: e.getScore(),
      trucks: e.getTruckCount(),
      cap: e.getCapacityLevel(),
      spd: e.getSpeedLevel(),
      bays: e.getBayCount(),
    };
  }, strategy);
  if ((t + 1) % 20 === 0 || t < 3) {
    log.push(`t=${t + 1}s earned=${snap.earned} cash=${snap.cash} trucks=${snap.trucks} cap=${snap.cap} spd=${snap.spd} bays=${snap.bays}`);
  }
  prevCash = snap.cash;
}
await browser.close();
console.log('strategy=' + strategy);
console.log(log.join('\n'));
console.log('errors=' + JSON.stringify(errors));
