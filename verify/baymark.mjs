import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Tester');
  localStorage.setItem('whiteout-email', 'tester@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
await p.screenshot({ path: 'verify/baymark.png', clip: { x: 230, y: 470, width: 620, height: 220 } });
await b.close(); console.log('done');
