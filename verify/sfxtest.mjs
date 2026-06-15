import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:5174/';
// allow the AudioContext to run without a user gesture so the audio graphs
// actually execute (not just early-return)
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
const errors = [];
p.on('pageerror', e => errors.push(e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.goto(URL, { waitUntil: 'networkidle' });

const res = await p.evaluate(async () => {
  const s = window.__sfx;
  s.unlock();
  const out = {};
  // confirm the bear-growl asset is served and decodable (so roar uses it)
  try {
    const r = await fetch('/bear-growl.mp3');
    out.fileStatus = r.status;
    const ab = await r.arrayBuffer();
    out.fileBytes = ab.byteLength;
    const AC = window.AudioContext || window.webkitAudioContext;
    const c = new AC();
    const buf = await c.decodeAudioData(ab);
    out.decoded = { duration: +buf.duration.toFixed(2), channels: buf.numberOfChannels, rate: buf.sampleRate };
    c.close();
  } catch (e) { out.asset = 'FAILED: ' + e.message; }
  await new Promise(r => setTimeout(r, 700)); // let the engine load+decode its copy
  try { s.roar(); out.roar = 'ok'; } catch (e) { out.roar = 'THREW: ' + e.message; }
  try { s.minigun(true); out.minigunOn = 'ok'; } catch (e) { out.minigunOn = 'THREW: ' + e.message; }
  await new Promise(r => setTimeout(r, 150));
  try { s.minigun(false); out.minigunOff = 'ok'; } catch (e) { out.minigunOff = 'THREW: ' + e.message; }
  try { s.gunshot(); out.gunshot = 'ok'; } catch (e) { out.gunshot = 'THREW: ' + e.message; }
  try { s.rifle(); out.rifle = 'ok'; } catch (e) { out.rifle = 'THREW: ' + e.message; }
  try { s.coin(); out.coin = 'ok'; } catch (e) { out.coin = 'THREW: ' + e.message; }
  try { s.engine(0.6); s.engine(0); out.engine = 'ok'; } catch (e) { out.engine = 'THREW: ' + e.message; }
  try { s.truckAccel(); out.truckAccel = 'ok'; } catch (e) { out.truckAccel = 'THREW: ' + e.message; }
  try { s.truckBrake(); out.truckBrake = 'ok'; } catch (e) { out.truckBrake = 'THREW: ' + e.message; }
  try { s.clink(true); s.clink(false); out.clink = 'ok'; } catch (e) { out.clink = 'THREW: ' + e.message; }
  return out;
});
await new Promise(r => setTimeout(r, 300));
await b.close();
console.log(JSON.stringify({ res, errors }, null, 2));
