// main.js — entry point. Creates the world and game modules, wires the hauling
// loop together, and runs the game loop.
//
// Flow: the conveyor pours silver/gold bricks onto the pile. Trucks queue at the
// bay, get loaded, and each full truck that drives off pays out (more for gold).

import { createWorld } from './scene.js';
import { createEconomy } from './economy.js';
import { createFleet } from './trucks.js';
import { createConveyor } from './conveyor.js';
import { createUI } from './ui.js';
import { createLeaderboard } from './leaderboard.js';
import { createBot } from './bot.js';
import { createBotPanel } from './botpanel.js';
import { createPrices } from './prices.js';
import { createBears } from './bears.js';
import { createAvalanche } from './avalanche.js';
import { createSfx } from './sfx.js';
import { AVALANCHE, GUARDS } from './config.js';

const canvas = document.getElementById('game');
const world = createWorld(canvas);

const economy = createEconomy();
const sfx = createSfx(); // procedural sound: gunfire, bear roars, cash, alarm
const fleet = createFleet(world.scene, sfx);
const conveyor = createConveyor(world.scene);
const bears = createBears(world.scene, sfx, world.fence.segments, world.guards, world.treeObstacles); // bear raids + tower & guard defenses
const avalanche = createAvalanche(world.scene, sfx); // avalanche challenge
const ui = createUI(economy, { onBuy: handleBuy });

// Apply current upgrade levels to the fleet + defenses (start + after each buy).
function applyUpgrades() {
  fleet.setTruckCount(economy.getTruckCount());
  fleet.setSpeedLevel(economy.getSpeedLevel());
  fleet.setCapacityLevel(economy.getCapacityLevel());
  fleet.setBaysLevel(economy.getBayLevel());
  bears.setFenceLevel(economy.getFenceLevel());
  bears.setTowerCount(economy.getTowerCount());
}

function handleBuy(key) {
  if (economy.buy(key)) {
    applyUpgrades();
    ui.update();
    return true;
  }
  return false;
}

// Pay to repair the perimeter fence after bears have clawed it down.
function repairFence() {
  const cost = bears.repairCost();
  if (cost > 0 && economy.spend(cost)) {
    bears.repair();
    ui.update();
    return true;
  }
  return false;
}

// Avalanche defense: hold the convoy. Driven by the bot (holdTrucks) and/or a
// manual button; the fleet is held if either wants it. Effective hold is applied
// in the game loop.
let botHold = false;
let botHoldMode = 'all'; // 'all' = freeze everyone; 'escape' = run the front trucks out
let manualHold = false;
// The bot calls this. mode 'escape' lets trucks near the tunnel outrun the snow
// instead of freezing the whole convoy (fewer dents, keeps deliveries flowing).
function holdTrucks(on, mode = 'all') {
  botHold = !!on;
  botHoldMode = mode === 'escape' ? 'escape' : 'all';
  return true;
}

// Online leaderboard (nickname registration + global scores) and the scripting
// Bot API (window.WhiteoutBot) so players can automate to climb the leaderboard.
const leaderboard = createLeaderboard(economy);
const bot = createBot(economy, handleBuy, bears, repairFence, { holdTrucks, avalanche, fleet });
createBotPanel(); // in-game editor for attaching a strategy to WhiteoutBot
const prices = createPrices(economy); // live spot prices + real full-load values

// "BEAR RAID" banner shown while a bear is mauling the dock (loading paused).
const raidBanner = document.createElement('div');
raidBanner.id = 'raid-banner';
raidBanner.textContent = '🐻 BEAR RAID — loading halted!';
raidBanner.style.display = 'none';
document.body.appendChild(raidBanner);

// Avalanche warning/impact banner.
const avBanner = document.createElement('div');
avBanner.id = 'avalanche-banner';
avBanner.style.display = 'none';
document.body.appendChild(avBanner);

