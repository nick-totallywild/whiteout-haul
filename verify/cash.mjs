import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); localStorage.setItem('whiteout-admin','1'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.screenshot({ path: 'verify/cash.png', clip: { x: 760, y: 0, width: 240, height: 150 } });
await b.close(); console.log('done');
