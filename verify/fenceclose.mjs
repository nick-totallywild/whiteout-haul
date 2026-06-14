import { chromium } from 'playwright';
const b = await chromium.launch();
const VW = 1200, VH = 1100;
const p = await b.newPage({ viewport: { width: VW, height: VH } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Nick');
  localStorage.setItem('whiteout-email', 'n@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.state.cash = 1e7; });

// run until a stretch is well clawed
let weakest = null;
for (let i = 0; i < 50; i++) {
  await p.waitForTimeout(1000);
  const r = await p.evaluate(() => {
    const ws = window.__bears.weakestSpot();
    return ws;
  });
  if (r && r.frac < 0.3) { weakest = r; break; }
  weakest = r;
}

// project the weakest segment to screen and clip around it
const clip = await p.evaluate(({ VW, VH }) => {
  const ws = window.__bears.weakestSpot();
  const cam = window.__world.camera;
  cam.updateMatrixWorld();
  const v = { x: ws ? ws.x : 20, y: 1.5, z: ws ? ws.z : 15 };
  const e = cam.matrixWorldInverse.elements;
  const cx = e[0]*v.x + e[4]*v.y + e[8]*v.z + e[12];
  const cy = e[1]*v.x + e[5]*v.y + e[9]*v.z + e[13];
  const cz = e[2]*v.x + e[6]*v.y + e[10]*v.z + e[14];
  const cw = e[3]*v.x + e[7]*v.y + e[11]*v.z + e[15];
  const pe = cam.projectionMatrix.elements;
  const px = pe[0]*cx + pe[4]*cy + pe[8]*cz + pe[12]*cw;
  const py = pe[1]*cx + pe[5]*cy + pe[9]*cz + pe[13]*cw;
  const pw = pe[3]*cx + pe[7]*cy + pe[11]*cz + pe[15]*cw;
  const sx = (px/pw * 0.5 + 0.5) * VW, sy = (-py/pw * 0.5 + 0.5) * VH;
  return { ws, sx, sy };
}, { VW, VH });

await p.screenshot({ path: 'verify/fenceclose-full.png' });
const x = Math.max(0, Math.min(VW - 440, Math.round(clip.sx - 220)));
const y = Math.max(0, Math.min(VH - 380, Math.round(clip.sy - 200)));
await p.screenshot({ path: 'verify/fenceclose-zoom.png', clip: { x, y, width: 440, height: 380 } });

await b.close();
console.log(JSON.stringify({ weakest, clip: { ws: clip.ws, sx: Math.round(clip.sx), sy: Math.round(clip.sy) }, errors }, null, 2));
