import { chromium } from 'playwright';
const b = await chromium.launch();
const VW=1300, VH=1000;
const p = await b.newPage({ viewport: { width: VW, height: VH } });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
function clipFor(x,y,z){ return p.evaluate(({x,y,z,VW,VH}) => {
  const cam=window.__world.camera; cam.updateMatrixWorld();
  const e=cam.matrixWorldInverse.elements;
  const cx=e[0]*x+e[4]*y+e[8]*z+e[12],cy=e[1]*x+e[5]*y+e[9]*z+e[13],cz=e[2]*x+e[6]*y+e[10]*z+e[14],cw=e[3]*x+e[7]*y+e[11]*z+e[15];
  const pe=cam.projectionMatrix.elements;
  const px=pe[0]*cx+pe[4]*cy+pe[8]*cz+pe[12]*cw,py=pe[1]*cx+pe[5]*cy+pe[9]*cz+pe[13]*cw,pw=pe[3]*cx+pe[7]*cy+pe[11]*cz+pe[15]*cw;
  return { sx:(px/pw*0.5+0.5)*VW, sy:(-py/pw*0.5+0.5)*VH };
}, {x,y,z,VW,VH}); }
const c = await clipFor(-38,1.3,-1.5);
const x=Math.max(0,Math.min(VW-300,Math.round(c.sx-150))), y=Math.max(0,Math.min(VH-300,Math.round(c.sy-160)));
await p.screenshot({ path:'verify/guardcu.png', clip:{x,y,width:300,height:300} });
await b.close();
console.log('ok', JSON.stringify(c));
