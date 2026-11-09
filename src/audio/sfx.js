// P6 — sfx.js: soft tactile UI sounds + fan hum. WebAudio only, no files, no chimes, no tonal beeps.
// API: play('tap'|'toggle'|'tick'|'swap', opts), setWind(U), setEnabled(bool), unlock(), init(ctx).
// Nothing is created before the first user gesture (iOS / Zalo / Facebook in-app browsers).

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x5F3A);

let ac = null, master = null, noiseBuf = null, fan = null;
let enabled = true, windU = 20, gestureBound = false;
const lastT = Object.create(null);
const MIN_GAP = { tap: 0.04, toggle: 0.08, tick: 0.028, swap: 0.15 };

function makeNoise(ctxA, seconds, pink) {
  const n = Math.floor(ctxA.sampleRate * seconds), b = ctxA.createBuffer(1, n, ctxA.sampleRate), d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    if (pink) {   // Paul Kellet pink-noise filter: warm, soft air
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else d[i] = w;
  }
  return b;
}

// --- building blocks (all envelopes start and end at ~0: no clicks from the engine itself) ---
function env(g, t, att, dur, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + att);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
function burst(t, o) {          // filtered-noise burst
  const src = ac.createBufferSource(); src.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f, t); f.Q.value = o.q || 1;
  if (o.f2) f.frequency.linearRampToValueAtTime(o.f2, t + o.dur * (o.fk || 1));
  if (o.f3) f.frequency.linearRampToValueAtTime(o.f3, t + o.dur);
  const g = ac.createGain(); env(g, t, o.att || 0.0015, o.dur, o.gain);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, rnd() * 0.8); src.stop(t + o.dur + 0.03);
  src.onended = () => { try { g.disconnect(); f.disconnect(); } catch (e) {} };
}
function thump(t, o) {          // short pitch-dropping sine = the physical "body" of a press
  const osc = ac.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(o.f0, t); osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  const g = ac.createGain(); env(g, t, 0.002, o.dur, o.gain);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + o.dur + 0.03);
  osc.onended = () => { try { g.disconnect(); } catch (e) {} };
}

const RECIPES = {
  tap(t) {
    burst(t, { type: 'highpass', f: 3800, q: 0.7, dur: 0.008, gain: 0.10 });
    burst(t, { f: 1700, q: 0.9, dur: 0.035, gain: 0.22 });
    thump(t, { f0: 170, f1: 80, dur: 0.06, gain: 0.30 });
  },
  toggle(t, o) {
    const on = !o || o.on !== false;
    burst(t, { f: 2300, q: 1.2, dur: 0.02, gain: 0.24 }); thump(t, { f0: 150, f1: 90, dur: 0.05, gain: 0.22 });
    const t2 = t + 0.06;
    burst(t2, { f: on ? 3000 : 1800, q: 1.3, dur: 0.016, gain: 0.17 });
    thump(t2, { f0: on ? 190 : 120, f1: 100, dur: 0.035, gain: 0.12 });
  },
  tick(t) {
    const k = 0.94 + rnd() * 0.12;
    burst(t, { f: 3300 * k, q: 2.2, dur: 0.012, gain: 0.22 });
    thump(t, { f0: 230 * k, f1: 150, dur: 0.022, gain: 0.10 });
  },
  swap(t) {   // soft slide of air, ends with a low seat thud
    burst(t, { f: 450, f2: 1500, f3: 600, fk: 0.45, q: 0.8, att: 0.07, dur: 0.24, gain: 0.11 });
    burst(t + 0.2, { type: 'lowpass', f: 900, q: 0.7, dur: 0.05, gain: 0.12 });
    thump(t + 0.2, { f0: 95, f1: 52, dur: 0.11, gain: 0.30 });
  },
};

