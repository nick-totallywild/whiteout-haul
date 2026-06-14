// scene.js — Phase 1: the static world. Snow ground, isometric camera,
// lighting, the looped road with a yellow center line, the depot lot, depot
// buildings and scattered pine trees. Returns a `world` handle the other
// modules add their meshes to.

import * as THREE from 'three';
import { COLORS, CAMERA, LAYOUT, TRUCK, ECONOMY } from './config.js';
import { buildParkedTruck } from './trucks.js';

/**
 * @typedef {Object} World
 * @property {THREE.Scene} scene
 * @property {THREE.PerspectiveCamera} camera
 * @property {THREE.WebGLRenderer} renderer
 * @property {() => void} render
 */

/** Build the scene, camera, renderer and all static geometry. @returns {World} */
export function createWorld(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  // Soft atmospheric haze so the distant forest + mountains fade into the sky.
  scene.fog = new THREE.Fog(COLORS.sky, 90, 300);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 500);
  camera.position.copy(CAMERA.position);
  camera.lookAt(CAMERA.lookAt);

  addLights(scene);
  scene.add(buildGround());
  scene.add(buildMountains());
  scene.add(buildTunnelMountains());
  scene.add(buildSourceMountain());
  scene.add(buildSnowDrifts());
  scene.add(buildLot());
  scene.add(buildRoad());
  scene.add(buildLoadingBays());
  scene.add(buildParking());
  const fence = buildFence();
  scene.add(fence.group);
  const gates = buildGates();
  scene.add(gates.group);
  scene.add(buildDepots());
  const workers = buildWorkers();
  scene.add(workers.group);
  scene.add(buildTrees());
  const snow = buildSnow();
  scene.add(snow.points);

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  let clock = 0;
  let underAttack = false; // bears inside the fence — Santas panic and scatter
  function update(dt) {
    clock += dt;
    snow.update(dt);
    // Santas bob and shuffle while loading; when bears get inside they cower back
    // from the lane, spin to flee and jitter in a panic.
    for (const s of workers.santas) {
      const want = underAttack ? 1 : 0;
      s.panic += (want - s.panic) * Math.min(1, dt * 4); // ease in/out
      const p = s.panic;
      s.mesh.position.y = s.baseY + Math.abs(Math.sin(clock * (3 + p * 9) + s.phase)) * (0.18 + p * 0.14);
      s.mesh.position.x = s.baseX + Math.sin(clock * (0.8 + p * 4) + s.phase) * (0.4 + p * 0.7);
      s.mesh.position.z = s.baseZ - p * 3.2; // back away from the bears on the lane
      s.mesh.rotation.x = Math.sin(clock * 2.4 + s.phase) * 0.14 * (1 - p);
      s.mesh.rotation.y = s.rotY + p * Math.PI; // turn to run
    }
    // Guards swing an arm to beckon trucks in — unless they're shooting a bear
    // (aiming) or down injured.
    for (const gd of gates.guards) {
      if (gd.down || gd.aiming) continue;
      gd.wave.rotation.x = -1.1 + Math.sin(clock * 6 + gd.phase) * 0.7;
    }
  }

  function render() {
    renderer.render(scene, camera);
  }

  function setUnderAttack(v) {
    underAttack = !!v;
  }

  return { scene, camera, renderer, fence, guards: gates.guards, setUnderAttack, update, render };
}

// Deterministic PRNG (mulberry32) so the forest/drift layout is stable across
// reloads instead of reshuffling every refresh.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addLights(scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, COLORS.snowShadow, 0.95);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(40, 60, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 70;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  scene.add(sun);
}

function buildGround() {
  const geo = new THREE.PlaneGeometry(LAYOUT.groundSize, LAYOUT.groundSize, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: COLORS.snow });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.position.y = -0.02;
  return mesh;
}

// The paved depot lot — a flat slab the depot + pile sit on, slightly raised.
function buildLot() {
  const { lotCenter, lotSize } = LAYOUT;
  const geo = new THREE.BoxGeometry(lotSize.x, 0.3, lotSize.z);
  const mat = new THREE.MeshLambertMaterial({ color: COLORS.lot });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(lotCenter.x, 0.14, lotCenter.z);
  mesh.receiveShadow = true;
  return mesh;
}

