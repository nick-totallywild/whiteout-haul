// scene.js — Phase 1: the static world. Snow ground, isometric camera,
// lighting, the looped road with a yellow center line, the depot lot, depot
// buildings and scattered pine trees. Returns a `world` handle the other
// modules add their meshes to.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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

  // A soft image-based environment so PBR (MeshStandard) materials — the
  // remodeled bears and gunners — pick up gentle highlights and metallic
  // reflections. Only affects MeshStandard/Physical materials; the flat-shaded
  // Lambert world is untouched. Generated once, no external asset needed.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

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
  const trees = buildTrees();
  scene.add(trees.group);
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
  let avalancheHold = false; // avalanche incoming/on the lane — loaders hold clear
  let truckXs = []; // x of trucks stopped at the bay — loaders only serve a near one
  const SERVE_RANGE = 5; // how close (in x, ≈1 truck slot) a stopped truck must be
  function update(dt) {
    clock += dt;
    snow.update(dt);
    // Santas bob and shuffle while loading; when bears get inside they cower back
    // from the lane, spin to flee and jitter in a panic.
    for (const s of workers.santas) {
      const want = underAttack ? 1 : 0;
      s.panic += (want - s.panic) * Math.min(1, dt * 4); // ease in/out
      const p = s.panic;
      const u = s.mesh.userData;
      const k = (rate) => Math.min(1, dt * rate); // smoothing helper

      // Service cycle: wait outside the lot -> dart in (bucket rising) -> hold
      // the load high over the bed -> reverse back out. Bears interrupt it: drop
      // the load and retreat well clear of the lane.
      // The bucket is assumed already loaded (bars always in it). A loader just
      // waits outside, darts in to a stopped truck, TIPS the bucket to drop the
      // load into the bed, then reverses back out. Only the bucket tilts.
      if (p > 0.4) {
        // bears inside: level the bucket and retreat well clear of the lane
        s.tip += (0 - s.tip) * k(5);
        s.z += ((s.baseZ - 3) - s.z) * k(3.5);
        s.state = 'wait';
        s.timer = 1.5;
      } else if (avalancheHold) {
        // avalanche incoming / on the lane: stop and hold at staging until clear
        s.tip += (0 - s.tip) * k(4);
        s.z += (s.baseZ - s.z) * k(4);
        s.state = 'wait';
        s.timer = 0.3;
      } else {
        s.timer -= dt;
        if (s.state === 'wait') {
          s.tip += (0 - s.tip) * k(5); // bucket level (holding the load)
          s.z += (s.baseZ - s.z) * k(5);
          // only move in once a truck has actually stopped within ~1 slot of us
          const truckHere = truckXs.some((tx) => Math.abs(tx - s.baseX) < SERVE_RANGE);
          if (s.timer <= 0 && truckHere) s.state = 'serve';
        } else if (s.state === 'serve') {
          s.tip += (0 - s.tip) * k(6); // carry it in level
          s.z += (s.targetZ - s.z) * k(7); // dart in fast
          if (Math.abs(s.z - s.targetZ) < 0.15) { s.state = 'dump'; s.timer = 0.6; }
        } else if (s.state === 'dump') {
          s.tip += (1 - s.tip) * k(7); // tip the bucket forward to drop the load
          if (s.timer <= 0) s.state = 'return';
        } else { // return
          s.tip += (0 - s.tip) * k(6); // level the bucket again
          s.z += (s.baseZ - s.z) * k(7); // reverse back out fast
          if (Math.abs(s.z - s.baseZ) < 0.15) { s.state = 'wait'; s.timer = 0.5 + (s.phase % 2) * 0.4; }
        }
      }

      s.mesh.position.set(s.baseX + p * Math.sin(clock * 7 + s.phase) * 0.3, 0, s.z);
      s.mesh.rotation.y = s.rotY + p * 0.4 * Math.sin(clock * 4 + s.phase);
      if (u.bucket) u.bucket.rotation.x = u.bucketX0 + s.tip * 1.15; // only the bucket tilts, to dump
      if (u.arms) {
        const a = -0.1 + (s.state === 'serve' || s.state === 'return' ? 0.18 : 0); // grip while driving
        for (const arm of u.arms) arm.rotation.x = a;
      }
    }
    // Guards stand at the post holding the rifle two-handed at the low ready;
    // when a bear comes into range they smoothly raise it to a shouldered aim
    // (a small, natural motion) and chatter with recoil.
    for (const gd of gates.guards) {
      if (gd.down) continue;
      gd.aimT = (gd.aimT || 0) + ((gd.aiming ? 1 : 0) - (gd.aimT || 0)) * Math.min(1, dt * 10);
      const a = gd.aimT;
      const breathe = Math.sin(clock * 1.6 + gd.phase) * 0.03 * (1 - a); // subtle idle life
      // right (trigger) hand stays on the grip; left (support) hand on the foregrip
      gd.wave.rotation.x = -0.6 - 0.75 * a;
      gd.wave.rotation.z = 0.5 - 0.1 * a;
      if (gd.larm) {
        gd.larm.rotation.x = -1.15 - 0.3 * a;
        gd.larm.rotation.z = -0.4 - 0.15 * a;
      }
      // weapon: low-ready across the body -> shouldered and level when aiming
      if (gd.gun) {
        gd.gun.position.set(0.12 - 0.07 * a, 1.2 + 0.3 * a + breathe, 0.22 + 0.06 * a);
        gd.gun.rotation.x = 0.18 * (1 - a); // muzzle dips at the ready, levels to aim
        if (gd.aiming) gd.gun.position.z += Math.sin(clock * 46) * 0.02 * a; // recoil
      }
    }
  }

  function render() {
    renderer.render(scene, camera);
  }

  function setUnderAttack(v) {
    underAttack = !!v;
  }
  function setAvalancheHold(v) {
    avalancheHold = !!v;
  }
  function setTruckXs(xs) {
    truckXs = xs || [];
  }

  return { scene, camera, renderer, fence, guards: gates.guards, treeObstacles: trees.obstacles, setUnderAttack, setAvalancheHold, setTruckXs, update, render };
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
  const obstacles = []; // { x, z, r } footprints so bears can't walk through trees
  const rng = makeRng(1337);
  // Bake every tree's geometry into a few merged meshes (one per material) so a
  // dense forest costs a handful of draw calls instead of thousands.
  const buckets = new Map(); // material -> [baked geometry, ...]
  const bucketOf = (mat) => { let a = buckets.get(mat); if (!a) buckets.set(mat, (a = [])); return a; };

  // Keep a clear margin around the whole perimeter fence (x∈[-34,40], z∈[-30,15])
  // so trees never crowd the fence or the barbed wire — a few metres of open
  // ground all the way round, like a cleared firebreak.
  const FENCE_CLEAR = 6;
  const nearFence = (x, z) =>
    x > -34 - FENCE_CLEAR && x < 40 + FENCE_CLEAR && z > -30 - FENCE_CLEAR && z < 15 + FENCE_CLEAR;
  const onRoad = (x, z) => z > -12 && z < -2; // drive corridor (full width)
  // Keep only a clear sightline corridor from the camera to the loading bay open;
  // the rest of the foreground (incl. the bottom of the screen) fills with trees.
  const blocksView = (x, z) => z > 6 && x > -2 && x < 30;
  const blocked = (x, z) =>
    nearFence(x, z) || onRoad(x, z) || blocksView(x, z) || nearMountain(x, z);

  const TARGET = 1000; // dense forest — bears stay hidden until near the fence
  let placed = 0;
  let guard = 0;
  while (placed < TARGET && guard < 120000) {
    guard++;
    // pick a cluster seed, then drop a tight clump of trees around it. Bias
    // toward the foreground (the bears' approach band) so they're well hidden.
    let sx, sz;
    const r = rng();
    if (r < 0.42) {
      sx = -110 + rng() * 220; // foreground/approach band, full width
      sz = 16 + rng() * 46; // [16, 62]
    } else if (r < 0.6) {
      sx = -120 + rng() * 96; // [-120, -24] front-left band
      sz = -8 + rng() * 70; // [-8, 62]
    } else if (r < 0.78) {
      sx = -120 + rng() * 240; // full width
      sz = -84 + rng() * 50; // [-84, -34] background band behind the dock
    } else {
      sx = -120 + rng() * 240;
      sz = -84 + rng() * 150;
    }
    if (blocked(sx, sz)) continue;
    const clusterN = 3 + Math.floor(rng() * 5); // 3-7 — denser clumps
    for (let c = 0; c < clusterN && placed < TARGET; c++) {
      const x = sx + (rng() - 0.5) * 8;
      const z = sz + (rng() - 0.5) * 8;
      if (blocked(x, z)) continue;
      const backness = (15 - z) / 105; // ~1 far back, ~0 front
      const scale = 0.65 + rng() * 0.7 + Math.max(0, backness) * 0.8;
      // build the tree, bake its world-space geometry into the merge buckets
      const tree = buildPine(x, z, scale, rng);
      tree.updateMatrixWorld(true);
      tree.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);
        bucketOf(o.material).push(geo);
        o.geometry.dispose();
      });
      // collision footprint — trunk-sized so bears can squeeze between trunks
      obstacles.push({ x, z, r: 0.8 * scale });
      placed++;
    }
  }
  // merge each material's geometry into one mesh (a few draw calls total)
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return { group, obstacles };
}

