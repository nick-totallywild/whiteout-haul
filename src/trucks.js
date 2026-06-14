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

export function createFleet(scene) {
  const loadSource = new THREE.Vector3(LAYOUT.pilePos.x, 2.6, LAYOUT.pilePos.z);

  // Shared materials.
  const bedMat = new THREE.MeshLambertMaterial({ color: COLORS.truckBed, flatShading: true });
  const cabMat = new THREE.MeshLambertMaterial({ color: COLORS.truckCab, flatShading: true });
  const wheelMat = new THREE.MeshLambertMaterial({ color: COLORS.truckWheel, flatShading: true });
  const chassisMat = new THREE.MeshLambertMaterial({ color: 0x33343c, flatShading: true });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x3f6b86, flatShading: true });
  const bumperMat = new THREE.MeshLambertMaterial({ color: 0x9aa1ab, flatShading: true });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffe9a8, flatShading: true });
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
  let held = false; // avalanche: convoy frozen so the snow doesn't bury moving trucks
  let deliverCb = null;
  const OBSTACLE_GAP = 3.4; // how far a truck stops short of a blocking bear

  function loadRate() {
    const effLoadTime = TRUCK.loadTime / (1 + speedLevel * 0.2);
    return capacity / effLoadTime; // ~constant fill time regardless of capacity
  }

  // --- Truck mesh: long dark chassis, white cab, tall orange dump bed --------
  function buildTruck() {
    const g = new THREE.Group();
    const L = TRUCK.size.x;
    const W = TRUCK.size.z;

    const chassis = box(L * 1.02, 0.28, W * 0.78, chassisMat);
    chassis.position.set(0.06, CHASSIS_TOP - 0.14, 0);
    chassis.castShadow = true;
    g.add(chassis);

    // Front: white cab with windows, a lower hood (engine) ahead of it, then a
    // grille, bumper and headlights so the nose reads as a proper dump truck.
    const cab = box(L * 0.25, 1.35, W * 0.96, cabMat);
    cab.position.set(L * 0.28, CHASSIS_TOP + 0.68, 0);
    cab.castShadow = true;
    g.add(cab);

    const hood = box(L * 0.24, 0.72, W * 0.9, cabMat);
    hood.position.set(L * 0.49, CHASSIS_TOP + 0.36, 0);
    hood.castShadow = true;
    g.add(hood);

    // windshield (front) + a side window on each side of the cab
    const windshield = box(0.12, 0.6, W * 0.82, glassMat);
    windshield.position.set(L * 0.28 + L * 0.115, CHASSIS_TOP + 0.92, 0);
    g.add(windshield);
    for (const s of [-1, 1]) {
      const win = box(L * 0.15, 0.5, 0.06, glassMat);
      win.position.set(L * 0.27, CHASSIS_TOP + 0.9, s * (W * 0.49));
      g.add(win);
    }

    // grille + bumper + headlights at the nose
    const grille = box(0.16, 0.6, W * 0.78, chassisMat);
    grille.position.set(L * 0.61, CHASSIS_TOP + 0.36, 0);
    g.add(grille);
    const bumper = box(0.34, 0.32, W * 1.0, bumperMat);
    bumper.position.set(L * 0.62, CHASSIS_TOP + 0.02, 0);
    bumper.castShadow = true;
    g.add(bumper);
    for (const s of [-1, 1]) {
      const light = box(0.12, 0.18, 0.3, headMat);
      light.position.set(L * 0.62, CHASSIS_TOP + 0.5, s * (W * 0.3));
      g.add(light);
    }

    const bed = new THREE.Group();
    const bedL = L * 0.62;
    const wallH = 1.0;
    const wt = 0.14;
    bed.add(place(box(bedL, wt, W * 0.94, bedMat), 0, wt / 2, 0));
    bed.add(place(box(wt, wallH, W * 0.94, bedMat), -bedL / 2 + wt / 2, wallH / 2, 0));
    bed.add(place(box(wt, wallH, W * 0.94, bedMat), bedL / 2 - wt / 2, wallH / 2, 0));
    bed.add(place(box(bedL, wallH, wt, bedMat), 0, wallH / 2, -W * 0.47 + wt / 2));
    bed.add(place(box(bedL, wallH, wt, bedMat), 0, wallH / 2, W * 0.47 - wt / 2));
    bed.position.set(-L * 0.16, CHASSIS_TOP, 0);
    setShadows(bed);
    g.add(bed);

    const fill = box(bedL - wt * 2.5, BED_FILL_BASE_H, W * 0.94 - wt * 2.5, silverMat);
    fill.position.y = wt + BED_FILL_BASE_H / 2;
    bed.add(fill);

    const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.42, 12);
    wheelGeo.rotateX(Math.PI / 2);
    const wz = W * 0.45;
    for (const x of [L * 0.36, -L * 0.12, -L * 0.36]) {
      for (const z of [-wz, wz]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(x, WHEEL_R, z);
        w.castShadow = true;
        g.add(w);
      }
    }
    // Trucks drive along -X, so the cab (+local X) faces the drive direction.
    g.rotation.y = Math.PI;
    return { group: g, fill };
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

  // Freeze the whole convoy (avalanche): trucks stop dead, drivers take cover.
  function setHold(on) {
    held = !!on;
  }

  // Called every frame while an avalanche covers the lane. Any truck that drives
  // into the EXIT CORRIDOR (the snow's zone, between the bay and the tunnel) is
  // DESTROYED: it vanishes, loses the gold/silver it was carrying, and a costly
  // replacement rig is dispatched from the back of the queue. If the convoy was
  // HELD the drivers took cover and nothing is lost.
  // Returns { count, replaceCost, lostLoad }.
  function crushInZone() {
    if (held) return { count: 0, replaceCost: 0, lostLoad: 0 };
    let count = 0, replaceCost = 0, lostLoad = 0;
    let maxX = -Infinity;
    for (const tr of trucks) if (tr.x > maxX) maxX = tr.x;
    for (const tr of trucks) {
      if (tr.x < AVALANCHE_ZONE_MIN || tr.x > AVALANCHE_ZONE_MAX) continue; // clear of the snow
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
    if (!held) return { count: 0, cost: 0 }; // moving trucks are handled by crushInZone
    let count = 0, cost = 0;
    for (const tr of trucks) {
      if (tr.x < AVALANCHE_ZONE_MIN || tr.x > AVALANCHE_ZONE_MAX) continue;
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
    transfers.push({ mesh: m, from: loadSource.clone(), to: bedTop, p: 0 });
  }

  function update(dt) {
    // Avalanche hold: the convoy is frozen in place (and not loading) until it
    // passes. Commit current positions + keep flying bricks animating, then bail.
    if (held) {
      for (const tr of trucks) tr.group.position.set(tr.x, 0.04, Z);
      updateTransfers(dt);
      return;
    }

    const step = speed * dt;

    // Advance every truck toward the exit (-X), keeping a gap behind the truck
    // ahead, and forbidding empty trucks from passing the bay until loaded.
    // A stopped truck waits a short reaction beat before pulling away, so the
    // line moves one truck at a time (stop-and-go), not all at once.
    const order = trucks.slice().sort((a, b) => a.x - b.x); // front (min x) first
    for (let i = 0; i < order.length; i++) {
      const tr = order[i];
      const ahead = i > 0 ? order[i - 1] : null;
      const aheadLimit = ahead ? ahead.x + GAP : -Infinity;
      const bayLimit = tr.loaded ? -Infinity : BAY_X; // empties stop at the bay
      // a bear on the lane blocks any truck behind it (higher x) — stop short
      const obstacleLimit = obstacleX !== null && tr.x > obstacleX ? obstacleX + OBSTACLE_GAP : -Infinity;
      const minX = Math.max(aheadLimit, bayLimit, obstacleLimit);
      const room = tr.x - minX; // forward room (moving = decreasing x)
      if (room > 0.03) {
        tr.settled = false; // still has somewhere to go — not parked at a bay
        if (!tr.moving) {
          tr.reactT -= dt; // was stopped — wait a beat before pulling away
          if (tr.reactT <= 0) tr.moving = true;
        }
        if (tr.moving) tr.x = Math.max(tr.x - step, minX);
      } else {
        tr.settled = true; // parked at its slot — only now may it load
        tr.moving = false; // reached its spot / blocked — stop and re-arm the beat
        tr.reactT = REACTION_TIME;
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
        continue;
      }
      f.mesh.position.lerpVectors(f.from, f.to, f.p);
      f.mesh.position.y += Math.sin(f.p * Math.PI) * 1.4; // arc lift
      f.mesh.rotation.x += dt * 6;
      f.mesh.rotation.y += dt * 5;
    }
  }

  return { setTruckCount, setSpeedLevel, setCapacityLevel, setBaysLevel, setLoadingEnabled, setObstacleX, setHold, crushInZone, dentHeldInZone, onDeliver, update };
}

// Standalone truck model for decorative parked trucks (same shape as the haul
// trucks). Front (cab/nose) points along +local X; the caller orients it.
export function buildParkedTruck() {
  const bedMat = new THREE.MeshLambertMaterial({ color: COLORS.truckBed, flatShading: true });
  const cabMat = new THREE.MeshLambertMaterial({ color: COLORS.truckCab, flatShading: true });
  const wheelMat = new THREE.MeshLambertMaterial({ color: COLORS.truckWheel, flatShading: true });
  const chassisMat = new THREE.MeshLambertMaterial({ color: 0x33343c, flatShading: true });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x3f6b86, flatShading: true });
  const bumperMat = new THREE.MeshLambertMaterial({ color: 0x9aa1ab, flatShading: true });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffe9a8, flatShading: true });

  const g = new THREE.Group();
  const L = TRUCK.size.x;
  const W = TRUCK.size.z;

  const chassis = box(L * 1.02, 0.28, W * 0.78, chassisMat);
  chassis.position.set(0.06, CHASSIS_TOP - 0.14, 0);
  chassis.castShadow = true;
  g.add(chassis);

  const cab = box(L * 0.25, 1.35, W * 0.96, cabMat);
  cab.position.set(L * 0.28, CHASSIS_TOP + 0.68, 0);
  cab.castShadow = true;
  g.add(cab);
  const hood = box(L * 0.24, 0.72, W * 0.9, cabMat);
  hood.position.set(L * 0.49, CHASSIS_TOP + 0.36, 0);
  hood.castShadow = true;
  g.add(hood);
  const windshield = box(0.12, 0.6, W * 0.82, glassMat);
  windshield.position.set(L * 0.28 + L * 0.115, CHASSIS_TOP + 0.92, 0);
  g.add(windshield);
  for (const s of [-1, 1]) {
    const win = box(L * 0.15, 0.5, 0.06, glassMat);
    win.position.set(L * 0.27, CHASSIS_TOP + 0.9, s * (W * 0.49));
    g.add(win);
  }
  const grille = box(0.16, 0.6, W * 0.78, chassisMat);
  grille.position.set(L * 0.61, CHASSIS_TOP + 0.36, 0);
  g.add(grille);
  const bumper = box(0.34, 0.32, W * 1.0, bumperMat);
  bumper.position.set(L * 0.62, CHASSIS_TOP + 0.02, 0);
  bumper.castShadow = true;
  g.add(bumper);
  for (const s of [-1, 1]) {
    const light = box(0.12, 0.18, 0.3, headMat);
    light.position.set(L * 0.62, CHASSIS_TOP + 0.5, s * (W * 0.3));
    g.add(light);
  }

  const bed = new THREE.Group();
  const bedL = L * 0.62;
  const wallH = 1.0;
  const wt = 0.14;
  bed.add(place(box(bedL, wt, W * 0.94, bedMat), 0, wt / 2, 0));
  bed.add(place(box(wt, wallH, W * 0.94, bedMat), -bedL / 2 + wt / 2, wallH / 2, 0));
  bed.add(place(box(wt, wallH, W * 0.94, bedMat), bedL / 2 - wt / 2, wallH / 2, 0));
  bed.add(place(box(bedL, wallH, wt, bedMat), 0, wallH / 2, -W * 0.47 + wt / 2));
  bed.add(place(box(bedL, wallH, wt, bedMat), 0, wallH / 2, W * 0.47 - wt / 2));
  bed.position.set(-L * 0.16, CHASSIS_TOP, 0);
  setShadows(bed);
  g.add(bed);

  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.42, 12);
  wheelGeo.rotateX(Math.PI / 2);
  const wz = W * 0.45;
  for (const x of [L * 0.36, -L * 0.12, -L * 0.36]) {
    for (const z of [-wz, wz]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(x, WHEEL_R, z);
      w.castShadow = true;
      g.add(w);
    }
  }
  return g;
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
