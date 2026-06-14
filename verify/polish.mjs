import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.screenshot({ path: 'verify/portal.png', clip: { x: 220, y: 40, width: 400, height: 300 } });
await p.screenshot({ path: 'verify/tunnel.png', clip: { x: 0, y: 300, width: 320, height: 300 } });
await b.close(); console.log('done');
