// src/geom/parts.js  (P3)  Procedural parts for the wind-tunnel models.
// Model frame: SI metres, nose toward -x, y up, z across. Every part: {id, kind, role, geometry, sdf(x,y,z), flow, ...}.
//
// make(kind, params). Common params: id, role, flow, tone (0|1|2), toneFn(x,y,z,nx,ny,nz)->0|1|2,
//   ref  = reference model length in m used for tessellation (target quad side = 0.0105*ref so the longest triangle edge
//          stays <= 1.5 % of ref). Pass the whole-model length when parts belong to a bigger model.
//          Default: shapes -> own length; lofts -> max(own length, 0.8); wheels/fins/rotors/wings -> 1.0; spanning -> chord.
//   edge = explicit quad side in m (overrides ref).
// Kinds: loft nose body tail canopy nacelle wing fin rotor roundedBox box sphere cylinder plate rhombus teardrop
//        + hull panel strut tube revolve wheel (src/geom/hull.js)
// Profiles (arrays of [t,value], numbers or functions of t in 0..1) use a smooth monotone cubic interpolation.
// Documented deviations: spanning parts (z -1.2..1.2) use only ~12 segments along z because they are constant along z;
// their wall-side caps are coarse fans (hidden behind the glass). wing.sweepDeg is the QUARTER-CHORD sweep (deg).
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three';
import { createHullMakers, stationList, ringFromControl } from './hull.js';
export { stationList, ringFromControl };

const PI = Math.PI, TAU = PI * 2, EK = 0.0105;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
let UID = 0;
export const TONE = { MAIN: 0, ACCENT: 1, DARK: 2 };

/* ---------------------------------------------------------------- mesh builder */
class MB {
  constructor() { this.P = []; this.N = []; this.T = []; this.I = []; this.tone = 0; }
  v(x, y, z, nx, ny, nz) { const i = this.P.length / 3; this.P.push(x, y, z); this.N.push(nx, ny, nz); this.T.push(this.tone); return i; }
  tri(a, b, c) { if (a === b || b === c || a === c) return; this.I.push(a, b, c); }
  mark() { return this.I.length; }
  // make triangle winding agree with the (outward) vertex normals for every triangle added since mark i0
  fix(i0) {
    const P = this.P, N = this.N, I = this.I; let s = 0;
    for (let k = i0; k < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
      s += gx * (N[a] + N[b] + N[c]) + gy * (N[a + 1] + N[b + 1] + N[c + 1]) + gz * (N[a + 2] + N[b + 2] + N[c + 2]);
    }
    if (s < 0) for (let k = i0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; }
  }
}

// stitch two closed rings of different vertex counts (index arrays, angle fraction j/k)
function zip(mb, A, B) {
  const ka = A.length, kb = B.length; let i = 0, j = 0;
  while (i < ka || j < kb) {
    if (i < ka && (j >= kb || (i + 1) / ka <= (j + 1) / kb)) { mb.tri(A[i % ka], B[j % kb], A[(i + 1) % ka]); i++; }
    else { mb.tri(A[i % ka], B[j % kb], B[(j + 1) % kb]); j++; }
  }
}
// concentric-ring disc from a closed boundary ring (positions Q[k][3]) towards centre C, flat normal n
function discRings(mb, Q, C, nx, ny, nz, m, adaptiveEdge) {
  const k0 = Q.length; let prev = null; const i0 = mb.mark();
  for (let j = 0; j < m; j++) {
    const kap = 1 - j / m; let ring = [];
    let kj = k0;
    if (adaptiveEdge) kj = Math.max(8, Math.min(k0, 8 * Math.ceil((k0 * kap) / 8)));
    for (let q = 0; q < kj; q++) {
      const f = (q / kj) * k0; const q0 = Math.floor(f) % k0, q1 = (q0 + 1) % k0, w = f - Math.floor(f);
      const px = Q[q0][0] * (1 - w) + Q[q1][0] * w, py = Q[q0][1] * (1 - w) + Q[q1][1] * w, pz = Q[q0][2] * (1 - w) + Q[q1][2] * w;
      ring.push(mb.v(C[0] + kap * (px - C[0]), C[1] + kap * (py - C[1]), C[2] + kap * (pz - C[2]), nx, ny, nz));
    }
    if (prev) zip(mb, prev, ring);
    prev = ring;
  }
  const c = mb.v(C[0], C[1], C[2], nx, ny, nz); zip(mb, prev, [c]);
  mb.fix(i0);
}

/* ---------------------------------------------------------------- profile helpers */
function pchip(pts) {
  const n = pts.length, x = pts.map(p => p[0]), y = pts.map(p => p[1]), h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = x[i + 1] - x[i]; d[i] = (y[i + 1] - y[i]) / h[i]; }
  if (n === 2) m[0] = m[1] = d[0];
  else {
    for (let i = 1; i < n - 1; i++) if (d[i - 1] * d[i] > 0) { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
    const end = (h0, h1, d0, d1) => { let v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1); if (Math.sign(v) !== Math.sign(d0)) v = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(v) > 3 * Math.abs(d0)) v = 3 * d0; return v; };
    m[0] = end(h[0], h[1], d[0], d[1]); m[n - 1] = end(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  }
  return t => {
    if (t <= x[0]) return y[0]; if (t >= x[n - 1]) return y[n - 1];
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] <= t) lo = mid; else hi = mid; }
    const s = (t - x[lo]) / h[lo], s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y[lo] + (s3 - 2 * s2 + s) * h[lo] * m[lo] + (-2 * s3 + 3 * s2) * y[lo + 1] + (s3 - s2) * h[lo] * m[lo + 1];
  };
}
const asFn = v => (typeof v === 'function' ? v : Array.isArray(v) ? pchip(v) : (() => v));

