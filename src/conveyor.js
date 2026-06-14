// conveyor.js — the metal feed conveyor + the pile it pours into, matching the
// reference art: an elevated dark belt slopes down toward the depot and a stream
// of grey metal blocks rides down it, tumbles off the end, and stacks into a
// growing mound. This module owns the whole block lifecycle (belt -> fall ->
// rest) so the blocks visibly come OUT of the conveyor like the screenshots.
//
// Interface (createConveyor(scene)):
//   addBlocks(n) -> queue n extra blocks to be fed (truck deliveries dump bursts)
//   update(dt)   -> animate the belt, the riding blocks, the falling blocks
//   count        -> total blocks that have landed on the pile

import * as THREE from 'three';
import { LAYOUT, PILE, BRICK } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);
const GROUND_Y = 0.29; // top of the paved lot the pile rests on

// Feed geometry: the belt runs from an elevated top (T) down to a discharge
// point (D) suspended just above the pile centre, so blocks drop onto the heap.
const T = new THREE.Vector3(-21, 10, -32); // portal / belt-exit point on the slope
const D = new THREE.Vector3(-6, 4.8, -18); // discharge end, above the pile
// The belt actually starts higher up, behind the portal, so it runs all the way
// up INTO the black opening (the portal occludes this hidden top section).
const BELT_TOP = T.clone().add(T.clone().sub(D).normalize().multiplyScalar(8));

const BELT_WIDTH = 3.2;
const BELT_THICK = 0.4;
const BELT_SPEED = 3.8; // world units / sec blocks ride down the belt (steady, natural pace)
const SURFACE_OFFSET = BELT_THICK / 2 + 0.35; // block sits this far above belt

const EMIT_INTERVAL = 0.34; // seconds between blocks (spaced to the slower belt)
const AMBIENT_INTERVAL = 0.34; // ambient trickle so the belt is never idle
const GRAVITY = 26;

// Heap shaping
const BLOCK = PILE.blockSize;
const MAX_MESHES = PILE.maxBlocks;
const BASE_RADIUS = PILE.moundRadius;
const LAYER_SIZE = 46; // blocks per layer before the next, narrower layer
const MAX_LAYERS = 6; // cap height so the peak stays below the discharge
const PILE_CENTER = LAYOUT.pilePos;

