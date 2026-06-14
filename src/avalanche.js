// avalanche.js — the avalanche challenge. On a timer, snow breaks loose off the
// mountain: first a WARNING window (hold the trucks!), then a wall of snow crashes
// down across the lane. The moment it lands, any truck still MOVING is buried
// (handled in main.js via fleet.crushMoving). Trucks that were held survive.
//
//   createAvalanche(scene, sfx) ->
//     update(dt), state(), isWarning(), isImpact(), justLanded()

import * as THREE from 'three';
import { AVALANCHE, LAYOUT } from './config.js';

export function createAvalanche(scene, sfx) {
  const group = new THREE.Group();
  scene.add(group);
  const Z = LAYOUT.lane.z;

  const snowMat = new THREE.MeshLambertMaterial({ color: 0xeaf2f8, flatShading: true });
  const chunks = [];
  for (let i = 0; i < 16; i++) {
    const s = 1.3 + Math.random() * 2.3;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, s), snowMat);
    m.castShadow = true;
    m.visible = false;
    group.add(m);
    chunks.push({ mesh: m, from: new THREE.Vector3(), to: new THREE.Vector3(), spin: new THREE.Vector3() });
  }

  let state = 'idle';
  let timer = AVALANCHE.firstDelay;
  let p = 0; // impact progress 0..1
  let landedEvent = false;

  // Chunks start high on the mountain (back-left, above the exit) and tumble down
  // onto the EXIT CORRIDOR (the stretch between the bay and the tunnel) — must
  // line up with the burial zone in trucks.js. The bay itself stays clear.
  function setStart() {
    for (const c of chunks) {
      c.to.set(-28 + (Math.random() - 0.5) * 20, 0.8 + Math.random() * 1.4, Z + (Math.random() - 0.5) * 5);
      c.from.set(-46 + (Math.random() - 0.5) * 14, 26 + Math.random() * 10, Z - 28 + (Math.random() - 0.5) * 14);
      c.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.mesh.scale.setScalar(1);
      c.mesh.visible = true;
      c.mesh.position.copy(c.from);
    }
  }
  function place(prog) {
    for (const c of chunks) {
      c.mesh.position.lerpVectors(c.from, c.to, prog);
      c.mesh.position.y += Math.sin(prog * Math.PI) * 6; // arc up then slam down
      c.mesh.rotation.set(c.spin.x * prog, c.spin.y * prog, c.spin.z * prog);
    }
  }
  function hide() {
    for (const c of chunks) c.mesh.visible = false;
  }

  function update(dt) {
    landedEvent = false;
    timer -= dt;
    if (state === 'idle') {
      if (timer <= 0) { state = 'warning'; timer = AVALANCHE.warningTime; if (sfx) sfx.rumble(); }
    } else if (state === 'warning') {
      if (timer <= 0) { state = 'impact'; timer = AVALANCHE.impactTime; p = 0; setStart(); if (sfx) sfx.crash(); }
    } else if (state === 'impact') {
      const prev = p;
      p = 1 - Math.max(0, timer) / AVALANCHE.impactTime;
      place(Math.min(1, p));
      if (prev < 0.65 && p >= 0.65) landedEvent = true; // snow hits the lane
      if (timer <= 0) { state = 'settle'; timer = AVALANCHE.settleTime; }
    } else if (state === 'settle') {
      const f = Math.max(0, timer) / AVALANCHE.settleTime;
      for (const c of chunks) c.mesh.scale.setScalar(0.55 + 0.45 * f); // shrink as it melts/clears
      if (timer <= 0) {
        state = 'idle';
        timer = AVALANCHE.interval + Math.random() * AVALANCHE.intervalJitter;
        hide();
      }
    }
  }

  // Force an avalanche to start now (skip the idle wait) — only when idle.
  function forceWarning() {
    if (state !== 'idle') return;
    state = 'warning';
    timer = AVALANCHE.warningTime;
    if (sfx) sfx.rumble();
  }

  return {
    update,
    forceWarning,
    state: () => state,
    isWarning: () => state === 'warning',
    isImpact: () => state === 'impact',
    justLanded: () => landedEvent, // true the frame the snow lands on the lane
    // the lane is a death zone from the moment the snow lands until it clears
    isHazard: () => (state === 'impact' && p >= 0.65) || state === 'settle',
  };
}
