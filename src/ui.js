// ui.js — HTML overlay: currency counter (top-right) and upgrade buttons.
// Implements the interface contract below. DO NOT change the exported signature.
//
// Interface contract (createUI(economy, { onBuy })):
//   onBuy(key)  -> callback invoked when an upgrade button is clicked
//   returns { update() }  -> refresh currency text + button cost/level/disabled state

import { ECONOMY } from './config.js';

// Format a number compactly: integers < 1000 plain, then 1.2k / 3.4M / 1.0B ...
// Floors the value first (cash/cost are conceptually whole units).
function formatNumber(n) {
  if (!isFinite(n)) return 'MAX';
  n = Math.floor(n);
  if (n < 1000) return n.toString();

  const units = ['k', 'M', 'B', 'T'];
  let value = n;
  let unitIndex = -1;
  // Step down by 1000s until the value fits in [1, 1000) or we run out of units.
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex++;
  }
  // One decimal place, e.g. 1200 -> "1.2k", 3_400_000 -> "3.4M".
  return value.toFixed(1) + units[unitIndex];
}

export function createUI(economy, { onBuy } = {}) {
  const valueEl = document.getElementById('currency-value');
  const upgradesEl = document.getElementById('upgrades');

  // Net cash-flow readout under the cash counter: upkeep cost + live net rate.
  const netEl = document.createElement('div');
  netEl.id = 'net-readout';
  document.body.appendChild(netEl);

  // Build one button per upgrade key, capturing its level/cost spans.
  const buttons = [];
  if (upgradesEl) {
    for (const key of economy.upgradeKeys) {
      const label = ECONOMY.upgrades[key].label;
      const btn = document.createElement('button');
      btn.className = 'upgrade-btn';
      btn.innerHTML =
        `<span class="label">${label}</span>` +
        `<span class="level"></span>` +
        `<span class="cost"></span>`;
      btn.addEventListener('click', () => {
        if (onBuy) onBuy(key);
      });
      upgradesEl.appendChild(btn);
      buttons.push({
        key,
        btn,
        levelEl: btn.querySelector('.level'),
        costEl: btn.querySelector('.cost'),
      });
    }
  }

  function update() {
    // Currency counter.
    if (valueEl) valueEl.textContent = formatNumber(economy.state.cash);

    // Upkeep + net cash flow. Red & flagged when the operation is losing money
    // (income isn't covering the running costs — e.g. trucks halted by a breach).
    if (netEl) {
      const burn = economy.getBurnRate();
      const net = economy.getNetRate();
      const losing = net < 0;
      const sign = net >= 0 ? '+' : '−';
      netEl.innerHTML =
        `<span class="net-upkeep">Upkeep −$${formatNumber(burn)}/s</span>` +
        `<span class="net-rate ${losing ? 'bad' : 'good'}">` +
        `${losing ? '⚠ ' : ''}${sign}$${formatNumber(Math.abs(net))}/s</span>`;
      if (valueEl) valueEl.classList.toggle('draining', losing);
    }

    // Each upgrade button: level line, cost line, disabled state.
    for (const { key, btn, levelEl, costEl } of buttons) {
      // Trucks count from 1; other upgrades show their level number.
      if (key === 'truck') {
        levelEl.textContent = `Trucks: ${economy.getTruckCount()}`;
      } else if (key === 'bay') {
        levelEl.textContent = `Bays: ${economy.getBayCount()}`;
      } else if (key === 'tower') {
        levelEl.textContent = `Towers: ${economy.getTowerCount()}`;
      } else {
        levelEl.textContent = `Lv ${economy.getLevel(key)}`;
      }

      costEl.textContent = economy.isMaxed(key)
        ? 'MAX'
        : formatNumber(economy.costOf(key));

      // Grey out when it can't be bought (unaffordable or maxed).
      const buyable = economy.canAfford(key);
      btn.classList.toggle('disabled', !buyable);
    }
  }

  return { update };
}