export const profiles = {
  // t = 0 at tip .. 1 at junction; returns radius fraction 0..1
  nose(shape, length, R) {
    const L = length;
    if (shape === 'cone') return t => t;
    if (shape === 'round') return t => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
    if (shape === 'flat') return t => 0.92 + 0.08 * t;
    const rho = (R * R + L * L) / (2 * R); // tangent ogive
    return t => { const x = t * L; return Math.max(0, (Math.sqrt(Math.max(0, rho * rho - (L - x) * (L - x))) + R - rho) / R); };
  },
  // t = 0 at junction .. 1 at end
  tail(shape, length, R, boattailDeg = 8) {
    if (shape === 'round') return t => Math.sqrt(Math.max(0, 1 - t * t));
    if (shape === 'blunt') { const e = clamp(1 - length * Math.tan(boattailDeg * PI / 180) / R, 0.25, 1); return t => 1 - (1 - e) * t; }
    return t => 1 - t;
  },
};

const warpCache = new Map();
function warpTheta(n, u, ratio = 1) {
  if (n === 2 && Math.abs(ratio - 1) < 0.02) return u * TAU;
  const rq = Math.round(clamp(ratio, 0.05, 20) * 50) / 50, key = Math.round(n * 1000) * 100000 + Math.round(rq * 100); let w = warpCache.get(key);
  if (!w) {
    const M = 16384, cum = new Float64Array(M + 1), p = 2 / n; let px = rq, py = 0; // section (ratio*cos^p, sin^p): ratio = width/height
    for (let m = 1; m <= M; m++) { const th = (m / M) * TAU, x = rq * spow(Math.cos(th), p), y = spow(Math.sin(th), p); cum[m] = cum[m - 1] + Math.hypot(x - px, y - py); px = x; py = y; }
    w = { cum, tot: cum[M], M }; warpCache.set(key, w);
  }
  u -= Math.floor(u); const target = u * w.tot; let lo = 0, hi = w.M;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (w.cum[mid] <= target) lo = mid; else hi = mid; }
  return ((lo + (target - w.cum[lo]) / Math.max(1e-12, w.cum[lo + 1] - w.cum[lo])) / w.M) * TAU;
}

/* ---------------------------------------------------------------- loft */
function loftMesh(mb, o) {
  const { x0, L, wf, hf, cf, nf, zc, creases, edge } = o;
  const S = (t, u, out) => {
    const w = wf(t), h = hf(t), n = nf(t), th = warpTheta(n, u, w / Math.max(h, 1e-9)), cs = Math.cos(th), sn = Math.sin(th), p = 2 / n;
    out[0] = x0 + L * t; out[1] = cf(t) + h * (p === 1 ? sn : spow(sn, p)); out[2] = zc + w * (p === 1 ? cs : spow(cs, p));
  };
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], D = [0, 0, 0];
  const per = t => { let s = 0; S(t, 0, A); let py = A[1], pz = A[2]; for (let m = 1; m <= 96; m++) { S(t, m / 96, A); s += Math.hypot(A[1] - py, A[2] - pz); py = A[1]; pz = A[2]; } return s; };
  // silhouette arc table
  const M = 1500, cum = new Float64Array(M + 1); let pr = 0, maxPer = 0;
  for (let m = 0; m <= M; m++) { const t = m / M, w = wf(t), h = hf(t), r = Math.sqrt((w * w + h * h) / 2); if (m) cum[m] = cum[m - 1] + Math.hypot(L / M, r - pr); pr = r; }
  for (let m = 0; m <= 48; m++) maxPer = Math.max(maxPer, per(m / 48));
  const invCum = a => { let lo = 0, hi = M; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= a) lo = mid; else hi = mid; } return (lo + (a - cum[lo]) / Math.max(1e-12, cum[lo + 1] - cum[lo])) / M; };
  const cumAt = t => { const f = t * M, i = Math.min(M - 1, Math.floor(f)); return cum[i] + (cum[i + 1] - cum[i]) * (f - i); };
  const Atot = cum[M] || 1e-9;
  const Kmax = Math.max(48, 8 * Math.ceil(maxPer / edge / 8));
  const cuts = [0, ...creases.filter(c => c > 1e-6 && c < 1 - 1e-6).sort((a, b) => a - b), 1];
  const normal = (ta, tb, t, u, out) => {
    const tn = clamp(t, ta + 2e-5, tb - 2e-5), h = 1e-5;
    S(tn + h, u, A); S(tn - h, u, B); S(tn, u + h, C); S(tn, u - h, D);
    const tx = A[0] - B[0], ty = A[1] - B[1], tz = A[2] - B[2], ux = C[0] - D[0], uy = C[1] - D[1], uz = C[2] - D[2];
    let nx = ty * uz - tz * uy, ny = tz * ux - tx * uz, nz = tx * uy - ty * ux; const l = Math.hypot(nx, ny, nz);
    if (l < 1e-18) { out[0] = 1; out[1] = 0; out[2] = 0; } else { out[0] = nx / l; out[1] = ny / l; out[2] = nz / l; }
  };
  const nrm = [0, 0, 0], pos = [0, 0, 0];
  const capRing = (t, ring0, flip) => {
    // flat cap at station t: boundary ring = copies of ring positions
    const q = ring0, ctr = [x0 + L * t, cf(t), zc];
    const pts = q.map(i => [mb.P[i * 3], mb.P[i * 3 + 1], mb.P[i * 3 + 2]]);
    let ext = 0; for (const q of pts) ext = Math.max(ext, Math.hypot(q[1] - ctr[1], q[2] - ctr[2])); const m = Math.max(2, Math.ceil(ext / (0.7 * edge)));
    discRings(mb, pts, ctr, flip ? -1 : 1, 0, 0, m, true);
  };
  for (let ci = 0; ci < cuts.length - 1; ci++) {
    const ta = cuts[ci], tb = cuts[ci + 1], A0 = cumAt(tb) - cumAt(ta), i0 = mb.mark();
    const nu = Math.max(Math.ceil(64 * A0 / Atot), 8, Math.ceil(1.25 * A0 / edge));
    const rings = [];
    for (let i = 0; i <= nu; i++) {
      const v = i / nu, g = 0.65 * v + 0.35 * 0.5 * (1 - Math.cos(PI * v)), t = i === 0 ? ta : i === nu ? tb : invCum(cumAt(ta) + g * A0);
      const p = per(t); let ring = [];
      if (p < 1e-6) { S(t, 0, pos); ring.push(mb.v(pos[0], pos[1], pos[2], t < 0.5 ? -1 : 1, 0, 0)); }
      else {
        const k = Math.max(8, 8 * Math.ceil((p / maxPer) * Kmax / 8));
        for (let j = 0; j < k; j++) { const u = j / k; S(t, u, pos); normal(ta, tb, t, u, nrm); ring.push(mb.v(pos[0], pos[1], pos[2], nrm[0], nrm[1], nrm[2])); }
      }
      rings.push({ t, ring, p });
    }
    for (let i = 0; i < nu; i++) zip(mb, rings[i].ring, rings[i + 1].ring);
    mb.fix(i0);
    if (ci === 0 && o.capS && rings[0].p > 1e-6) { // start cap needs its own vertices (crisp normal)
      const r0 = rings[0]; const ring = r0.ring.map(i => mb.v(mb.P[i * 3], mb.P[i * 3 + 1], mb.P[i * 3 + 2], -1, 0, 0)); capRing(0, ring, true);
    }
    if (ci === cuts.length - 2 && o.capE && rings[nu].p > 1e-6) {
      const r1 = rings[nu]; const ring = r1.ring.map(i => mb.v(mb.P[i * 3], mb.P[i * 3 + 1], mb.P[i * 3 + 2], 1, 0, 0)); capRing(1, ring, false);
    }
  }
  // sampled silhouette for the SDF
  const X = [], R = [];
  const ts = new Set([0, 1, ...cuts]); const NS = 360;
  for (let i = 0; i <= NS; i++) { const a = (i / NS) * Atot; ts.add(invCum(a)); }
  const arr = [...ts].sort((a, b) => a - b);
  for (const t of arr) { X.push(x0 + L * t); R.push(wf(t)); }
  return { X, R };
}

