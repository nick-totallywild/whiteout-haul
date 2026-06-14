import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.fill('.lb-input', 'Tester');
await p.click('.lb-go');
await p.waitForTimeout(1200);
await p.screenshot({ path: 'verify/lbshot.png', clip: { x: 0, y: 0, width: 300, height: 320 } });
await b.close(); console.log('done');
