import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
for (let i=0;i<7;i++){ await p.waitForTimeout(1000);
  const btns=p.locator('.upgrade-btn'); const n=await btns.count();
  for(let j=0;j<n;j++){const c=await btns.nth(j).getAttribute('class')||''; if(!c.includes('disabled')){await btns.nth(j).click();break;}}}
for (let k=0;k<6;k++){ await p.waitForTimeout(500);
  await p.screenshot({ path: `verify/exit-${k}.png`, clip: { x: 10, y: 300, width: 320, height: 250 } }); }
await b.close(); console.log('done');
