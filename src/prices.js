// prices.js — live silver/gold spot prices on the dashboard (proxied from FMP by
// the leaderboard server) PLUS the real-world dollar value of a full truck load
// of gold/silver at those live prices, and the real cost of a haul truck.
//
// This is the "real economy" reference: a Cat 777-class rigid haul truck carries
// ~90 tonnes; at troy-ounce spot prices a full load is worth billions (gold) or
// hundreds of millions (silver). Numbers are intentionally eye-watering — they're
// here so the real economy can be worked out from them.
//
//   createPrices(economy) -> { refresh, latest(), loadValues() }

import { LEADERBOARD, REAL } from './config.js';

const TROY_OZ_PER_TONNE = 32150.7; // troy ounces in one metric tonne

// Compact USD: $4.24k / $12.3M / $1.96B / $1.20T
function usd(n) {
  const a = Math.abs(n);
  if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'k';
  return '$' + Math.round(n);
}

export function createPrices(economy) {
  const panel = document.createElement('div');
  panel.id = 'prices-panel';
  panel.innerHTML =
    `<div class="px-title">METAL SPOT <span class="px-src">live · FMP</span></div>` +
    `<div class="px-row" data-m="gold"><span class="px-name">🥇 Gold</span>` +
    `<span class="px-val">…</span><span class="px-chg"></span></div>` +
    `<div class="px-row" data-m="silver"><span class="px-name">🥈 Silver</span>` +
    `<span class="px-val">…</span><span class="px-chg"></span></div>` +
    `<div class="px-div"></div>` +
    `<div class="px-title">FULL TRUCK LOAD <span class="px-src">safe cap</span></div>` +
    `<div class="px-load"><span class="px-name">🥇 Gold · ${REAL.goldLoadTonnes}t</span><span class="px-val" data-load="gold">…</span></div>` +
    `<div class="px-load"><span class="px-name">🥈 Silver · ${REAL.silverLoadTonnes}t</span><span class="px-val" data-load="silver">…</span></div>` +
    `<div class="px-load px-truck"><span class="px-name">🚛 Truck</span><span class="px-val" data-load="truck"></span></div>`;
  document.body.appendChild(panel);

  const rows = {
    gold: panel.querySelector('[data-m="gold"]'),
    silver: panel.querySelector('[data-m="silver"]'),
  };
  const loadEls = {
    gold: panel.querySelector('[data-load="gold"]'),
    silver: panel.querySelector('[data-load="silver"]'),
    truck: panel.querySelector('[data-load="truck"]'),
  };
  let latest = null;

  function fmtPrice(p) {
    return '$' + Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderRow(metal, d) {
    const row = rows[metal];
    if (!row || !d) return;
    row.querySelector('.px-val').textContent = fmtPrice(d.price);
    const chg = row.querySelector('.px-chg');
    const up = (d.changePercent || 0) >= 0;
    chg.textContent = `${up ? '▲ +' : '▼ '}${Math.abs(d.changePercent || 0).toFixed(2)}%`;
    chg.className = 'px-chg ' + (up ? 'up' : 'down');
  }

  // Real-world value of a safe full load at the current spot prices. Gold and
  // silver have separate weight caps (gold is restricted harder).
  function loadValues() {
    const goldOz = REAL.goldLoadTonnes * TROY_OZ_PER_TONNE;
    const silverOz = REAL.silverLoadTonnes * TROY_OZ_PER_TONNE;
    const gold = latest && latest.gold ? goldOz * latest.gold.price : null;
    const silver = latest && latest.silver ? silverOz * latest.silver.price : null;
    return { goldTonnes: REAL.goldLoadTonnes, silverTonnes: REAL.silverLoadTonnes, gold, silver, truckCost: REAL.truckCostUSD };
  }

  function renderLoads() {
    const v = loadValues();
    loadEls.gold.textContent = v.gold != null ? usd(v.gold) : '—';
    loadEls.silver.textContent = v.silver != null ? usd(v.silver) : '—';
    loadEls.truck.textContent = usd(v.truckCost);
  }

  async function refresh() {
    try {
      const res = await fetch(`${LEADERBOARD.apiBase}/api/prices`);
      const data = await res.json();
      if (data && (data.gold || data.silver)) {
        latest = data;
        renderRow('gold', data.gold);
        renderRow('silver', data.silver);
        panel.classList.remove('px-offline');
      } else {
        panel.classList.add('px-offline');
      }
    } catch {
      panel.classList.add('px-offline');
    }
    renderLoads();
  }

  refresh();
  renderLoads();
  setInterval(refresh, 5 * 60 * 1000); // spot prices every 5 min (server caches 15)
  setInterval(renderLoads, 1000); // reflect capacity upgrades quickly

  return { refresh, latest: () => latest, loadValues };
}
