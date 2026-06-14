// config.js — shared tunables and the layout contract.
// Every module reads layout/palette/economy numbers from here so the scene,
// trucks, pile and economy all agree on coordinates and look. Edit here to retune.

import * as THREE from 'three';

// ---- Palette (low-poly flat-shaded snowy industrial) ----
export const COLORS = {
  snow: 0xeef4f8,
  snowShadow: 0xcdd9e4,
  road: 0x42424d,
  roadLine: 0xf2c14e,
  lot: 0x6b6f86, // the grey/purple paved lot the depot + tiles sit on
  truckBed: 0xf07b1d, // orange dump bed
  truckCab: 0xf4f4f4, // white cab
  truckWheel: 0x1c1c20,
  metal: 0x9aa4b0, // grey metal blocks
  metalDark: 0x7c8794,
  depotWall: 0xd9b170,
  depotRoof: 0x7fc7e8,
  pine: 0x2f6b50, // evergreen foliage
  pineDark: 0x255741,
  pineSnow: 0xf4f9fd, // snow resting on the branches
  treeTrunk: 0x5b4030,
  mountain: 0xc4d2e2, // distant snowy peaks (shaded)
  mountainSnow: 0xf3f8fd,
  snowParticle: 0xffffff,
  sky: 0xdfeaf2,
};

// ---- Camera (fixed isometric-ish angle, like the screenshots) ----
export const CAMERA = {
  position: new THREE.Vector3(48, 55, 68),
  lookAt: new THREE.Vector3(-6, 0, -11),
  fov: 43,
};

// ---- World layout ----
// A straight one-way loading road: trucks drive IN from the right, queue
// bumper-to-bumper at the loading bay (in front of the pile), the front truck is
// loaded and drives OUT to the left, and the line shuffles forward. Trucks that
// drive off the exit recycle back to the entrance, so the queue stays full.
export const LAYOUT = {
  groundSize: 340,

  lane: {
    z: -7, // the queue road runs along X at this z
    width: 7.5, // wide drive-in / drive-out
    bayX: -6, // the front truck stops here (directly in front of the pile)
    entranceX: 74, // trucks appear near the right screen edge and drive all the way in
    exitX: -46, // trucks drive deep INTO the black tunnel void, then recycle (hidden)
    roadFromX: -50, // road runs all the way into the exit tunnel void
    roadToX: 150, // entry road runs well off the right edge (trucks spawn on it)
    tunnelLeftX: -40, // the exit tunnel portal sits here (the mountain rises behind it)
  },

  // Paved lot — sized to FULLY cover the falling-brick pile and the road bay,
  // extended ~1/3 further toward the camera (front edge z3 -> z14).
  lotCenter: new THREE.Vector3(2, 0, -7.5),
  lotSize: new THREE.Vector3(76, 0, 43),

  depotPos: new THREE.Vector3(28, 0, -19),
  pilePos: new THREE.Vector3(-6, 0, -18), // under the conveyor, behind the bay
};

// ---- Economy ----
// Money math lives here. Passive rate is a gentle trickle; the real income is
// truck deliveries. Upgrade costs scale geometrically (cost *= growth each buy).
export const ECONOMY = {
  startingCash: 100,
  passiveRatePerSec: 0, // trucks are the income; keep passive at 0 (tunable)

  // Legacy passive reference; real income comes from truck loads (see BRICK).
  baseDeliveryValue: 12,

  // Operating costs (salaries, fuel, electricity...). Cash burns down every
  // second the operation exists, scaling with its size. While trucks are hauling,
  // delivery income easily covers it; but if the line stalls (e.g. a bear breach
  // halts the trucks and isn't repaired) income stops while the burn continues —
  // cash slides toward $0. Upkeep only starts after the first sale, so a fresh
  // game / the registration screen never drains you before you've begun.
  upkeep: {
    base: 1.5, // $/sec just to keep the lights on
    perTruck: 1, // wages + fuel per truck in service
    perBay: 1.5, // running each loading bay
    perCapacityLevel: 0.6, // bigger loads = bigger machinery to run
    // Sized so a running line nets clearly positive (1 truck ≈ $8/s in vs ≈ $4/s
    // out) but a HALTED line (breach, no repair) bleeds steadily toward $0.
  },

  upgrades: {
    truck: {
      label: 'Add Truck',
      baseCost: 40,
      costGrowth: 1.7, // steeper: top levels cost much more than the first
      maxLevel: 8, // up to 9 trucks — the queue fits between the bay and the gate
    },
    capacity: {
      label: 'Capacity',
      baseCost: 55,
      costGrowth: 1.7, // the long tail — top level ~2.5M vs base 55
      maxLevel: 20,
    },
    speed: {
      label: 'Speed',
      baseCost: 50,
      costGrowth: 1.6,
      maxLevel: 12,
    },
    bay: {
      label: 'Bays',
      baseCost: 250, // powerful (parallel loading) — expensive and very steep
      costGrowth: 3.0,
      maxLevel: 4, // up to 5 loading bays
    },
    fence: {
      label: 'Barbed Wire',
      baseCost: 120, // defense: fewer bear raids
      costGrowth: 1.8,
      maxLevel: 5,
    },
    tower: {
      label: 'Gun Tower',
      baseCost: 300, // defense: Santa gunners auto-shoot bears before they reach
      costGrowth: 2.0,
      maxLevel: 3, // up to 3 gun towers (one per useful corner; 4th blocked the lane)
    },
  },
};

