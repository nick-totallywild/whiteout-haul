import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(8000); // let some income accrue so cash != earned
await p.screenshot({ path: 'verify/labels-tr.png', clip: { x: 760, y: 0, width: 240, height: 120 } });
await p.screenshot({ path: 'verify/labels-lb.png', clip: { x: 0, y: 0, width: 280, height: 230 } });
await b.close(); console.log('done');