/* ---- loft SDFs */
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py; return qx * qx + qy * qy;
}
function axiSDF(X, R, yc, zc) {
  const n = X.length;
  const lower = v => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (X[m] < v) lo = m + 1; else hi = m; } return lo; };
  const rAt = x => { let i = Math.max(1, Math.min(n - 1, lower(x))); const d = X[i] - X[i - 1]; return d > 0 ? R[i - 1] + (R[i] - R[i - 1]) * (x - X[i - 1]) / d : R[i]; };
  return (x, y, z) => {
    const rho = Math.hypot(y - yc, z - zc), xc = clamp(x, X[0], X[n - 1]), rc = rAt(xc), g = Math.hypot(x - xc, rho - rc);
    let lo = Math.max(0, lower(x - g) - 1), hi = Math.min(n - 1, lower(x + g) + 1), d2 = Infinity;
    for (let i = lo; i < hi; i++) d2 = Math.min(d2, segDist2(x, rho, X[i], R[i], X[i + 1], R[i + 1]));
    d2 = Math.min(d2, segDist2(x, rho, X[0], 0, X[0], R[0]), segDist2(x, rho, X[n - 1], R[n - 1], X[n - 1], 0));
    const d = Math.sqrt(d2); return x >= X[0] && x <= X[n - 1] && rho < rc ? -d : d;
  };
}
function sectionSDF(o) {
  const { x0, L, wf, hf, cf, nf, zc } = o;
  const gAt = (t, y, z) => { const w = Math.max(wf(t), 1e-6), h = Math.max(hf(t), 1e-6), n = nf(t); const a = Math.abs(z - zc) / w, b = Math.abs(y - cf(t)) / h; return Math.pow(Math.pow(a, n) + Math.pow(b, n), 1 / n); };
  const sec = (x, y, z) => {
    const t = clamp((x - x0) / L, 0, 1), w = Math.max(wf(t), 1e-6), h = Math.max(hf(t), 1e-6), n = nf(t), dz = z - zc, dy = y - cf(t);
    const a = Math.abs(dz) / w, b = Math.abs(dy) / h, g = Math.pow(Math.pow(a, n) + Math.pow(b, n), 1 / n);
    if (g < 1e-9) return -Math.min(w, h);
    const gz = Math.pow(g, 1 - n) * Math.pow(a, n - 1) / w, gy = Math.pow(g, 1 - n) * Math.pow(b, n - 1) / h, e = 1e-4;
    const gx = (gAt(clamp(t + e, 0, 1), y, z) - gAt(clamp(t - e, 0, 1), y, z)) / (2 * e * L);
    return (g - 1) / Math.max(1e-9, Math.hypot(gz, gy, gx));
  };
  return (x, y, z) => {
    const dc = sec(x, y, z), dx = x < x0 ? x0 - x : x > x0 + L ? x - x0 - L : 0;
    if (dx > 0) return dc < 0 ? dx : Math.hypot(dx, dc); return Math.max(dc, x0 - x, x - x0 - L);
  };
}

function normLoft(p, dflt) {
  const L = p.length, x0 = p.x0 ?? 0, yO = asFn(p.yOffset ?? 0);
  let wf, hf, axisym = false;
  if (p.radius !== undefined) { const r = asFn(p.radius); wf = hf = r; axisym = p.n === undefined || p.n === 2; }
  else { const w = asFn(p.width), h = asFn(p.height); wf = t => w(t) / 2; hf = t => h(t) / 2; }
  const nfn = asFn(p.n ?? 2);
  const ref = p.ref ?? Math.max(L, dflt ?? 0.8);
  return { x0, L, wf, hf, cf: yO, nf: nfn, zc: p.zOffset ?? 0, creases: p.creases ?? [], edge: p.edge ?? EK * ref, capS: p.capStart !== false, capE: p.capEnd !== false, axisym, yconst: typeof p.yOffset === 'number' || p.yOffset === undefined };
}

function buildLoft(p, role, dflt) {
  const o = normLoft(p, dflt), mb = new MB(); mb.tone = typeof p.tone === 'number' ? p.tone : 0;
  const { X, R } = loftMesh(mb, o);
  let sdf;
  if (p.sdf) sdf = p.sdf;
  else if (o.axisym && o.yconst) sdf = axiSDF(X, R, o.cf(0), o.zc);
  else sdf = sectionSDF(o);
  return finish('loft', role, mb, sdf, p);
}