// The loading road: one straight wide strip along X (the drive-in / drive-out
// lane) with a dashed yellow center line. It runs off both lot edges into the
// fog so trucks appear to arrive and depart endlessly.
function buildRoad() {
  const group = new THREE.Group();
  const { z, width, roadFromX, roadToX } = LAYOUT.lane;
  const len = roadToX - roadFromX;
  const midX = (roadFromX + roadToX) / 2;
  const roadMat = new THREE.MeshLambertMaterial({ color: COLORS.road });
  const lineMat = new THREE.MeshBasicMaterial({ color: COLORS.roadLine });

  const road = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, width), roadMat);
  road.position.set(midX, 0.05, z);
  road.receiveShadow = true;
  group.add(road);

  // Dashed center line down the middle of the lane.
  const dashes = Math.floor(len / 2.6);
  for (let d = 0; d < dashes; d++) {
    const x = roadFromX + (d + 0.5) * (len / dashes);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.34), lineMat);
    dash.position.set(x, 0.09, z);
    group.add(dash);
  }
  return group;
}

// Depot buildings beside the lot — simple box bodies with bright roofs.
function buildDepots() {
  const group = new THREE.Group();
  const positions = [
    LAYOUT.depotPos.clone(),
    LAYOUT.depotPos.clone().add(new THREE.Vector3(0, 0, -8)),
  ];
  for (const p of positions) group.add(buildDepot(p));
  return group;
}

function buildDepot(pos) {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(6, 3.4, 6),
    new THREE.MeshLambertMaterial({ color: COLORS.depotWall })
  );
  wall.position.y = 1.7 + 0.3;
  wall.castShadow = true;
  wall.receiveShadow = true;
  g.add(wall);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(6.6, 0.5, 6.6),
    new THREE.MeshLambertMaterial({ color: COLORS.depotRoof })
  );
  roof.position.y = 3.7 + 0.3;
  roof.castShadow = true;
  g.add(roof);

  g.position.set(pos.x, 0, pos.z);
  return g;
}

// A dense snowy pine forest scattered around the site (thickest behind it), kept
// off the lot, out of the road corridor, and out of the mountains. Trees grow in
// loose clusters for a more natural treeline.
function buildTrees() {
  const group = new THREE.Group();
  const rng = makeRng(1337);

  const onLot = (x, z) => x > -42 && x < 46 && z > -32 && z < 16;
  const onRoad = (x, z) => z > -12 && z < -2; // drive corridor (full width)
  // Keep only a clear sightline corridor from the camera to the loading bay open;
  // the rest of the foreground (incl. the bottom of the screen) fills with trees.
  const blocksView = (x, z) => z > 6 && x > -2 && x < 30;
  const blocked = (x, z) =>
    onLot(x, z) || onRoad(x, z) || blocksView(x, z) || nearMountain(x, z);

  let placed = 0;
  let guard = 0;
  while (placed < 480 && guard < 36000) {
    guard++;
    // pick a cluster seed, then drop a few trees around it. Bias toward the
    // foreground bottom (around the buttons), front-left, and behind the dock.
    let sx, sz;
    const r = rng();
    if (r < 0.28) {
      sx = -100 + rng() * 200; // foreground bottom, full width
      sz = 16 + rng() * 44; // [16, 60]
    } else if (r < 0.48) {
      sx = -110 + rng() * 86; // [-110, -24] front-left band
      sz = -8 + rng() * 64; // [-8, 56]
    } else if (r < 0.68) {
      sx = -110 + rng() * 220; // full width
      sz = -82 + rng() * 48; // [-82, -34] background band behind the dock
    } else {
      sx = -110 + rng() * 220; // [-110, 110]
      sz = -82 + rng() * 142; // [-82, 60]
    }
    if (blocked(sx, sz)) continue;
    const clusterN = 1 + Math.floor(rng() * 4);
    for (let c = 0; c < clusterN && placed < 480; c++) {
      const x = sx + (rng() - 0.5) * 9;
      const z = sz + (rng() - 0.5) * 9;
      if (blocked(x, z)) continue;
      const backness = (15 - z) / 105; // ~1 far back, ~0 front
      const scale = 0.65 + rng() * 0.7 + Math.max(0, backness) * 0.8;
      group.add(buildPine(x, z, scale, rng));
      placed++;
    }
  }
  return group;
}

// Shared pine materials (built once, reused by every tree).
const PINE_FOLIAGE = [
  new THREE.MeshLambertMaterial({ color: COLORS.pine, flatShading: true }),
  new THREE.MeshLambertMaterial({ color: COLORS.pineDark, flatShading: true }),
];
const PINE_SNOW = new THREE.MeshLambertMaterial({ color: COLORS.pineSnow, flatShading: true });
const PINE_TRUNK = new THREE.MeshLambertMaterial({ color: COLORS.treeTrunk, flatShading: true });

