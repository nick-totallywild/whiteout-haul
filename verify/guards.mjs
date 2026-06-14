import { chromium } from 'playwright';
const b = await chromium.launch();
const VW=1200, VH=1000;
const p = await b.newPage({ viewport: { width: VW, height: VH } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.state.cash = 1e7; window.__lastGuardLoss = 0; });
// let bears raid near the gates for a while
await p.waitForTimeout(40000);
const info = await p.evaluate(() => ({ guardLoss: window.__lastGuardLoss||0, bears: window.WhiteoutBot.state().bearsActive }));
// project the right gate guard (44, -1.5) for a close-up
const c = await p.evaluate(({VW,VH}) => {
  const cam=window.__world.camera; cam.updateMatrixWorld();
  const v={x:44,y:1.5,z:-1.5};
  const e=cam.matrixWorldInverse.elements;
  const cx=e[0]*v.x+e[4]*v.y+e[8]*v.z+e[12],cy=e[1]*v.x+e[5]*v.y+e[9]*v.z+e[13],cz=e[2]*v.x+e[6]*v.y+e[10]*v.z+e[14],cw=e[3]*v.x+e[7]*v.y+e[11]*v.z+e[15];
  const pe=cam.projectionMatrix.elements;
  const px=pe[0]*cx+pe[4]*cy+pe[8]*cz+pe[12]*cw,py=pe[1]*cx+pe[5]*cy+pe[9]*cz+pe[13]*cw,pw=pe[3]*cx+pe[7]*cy+pe[11]*cz+pe[15]*cw;
  return { sx:(px/pw*0.5+0.5)*VW, sy:(-py/pw*0.5+0.5)*VH };
}, {VW,VH});
const x=Math.max(0,Math.min(VW-360,Math.round(c.sx-180))), y=Math.max(0,Math.min(VH-340,Math.round(c.sy-200)));
await p.screenshot({ path:'verify/guards-zoom.png', clip:{x,y,width:360,height:340} });
await p.screenshot({ path:'verify/guards-full.png' });
await b.close();
console.log(JSON.stringify({ info, errors }, null, 2));