/* ---------------------------------------------------------------- box / rounded box */
function lines1D(h, r, edge) {
  if (r < 1e-9) { const n = Math.max(1, Math.ceil(2 * h / edge)); return Array.from({ length: n + 1 }, (_, i) => -h + (2 * h * i) / n); }
  const inner = Math.max(0, h - r), nc = Math.max(2, Math.ceil((r * PI / 4) / edge)), out = [];
  for (let i = 0; i <= nc; i++) out.push(-(inner + r * Math.tan((PI / 4) * (1 - i / nc))));
  const nm = Math.max(1, Math.ceil(2 * inner / edge));
  for (let i = 1; i < nm; i++) out.push(-inner + (2 * inner * i) / nm);
  for (let i = 0; i <= nc; i++) out.push(inner + r * Math.tan((PI / 4) * (i / nc)));
  return out;
}
function boxMesh(mb, hx, hy, hz, r, edge, c) {
  const H = [hx, hy, hz], Ls = [lines1D(hx, r, edge), lines1D(hy, r, edge), lines1D(hz, r, edge)];
  for (let ax = 0; ax < 3; ax++) for (const sg of [-1, 1]) {
    const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3, i0 = mb.mark(), g = []; const L1 = Ls[a1], L2 = Ls[a2];
    for (let i = 0; i < L1.length; i++) { g[i] = []; for (let j = 0; j < L2.length; j++) {
      const q = [0, 0, 0]; q[ax] = sg * H[ax]; q[a1] = L1[i]; q[a2] = L2[j];
      let p, n;
      if (r < 1e-9) { p = q; n = [0, 0, 0]; n[ax] = sg; }
      else { const inn = q.map((v, k) => clamp(v, -(H[k] - r), H[k] - r)), d = [q[0] - inn[0], q[1] - inn[1], q[2] - inn[2]], l = Math.hypot(d[0], d[1], d[2]); n = [d[0] / l, d[1] / l, d[2] / l]; p = [inn[0] + n[0] * r, inn[1] + n[1] * r, inn[2] + n[2] * r]; }
      g[i][j] = mb.v(p[0] + c[0], p[1] + c[1], p[2] + c[2], n[0], n[1], n[2]);
    } }
    for (let i = 0; i < L1.length - 1; i++) for (let j = 0; j < L2.length - 1; j++) { mb.tri(g[i][j], g[i + 1][j], g[i][j + 1]); mb.tri(g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]); }
    mb.fix(i0);
  }
}
const boxSDF = (c, h, r) => (x, y, z) => {
  const qx = Math.abs(x - c[0]) - (h[0] - r), qy = Math.abs(y - c[1]) - (h[1] - r), qz = Math.abs(z - c[2]) - (h[2] - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};

/* ---------------------------------------------------------------- cylinder along z (spanning) */
function cylZMesh(mb, R, z0, z1, edge, cx = 0, cy = 0) {
  const k = Math.max(48, 8 * Math.ceil(2 * PI * R / edge / 8)), nz = clamp(Math.ceil((z1 - z0) / 0.2), 2, 16), i0 = mb.mark(), rows = [];
  for (let i = 0; i <= nz; i++) { const z = z0 + ((z1 - z0) * i) / nz, row = []; for (let j = 0; j < k; j++) { const th = (j / k) * TAU, c = Math.cos(th), s = Math.sin(th); row.push(mb.v(cx + R * c, cy + R * s, z, c, s, 0)); } rows.push(row); }
  for (let i = 0; i < nz; i++) zip(mb, rows[i], rows[i + 1]); mb.fix(i0);
  for (const [z, nzv] of [[z0, -1], [z1, 1]]) {
    const pts = []; for (let j = 0; j < k; j++) { const th = (j / k) * TAU; pts.push([cx + R * Math.cos(th), cy + R * Math.sin(th), z]); }
    const ring = pts.map(q => mb.v(q[0], q[1], q[2], 0, 0, nzv)); const c = mb.v(cx, cy, z, 0, 0, nzv), j0 = mb.mark(); zip(mb, ring, [c]); mb.fix(j0);
  }
}

/* ---------------------------------------------------------------- lathe about an arbitrary axis */
function latheMesh(mb, { origin, axis, chains, edge }) {
  const al = Math.hypot(...axis), a = axis.map(v => v / al);
  let u = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [a[2], 0, -a[0]]; const ul = Math.hypot(...u); u = u.map(v => v / ul);
  const v = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
  for (const ch of chains) {
    let pts = [ch.pts[0]]; // subdivide long straight pieces
    for (let i = 1; i < ch.pts.length; i++) { const p0 = ch.pts[i - 1], p1 = ch.pts[i], n = Math.max(1, Math.ceil(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / edge)); for (let s = 1; s <= n; s++) pts.push([p0[0] + (p1[0] - p0[0]) * s / n, p0[1] + (p1[1] - p0[1]) * s / n]); }
    const N2 = pts.map((p, i) => { const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(pts.length - 1, i + 1)], tx = q1[0] - q0[0], ty = q1[1] - q0[1], l = Math.hypot(tx, ty) || 1; return [ty / l, -tx / l]; });
    const sgn = ch.sgn; // +1: right-hand normal (ty,-tx) is outward; -1: left-hand normal
    mb.tone = ch.tone ?? 0; const i0 = mb.mark(), rings = [];
    pts.forEach((p, i) => {
      const rho = p[0], k = rho < 1e-9 ? 1 : Math.max(16, 8 * Math.ceil(TAU * rho / edge / 8)), ring = [];
      for (let j = 0; j < k; j++) {
        const th = (j / k) * TAU, c = Math.cos(th), s = Math.sin(th), rx = c * u[0] + s * v[0], ry = c * u[1] + s * v[1], rz = c * u[2] + s * v[2], nr = sgn * N2[i][0], na = sgn * N2[i][1];
        ring.push(mb.v(origin[0] + a[0] * p[1] + rho * rx, origin[1] + a[1] * p[1] + rho * ry, origin[2] + a[2] * p[1] + rho * rz, nr * rx + na * a[0], nr * ry + na * a[1], nr * rz + na * a[2]));
      }
      rings.push(ring);
    });
    for (let i = 0; i < rings.length - 1; i++) zip(mb, rings[i], rings[i + 1]); mb.fix(i0);
  }
}

