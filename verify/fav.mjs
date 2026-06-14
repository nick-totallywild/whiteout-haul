import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 200, height: 200 } });
await p.setContent(`<body style="margin:0;background:#8fa4b5;display:flex;gap:16px;align-items:center;justify-content:center">
  <img src="http://localhost:5173/favicon.svg" width="96" height="96">
  <img src="http://localhost:5173/favicon.svg" width="32" height="32">
  <img src="http://localhost:5173/favicon.svg" width="16" height="16">
</body>`);
await p.waitForTimeout(400);
await p.screenshot({ path:'verify/fav.png' });
await b.close();
console.log('rendered');
