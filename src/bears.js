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

export function createBears(scene, sfx, fenceSegments = [], guards = [], treeObstacles = []) {
  const BEAR_R = 0.7; // bear body radius for tree collision (slim, so it fits gaps)
  let raidCb = null; // notified (cx, cz) when a wave spawns — for the HUD warning
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
  // Per-round visuals: a fast tracer streak + a brief additive muzzle flash, so
  // rapid fire reads as a stream of individual rounds, not one solid beam.
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe27a, fog: false });
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0, fog: false, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const bulletGeo = new THREE.BoxGeometry(0.08, 0.08, 0.9); // streak along local +Z
  const flashGeo = new THREE.ConeGeometry(0.26, 0.55, 7);
  flashGeo.rotateX(Math.PI / 2); // apex along +Z
  const FWD = new THREE.Vector3(0, 0, 1);

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
  const shots = []; // tracer bullets + muzzle flashes in flight
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
      walkPhase: Math.random() * 6,
      walkSpeed: 0,
    });
  }

  // A raid wave: 1-3 bears at once. Sometimes a pack from one direction,
  // sometimes lone bears converging from different sides.
  function spawnWave() {
    const count = 2 + ((Math.random() * 2) | 0); // 2 or 3
    const grouped = Math.random() < 0.5;
    const spots = [];
    if (grouped) {
      const base = SPAWN_SPOTS[(Math.random() * SPAWN_SPOTS.length) | 0];
      for (let i = 0; i < count; i++) {
        spots.push(V(base.x + (Math.random() - 0.5) * 7, base.z + (Math.random() - 0.5) * 7));
      }
    } else {
      // distinct directions: shuffle spots and take `count` different ones
      const idx = SPAWN_SPOTS.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, count);
      for (const i of idx) spots.push(SPAWN_SPOTS[i].clone());
    }
    for (const s of spots) spawnBear(s);
    // tell the HUD a raid is coming (the forest hides the bears) + roughly where
    if (raidCb) {
      const cx = spots.reduce((a, s) => a + s.x, 0) / spots.length;
      const cz = spots.reduce((a, s) => a + s.z, 0) / spots.length;
      raidCb(cx, cz);
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

  // One round: a brief muzzle flash at the gun + a short tracer that streaks to
  // the target. Called once per round, so rapid fire is a string of discrete
  // flashes/tracers rather than a single continuous line of light.
  function spawnShot(from, bear) {
    const to = bear.pos.clone().setY(1.1);
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.001) return;
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(FWD, dir);

    const s0 = 0.7 + Math.random() * 0.5; // flicker the flash size per round
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(from);
    flash.quaternion.copy(q);
    flash.scale.setScalar(s0);
    scene.add(flash);
    shots.push({ mesh: flash, life: 0.05, max: 0.05, s0, flash: true });

    const tracer = new THREE.Mesh(bulletGeo, tracerMat);
    tracer.position.copy(from);
    tracer.quaternion.copy(q);
    scene.add(tracer);
    const speed = 130;
    shots.push({ mesh: tracer, life: Math.min(0.3, dist / speed), vel: dir.multiplyScalar(speed) });
  }

  function killBear(b) {
    scene.remove(b.group);
    const i = bears.indexOf(b);
    if (i >= 0) bears.splice(i, 1);
  }

  // Keep a bear out of solid tree footprints — if it has walked into one, shove
  // it back to the edge so it slides around the trunk instead of through it.
  function pushOutOfTrees(b) {
    for (const t of treeObstacles) {
      const dx = b.pos.x - t.x;
      const dz = b.pos.z - t.z;
      const minD = t.r + BEAR_R;
      if (Math.abs(dx) > minD || Math.abs(dz) > minD) continue; // cheap broad phase
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD || d2 < 1e-6) continue;
      const push = (minD - Math.sqrt(d2)) / Math.sqrt(d2);
      b.pos.x += dx * push;
      b.pos.z += dz * push;
    }
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
      if (len <= 0.001) { b.walkSpeed = 0; return len; }
      dir.normalize();
      // Steer AROUND trees that are ahead: add a tangential nudge (toward the
      // side that points at the target) so the bear walks around the trunk
      // instead of jamming into it and getting shoved straight back. Skipped
      // while phasing (a stuck bear that's been freed to push straight through).
      if (!b.phaseTrees) for (const t of treeObstacles) {
        const dx = b.pos.x - t.x;
        const dz = b.pos.z - t.z;
        const avoid = t.r + BEAR_R + 1.4;
        if (Math.abs(dx) > avoid || Math.abs(dz) > avoid) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 > avoid * avoid || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        if ((-dx / d) * dir.x + (-dz / d) * dir.z <= 0) continue; // tree is behind — ignore
        let tx = -dz, tz = dx; // tangent (perpendicular to the bear→tree radial)
        if (tx * dir.x + tz * dir.z < 0) { tx = -tx; tz = -tz; } // pick the side toward the target
        const tl = Math.hypot(tx, tz) || 1;
        const strength = ((avoid - d) / avoid) * 1.8; // stronger the closer it is
        dir.x += (tx / tl) * strength;
        dir.z += (tz / tl) * strength;
      }
      dir.y = 0;
      dir.normalize();
      b.pos.addScaledVector(dir, spd * dt);
      b.group.rotation.y = -Math.atan2(dir.z, dir.x);
      b.walkSpeed = spd; // record ground speed so the gait syncs (no foot-slip)
      return len;
    };

    for (let i = bears.length - 1; i >= 0; i--) {
      const b = bears[i];
      b.walkSpeed = 0; // walk() sets this when the bear actually moves this frame
      const px = b.pos.x, pz = b.pos.z; // for stuck detection below
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
      if (!b.phaseTrees) pushOutOfTrees(b); // can't walk through trees — slide around them
      // Stuck fallback: if a bear that's trying to walk has barely moved (wedged
      // in a thicket / spawned inside one), let it phase straight through the
      // trees until it's moving freely again — a brief clip beats a frozen bear.
      const moved = Math.hypot(b.pos.x - px, b.pos.z - pz);
      const wanted = b.walkSpeed * dt;
      if (wanted > 0.001 && moved < wanted * 0.4) b.stuckT = (b.stuckT || 0) + dt;
      else b.stuckT = Math.max(0, (b.stuckT || 0) - dt * 2);
      if (b.stuckT > 1.2) b.phaseTrees = true;
      if (b.phaseTrees && (wanted < 0.001 || moved > wanted * 0.7)) { b.phaseTrees = false; b.stuckT = 0; }
      if (b.group) {
        b.group.position.set(b.pos.x, 0, b.pos.z);
        const ud = b.group.userData;
        const clawing = b.state === 'claw';
        const moving = b.walkSpeed > 0.01;
        b.phase += dt * 9;
        // advance the stride with actual ground speed so the paws don't slip
        if (moving) b.walkPhase += b.walkSpeed * dt * 2.2;

        if (ud.legs) {
          for (const leg of ud.legs) {
            let swing = 0;
            if (clawing && leg.front) {
              swing = (0.5 + 0.5 * Math.sin(b.phase * 6 + leg.off)) * 0.9; // paw/rake at the fence
            } else if (moving) {
              swing = Math.sin(b.walkPhase + leg.off) * 0.5; // fore/aft stride
            }
            // ease toward the target so start/stop isn't snappy
            leg.pivot.rotation.z += (swing - leg.pivot.rotation.z) * Math.min(1, dt * 12);
          }
        }

        // body bob (two per stride, matching the diagonal gait) + head bob
        b.group.position.y = moving ? Math.abs(Math.sin(b.walkPhase)) * 0.1 : 0;
        if (ud.head) {
          ud.head.position.y = 1.34
            + (moving ? Math.sin(b.walkPhase * 2 + 0.5) * 0.04 : 0)
            - (clawing ? (0.5 + 0.5 * Math.sin(b.phase * 6)) * 0.07 : 0);
        }
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
        t.firing = true;
        fireTimers[i] -= dt;
        if (fireTimers[i] <= 0) {
          fireTimers[i] = BEARS.towerFireInterval;
          t.muzzle.getWorldPosition(muzzleW);
          spawnShot(muzzleW, target);
          target.hp -= BEARS.towerDamage;
          if (target.hp <= 0) killBear(target);
        }
      } else {
        // idle scan: sweep left/right around the inward-facing rest angle
        t.firing = false;
        t.scanPhase += dt * 0.7;
        t.mount.rotation.set(0, t.baseYaw + Math.sin(t.scanPhase) * 1.2, 0);
      }
      // Spin the barrel cluster: wind up while firing, coast down when idle.
      const targetSpin = t.firing ? 42 : 0;
      t.spinRate += (targetSpin - t.spinRate) * Math.min(1, dt * 5);
      if (t.barrels) t.barrels.rotation.z += t.spinRate * dt;
    }
    // One sustained minigun roar gated on whether ANY tower is firing (a single
    // voice, not a one-shot per round — see sfx.minigun).
    if (sfx) sfx.minigun(towers.some((t) => t.firing && t.group.visible));

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
          spawnShot(gw, target);
          if (sfx) sfx.rifle();
          target.hp -= GUARDS.damage || 1;
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

    // advance tracers (fly to the target) + shrink/fade muzzle flashes
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.life -= dt;
      if (s.vel) s.mesh.position.addScaledVector(s.vel, dt);
      else if (s.flash) s.mesh.scale.setScalar(Math.max(0.01, (s.life / s.max) * s.s0));
      if (s.life <= 0) {
        scene.remove(s.mesh);
        shots.splice(i, 1);
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
    onRaid: (cb) => { raidCb = cb; },
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
// PBR (MeshStandard) materials so the bears pick up the scene's soft
// environment + sun: rough matte fur, a faintly glossy wet nose and eyes.
export function bearAssets() {
  return {
    fur: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95, metalness: 0.0 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x342a1d, roughness: 0.92, metalness: 0.0 }),
    snout: new THREE.MeshStandardMaterial({ color: 0x8a7257, roughness: 0.85, metalness: 0.0 }),
    nose: new THREE.MeshStandardMaterial({ color: 0x141110, roughness: 0.25, metalness: 0.1 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2, metalness: 0.0 }),
    claw: new THREE.MeshStandardMaterial({ color: 0x1b1712, roughness: 0.5, metalness: 0.05 }),
  };
}

