// bears.js — the "bear raid" challenge. Bears wander in from the treeline and
// claw at the perimeter FENCE, trying to break in. Their clawing drains the
// fence's health; if it hits zero the dock is overrun and LOADING PAUSES until
// the fence is repaired. Defenses: Barbed Wire (tougher fence), Gun Towers (Santa
// gunners that shoot bears off the wire), and paid Fence Repairs.

import * as THREE from 'three';
import { BEARS, LAYOUT, GUARDS } from './config.js';

const V = (x, z) => new THREE.Vector3(x, 0, z);
const LANE_Z = LAYOUT.lane.z; // trucks drive along this z
const DOCK = V(LAYOUT.lane.bayX, LAYOUT.lane.z); // bay/Santa area the bears storm

// Towers swivel to face this point when idle (the heart of the dock).
const SITE_CENTER = V(3, -7);
// Gun towers sit just inside the fence, clear of the conveyor's source mountain
// (back-left) and the truck lane (z ≈ -7). Three corners cover the site; the
// fourth (west, mid-lane) was dropped because it blocked the trucks' exit path.
const TOWER_SPOTS = [V(-30, 11), V(36, 11), V(36, -26)];
// Bears appear from the treeline on the FRONT, RIGHT and LEFT-FRONT — all in
// clear view of the camera (the back fence is hidden behind the source
// mountain). They still converge from different directions, but the breaking
// always happens on-screen.
const SPAWN_SPOTS = [V(8, 36), V(24, 34), V(40, 32), V(-12, 34), V(-30, 30), V(54, 16), V(-46, 4)];

const SEG_BASE_HP = 50; // per-segment fence (chain-link panel) health
const CLAW_DPS = 9; // damage/sec a bear deals to fence or wire it is clawing
const CLAW_TIME = 22; // max seconds a bear claws before giving up
const REPAIR_COST_PER_HP = 4.5; // remote-site premium: materials are expensive up here
// Barbed wire: a concertina coil installed IN FRONT of a fence segment. Bears
// must chew through the coil first (getting shredded as they do) before they can
// reach the chain-link. The coil itself takes damage and needs occasional repair.
const WIRE_MAX_HP = 40; // coil health (~4.4s of clawing to shred away)
const WIRE_DPS = 1.3; // hp/sec the barbs tear off a bear caught chewing the coil
// fence panel tint: pristine steel -> battered brown as it takes damage
const COLOR_FULL = new THREE.Color(0xdfe6ee);
const COLOR_DMG = new THREE.Color(0x6b5644);