// Painted loading-bay markings + numbers on the lane, one per potential bay
// (bays unlock left-to-right via the Bays upgrade). The number sits at the
// camera-side edge of each bay so it stays visible when a truck is parked.
function buildLoadingBays() {
  const group = new THREE.Group();
  const white = new THREE.MeshBasicMaterial({ color: 0xf4d23a }); // loading-zone yellow
  const bayX = LAYOUT.lane.bayX;
  const gap = TRUCK.queueGap;
  const z = LAYOUT.lane.z;
  const maxBays = 1 + ECONOMY.upgrades.bay.maxLevel;
  const lenX = TRUCK.size.x + 1.2; // bay box length along the lane
  const wZ = TRUCK.size.z + 1.6; // bay box width across the lane
  const y = 0.31; // just above the paved lot surface (so it isn't buried)

  for (let i = 0; i < maxBays; i++) {
    const cx = bayX + i * gap;
    // rectangle outline (4 thin painted lines)
    for (const sx of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, wZ), white);
      line.position.set(cx + (sx * lenX) / 2, y, z);
      group.add(line);
    }
    for (const sz of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(lenX, 0.04, 0.16), white);
      line.position.set(cx, y, z + (sz * wZ) / 2);
      group.add(line);
    }
    // bay number, painted flat near the camera-side edge so a parked truck
    // doesn't hide it
    const num = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: makeNumberTexture(i + 1), transparent: true })
    );
    num.rotation.x = -Math.PI / 2;
    num.rotation.z = -Math.PI / 4; // angle the digit to read from the iso camera
    num.position.set(cx, y, z + wZ / 2 + 1.2);
    group.add(num);
  }
  return group;
}

function makeNumberTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#f4d23a';
  ctx.font = 'bold 54px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 32, 36);
  const t = new THREE.CanvasTexture(c);
  return t;
}

// A small parking lot in the expanded front area: 6 painted bays with a parked
// truck in each, fronts facing the camera.
function buildParking() {
  const group = new THREE.Group();
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xeef2f7 });
  const lotTop = 0.3; // top surface of the paved lot
  const slots = 6;
  const slotW = 3.9;
  const zBack = 6;
  const zFront = 12;
  const depth = zFront - zBack;
  const zMid = (zBack + zFront) / 2;
  const xLeft = 2 - (slots * slotW) / 2; // centred on the lot (x≈2)

  // dividing lines between bays (run front-to-back) + a back line
  for (let i = 0; i <= slots; i++) {
    const x = xLeft + i * slotW;
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, depth), lineMat);
    line.position.set(x, lotTop + 0.01, zMid);
    group.add(line);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(slots * slotW, 0.05, 0.18), lineMat);
  back.position.set(xLeft + (slots * slotW) / 2, lotTop + 0.01, zBack);
  group.add(back);

  // a parked truck in each bay, front (+local X) rotated to point toward camera
  for (let i = 0; i < slots; i++) {
    const t = buildParkedTruck();
    t.position.set(xLeft + (i + 0.5) * slotW, lotTop, zMid - 0.3);
    t.rotation.y = -Math.PI / 2; // front faces +z (toward the camera)
    group.add(t);
  }
  return group;
}

// Little "santa" loader figures working at the loading bay. They stand just in
// front of the pile (clear of the falling blocks) and bob/lean as if shovelling
// metal into the trucks. Returns the group plus per-figure animation state.
function buildWorkers() {
  const group = new THREE.Group();
  // z ~ -8.5: in front of the pile front edge (pile centre z=-18, radius 6 →
  // front at -12) and just behind the bay truck (z=-7), so no blocks land on them.
  // One worker near each potential loading bay (bays run from x≈-6 toward the
  // entrance, spaced by the queue gap), facing the trucks at the lane (z=-7).
  const spots = [
    [-6, -9, 0.1],
    [0, -9.2, -0.1],
    [6, -9, 0.15],
    [12, -9.2, -0.1],
    [18, -9, 0.2],
  ];
  const santas = [];
  let i = 0;
  for (const [x, z, rot] of spots) {
    const s = buildSanta();
    s.position.set(x, 0, z);
    s.rotation.y = rot;
    group.add(s);
    santas.push({ mesh: s, baseX: x, baseY: 0, baseZ: z, rotY: rot, phase: i * 2.1, panic: 0 });
    i++;
  }
  return { group, santas };
}