// Transient "truck buried" loss flash when the avalanche destroys a rig.
const lossFlash = document.createElement('div');
lossFlash.id = 'loss-flash';
lossFlash.style.display = 'none';
document.body.appendChild(lossFlash);
let lossFlashT = 0;
let lossAccum = 0;
function showTruckLoss(hit) {
  lossAccum += hit.replaceCost + hit.lostLoad;
  lossFlash.textContent = `🚛❌ TRUCK BURIED — −$${Math.round(lossAccum).toLocaleString('en-US')} (cargo + replacement)`;
  lossFlash.style.display = 'block';
  lossFlashT = 2.8; // seconds to keep it on screen
}
function showGuardLoss(n) {
  const cost = n * GUARDS.replaceCost;
  lossFlash.textContent = `🛡️❌ GUARD DOWN — −$${cost.toLocaleString('en-US')} replacement`;
  lossFlash.style.display = 'block';
  lossFlashT = 2.6;
}
function showTruckDent(dent) {
  lossFlash.textContent = `🚛🔧 ${dent.count} truck${dent.count > 1 ? 's' : ''} battered by snow — −$${dent.cost.toLocaleString('en-US')} repairs`;
  lossFlash.style.display = 'block';
  lossFlashT = 2.6;
}

// Manual "Hold Trucks" toggle (for hands-on play; the bot can do this too).
const holdBtn = document.createElement('button');
holdBtn.id = 'hold-btn';
holdBtn.textContent = '🛑 Hold';
holdBtn.title = 'Stop the convoy (hold during an avalanche)';
holdBtn.addEventListener('click', () => {
  manualHold = !manualHold;
  holdBtn.classList.toggle('active', manualHold);
  holdBtn.textContent = manualHold ? '▶ Release' : '🛑 Hold';
});
document.body.appendChild(holdBtn);

// Fence health bar + "Repair Fence" button — bears claw the fence down and the
// player pays to patch it back up (a recurring expense once towers can't keep up).
const fenceBar = document.createElement('div');
fenceBar.id = 'fence-bar';
fenceBar.innerHTML =
  '<span class="fence-cap">🛡 FENCE</span><div class="fence-track"><div class="fence-fill"></div></div>';
document.body.appendChild(fenceBar);
const fenceFill = fenceBar.querySelector('.fence-fill');

const repairBtn = document.createElement('button');
repairBtn.id = 'repair-btn';
repairBtn.style.display = 'none';
repairBtn.addEventListener('click', repairFence);
document.body.appendChild(repairBtn);

// "Move Wire" mode — pick up a barbed-wire coil and drop it on another fence
// stretch (e.g. to cover a gap your gun towers can't reach).
const wireBtn = document.createElement('button');
wireBtn.id = 'wire-btn';
wireBtn.textContent = '🧷 Move Wire';
wireBtn.style.display = 'none';
document.body.appendChild(wireBtn);
const wireHint = document.createElement('div');
wireHint.id = 'wire-hint';
wireHint.style.display = 'none';
document.body.appendChild(wireHint);

let wireEditing = false;
function setWireEditing(on) {
  wireEditing = on;
  wireBtn.classList.toggle('active', on);
  wireBtn.textContent = on ? '✓ Done' : '🧷 Move Wire';
  wireHint.style.display = on ? 'block' : 'none';
  if (on) {
    bears.beginWireEdit();
    wireHint.textContent = 'Click a coil to pick it up, then click the stretch to move it to. (Esc to finish)';
  } else {
    bears.endWireEdit();
  }
}
wireBtn.addEventListener('click', () => setWireEditing(!wireEditing));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wireEditing) setWireEditing(false); });

canvas.addEventListener('pointerdown', (e) => {
  if (!wireEditing) return;
  const r = canvas.getBoundingClientRect();
  const ndc = {
    x: ((e.clientX - r.left) / r.width) * 2 - 1,
    y: -((e.clientY - r.top) / r.height) * 2 + 1,
  };
  const res = bears.wireClick(ndc, world.camera);
  const msg = {
    picked: '✋ Coil picked up — now click where to move it.',
    moved: '✔ Wire moved. Pick another, or press Done/Esc.',
    empty: 'No coil there — click directly on an installed coil.',
    occupied: 'A coil is already on that stretch — pick a clear one.',
    cancel: 'Put back. Pick a coil to move.',
    deselect: 'Click closer to a fence stretch.',
  }[res];
  if (msg) wireHint.textContent = msg;
});

