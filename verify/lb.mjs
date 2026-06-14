import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1100 } });
const logs = [];
p.on('console', m => { if (m.text().includes('[lb]')) logs.push(m.text()); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.fill('.lb-input', 'NickTheBoss');
await p.click('.lb-go');
await p.evaluate(() => {
  window.WhiteoutBot.setStrategy(s => {
    const k = ['truck','capacity','speed'].filter(x => s.affordable[x]).sort((a,b)=>s.costs[a]-s.costs[b])[0];
    if (k) window.WhiteoutBot.buy(k);
  });
});
await p.waitForTimeout(20000);
const lbText = await p.locator('.lb-panel .lb-list').innerText().catch(()=>'');
await b.close();
console.log('logs:', JSON.stringify(logs, null, 2));
console.log('lbText:', lbText.replace(/\n/g,' | '));
