/* state.js — shared app state (SPEC §4).
 * state.get()          -> live state object (do not mutate directly; use set)
 * state.set(patch)     -> shallow-merge top-level keys, emit 'change:<key>' (new value) per key, then 'change' ({patch, state})
 * state.on(ev, fn)     -> returns off()
 * state.emit(ev, data) -> emit any event ('results', 'layout', ...)
 * builder.p is left empty here: P4 (builder) fills it from the catalog defaults at init.
 */

/* Tier detection: phones, low memory or a weak/software GPU -> 'low'. ?tier=low|high overrides. */
export function detectTier() {
  try {
    const q = new URLSearchParams(location.search).get('tier');
    if (q === 'low' || q === 'high') return q;
  } catch (e) {}
  try {
    const ua = navigator.userAgent || '';
    const touch = (navigator.maxTouchPoints || 0) > 0;
    const small = Math.min(screen.width, screen.height) < 820;
    const phone = /Android.+Mobile|iPhone|iPod|Mobile Safari|Zalo|FBAN|FBAV/i.test(ua) || (touch && small);
    if (phone) return 'low';
    if (navigator.deviceMemory && navigator.deviceMemory <= 4) return 'low';
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) return 'low';
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'low';
    let weak = false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const r = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
      weak = /swiftshader|llvmpipe|software|softpipe|microsoft basic|mali-4|mali-t|adreno \(tm\) [2-5]\d\d|powervr|videocore|intel\(r\) (hd|uhd) graphics [23]\d{2}\b/i.test(r);
    }
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return weak ? 'low' : 'high';
  } catch (e) { return 'low'; }
}

function defaults() {
  return {
    mode: 'library',
    modelId: 'sphere',
    builder: { nose: 'ogive', body: 'round', tail: 'point', wing: 'none', fins: 'cross', p: {} },
    U: 20,
    alphaDeg: 0,
    env: { mode: 'altitude', h: 0, T: 288.15, p: 101325 },
    view: { flow: 'smoke', smokeColor: 'white', density: 0.7, lines: 24, rake: 'plane', heatmap: 'off', forces: true, shock: true, tunnel: true, rate: 1, paused: false },
    camera: 'overview',
    probe: { on: false, x: 0.6, y: 0.15, z: 0 },
    pins: [],
    sound: true,
    tier: detectTier()
  };
}

export function createState(initial) {
  let data = Object.assign(defaults(), initial || {});
  const subs = Object.create(null);

  function emit(ev, payload) {
    const list = subs[ev];
    if (!list) return;
    for (const fn of list.slice()) {
      try { fn(payload); } catch (err) { try { console.error('[state]', ev, err); } catch (e) {} }
    }
  }
  function on(ev, fn) {
    (subs[ev] || (subs[ev] = [])).push(fn);
    return function off() {
      const l = subs[ev];
      if (!l) return;
      const i = l.indexOf(fn);
      if (i > -1) l.splice(i, 1);
    };
  }
  function get() { return data; }
  function set(patch) {
    if (!patch || typeof patch !== 'object') return;
    Object.assign(data, patch);
    for (const k of Object.keys(patch)) emit('change:' + k, data[k]);
    emit('change', { patch, state: data });
  }
  return { get, set, on, emit };
}

export const state = createState();
export default state;