function buildSanta() {
  const g = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0xd0322d });
  const white = new THREE.MeshLambertMaterial({ color: 0xf6f6f6 });
  const black = new THREE.MeshLambertMaterial({ color: 0x262626 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b58f });

  // Two black boots.
  for (const x of [-0.22, 0.22]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.6), black);
    boot.position.set(x, 0.2, 0.05);
    g.add(boot);
  }

  // Chunky red torso (box) — clearly a body, not a cone.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.05, 0.7), red);
  torso.position.y = 1.0;
  g.add(torso);

  // White coat trim down the front + black belt with buckle.
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.05, 0.04), white);
  trim.position.set(0, 1.0, 0.36);
  g.add(trim);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.99, 0.22, 0.74), black);
  belt.position.y = 0.7;
  g.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.04), white);
  buckle.position.set(0, 0.7, 0.38);
  g.add(buckle);

  // Arms reaching forward (loading gesture).
  for (const x of [-0.62, 0.62]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.7), red);
    arm.position.set(x, 1.15, 0.3);
    arm.rotation.x = -0.5;
    g.add(arm);
    const mitten = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), white);
    mitten.position.set(x, 1.0, 0.62);
    g.add(mitten);
  }

  // Head with a big white beard.
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.46, 0.46), skin);
  head.position.y = 1.85;
  g.add(head);
  const beard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.2), white);
  beard.position.set(0, 1.72, 0.22);
  g.add(beard);

  // Red hat with white brim + pom.
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.52), white);
  brim.position.y = 2.12;
  g.add(brim);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 10), red);
  hat.position.set(0, 2.42, -0.05);
  g.add(hat);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), white);
  pom.position.set(0, 2.7, -0.1);
  g.add(pom);

  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return g;
}

// A low-poly evergreen: brown trunk, a stack of green foliage tiers (count and
// proportions vary per tree), each dusted with a snow cap. A slight random lean
// and rotation keep the forest from looking like a regular grid.
function buildPine(x, z, scale = 1, rng = Math.random) {
  const g = new THREE.Group();
  const foliage = PINE_FOLIAGE[rng() < 0.5 ? 0 : 1]; // mix two greens

  const trunkH = 1.0 + rng() * 0.8;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, trunkH, 6), PINE_TRUNK);
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  g.add(trunk);

  const tierCount = 3 + (rng() < 0.5 ? 0 : 1); // 3 or 4 tiers
  let y = trunkH + 0.1;
  let r = 1.5 + rng() * 0.6;
  for (let i = 0; i < tierCount; i++) {
    const h = r * 1.25;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), foliage);
    cone.position.y = y + h / 2;
    cone.castShadow = true;
    g.add(cone);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.58, h * 0.4, 7), PINE_SNOW);
    cap.position.y = y + h * 0.8;
    g.add(cap);
    y += h * 0.62; // overlap tiers
    r *= 0.72; // each tier narrower
  }

  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  g.rotation.y = rng() * Math.PI * 2;
  // gentle lean
  g.rotation.x = (rng() - 0.5) * 0.12;
  g.rotation.z = (rng() - 0.5) * 0.12;
  return g;
}

// Distant snow peaks around the horizon (fixed sizes so the tree keep-out can
// match them exactly). Mostly behind the site; the fog fades them into the sky.
const RING_PEAKS = [
  { x: -85, z: -125, h: 74, r: 54 },
  { x: -42, z: -140, h: 88, r: 64 },
  { x: -2, z: -148, h: 80, r: 60 },
  { x: 40, z: -140, h: 88, r: 64 },
  { x: 82, z: -125, h: 74, r: 54 },
  { x: 125, z: -95, h: 66, r: 48 },
  { x: -132, z: -88, h: 66, r: 48 },
  { x: -138, z: -34, h: 58, r: 42 },
  { x: 138, z: -38, h: 58, r: 42 },
  { x: -130, z: 26, h: 50, r: 36 },
  { x: 134, z: 30, h: 50, r: 36 },
];

function buildMountains() {
  const group = new THREE.Group();
  const rockMat = new THREE.MeshLambertMaterial({ color: COLORS.mountain, flatShading: true });
  const snowMat = new THREE.MeshLambertMaterial({ color: COLORS.mountainSnow, flatShading: true });
  let i = 0;
  for (const p of RING_PEAKS) {
    const rot = (i++ * 1.7) % Math.PI;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(p.r, p.h, 6), rockMat);
    mountain.position.set(p.x, p.h / 2 - 1, p.z);
    mountain.rotation.y = rot;
    group.add(mountain);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(p.r * 0.45, p.h * 0.38, 6), snowMat);
    cap.position.set(p.x, p.h - p.h * 0.19 - 1, p.z);
    cap.rotation.y = rot;
    group.add(cap);
  }
  return group;
}

