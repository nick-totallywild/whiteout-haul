import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.screenshot({ path: 'verify/v-portal.png', clip: { x: 300, y: 90, width: 300, height: 250 } });
await p.screenshot({ path: 'verify/v-tunnel.png', clip: { x: 10, y: 280, width: 300, height: 260 } });
await b.close(); console.log('done');
