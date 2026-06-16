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
  let roarBuf = null; // decoded bear-growl sample (loaded lazily; synth fallback)
  let muted = false;
  let lastGun = -1; // throttle so simultaneous towers don't stack into a clip

  // Soft-clip (tanh) curve for waveshaper distortion — gives the bear roar its
  // harsh, gritty overtones.
  const distCurve = (() => {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 2.2); }
    return c;
  })();

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
    loadRoar(); // fetch + decode the bear-growl sample for roar()
    return ctx;
  }

  // Load the recorded bear growl. On any failure roarBuf stays null and roar()
  // falls back to the synthesized roar.
  function loadRoar() {
    fetch('/bear-growl.mp3')
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((a) => ctx.decodeAudioData(a))
      .then((buf) => { roarBuf = buf; })
      .catch(() => { roarBuf = null; });
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
  // reads as a machine gun. (Used by the gate guards' rifles.)
  function gunshot() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    if (t - lastGun < 0.05) return; // de-dupe near-simultaneous towers
    lastGun = t;
    const rounds = 3;
    for (let i = 0; i < rounds; i++) crack(t + i * 0.055);
  }

  // Full-auto M-16: one sharp crack per round. Called rapidly by the guards so
  // the stream of cracks reads as a machine gun. Lightly throttled so two guards
  // firing together don't double into a clipped mess.
  let lastRifle = -1;
  function rifle() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    if (t - lastRifle < 0.045) return;
    lastRifle = t;
    crack(t);
  }

  // Minigun "BRRRRT": one SUSTAINED voice gated on/off while the towers fire,
  // not a one-shot per round (that just rattles like a sewing machine). The
  // body is broadband noise + a deep saw; a fast SQUARE LFO at the rounds-per-
  // second rate chops it into sharp per-round cracks that blend into a deep,
  // continuous roar. minigun(true) spins it up, minigun(false) spins it down.
  let mg = null;
  function minigun(active) {
    if (!ensure() || ctx.state !== 'running') return;
    if (!mg) {
      const env = ctx.createGain(); // master on/off envelope for the whole voice
      env.gain.value = 0.0001;
      env.connect(master);
      const amp = ctx.createGain(); // AM stage — the LFO chops this into cracks
      amp.gain.value = 0.45;
      amp.connect(env);
      // broadband body (the crack bite)
      const src = noiseSource();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.7;
      src.connect(lp).connect(amp);
      // deep saw body (the roar's low end)
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth'; saw.frequency.value = 68;
      const slp = ctx.createBiquadFilter();
      slp.type = 'lowpass'; slp.frequency.value = 260;
      saw.connect(slp).connect(amp);
      // fast square LFO = the individual rounds (≈55/s -> 3300 rpm)
      const lfo = ctx.createOscillator();
      lfo.type = 'square'; lfo.frequency.value = 55;
      const depth = ctx.createGain(); depth.gain.value = 0.45;
      lfo.connect(depth).connect(amp.gain);
      src.start(); saw.start(); lfo.start();
      mg = { env, on: false };
    }
    const t = now();
    if (active && !mg.on) {
      mg.on = true;
      mg.env.gain.cancelScheduledValues(t);
      mg.env.gain.setValueAtTime(Math.max(0.0001, mg.env.gain.value), t);
      mg.env.gain.exponentialRampToValueAtTime(0.34, t + 0.04); // quick spin-up
    } else if (!active && mg.on) {
      mg.on = false;
      mg.env.gain.cancelScheduledValues(t);
      mg.env.gain.setValueAtTime(Math.max(0.0001, mg.env.gain.value), t);
      mg.env.gain.exponentialRampToValueAtTime(0.0001, t + 0.13); // spin-down tail
    }
  }

  // Fleet engine bed: one sustained diesel voice whose level/pitch/chug-rate
  // track how much the convoy is driving (intensity 0..1). Low saw + sub +
  // broadband texture, chopped by a slow sawtooth LFO for the diesel "chug".
  let eng = null;
  function engine(intensity) {
    if (!ensure() || ctx.state !== 'running') return;
    intensity = Math.max(0, Math.min(1, intensity));
    if (!eng) {
      const env = ctx.createGain(); env.gain.value = 0.0001; env.connect(master);
      const amp = ctx.createGain(); amp.gain.value = 0.6; amp.connect(env);
      const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = 44;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.6;
      saw.connect(lp).connect(amp);
      const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = 27;
      const subG = ctx.createGain(); subG.gain.value = 0.7; sub.connect(subG).connect(amp);
      const noise = noiseSource();
      const nlp = ctx.createBiquadFilter(); nlp.type = 'lowpass'; nlp.frequency.value = 170;
      const ng = ctx.createGain(); ng.gain.value = 0.22; noise.connect(nlp).connect(ng).connect(amp);
      const lfo = ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 11;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.4; lfo.connect(lfoG).connect(amp.gain);
      saw.start(); sub.start(); noise.start(); lfo.start();
      eng = { env, saw, lfo };
    }
    const t = now();
    eng.env.gain.setTargetAtTime(intensity < 0.02 ? 0.0001 : 0.1 + intensity * 0.2, t, 0.15);
    eng.saw.frequency.setTargetAtTime(40 + intensity * 34, t, 0.2); // revs with load (deep)
    eng.lfo.frequency.setTargetAtTime(8 + intensity * 16, t, 0.2);  // chugs faster when driving
  }

  // A truck pulling away: a short diesel rev (pitch sweeps up).
  let lastAccel = -1;
  function truckAccel() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    if (t - lastAccel < 0.18) return;
    lastAccel = t;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(48, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.35);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(lp).connect(g).connect(master);
    o.start(t); o.stop(t + 0.42);
  }

  // A truck stopping: an air-brake hiss + a short brake squeal.
  let lastBrake = -1;
  function truckBrake() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    if (t - lastBrake < 0.22) return;
    lastBrake = t;
    const src = noiseSource(); // air hiss
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    src.connect(hp).connect(g).connect(master);
    src.start(t); src.stop(t + 0.34);
    const o = ctx.createOscillator(); o.type = 'triangle'; // squeal
    o.frequency.setValueAtTime(720, t);
    o.frequency.exponentialRampToValueAtTime(430, t + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.045, t + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(og).connect(master);
    o.start(t); o.stop(t + 0.26);
  }

  // Metal scrap SLAM as a load lands in the bed: a deep slam (the mass) + a
  // chaotic clang of resonant scrap pieces + a rattly settle. Gold lands a bit
  // heavier than silver; randomized per hit and throttled so a fast load reads
  // as scrap being dumped, not a metronome.
  let lastClink = -1;
  function clink(gold) {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    if (t - lastClink < 0.06) return;
    lastClink = t;
    const v = 0.85 + Math.random() * 0.4; // per-hit variation -> chaotic, not uniform
    const heavy = gold ? 0.8 : 1.0;

    // 1) deep SLAM — the weight of the scrap hitting steel
    const slam = ctx.createOscillator(); slam.type = 'sine';
    slam.frequency.setValueAtTime(150 * heavy, t);
    slam.frequency.exponentialRampToValueAtTime(46 * heavy, t + 0.12);
    const slamG = ctx.createGain();
    slamG.gain.setValueAtTime(0.18, t); // dialed back so the metallic ring dominates
    slamG.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    slam.connect(slamG).connect(master);
    slam.start(t); slam.stop(t + 0.18);

    // 2) metallic CRASH — resonant noise at several inharmonic peaks. Higher Q +
    // longer decay so they RING (tonal, struck-metal) rather than just hiss.
    for (const [f, q, lvl, dur] of [
      [300 * heavy * v, 12, 0.1, 0.3],
      [680 * v, 16, 0.09, 0.34],
      [1250 * v, 20, 0.09, 0.38],
      [2400 * v, 22, 0.07, 0.34],
      [3600 * v, 22, 0.05, 0.3],
      [5200 * v, 18, 0.035, 0.24],
    ]) {
      const src = noiseSource();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(lvl, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(master);
      src.start(t); src.stop(t + dur + 0.02);
    }

    // Inharmonic ringing overtones — the struck-metal CLANG. Louder and ringing
    // out far longer than the noise, so the hit reads as metal, not a thud.
    const mb = 950 * v;
    for (const [mult, lvl, dur] of [[1, 0.1, 0.6], [2.0, 0.08, 0.52], [2.76, 0.07, 0.46], [4.1, 0.05, 0.36], [5.6, 0.035, 0.28]]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mb * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(lvl, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }

    // 3) RATTLE tail — scrap settling (band-limited noise chattered by a fast LFO)
    const rsrc = noiseSource();
    const rbp = ctx.createBiquadFilter(); rbp.type = 'bandpass'; rbp.frequency.value = 1500; rbp.Q.value = 2;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t + 0.02);
    rg.gain.exponentialRampToValueAtTime(0.06, t + 0.05);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    const rlfo = ctx.createOscillator(); rlfo.type = 'square'; rlfo.frequency.value = 34;
    const rlfoG = ctx.createGain(); rlfoG.gain.value = 0.05;
    rlfo.connect(rlfoG).connect(rg.gain);
    rsrc.connect(rbp).connect(rg).connect(master);
    rsrc.start(t); rsrc.stop(t + 0.3);
    rlfo.start(t); rlfo.stop(t + 0.3);
  }

  // Bear roar: play the recorded growl sample (varied slightly per roar). Falls
  // back to the synthesized roar below if the sample hasn't loaded.
  let lastRoar = -1;
  function roar() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    if (t - lastRoar < 0.3) return; // a wave spawns 2-3 bears at once — don't stack
    lastRoar = t;
    if (!roarBuf) { roarSynth(); return; }
    const src = ctx.createBufferSource();
    src.buffer = roarBuf;
    src.playbackRate.value = 0.88 + Math.random() * 0.18; // vary pitch/length per roar
    const g = ctx.createGain();
    g.gain.value = 0.95;
    src.connect(g).connect(master);
    src.start(t);
  }

  // Synthesized fallback roar (used until/unless the sample is available).
  function roarSynth() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    const dur = 1.5;
    const stop = t + dur + 0.1;
    const out = ctx.createGain();
    out.gain.value = 0.7;
    out.connect(master);
    const env = (param, peak) => {
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(peak, t + 0.07);
      param.setValueAtTime(peak, t + dur * 0.5);
      param.exponentialRampToValueAtTime(0.0001, t + dur);
    };

    // Shared modulators: a slow natural vibrato + a random (noise-driven) jitter.
    // The jitter is what makes it read as a live, growling animal rather than a
    // synth tone.
    const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5.5;
    const vibG = ctx.createGain(); vibG.gain.value = 4; vib.connect(vibG);
    const jit = noiseSource();
    const jitLP = ctx.createBiquadFilter(); jitLP.type = 'lowpass'; jitLP.frequency.value = 22;
    const jitG = ctx.createGain(); jitG.gain.value = 16; jit.connect(jitLP).connect(jitG);

    // The VOICE: two slightly detuned low saws gliding down, run through grit
    // and a formant chain (peaks ≈ 320 / 760 Hz) so it sounds "voiced".
    const v1 = ctx.createOscillator(); v1.type = 'sawtooth';
    const v2 = ctx.createOscillator(); v2.type = 'sawtooth';
    for (const v of [v1, v2]) {
      v.frequency.setValueAtTime(88, t);
      v.frequency.exponentialRampToValueAtTime(66, t + 0.2);
      v.frequency.exponentialRampToValueAtTime(44, t + dur);
      vibG.connect(v.frequency);
      jitG.connect(v.frequency);
    }
    v2.detune.value = 17; // detune -> thick, throaty beating
    const drive = ctx.createGain(); drive.gain.value = 0.7;
    const shaper = ctx.createWaveShaper(); shaper.curve = distCurve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.6;
    const f1 = ctx.createBiquadFilter(); f1.type = 'peaking'; f1.frequency.value = 320; f1.Q.value = 1.0; f1.gain.value = 8;
    const f2 = ctx.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 760; f2.Q.value = 1.4; f2.gain.value = 5;
    const voiceG = ctx.createGain(); env(voiceG.gain, 0.5);
    v1.connect(drive); v2.connect(drive);
    drive.connect(shaper).connect(lp).connect(f1).connect(f2).connect(voiceG).connect(out);

    // Deep SUB octave (pure sine weight) — the rumble you feel.
    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(44, t);
    sub.frequency.exponentialRampToValueAtTime(22, t + dur);
    const subG = ctx.createGain(); env(subG.gain, 0.62);
    sub.connect(subG).connect(out);

    // Breath rasp (band-limited noise) for the airy edge.
    const rasp = noiseSource();
    const rHP = ctx.createBiquadFilter(); rHP.type = 'highpass'; rHP.frequency.value = 180;
    const rLP = ctx.createBiquadFilter(); rLP.type = 'lowpass'; rLP.frequency.value = 750;
    const rG = ctx.createGain(); env(rG.gain, 0.13);
    rasp.connect(rHP).connect(rLP).connect(rG).connect(out);

    for (const o of [v1, v2, sub, vib]) { o.start(t); o.stop(stop); }
    jit.start(t); jit.stop(stop);
    rasp.start(t); rasp.stop(stop);
  }

  // Payday: the satisfying "whump" of a heavy load of precious metal landing —
  // a deep impact thud (the mass), a clatter of metal bars tumbling, and a
  // bright ascending reward chime on top. Lightly throttled + pitch-varied so
  // rapid deliveries don't degrade into an annoying click track.
  let lastCoin = -1;
  function coin() {
    if (!ensure() || muted || ctx.state !== 'running') return;
    const t = now();
    if (t - lastCoin < 0.08) return;
    lastCoin = t;
    const vary = 0.97 + Math.random() * 0.06; // slight pitch variation per payout

    // 1) heavy impact thud — the weight of the load hitting the bed
    const thud = ctx.createOscillator(); thud.type = 'sine';
    thud.frequency.setValueAtTime(150, t);
    thud.frequency.exponentialRampToValueAtTime(46, t + 0.16);
    const thG = ctx.createGain();
    thG.gain.setValueAtTime(0.5, t);
    thG.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    thud.connect(thG).connect(master);
    thud.start(t); thud.stop(t + 0.22);

    // 2) metallic clatter — bars/ingots tumbling (resonant noise bursts)
    for (const [f, q, lvl, dur] of [[3200, 4, 0.16, 0.22], [5400, 6, 0.1, 0.17]]) {
      const src = noiseSource();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(lvl, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(master);
      src.start(t); src.stop(t + dur + 0.02);
    }

    // 3) bright reward chime — a major arpeggio with a shimmering octave
    [784, 988, 1319].forEach((f0, i) => {
      const s = t + 0.04 + i * 0.05;
      const f = f0 * vary;
      for (const [mult, lvl, type] of [[1, 0.15, 'triangle'], [2, 0.05, 'sine']]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(lvl, s + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3);
        o.connect(g).connect(master);
        o.start(s); o.stop(s + 0.32);
      }
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

  return { unlock, setMuted, isMuted, gunshot, rifle, minigun, engine, truckAccel, truckBrake, clink, roar, coin, alarm, rumble, crash };
}
