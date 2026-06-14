import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.screenshot({ path: 'verify/park.png', clip: { x: 230, y: 560, width: 520, height: 320 } });
await b.close(); console.log('done');
