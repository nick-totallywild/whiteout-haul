import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 900 } });
await p.addInitScript(() => { localStorage.setItem('whiteout-nick','Nick'); localStorage.setItem('whiteout-email','n@gmail.com'); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
const dump = await p.evaluate(() => {
  // pull seg mids from the scene fence segments
  const segs = window.__world.fence.segments.map(s => ({ x: +s.mid.x.toFixed(1), z: +s.mid.z.toFixed(1), axis: s.axis }));
  // unique z values to confirm perimeter
  const zs = [...new Set(segs.map(s => s.z))].sort((a,b)=>a-b);
  const xs = [...new Set(segs.map(s => s.x))].sort((a,b)=>a-b);
  return { count: segs.length, zs, xs, sample: segs.slice(0, 8) };
});
await b.close();
console.log(JSON.stringify(dump, null, 2));