// --- fan hum: filtered pink noise + low sine pair, smooth in U ---
function buildFan() {
  const out = ac.createGain(); out.gain.value = 0; out.connect(master);
  const src = ac.createBufferSource(); src.buffer = makeNoise(ac, 3, true); src.loop = true;
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 55;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
  const ng = ac.createGain();
  src.connect(hp); hp.connect(lp); lp.connect(ng); ng.connect(out);
  const o1 = ac.createOscillator(), o2 = ac.createOscillator(); o1.type = o2.type = 'sine';
  const tg = ac.createGain(), t2 = ac.createGain(); t2.gain.value = 0.4;
  const tl = ac.createBiquadFilter(); tl.type = 'lowpass'; tl.frequency.value = 420;
  o1.connect(tg); o2.connect(t2); t2.connect(tg); tg.connect(tl); tl.connect(out);
  const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.7; lg.gain.value = 0.6;
  lfo.connect(lg); lg.connect(o1.frequency);
  src.start(); o1.start(); o2.start(); lfo.start();
  fan = { out, lp, ng, tg, o1, o2 };
  applyWind(true);
}
function applyWind(now) {
  if (!fan) return;
  const s = Math.pow(Math.min(1, Math.max(0, windU) / 120), 0.6);
  const t = ac.currentTime, tc = now ? 0.02 : 0.35;
  const set = (p, v) => p.setTargetAtTime(v, t, tc);
  set(fan.out.gain, enabled ? 1 : 0);
  set(fan.ng.gain, 0.045 + 0.10 * s);
  set(fan.tg.gain, 0.020 + 0.030 * s);
  set(fan.lp.frequency, 170 + 1900 * Math.pow(s, 1.2));
  const f0 = 46 + 62 * s;
  set(fan.o1.frequency, f0); set(fan.o2.frequency, f0 * 2.01);
}

function ensure() {
  if (ac) return true;
  if (!AC) return false;
  try { ac = new AC(); } catch (e) { ac = null; return false; }
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
  master = ac.createGain(); master.gain.value = enabled ? 0.8 : 0;
  master.connect(comp); comp.connect(ac.destination);
  noiseBuf = makeNoise(ac, 1.5, false);
  buildFan();
  return true;
}

export function unlock() {
  if (!ensure()) return;
  if (enabled && ac.state !== 'running') ac.resume().catch(() => {});
}
function bindGesture() {
  if (gestureBound || typeof window === 'undefined') return;
  gestureBound = true;
  const ev = ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'keydown', 'click'];
  const h = () => {
    unlock();
    if (ac && ac.state === 'running') ev.forEach((e) => window.removeEventListener(e, h, true));
  };
  ev.forEach((e) => window.addEventListener(e, h, { capture: true, passive: true }));
}

export function setEnabled(on) {
  enabled = !!on;
  if (!ac) return;
  const t = ac.currentTime;
  master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(enabled ? 0.8 : 0, t, 0.05);
  applyWind(false);
  if (enabled) ac.resume().catch(() => {});
  else setTimeout(() => { if (!enabled && ac && ac.state === 'running') ac.suspend().catch(() => {}); }, 400);
}

export function setWind(U) {
  windU = +U || 0;
  if (ac && ac.state === 'running') applyWind(false);
}

export function play(name, opts) {
  if (!enabled || !ac || ac.state !== 'running' || !RECIPES[name]) return;
  const t = ac.currentTime;
  if (lastT[name] !== undefined && t - lastT[name] < (MIN_GAP[name] || 0.03)) return;
  lastT[name] = t;
  RECIPES[name](t + 0.005, opts);
}

export function init(ctx) {
  bindGesture();
  if (ctx && ctx.state) {
    const st = ctx.state.get();
    enabled = st.sound !== false; windU = st.U || windU;
    ctx.state.on('change:sound', () => setEnabled(ctx.state.get().sound !== false));
    ctx.state.on('change:U', () => setWind(ctx.state.get().U));
  }
  return sfx;
}

export const sfx = { play, setWind, setEnabled, unlock, init };
bindGesture();
export default sfx;

// offline rendering of a recipe (used by the checker): returns an AudioBuffer-like channel after run
export function _renderForTest(OfflineCtor, name, opts, seconds) {
  const off = new OfflineCtor(1, 44100 * seconds, 44100);
  const saveAc = ac, saveM = master, saveN = noiseBuf;
  ac = off; master = off.createGain(); master.gain.value = 0.8; master.connect(off.destination);
  noiseBuf = makeNoise(off, 1.5, false);
  RECIPES[name](0.005, opts);
  const p = off.startRendering();
  ac = saveAc; master = saveM; noiseBuf = saveN;
  return p;
}
