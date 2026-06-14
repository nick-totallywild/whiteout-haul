import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.screenshot({ path: 'verify/reg-modal.png', clip: { x: 320, y: 360, width: 360, height: 360 } });
// invalid email
await p.fill('.lb-nick', 'Skipper');
await p.fill('.lb-email', 'bademail');
await p.click('.lb-go');
await p.waitForTimeout(400);
const err1 = await p.locator('.lb-error').innerText();
// valid email
await p.fill('.lb-email', 'skipper@gmail.com');
await p.click('.lb-go');
await p.waitForTimeout(1000);
const modalHidden = !(await p.locator('.lb-modal').isVisible());
const lbText = await p.locator('.lb-panel .lb-list').innerText().catch(()=>'');
await b.close();
console.log(JSON.stringify({ err1, modalHidden, lbText: lbText.replace(/\n/g,' | ') }, null, 2));