// A refined low-poly grizzly facing +x (its travel direction). Rounded capsule
// body with a shoulder hump, a domed head with muzzle/ears/eyes, four tapered
// legs with clawed paws, and a stubby tail. Smooth-shaded for a soft, organic
// read while staying low-poly.
export function buildBear(m) {
  const g = new THREE.Group();

  // Trunk: a capsule lying along x, with a raised shoulder hump (grizzly).
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.15, 6, 14), m.fur);
  body.rotation.z = Math.PI / 2; // lie along x
  body.position.set(-0.05, 1.12, 0);
  g.add(body);
  const hump = ball(0.6, m.fur);
  hump.scale.set(1, 0.85, 1);
  hump.position.set(0.35, 1.5, 0);
  g.add(hump);
  const rump = ball(0.62, m.fur);
  rump.position.set(-0.95, 1.15, 0);
  g.add(rump);

  // Head + muzzle + nose.
  const head = ball(0.52, m.fur);
  head.scale.set(1, 0.95, 1);
  head.position.set(1.3, 1.34, 0);
  g.add(head);
  const muzzle = bone(new THREE.Vector3(1.5, 1.22, 0), new THREE.Vector3(2.02, 1.18, 0), 0.34, 0.24, m.snout, 10);
  g.add(muzzle);
  const nose = ball(0.15, m.nose, 10);
  nose.position.set(2.04, 1.2, 0);
  g.add(nose);

  // Ears (with darker inner) and eyes.
  for (const z of [-0.42, 0.42]) {
    const ear = ball(0.2, m.fur, 10);
    ear.position.set(1.12, 1.82, z);
    g.add(ear);
    const inner = ball(0.1, m.dark, 8);
    inner.position.set(1.2, 1.82, z * 0.92);
    g.add(inner);
    const eye = ball(0.075, m.eye, 8);
    eye.position.set(1.66, 1.46, z * 0.5);
    g.add(eye);
  }

  // Four tapered legs with clawed paws, each hung on a hip-pivot group so the
  // limb can swing fore/aft for the walk cycle (driven in the update loop via
  // g.userData.legs). The haunch muscle stays fixed — only the leg swings.
  g.userData.legs = [];
  const HIP_Y = 1.0;
  const legSpec = [
    [0.74, 0.5, 0.26, 0.22, false], // front
    [-0.85, 0.52, 0.34, 0.24, true], // back (haunch)
  ];
  for (const [hipX, z0, rA, rB, haunch] of legSpec) {
    for (const z of [-z0, z0]) {
      if (haunch) {
        const h = ball(0.46, m.fur);
        h.scale.set(1, 1, 0.85);
        h.position.set(hipX, 0.92, z);
        g.add(h);
      }
      const pivot = new THREE.Group();
      pivot.position.set(hipX, HIP_Y, z);
      const footY = 0.16 - HIP_Y; // foot height relative to the hip
      pivot.add(bone(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.04, footY, 0), rA, rB, m.dark));
      const paw = ball(0.24, m.dark, 8);
      paw.scale.set(1.1, 0.5, 1);
      paw.position.set(0.12, footY - 0.08, 0);
      pivot.add(paw);
      for (const cz of [-0.12, 0, 0.12]) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 6), m.claw);
        claw.rotation.z = -Math.PI / 2;
        claw.position.set(0.34, footY - 0.08, cz);
        pivot.add(claw);
      }
      g.add(pivot);
      // diagonal gait: front-left + back-right swing together, opposite pair antiphase
      const front = !haunch;
      const off = front ? (z < 0 ? 0 : Math.PI) : (z < 0 ? Math.PI : 0);
      g.userData.legs.push({ pivot, off, front });
    }
  }

  // Stubby tail.
  const tail = ball(0.15, m.fur, 8);
  tail.position.set(-1.5, 1.2, 0);
  g.add(tail);

  g.userData.head = head; // for a subtle head bob while walking/clawing
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