// Shared pine materials (built once, reused by every tree).
const PINE_FOLIAGE = [
  new THREE.MeshLambertMaterial({ color: COLORS.pine, flatShading: true }),
  new THREE.MeshLambertMaterial({ color: COLORS.pineDark, flatShading: true }),
];
const PINE_SNOW = new THREE.MeshLambertMaterial({ color: COLORS.pineSnow, flatShading: true });
const PINE_SNOW2 = new THREE.MeshLambertMaterial({ color: 0xdde7f2, flatShading: true }); // cooler, faintly blue snow
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

// Elf-driven wheel loaders. They STAGE behind the bay (clear of the truck lane),
// then dart in to a stopped truck with the bucket already raised, hold it high
// over the bed, and reverse back out. Returns the group + per-loader state.
function buildWorkers() {
  const group = new THREE.Group();
  // Staging row at z≈-11 — behind the pile/bay, off the truck lane (z=-7). Each
  // loader darts forward to ~z=-8 (right up to the truck) to dump, then back.
  const spots = [
    [-6, -11, 0.1],
    [0, -11.2, -0.1],
    [6, -11, 0.15],
    [12, -11.2, -0.1],
    [18, -11, 0.2],
  ];
  const santas = [];
  let i = 0;
  for (const [x, z, rot] of spots) {
    const s = buildLoader(); // elves driving wheel loaders, lifting bars into the trucks
    s.position.set(x, 0, z);
    s.rotation.y = rot;
    group.add(s);
    santas.push({
      mesh: s, baseX: x, baseY: 0, baseZ: z, rotY: rot, phase: i * 2.1, panic: 0,
      state: 'wait', timer: 1.2 + i * 0.7, z, tip: 0, targetZ: -8,
    });
    i++;
  }
  return { group, santas };
}

