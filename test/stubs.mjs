// Tiny stand-ins for modules owned by other jobs (state, physics, flow, geom, ui, smoke, sfx...).
// ONE file serves them all: the harness import map maps each missing module to this file with its own
// query, e.g.  "/src/physics/atmo.js": "/test/stubs.mjs?m=atmo"  (see IMPORT_MAP below). Every instance exports the
// union of all names; init() dispatches on ?m=. Sphere model, analytic sphere potential flow, fixed aero numbers.
import * as THREE from 'three';

const WHO = new URL(import.meta.url).searchParams.get('m') || '';

export const IMPORT_MAP = {
  '/src/state.js': 'state', '/src/physics/atmo.js': 'atmo', '/src/physics/aero.js': 'aero', '/src/physics/aerodata.js': 'aerodata',
  '/src/flow/flowfield.js': 'flow', '/src/flow/surface.js': 'surface', '/src/geom/assemble.js': 'assemble', '/src/geom/catalog.js': 'catalog',
  '/src/geom/library.js': 'library', '/src/ui/shell.js': 'shell', '/src/ui/picker.js': 'picker', '/src/ui/builder.js': 'builder',
  '/src/ui/controls.js': 'controls', '/src/ui/readouts.js': 'readouts', '/src/ui/charts.js': 'charts', '/src/render/smoke.js': 'smoke',
  '/src/render/particles.js': 'particles', '/src/render/vectors.js': 'vectors', '/src/audio/sfx.js': 'sfx',
};
export function importMap(base = '') {
  const imports = {};
  for (const [k, v] of Object.entries(IMPORT_MAP)) imports[base + k] = base + '/test/stubs.mjs?m=' + v;
  return { imports };
}

/* ------------------------------------------------------------------ state */
const DEF = () => ({
  mode: 'library', modelId: 'sphere', builder: { nose: 'ogive', body: 'round', tail: 'point', wing: 'none', fins: 'cross', p: {} },
  U: 20, alphaDeg: 0, env: { mode: 'altitude', h: 0, T: 288.15, p: 101325 },
  view: { flow: 'smoke', smokeColor: 'white', density: 0.7, lines: 24, rake: 'plane', heatmap: 'off', forces: true, shock: true },
  camera: 'overview', probe: { on: false, x: 0.6, y: 0.15, z: 0 }, pins: [], sound: true, tier: 'low',
});
const _s = DEF(), _l = {};
export const state = {
  get: () => _s,
  set(p) { for (const k in p) { _s[k] = p[k]; this.emit('change:' + k, p[k]); } this.emit('change', p); },
  on(e, f) { (_l[e] || (_l[e] = [])).push(f); return () => { _l[e] = _l[e].filter((x) => x !== f); }; },
  emit(e, d) { const a = _l[e]; if (a) for (let i = 0; i < a.length; i++) a[i](d); },
};

/* ------------------------------------------------------------------- atmo */
export function air(env) {
  const h = env.mode === 'custom' ? 0 : Math.min(env.h || 0, 11000);
  const T = env.mode === 'custom' ? env.T : 288.15 - 0.0065 * h;
  const p = env.mode === 'custom' ? env.p : 101325 * Math.pow(T / 288.15, 5.2559);
  const rho = p / (287.05 * T), mu = 1.458e-6 * Math.pow(T, 1.5) / (T + 110.4);
  return { T, p, rho, mu, nu: mu / rho, a: Math.sqrt(1.4 * 287.05 * T) };
}

/* ------------------------------------------------------------------- aero */
const R_S = 0.15, A_S = Math.PI * R_S * R_S;
const _res = { Re: 0, M: 0, q: 0, p0: 0, T0: 0, CD: 0.47, CL: 0, CDf: 0.02, CDp: 0.45, CDi: 0, CDw: 0, FD: 0, FL: 0, LD: null, St: 0.2, fShed: 0, Dshed: 0.3,
  regime: { flow: 'subsonic', bl: 'laminar', wake: 'street' }, sepDeg: 80, cpb: -0.4, Aref: A_S, ArefKind: 'frontal', Lref: 0.3, power: 0, buoyancy: 0, machAngleDeg: null, surfacesCL: [] };