// A tapered limb (cone-cylinder) spanning two points: radius rA at end `a`,
// rB at end `b`. Used for the bears' legs and the gunner's posed arms.
function bone(a, b, rA, rB, mat, seg = 8) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  // CylinderGeometry(radiusTop, radiusBottom): +y end (top) maps to `b`.
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rB, rA, len, seg), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  m.castShadow = true;
  return m;
}

// A smooth-shaded low-poly sphere helper.
function ball(r, mat, seg = 12) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)), mat);
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

export function buildTower(spot) {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: 0x5b4634, flatShading: true });
  const plat = new THREE.MeshLambertMaterial({ color: 0x6e5340, flatShading: true });
  // The gun is metal — PBR so it catches the environment + sun as bright spec.
  const steel = new THREE.MeshStandardMaterial({ color: 0x40424a, roughness: 0.5, metalness: 0.7 });
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x202127, roughness: 0.38, metalness: 0.85 });
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

  // ---- Access ladder up the front face so the gunner can climb to the deck ----
  const ladder = new THREE.Group();
  const ladderMat = new THREE.MeshStandardMaterial({ color: 0x6b7079, roughness: 0.55, metalness: 0.75 });
  const ladderTop = H + 0.5; // overshoot the deck for a handhold
  for (const lx of [-0.32, 0.32]) {
    const rail = box(0.08, ladderTop, 0.08, ladderMat);
    rail.position.set(lx, ladderTop / 2, 0);
    ladder.add(rail);
  }
  for (let r = 1; r * 0.45 < ladderTop; r++) {
    const rung = box(0.72, 0.06, 0.07, ladderMat);
    rung.position.set(0, r * 0.45, 0);
    ladder.add(rung);
  }
  ladder.position.set(0, 0, 1.5); // just outside the front deck edge
  ladder.rotation.x = -0.05; // lean the top in against the deck
  ladder.traverse((o) => o.isMesh && (o.castShadow = true));
  g.add(ladder);

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

  // ---- M134-style minigun: boxy receiver + motor, a spinning 6-barrel cluster,
  // and a flexible ammo chute feeding from a can on the mount. ----
  const receiver = box(0.62, 0.56, 0.9, gunMetal);
  receiver.position.set(0, 0.05, 0.05);
  mount.add(receiver);
  const motor = box(0.5, 0.32, 0.5, gunMetal); // drive motor housing on top
  motor.position.set(0, 0.42, -0.05);
  mount.add(motor);
  const facePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.12, 14), steel);
  facePlate.rotation.x = Math.PI / 2; // barrels exit through this plate
  facePlate.position.set(0, 0.05, 0.52);
  mount.add(facePlate);

  // The rotating barrel cluster (spun about its +Z firing axis in update()).
  const barrels = new THREE.Group();
  barrels.position.set(0, 0.05, 0.55);
  const BR = 0.13; // cluster radius
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const bl = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 8), gunMetal);
    bl.rotation.x = Math.PI / 2; // lie along Z
    bl.position.set(Math.cos(a) * BR, Math.sin(a) * BR, 0.75);
    barrels.add(bl);
  }
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8), steel);
  spindle.rotation.x = Math.PI / 2;
  spindle.position.z = 0.75;
  barrels.add(spindle);
  for (const cz of [0.15, 1.35]) { // clamp rings holding the cluster together
    const ring = new THREE.Mesh(new THREE.TorusGeometry(BR, 0.045, 6, 16), steel);
    ring.position.z = cz;
    barrels.add(ring);
  }
  mount.add(barrels);

  // Ammo can on the mount + a flexible feed chute curving up to the receiver.
  const ammo = box(0.6, 0.5, 0.74, new THREE.MeshStandardMaterial({ color: 0x49592f, roughness: 0.6, metalness: 0.3 }));
  ammo.position.set(0.62, -0.42, -0.2);
  mount.add(ammo);
  const chuteCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.31, 0.04, 0.0),    // feed port on the receiver side
    new THREE.Vector3(0.52, -0.05, -0.05),
    new THREE.Vector3(0.66, -0.22, -0.16),
    new THREE.Vector3(0.62, -0.18, -0.2),  // down into the can
  ]);
  const chute = new THREE.Mesh(new THREE.TubeGeometry(chuteCurve, 24, 0.07, 8, false), gunMetal);
  mount.add(chute);

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

  // muzzle marker (child of the mount, not the spinning cluster) — rounds
  // originate from its world position.
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.05, 2.1);
  mount.add(muzzle);

  g.add(mount);
  g.position.set(spot.x, 0, spot.z);

  // resting orientation: face inward toward the dock
  const baseYaw = Math.atan2(SITE_CENTER.x - spot.x, SITE_CENTER.z - spot.z);
  mount.rotation.y = baseYaw;

  return { group: g, mount, barrels, muzzle, pos: spot.clone(), baseYaw, scanPhase: spot.x + spot.z, spinRate: 0, firing: false, soundT: 0 };
}