/* ---------------------------------------------------------------- wing / fin / blade */
const nacaT = (x, tc) => 5 * tc * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
const nacaC = (x, m, p) => (m === 0 ? 0 : x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) * (1 - p))) * ((1 - 2 * p) + 2 * p * x - x * x));

function profileSegs(profile, tc, cmax, edge) {
  const cnt = (len, cosine) => Math.max(2, Math.ceil((cosine ? 1.6 : 1.1) * len * cmax / edge));
  if (profile === 'plate') {
    const t = tc / 2, ne = Math.max(1, Math.ceil(2 * t * cmax / edge));
    return [{ f: u => [0.5 * (1 + Math.cos(PI * u)), t], n: cnt(1, true) }, { f: u => [0, t - 2 * t * u], n: ne },
      { f: u => [0.5 * (1 - Math.cos(PI * u)), -t], n: cnt(1, true) }, { f: u => [1, -t + 2 * t * u], n: ne }];
  }
  if (profile === 'wedge') {
    const h = tc / 2;
    return [{ f: u => [1 - 0.5 * u, h * u], n: cnt(0.5) }, { f: u => [0.5 - 0.5 * u, h * (1 - u)], n: cnt(0.5) },
      { f: u => [0.5 * u, -h * u], n: cnt(0.5) }, { f: u => [0.5 + 0.5 * u, -h * (1 - u)], n: cnt(0.5) }];
  }
  const camb = profile === '2412' ? [0.02, 0.4] : [0, 0.4];
  return [{ isCurve: true, f: u => { const phi = u * TAU, x = 0.5 * (1 + Math.cos(phi)), yt = nacaT(x, tc), yc = nacaC(x, camb[0], camb[1]); return [x, phi < PI ? yc + yt : yc - yt]; }, n: Math.max(48, cnt(2.05, true)) }];
}

function wingGeom(mb, o) {
  const { semi, cr, ct, dx, dy, mirror, ex, et, es, ori, inc, edge, spanning } = o;
  const segs = profileSegs(o.profile, o.tc, Math.max(cr, ct), edge), ci = Math.cos(inc), si = Math.sin(inc), cmin = 2e-3, hs = 1e-5;
  const P = (s, seg, u, out) => {
    const sig = Math.min(1, Math.abs(s) / semi), c = Math.max(cmin, cr + (ct - cr) * sig); let [xp, yp] = seg.f(u);
    if (inc) { const a = xp - 0.25; xp = 0.25 + a * ci + yp * si; yp = -a * si + yp * ci; }
    const X = sig * dx + xp * c, Y = sig * dy + yp * c;
    out[0] = ori[0] + ex[0] * X + et[0] * Y + es[0] * s; out[1] = ori[1] + ex[1] * X + et[1] * Y + es[1] * s; out[2] = ori[2] + ex[2] * X + et[2] * Y + es[2] * s;
  };
  const ns = spanning ? 12 : Math.max(6, Math.ceil(semi * Math.sqrt(1 + (dx / semi) ** 2 + (dy / semi) ** 2) / (0.9 * edge)));
  const sv = []; if (mirror) { for (let i = 0; i <= 2 * ns; i++) sv.push(-semi + (semi * i) / ns); } else for (let i = 0; i <= ns; i++) sv.push((semi * i) / ns);
  const smin = sv[0], smax = sv[sv.length - 1], A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0], D = [0, 0, 0], p = [0, 0, 0], q = [0, 0, 0];
  const ends = [[], []]; // boundary vertex positions at smin / smax in loop order
  for (const seg of segs) {
    const n = seg.n, grid = [], i0 = mb.mark(); let sgn = 0;
    for (let i = 0; i < sv.length; i++) { grid[i] = []; for (let j = 0; j <= n; j++) {
      const s = sv[i], u = j / n; P(s, seg, u, p);
      const sc = clamp(s, smin + hs, smax - hs), uc = clamp(u, hs, 1 - hs);
      P(sc + hs, seg, uc, A); P(sc - hs, seg, uc, B); P(sc, seg, uc + hs, C); P(sc, seg, uc - hs, D);
      const tx = A[0] - B[0], ty = A[1] - B[1], tz = A[2] - B[2], ux = C[0] - D[0], uy = C[1] - D[1], uz = C[2] - D[2];
      let nx = ty * uz - tz * uy, ny = tz * ux - tx * uz, nz = tx * uy - ty * ux; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      if (sgn === 0 && i === sv.length >> 1 && j === n >> 1) { P(s, { f: () => [0.4, 0] }, 0, q); sgn = nx * (p[0] - q[0]) + ny * (p[1] - q[1]) + nz * (p[2] - q[2]) >= 0 ? 1 : -1; if (sgn === 0) sgn = 1; }
      grid[i][j] = [p[0], p[1], p[2], nx, ny, nz];
    } }
    if (sgn === 0) sgn = 1;
    const ids = grid.map(row => row.map(g => mb.v(g[0], g[1], g[2], sgn * g[3], sgn * g[4], sgn * g[5])));
    const dd = (g1, g2) => Math.hypot(g1[0] - g2[0], g1[1] - g2[1], g1[2] - g2[2]);
    for (let i = 0; i < sv.length - 1; i++) for (let j = 0; j < n; j++) {
      if (dd(grid[i][j], grid[i + 1][j + 1]) < dd(grid[i + 1][j], grid[i][j + 1])) { mb.tri(ids[i][j], ids[i + 1][j], ids[i + 1][j + 1]); mb.tri(ids[i][j], ids[i + 1][j + 1], ids[i][j + 1]); }
      else { mb.tri(ids[i][j], ids[i + 1][j], ids[i][j + 1]); mb.tri(ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1]); }
    }
    mb.fix(i0);
    for (let j = 0; j < n; j++) { ends[0].push(grid[0][j].slice(0, 3)); ends[1].push(grid[sv.length - 1][j].slice(0, 3)); }
  }
  // caps (tip, and root for a single panel)
  const capAt = (ring, s, sign) => {
    const sig = Math.min(1, Math.abs(s) / semi), c = Math.max(cmin, cr + (ct - cr) * sig); if (c < 0.004) return;
    const ctr = [0, 0, 0]; P(s, { f: () => [0.4, 0] }, 0, ctr);
    const nx = es[0] * sign, ny = es[1] * sign, nz = es[2] * sign;
    let ext = 0; for (const r of ring) ext = Math.max(ext, Math.hypot(r[0] - ctr[0], r[1] - ctr[1], r[2] - ctr[2]));
    const m = spanning ? 1 : Math.max(1, Math.ceil(ext / (0.7 * edge)));
    const pts = ring.map(r => r.slice()); const vv = pts.map(r => mb.v(r[0], r[1], r[2], nx, ny, nz)); // boundary ring (new verts)
    const i0 = mb.mark(); let prev = vv;
    for (let j = 1; j < m; j++) { const kap = 1 - j / m; const rr = pts.map(r => mb.v(ctr[0] + kap * (r[0] - ctr[0]), ctr[1] + kap * (r[1] - ctr[1]), ctr[2] + kap * (r[2] - ctr[2]), nx, ny, nz)); zip(mb, prev, rr); prev = rr; }
    zip(mb, prev, [mb.v(ctr[0], ctr[1], ctr[2], nx, ny, nz)]); mb.fix(i0);
  };
  capAt(ends[1], smax, 1); capAt(ends[0], smin, -1);
  return o;
}