export function createConveyor(scene) {
  // Orthonormal belt basis: dir = down-slope, side = across, beltUp = belt normal.
  const dir = D.clone().sub(BELT_TOP).normalize();
  const side = new THREE.Vector3().crossVectors(UP, dir).normalize();
  const beltUp = new THREE.Vector3().crossVectors(dir, side).normalize();
  const beltLen = BELT_TOP.distanceTo(D);

  const group = new THREE.Group();
  scene.add(group);
  buildStructure(group, dir, side, beltUp, beltLen);
  const cleats = buildCleats(group, dir, side, beltUp, beltLen);

  // Shared block resources. Bricks are silver, with an occasional gold one.
  const blockGeo = new THREE.BoxGeometry(BLOCK.x, BLOCK.y, BLOCK.z);
  const silverMat = new THREE.MeshLambertMaterial({ color: BRICK.silverColor });
  const silverDarkMat = new THREE.MeshLambertMaterial({ color: BRICK.silverColorDark });
  const goldMat = new THREE.MeshLambertMaterial({ color: BRICK.goldColor });
  const goldDarkMat = new THREE.MeshLambertMaterial({ color: BRICK.goldColorDark });

  function brickMaterial() {
    if (Math.random() < BRICK.goldChance) {
      return Math.random() < 0.4 ? goldDarkMat : goldMat;
    }
    return Math.random() < 0.4 ? silverDarkMat : silverMat;
  }

  const riding = []; // blocks on the belt: { mesh, s, jitter, spin }
  const falling = []; // blocks tumbling onto the heap: { mesh, vel, target, spin }
  let restIndex = 0; // heap slot counter -> stacking position
  let pendingFeed = 0; // blocks waiting to be emitted
  let emitTimer = 0;
  let ambientTimer = 0;
  let cleatOffset = 0;

  function spawnRider() {
    const mesh = new THREE.Mesh(blockGeo, brickMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh); // riders use world positions, so live directly in the scene
    riding.push({
      mesh,
      s: 0,
      jitter: (Math.random() - 0.5) * (BELT_WIDTH - BLOCK.z - 0.4),
      spin: new THREE.Vector3(rand(), rand(), rand()),
    });
  }

  // Place a riding block at fraction s along the belt surface.
  function placeRider(r) {
    const along = r.s * beltLen;
    r.mesh.position
      .copy(BELT_TOP)
      .addScaledVector(dir, along)
      .addScaledVector(beltUp, SURFACE_OFFSET)
      .addScaledVector(side, r.jitter);
    // lie flat-ish on the belt, facing down-slope
    r.mesh.rotation.set(0, -Math.atan2(dir.z, dir.x), 0);
  }

  // Compute a rest position in the cone-shaped heap for the next landed block.
  function nextRestSlot() {
    const layer = Math.min(Math.floor(restIndex / LAYER_SIZE), MAX_LAYERS);
    const radius = Math.max(BASE_RADIUS * Math.pow(0.9, layer), 1.6);
    const ang = Math.random() * Math.PI * 2;
    const rr = radius * Math.sqrt(Math.random());
    restIndex++;
    return new THREE.Vector3(
      PILE_CENTER.x + Math.cos(ang) * rr,
      GROUND_Y + BLOCK.y * (0.5 + layer * 0.8) + Math.random() * 0.12,
      PILE_CENTER.z + Math.sin(ang) * rr
    );
  }

  function update(dt) {
    // --- belt cleats scroll downhill so the conveyor reads as "running" ---
    cleatOffset = (cleatOffset + BELT_SPEED * dt) % (beltLen / cleats.length);
    for (let i = 0; i < cleats.length; i++) {
      const along = ((i * (beltLen / cleats.length) + cleatOffset) % beltLen);
      cleats[i].position
        .copy(BELT_TOP)
        .addScaledVector(dir, along)
        .addScaledVector(beltUp, BELT_THICK / 2 + 0.12);
    }

    // --- feed scheduling: ambient trickle + queued bursts -> emit timer ---
    ambientTimer += dt;
    if (ambientTimer >= AMBIENT_INTERVAL) {
      ambientTimer = 0;
      pendingFeed += 1;
    }
    emitTimer += dt;
    while (emitTimer >= EMIT_INTERVAL && pendingFeed > 0 && meshCount() < MAX_MESHES) {
      emitTimer -= EMIT_INTERVAL;
      pendingFeed -= 1;
      spawnRider();
    }

    // --- ride down the belt ---
    for (let i = riding.length - 1; i >= 0; i--) {
      const r = riding[i];
      r.s += (BELT_SPEED * dt) / beltLen;
      if (r.s >= 1) {
        // discharge: hand off to a ballistic fall toward a heap slot
        riding.splice(i, 1);
        falling.push({
          mesh: r.mesh,
          vel: dir.clone().multiplyScalar(BELT_SPEED * 0.6),
          target: nextRestSlot(),
          spin: r.spin,
        });
      } else {
        placeRider(r);
      }
    }

    // --- fall + tumble onto the heap, then rest ---
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.vel.y -= GRAVITY * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      // guide horizontally toward the target slot so it lands on the mound
      const k = Math.min(1, dt * 2.5);
      f.mesh.position.x += (f.target.x - f.mesh.position.x) * k;
      f.mesh.position.z += (f.target.z - f.mesh.position.z) * k;
      f.mesh.rotation.x += f.spin.x * dt * 4;
      f.mesh.rotation.z += f.spin.z * dt * 4;
      if (f.mesh.position.y <= f.target.y) {
        f.mesh.position.copy(f.target);
        f.mesh.rotation.set(rand() * 0.25, Math.random() * Math.PI * 2, rand() * 0.25);
        falling.splice(i, 1);
        api.count++;
      }
    }
  }

  function meshCount() {
    return riding.length + falling.length + api.count;
  }

  const api = {
    count: 0,
    addBlocks(n) {
      pendingFeed += Math.max(0, n | 0);
    },
    update,
  };
  return api;
}

// small symmetric random in [-0.5, 0.5]
function rand() {
  return Math.random() - 0.5;
}