// A refined low-poly Santa gunner facing +z (the gun's firing direction): a
// flared coat, layered beard, domed head + bobbled hat, and jointed arms posed
// forward onto the gun's spade grips. PBR materials catch the scene lighting.
export function buildGunner() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.7, metalness: 0.0 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7, metalness: 0.0 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.6, metalness: 0.0 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe1a982, roughness: 0.75, metalness: 0.0 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b44a, roughness: 0.3, metalness: 0.9 });

  // Boots + legs.
  for (const x of [-0.16, 0.16]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.42), black);
    boot.position.set(x, 0.1, 0.08);
    g.add(boot);
    g.add(bone(new THREE.Vector3(x, 0.72, 0), new THREE.Vector3(x, 0.2, 0.02), 0.16, 0.14, red));
  }

  // Flared coat (tapered cylinder), white front trim, black belt + gold buckle.
  const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.44, 0.95, 14), red);
  coat.position.y = 1.05;
  g.add(coat);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 0.05), white);
  trim.position.set(0, 1.05, 0.4);
  g.add(trim);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.16, 14), black);
  belt.position.y = 0.66;
  g.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.06), gold);
  buckle.position.set(0, 0.66, 0.44);
  g.add(buckle);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.12, 14), white);
  collar.position.y = 1.46;
  g.add(collar);

  // Jointed arms posed forward onto the gun's spade grips (~ ±0.22, 1.12, 0.36),
  // each on a shoulder PIVOT (default rotation 0 = this pose, so the gunner is
  // unchanged) so the yard workers can swing them in a loading motion. Exposed
  // via g.userData.arms.
  g.userData.arms = [];
  for (const x of [-0.34, 0.34]) {
    const sx = Math.sign(x);
    const shoulder = new THREE.Vector3(x, 1.4, 0);
    const pivot = new THREE.Group();
    pivot.position.copy(shoulder);
    // bones/mitten in shoulder-local space (so the pivot rotates the whole arm)
    const o = new THREE.Vector3(0, 0, 0);
    const elbow = new THREE.Vector3(sx * 0.32 - x, 1.24 - 1.4, 0.22);
    const hand = new THREE.Vector3(sx * 0.22 - x, 1.12 - 1.4, 0.4);
    pivot.add(bone(o, elbow, 0.14, 0.12, red));
    pivot.add(bone(elbow, hand, 0.12, 0.1, red));
    const mitten = ball(0.12, white, 8);
    mitten.position.copy(hand);
    pivot.add(mitten);
    g.add(pivot);
    g.userData.arms.push(pivot);
  }

  // Domed head, layered curly beard, little nose.
  const head = ball(0.22, skin);
  head.position.set(0, 1.64, 0);
  g.add(head);
  const beardTop = ball(0.21, white, 10);
  beardTop.scale.set(1, 0.85, 0.7);
  beardTop.position.set(0, 1.54, 0.12);
  g.add(beardTop);
  const beardLow = ball(0.14, white, 8);
  beardLow.position.set(0, 1.4, 0.16);
  g.add(beardLow);
  const nose = ball(0.05, skin, 6);
  nose.position.set(0, 1.6, 0.23);
  g.add(nose);

  // Red hat with a white brim ring and a bobble at the tip, tilted back a touch.
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 8, 16), white);
  brim.rotation.x = Math.PI / 2;
  brim.position.y = 1.78;
  g.add(brim);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 12), red);
  hat.position.set(0, 2.04, -0.04);
  hat.rotation.x = -0.18;
  g.add(hat);
  const pom = ball(0.09, white, 8);
  pom.position.set(0, 2.28, -0.12);
  g.add(pom);

  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

function box(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}