// A snowy mountain at each end of the road with a tunnel mouth the trucks drive
// into (and emerge from), so the road disappears into the mountain instead of
// running off into the air.
function buildTunnelMountains() {
  const group = new THREE.Group();
  // Only the exit (left) tunnel — trucks drive in on the open road from the right.
  group.add(buildTunnelMountain(LAYOUT.lane.tunnelLeftX, +1)); // opens toward +x
  return group;
}

function buildTunnelMountain(mouthX, openSign) {
  const g = new THREE.Group();
  const z = LAYOUT.lane.z;
  const rock = new THREE.MeshLambertMaterial({ color: COLORS.mountain, flatShading: true });
  const rockDark = new THREE.MeshLambertMaterial({ color: 0x565b66, flatShading: true });
  const snow = new THREE.MeshLambertMaterial({ color: COLORS.mountainSnow, flatShading: true });
  // Pure unlit black (double-sided so the flat face always shows) for the void.
  const dark = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, side: THREE.DoubleSide });

  const W = LAYOUT.lane.width + 3.2;
  const oh = 6.2; // portal opening height
  const vh = oh + 0.5; // black extends a touch above the opening (lintel covers it)

  // --- the mountain: a big snow-capped cone whose base-front edge sits just
  // behind the portal, so it rises behind the tunnel without burying the road. ---
  const R = 30;
  const H = 44;
  const coneCenter = mouthX - openSign * (R + 2); // base front edge ≈ mouthX - 2
  const peak = new THREE.Mesh(new THREE.ConeGeometry(R, H, 7), rock);
  peak.position.set(coneCenter, H / 2 - 1, z);
  peak.rotation.y = 0.5;
  peak.receiveShadow = true;
  g.add(peak);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(R * 0.46, H * 0.4, 7), snow);
  cap.position.set(coneCenter, H - H * 0.2 - 1, z);
  cap.rotation.y = 0.5;
  g.add(cap);
  // a secondary peak so it isn't a perfect cone
  const peak2 = new THREE.Mesh(new THREE.ConeGeometry(18, 26, 6), rock);
  peak2.position.set(coneCenter - openSign * 12, 12, z - 16);
  peak2.rotation.y = 1.1;
  g.add(peak2);
  const cap2 = new THREE.Mesh(new THREE.ConeGeometry(8, 11, 6), snow);
  cap2.position.set(coneCenter - openSign * 12, 22, z - 16);
  g.add(cap2);

  // --- black portal: a flat black face at the cone base front (the cone behind
  // is solid, so no box recess is needed — that avoids any black poking out). ---
  const backplate = new THREE.Mesh(new THREE.PlaneGeometry(W + 1.2, vh), dark);
  backplate.position.set(mouthX - openSign * 0.2, vh / 2, z);
  backplate.rotation.y = openSign > 0 ? -Math.PI / 2 : Math.PI / 2;
  g.add(backplate);

  // side pillars flank the opening; lintel + snow sit ABOVE it (void stays clear),
  // no threshold at the base so the void meets the road in a crisp line.
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.0, oh, 1.4), rockDark);
    pillar.position.set(mouthX + openSign * 0.2, oh / 2, z + s * (W / 2 + 0.6));
    pillar.castShadow = true;
    g.add(pillar);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, W + 2.6), rockDark);
  lintel.position.set(mouthX + openSign * 0.2, oh + 0.55, z); // bottom meets the void top
  lintel.castShadow = true;
  g.add(lintel);
  const lintelSnow = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, W + 3.0), snow);
  lintelSnow.position.set(mouthX + openSign * 0.2, oh + 1.3, z);
  g.add(lintelSnow);
  return g;
}

// Procedural chain-link texture (transparent PNG-like) for the wire-mesh fence.
let _chainTex = null;
function chainLinkTexture() {
  if (_chainTex) return _chainTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(210,220,230,0.9)';
  ctx.lineWidth = 3;
  // diagonal lattice = chain-link look
  for (let i = -64; i < 64; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 64, 64);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + 64, 0);
    ctx.lineTo(i, 64);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _chainTex = tex;
  return tex;
}

