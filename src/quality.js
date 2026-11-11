// src/quality.js — adaptive quality governor.
// Measures the frame time and walks a ladder of steps (each step changes ONE thing), down when slow, back up when there is headroom:
//   DPR -> antialias -> shadows -> environment light -> glass -> solver level (grid / step rate) -> particle & smoke counts -> lowest DPR.
// `lite` jumps to the last step and stays there (the "Chế độ nhẹ" button of the watchdog notice).
// ?q=N in the URL pins the step N (tests, screenshots); ?q=auto is the default.
import { MAX_LEVEL } from './flow/plane.js';

export const LADDER = [
  { name: 'full' },
  { name: 'dpr 0.8', p: { dpr: 0.8 } },
  { name: 'dpr 0.65', p: { dpr: 0.65 } },
  { name: 'no antialias', p: { aa: false } },
  { name: 'no shadows', p: { shadows: false } },
  { name: 'no environment', p: { env: false } },
  { name: 'no glass', p: { glass: false } },
  { name: 'solver 1', p: { solver: 1 } },
  { name: 'solver 2', p: { solver: 2 } },
  { name: 'dpr 0.5', p: { dpr: 0.5 } },
  { name: 'solver 3', p: { solver: 3 } },
  { name: 'counts 0.6', p: { scale: 0.6 } },
  { name: 'solver 4, counts 0.35, dpr 0.4', p: { solver: Math.min(4, MAX_LEVEL), scale: 0.35, dpr: 0.4 } },
];
const SLOW_S = 1 / 22, FAST_S = 1 / 48;       // frame time above / below which we step down / up
const SLOW_HOLD = 0.6, FAST_HOLD = 6, SETTLE = 0.7, LOCK_S = 60;

// software WebGL (SwiftShader, llvmpipe, Microsoft Basic Render Driver): start at the lowest step, the governor climbs if there is headroom
function software(scene) {
  try {
    const gl = scene.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software|microsoft basic|mesa offscreen/i.test(r);
  } catch (err) { return false; }
}

export function createQuality({ scene, flow, state, tier }) {
  const plane = flow && flow.plane;
  const full = { dpr: 1, aa: tier === 'high', shadows: tier === 'high', env: true, glass: true, solver: 0, scale: 1 };
  const cur = Object.assign({}, full);
  const q = { scale: 1, step: 0, auto: true, lite: false, ema: 1 / 60, fps: 60 };
  let slowT = 0, fastT = 0, settle = 1.5, lockT = 0, lastUp = -1e9, clock = 0;

  function configAt(step) {                        // cumulative settings of a step
    const c = Object.assign({}, full);
    for (let i = 1; i <= step; i++) Object.assign(c, LADDER[i].p);
    if (tier !== 'high') { c.aa = false; c.shadows = false; }
    return c;
  }
  function apply(step) {
    const c = configAt(step);
    scene.setQuality({ dpr: c.dpr, aa: c.aa, shadows: c.shadows, env: c.env, glass: c.glass });
    if (plane) plane.setLevel(c.solver);
    q.scale = c.scale; q.step = step; Object.assign(cur, c);
  }
  const key = (c) => [c.dpr, c.aa, c.shadows, c.env, c.glass, c.solver, c.scale].join('|');
  function move(step, dir) {                       // next step that really changes something
    const k0 = key(configAt(q.step));
    let s = step;
    while (s > 0 && s < LADDER.length - 1 && key(configAt(s)) === k0) s += dir;
    return Math.max(0, Math.min(LADDER.length - 1, s));
  }
  const hist = [];
  function set(step) { hist.push([+clock.toFixed(1), step]); apply(Math.max(0, Math.min(LADDER.length - 1, step))); slowT = fastT = 0; settle = SETTLE; }

  function update(raw) {
    if (!(raw > 0)) return;
    const dt = raw > 0.5 ? 0.5 : raw;
    clock += dt;
    q.ema += (dt - q.ema) * Math.min(1, dt / 0.6);
    q.fps = 1 / q.ema;
    if (!q.auto) return;
    if (settle > 0) { settle -= dt; return; }       // frames right after a change include shader compiles: ignore them
    lockT -= dt;
    if (q.ema > SLOW_S) { slowT += dt; fastT = 0; }
    else if (q.ema < FAST_S) { fastT += dt; slowT = 0; }
    else { slowT = 0; fastT = 0; }
    if (slowT > SLOW_HOLD && q.step < LADDER.length - 1) {
      if (clock - lastUp < 20) lockT = LOCK_S;      // stepped up and was slow again within 20 s: stay down for a minute
      const n = q.ema > 0.25 ? 4 : q.ema > 0.12 ? 2 : 1;      // the slower the frame, the bigger the cut
      let s = q.step; for (let i = 0; i < n; i++) s = move(s + 1, 1);
      set(s);
    } else if (fastT > FAST_HOLD && q.step > 0 && lockT <= 0) {
      lastUp = clock; set(move(q.step - 1, -1));
    }
  }

  function setLite(on) { q.lite = !!on; q.auto = !on; if (on) set(LADDER.length - 1); else { q.auto = true; } }
  function pin(step) { q.auto = false; set(step); }

  // URL / storage
  let qp = null; try { qp = new URLSearchParams(location.search).get('q'); } catch (e) {}
  if (qp != null && qp !== 'auto' && qp !== '' && isFinite(+qp)) pin(+qp);
  else { let sp = null; try { sp = new URLSearchParams(location.search).get('soft'); } catch (e) {} q.soft = sp === '0' ? false : software(scene); apply(q.soft ? LADDER.length - 1 : 0); }
  if (q.soft) scene.setQuality({ pace: true });
  try { if (window.Boot && window.Boot.store && window.Boot.store.get('lite', 0) === 1 && qp == null) setLite(true); } catch (e) {}
  try { if (window.Boot && window.Boot.onLite) window.Boot.onLite(setLite); } catch (e) {}

  return {
    update, set, pin, setLite, get scale() { return q.scale; },
    state: () => ({ hist: hist.slice(-16), soft: !!q.soft, step: q.step, name: LADDER[q.step].name, auto: q.auto, lite: q.lite, fps: +q.fps.toFixed(1), emaMs: +(q.ema * 1000).toFixed(1), cfg: Object.assign({}, cur) }),
  };
}
