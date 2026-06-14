// economy.js — currency, earn rate and upgrade purchasing.
// Implements the interface contract below. DO NOT change the exported
// signature — main.js and ui.js depend on it.
//
// Interface contract (createEconomy):
//   state.cash : number
//   update(dt)                  -> accrue passive income (ECONOMY.passiveRatePerSec)
//   add(amount)                 -> add cash (used by truck deliveries)
//   getLevel(key)               -> current level of upgrade key ('truck'|'capacity'|'speed')
//   costOf(key)                 -> next-level cost (Infinity if maxed)
//   canAfford(key)              -> bool
//   buy(key)                    -> bool; deducts cost + increments level if affordable
//   isMaxed(key)                -> bool
//   getTruckCount()             -> number of trucks (truck level + 1)
//   getSpeedLevel()             -> speed upgrade level
//   getCapacityLevel()          -> capacity upgrade level
//   getDeliveryValue()          -> per-BLOCK payout (main.js multiplies by truck capacity)
//   upgradeKeys                 -> ['truck','capacity','speed']

import { ECONOMY } from './config.js';

const SAVE_KEY = 'whiteout-save';
const SAVE_INTERVAL = 5; // seconds between periodic autosaves

export function createEconomy() {
  const upgradeKeys = ['truck', 'capacity', 'speed', 'bay', 'fence', 'tower'];

  // state holds cash + a level per upgrade key (all start at 0).
  const state = {
    cash: ECONOMY.startingCash,
    levels: { truck: 0, capacity: 0, speed: 0, bay: 0, fence: 0, tower: 0 },
    totalEarned: 0, // cumulative income — used as the leaderboard score
  };

  // ---- Persistence (Phase 8) -------------------------------------------
  // Load a saved {cash, levels} from localStorage, falling back to defaults.
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.cash === 'number') state.cash = data.cash;
      if (typeof data.totalEarned === 'number') state.totalEarned = data.totalEarned;
      if (data.levels) {
        for (const key of upgradeKeys) {
          if (typeof data.levels[key] === 'number') {
            state.levels[key] = data.levels[key];
          }
        }
      }
    } catch (e) {
      // Corrupt/unavailable storage — just keep defaults.
    }
  }

  function save() {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ cash: state.cash, levels: state.levels, totalEarned: state.totalEarned })
      );
    } catch (e) {
      // Storage full/unavailable — ignore, game still runs.
    }
  }

  load();
  let saveTimer = 0; // accumulates dt for periodic autosave
  let started = state.totalEarned > 0; // upkeep kicks in after the first sale
  let incomeRate = 0; // smoothed $/sec earned (for the net readout)
  let lastEarned = state.totalEarned;

  // ---- Upgrade math ----------------------------------------------------
  function getLevel(key) {
    return state.levels[key] || 0;
  }

  function isMaxed(key) {
    return getLevel(key) >= ECONOMY.upgrades[key].maxLevel;
  }

  // Geometric cost scaling: cost = baseCost * costGrowth^level, rounded.
  function costOf(key) {
    if (isMaxed(key)) return Infinity;
    const u = ECONOMY.upgrades[key];
    return Math.round(u.baseCost * Math.pow(u.costGrowth, getLevel(key)));
  }

  function canAfford(key) {
    return !isMaxed(key) && state.cash >= costOf(key);
  }

  function buy(key) {
    if (!canAfford(key)) return false;
    state.cash -= costOf(key);
    if (state.cash < 0) state.cash = 0; // never go negative
    state.levels[key] = getLevel(key) + 1;
    save();
    return true;
  }

  // Nominal operating cost ($/sec): salaries, fuel, machinery — scales with the
  // size of the operation. Shown to the player whether or not it's being charged.
  function getBurnRate() {
    const u = ECONOMY.upkeep || {};
    return (
      (u.base || 0) +
      (u.perTruck || 0) * getTruckCount() +
      (u.perBay || 0) * getBayCount() +
      (u.perCapacityLevel || 0) * getCapacityLevel()
    );
  }
  function getIncomeRate() {
    return incomeRate;
  }
  // Net cash flow ($/sec). Burn only counts once operations have started.
  function getNetRate() {
    return incomeRate - (started ? getBurnRate() : 0);
  }

  // ---- Income ----------------------------------------------------------
  function update(dt) {
    state.cash += ECONOMY.passiveRatePerSec * dt;

    // Operating costs drain cash every second the operation is running.
    if (started) {
      state.cash -= getBurnRate() * dt;
      if (state.cash < 0) state.cash = 0; // bankrupt — but never negative
    }

    // Smoothed income estimate from lifetime-earnings delta (for the net readout).
    const rate = dt > 0 ? (state.totalEarned - lastEarned) / dt : 0;
    incomeRate += (rate - incomeRate) * Math.min(1, dt * 0.6);
    lastEarned = state.totalEarned;

    // Periodic autosave so progress survives a refresh even without buys.
    saveTimer += dt;
    if (saveTimer >= SAVE_INTERVAL) {
      saveTimer = 0;
      save();
    }
  }

  function add(amount) {
    state.cash += amount;
    if (amount > 0) {
      state.totalEarned += amount; // track lifetime earnings (score)
      started = true; // first sale -> the meter is running
    }
  }

  // Spend cash on a non-upgrade cost (e.g. fence repair). Returns false if broke.
  function spend(amount) {
    amount = Math.max(0, Math.floor(amount));
    if (state.cash < amount) return false;
    state.cash -= amount;
    save();
    return true;
  }

  // Leaderboard score = total money earned (only grows).
  function getScore() {
    return Math.floor(state.totalEarned);
  }

  // ---- Derived values for the fleet ------------------------------------
  function getTruckCount() {
    return getLevel('truck') + 1; // start with 1 truck at level 0
  }

  function getSpeedLevel() {
    return getLevel('speed');
  }

  function getCapacityLevel() {
    return getLevel('capacity');
  }

  function getBayLevel() {
    return getLevel('bay');
  }

  function getBayCount() {
    return getLevel('bay') + 1; // start with 1 loading bay at level 0
  }

  function getFenceLevel() {
    return getLevel('fence');
  }

  function getTowerCount() {
    return getLevel('tower'); // 0 gun towers at level 0
  }

  // Per-BLOCK delivery value. main.js computes the real payout as
  // getDeliveryValue() * truck.capacity, so we must NOT multiply by
  // capacity here or it would double-count.
  function getDeliveryValue() {
    return ECONOMY.baseDeliveryValue;
  }

  // ---- Reset (handy, not used by main.js) ------------------------------
  function reset() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {
      // ignore
    }
    state.cash = ECONOMY.startingCash;
    state.levels = { truck: 0, capacity: 0, speed: 0, bay: 0, fence: 0, tower: 0 };
    state.totalEarned = 0;
    saveTimer = 0;
    started = false;
    incomeRate = 0;
    lastEarned = 0;
  }

  return {
    state,
    upgradeKeys,
    update,
    add,
    spend,
    getLevel,
    costOf,
    canAfford,
    buy,
    isMaxed,
    getTruckCount,
    getSpeedLevel,
    getCapacityLevel,
    getBayLevel,
    getBayCount,
    getFenceLevel,
    getTowerCount,
    getDeliveryValue,
    getBurnRate,
    getIncomeRate,
    getNetRate,
    getScore,
    reset,
  };
}
