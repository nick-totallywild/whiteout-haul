// trucks.js — the loading-queue convoy, matching the reference flow:
//   trucks DRIVE IN from the right, QUEUE bumper-to-bumper at the bay, the front
//   truck is LOADED (silver/gold bricks fly from the pile into its bed), and when
//   full it DRIVES OFF to the left (this is when money is earned). The line
//   shuffles forward; trucks that drive off recycle to the back, so the queue
//   stays full and trucks are always arriving and departing — never looping.
//
// Interface contract (createFleet(scene)):
//   setTruckCount(n)      -> ensure n trucks in the queue system
//   setSpeedLevel(level)  -> drive + loading speed
//   setCapacityLevel(lvl) -> bricks per load (and payout)
//   onDeliver(cb)         -> cb(payout) fired once per load when a truck drives off
//   update(dt)            -> run the queue / loading state machine

import * as THREE from 'three';
import { COLORS, LAYOUT, TRUCK, BRICK, AVALANCHE } from './config.js';

// Expected $/brick (silver/gold mix) — used to size the avalanche replacement hit.
const EXP_PER_BRICK = (1 - BRICK.goldChance) * BRICK.silverValue + BRICK.goldChance * BRICK.goldValue;

const WHEEL_R = 0.5;
const CHASSIS_TOP = 0.95;
const BED_FILL_BASE_H = 0.15;
const TRANSFER_TIME = 0.32; // seconds for a brick to fly pile -> bed

const LANE = LAYOUT.lane;
const BAY_X = LANE.bayX;
const ENTRANCE = LANE.entranceX;
const EXIT = LANE.exitX;
const Z = LANE.z;
const GAP = TRUCK.queueGap;
const REACTION_TIME = 0.4; // beat a stopped truck waits before pulling away (stop-and-go)
// Avalanche impact zone along the lane: the exit corridor between the bay
// (BAY_X ≈ -6) and the tunnel. Trucks here when it lands are buried; the bay and
// the inbound queue are clear. Keep in sync with avalanche.js chunk landing.
const AVALANCHE_ZONE_MIN = -42;
const AVALANCHE_ZONE_MAX = -14;
// Escape-mode hold: trucks safely behind the zone wait at this stop line (just
// clear of the danger edge); trucks already in the zone either make a run for
// the tunnel or freeze. ESCAPE_BOOST is the extra speed a committed runner puts
// on to outrun the snow, and SAFETY_MARGIN is the spare time it must keep so it
// fully clears AVALANCHE_ZONE_MIN before the lane turns lethal.
const STOP_LINE = AVALANCHE_ZONE_MAX + 3; // hold here, clear of the snow
const ESCAPE_BOOST = 1.6; // runners floor it (×normal speed)
const ESCAPE_SAFETY = 0.6; // seconds of spare time a runner must keep