export function evaluate({ air: a, U, alphaDeg }) {
  _res.q = 0.5 * a.rho * U * U; _res.M = U / a.a; _res.Re = a.rho * U * 0.3 / a.mu;
  _res.CL = 0.08 * alphaDeg; _res.FD = _res.q * _res.CD * A_S; _res.FL = _res.q * _res.CL * A_S;
  return _res;
}
export function fluct() { return { dCD: 0, dCL: 0 }; }
export function curve(def, info, a, alphaDeg, Umax, n) {
  const out = []; for (let i = 0; i <= n; i++) { const U = Umax * i / n, q = 0.5 * a.rho * U * U; out.push({ U, FD: q * 0.47 * A_S, FL: q * 0.08 * alphaDeg * A_S }); } return out;
}

/* --------------------------------------------------------------- aerodata */
export const AERO = new Proxy({}, { get: () => ({ kind: 'sphere', Lref: 'D', Aref: 'frontal' }) });
export function builderAero() { return { kind: 'buildup', Lref: 'L', Aref: 'frontal' }; }

/* ------------------------------------------------------------------- flow */
export function createFlow() {
  let ph = 0, uv = 4; const pr = { speed: 0, cp: 0, p: 0, inWake: false };
  const sdf = (x, y, z) => Math.hypot(x, y, z) - R_S;
  return {
    setModel() { return new Promise((r) => setTimeout(r, 60)); },
    update(res, alpha, Uvis, dt) { uv = Uvis; ph += 2 * Math.PI * 0.2 * dt; },
    sample(x, y, z, out) {           // potential flow past a sphere, visual m/s
      const r2 = x * x + y * y + z * z, r = Math.sqrt(r2);
      if (r < R_S) { out[0] = out[1] = out[2] = 0; return out; }
      const c = R_S * R_S * R_S, r5 = r2 * r2 * r;
      out[0] = uv * (1 + c / (2 * r2 * r) - 1.5 * c * x * x / r5);
      out[1] = -uv * 1.5 * c * x * y / r5; out[2] = -uv * 1.5 * c * x * z / r5;
      return out;
    },
    sdf, phase: () => ph, shock: () => null,
    probe(x, y, z) { const o = [0, 0, 0]; this.sample(x, y, z, o); pr.speed = Math.hypot(o[0], o[1], o[2]); pr.cp = 1 - (pr.speed / (uv || 1)) ** 2; pr.p = 101325; pr.inWake = x > R_S; return pr; },
  };
}

/* ---------------------------------------------------------------- surface */
const _sf = { cp: null, tau: null, frontPa: 0, frontN: 0, cpRange: [0, 1] };
export function surfaceFields(flow, model, res, air, alphaDeg) {
  const nrm = model.geometry.attributes.normal, n = nrm.count;
  if (!_sf.cp || _sf.cp.length !== n) { _sf.cp = new Float32Array(n); _sf.tau = new Float32Array(n); }
  const ca = Math.cos(-alphaDeg * Math.PI / 180), sa = Math.sin(-alphaDeg * Math.PI / 180);
  let mn = 9, mx = -9;
  for (let i = 0; i < n; i++) {
    const nx = nrm.getX(i) * ca - nrm.getY(i) * sa;           // normal in the wind frame
    const s2 = 1 - nx * nx; let cp = nx < 0.35 ? 1 - 2.25 * s2 : -0.4;
    if (nx < 0.35 && nx > 0.2) cp = -0.4 + (cp + 0.4) * (0.35 - nx) / 0.15;
    _sf.cp[i] = cp; _sf.tau[i] = nx < 0.2 ? Math.sqrt(s2) * (1 - 0.5 * Math.abs(nx)) : 0.05;
    if (cp < mn) mn = cp; if (cp > mx) mx = cp;
  }
  _sf.cpRange[0] = mn; _sf.cpRange[1] = mx; _sf.frontPa = mx * res.q; _sf.frontN = _sf.frontPa * A_S;
  return _sf;
}

