[6/13/2026 2:27 PM] GHOST_0x1: # PLAN.md — Idle Hauling Game

## Goal

Build a playable browser-based 3D idle game inspired by the reference screenshots
provided alongside this plan. The core fantasy: a snowy industrial site where trucks
endlessly haul metal blocks from a giant pile to a depot, and the player taps upgrade
buttons to add more trucks, increase capacity, and scale the operation up.

This is a prototype-first project. Build the core loop working and visible before
adding polish. Run the game frequently so progress can be verified at every step.

## Reference screenshots

Three screenshots are provided with this plan. Use them for art direction, layout, and
mechanic reference. Match the low-poly isometric look, the snowy palette, and the orange
dump trucks.

- IMG_1694.PNG — Main gameplay view. Orange dump trucks queued along a dark road,
  driving toward a large pile of metal blocks beside a depot building. Floating upgrade
  tiles sit on the ground (“200” truck-upgrade tiles, “200” capacity tile). Currency
  counter (“100”) top-right with a cash icon. Note the isometric camera angle and snowy
  forest surroundings.
- IMG_1695.PNG — Same scene slightly later. Currency now “200”, a “+100” worker/cash
  pickup tile is visible, additional upgrade tiles (“200”, “300”). Confirms the
  spend-to-upgrade loop and the truck convoy along the looped road.
- IMG_1696.PNG — A “satisfying” payoff moment: a massive wall of stacked metal blocks
  being released/collapsing into a pit with red guide-laser lines. This is the visual
  reward we build toward in later phases (physics pile / mass spawn). Lower priority than
  the core loop, but it defines the target aesthetic.

(The screenshots are from a mobile ad; treat them as art/mechanic inspiration, not a spec
to copy pixel-for-pixel.)

## Tech stack

- Three.js for 3D rendering
- Vite for the dev server and build
- Vanilla JavaScript (no heavy framework needed for a prototype)
- Keep it to a small number of files; readable over clever.

Set up a dev server (`npm run dev`) early so the game can be viewed live in the browser
after every change.

## Visual direction

- Isometric / angled top-down camera, fixed angle (like the screenshots).
- Low-poly flat-shaded look. Simple box geometry is fine to start; no textures required.
- Palette: white/blue snow ground, dark grey road with a yellow center line, orange truck
  beds with white cabs, grey metal blocks. Scatter simple low-poly pine trees around the
  edges for atmosphere.
- Clean, readable UI overlay (HTML/CSS on top of the canvas) for currency and upgrade
  buttons.

## Build phases (build and verify ONE at a time)

### Phase 1 — Scene & camera

- Vite + Three.js project that runs with npm run dev.
- Snowy ground plane, fixed isometric camera, basic lighting.
- A dark road strip with a yellow center line running across the ground.
- Verify: the scene renders in the browser at a stable framerate.

### Phase 2 — Idle economy

- A currency value that increases over time at a base rate.
- HTML overlay showing the currency counter (top-right, like the screenshots).
- Verify: the number visibly ticks up.

### Phase 3 — Upgrade buttons

- On-screen buttons that spend currency to increase the earn rate (and later, truck count
  and capacity). Disable/grey out when unaffordable.
- Verify: spending currency raises the rate; balance can’t go negative.

### Phase 4 — One truck

- A single low-poly truck (orange bed + white cab) that drives a looped path: road →
  pile → depot → back. Smooth movement along waypoints.
- Verify: the truck loops continuously and smoothly.

### Phase 5 — Hauling loop tie-in

- Each completed truck delivery adds currency (replacing or supplementing the passive
  rate). Truck speed/capacity affects earnings.
- Verify: more deliveries = more money, visibly.

### Phase 6 — The pile

- A pile of metal blocks near the depot. Blocks spawn/accumulate as trucks deliver.
  Start with simple stacked boxes; optionally add Three.js physics (e.g. cannon-es) later
  for the “satisfying” tumble seen in IMG_1696.PNG.
[6/13/2026 2:27 PM] GHOST_0x1: - Verify: the pile visibly grows with deliveries.

### Phase 7 — Scaling

- Upgrades add more trucks to the convoy, increase capacity, and speed up the loop, so the
  operation visibly grows like the screenshots (a line of many trucks).
- Verify: buying upgrades makes the scene busier and earnings climb.

### Phase 8 — Polish (optional / later)

- Scatter pine trees and snow detail.
- Number formatting (1k, 1M) for large values.
- Save progress to localStorage.
- The big “release the wall of blocks” payoff moment from IMG_1696.PNG as a milestone
  reward.

## Working agreement for the agent

- Build in vertical slices; complete and verify each phase before the next.
- Run the game after each meaningful change and report what to look for.
- Keep functions small and named clearly; leave brief comments on the game-economy math.
- When something looks wrong, fix one specific issue at a time.
- Ask before introducing a new dependency or framework.

## Out of scope (for now)

- Mobile touch optimization, app-store packaging, monetization, sound.
- Multiplayer, accounts, backend. Everything runs client-side.