export function createBears(scene, sfx, fenceSegments = [], guards = []) {
  const group = new THREE.Group();
  scene.add(group);

  const towers = TOWER_SPOTS.map((spot) => {
    const t = buildTower(spot);
    t.group.visible = false;
    group.add(t.group);
    return t;
  });
  const fireTimers = towers.map(() => 0);

  const bearMats = bearAssets();
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffec99, fog: false });

  // Destructible fence: each scene segment carries its own HP + damage visuals,
  // plus an optional barbed-wire coil (installed by the Barbed Wire upgrade).
  const fence = fenceSegments.map((seg) => {
    const f = {
      seg,
      pos: V(seg.mid.x, seg.mid.z), // ground position of this stretch
      hp: SEG_BASE_HP,
      maxHp: SEG_BASE_HP,
      wire: false, // is a coil installed here?
      wireHp: 0,
      wireMax: WIRE_MAX_HP,
    };
    f.coil = buildCoil(f); // concertina coil sitting just outside the fence
    f.coil.visible = false;
    group.add(f.coil);
    return f;
  });

  const bears = []; // { group, pos, target, seg, hp, state:'approach'|'claw', clawT, phase }
  const tracers = [];
  let towerCount = 0;
  let fenceLevel = 0;
  let spawnTimer = BEARS.baseSpawnInterval * 0.6;
  let guardInjuryCount = 0; // accrues when a bear mauls a guard (polled by main.js)

  function setTowerCount(n) {
    towerCount = n;
    towers.forEach((t, i) => (t.group.visible = i < n));
  }
  // The Barbed Wire upgrade installs `n` coils, placed on the fence stretches
  // FARTHEST from a gun tower — i.e. the gaps gunfire can't reach.
  function setFenceLevel(n) {
    fenceLevel = n;
    placeWire(n);
  }

  // Default desirability of a stretch for wire: far from gun towers (a gap
  // gunfire can't reach) and toward the visible front where bears attack.
  function scoreSeg(f) {
    let d = Infinity;
    for (const s of TOWER_SPOTS) d = Math.min(d, f.pos.distanceTo(s));
    return d + f.pos.z * 0.8;
  }

  // Ensure exactly `n` coils are installed. Adding spends onto the best EMPTY
  // stretches; removing pulls the least-useful — but existing coils are left in
  // place, so the player's manual arrangement (drag-to-move) is preserved.
  function placeWire(n) {
    const current = fence.filter((f) => f.wire).length;
    if (n > current) {
      const empties = fence.filter((f) => !f.wire).sort((a, b) => scoreSeg(b) - scoreSeg(a));
      for (let i = 0; i < n - current && i < empties.length; i++) setSegWire(empties[i], true);
    } else if (n < current) {
      const installed = fence.filter((f) => f.wire).sort((a, b) => scoreSeg(a) - scoreSeg(b));
      for (let i = 0; i < current - n && i < installed.length; i++) setSegWire(installed[i], false);
    }
  }

  function setSegWire(f, wired) {
    if (wired && !f.wire) f.wireHp = f.wireMax; // freshly installed coil is intact
    if (!wired) f.wireHp = 0;
    f.wire = wired;
    applyWire(f);
  }

  // --- "Move wire" mode: drag coils between fence stretches -----------------
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let editing = false;
  let selected = null; // the coil-segment currently picked up

  function setCoilGlow(f, hex, lift) {
    if (!f.coil.userData.mat) return;
    f.coil.userData.mat.emissive.setHex(hex);
    f.coil.position.y = lift;
  }
  function refreshGlow() {
    for (const f of fence) {
      if (!f.wire) continue;
      if (f === selected) setCoilGlow(f, 0xffcc33, 0.7); // picked up
      else setCoilGlow(f, editing ? 0x3a3a16 : 0x000000, 0); // movable hint / off
    }
  }
  function beginWireEdit() { editing = true; selected = null; refreshGlow(); }
  function endWireEdit() { editing = false; selected = null; refreshGlow(); }

  // ndc: {x,y} in [-1,1]. Returns a status code for the UI.
  function wireClick(ndc, camera) {
    raycaster.setFromCamera(ndc, camera);
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, pt)) return 'none';
    let near = null, nd = Infinity;
    for (const f of fence) {
      const d = f.pos.distanceToSquared(pt);
      if (d < nd) { nd = d; near = f; }
    }
    if (!near || Math.sqrt(nd) > 13) { selected = null; refreshGlow(); return 'deselect'; }

    if (!selected) {
      if (!near.wire) return 'empty'; // nothing to pick up there
      selected = near; refreshGlow(); return 'picked';
    }
    if (near === selected) { selected = null; refreshGlow(); return 'cancel'; }
    if (near.wire) return 'occupied'; // a coil is already there
    // relocate, carrying the coil's current (possibly damaged) condition
    const hp = selected.wireHp;
    setSegWire(selected, false);
    setSegWire(near, true);
    near.wireHp = hp; applyWire(near);
    selected = null; refreshGlow(); return 'moved';
  }

  // Coil look: flattens/shrinks as the barbs are torn off; vanishes when shredded.
  function applyWire(f) {
    if (!f.wire || f.wireHp <= 0) {
      f.coil.visible = false;
      return;
    }
    f.coil.visible = true;
    const r = f.wireMax > 0 ? f.wireHp / f.wireMax : 0;
    f.coil.scale.set(1, 0.35 + 0.65 * r, 1);
  }

  // Update a segment's look from its HP: it sags/shrinks (bottom stays planted)
  // and tints from steel to battered brown; at 0 it collapses to a stub, leaving
  // a visible gap in the wire.
  function applyDamage(f) {
    const { panel, rail, height } = f.seg;
    const r = Math.max(0, f.hp / f.maxHp);
    if (r <= 0) {
      panel.scale.y = 0.12;
      panel.position.y = (height / 2) * 0.12;
      panel.material.color.copy(COLOR_DMG);
      rail.visible = false;
    } else {
      const sy = 0.32 + 0.68 * r;
      panel.scale.y = sy;
      panel.position.y = (height / 2) * sy;
      panel.material.color.copy(COLOR_FULL).lerp(COLOR_DMG, 1 - r);
      rail.visible = true;
      rail.position.y = height * sy - 0.1;
    }
  }

  // Nearest fence segment to a point — prefer intact wire to claw, but if every
  // nearby panel is already down, head for the closest gap instead.
  function nearestSegment(pos) {
    let best = null, bestD = Infinity, gap = null, gapD = Infinity;
    for (const f of fence) {
      const d = pos.distanceToSquared(f.pos);
      if (f.hp > 0) {
        if (d < bestD) { bestD = d; best = f; }
      } else if (d < gapD) {
        gapD = d; gap = f;
      }
    }
    return best || gap;
  }

  // A point ~2 units outside a segment (away from the dock) for a bear to claw from.
  function clawSpot(f) {
    const out = new THREE.Vector3().subVectors(f.pos, SITE_CENTER).setY(0);
    if (out.lengthSq() < 0.001) out.set(0, 0, 1);
    out.normalize();
    return f.pos.clone().addScaledVector(out, 2.2);
  }

  // Once through the fence, bears storm the bay/Santa area, spreading out.
  function invadeTarget() {
    return V(DOCK.x + (Math.random() - 0.5) * 12, DOCK.z + (Math.random() - 0.5) * 6);
  }

  function spawnBear(spot) {
    const f = nearestSegment(spot);
    const g = buildBear(bearMats);
    g.position.copy(spot);
    scene.add(g);
    if (sfx) sfx.roar(); // roars the moment it appears at the treeline
    bears.push({
      group: g,
      pos: spot.clone(),
      seg: f,
      target: f ? clawSpot(f) : SITE_CENTER.clone(),
      hp: BEARS.hp,
      state: 'approach',
      clawT: 0,
      phase: Math.random() * 6,
    });
  }

  // A raid wave: 1-3 bears at once. Sometimes a pack from one direction,
  // sometimes lone bears converging from different sides.
  function spawnWave() {
    const count = 2 + ((Math.random() * 2) | 0); // 2 or 3
    const grouped = Math.random() < 0.5;
    if (grouped) {
      const base = SPAWN_SPOTS[(Math.random() * SPAWN_SPOTS.length) | 0];
      for (let i = 0; i < count; i++) {
        // small scatter around the pack's entry point
        spawnBear(V(base.x + (Math.random() - 0.5) * 7, base.z + (Math.random() - 0.5) * 7));
      }
    } else {
      // distinct directions: shuffle spots and take `count` different ones
      const idx = SPAWN_SPOTS.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, count);
      for (const i of idx) spawnBear(SPAWN_SPOTS[i].clone());
    }
  }

  function nearestBear(pos, range) {
    let best = null;
    let bestD = range * range;
    for (const b of bears) {
      if (b.hp <= 0) continue;
      const d = pos.distanceToSquared(b.pos);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  function fire(from, bear) {
    const to = bear.pos.clone().setY(1.0);
    const len = from.distanceTo(to);
    const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), tracerMat);
    tracer.position.copy(from).lerp(to, 0.5);
    tracer.lookAt(to);
    scene.add(tracer);
    tracers.push({ mesh: tracer, life: 0.09 });
  }

  function killBear(b) {
    scene.remove(b.group);
    const i = bears.indexOf(b);
    if (i >= 0) bears.splice(i, 1);
  }

  function update(dt) {
    // spawning: raids come in waves of 2-3 bears, rarer with more barbed wire
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnWave();
      spawnTimer = BEARS.baseSpawnInterval + fenceLevel * BEARS.spawnPerFence + Math.random() * 5;
    }

    // bears: approach the fence -> claw it down -> storm the dock (invade) ->
    // rampage among the Santas. Invaders stay until the fence is repaired.
    const walk = (b, target, spd) => {
      const dir = target.clone().sub(b.pos);
      dir.y = 0;
      const len = dir.length();
      if (len > 0.001) {
        dir.normalize();
        b.pos.addScaledVector(dir, spd * dt);
        b.group.rotation.y = -Math.atan2(dir.z, dir.x);
      }
      return len;
    };

    for (let i = bears.length - 1; i >= 0; i--) {
      const b = bears[i];
      if (b.state === 'approach') {
        if (walk(b, b.target, BEARS.speed) < 2.8) {
          b.state = 'claw';
          b.clawT = CLAW_TIME;
        }
      } else if (b.state === 'claw') {
        // a barbed-wire coil must be chewed through first — the barbs shred the
        // bear while it works, and the coil itself wears down (needs repair).
        if (b.seg && b.seg.wire && b.seg.wireHp > 0) {
          b.seg.wireHp = Math.max(0, b.seg.wireHp - CLAW_DPS * dt);
          applyWire(b.seg);
          b.hp -= WIRE_DPS * dt;
          if (b.hp <= 0) { killBear(b); continue; } // shredded on the wire
        } else if (b.seg && b.seg.hp > 0) {
          // coil is gone (or none) — now claw the chain-link panel down
          b.seg.hp = Math.max(0, b.seg.hp - CLAW_DPS * dt);
          applyDamage(b.seg);
        }
        b.clawT -= dt;
        if (!b.seg || b.seg.hp <= 0) {
          b.state = 'invade'; // smashed through the wire — head for the Santas
          b.target = invadeTarget();
          if (sfx) sfx.roar();
        } else if (b.clawT <= 0) {
          killBear(b);
          continue;
        }
      } else if (b.state === 'invade') {
        if (walk(b, b.target, BEARS.speed) < 2.2) {
          b.state = 'rampage';
          b.wanderT = 0;
        }
      } else {
        // rampage: prowl the dock, menacing the workers, until driven off
        b.wanderT -= dt;
        if (b.wanderT <= 0) {
          b.target = invadeTarget();
          b.wanderT = 1.4 + Math.random() * 2.2;
        }
        walk(b, b.target, BEARS.speed * 0.6);
      }
      if (b.group) {
        b.group.position.set(b.pos.x, 0, b.pos.z);
        b.phase += dt * 9;
        b.group.position.y = Math.abs(Math.sin(b.phase)) * 0.12;
      }
    }

    // towers: swivel the gun + gunner to track the nearest bear in range and
    // fire; when no bear is near, slowly sweep the area looking for a target.
    const muzzleW = new THREE.Vector3();
    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      if (!t.group.visible) continue;
      const target = nearestBear(t.pos, BEARS.towerRange); // ground range from the tower
      if (target) {
        // swivel the whole mount (gun + gunner) to face the bear (yaw only,
        // so the gunner stays upright instead of tipping forward at close range)
        const yaw = Math.atan2(target.pos.x - t.pos.x, target.pos.z - t.pos.z);
        t.mount.rotation.set(0, yaw, 0);
        fireTimers[i] -= dt;
        if (fireTimers[i] <= 0) {
          fireTimers[i] = BEARS.towerFireInterval;
          t.muzzle.getWorldPosition(muzzleW);
          fire(muzzleW, target);
          if (sfx) sfx.gunshot();
          target.hp -= 1;
          if (target.hp <= 0) killBear(target);
        }
      } else {
        // idle scan: sweep left/right around the inward-facing rest angle
        t.scanPhase += dt * 0.7;
        t.mount.rotation.set(0, t.baseYaw + Math.sin(t.scanPhase) * 1.2, 0);
      }
    }

    // gate guards: M-16s that track + shoot nearby bears. A bear right on top of
    // a guard can injure them — they go down for a while (replacement costs cash).
    const gw = new THREE.Vector3();
    for (const gd of guards) {
      if (gd.down) {
        gd.downT -= dt;
        if (gd.downT <= 0) {
          gd.down = false;
          gd.group.rotation.z = 0;
          gd.group.rotation.y = gd.baseYaw;
        }
        continue;
      }
      const target = nearestBear(gd.pos, GUARDS.range);
      if (target) {
        gd.aiming = true;
        gd.group.rotation.y = Math.atan2(target.pos.x - gd.pos.x, target.pos.z - gd.pos.z);
        gd.fireT -= dt;
        if (gd.fireT <= 0) {
          gd.fireT = GUARDS.fireInterval;
          gd.muzzle.getWorldPosition(gw);
          fire(gw, target);
          if (sfx) sfx.gunshot();
          target.hp -= 1;
          if (target.hp <= 0) killBear(target);
        }
        // mauled if a (still-living) bear is right at the post
        if (target.hp > 0 && gd.pos.distanceTo(target.pos) < GUARDS.injureRadius &&
            Math.random() < GUARDS.injureChancePerSec * dt) {
          gd.down = true;
          gd.downT = GUARDS.downTime;
          gd.aiming = false;
          gd.group.rotation.z = 1.45; // collapses
          guardInjuryCount++;
        }
      } else {
        gd.aiming = false;
        gd.group.rotation.y = gd.baseYaw;
      }
    }

    // fade tracers
    for (let i = tracers.length - 1; i >= 0; i--) {
      tracers[i].life -= dt;
      if (tracers[i].life <= 0) {
        scene.remove(tracers[i].mesh);
        tracers.splice(i, 1);
      }
    }
  }

  // total missing health to restore (chain-link panels + installed wire coils)
  function totalMissing() {
    let m = 0;
    for (const f of fence) {
      m += f.maxHp - f.hp;
      if (f.wire) m += f.wireMax - f.wireHp; // torn-up coils cost extra to repair
    }
    return m;
  }
  // health bar tracks the WEAKEST stretch — so it visibly drops as a panel is
  // clawed and reads empty the instant any segment is breached.
  function weakestFrac() {
    let m = 1;
    for (const f of fence) m = Math.min(m, f.maxHp > 0 ? f.hp / f.maxHp : 1);
    return fence.length ? m : 1;
  }

  return {
    update,
    setTowerCount,
    setFenceLevel,
    beginWireEdit,
    endWireEdit,
    wireClick,
    wireCount: () => fence.filter((f) => f.wire).length,
    // any downed segment is an open hole in the wire -> dock overrun -> loading paused
    isBreached: () => fence.some((f) => f.hp <= 0),
    bearsActive: () => bears.length,
    // number of guards mauled since the last call (main.js charges replacement)
    pollGuardInjuries: () => { const n = guardInjuryCount; guardInjuryCount = 0; return n; },
    // x of the frontmost bear blocking the truck lane (or null) — trucks must
    // stop behind it instead of driving through.
    laneBlockX: () => {
      let x = null;
      for (const b of bears) {
        if (b.state !== 'invade' && b.state !== 'rampage') continue;
        if (Math.abs(b.pos.z - LANE_Z) > 3.2) continue; // only bears on the lane
        if (x === null || b.pos.x > x) x = b.pos.x;
      }
      return x;
    },
    fenceFrac: () => weakestFrac(),
    // wire diagnostics: installed coils, how many are torn, and worst coil frac
    wireStatus: () => {
      let installed = 0, damaged = 0, worst = 1;
      const spots = [];
      for (const f of fence) {
        if (!f.wire) continue;
        installed++;
        const r = f.wireMax > 0 ? f.wireHp / f.wireMax : 0;
        if (r < 1) damaged++;
        worst = Math.min(worst, r);
        spots.push({ x: f.pos.x, z: f.pos.z, frac: +r.toFixed(2) });
      }
      return { installed, damaged, worst: +worst.toFixed(2), spots };
    },
    // ground position of the most-damaged stretch (or null if all intact) —
    // handy for UI/debug to point at the threatened section.
    weakestSpot: () => {
      let f = null, r = 1;
      for (const s of fence) { const sr = s.maxHp > 0 ? s.hp / s.maxHp : 1; if (sr < r) { r = sr; f = s; } }
      return f ? { x: f.pos.x, z: f.pos.z, frac: r } : null;
    },
    repairCost: () => Math.ceil(totalMissing() * REPAIR_COST_PER_HP),
    repair: () => {
      // restore chain-link panels AND re-string any torn barbed wire
      for (const f of fence) {
        f.hp = f.maxHp;
        applyDamage(f);
        if (f.wire) { f.wireHp = f.wireMax; applyWire(f); }
      }
      // patching the perimeter drives off the bears that got inside
      for (let i = bears.length - 1; i >= 0; i--) {
        const b = bears[i];
        if (b.state === 'invade' || b.state === 'rampage') killBear(b);
      }
    },
  };
}