// A Christmas elf (Buddy-the-Elf style): green tunic with a white fur collar and
// gold trim, a floppy green pointed hat with a gold band, curly hair, pointed
// ears and curly-toe shoes. Faces +Z (arms reach forward = a loading gesture).
// Arms hang on shoulder PIVOTS exposed via g.userData.arms so the yard animation
// can pump them naturally. Same skeleton/scale as the tower gunner.
export function buildElf() {
  const g = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.7, metalness: 0.0 });
  const greenDk = new THREE.MeshStandardMaterial({ color: 0x245f2d, roughness: 0.75, metalness: 0.0 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.85, metalness: 0.0 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9b44a, roughness: 0.35, metalness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe1a982, roughness: 0.75, metalness: 0.0 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9, metalness: 0.0 });
  const ball = (r, mat, seg = 12) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4)), mat);
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const bone = (a, b, rA, rB, mat) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rB, rA, dir.length(), 8), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return m;
  };

  // Green tights + curly-toe elf shoes.
  for (const x of [-0.16, 0.16]) {
    g.add(bone(new THREE.Vector3(x, 0.72, 0), new THREE.Vector3(x, 0.2, 0.02), 0.13, 0.11, greenDk));
    const shoe = box(0.24, 0.18, 0.4, greenDk);
    shoe.position.set(x, 0.1, 0.08);
    g.add(shoe);
    const toe = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 8), gold);
    toe.rotation.x = -1.3; // curls up at the toe
    toe.position.set(x, 0.17, 0.3);
    g.add(toe);
  }

  // Flared green tunic with a gold front trim + gold hem.
  const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.92, 14), green);
  coat.position.y = 1.04;
  g.add(coat);
  const trim = box(0.1, 0.92, 0.05, gold);
  trim.position.set(0, 1.04, 0.4);
  g.add(trim);
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.08, 14), gold);
  hem.position.y = 0.6;
  g.add(hem);

  // Fluffy white fur collar (a thick ring around the shoulders).
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.12, 8, 16), white);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.5;
  g.add(collar);

  // Arms on shoulder pivots (green sleeves, skin hands), default reaching forward.
  g.userData.arms = [];
  for (const x of [-0.34, 0.34]) {
    const sx = Math.sign(x);
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.4, 0);
    const o = new THREE.Vector3(0, 0, 0);
    const elbow = new THREE.Vector3(sx * 0.32 - x, 1.24 - 1.4, 0.22);
    const hand = new THREE.Vector3(sx * 0.22 - x, 1.12 - 1.4, 0.4);
    pivot.add(bone(o, elbow, 0.12, 0.1, green));
    pivot.add(bone(elbow, hand, 0.1, 0.09, green));
    const mitt = ball(0.11, skin, 8); mitt.position.copy(hand);
    pivot.add(mitt);
    g.add(pivot);
    g.userData.arms.push(pivot);
  }

  // Head, curly hair tufts, pointed elf ears.
  const head = ball(0.22, skin);
  head.position.y = 1.66;
  g.add(head);
  for (const [hx, hz] of [[-0.18, 0.06], [0.18, 0.06], [-0.12, -0.14], [0.12, -0.14], [0, 0.2]]) {
    const tuft = ball(0.09, hair, 8);
    tuft.position.set(hx, 1.75, hz);
    g.add(tuft);
  }
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), skin);
    ear.rotation.z = -s * 1.0; // point outward/up
    ear.position.set(s * 0.22, 1.69, 0);
    g.add(ear);
  }

  // Floppy green pointed hat with a gold band.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.26, 0.12, 14), gold);
  band.position.y = 1.84;
  g.add(band);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.62, 12), green);
  hat.position.set(0, 2.16, -0.03);
  hat.rotation.x = -0.32; // floppy lean back
  g.add(hat);
  const tip = ball(0.05, green, 6);
  tip.position.set(0, 2.46, -0.16);
  g.add(tip);

  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