export function createFleet(scene, sfx = null) {
  const loadSource = new THREE.Vector3(LAYOUT.pilePos.x, 2.6, LAYOUT.pilePos.z);

  // The bed's load pile (recoloured by the gold share); the truck body's own
  // materials live in the shared model (TM, see buildTruckMesh).
  const silverMat = new THREE.MeshLambertMaterial({ color: BRICK.silverColor });
  const goldMat = new THREE.MeshLambertMaterial({ color: BRICK.goldColor });
  const cargoGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);

  /** trucks: { group, fill, x, loaded, progress, bricks, silver, gold } */
  const trucks = [];
  const transfers = []; // flying bricks: { mesh, from, to, p }
  let speed = TRUCK.baseSpeed;
  let speedLevel = 0;
  let capacity = TRUCK.startCapacity;
  let bays = 1; // number of parallel loading bays (front N trucks load at once)
  let loadingEnabled = true; // bears can pause loading while they maul the dock
  let obstacleX = null; // x of a bear blocking the lane — trucks stop behind it
  let holdMode = null; // avalanche hold: null=off, 'all'=freeze everyone, 'escape'=run-or-hold
  let secondsUntilLethal = Infinity; // time before the lane is deadly (drives 'escape' triage)
  let deliverCb = null;
  const OBSTACLE_GAP = 3.4; // how far a truck stops short of a blocking bear

  function loadRate() {
    const effLoadTime = TRUCK.loadTime / (1 + speedLevel * 0.2);
    return capacity / effLoadTime; // ~constant fill time regardless of capacity
  }

  // --- Truck mesh: a Freightliner M2 106 dump truck (see buildTruckMesh) ------
  function buildTruck() {
    const { group, bed, bedL, innerW, wt, floorTopY } = buildTruckMesh();
    // the load pile that grows in the bed (recoloured silver/gold by applyFill)
    const fill = box(bedL - wt * 3, BED_FILL_BASE_H, innerW - wt * 2, silverMat);
    fill.position.y = floorTopY + BED_FILL_BASE_H / 2;
    bed.add(fill);
    // Trucks drive along -X, so the cab (+local X) faces the drive direction.
    group.rotation.y = Math.PI;
    return { group, fill };
  }

  // Show how full the bed is (0..1) and tint by the gold share of the load.
  function applyFill(tr) {
    const frac = capacity > 0 ? tr.progress / capacity : 0;
    const h = 0.05 + Math.min(1, frac) * 0.85;
    tr.fill.scale.y = h / BED_FILL_BASE_H;
    tr.fill.position.y = 0.14 + h / 2;
    const goldShare = tr.bricks > 0 ? tr.gold / tr.bricks : 0;
    tr.fill.material = goldShare > 0.33 ? goldMat : silverMat;
    tr.fill.visible = frac > 0.001;
  }

  function resetLoad(tr) {
    tr.loaded = false;
    tr.progress = 0;
    tr.bricks = 0;
    tr.silver = 0;
    tr.gold = 0;
    applyFill(tr);
  }

  // --- Public API ---------------------------------------------------------
  function setTruckCount(n) {
    n = Math.max(1, Math.min(9, Math.floor(n)));
    while (trucks.length < n) {
      const { group, fill } = buildTruck();
      scene.add(group);
      const tr = { group, fill, x: 0, loaded: false, progress: 0, bricks: 0, silver: 0, gold: 0, moving: false, reactT: 0, settled: false };
      // Spawn off-screen at the entrance, spaced well apart, so trucks drive IN
      // one at a time (staggered) instead of all appearing in the queue at once.
      tr.x = ENTRANCE + 6 + trucks.length * (GAP + 4);
      trucks.push(tr);
      applyFill(tr);
    }
    while (trucks.length > n) {
      const r = trucks.pop();
      scene.remove(r.group);
      disposeGroup(r.group);
    }
  }

  function setSpeedLevel(level) {
    speedLevel = level;
    speed = TRUCK.baseSpeed + level * TRUCK.speedPerLevel;
  }

  function setCapacityLevel(level) {
    capacity = TRUCK.startCapacity + level * TRUCK.capacityPerLevel;
    for (const tr of trucks) applyFill(tr);
  }

  function setBaysLevel(level) {
    bays = 1 + level; // 1 bay at level 0, up to maxLevel+1 parallel bays
  }

  function setLoadingEnabled(on) {
    loadingEnabled = on; // bears pause loading while breaching the dock
  }

  // A bear on the lane (x position) that trucks must not drive through; pass null
  // when the lane is clear.
  function setObstacleX(x) {
    obstacleX = typeof x === 'number' ? x : null;
  }

  // Avalanche hold. mode 'all' freezes the whole convoy (drivers take cover).
  // mode 'escape' is smarter: trucks close enough to the tunnel make a run for
  // it (and clear the lane), trucks behind the zone wait at the stop line, and
  // only trucks trapped mid-zone freeze in place. `sUntilLethal` is how long
  // until the lane turns deadly — used to decide who can still outrun the snow.
  function setHold(on, mode = 'all', sUntilLethal = Infinity) {
    holdMode = on ? mode : null;
    secondsUntilLethal = sUntilLethal;
  }

  // x at/below which a truck can still clear the death zone before the snow
  // lands (driving out at the boosted escape speed, keeping a safety margin).
  function commitLine() {
    const escapeSpeed = speed * ESCAPE_BOOST;
    const t = Math.max(0, secondsUntilLethal - ESCAPE_SAFETY);
    return AVALANCHE_ZONE_MIN + escapeSpeed * t;
  }

  // Classify a truck for escape-mode hold: 'run' (floor it to the tunnel),
  // 'hold' (safely behind the zone — wait at the stop line) or 'trap' (stuck in
  // the zone, can't clear in time — freeze and eat the dent).
  function escapeRole(tr, commitX) {
    if (tr.x >= STOP_LINE) return 'hold';      // behind the danger — just wait it out
    if (tr.x <= commitX) return 'run';         // can clear the tunnel in time
    return 'trap';                             // in the zone, too late to escape
  }

  // How escape mode would triage the convoy right now (for the bot to reason
  // about whether running beats a blanket hold). inZone counts trucks currently
  // standing in the death zone.
  function escapeTriage() {
    const commitX = commitLine();
    let run = 0, hold = 0, trap = 0, inZone = 0;
    for (const tr of trucks) {
      if (tr.x >= AVALANCHE_ZONE_MIN && tr.x <= AVALANCHE_ZONE_MAX) inZone++;
      const role = escapeRole(tr, commitX);
      if (role === 'run') run++; else if (role === 'hold') hold++; else trap++;
    }
    return { run, hold, trap, inZone };
  }

  // Called every frame while an avalanche covers the lane. Any truck that drives
  // into the EXIT CORRIDOR (the snow's zone, between the bay and the tunnel) is
  // DESTROYED: it vanishes, loses the gold/silver it was carrying, and a costly
  // replacement rig is dispatched from the back of the queue. If the convoy was
  // HELD the drivers took cover and nothing is lost.
  // Returns { count, replaceCost, lostLoad }.
  // Only trucks caught MOVING in the zone are buried — a truck that's stopped
  // (held, or frozen by escape-mode triage) took cover and is handled by
  // dentHeldInZone instead.
  function crushInZone() {
    let count = 0, replaceCost = 0, lostLoad = 0;
    let maxX = -Infinity;
    for (const tr of trucks) if (tr.x > maxX) maxX = tr.x;
    for (const tr of trucks) {
      if (tr.x < AVALANCHE_ZONE_MIN || tr.x > AVALANCHE_ZONE_MAX) continue; // clear of the snow
      if (!tr.moving) continue; // stopped in the zone -> dig-out dent, not a burial
      // tally the loss: cargo it was hauling + a capacity-scaled replacement cost
      lostLoad += tr.silver * BRICK.silverValue + tr.gold * BRICK.goldValue;
      replaceCost += Math.round(AVALANCHE.replaceLoadMultiple * capacity * EXP_PER_BRICK);
      count++;
      // the rig is gone — a replacement enters way back at the gate (drives in
      // fresh, so it can't re-die in this same avalanche)
      resetLoad(tr);
      maxX = Math.max(maxX + GAP, ENTRANCE + 6);
      tr.x = maxX;
      tr.moving = false;
      tr.settled = false;
      tr.reactT = REACTION_TIME;
      tr.group.position.set(tr.x, 0.04, Z);
    }
    return { count, replaceCost, lostLoad };
  }

  // Called once when the snow lands. Trucks that were HELD (stopped) but happened
  // to be frozen inside the snow zone aren't destroyed — but they take a
  // dig-out/repair hit (a fraction of a replacement). They keep their cargo and
  // position. Returns { count, cost }.
  function dentHeldInZone() {
    let count = 0, cost = 0;
    for (const tr of trucks) {
      if (tr.x < AVALANCHE_ZONE_MIN || tr.x > AVALANCHE_ZONE_MAX) continue;
      if (tr.moving) continue; // a truck still rolling gets buried (crushInZone), not dented
      cost += Math.round(AVALANCHE.replaceLoadMultiple * capacity * EXP_PER_BRICK * AVALANCHE.dentCostFraction);
      count++;
    }
    return { count, cost };
  }

  function onDeliver(cb) {
    deliverCb = cb;
  }

  // Add one brick to a loading truck: roll silver/gold, tally it, fly it in.
  function loadOneBrick(tr) {
    const isGold = Math.random() < BRICK.goldChance;
    tr.bricks += 1;
    if (isGold) tr.gold += 1;
    else tr.silver += 1;
    const m = new THREE.Mesh(cargoGeo, isGold ? goldMat : silverMat);
    m.castShadow = true;
    scene.add(m);
    const bedTop = tr.group.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    transfers.push({ mesh: m, from: loadSource.clone(), to: bedTop, p: 0, gold: isGold });
  }

  function update(dt) {
    // Avalanche hold, 'all' mode: freeze the whole convoy in place (and stop
    // loading) until it passes. Commit positions, keep flying bricks animating,
    // then bail. 'escape' mode falls through and is handled per-truck below.
    if (holdMode === 'all') {
      // Drivers take cover: everyone stops dead. Marking them not-moving means a
      // truck frozen in the zone takes the dig-out dent, not a full burial.
      for (const tr of trucks) { tr.moving = false; tr.group.position.set(tr.x, 0.04, Z); }
      if (sfx) sfx.engine(trucks.length ? 0.15 : 0); // engines idle while held
      updateTransfers(dt);
      return;
    }

    const step = speed * dt;
    // 'escape' mode: trucks close enough to the tunnel make a run for it, trucks
    // behind the zone wait at the stop line, trucks trapped in the zone freeze.
    const escaping = holdMode === 'escape';
    const commitX = escaping ? commitLine() : 0;
    const escapeStep = speed * ESCAPE_BOOST * dt;

    // Advance every truck toward the exit (-X), keeping a gap behind the truck
    // ahead, and forbidding empty trucks from passing the bay until loaded.
    // A stopped truck waits a short reaction beat before pulling away, so the
    // line moves one truck at a time (stop-and-go), not all at once.
    const order = trucks.slice().sort((a, b) => a.x - b.x); // front (min x) first
    for (let i = 0; i < order.length; i++) {
      const tr = order[i];
      const wasMoving = tr.moving; // detect pull-away / stop transitions for SFX
      const ahead = i > 0 ? order[i - 1] : null;
      const aheadLimit = ahead ? ahead.x + GAP : -Infinity;
      const bayLimit = tr.loaded ? -Infinity : BAY_X; // empties stop at the bay
      // a bear on the lane blocks any truck behind it (higher x) — stop short
      const obstacleLimit = obstacleX !== null && tr.x > obstacleX ? obstacleX + OBSTACLE_GAP : -Infinity;

      // Escape-mode constraints: a runner gets a speed boost and bolts (no
      // reaction beat); a holder stops at the stop line; a trapped truck freezes.
      let role = null;
      let avLimit = -Infinity;
      let stepThis = step;
      if (escaping) {
        role = escapeRole(tr, commitX);
        if (role === 'run') { stepThis = escapeStep; tr.moving = true; } // floor it
        else if (role === 'hold') avLimit = STOP_LINE; // wait clear of the snow
        else avLimit = tr.x; // trapped — hold position and eat the dig-out dent
      }

      const minX = Math.max(aheadLimit, bayLimit, obstacleLimit, avLimit);
      const room = tr.x - minX; // forward room (moving = decreasing x)
      if (room > 0.03) {
        tr.settled = false; // still has somewhere to go — not parked at a bay
        if (!tr.moving) {
          tr.reactT -= dt; // was stopped — wait a beat before pulling away
          if (tr.reactT <= 0) tr.moving = true;
        }
        if (tr.moving) tr.x = Math.max(tr.x - stepThis, minX);
      } else {
        tr.settled = true; // parked at its slot — only now may it load
        tr.moving = false; // reached its spot / blocked — stop and re-arm the beat
        tr.reactT = REACTION_TIME;
      }
      if (sfx) {
        if (tr.moving && !wasMoving) sfx.truckAccel(); // pulling away
        else if (!tr.moving && wasMoving) sfx.truckBrake(); // braking to a stop
      }
    }

    // Parallel loading: every empty truck sitting in the bay zone (the front
    // `bays` queue positions) loads at the same time. With N bays the front N
    // trucks fill simultaneously, then exit in order — N× the throughput.
    const bayZoneMax = BAY_X + (bays - 1) * GAP + 0.06;
    for (const t of trucks) {
      // must be an empty truck PARKED (settled) at a bay slot — not still rolling
      // in — and loading must not be paused (e.g. a bear is mauling the dock)
      if (!loadingEnabled || t.loaded || t.x > bayZoneMax || !t.settled) continue;
      t.progress += loadRate() * dt;
      while (t.bricks < Math.min(capacity, Math.floor(t.progress))) {
        loadOneBrick(t);
      }
      applyFill(t);
      if (t.progress >= capacity) {
        // Full — drive off and earn the load's value (gold pays far more).
        t.loaded = true;
        const payout = t.silver * BRICK.silverValue + t.gold * BRICK.goldValue;
        if (deliverCb) deliverCb(payout);
      }
    }

    // Recycle trucks that have driven off the exit to the back of the queue, and
    // commit positions to the meshes.
    let maxX = -Infinity;
    for (const tr of trucks) if (tr.x > maxX) maxX = tr.x;
    for (const tr of trucks) {
      if (tr.x <= EXIT) {
        tr.x = Math.max(ENTRANCE, maxX + GAP); // reappear at the back, drive in
        maxX = tr.x;
        resetLoad(tr);
      }
      tr.group.position.set(tr.x, 0.04, Z);
    }

    // Engine bed: louder/revvier the more of the convoy is rolling.
    if (sfx) {
      let movingCount = 0;
      for (const tr of trucks) if (tr.moving) movingCount++;
      sfx.engine(trucks.length ? Math.min(1, 0.18 + movingCount * 0.27) : 0);
    }

    updateTransfers(dt);
  }

  // Fly loading bricks from the pile into the bed along a little arc.
  function updateTransfers(dt) {
    for (let i = transfers.length - 1; i >= 0; i--) {
      const f = transfers[i];
      f.p += dt / TRANSFER_TIME;
      if (f.p >= 1) {
        scene.remove(f.mesh);
        transfers.splice(i, 1);
        if (sfx) sfx.clink(f.gold); // metal-on-metal as the bar lands in the bed
        continue;
      }
      f.mesh.position.lerpVectors(f.from, f.to, f.p);
      f.mesh.position.y += Math.sin(f.p * Math.PI) * 1.4; // arc lift
      f.mesh.rotation.x += dt * 6;
      f.mesh.rotation.y += dt * 5;
    }
  }

  // x positions of trucks currently STOPPED (settled at a slot) — the loaders
  // only drive in to a truck that has actually pulled up and stopped.
  function settledTruckXs() {
    const xs = [];
    for (const t of trucks) if (t.settled) xs.push(t.x);
    return xs;
  }

  return { setTruckCount, setSpeedLevel, setCapacityLevel, setBaysLevel, setLoadingEnabled, setObstacleX, setHold, escapeTriage, settledTruckXs, crushInZone, dentHeldInZone, onDeliver, update };
}