// Wire-mesh fence around the loading dock, with gaps where the road passes
// through (those gaps get boom gates).
// Builds the perimeter fence and returns { group, segments }. Each run is split
// into short destructible segments (panel + rail) so bears can claw a specific
// stretch down and leave a visible gap. Returns the segment list for bears.js.
function buildFence() {
  const group = new THREE.Group();
  const x0 = -34;
  const x1 = 40;
  const z0 = -30;
  const z1 = 15; // front edge moved down with the expanded lot
  const roadZ = LAYOUT.lane.z;
  // Opening wide enough that the fence never overlaps the wide tunnel void
  // behind it (otherwise the chain-link reads as grey lines across the black).
  const halfGap = LAYOUT.lane.width / 2 + 3.5;

  const segments = [];
  // Full perimeter fence with a wide road gap on each side for the gates.
  addFenceRun(group, segments, x0, x1, z1, 'x'); // front
  addFenceRun(group, segments, x0, x1, z0, 'x'); // back
  addFenceRun(group, segments, z0, roadZ - halfGap, x0, 'z'); // left, rear of the gap
  addFenceRun(group, segments, roadZ + halfGap, z1, x0, 'z'); // left, front of the gap
  addFenceRun(group, segments, z0, roadZ - halfGap, x1, 'z'); // right, rear of the gap
  addFenceRun(group, segments, roadZ + halfGap, z1, x1, 'z'); // right, front of the gap
  return { group, segments };
}

// Build a fence run between two coords along `axis` ('x' or 'z') at the fixed
// other coord, split into ~6-unit destructible segments. Posts at the joins.
function addFenceRun(group, segments, a0, a1, fixed, axis) {
  const total = Math.abs(a1 - a0);
  if (total < 0.5) return;
  const H = 3.0;
  const postMat = new THREE.MeshLambertMaterial({ color: 0x9aa1ab });
  const railMat = new THREE.MeshLambertMaterial({ color: 0x9aa1ab });
  const dir = Math.sign(a1 - a0) || 1;

  // split the run into roughly-equal segments ~6 units long
  const segCount = Math.max(1, Math.round(total / 6));
  const segLen = (a1 - a0) / segCount;

  const baseMat = new THREE.MeshLambertMaterial({
    map: chainLinkTexture(),
    transparent: true,
    alphaTest: 0.25,
    side: THREE.DoubleSide,
    color: 0xdfe6ee,
  });

  for (let s = 0; s < segCount; s++) {
    const sa = a0 + s * segLen;
    const sb = sa + segLen;
    const mid = (sa + sb) / 2;
    const len = Math.abs(segLen);

    const meshMat = baseMat.clone();
    const tex = baseMat.map.clone();
    tex.repeat.set(len / 2.4, H / 2.4);
    tex.needsUpdate = true;
    meshMat.map = tex;

    const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, H), meshMat);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.1), railMat.clone());
    const mx = axis === 'x' ? mid : fixed;
    const mz = axis === 'x' ? fixed : mid;
    if (axis === 'x') {
      panel.position.set(mid, H / 2, fixed);
      rail.position.set(mid, H - 0.1, fixed);
    } else {
      panel.rotation.y = Math.PI / 2;
      panel.position.set(fixed, H / 2, mid);
      rail.rotation.y = Math.PI / 2;
      rail.position.set(fixed, H - 0.1, mid);
    }
    group.add(panel, rail);
    // record an addressable segment for the bear-raid damage system
    segments.push({ panel, rail, axis, height: H, mid: { x: mx, z: mz } });
  }

  // posts at every segment join (slightly more than before — looks sturdier)
  const n = segCount;
  for (let i = 0; i <= n; i++) {
    const t = a0 + (i / n) * (a1 - a0);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, H + 0.3, 6), postMat);
    post.castShadow = true;
    if (axis === 'x') post.position.set(t, (H + 0.3) / 2, fixed);
    else post.position.set(fixed, (H + 0.3) / 2, t);
    group.add(post);
  }
  void dir;
}

// Boom gates + guards at the two road openings in the fence. Returns the group
// plus the guards' waving-arm pivots so they can beckon trucks in.
function buildGates() {
  const group = new THREE.Group();
  const roadZ = LAYOUT.lane.z;
  // gate posts sit just outside the fence opening, on the +z side of the road
  group.add(buildBoomGate(40, roadZ, -0.5)); // right opening (entrance)
  group.add(buildBoomGate(-34, roadZ, 0.5)); // left opening (exit)
  // guards beside each gate, facing the incoming trucks (+x), waving them through
  const guards = [];
  const a = placeGuard(44, roadZ + 5.5, Math.PI / 2);
  const b = placeGuard(-38, roadZ + 5.5, Math.PI / 2);
  group.add(a.group, b.group);
  // full guard records so bears.js can drive their rifles + injury state
  guards.push(
    { ...a, phase: 0, down: false, downT: 0, aiming: false, fireT: 0 },
    { ...b, phase: 1.6, down: false, downT: 0, aiming: false, fireT: 0 }
  );
  return { group, guards };
}

