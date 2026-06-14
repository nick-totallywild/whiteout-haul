import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.screenshot({ path: 'verify/j.png', clip: { x: 348, y: 225, width: 240, height: 180 } });
await b.close(); console.log('done');
