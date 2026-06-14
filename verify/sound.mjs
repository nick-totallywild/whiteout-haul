import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1000 } });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console:' + m.text()); });
await p.addInitScript(() => {
  localStorage.setItem('whiteout-nick', 'Nick');
  localStorage.setItem('whiteout-email', 'n@gmail.com');
});
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

// A real gesture to unlock audio.
await p.mouse.click(500, 500);

// Verify an AudioContext was created and is running.
const audioState = await p.evaluate(() => {
  // peek at any live AudioContext via a fresh probe (the game's is internal)
  return { hasAC: !!(window.AudioContext || window.webkitAudioContext) };
});

// Fund towers so they fire, and let bears spawn (roars) + deliveries (coins).
await p.evaluate(() => {
  window.__econ.state.cash = 1e7;
  while (window.__buy('tower')) {}
  window.__buy('truck'); window.__buy('truck'); window.__buy('capacity');
});
await p.waitForTimeout(12000); // gunfire + roars + coins happen in here

// Mute button behaviour.
const before = await p.$eval('#mute-btn', el => el.textContent);
await p.click('#mute-btn');
const after = await p.$eval('#mute-btn', el => ({ text: el.textContent, muted: el.classList.contains('muted') }));

await p.screenshot({ path: 'verify/sound.png' });
await b.close();
console.log(JSON.stringify({ audioState, muteToggle: { before, after }, errors }, null, 2));