function buildBoomGate(x, z, armTilt) {
  const g = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0xf0a830 });
  const boothMat = new THREE.MeshLambertMaterial({ color: 0xb8c0cc });

  // little guard booth on the +z side of the road
  const booth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 2.2), boothMat);
  booth.position.set(x, 1.3, z + LAYOUT.lane.width / 2 + 2.2);
  booth.castShadow = true;
  g.add(booth);
  const boothRoof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 2.6), new THREE.MeshLambertMaterial({ color: 0x7fc7e8 }));
  boothRoof.position.set(x, 2.8, z + LAYOUT.lane.width / 2 + 2.2);
  g.add(boothRoof);

  // boom post + striped arm (raised) reaching across the road
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.4, 8), postMat);
  post.position.set(x, 1.2, z + LAYOUT.lane.width / 2 + 0.4);
  post.castShadow = true;
  g.add(post);

  const arm = buildBoomArm();
  arm.position.set(x, 2.1, z + LAYOUT.lane.width / 2 + 0.4);
  arm.rotation.z = Math.PI / 2 - 0.5; // raised, open
  arm.rotation.y = 0;
  g.add(arm);
  return g;
}

// A red/white striped barrier arm built from alternating segments.
function buildBoomArm() {
  const arm = new THREE.Group();
  const segLen = 0.9;
  const n = 7;
  const red = new THREE.MeshLambertMaterial({ color: 0xd0322d });
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
  for (let i = 0; i < n; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.18, 0.18), i % 2 ? white : red);
    seg.position.x = i * segLen + segLen / 2;
    seg.castShadow = true;
    arm.add(seg);
  }
  return arm;
}

// The mountain the conveyor emerges from — sits behind the pile so the belt's
// intake is buried in its slope and the metal looks like it comes out of the
// mountain.
function buildSourceMountain() {
  const g = new THREE.Group();
  const rock = new THREE.MeshLambertMaterial({ color: COLORS.mountain, flatShading: true });
  const snow = new THREE.MeshLambertMaterial({ color: COLORS.mountainSnow, flatShading: true });
  const cx = -34;
  const cz = -46;
  const R = 24;
  const H = 32;
  const peak = new THREE.Mesh(new THREE.ConeGeometry(R, H, 7), rock);
  peak.position.set(cx, H / 2 - 1, cz);
  peak.rotation.y = 0.6;
  g.add(peak);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(R * 0.5, H * 0.42, 7), snow);
  cap.position.set(cx, H - H * 0.21 - 1, cz);
  cap.rotation.y = 0.6;
  g.add(cap);
  // a shoulder so the conveyor appears to exit a notch in the slope
  const shoulder = new THREE.Mesh(new THREE.ConeGeometry(R * 0.75, H * 0.7, 6), rock);
  shoulder.position.set(cx + 8, H * 0.34 - 1, cz + 9);
  shoulder.rotation.y = 1.3;
  g.add(shoulder);
  return g;
}

// Keep-out discs around every mountain mass so trees never clip into rock:
// the ring peaks (their own base radius + margin), the two tunnel mountains, and
// the conveyor source mountain.
const MOUNTAIN_KEEPOUT = [
  ...RING_PEAKS.map((p) => ({ x: p.x, z: p.z, r: p.r + 3 })),
  { x: -70, z: LAYOUT.lane.z, r: 40 }, // exit tunnel mountain (cone sits well back)
  { x: -34, z: -46, r: 28 }, // conveyor source mountain
];

function nearMountain(x, z) {
  for (const m of MOUNTAIN_KEEPOUT) {
    if ((x - m.x) ** 2 + (z - m.z) ** 2 < m.r * m.r) return true;
  }
  return false;
}

// A site guard (navy uniform, hi-vis vest, peaked cap) standing by a gate. The
// returned object exposes the right arm pivot so it can beckon trucks in.
function placeGuard(x, z, rot) {
  const { group, wave, gun, muzzle } = buildGuard();
  group.position.set(x, 0, z);
  group.rotation.y = rot;
  return { group, wave, gun, muzzle, pos: new THREE.Vector3(x, 0, z), baseYaw: rot };
}