// wing SDF: distance to the local thickness envelope
function wingSDF(o) {
  const { semi, cr, ct, dx, dy, mirror, ex, et, es, ori, inc } = o, segs = profileSegs(o.profile, o.tc, 1, 1e9);
  const ci = Math.cos(inc), si = Math.sin(inc), poly = [];
  for (const seg of segs) { const m = seg.isCurve ? 160 : 12; for (let i = 0; i < m; i++) { let [x, y] = seg.f(i / m); if (inc) { const a = x - 0.25, xx = 0.25 + a * ci + y * si; y = -a * si + y * ci; x = xx; } poly.push(x, y); } }
  const np = poly.length / 2; let ymax = 0, xmin = 9, xmax = -9; for (let i = 0; i < np; i++) { ymax = Math.max(ymax, Math.abs(poly[2 * i + 1])); xmin = Math.min(xmin, poly[2 * i]); xmax = Math.max(xmax, poly[2 * i]); }
  const tanL = dx / semi, tanG = dy / semi, tapS = (ct - cr) / semi; let qnx = 0, qny = 0;
  const polyD = (x, y) => {
    let d2 = Infinity, bx = 0, by = 0, inside = false;
    for (let i = 0; i < np; i++) {
      const j = (i + 1) % np, ax = poly[2 * i], ay = poly[2 * i + 1], bx2 = poly[2 * j], by2 = poly[2 * j + 1];
      if ((ay > y) !== (by2 > y) && x < ((bx2 - ax) * (y - ay)) / (by2 - ay) + ax) inside = !inside;
      const ex2 = bx2 - ax, ey2 = by2 - ay, l2 = ex2 * ex2 + ey2 * ey2; let t = l2 > 0 ? ((x - ax) * ex2 + (y - ay) * ey2) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * ex2 - x, qy = ay + t * ey2 - y, dd = qx * qx + qy * qy; if (dd < d2) { d2 = dd; bx = qx; by = qy; }
    }
    const d = Math.sqrt(d2) || 1e-12; qnx = (inside ? bx : -bx) / d; qny = (inside ? by : -by) / d; return inside ? -d : d;
  };
  return (X0, Y0, Z0) => {
    const rx = X0 - ori[0], ry = Y0 - ori[1], rz = Z0 - ori[2], X = rx * ex[0] + ry * ex[1] + rz * ex[2], Y = rx * et[0] + ry * et[1] + rz * et[2], Z = rx * es[0] + ry * es[1] + rz * es[2];
    const s = mirror ? Math.abs(Z) : Z, sig = clamp(Math.abs(s) / semi, 0, 1), c = Math.max(2e-3, cr + (ct - cr) * sig);
    const xl = (X - sig * dx) / c, yl = (Y - sig * dy) / c, ds = mirror ? Math.abs(Z) - semi : Math.max(Z - semi, -Z);
    const bdx = Math.max(xmin - xl, xl - xmax, 0), bdy = Math.max(Math.abs(yl) - ymax, 0), bd = Math.hypot(bdx, bdy);
    let d2;
    if (bd > 0.4) d2 = bd * c;
    else { d2 = polyD(xl, yl); const f = 1 / Math.sqrt(1 + (qnx * (tanL + clamp(xl, 0, 1) * tapS) + qny * tanG) ** 2); d2 *= c * f; }
    if (d2 > 0 || ds > 0) return Math.hypot(Math.max(d2, 0), Math.max(ds, 0)); return Math.max(d2, ds);
  };
}

function wingFrom(p, isFin) {
  const profile = p.profile ?? '0012', tc = p.tc ?? (profile === 'plate' ? 0.02 : profile === 'wedge' ? 0.05 : isFin ? 0.06 : 0.12);
  let span = p.span ?? 1, cr = p.rootChord ?? 0.2, ct = p.tipChord ?? cr, sweep = (p.sweepDeg ?? 0) * PI / 180, dih = (p.dihedralDeg ?? 0) * PI / 180;
  const spanning = !!p.spanning, mirror = isFin ? !!p.mirror : p.mirror !== false;
  if (spanning) { span = 2.4; ct = cr; sweep = 0; dih = 0; }
  const semi = mirror ? span / 2 : span; ct = Math.max(ct, 0.01 * cr);
  let ori = (p.rootLE ?? [0, 0, 0]).slice(), ex = [1, 0, 0], et = [0, 1, 0], es = [0, 0, 1];
  if (isFin) { const A = (p.angleDeg ?? 0) * PI / 180; es = [0, Math.cos(A), Math.sin(A)]; et = [0, -Math.sin(A), Math.cos(A)]; const r0 = p.r0 ?? 0; ori = [ori[0], r0 * es[1] + ori[1], r0 * es[2] + ori[2]]; }
  if (p.basis) { ex = p.basis.ex; et = p.basis.et; es = p.basis.es; }
  const dx = semi * Math.tan(sweep), dy = semi * Math.tan(dih), ref = p.ref ?? (spanning ? cr : 1.0), edge = p.edge ?? EK * ref;
  const o = { profile, tc, semi, cr, ct, dx, dy, mirror, ex, et, es, ori, inc: (p.incDeg ?? 0) * PI / 180, edge, spanning };
  return o;
}