// Standalone truck model for decorative parked trucks (same shape as the haul
// trucks). Front (cab/nose) points along +local X; the caller orients it.
export function buildParkedTruck() {
  return buildTruckMesh().group;
}

// ---- Shared Freightliner M2 106 dump-truck model -------------------------
// A conventional-cab dump truck: orange cab + sloped hood, a chrome grille with
// round dual headlights and a heavy chrome bumper, an orange ribbed dump bed
// with a cab-protector and a top rail that slopes down to the tailgate, on a
// black frame with a single front axle and rear tandem duals. Built with the
// cab/nose at +local X. Returns { group, bed, bedL, innerW, wt, floorTopY } so
// the caller can drop the load-fill into the bed. PBR materials pick up the
// scene environment (chrome reflects, paint has a faint sheen).
const TM = {
  paint: new THREE.MeshStandardMaterial({ color: COLORS.truckBed, roughness: 0.45, metalness: 0.12 }),
  paintDark: new THREE.MeshStandardMaterial({ color: 0xc25e10, roughness: 0.5, metalness: 0.1 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd7dce2, roughness: 0.16, metalness: 1.0 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x23242a, roughness: 0.6, metalness: 0.5 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x2a3f4d, roughness: 0.12, metalness: 0.3 }),
  grilleDark: new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.55, metalness: 0.7 }),
  lens: new THREE.MeshStandardMaterial({ color: 0xfff3cf, roughness: 0.2, metalness: 0.1 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.85, metalness: 0.0 }),
};