function buildGuard() {
  const g = new THREE.Group();
  const navy = new THREE.MeshLambertMaterial({ color: 0x2b3550 });
  const vest = new THREE.MeshLambertMaterial({ color: 0xf2c14e });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b58f });

  for (const x of [-0.2, 0.2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 0.32), navy);
    leg.position.set(x, 0.45, 0);
    g.add(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.95, 0.5), navy);
  torso.position.y = 1.35;
  g.add(torso);
  const hiviz = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.7, 0.54), vest);
  hiviz.position.y = 1.45;
  g.add(hiviz);
  // left arm (static, at side)
  const larm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.85, 0.26), navy);
  larm.position.set(-0.52, 1.3, 0);
  g.add(larm);
  // right arm on a shoulder pivot so it can swing forward to beckon trucks in
  const wave = new THREE.Group();
  wave.position.set(0.52, 1.75, 0); // shoulder
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.8, 0.24), navy);
  upper.position.y = -0.4; // hang down from the shoulder pivot
  wave.add(upper);
  const mitt = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), vest);
  mitt.position.y = -0.85;
  wave.add(mitt);
  g.add(wave);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), skin);
  head.position.y = 2.05;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), navy);
  cap.position.y = 2.32;
  g.add(cap);
  const peak = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.2), navy);
  peak.position.set(0, 2.26, 0.32);
  g.add(peak);

  // M-16 rifle held across the chest, pointing the guard's facing direction
  // (local +Z). The whole guard yaws to aim, so the rifle tracks the target.
  const gunMetal = new THREE.MeshLambertMaterial({ color: 0x23252b, flatShading: true });
  const bx = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), gunMetal);
  const gun = new THREE.Group();
  gun.position.set(0.16, 1.3, 0.2);
  const stock = bx(0.1, 0.16, 0.34); stock.position.set(0, -0.02, -0.22);
  const body = bx(0.1, 0.17, 0.5); body.position.set(0, 0, 0.06);
  const mag = bx(0.08, 0.26, 0.12); mag.position.set(0, -0.18, 0.04);
  const handle = bx(0.07, 0.1, 0.2); handle.position.set(0, 0.14, 0.04); // carry handle/sight
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 6), gunMetal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, 0.6);
  gun.add(stock, body, mag, handle, barrel);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, 1.0);
  gun.add(muzzle);
  g.add(gun);

  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  g.scale.setScalar(0.95);
  return { group: g, wave, gun, muzzle };
}

// Gentle snow mounds dotted over the open snow for a bit of surface relief.
function buildSnowDrifts() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: COLORS.snow });
  const rng = makeRng(7);
  for (let i = 0; i < 26; i++) {
    const x = -75 + rng() * 155;
    const z = -60 + rng() * 95;
    if (x > -44 && x < 48 && z > -34 && z < 8) continue; // not on the lot
    if (z > -12 && z < -2) continue; // not on the road
    const w = 2.5 + rng() * 5;
    const drift = new THREE.Mesh(new THREE.SphereGeometry(w, 8, 5), mat);
    drift.scale.y = 0.18 + rng() * 0.12; // squash into a low mound
    drift.position.set(x, -w * (1 - drift.scale.y) - 0.1, z);
    drift.receiveShadow = true;
    group.add(drift);
  }
  return group;
}

// A drifting field of falling snowflakes around the camera view.
function buildSnow() {
  const COUNT = 700;
  const range = { x: 150, y: 55, z: 130 };
  const origin = { x: -10, z: -20 }; // roughly centred on the scene
  const positions = new Float32Array(COUNT * 3);
  const speeds = new Float32Array(COUNT);
  const rng = makeRng(2024);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = origin.x + (rng() - 0.5) * range.x;
    positions[i * 3 + 1] = rng() * range.y;
    positions[i * 3 + 2] = origin.z + (rng() - 0.5) * range.z;
    speeds[i] = 2.5 + rng() * 3.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: COLORS.snowParticle,
    size: 0.45,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  let drift = 0;
  function update(dt) {
    drift += dt;
    const p = geo.attributes.position.array;
    const sway = Math.sin(drift * 0.6) * 0.4;
    for (let i = 0; i < COUNT; i++) {
      p[i * 3 + 1] -= speeds[i] * dt; // fall
      p[i * 3] += sway * dt * 2; // gentle horizontal sway
      if (p[i * 3 + 1] < 0) {
        // recycle to the top with a fresh column position
        p[i * 3 + 1] = range.y;
        p[i * 3] = origin.x + ((i * 73) % 100) / 100 * range.x - range.x / 2;
      }
    }
    geo.attributes.position.needsUpdate = true;
  }

  return { points, update };
}
