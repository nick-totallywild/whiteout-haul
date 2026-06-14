import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('.bot-toggle');
// select Fence repair from the dropdown
await p.selectOption('.bot-examples', 'Fence repair');
await p.waitForTimeout(300);
const afterSelect = await p.evaluate(() => ({
  isRunning: window.WhiteoutBot.isRunning(),
  badge: document.querySelector('.bot-run-badge').textContent,
  badgeOn: document.querySelector('.bot-run-badge').classList.contains('on'),
  toggleRunning: document.querySelector('.bot-toggle').classList.contains('running'),
  status: document.querySelector('.bot-status').textContent,
  codeStart: document.querySelector('.bot-code').value.slice(0,40),
}));
await p.screenshot({ path: 'verify/botrun.png', clip: { x: 8, y: 430, width: 460, height: 570 } });
// stop and check badge updates
await p.click('.bot-stop');
await p.waitForTimeout(200);
const afterStop = await p.evaluate(() => ({ isRunning: window.WhiteoutBot.isRunning(), badge: document.querySelector('.bot-run-badge').textContent, toggleRunning: document.querySelector('.bot-toggle').classList.contains('running') }));
await b.close();
console.log(JSON.stringify({ afterSelect, afterStop, errors }, null, 2));