// --- meshes ---------------------------------------------------------------
function bearAssets() {
  return {
    fur: new THREE.MeshLambertMaterial({ color: 0x5a4632, flatShading: true }),
    dark: new THREE.MeshLambertMaterial({ color: 0x3c2e20, flatShading: true }),
    snout: new THREE.MeshLambertMaterial({ color: 0x8a7257, flatShading: true }),
  };
}

function buildBear(m) {
  const g = new THREE.Group();
  const body = box(2.4, 1.1, 1.5, m.fur);
  body.position.set(-0.2, 1.0, 0);
  g.add(body);
  const head = box(1.0, 0.95, 1.1, m.fur);
  head.position.set(1.2, 1.25, 0);
  g.add(head);
  const snout = box(0.5, 0.5, 0.6, m.snout);
  snout.position.set(1.8, 1.1, 0);
  g.add(snout);
  for (const z of [-0.45, 0.45]) {
    const ear = box(0.3, 0.32, 0.3, m.fur);
    ear.position.set(1.0, 1.85, z);
    g.add(ear);
  }
  for (const x of [0.9, -0.9]) {
    for (const z of [-0.5, 0.5]) {
      const leg = box(0.45, 0.9, 0.45, m.dark);
      leg.position.set(x, 0.45, z);
      g.add(leg);
    }
  }
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  g.scale.setScalar(1.05);
  return g;
}