/* ------------------------------------------------------------ geom: parts */
function toneAttr(g, fn) {
  const p = g.attributes.position, t = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) t[i] = fn(p.getX(i), p.getY(i), p.getZ(i));
  g.setAttribute('tone', new THREE.BufferAttribute(t, 1)); return g;
}
export function make(kind, params = {}) {
  let g, spin, role = 'shape';
  if (kind === 'sphere') g = toneAttr(new THREE.SphereGeometry(R_S, 72, 48), (x, y) => (Math.abs(y) < 0.012 ? 2 : Math.abs(y + 0.04) < 0.012 ? 1 : 0));
  else if (kind === 'teardrop') {
    const pts = []; for (let i = 0; i <= 60; i++) { const t = i / 60, x = -0.52 + 1.05 * t; pts.push(new THREE.Vector2(0.15 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.9) * (1 - 0.25 * t), x)); }
    g = new THREE.LatheGeometry(pts, 64); g.rotateZ(-Math.PI / 2); g = toneAttr(g.toNonIndexed ? g : g, (x) => (x > 0.3 ? 1 : 0)); g.deleteAttribute('uv');
  } else if (kind === 'prop') {
    g = toneAttr(new THREE.BoxGeometry(0.02, 0.5, 0.04), () => 2); g.translate(-0.56, 0, 0); spin = { axis: [1, 0, 0], rate: 20 }; role = 'rotor';
  } else if (kind === 'plate') g = toneAttr(new THREE.BoxGeometry(0.012, 0.4, 0.4), () => 0);
  else g = toneAttr(new THREE.SphereGeometry(R_S, 48, 32), () => 0);
  if (g.index === null) { /* ok: assemble handles it */ }
  return { id: kind + Math.random().toString(36).slice(2, 6), kind, role, geometry: g, sdf: (x, y, z) => Math.hypot(x, y, z) - R_S, flow: true, spin };
}
export function assemble(parts) {
  const gs = parts.map((p) => { const g = p.geometry.index ? p.geometry : p.geometry; return g; });
  let n = 0; for (const g of gs) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), tone = new Float32Array(n), col = new Float32Array(n * 3), idx = [];
  let o = 0; const C = [0xE9E6DF, 0xB9BEC4, 0x2B2F35].map((h) => new THREE.Color(h));
  for (const g of gs) {
    const p = g.attributes.position, nn = g.attributes.normal, t = g.attributes.tone, c = p.count;
    for (let i = 0; i < c; i++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], 3 * (o + i)); nor.set([nn.getX(i), nn.getY(i), nn.getZ(i)], 3 * (o + i));
      tone[o + i] = t.getX(i); const k = C[t.getX(i)]; col.set([k.r, k.g, k.b], 3 * (o + i));
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + o); else for (let i = 0; i < c; i++) idx.push(o + i);
    o += c;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('tone', new THREE.BufferAttribute(tone, 1)); geometry.setAttribute('color', new THREE.BufferAttribute(col, 3)); geometry.setIndex(idx);
  geometry.computeBoundingBox(); const b = geometry.boundingBox;
  const L = b.max.x - b.min.x, D = Math.max(b.max.y - b.min.y, 0.05);
  return { geometry, parts, sdf: (x, y, z) => Math.hypot(x, y, z) - R_S, spanning: false, colloc: { pos: new Float32Array(0), nrm: new Float32Array(0) }, liftingLines: [],
    info: { frontal: A_S, planform: L * D, sideArea: L * D, wetted: 4 * Math.PI * R_S * R_S, volume: 0.0141, L, D, span: D, bbox: { min: b.min.toArray(), max: b.max.toArray() }, body: { L, D }, wings: [] } };
}
export const SLOTS = {}; export const TEMPLATES = {};
export function buildFromBuilder() { return [make('sphere')]; }
export const LIBRARY = [
  { id: 'sphere', group: 'shape', name: 'Hình cầu', note: '', build: () => [make('sphere')] },
  { id: 'teardrop', group: 'shape', name: 'Giọt nước', note: '', build: () => [make('teardrop'), make('prop')] },
  { id: 'plate', group: 'shape', name: 'Tấm phẳng', note: '', build: () => [make('plate')] },
];

/* ------------------------------------------- render / ui / audio stand-ins */
export function init(ctx) {
  if (WHO === 'sfx') return { play() {}, setWind() {} };
  if (WHO === 'smoke') {                 // static smoke lines: lets the lighting check judge smoke contrast
    const T = ctx.scene.three, grp = new T.Group(), mat = new T.MeshStandardMaterial({ color: 0xEDEBE6, emissive: 0xEDEBE6, emissiveIntensity: 0.25, roughness: 0.9, transparent: true, opacity: 0.85 });
    const o = [0, 0, 0]; ctx.flow.update({}, 0, 4, 0);
    for (let k = 0; k < 17; k++) {
      let x = -2.6, y = -0.4 + k * 0.05, z = 0.0; const pts = [];
      for (let i = 0; i < 260 && x < 3; i++) {
        pts.push(new T.Vector3(x, y, z)); ctx.flow.sample(x, y, z, o);
        const sp = Math.hypot(o[0], o[1], o[2]) || 1, st = 0.025; x += o[0] / sp * st; y += o[1] / sp * st; z += o[2] / sp * st;
      }
      grp.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 220, 0.006, 6, false), mat));
    }
    ctx.scene.scene.add(grp); return { update() {} };
  }
  return { update() {} };
}
export default { init };
