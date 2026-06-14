// sfx.js — procedural sound effects via the Web Audio API (no asset files).
// Everything is synthesized: machine-gun cracks, bear roars, a cash "ka-ching",
// and a breach alarm. Audio is unlocked on the first user gesture (browsers block
// sound until then) and can be muted with the 🔊 button.
//
//   createSfx() -> { unlock, setMuted, isMuted, gunshot, roar, coin, alarm }

export function createSfx() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  let lastGun = -1; // throttle so simultaneous towers don't stack into a clip

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
    // one second of white noise, reused for every percussive effect
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  // Call from a user gesture (click/keydown) to satisfy autoplay policies.
  function unlock() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : 0.45;
  }
  function isMuted() {
    return muted;
  }

  function now() {
    return ctx.currentTime;
  }

  function noiseSource() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    return src;
  }

  // A single machine-gun crack scheduled at time `t`: filtered-noise burst + thump.
  function crack(t) {
    const src = noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700 + Math.random() * 600;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(bp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.08);

    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.24, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 0.09);
  }

  // One trigger = a short 3-round rattle, so the slow per-tower fire rate still
  // reads as a machine gun.
  function gunshot() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    if (t - lastGun < 0.05) return; // de-dupe near-simultaneous towers
    lastGun = t;
    const rounds = 3;
    for (let i = 0; i < rounds; i++) crack(t + i * 0.055);
  }

  // Bear roar: a low growl that glides down, with vibrato and a noisy rasp.
  function roar() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    const dur = 1.1;

    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(135, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.25);
    o.frequency.exponentialRampToValueAtTime(48, t + dur);
    // vibrato to give it a guttural wobble
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 18;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 14;
    lfo.connect(lfoG).connect(o.frequency);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
    g.gain.setValueAtTime(0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(master);

    // noisy rasp layered on top
    const src = noiseSource();
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.18, t + 0.12);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'lowpass';
    nlp.frequency.value = 700;
    src.connect(nlp).connect(ng).connect(master);

    o.start(t); lfo.start(t); src.start(t);
    o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05); src.stop(t + dur + 0.05);
  }

  // Cash "ka-ching": two quick ascending square blips.
  function coin() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    [988, 1319].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      const s = t + i * 0.06;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.16, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.12);
      o.connect(g).connect(master);
      o.start(s);
      o.stop(s + 0.13);
    });
  }

  // Breach alarm: a short two-tone klaxon.
  function alarm() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    [[440, 0], [330, 0.18], [440, 0.36]].forEach(([f, dt]) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      const g = ctx.createGain();
      const s = t + dt;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.3, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.connect(lp).connect(g).connect(master);
      o.start(s);
      o.stop(s + 0.18);
    });
  }

  // Avalanche warning: a low, swelling rumble (filtered noise rising in volume).
  function rumble() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    const dur = 2.2;
    const src = noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(140, t);
    lp.frequency.linearRampToValueAtTime(320, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // Avalanche impact: a big crashing roar of snow + a low boom.
  function crash() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    const dur = 1.8;
    const src = noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
    // low boom underneath
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.6);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 0.85);
  }

  return { unlock, setMuted, isMuted, gunshot, roar, coin, alarm, rumble, crash };
}