function strut(a, b, radius, mat) {
  // a thin cylinder spanning two points (for tripod legs)
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  m.castShadow = true;
  return m;
}

// A concertina barbed-wire coil sitting just OUTSIDE a fence segment: a row of
// overlapping rings (with little barbs) running the length of the stretch.
function buildCoil(f) {
  const g = new THREE.Group();
  const params = f.seg.panel.geometry.parameters || {};
  const len = params.width || 6;
  const axis = f.seg.axis;
  const wireMat = new THREE.MeshLambertMaterial({ color: 0xc2c8cf, flatShading: true });
  const ringGeo = new THREE.TorusGeometry(0.5, 0.07, 5, 9);
  const barbGeo = new THREE.BoxGeometry(0.08, 0.08, 0.22);
  const rings = Math.max(2, Math.round(len / 1.1));
  for (let i = 0; i < rings; i++) {
    const along = ((i + 0.5) / rings - 0.5) * len;
    const ring = new THREE.Mesh(ringGeo, wireMat);
    if (axis === 'x') { ring.position.set(along, 0.55, 0); ring.rotation.y = Math.PI / 2; }
    else { ring.position.set(0, 0.55, along); }
    ring.rotation.z = i * 0.8;
    ring.castShadow = true;
    g.add(ring);
    // a couple of barbs sticking off each ring
    for (const a of [0.6, 3.5]) {
      const barb = new THREE.Mesh(barbGeo, wireMat);
      const bx = Math.cos(a + i) * 0.5;
      const by = 0.55 + Math.sin(a + i) * 0.5;
      if (axis === 'x') barb.position.set(along, by, bx);
      else barb.position.set(bx, by, along);
      g.add(barb);
    }
  }
  // sit the coil a little outside the fence line (toward the treeline)
  const out = new THREE.Vector3().subVectors(f.pos, SITE_CENTER).setY(0);
  if (out.lengthSq() < 0.001) out.set(0, 0, 1);
  out.normalize();
  g.position.set(f.pos.x + out.x * 1.7, 0, f.pos.z + out.z * 1.7);
  g.userData.mat = wireMat; // for highlight during "move wire" mode
  return g;
}