// Reset progress back to the start (trucks/bays = 1, capacity/speed = 0, cash and
// score reset). Exposed as a button + a console hook.
function resetProgress() {
  economy.reset();
  applyUpgrades();
  ui.update();
}
// Admin-only: the Reset button is shown only when an admin flag is set. Unlock
// it by visiting once with ?admin=1 (it persists in this browser); clear it with
// ?admin=0. Regular players never see the button.
const adminParam = new URLSearchParams(location.search).get('admin');
if (adminParam === '1') localStorage.setItem('whiteout-admin', '1');
if (adminParam === '0') localStorage.removeItem('whiteout-admin');
if (localStorage.getItem('whiteout-admin') === '1') {
  const resetBtn = document.createElement('button');
  resetBtn.id = 'reset-btn';
  resetBtn.textContent = '↻ Reset';
  resetBtn.addEventListener('click', () => {
    if (confirm('Reset your progress and start over from the beginning?')) resetProgress();
  });
  document.body.appendChild(resetBtn);
}

// Dev hooks for headless balance testing (harmless in normal play).
window.__econ = economy;
window.__fleet = fleet; // exposes truck/escape state for verification clips
window.__sfx = sfx; // exposes the audio engine for verification
window.__buy = handleBuy;
window.__reset = resetProgress;
window.__world = world; // exposes { scene, camera, renderer } for verification clips
window.__bears = bears; // exposes bear/fence state for verification clips
window.__avalanche = avalanche; // exposes avalanche state for verification

// Each full truck that drives off pays out its load value (computed in trucks.js
// from the silver/gold bricks it carried).
fleet.onDeliver((payout) => {
  economy.add(payout);
  sfx.coin(); // ka-ching on every paid delivery
});