// A compact wheel loader (Bobcat-style) with an elf in the glass cab. Faces +Z
// (bucket forward, toward the trucks). Exposes g.userData.boom (lift arms +
// bucket, raises on a pivot) and g.userData.arms (the elf's, working the controls).
export function buildLoader() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.5, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x34373d, roughness: 0.5, metalness: 0.6 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xd5541f, roughness: 0.5, metalness: 0.4 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.85, metalness: 0.0 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa1ab, roughness: 0.4, metalness: 0.85 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2a3f4d, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.45 });
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const bone = (a, b, r, m) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 8), m);
    me.position.copy(a).addScaledVector(dir, 0.5);
    me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return me;
  };

  // Body: rear engine block + lower front, white.
  const rear = box(1.15, 0.8, 1.0, white); rear.position.set(0, 0.75, -0.7); g.add(rear);
  const mid = box(1.05, 0.55, 1.0, white); mid.position.set(0, 0.5, 0.2); g.add(mid);

  // Glass cab + white roof + corner pillars (the elf shows through the tint).
  const cab = box(0.92, 1.25, 0.92, glass); cab.position.set(0, 1.55, -0.45); g.add(cab);
  const roof = box(1.0, 0.1, 1.0, white); roof.position.set(0, 2.2, -0.45); g.add(roof);
  for (const [px, pz] of [[0.46, 0.0], [-0.46, 0.0], [0.46, -0.9], [-0.46, -0.9]]) {
    const p = box(0.06, 1.3, 0.06, dark); p.position.set(px, 1.55, pz); g.add(p);
  }

  // Wheels: four big, black tires + orange rims (axles along X).
  const wheelAt = (x, z) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16), tire);
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.4, z); g.add(w);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 14), orange);
    rim.rotation.z = Math.PI / 2; rim.position.set(x + Math.sign(x) * 0.16, 0.4, z); g.add(rim);
  };
  wheelAt(0.6, 0.55); wheelAt(-0.6, 0.55); wheelAt(0.6, -0.95); wheelAt(-0.6, -0.95);

  // Boom: lift arms + a dark bucket on a pivot near the body front, so it can
  // scoop low and raise in an arc.
  // Lift arms FIXED in the raised carry position — the loader keeps the load up
  // high the whole time; only the bucket tilts to tip the bars out.
  for (const ax of [0.42, -0.42]) {
    g.add(bone(new THREE.Vector3(ax, 1.05, -0.05), new THREE.Vector3(ax, 2.5, 1.0), 0.08, steel));
  }
  g.add(bone(new THREE.Vector3(0, 0.72, 0.1), new THREE.Vector3(0, 2.0, 0.85), 0.05, steel)); // tilt ram

  // Bucket on its OWN pivot at the arm ends, so only the bucket moves (tilts) to
  // dump — the arms stay put. Default = level (holding the bars), high + forward
  // (≈ just above a truck bed).
  const bucket = new THREE.Group();
  bucket.position.set(0, 2.5, 1.0); // hinge
  const bottom = box(1.05, 0.08, 0.6, dark); bottom.position.set(0, -0.06, 0.33); bucket.add(bottom);
  const back = box(1.05, 0.5, 0.08, dark); back.position.set(0, 0.18, 0.03); bucket.add(back);
  for (const sx of [0.52, -0.52]) { const side = box(0.07, 0.5, 0.6, dark); side.position.set(sx, 0.14, 0.33); bucket.add(side); }
  const lip = box(1.05, 0.12, 0.1, steel); lip.position.set(0, -0.12, 0.62); bucket.add(lip);
  // a heap of gold/silver bars riding in the bucket
  const barSilver = new THREE.MeshStandardMaterial({ color: 0xc6ccd6, roughness: 0.35, metalness: 0.9 });
  const barGold = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.3, metalness: 0.95 });
  for (const [bx, by, bz, mat, ry] of [
    [-0.22, 0.02, 0.28, barSilver, 0.1], [0.04, 0.02, 0.36, barGold, -0.2], [0.24, 0.02, 0.24, barSilver, 0.05],
    [-0.06, 0.12, 0.32, barSilver, 0.3], [0.16, 0.12, 0.26, barGold, -0.12],
  ]) {
    const bar = box(0.18, 0.1, 0.34, mat); bar.position.set(bx, by, bz); bar.rotation.y = ry; bucket.add(bar);
  }
  g.add(bucket);

  // Elf driver in the cab, hands forward at the controls.
  const elf = buildElf();
  elf.scale.setScalar(0.55);
  elf.position.set(0, 0.82, -0.45);
  g.add(elf);

  g.traverse((o) => o.isMesh && (o.castShadow = true));
  g.userData.bucket = bucket;
  g.userData.bucketX0 = bucket.rotation.x; // level (0); tips forward to dump
  g.userData.arms = elf.userData.arms; // work the controls / brace in panic
  return g;
}

