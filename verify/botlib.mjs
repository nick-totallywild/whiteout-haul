import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('.bot-toggle');
const options = await p.$$eval('.bot-examples option', els => els.map(e => e.value).filter(Boolean));
// load the emergency responder example
await p.selectOption('.bot-examples', 'Emergency responder (keep ops running)');
const loaded = await p.$eval('.bot-code', el => el.value.slice(0, 60));
const selReset = await p.$eval('.bot-examples', el => el.value);
// run it
await p.click('.bot-run');
const status = await p.$eval('.bot-status', el => el.textContent);
const apiHasHold = await p.evaluate(() => typeof window.WhiteoutBot.holdTrucks === 'function');
await p.screenshot({ path: 'verify/botlib.png', clip: { x: 8, y: 480, width: 380, height: 520 } });
await b.close();
console.log(JSON.stringify({ options, loadedStartsWith: loaded, selReset, status, apiHasHold, errors }, null, 2));
