// bot.js — a small, stable scripting API players can use to automate their
// operation and compete for the highest earnings. Exposed as window.WhiteoutBot.
//
//   WhiteoutBot.state()            -> snapshot of cash/income/levels/costs
//   WhiteoutBot.buy('truck'|'capacity'|'speed')  -> attempt a purchase (bool)
//   WhiteoutBot.setStrategy(fn)    -> fn(state) runs every tick; decide & buy
//   WhiteoutBot.clearStrategy()    -> stop the strategy
//
// Example (paste in the browser console):
//   WhiteoutBot.setStrategy(s => {
//     // buy the most cost-efficient upgrade you can afford
//     const order = ['truck','capacity','speed'].filter(k => s.affordable[k]);
//     order.sort((a,b) => s.costs[a] - s.costs[b]);
//     if (order[0]) WhiteoutBot.buy(order[0]);
//   });

import { BRICK } from './config.js';

export function createBot(economy, buyFn, bears, repairFn, extras = {}) {
  const { holdTrucks: holdFn, avalanche, fleet } = extras;
  let strategy = null;
  let lastScore = economy.getScore();
  let incomeEst = 0;

  function state() {
    const costs = {};
    const affordable = {};
    const maxed = {};
    for (const k of economy.upgradeKeys) {
      costs[k] = economy.costOf(k);
      affordable[k] = economy.canAfford(k);
      maxed[k] = economy.isMaxed(k);
    }
    return {
      cash: Math.floor(economy.state.cash),
      score: economy.getScore(), // total earned (the leaderboard metric)
      incomePerSec: Math.round(incomeEst),
      burnPerSec: Math.round(economy.getBurnRate()), // operating cost ($/sec)
      netPerSec: Math.round(economy.getNetRate()), // income - upkeep; <0 = bleeding cash
      trucks: economy.getTruckCount(),
      bays: economy.getBayCount(),
      capacityLevel: economy.getCapacityLevel(),
      speedLevel: economy.getSpeedLevel(),
      fenceLevel: economy.getFenceLevel(),
      towers: economy.getTowerCount(),
      bearsActive: bears ? bears.bearsActive() : 0, // bears currently raiding
      underAttack: bears ? bears.isBreached() : false, // dock being mauled (loading paused)
      fenceHealth: bears ? bears.fenceFrac() : 1, // 0..1 remaining fence strength
      fenceBroken: bears ? bears.isBreached() : false, // fence down (loading paused)
      repairCost: bears ? bears.repairCost() : 0, // cash to fully repair the fence
      avalanche: avalanche ? avalanche.state() : 'idle', // 'idle'|'warning'|'impact'|'settle'
      // snow is incoming OR still on the lane (warning→impact→settle) — keep the
      // trucks HELD until it's fully cleared, or they drive into it and get buried
      avalancheDanger: avalanche ? avalanche.state() !== 'idle' : false,
      // seconds before the lane turns deadly (null when no avalanche is active)
      avalancheLethalIn: avalanche && isFinite(avalanche.secondsUntilLethal())
        ? Math.round(avalanche.secondsUntilLethal() * 10) / 10
        : null,
      // how an 'escape' hold would triage the convoy right now: { run, hold,
      // trap, inZone }. `run` trucks bolt for the tunnel and survive; `trap`
      // trucks are stuck in the zone and take a dig-out dent. Use this to decide
      // between bot.holdTrucks(true,'escape') (save the runners) and a freeze.
      avalancheEscape: fleet ? fleet.escapeTriage() : { run: 0, hold: 0, trap: 0, inZone: 0 },
      upgrades: economy.upgradeKeys, // truck, capacity, speed, bay, fence, tower
      costs,
      affordable,
      maxed,
      brick: { goldChance: BRICK.goldChance, silverValue: BRICK.silverValue, goldValue: BRICK.goldValue },
    };
  }

  function buy(key) {
    if (!economy.upgradeKeys.includes(key)) return false;
    return buyFn(key) === true;
  }

  // Pay to fully repair the fence. Returns true if a repair was paid for.
  function repairFence() {
    return typeof repairFn === 'function' ? repairFn() === true : false;
  }

  // Hold (true) / release (false) the convoy during an avalanche so moving
  // trucks don't get buried. mode 'all' (default) freezes the whole convoy;
  // mode 'escape' lets trucks near the tunnel make a run for it (and clear the
  // lane) while the rest wait safely — fewer dents, deliveries keep flowing.
  function holdTrucks(on, mode = 'all') {
    return typeof holdFn === 'function' ? holdFn(on, mode) === true : false;
  }

  function setStrategy(fn) {
    strategy = typeof fn === 'function' ? fn : null;
    if (strategy) console.log('[WhiteoutBot] strategy attached — it will run every tick.');
  }

  function clearStrategy() {
    strategy = null;
    console.log('[WhiteoutBot] strategy cleared.');
  }

  function tick(dt) {
    // smoothed income estimate from the score (total earned) delta
    const now = economy.getScore();
    const rate = dt > 0 ? (now - lastScore) / dt : 0;
    incomeEst += (rate - incomeEst) * Math.min(1, dt * 0.5);
    lastScore = now;

    if (strategy) {
      try {
        strategy(state());
      } catch (e) {
        console.error('[WhiteoutBot] strategy error:', e);
      }
    }
  }

  const api = { state, buy, repairFence, holdTrucks, setStrategy, clearStrategy, isRunning: () => strategy !== null };
  window.WhiteoutBot = api;
  console.log('%c[WhiteoutBot] ready.', 'color:#3fa34d;font-weight:bold');
  console.log('Upkeep drains cash 24/7 — keep the trucks moving or go bankrupt. State: s.netPerSec, s.burnPerSec, s.fenceBroken, s.repairCost. Actions: bot.buy(key), bot.repairFence().');
  console.log("Avalanche: bot.holdTrucks(s.avalancheDanger, 'escape') runs the front trucks out the tunnel instead of freezing all. See s.avalancheEscape {run,hold,trap} + s.avalancheLethalIn.");
  console.log('Try: WhiteoutBot.setStrategy(s => { if (s.fenceBroken && s.cash>=s.repairCost) return WhiteoutBot.repairFence(); const k=s.upgrades.filter(x=>s.affordable[x]).sort((a,b)=>s.costs[a]-s.costs[b])[0]; if(k) WhiteoutBot.buy(k); })');

  return { tick };
}