// A snow-laden evergreen: a slim brown trunk under a TALL, narrow spire of
// overlapping tiers, each one heavily blanketed in snow (green peeks out at the
// tier edges) and topped with a frosted white tip — like the snowy boreal pines
// in the reference photos. Per-tier jitter + a slight lean keep the forest natural.
function buildPine(x, z, scale = 1, rng = Math.random) {
  const g = new THREE.Group();
  const foliage = PINE_FOLIAGE[rng() < 0.5 ? 0 : 1]; // mix two greens
  const snowMat = rng() < 0.5 ? PINE_SNOW : PINE_SNOW2;

  // slim trunk
  const trunkH = 0.7 + rng() * 0.6;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.2, trunkH, 6), PINE_TRUNK);
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  g.add(trunk);

  // a tall, narrow column of tiers — irregular per tier (radius jitter + a tiny
  // lateral offset + random spin) so it reads as a real snowy conifer, not a
  // stack of identical cones. Snow blankets most of each tier; only a thin green
  // skirt shows at the bottom, so the tree is white-dominant like the photos.
  const tierCount = 5 + Math.floor(rng() * 3); // 5-7 tiers (feathery)
  const snowLoad = 0.65 + rng() * 0.35;
  let y = trunkH;
  let r = 0.95 + rng() * 0.4; // slim base
  for (let i = 0; i < tierCount; i++) {
    const rr = r * (1 + (rng() - 0.5) * 0.2); // per-tier radius jitter
    const h = rr * 1.65;
    const ox = (rng() - 0.5) * 0.22 * rr;
    const oz = (rng() - 0.5) * 0.22 * rr;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(rr, h, 6), foliage);
    cone.position.set(ox, y + h / 2, oz);
    cone.rotation.y = rng() * Math.PI;
    cone.castShadow = true;
    g.add(cone);
    // heavy snow load: covers ~85-92% of the tier, white-dominant
    const sr = rr * (0.9 + snowLoad * 0.08);
    const sh = h * (0.78 + snowLoad * 0.14);
    const snow = new THREE.Mesh(new THREE.ConeGeometry(sr, sh, 6), snowMat);
    snow.position.set(ox, y + h - sh / 2 + 0.02, oz);
    snow.rotation.y = rng() * Math.PI;
    g.add(snow);
    y += h * 0.48; // tight overlap -> dense, feathery column
    r *= 0.8;
  }
  // frosted snowy tip
  const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, r * 1.8, 6), snowMat);
  tip.position.y = y + r * 0.5;
  g.add(tip);

  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  g.rotation.y = rng() * Math.PI * 2;
  // gentle lean
  g.rotation.x = (rng() - 0.5) * 0.1;
  g.rotation.z = (rng() - 0.5) * 0.1;
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
  // Opening just wide enough for the road (+ a little clearance) so the gates
  // close it cleanly — the boom post sits on the near edge, the landing post on
  // the far edge, and there's no leftover open stretch beside the gate.
  const halfGap = LAYOUT.lane.width / 2 + 1.5;

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
  group.add(buildBoomGate(40, roadZ)); // right opening (entrance)
  group.add(buildBoomGate(-34, roadZ)); // left opening (exit)
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