function mkWing(p, isFin) {
  const o = wingFrom(p, isFin), mb = new MB(); mb.tone = typeof p.tone === 'number' ? p.tone : 0;
  wingGeom(mb, o); const sdf = wingSDF(o);
  const sweepQ = Math.atan2(o.dx + 0.25 * (o.ct - o.cr), o.semi) * 180 / PI;
  const tip = [o.ori[0] + o.ex[0] * o.dx + o.et[0] * o.dy + o.es[0] * o.semi, o.ori[1] + o.ex[1] * o.dx + o.et[1] * o.dy + o.es[1] * o.semi, o.ori[2] + o.ex[2] * o.dx + o.et[2] * o.dy + o.es[2] * o.semi];
  const span = o.mirror ? 2 * o.semi : o.semi;
  const wing = { rootLE: o.ori.slice(), tipLE: tip, rootChord: o.cr, tipChord: o.ct, tc: o.tc, sweepDeg: sweepQ, spanning: o.spanning, mirror: o.mirror, span, semiSpan: o.semi, dihedralDeg: Math.atan2(o.dy, o.semi) * 180 / PI, profile: o.profile, S: span * (o.cr + o.ct) / 2 };
  return finish(isFin ? 'fin' : 'wing', isFin ? 'fin' : 'wing', mb, sdf, p, { wing, spanning: o.spanning });
}

/* ---------------------------------------------------------------- finish */
function finish(kind, role, mb, sdf, p, extra = {}) {
  const P = mb.P, N = mb.N, I = mb.I; let vol = 0;
  for (let k = 0; k < I.length; k += 3) { const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; }
  if (vol < 0 && !p.decal) { for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } for (let i = 0; i < N.length; i++) N[i] = -N[i]; }
  if (typeof p.toneFn === 'function') for (let i = 0; i < P.length / 3; i++) mb.T[i] = p.toneFn(P[3 * i], P[3 * i + 1], P[3 * i + 2], N[3 * i], N[3 * i + 1], N[3 * i + 2]);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new Float32BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('tone', new Float32BufferAttribute(new Float32Array(mb.T), 1));
  g.setIndex(new Uint32BufferAttribute(new Uint32Array(I), 1));
  return { id: p.id ?? `${kind}_${++UID}`, kind, role: p.role ?? role, geometry: g, sdf, flow: p.flow ?? (role !== 'rotor'), decal: !!p.decal, ...extra };
}