// ---- Bear raids (challenge) ----
// Bears wander in from the treeline and maul the loading dock (loading stops
// while one is breaching). Barbed wire makes raids rarer; gun towers shoot bears.
export const BEARS = {
  baseSpawnInterval: 9, // seconds between bears at 0 barbed wire
  spawnPerFence: 2, // each barbed-wire level adds this many seconds between raids
  speed: 3.2, // bear walk speed (world units/sec)
  hp: 5, // tower hits to down a bear (tanky enough to reach the fence and claw)
  maulTime: 5, // seconds a breaching bear halts loading before it leaves
  target: new THREE.Vector3(6, 0, -9), // the dock point bears head for
  // Tighter firing range so towers engage bears AT the fence, not snipe them
  // out in the treeline — the player actually sees the bears reach the wire.
  towerRange: 19, // gun tower firing range
  towerFireInterval: 0.7, // seconds between shots per tower
};

// ---- Real-world economy reference ----
// Used to show the true dollar value of a full truck load at live spot prices.
// Hauler is a ~30-40t articulated dump truck (Cat 745 / Volvo A40 class), but the
// safe load is capped PER METAL: gold is denser + far more valuable, so it's
// restricted harder than silver.
export const REAL = {
  goldLoadTonnes: 15, // max gold per truck (safety limit)
  silverLoadTonnes: 20, // max silver per truck (safety limit)
  truckCostUSD: 800_000, // real cost of a 30-40t articulated dump truck
};

// ---- Gate guards (defense) ----
// The two gate guards carry M-16s and shoot bears that come near their posts.
// A bear that gets right on top of a guard can injure them — they go down for a
// while and you must pay to bring in a replacement.
export const GUARDS = {
  range: 22, // rifle engagement range
  fireInterval: 0.45, // seconds between shots
  injureRadius: 5.5, // a bear this close to a guard can maul them
  injureChancePerSec: 0.3, // chance/sec of injury while a bear is that close
  downTime: 12, // seconds a guard is out of action
  replaceCost: 300, // cash to bring in a replacement guard
};

// ---- Avalanche (challenge) ----
// Every so often snow breaks loose off the mountain. A WARNING gives you a few
// seconds to HOLD THE TRUCKS (stop the convoy); then the snow crashes across the
// lane. Any truck caught MOVING when it hits is buried — its load is lost, it
// respawns at the back, and you pay to dig it out. Trucks that were held survive.
export const AVALANCHE = {
  firstDelay: 35, // seconds before the first avalanche can occur
  interval: 45, // base seconds between avalanches
  intervalJitter: 25, // + up to this many random seconds
  warningTime: 6, // warning window to hold the trucks
  impactTime: 2.6, // how long the snow is crashing across the lane
  settleTime: 4, // snow sits piled (and the lane stays deadly) before it clears
  // A truck destroyed by the avalanche (caught MOVING in the snow) is a BIG hit:
  // it loses the gold/silver it was carrying AND you pay to replace it.
  // Replacement scales with the rig's capacity (≈ this many full loads' worth).
  replaceLoadMultiple: 8,
  // A truck that was HELD (stopped) but still sitting in the snow zone isn't
  // destroyed — but it's not unscathed either: it takes battering/dig-out repairs
  // worth this fraction of a full replacement (keeps its cargo).
  dentCostFraction: 0.2,
};

// ---- Leaderboard ----
// Points at the small leaderboard backend (server/leaderboard-server.mjs).
// For a global leaderboard, deploy that server and set apiBase to its URL.
export const LEADERBOARD = {
  apiBase: 'http://localhost:3001',
  submitEvery: 8, // seconds between score submissions
};

// ---- Truck tuning ----
export const TRUCK = {
  baseSpeed: 10, // world units / sec along the path at speed level 0
  speedPerLevel: 0.85, // calmer top speed (~20 at max) — drive stays believable;
  // the Speed upgrade's income still scales mainly via faster loading (loadTime).
  startCapacity: 6, // bricks loaded per trip at capacity level 0
  capacityPerLevel: 2,
  queueGap: 6.2, // world-unit spacing between queued trucks (center to center)
  loadTime: 1.2, // base seconds to fully load a truck (faster with speed level)
  // Forward axis is +X: x = length, y = height, z = width.
  size: new THREE.Vector3(4.8, 1.3, 2.3),
};

// ---- Bricks ----
// The conveyor produces silver bricks with an occasional gold one. A truck's
// payout when it drives off = sum of the value of the bricks it loaded, so a
// load that happened to scoop up gold pays much more.
export const BRICK = {
  goldChance: 0.16, // probability a given brick is gold
  silverValue: 11, // money per silver brick in a delivered load
  goldValue: 65, // money per gold brick — gold pays far more
  silverColor: 0xc6ccd6,
  silverColorDark: 0xa6adba,
  goldColor: 0xf2c14e,
  goldColorDark: 0xd9a128,
};

// ---- Pile tuning ----
// The heap of grey metal blocks that grows at the depot as trucks deliver.
export const PILE = {
  // Blocks dropped per capacity unit delivered — higher = the mound piles up
  // faster and reads like the big pile in the reference art.
  blocksPerCapacity: 6,
  seedBlocks: 40, // pre-existing mound so the depot starts with some metal
  maxBlocks: 1200, // live-mesh cap for performance
  blockSize: new THREE.Vector3(1.3, 0.7, 1.9),
  moundRadius: 6, // footprint radius of the heap on the lot
};