// Browsers block audio until a user gesture — unlock on the first interaction.
function unlockAudio() {
  sfx.unlock();
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// Mute / unmute toggle (top-right, under the reset slot).
const muteBtn = document.createElement('button');
muteBtn.id = 'mute-btn';
muteBtn.textContent = '🔊';
muteBtn.title = 'Mute / unmute sound';
muteBtn.addEventListener('click', () => {
  const m = !sfx.isMuted();
  sfx.setMuted(m);
  muteBtn.textContent = m ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', m);
});
document.body.appendChild(muteBtn);

// Subtle wordmark, bottom-right.
const wordmark = document.createElement('div');
wordmark.id = 'wordmark';
wordmark.innerHTML = '<span class="wm-flake">❄</span> Whiteout Haul';
document.body.appendChild(wordmark);

applyUpgrades();
ui.update();

// ---- Game loop ----
// One simulation step. Runs from a background-proof ticker (see below), so the
// economy, challenges and the bot keep going whether or not the tab is on screen.
let wasBreached = false; // edge-detect so the alarm only fires once per breach
function stepOnce(dt) {
  economy.update(dt);
  conveyor.update(dt);
  bears.update(dt);
  // a bear mauling the dock halts loading until it's driven off / leaves
  const breached = bears.isBreached();
  fleet.setLoadingEnabled(!breached);
  // bears that got through block the lane — trucks stop behind them (no $ flow)
  fleet.setObstacleX(bears.laneBlockX());
  world.setUnderAttack(breached); // Santas scatter while bears are inside
  raidBanner.style.display = breached ? 'block' : 'none';
  if (breached && !wasBreached) sfx.alarm(); // fence just went down
  wasBreached = breached;

  // Gate guards mauled by bears -> pay for replacements.
  const injured = bears.pollGuardInjuries();
  if (injured > 0) {
    economy.spend(injured * GUARDS.replaceCost);
    window.__lastGuardLoss = (window.__lastGuardLoss || 0) + injured; // for verification
    showGuardLoss(injured);
  }

  // Fence health bar + repair button (only shown once the fence is damaged).
  const frac = bears.fenceFrac();
  fenceFill.style.width = (frac * 100).toFixed(0) + '%';
  fenceFill.style.background = frac > 0.5 ? '#5fbf66' : frac > 0.2 ? '#e0a83a' : '#d0322d';
  const rc = bears.repairCost();
  if (rc > 0) {
    repairBtn.style.display = 'block';
    repairBtn.textContent = `🔧 Repair Fence  $${rc}`;
    repairBtn.classList.toggle('afford', economy.state.cash >= rc);
  } else {
    repairBtn.style.display = 'none';
  }
  // the Move Wire button only matters once at least one coil is installed
  if (bears.wireCount() > 0) {
    if (wireBtn.style.display === 'none') wireBtn.style.display = 'block';
  } else if (!wireEditing) {
    wireBtn.style.display = 'none';
  }

  // Avalanche: run the cycle, show the warning/impact banner, hold the convoy if
  // requested, and destroy any truck caught in the snow zone.
  avalanche.update(dt);
  const avState = avalanche.state();
  world.setAvalancheHold(avState !== 'idle'); // loaders stop & hold clear during an avalanche
  if (avState === 'warning') {
    avBanner.style.display = 'block';
    avBanner.textContent = '🏔️ AVALANCHE WARNING — HOLD THE TRUCKS!';
  } else if (avState === 'impact') {
    avBanner.style.display = 'block';
    avBanner.textContent = '🏔️ AVALANCHE!';
  } else {
    avBanner.style.display = 'none';
  }
  if (lossFlashT > 0) {
    lossFlashT -= dt;
    if (lossFlashT <= 0) { lossFlash.style.display = 'none'; lossAccum = 0; }
  }
  // Manual hold is the panic button (freeze all); the bot may instead ask for
  // 'escape' so the trucks nearest the tunnel make a run for it.
  const wantHold = botHold || manualHold;
  const holdMode = manualHold ? 'all' : botHoldMode;
  fleet.setHold(wantHold, holdMode, avalanche.secondsUntilLethal());
  // The instant the snow lands: trucks that were HELD but stuck in the zone take
  // a partial dig-out/repair hit (they survive). Moving trucks are destroyed
  // continuously below for as long as the snow blocks the lane.
  if (avalanche.justLanded()) {
    const dent = fleet.dentHeldInZone();
    if (dent.count > 0) {
      economy.spend(dent.cost);
      window.__lastDentCost = (window.__lastDentCost || 0) + dent.cost; // for verification
      showTruckDent(dent);
    }
  }
  if (avalanche.isHazard()) {
    const hit = fleet.crushInZone();
    if (hit.count > 0) {
      economy.spend(hit.replaceCost);
      window.__lastBuried = (window.__lastBuried || 0) + hit.count; // for verification
      window.__lastAvLoss = (window.__lastAvLoss || 0) + hit.replaceCost + hit.lostLoad;
      showTruckLoss(hit);
    }
  }

  fleet.update(dt);
  world.setTruckXs(fleet.settledTruckXs()); // tell the loaders where trucks have stopped
  world.update(dt);
  bot.tick(dt);
  leaderboard.tick(dt);
  ui.update();
}

// Advance the sim by real elapsed time, in fixed substeps so a long gap (e.g. the
// tab was backgrounded) catches up smoothly instead of one giant jump.
const FIXED_STEP = 1 / 30;
const MAX_CATCHUP = 2.0; // cap advanced-per-tick so deep-background returns don't freeze
let last = performance.now();
function advance(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_CATCHUP) dt = MAX_CATCHUP;
  while (dt > 1e-4) {
    const s = dt > FIXED_STEP ? FIXED_STEP : dt;
    stepOnce(s);
    dt -= s;
  }
  window.__simTicks = (window.__simTicks || 0) + 1; // for verification
}

// Background-proof ticker: requestAnimationFrame and page timers are paused /
// throttled hard when the tab is hidden, which would freeze the bot's automation.
// A Web Worker's timer keeps firing in the background, so we drive the SIMULATION
// from the worker and only RENDER from rAF (rendering a hidden tab is pointless).
// Falls back to a pure rAF loop if Workers are unavailable.
let workerDriven = false;
try {
  const src = 'setInterval(function(){postMessage(0)},33)';
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
  worker.onmessage = () => advance(performance.now());
  workerDriven = true;
} catch (e) {
  workerDriven = false; // Blob/Worker blocked — fall back to rAF-only below
}
window.__workerDriven = workerDriven; // for verification

function renderLoop() {
  if (!workerDriven) advance(performance.now()); // no worker: step here too
  world.render();
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);