function buildBoomGate(x, z) {
  const g = new THREE.Group();
  const postMat = new THREE.MeshLambertMaterial({ color: 0xf0a830 });
  const boothMat = new THREE.MeshLambertMaterial({ color: 0xb8c0cc });
  const w = LAYOUT.lane.width;
  const nearZ = z + w / 2 + 0.4; // +z edge of the road — boom pivot side
  const farZ = z - w / 2 - 0.4; // -z edge of the road — landing post side

  // little guard booth on the +z side of the road
  const booth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 2.2), boothMat);
  booth.position.set(x, 1.3, z + w / 2 + 2.4);
  booth.castShadow = true;
  g.add(booth);
  const boothRoof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 2.6), new THREE.MeshLambertMaterial({ color: 0x7fc7e8 }));
  boothRoof.position.set(x, 2.8, z + w / 2 + 2.4);
  g.add(boothRoof);

  // boom pivot post on the near (+z) edge of the opening
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.4, 8), postMat);
  post.position.set(x, 1.2, nearZ);
  post.castShadow = true;
  g.add(post);

  // landing/rest post on the FAR (-z) edge — what the arm comes down onto
  const land = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.0, 8), postMat);
  land.position.set(x, 1.0, farZ);
  land.castShadow = true;
  g.add(land);
  const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.5), postMat);
  cradle.position.set(x, 2.05, farZ); // little cradle the arm rests in
  cradle.castShadow = true;
  g.add(cradle);

  // striped arm: pivots at the near post and spans the full road to the far post,
  // shown raised (open) so trucks can pass.
  const arm = buildBoomArm(nearZ - farZ);
  arm.position.set(x, 2.1, nearZ);
  arm.rotation.x = 0.85; // lifted up toward open
  g.add(arm);
  return g;
}

