import { chromium } from 'playwright';
const b = await chromium.launch();
const VW = 1300, VH = 1100;
const p = await b.newPage({ viewport: { width: VW, height: VH } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Nick');
  localStorage.setItem('whiteout-email', 'n@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

// install max barbed wire (no towers, so we see wire defend a gun gap)
await p.evaluate(() => { window.__econ.state.cash = 1e7; while (window.__buy('fence')) {} });
const installed = await p.evaluate(() => window.__bears.wireStatus());

// project the first wire coil to screen for a close-up
const clip = await p.evaluate(({ VW, VH }) => {
  const ws = window.__bears.wireStatus().spots[0];
  const cam = window.__world.camera; cam.updateMatrixWorld();
  const v = { x: ws.x, y: 1, z: ws.z };
  const e = cam.matrixWorldInverse.elements;
  const cx=e[0]*v.x+e[4]*v.y+e[8]*v.z+e[12],cy=e[1]*v.x+e[5]*v.y+e[9]*v.z+e[13],cz=e[2]*v.x+e[6]*v.y+e[10]*v.z+e[14],cw=e[3]*v.x+e[7]*v.y+e[11]*v.z+e[15];
  const pe=cam.projectionMatrix.elements;
  const px=pe[0]*cx+pe[4]*cy+pe[8]*cz+pe[12]*cw,py=pe[1]*cx+pe[5]*cy+pe[9]*cz+pe[13]*cw,pw=pe[3]*cx+pe[7]*cy+pe[11]*cz+pe[15]*cw;
  return { sx:(px/pw*0.5+0.5)*VW, sy:(-py/pw*0.5+0.5)*VH, ws };
}, { VW, VH });

await p.screenshot({ path: 'verify/wire-full.png' });
const x = Math.max(0, Math.min(VW-480, Math.round(clip.sx-240)));
const y = Math.max(0, Math.min(VH-380, Math.round(clip.sy-190)));
await p.screenshot({ path: 'verify/wire-zoom.png', clip: { x, y, width: 480, height: 380 } });

// let bears chew the wire for a while; track wire damage + bears killed on it
let worstWire = 1, sawWireDamage = false;
for (let i = 0; i < 45; i++) {
  await p.waitForTimeout(1000);
  const w = await p.evaluate(() => window.__bears.wireStatus());
  worstWire = Math.min(worstWire, w.worst);
  if (w.damaged > 0) sawWireDamage = true;
}
const beforeRepair = await p.evaluate(() => ({ wire: window.__bears.wireStatus(), repairCost: window.WhiteoutBot.state().repairCost }));
const repaired = await p.evaluate(() => window.WhiteoutBot.repairFence());
const afterRepair = await p.evaluate(() => window.__bears.wireStatus());
await p.screenshot({ path: 'verify/wire-after.png' });

await b.close();
console.log(JSON.stringify({ installed: { installed: installed.installed, spots: installed.spots }, worstWire: +worstWire.toFixed(2), sawWireDamage, beforeRepair, repaired, afterRepair, errors }, null, 2));