/* ---------------------------------------------------------------- makers */
const sectionArgs = p => {
  const W = p.width ?? (p.radius !== undefined ? 2 * p.radius : 0.1), H = p.height ?? (p.radius !== undefined ? 2 * p.radius : W);
  return { W, H, n: p.n ?? 2, yOffset: p.yOffset ?? 0, zOffset: p.zOffset ?? 0 };
};
function endedLoft(p, role, fProf) {
  const { W, H, n, yOffset, zOffset } = sectionArgs(p), f = fProf;
  const round = Math.abs(W - H) < 1e-9 && n === 2;
  const q = { ...p, x0: p.x0 ?? 0, length: p.length, n, yOffset, zOffset, capStart: p.capStart, capEnd: p.capEnd };
  if (round) q.radius = t => (W / 2) * f(t); else { q.width = t => W * f(t); q.height = t => H * f(t); }
  return buildLoft(q, role, 0.8);
}
const MAKERS = {
  loft: p => buildLoft(p, p.role ?? 'body'),
  nose: p => { const { W, H } = sectionArgs(p), shape = p.shape ?? 'ogive'; const f = profiles.nose(shape, p.length, Math.min(W, H) / 2); const q = { ...p, capStart: shape === 'flat', capEnd: false }; return endedLoft(q, 'nose', f); },
  tail: p => { const { W, H } = sectionArgs(p), shape = p.shape ?? 'point'; const f = profiles.tail(shape, p.length, Math.min(W, H) / 2, p.boattailDeg ?? 8); const q = { ...p, capStart: false, capEnd: shape === 'blunt' }; return endedLoft(q, 'tail', f); },
  body: p => { const q = { ...p, capStart: false, capEnd: false }; return endedLoft(q, 'body', () => 1); },
  canopy: p => {
    const pk = p.peak ?? 0.38, W = p.width ?? 0.1, H = p.height ?? 0.08;
    const f = t => (t <= pk ? Math.sqrt(Math.max(0, 1 - ((pk - t) / pk) ** 2)) : Math.pow(Math.max(0, 1 - Math.pow((t - pk) / (1 - pk), 2.2)), 0.55));
    return buildLoft({ ...p, role: p.role ?? 'detail', width: t => W * f(t), height: t => H * f(t), yOffset: p.y ?? p.yOffset ?? 0, capStart: false, capEnd: false, n: p.n ?? 2, tone: p.tone ?? 1 }, 'detail', 0.8);
  },
  nacelle: p => {
    const R = p.radius ?? 0.04, e = p.endRatio ?? 0.55;
    const f = t => (t < 0.2 ? Math.sqrt(Math.max(0, 1 - ((0.2 - t) / 0.2) ** 2)) * 0.12 + 0.88 * Math.sqrt(Math.max(0, 1 - ((0.2 - t) / 0.2) ** 2)) : t < 0.6 ? 1 : 1 - (1 - e) * ((t - 0.6) / 0.4) ** 1.5);
    return buildLoft({ ...p, role: p.role ?? 'detail', radius: t => R * f(t), yOffset: p.y ?? 0, zOffset: p.z ?? 0, capStart: false, capEnd: true, tone: p.tone ?? 1 }, 'detail', 0.8);
  },
  wing: p => mkWing(p, false),
  fin: p => mkWing(p, true),
  roundedBox: p => {
    const s = p.size ?? [0.1, 0.1, 0.1], h = s.map(v => v / 2), c = p.center ?? [0, 0, 0], r = clamp(p.radius ?? 0.01, 0, Math.min(...h) - 1e-6), ref = p.ref ?? Math.max(...s, 0.6), edge = p.edge ?? EK * ref;
    const mb = new MB(); mb.tone = p.tone ?? 0; boxMesh(mb, h[0], h[1], h[2], r, edge, c); return finish('roundedBox', p.role ?? 'detail', mb, boxSDF(c, h, r), p);
  },
  box: p => MAKERS.roundedBox({ ...p, radius: 0 }),
  rotor: p => {
    const c = p.center ?? [0, 0, 0], ax = (p.axis ?? [0, 1, 0]), al = Math.hypot(...ax), a = ax.map(v => v / al), R = p.radius ?? 0.3, hubR = p.hubRadius ?? 0.03, nb = p.blades ?? 2, chord = p.chord ?? 0.04;
    let u = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [a[2], 0, -a[0]]; const ul = Math.hypot(...u); u = u.map(v => v / ul);
    const v = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]], mb = new MB(), sdfs = [], ref = p.ref ?? 1.0, edge = p.edge ?? EK * ref; mb.tone = p.tone ?? 2;
    const hh = p.hubHeight ?? 0.02; latheMesh(mb, { origin: c, axis: a, edge, chains: [{ pts: [[0, hh], [hubR, hh]], tone: 1, sgn: -1 }, { pts: [[hubR, hh], [hubR, -hh]], tone: 1, sgn: -1 }, { pts: [[hubR, -hh], [0, -hh]], tone: 1, sgn: -1 }] });
    sdfs.push((x, y, z) => { const rx = x - c[0], ry = y - c[1], rz = z - c[2], h = rx * a[0] + ry * a[1] + rz * a[2], rho = Math.hypot(rx - h * a[0], ry - h * a[1], rz - h * a[2]); const qx = rho - hubR, qy = Math.abs(h) - hh; return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)); });
    const inner = hubR * 0.7;
    for (let k = 0; k < nb; k++) {
      const ph = (TAU * k) / nb + (p.phase ?? 0), es = [Math.cos(ph) * u[0] + Math.sin(ph) * v[0], Math.cos(ph) * u[1] + Math.sin(ph) * v[1], Math.cos(ph) * u[2] + Math.sin(ph) * v[2]];
      const ex = [a[1] * es[2] - a[2] * es[1], a[2] * es[0] - a[0] * es[2], a[0] * es[1] - a[1] * es[0]], ori = [c[0] + es[0] * inner, c[1] + es[1] * inner, c[2] + es[2] * inner];
      const o = { profile: p.profile ?? '0012', tc: p.tc ?? 0.07, semi: R - inner, cr: chord, ct: chord * (p.taper ?? 0.7), dx: 0, dy: 0, mirror: false, ex: ex.map(q => -q), et: a, es, ori, inc: (p.pitchDeg ?? 6) * PI / 180, edge, spanning: false };
      o.ori = [ori[0] + ex[0] * chord * 0.25, ori[1] + ex[1] * chord * 0.25, ori[2] + ex[2] * chord * 0.25];
      wingGeom(mb, o); sdfs.push(wingSDF(o));
    }
    const sdf = (x, y, z) => { let d = Infinity; for (const f of sdfs) d = Math.min(d, f(x, y, z)); return d; };
    return finish('rotor', 'rotor', mb, sdf, { ...p, flow: p.flow ?? false }, { spin: { axis: a, rate: p.rate ?? 40, center: c.slice() } });
  },
  /* ---- shapes (reference point = geometric centre) */
  sphere: p => {
    const D = p.D ?? 0.3, R = D / 2, q = { ...p, length: D, x0: -R, radius: t => R * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)), ref: p.ref ?? D, role: p.role ?? 'shape', sdf: (x, y, z) => Math.hypot(x, y, z) - R };
    return buildLoft(q, 'shape');
  },
  cylinder: p => {
    const D = p.D ?? 0.12, R = D / 2, z0 = p.z0 ?? -1.2, z1 = p.z1 ?? 1.2, ref = p.ref ?? D, edge = p.edge ?? EK * ref, mb = new MB(); mb.tone = p.tone ?? 0;
    cylZMesh(mb, R, z0, z1, edge); const hz = (z1 - z0) / 2, zm = (z0 + z1) / 2;
    const sdf = (x, y, z) => { const qx = Math.hypot(x, y) - R, qy = Math.abs(z - zm) - hz; return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)); };
    return finish('cylinder', p.role ?? 'shape', mb, sdf, p, { spanning: true });
  },
  plate: p => MAKERS.box({ size: p.size ?? [0.012, 0.4, 0.4], center: [0, 0, 0], ref: p.ref ?? 0.4, role: 'shape', ...p, kindName: 'plate' }),
  rhombus: p => {
    const D = p.D ?? 0.3, R = D / 2, L = p.length ?? 0.52;
    return buildLoft({ ...p, length: L, x0: -L / 2, radius: t => R * (1 - Math.abs(2 * t - 1)), creases: [0.5], ref: p.ref ?? L }, 'shape');
  },
  teardrop: p => {
    const D = p.D ?? 0.3, R = D / 2, L = p.length ?? 1.05, k = R / (0.5 * Math.pow(0.75, 1.5));
    return buildLoft({ ...p, length: L, x0: -L / 2, radius: t => k * Math.sqrt(Math.max(0, t)) * Math.pow(Math.max(0, 1 - t), 1.5), ref: p.ref ?? L }, 'shape');
  },
};

Object.assign(MAKERS, createHullMakers({ MB, zip, discRings, latheMesh, finish, EK }));

export function make(kind, params = {}) {
  const f = MAKERS[kind]; if (!f) throw new Error('parts.make: unknown kind ' + kind);
  const part = f(params); if (kind === 'plate') { part.kind = 'plate'; part.role = params.role ?? 'shape'; } return part;
}
export const KINDS = Object.keys(MAKERS);