// A red/white striped barrier arm of `length`, extending along -z from its pivot.
function buildBoomArm(length) {
  const arm = new THREE.Group();
  const segLen = 0.9;
  const n = Math.max(3, Math.round(length / segLen));
  const red = new THREE.MeshLambertMaterial({ color: 0xd0322d });
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
  for (let i = 0; i < n; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, segLen), i % 2 ? white : red);
    seg.position.z = -(i * segLen + segLen / 2);
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
  const { group, wave, larm, gun, muzzle } = buildGuard();
  group.position.set(x, 0, z);
  group.rotation.y = rot;
  return { group, wave, larm, gun, muzzle, pos: new THREE.Vector3(x, 0, z), baseYaw: rot };
}

// A soldier in three-color desert (DCU) camo: tan combat uniform with scattered
// brown/grey camo patches, a tactical vest with mag pouches, black gloves, tan
// combat boots, and a rounded combat helmet with ballistic sunglasses. Faces
// +Z. Keeps the rig the animation depends on: `wave` (right-arm shoulder pivot
// that beckons trucks), `gun` + `muzzle` (M4 across the chest), group yaw to aim.
export function buildGuard() {
  const g = new THREE.Group();
  const tan = new THREE.MeshStandardMaterial({ color: 0xcdbb92, roughness: 0.9, metalness: 0.0 });
  const vestMat = new THREE.MeshStandardMaterial({ color: 0xb3a079, roughness: 0.85, metalness: 0.0 });
  const camoBrown = new THREE.MeshStandardMaterial({ color: 0x8a7553, roughness: 0.92, metalness: 0.0 });
  const camoGrey = new THREE.MeshStandardMaterial({ color: 0xa39d8c, roughness: 0.9, metalness: 0.0 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xbfae84, roughness: 0.85, metalness: 0.0 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.6, metalness: 0.1 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.15, metalness: 0.4 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd2a07a, roughness: 0.75, metalness: 0.0 });
  const bx = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const sphere = (r, mat, seg = 14) => new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 4)), mat);
  // a flat camo patch laid just proud of a surface (scatters the DCU pattern)
  const patch = (mat, w, h, d, x, y, z) => { const m = bx(w, h, d, mat); m.position.set(x, y, z); g.add(m); };

  // Legs (tan trousers) + tan combat boots.
  for (const x of [-0.2, 0.2]) {
    const leg = bx(0.3, 0.82, 0.34, tan);
    leg.position.set(x, 0.56, 0);
    g.add(leg);
    const boot = bx(0.32, 0.2, 0.46, black);
    boot.position.set(x, 0.1, 0.06);
    g.add(boot);
  }

  // Torso (camo jacket) + tactical vest with pouches and shoulder straps.
  const torso = bx(0.8, 0.95, 0.5, tan);
  torso.position.y = 1.35;
  g.add(torso);
  const vest = bx(0.88, 0.74, 0.56, vestMat);
  vest.position.y = 1.45;
  g.add(vest);
  for (const px of [-0.22, 0, 0.22]) {
    const pouch = bx(0.18, 0.22, 0.1, camoBrown);
    pouch.position.set(px, 1.32, 0.31);
    g.add(pouch);
  }
  for (const sx of [-0.3, 0.3]) {
    const strap = bx(0.1, 0.72, 0.06, camoBrown);
    strap.position.set(sx, 1.46, 0.28);
    g.add(strap);
  }

  // Scattered camo patches on the uniform.
  patch(camoBrown, 0.26, 0.22, 0.02, -0.18, 1.55, 0.26);
  patch(camoGrey, 0.22, 0.18, 0.02, 0.2, 1.2, 0.26);
  patch(camoBrown, 0.02, 0.3, 0.26, 0.41, 1.4, 0);
  patch(camoGrey, 0.24, 0.24, 0.02, -0.2, 0.62, 0.18);
  patch(camoBrown, 0.26, 0.2, 0.02, 0.2, 0.5, 0.18);

  // Left (support) arm on a shoulder pivot so it can ride the rifle's foregrip
  // when idle and rise into a firing grip when aiming.
  const larm = new THREE.Group();
  larm.position.set(-0.52, 1.75, 0); // left shoulder
  const lupper = bx(0.21, 0.7, 0.23, tan);
  lupper.position.y = -0.38;
  larm.add(lupper);
  const lglove = bx(0.2, 0.2, 0.22, black);
  lglove.position.y = -0.82;
  larm.add(lglove);
  larm.rotation.set(-1.2, 0, -0.35); // ready: hands on the rifle across the chest
  g.add(larm);

  // Right arm on a shoulder pivot so it can swing forward to beckon trucks in.
  const wave = new THREE.Group();
  wave.position.set(0.52, 1.75, 0); // shoulder
  const upper = bx(0.21, 0.72, 0.23, tan);
  upper.position.y = -0.38; // hang down from the shoulder pivot
  wave.add(upper);
  const glove = bx(0.22, 0.2, 0.22, black);
  glove.position.y = -0.82;
  wave.add(glove);
  g.add(wave);

  // Head + rounded combat helmet + ballistic sunglasses + chin strap.
  const head = sphere(0.22, skin);
  head.position.y = 2.05;
  g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), helmetMat);
  helmet.position.y = 2.12;
  g.add(helmet);
  const helmetRim = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.08, 16), helmetMat);
  helmetRim.position.y = 2.12;
  g.add(helmetRim);
  patch(camoBrown, 0.16, 0.12, 0.02, 0.1, 2.18, 0.22);
  const glasses = bx(0.4, 0.11, 0.08, glassMat);
  glasses.position.set(0, 2.04, 0.21);
  g.add(glasses);
  const strap = bx(0.36, 0.06, 0.34, tan);
  strap.position.set(0, 1.9, 0.04);
  g.add(strap);

  // M4 rifle held across the chest, pointing the guard's facing direction
  // (local +Z). The whole guard yaws to aim, so the rifle tracks the target.
  const gunMetal = new THREE.MeshStandardMaterial({ color: 0x202228, roughness: 0.5, metalness: 0.6 });
  const gb = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), gunMetal);
  const gun = new THREE.Group();
  gun.position.set(0.16, 1.3, 0.2);
  const stock = gb(0.1, 0.16, 0.34); stock.position.set(0, -0.02, -0.22);
  const body = gb(0.1, 0.17, 0.5); body.position.set(0, 0, 0.06);
  const mag = gb(0.08, 0.26, 0.12); mag.position.set(0, -0.18, 0.04);
  const handle = gb(0.07, 0.1, 0.2); handle.position.set(0, 0.14, 0.04); // carry handle/sight
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8), gunMetal);
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
  return { group: g, wave, larm, gun, muzzle };
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
