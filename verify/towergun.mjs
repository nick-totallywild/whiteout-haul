import { chromium } from 'playwright';
const b = await chromium.launch();
const VW = 1100, VH = 1100;
const p = await b.newPage({ viewport: { width: VW, height: VH } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Nick');
  localStorage.setItem('whiteout-email', 'n@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.state.cash = 1e7; while (window.__buy('tower')) {} });
await p.waitForTimeout(2500);

// Project each tower's top (world ~(x, 6, z)) to screen pixels via the camera.
const spots = [{ x: -30, z: 11 }, { x: 36, z: 11 }, { x: 36, z: -26 }];
const pts = await p.evaluate(({ spots, VW, VH }) => {
  const cam = window.__world.camera;
  return spots.map(s => {
    const v = new (window.__world.scene.constructor === Object ? Object : Function)(); // noop
    return s;
  }).map(s => {
    const THREE = window.__world.camera.constructor; // not reliable
    return s;
  });
}, { spots, VW, VH });

// Simpler: do the projection with three's API exposed through the camera object.
const proj = await p.evaluate(({ spots, VW, VH }) => {
  const cam = window.__world.camera;
  // Build a minimal Vector3 projection manually using the camera matrices.
  cam.updateMatrixWorld();
  const out = [];
  for (const s of spots) {
    const v = { x: s.x, y: 6, z: s.z };
    // world -> camera (viewMatrix = inverse of cam matrixWorld) -> clip (projectionMatrix)
    const e = cam.matrixWorldInverse.elements;
    const cx = e[0]*v.x + e[4]*v.y + e[8]*v.z + e[12];
    const cy = e[1]*v.x + e[5]*v.y + e[9]*v.z + e[13];
    const cz = e[2]*v.x + e[6]*v.y + e[10]*v.z + e[14];
    const cw = e[3]*v.x + e[7]*v.y + e[11]*v.z + e[15];
    const pe = cam.projectionMatrix.elements;
    const px = pe[0]*cx + pe[4]*cy + pe[8]*cz + pe[12]*cw;
    const py = pe[1]*cx + pe[5]*cy + pe[9]*cz + pe[13]*cw;
    const pw = pe[3]*cx + pe[7]*cy + pe[11]*cz + pe[15]*cw;
    const ndcX = px / pw, ndcY = py / pw;
    out.push({ sx: (ndcX * 0.5 + 0.5) * VW, sy: (-ndcY * 0.5 + 0.5) * VH });
  }
  return out;
}, { spots, VW, VH });

await p.screenshot({ path: 'verify/towergun-full.png' });
for (let i = 0; i < proj.length; i++) {
  const { sx, sy } = proj[i];
  const x = Math.max(0, Math.min(VW - 360, Math.round(sx - 180)));
  const y = Math.max(0, Math.min(VH - 360, Math.round(sy - 220)));
  await p.screenshot({ path: `verify/towergun-${i}.png`, clip: { x, y, width: 360, height: 360 } });
}
await b.close();
console.log(JSON.stringify({ proj, errors }, null, 2));