// Build the belt slab, side rails, support legs and end rollers.
function buildStructure(group, dir, side, beltUp, beltLen) {
  const mid = new THREE.Vector3().addVectors(BELT_TOP, D).multiplyScalar(0.5);
  const beltMat = new THREE.MeshLambertMaterial({ color: 0x2c2d33 });
  const railMat = new THREE.MeshLambertMaterial({ color: 0x4a4b55 });
  const legMat = new THREE.MeshLambertMaterial({ color: 0x3a3b44 });

  // Oriented sub-group: local X = down-slope, Y = belt normal, Z = across.
  const belt = new THREE.Group();
  belt.matrixAutoUpdate = false;
  belt.matrix.makeBasis(dir, beltUp, side).setPosition(mid);
  group.add(belt);

  const slab = mesh(new THREE.BoxGeometry(beltLen, BELT_THICK, BELT_WIDTH), beltMat);
  slab.castShadow = true;
  slab.receiveShadow = true;
  belt.add(slab);

  for (const z of [-BELT_WIDTH / 2 + 0.1, BELT_WIDTH / 2 - 0.1]) {
    const rail = mesh(new THREE.BoxGeometry(beltLen, 0.55, 0.2), railMat);
    rail.position.set(0, 0.35, z);
    rail.castShadow = true;
    belt.add(rail);
  }

  // End rollers (cylinders across the belt).
  const rollerGeo = new THREE.CylinderGeometry(0.45, 0.45, BELT_WIDTH + 0.3, 14);
  rollerGeo.rotateX(Math.PI / 2);
  for (const x of [-beltLen / 2, beltLen / 2]) {
    const roller = new THREE.Mesh(rollerGeo, railMat);
    roller.position.set(x, 0, 0);
    roller.castShadow = true;
    belt.add(roller);
  }

  // Support legs from the belt down to the ground (skip the top one — it would
  // poke out of the mountain the belt emerges from).
  for (const t of [0.5, 0.85]) {
    const p = new THREE.Vector3().copy(BELT_TOP).lerp(D, t);
    const h = p.y - GROUND_Y;
    const leg = mesh(new THREE.BoxGeometry(0.5, h, 0.5), legMat);
    leg.position.set(p.x, GROUND_Y + h / 2, p.z);
    leg.castShadow = true;
    group.add(leg);
  }

  // A small replica of the big tunnel portal: a flat double-sided black void with
  // stone pillars + lintel + a snow cap, the source mountain behind providing the
  // dark backing. The belt top is occluded behind the void, so the belt emerges
  // from the black exactly like the road does at the big tunnel.
  const dark = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, side: THREE.DoubleSide });
  const rockDark = new THREE.MeshLambertMaterial({ color: 0x565b66, flatShading: true });
  const snowMat = new THREE.MeshLambertMaterial({ color: 0xf3f8fd, flatShading: true });
  const up = new THREE.Vector3(0, 1, 0);
  const hdir = new THREE.Vector3(dir.x, 0, dir.z).normalize(); // belt's horizontal heading
  const hside = new THREE.Vector3().crossVectors(up, hdir).normalize();
  const portal = new THREE.Group();
  portal.matrixAutoUpdate = false;
  portal.matrix.makeBasis(hdir, up, hside).setPosition(T); // local X = out, Y = up, Z = across
  group.add(portal);

  const W = BELT_WIDTH + 4; // opening width — wide enough to show black around the belt
  const oh = 5.2; // opening height — black shows above the belt too
  const vh = oh + 0.4;

  // Flat black void filling the opening (exactly the road-tunnel approach): a
  // single double-sided black plane at the opening, framed by the stone portal.
  // The belt crosses it and disappears into the black — no recess, so no grey
  // leaks and nothing pokes out.
  const backplate = mesh(new THREE.PlaneGeometry(W + 0.6, vh), dark);
  backplate.position.set(0.1, vh / 2, 0);
  backplate.rotation.y = Math.PI / 2; // faces out toward the scene
  portal.add(backplate);

  for (const s of [-1, 1]) {
    const pillar = mesh(new THREE.BoxGeometry(0.9, oh, 1.2), rockDark);
    pillar.position.set(0.25, oh / 2, s * (W / 2 + 0.55));
    pillar.castShadow = true;
    portal.add(pillar);
  }
  const lintel = mesh(new THREE.BoxGeometry(1.0, 0.9, W + 2.4), rockDark);
  lintel.position.set(0.25, oh + 0.45, 0);
  lintel.castShadow = true;
  portal.add(lintel);
  const lintelSnow = mesh(new THREE.BoxGeometry(1.3, 0.4, W + 2.8), snowMat);
  lintelSnow.position.set(0.25, oh + 1.05, 0);
  portal.add(lintelSnow);
}

// A row of dark cleats that scroll down the belt to sell the motion.
function buildCleats(group, dir, side, beltUp, beltLen) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x202127 });
  const geo = new THREE.BoxGeometry(0.25, 0.18, BELT_WIDTH - 0.5);
  // orient cleats to the belt basis
  const quat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(dir, beltUp, side)
  );
  const cleats = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const c = new THREE.Mesh(geo, mat);
    c.quaternion.copy(quat);
    group.add(c);
    cleats.push(c);
  }
  return cleats;
}

function mesh(geo, mat) {
  return new THREE.Mesh(geo, mat);
}