function buildTower(spot) {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x5b4634, flatShading: true });
  const plat = new THREE.MeshLambertMaterial({ color: 0x6e5340, flatShading: true });
  const steel = new THREE.MeshLambertMaterial({ color: 0x33343b, flatShading: true });
  const gunMetal = new THREE.MeshLambertMaterial({ color: 0x222329, flatShading: true });
  const H = 4.6;
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const leg = box(0.35, H, 0.35, wood);
      leg.position.set(x * 0.9, H / 2, z * 0.9);
      leg.castShadow = true;
      g.add(leg);
    }
  }
  const deck = box(2.6, 0.3, 2.6, plat);
  deck.position.y = H;
  deck.castShadow = true;
  g.add(deck);
  for (const [dx, dz, w, d] of [[0, 1.25, 2.6, 0.2], [0, -1.25, 2.6, 0.2], [1.25, 0, 0.2, 2.6], [-1.25, 0, 0.2, 2.6]]) {
    const rail = box(w, 0.5, d, wood);
    rail.position.set(dx, H + 0.4, dz);
    g.add(rail);
  }

  // ---- Tripod (fixed stand) — three splayed legs meeting under the gun ----
  const APEX = H + 1.35; // height of the gun pivot
  const apex = new THREE.Vector3(0, APEX, 0);
  for (const ang of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) {
    const foot = new THREE.Vector3(Math.cos(ang) * 1.0, H + 0.18, Math.sin(ang) * 1.0);
    g.add(strut(apex, foot, 0.09, steel));
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 8), steel);
  hub.position.y = APEX;
  g.add(hub);

  // ---- Swiveling mount: the heavy MG + the gunner manning it, facing +Z ----
  const mount = new THREE.Group();
  mount.position.set(0, APEX, 0);

  const receiver = box(0.55, 0.5, 1.0, gunMetal); // big boxy body
  receiver.position.set(0, 0.05, 0.15);
  mount.add(receiver);
  // perforated cooling jacket around the barrel
  const jacket = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.1, 10), steel);
  jacket.rotation.x = Math.PI / 2;
  jacket.position.set(0, 0.1, 0.95);
  mount.add(jacket);
  // long thick barrel poking out of the jacket
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.7, 8), gunMetal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.1, 1.7);
  mount.add(barrel);
  // ammo box on the side + a belt stub
  const ammo = box(0.5, 0.4, 0.6, new THREE.MeshLambertMaterial({ color: 0x4a5a32, flatShading: true }));
  ammo.position.set(0.5, -0.05, 0.0);
  mount.add(ammo);
  // twin spade grips at the back
  for (const x of [-0.22, 0.22]) {
    const grip = box(0.1, 0.45, 0.1, gunMetal);
    grip.position.set(x, -0.05, -0.5);
    mount.add(grip);
  }
  mount.traverse((o) => o.isMesh && (o.castShadow = true));

  // gunner stands behind the gun, manning it (also swivels with the mount)
  const gunner = buildGunner();
  gunner.position.set(0, -1.2, -0.85); // feet on the deck, manning the gun
  mount.add(gunner);

  // muzzle marker (child of the mount) — tracers originate from its world pos
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.1, 2.5);
  mount.add(muzzle);

  g.add(mount);
  g.position.set(spot.x, 0, spot.z);

  // resting orientation: face inward toward the dock
  const baseYaw = Math.atan2(SITE_CENTER.x - spot.x, SITE_CENTER.z - spot.z);
  mount.rotation.y = baseYaw;

  return { group: g, mount, muzzle, pos: spot.clone(), baseYaw, scanPhase: spot.x + spot.z };
}

function buildGunner() {
  const g = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0xd0322d });
  const white = new THREE.MeshLambertMaterial({ color: 0xf6f6f6 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b58f });
  const body = box(0.7, 0.9, 0.55, red);
  body.position.y = 0.75;
  g.add(body);
  const head = box(0.4, 0.4, 0.4, skin);
  head.position.y = 1.4;
  g.add(head);
  const beard = box(0.42, 0.34, 0.18, white);
  beard.position.set(0, 1.28, 0.2);
  g.add(beard);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.5, 8), red);
  hat.position.y = 1.75;
  g.add(hat);
  const brim = box(0.46, 0.14, 0.46, white);
  brim.position.y = 1.55;
  g.add(brim);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}
