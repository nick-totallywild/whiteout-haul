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

// install 2 coils
await p.evaluate(() => { window.__econ.state.cash = 1e7; window.__buy('fence'); window.__buy('fence'); });
const before = await p.evaluate(() => window.__bears.wireStatus().spots.map(s => ({ x: +s.x.toFixed(1), z: +s.z.toFixed(1) })));

// enter move-wire mode via the button
await p.click('#wire-btn');
const editingState = await p.evaluate(() => ({ btn: document.getElementById('wire-btn').textContent, hint: document.getElementById('wire-hint').style.display }));

// helper: project a world (x,z) to a canvas client point and click it
async function clickWorld(x, z) {
  const pt = await p.evaluate(({ x, z, VW, VH }) => {
    const cam = window.__world.camera; cam.updateMatrixWorld();
    const v = { x, y: 0.5, z };
    const e = cam.matrixWorldInverse.elements;
    const cx=e[0]*v.x+e[4]*v.y+e[8]*v.z+e[12],cy=e[1]*v.x+e[5]*v.y+e[9]*v.z+e[13],cz=e[2]*v.x+e[6]*v.y+e[10]*v.z+e[14],cw=e[3]*v.x+e[7]*v.y+e[11]*v.z+e[15];
    const pe=cam.projectionMatrix.elements;
    const px=pe[0]*cx+pe[4]*cy+pe[8]*cz+pe[12]*cw,py=pe[1]*cx+pe[5]*cy+pe[9]*cz+pe[13]*cw,pw=pe[3]*cx+pe[7]*cy+pe[11]*cz+pe[15]*cw;
    return { sx: (px/pw*0.5+0.5)*VW, sy: (-py/pw*0.5+0.5)*VH };
  }, { x, z, VW, VH });
  await p.mouse.click(pt.sx, pt.sy);
}

// pick up the coil at the first installed spot
await clickWorld(before[0].x, before[0].z);
const afterPick = await p.evaluate(() => document.getElementById('wire-hint').textContent);

// move it to a clearly-empty stretch: the right fence around (40, -10)
await clickWorld(40, -10);
const afterMove = await p.evaluate(() => document.getElementById('wire-hint').textContent);
const after = await p.evaluate(() => window.__bears.wireStatus().spots.map(s => ({ x: +s.x.toFixed(1), z: +s.z.toFixed(1) })));

await p.screenshot({ path: 'verify/movewire.png' });
await b.close();
console.log(JSON.stringify({ before, editingState, afterPick, afterMove, after, errors }, null, 2));