function makeWheel(g, x, W, dual) {
  const tireGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, dual ? 0.6 : 0.36, 16);
  tireGeo.rotateX(Math.PI / 2); // axle along Z (truck rolls along X)
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12);
  hubGeo.rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    const outer = dual ? W * 0.5 : W * 0.48;
    const tire = new THREE.Mesh(tireGeo, TM.tire);
    tire.position.set(x, WHEEL_R, s * outer);
    tire.castShadow = true;
    g.add(tire);
    const hub = new THREE.Mesh(hubGeo, TM.chrome);
    hub.position.set(x, WHEEL_R, s * (outer + (dual ? 0.32 : 0.2)));
    g.add(hub);
  }
}

function buildTruckMesh() {
  const g = new THREE.Group();
  const L = TRUCK.size.x, W = TRUCK.size.z, CT = CHASSIS_TOP;

  // ---- Frame + fuel tanks ----
  const frame = box(L * 1.04, 0.26, W * 0.64, TM.frame);
  frame.position.set(0, CT - 0.18, 0);
  g.add(frame);
  for (const s of [-1, 1]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 1.0, 14), TM.chrome);
    tank.rotation.z = Math.PI / 2; // lie along X
    tank.position.set(L * 0.04, CT - 0.34, s * W * 0.42);
    g.add(tank);
  }

  // ---- Cab (orange, conventional) ----
  const cabX = L * 0.18;
  const cab = box(L * 0.3, 1.4, W * 0.98, TM.paint);
  cab.position.set(cabX, CT + 0.72, 0);
  g.add(cab);
  const wsX = cabX + L * 0.15 - 0.02;
  for (const s of [-1, 1]) {
    const ws = box(0.1, 0.62, W * 0.4, TM.glass); // two raked windshield panes
    ws.position.set(wsX, CT + 1.0, s * W * 0.22);
    ws.rotation.z = 0.12;
    g.add(ws);
    const sw = box(L * 0.2, 0.46, 0.05, TM.glass); // side window
    sw.position.set(cabX + 0.05, CT + 1.0, s * (W * 0.49));
    g.add(sw);
    const arm = box(0.05, 0.05, 0.42, TM.frame); // mirror arm + mirror
    arm.position.set(cabX + L * 0.13, CT + 1.16, s * (W * 0.56));
    g.add(arm);
    const mir = box(0.07, 0.5, 0.16, TM.frame);
    mir.position.set(cabX + L * 0.16, CT + 1.0, s * (W * 0.64));
    g.add(mir);
  }
  const visor = box(L * 0.12, 0.06, W * 0.94, TM.paint); // sun visor over the screen
  visor.position.set(wsX - 0.04, CT + 1.4, 0);
  visor.rotation.z = 0.12;
  g.add(visor);

  // ---- Hood (sloped) + chrome grille + round headlights + bumper ----
  const hoodX = L * 0.42;
  const hood = box(L * 0.26, 0.92, W * 0.9, TM.paint);
  hood.position.set(hoodX, CT + 0.48, 0);
  g.add(hood);
  const hoodTop = box(L * 0.28, 0.08, W * 0.9, TM.paint); // hint of a sloped top
  hoodTop.position.set(hoodX + 0.02, CT + 0.92, 0);
  hoodTop.rotation.z = 0.13;
  g.add(hoodTop);

  const noseX = L * 0.57;
  const surround = box(0.14, 0.78, W * 0.6, TM.chrome);
  surround.position.set(noseX, CT + 0.5, 0);
  g.add(surround);
  const mesh = box(0.08, 0.64, W * 0.48, TM.grilleDark);
  mesh.position.set(noseX + 0.05, CT + 0.5, 0);
  g.add(mesh);
  for (let i = 0; i < 5; i++) {
    const slat = box(0.1, 0.035, W * 0.48, TM.chrome);
    slat.position.set(noseX + 0.07, CT + 0.26 + i * 0.13, 0);
    g.add(slat);
  }
  const badge = box(0.05, 0.13, 0.13, TM.chrome); // Freightliner badge
  badge.position.set(noseX + 0.08, CT + 0.84, 0);
  g.add(badge);
  for (const s of [-1, 1]) {
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 16), TM.chrome);
    bezel.rotation.z = Math.PI / 2;
    bezel.position.set(noseX + 0.02, CT + 0.4, s * W * 0.4);
    g.add(bezel);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 16), TM.lens);
    lens.rotation.z = Math.PI / 2;
    lens.position.set(noseX + 0.1, CT + 0.4, s * W * 0.4);
    g.add(lens);
  }
  const bumper = box(0.38, 0.4, W * 1.04, TM.chrome);
  bumper.position.set(noseX + 0.12, CT - 0.06, 0);
  g.add(bumper);

  // ---- Dump bed (orange, ribbed, sloped top rail, cab protector) ----
  const bed = new THREE.Group();
  const bedL = L * 0.66;
  const innerW = W * 0.92;
  const wt = 0.1;
  const hFront = 1.2, hRear = 0.8; // top rail slopes down toward the tailgate
  const floorTopY = 0.12;
  bed.add(place(box(bedL, 0.12, innerW + 2 * wt, TM.paint), 0, 0.06, 0)); // floor
  const shape = new THREE.Shape();
  shape.moveTo(-bedL / 2, 0);
  shape.lineTo(bedL / 2, 0);
  shape.lineTo(bedL / 2, hFront);
  shape.lineTo(-bedL / 2, hRear);
  shape.closePath();
  const sideGeo = new THREE.ExtrudeGeometry(shape, { depth: wt, bevelEnabled: false });
  sideGeo.translate(0, 0, -wt / 2);
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(sideGeo, TM.paint);
    wall.position.set(0, floorTopY, s * (innerW / 2 + wt / 2));
    bed.add(wall);
    const ribs = 5;
    for (let i = 0; i < ribs; i++) {
      const rx = -bedL / 2 + 0.32 + (i / (ribs - 1)) * (bedL - 0.64);
      const hh = hRear + ((rx + bedL / 2) / bedL) * (hFront - hRear); // follow the slope
      const rib = box(0.07, hh, 0.06, TM.paintDark);
      rib.position.set(rx, floorTopY + hh / 2, s * (innerW / 2 + wt));
      bed.add(rib);
    }
  }
  bed.add(place(box(wt, hFront, innerW, TM.paint), bedL / 2 - wt / 2, floorTopY + hFront / 2, 0)); // headboard
  bed.add(place(box(wt, hRear, innerW, TM.paintDark), -bedL / 2 + wt / 2, floorTopY + hRear / 2, 0)); // tailgate
  bed.add(place(box(L * 0.22, 0.08, innerW + 2 * wt, TM.paint), bedL / 2 + L * 0.08, floorTopY + hFront, 0)); // cab protector
  bed.position.set(-L * 0.18, CT, 0);
  g.add(bed);

  // ---- Wheels: single front axle, rear tandem duals ----
  makeWheel(g, L * 0.4, W, false);
  makeWheel(g, -L * 0.15, W, true);
  makeWheel(g, -L * 0.4, W, true);

  setShadows(g);
  return { group: g, bed, bedL, innerW, wt, floorTopY };
}

// --- small geometry helpers ---
function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}
function place(mesh, x, y, z) {
  mesh.position.set(x, y, z);
  return mesh;
}
function setShadows(group) {
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
}
function disposeGroup(group) {
  group.traverse((o) => {
    if (o.isMesh) o.geometry.dispose();
  });
}
