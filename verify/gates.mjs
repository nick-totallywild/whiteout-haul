import { chromium } from 'playwright';
const b = await chromium.launch();
const VW=1300, VH=1000;
const p = await b.newPage({ viewport: { width: VW, height: VH } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
function clip(x,y,z){ return p.evaluate(({x,y,z,VW,VH})=>{ const c=window.__world.camera; c.updateMatrixWorld(); const e=c.matrixWorldInverse.elements; const cx=e[0]*x+e[4]*y+e[8]*z+e[12],cy=e[1]*x+e[5]*y+e[9]*z+e[13],cz=e[2]*x+e[6]*y+e[10]*z+e[14],cw=e[3]*x+e[7]*y+e[11]*z+e[15]; const pe=c.projectionMatrix.elements; const px=pe[0]*cx+pe[4]*cy+pe[8]*cz+pe[12]*cw,py=pe[1]*cx+pe[5]*cy+pe[9]*cz+pe[13]*cw,pw=pe[3]*cx+pe[7]*cy+pe[11]*cz+pe[15]*cw; return {sx:(px/pw*0.5+0.5)*VW, sy:(-py/pw*0.5+0.5)*VH}; },{x,y,z,VW,VH}); }
// entrance gate ~ x=40, exit gate ~ x=-34, both at lane z=-7
const ent = await clip(40,2,-7);
const ex = await clip(-34,2,-7);
const cl=(c,w,h)=>({x:Math.max(0,Math.min(VW-w,Math.round(c.sx-w/2))),y:Math.max(0,Math.min(VH-h,Math.round(c.sy-h/2))),width:w,height:h});
await p.screenshot({ path:'verify/gate-entrance.png', clip: cl(ent,420,380) });
await p.screenshot({ path:'verify/gate-exit.png', clip: cl(ex,420,380) });
await p.screenshot({ path:'verify/gate-full.png' });
await b.close();
console.log(JSON.stringify({ errors }, null, 2));
