import { chromium } from 'playwright';
const b = await chromium.launch();
const VW = 1280, VH = 860;
const errors = [];
const dir = 'docs/screenshots';

function projClip(p, x, y, z, w, h) {
  return p.evaluate(({x,y,z,VW,VH}) => {
    const c=window.__world.camera; c.updateMatrixWorld(); const e=c.matrixWorldInverse.elements;
    const cx=e[0]*x+e[4]*y+e[8]*z+e[12],cy=e[1]*x+e[5]*y+e[9]*z+e[13],cz=e[2]*x+e[6]*y+e[10]*z+e[14],cw=e[3]*x+e[7]*y+e[11]*z+e[15];
    const pe=c.projectionMatrix.elements;
    const px=pe[0]*cx+pe[4]*cy+pe[8]*cz+pe[12]*cw,py=pe[1]*cx+pe[5]*cy+pe[9]*cz+pe[13]*cw,pw=pe[3]*cx+pe[7]*cy+pe[11]*cz+pe[15]*cw;
    return {sx:(px/pw*0.5+0.5)*VW, sy:(-py/pw*0.5+0.5)*VH};
  },{x,y,z,VW,VH});
}
const box=(c,w,h)=>({x:Math.max(0,Math.min(VW-w,Math.round(c.sx-w/2))),y:Math.max(0,Math.min(VH-h,Math.round(c.sy-h/2))),width:w,height:h});

// --- main page (registered) ---
const p = await b.newPage({ viewport: { width: VW, height: VH } });
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); localStorage.removeItem('whiteout-bot-running'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.evaluate(() => { window.__econ.state.cash = 5e6; for(let i=0;i<4;i++)window.__buy('truck'); for(let i=0;i<2;i++)window.__buy('bay'); for(let i=0;i<6;i++)window.__buy('capacity'); });
await p.waitForTimeout(6000);

// 1) overview
await p.screenshot({ path: `${dir}/01-overview.png` });
// 2) dashboard (top-left: live prices + full-load + leaderboard)
await p.screenshot({ path: `${dir}/02-dashboard.png`, clip: { x:0, y:0, width:280, height:440 } });
// 3) gate close-up (exit gate)
{ const c = await projClip(p,-34,2,-7); await p.screenshot({ path: `${dir}/03-gate.png`, clip: box(c,460,400) }); }

// 4) bear raid — towers + wire, wait for a wave at the fence
await p.evaluate(() => { window.__econ.state.cash = 5e6; while(window.__buy('tower')){} for(let i=0;i<3;i++)window.__buy('fence'); });
await p.waitForTimeout(18000);
await p.screenshot({ path: `${dir}/04-bear-raid.png` });

// 5) bot automation panel (open + running the default Full strategy)
await p.click('.bot-toggle');
await p.click('.bot-run');
await p.waitForTimeout(600);
await p.screenshot({ path: `${dir}/05-bot.png`, clip: { x:0, y:380, width:470, height:480 } });
await p.click('.bot-close');

// 6) avalanche — force one, capture the impact
await p.evaluate(() => window.__avalanche.forceWarning());
for (let i=0;i<40;i++){ const s=await p.evaluate(()=>__avalanche.state()); if(s==='impact')break; await p.waitForTimeout(400); }
await p.waitForTimeout(1500);
await p.screenshot({ path: `${dir}/06-avalanche.png` });
await p.close();

// --- 7) registration screen (fresh, no creds) ---
const p2 = await b.newPage({ viewport: { width: VW, height: VH } });
await p2.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p2.waitForTimeout(900);
await p2.screenshot({ path: `${dir}/07-register.png`, clip: { x: VW/2-180, y: VH/2-220, width:360, height:440 } });
await p2.close();

await b.close();
console.log(JSON.stringify({ errors }, null, 2));
