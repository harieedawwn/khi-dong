// src/geom/assemble.js  (P3)  assemble(parts) -> Model (SPEC section 5).
// Extra fields beyond the spec (harmless): model.geometry attribute 'tone' (0/1/2, kept so heatmaps can be undone),
// colloc.area (m^2 each point stands for), liftingLines[].partId (a mirrored wing gives two lines, ids "<partId>:L"/":R"),
// info.fins (same record as info.wings, for role 'fin'), info.D = frontal-equivalent diameter (y-extent when spanning).
// 'color' is LINEAR RGB of SPEC section 8 tones (three treats vertex colors as linear).
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three';

export const TONE_HEX = [0xE9E6DF, 0xB9BEC4, 0x2B2F35];
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
export const TONE_RGB = TONE_HEX.map(h => [lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255)]);
const HIDE = -1.5e-3; // a triangle/sample deeper than this inside another part is hidden

function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// projected area of a triangle set on a 256x256 grid (axes a,b of the xyz triple), pixel-centre sampling
function rasterArea(P, I, tris, a, b) {
  const G = 256; let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
  for (const k of tris) for (let q = 0; q < 3; q++) { const v = I[k * 3 + q] * 3; amin = Math.min(amin, P[v + a]); amax = Math.max(amax, P[v + a]); bmin = Math.min(bmin, P[v + b]); bmax = Math.max(bmax, P[v + b]); }
  if (!(amax > amin) || !(bmax > bmin)) return 0;
  const pa = (amax - amin) * 1.0001 / G, pb = (bmax - bmin) * 1.0001 / G, grid = new Uint8Array(G * G);
  for (const k of tris) {
    const i0 = I[k * 3] * 3, i1 = I[k * 3 + 1] * 3, i2 = I[k * 3 + 2] * 3;
    const x0 = (P[i0 + a] - amin) / pa, y0 = (P[i0 + b] - bmin) / pb, x1 = (P[i1 + a] - amin) / pa, y1 = (P[i1 + b] - bmin) / pb, x2 = (P[i2 + a] - amin) / pa, y2 = (P[i2 + b] - bmin) / pb;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2); if (Math.abs(den) < 1e-12) continue;
    const xs = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 0.5)), xe = Math.min(G - 1, Math.ceil(Math.max(x0, x1, x2) - 0.5)), ys = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 0.5)), ye = Math.min(G - 1, Math.ceil(Math.max(y0, y1, y2) - 0.5));
    for (let j = ys; j <= ye; j++) for (let i = xs; i <= xe; i++) {
      const px = i + 0.5, py = j + 0.5, l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den, l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den, l2 = 1 - l0 - l1;
      if (l0 >= 0 && l1 >= 0 && l2 >= 0) grid[j * G + i] = 1;
    }
  }
  let n = 0; for (let i = 0; i < grid.length; i++) n += grid[i]; return n * pa * pb;
}

export function assemble(parts) {
  // ---- merge geometry
  let nv = 0, ni = 0; for (const p of parts) { nv += p.geometry.attributes.position.count; ni += p.geometry.index.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), T = new Float32Array(nv), C = new Float32Array(nv * 3), I = new Uint32Array(ni);
  const ranges = []; let vo = 0, io = 0;
  for (const p of parts) {
    const g = p.geometry, pa = g.attributes.position.array, na = g.attributes.normal.array, ta = g.attributes.tone.array, ia = g.index.array;
    P.set(pa, vo * 3); N.set(na, vo * 3); T.set(ta, vo);
    for (let i = 0; i < ta.length; i++) { const c = TONE_RGB[ta[i] | 0] || TONE_RGB[0]; C[(vo + i) * 3] = c[0]; C[(vo + i) * 3 + 1] = c[1]; C[(vo + i) * 3 + 2] = c[2]; }
    for (let i = 0; i < ia.length; i++) I[io + i] = ia[i] + vo;
    ranges.push({ v0: vo, v1: vo + ta.length, t0: io / 3, t1: (io + ia.length) / 3 }); vo += ta.length; io += ia.length;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(P, 3)); geometry.setAttribute('normal', new Float32BufferAttribute(N, 3));
  geometry.setAttribute('tone', new Float32BufferAttribute(T, 1)); geometry.setAttribute('color', new Float32BufferAttribute(C, 3));
  geometry.setIndex(new Uint32BufferAttribute(I, 1)); geometry.computeBoundingSphere();

  const sdfs = parts.map(p => p.sdf), sdf = (x, y, z) => { let d = Infinity; for (let i = 0; i < sdfs.length; i++) { const v = sdfs[i](x, y, z); if (v < d) d = v; } return d; };
  const spanning = parts.some(p => p.spanning || (p.wing && p.wing.spanning));

  // ---- per-part bboxes, bbox of the model
  const pb = parts.map((p, i) => { const r = ranges[i], b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let v = r.v0; v < r.v1; v++) for (let a = 0; a < 3; a++) { const x = P[v * 3 + a]; if (x < b[a]) b[a] = x; if (x > b[a + 3]) b[a + 3] = x; } return b; });
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (const b of pb) for (let a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], b[a]); bb[a + 3] = Math.max(bb[a + 3], b[a + 3]); }
  const hiddenAt = (x, y, z, self) => { for (let j = 0; j < parts.length; j++) { if (j === self) continue; const b = pb[j]; if (x < b[0] || x > b[3] || y < b[1] || y > b[4] || z < b[2] || z > b[5]) continue; if (sdfs[j](x, y, z) < HIDE) return true; } return false; };

  // ---- triangle areas, exposure
  const nt = ni / 3, area = new Float32Array(nt), hidden = new Uint8Array(nt); const exposedPart = new Float64Array(parts.length);
  let vol = 0, volExp = 0, wetted = 0;
  for (let pi = 0; pi < parts.length; pi++) for (let k = ranges[pi].t0; k < ranges[pi].t1; k++) {
    const a = I[k * 3] * 3, b = I[k * 3 + 1] * 3, c = I[k * 3 + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx, A = 0.5 * Math.hypot(gx, gy, gz); area[k] = A;
    const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    const d = (cx * gx + cy * gy + cz * gz) / 6; vol += d;
    if (parts.length > 1 && hiddenAt(cx, cy, cz, pi)) { hidden[k] = 1; continue; }
    volExp += d; wetted += A; exposedPart[pi] += A;
  }
  const volume = parts.length === 1 ? vol : volExp;

  // ---- projected areas (all triangles that are not hidden: hidden ones lie inside other parts anyway)
  const all = []; for (let k = 0; k < nt; k++) all.push(k);
  const frontal = rasterArea(P, I, all, 1, 2), planform = rasterArea(P, I, all, 0, 2), sideArea = rasterArea(P, I, all, 0, 1);

  // ---- body group
  const bodyRoles = new Set(['nose', 'body', 'tail', 'shape']), bi = parts.map((p, i) => (bodyRoles.has(p.role) ? i : -1)).filter(i => i >= 0);
  const bodyTris = []; for (const i of bi) for (let k = ranges[i].t0; k < ranges[i].t1; k++) bodyTris.push(k);
  const bbody = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (const i of bi) for (let a = 0; a < 3; a++) { bbody[a] = Math.min(bbody[a], pb[i][a]); bbody[a + 3] = Math.max(bbody[a + 3], pb[i][a + 3]); }
  const bL = bi.length ? bbody[3] - bbody[0] : 0, bFront = bodyTris.length ? rasterArea(P, I, bodyTris, 1, 2) : 0;
  let bWet = 0, baseArea = 0, noseArea = 0; const edgeBand = 0.02 * Math.max(bL, 1e-6);
  for (const i of bi) for (let k = ranges[i].t0; k < ranges[i].t1; k++) {
    if (hidden[k]) continue; bWet += area[k];
    const a = I[k * 3] * 3, b = I[k * 3 + 1] * 3, c = I[k * 3 + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const gx = uy * vz - uz * vy, l = Math.hypot(gx, uz * vx - ux * vz, ux * vy - uy * vx) || 1, nx = gx / l, cx = (P[a] + P[b] + P[c]) / 3;
    if (nx > 0.95 && cx > bbody[3] - edgeBand) baseArea += area[k]; if (nx < -0.95 && cx < bbody[0] + edgeBand) noseArea += area[k];
  }
  const bodyD = bi.length ? (spanning ? bbody[4] - bbody[1] : Math.sqrt(4 * bFront / Math.PI)) : 0;
  const wingRec = (p, i) => { const w = p.wing, span = w.span, S = w.S; return { id: p.id, S, span, chord: span > 0 ? S / span : 0, tc: w.tc, sweepDeg: w.sweepDeg, AR: S > 0 ? span * span / S : 0, spanning: !!w.spanning, wetted: exposedPart[i] }; };
  const wings = [], fins = []; parts.forEach((p, i) => { if (p.wing && p.role === 'wing') wings.push(wingRec(p, i)); else if (p.wing && p.role === 'fin') fins.push(wingRec(p, i)); });

  // ---- lifting lines at quarter chord
  const liftingLines = [];
  for (const p of parts) {
    if (!p.wing || (p.role !== 'wing' && p.role !== 'fin')) continue; const w = p.wing, rl = w.rootLE, tl = w.tipLE, rc = w.rootChord, tc = w.tipChord;
    // chord axis is the model x direction for wings; fins keep x chords too (basis ex = x)
    const qr = [rl[0] + 0.25 * rc, rl[1], rl[2]], qt = [tl[0] + 0.25 * tc, tl[1], tl[2]], mc = (rc + tc) / 2;
    if (w.mirror) { const ql = [qt[0], qt[1], 2 * rl[2] - qt[2]]; // mirrored in the root plane z = rootLE.z (wings sit at z 0)
      const zc = rl[2]; ql[2] = zc - (qt[2] - zc);
      liftingLines.push({ id: p.id + ':L', partId: p.id, a: ql, b: qr, chord: mc, spanning: !!w.spanning }, { id: p.id + ':R', partId: p.id, a: qr, b: qt, chord: mc, spanning: !!w.spanning }); }
    else liftingLines.push({ id: p.id, partId: p.id, a: qr, b: qt, chord: mc, spanning: !!w.spanning });
  }

  // ---- collocation points: area-weighted candidates, farthest-point selection
  const flowIdx = parts.map((p, i) => (p.flow ? i : -1)).filter(i => i >= 0), cum = [], tl = []; let tot = 0;
  for (const i of flowIdx) for (let k = ranges[i].t0; k < ranges[i].t1; k++) if (!hidden[k]) { tot += area[k]; cum.push(tot); tl.push(k); }
  const rnd = prng(12345), cand = [], NC = 8 * 600;
  if (tl.length) for (let s = 0; s < NC; s++) {
    const r = rnd() * tot; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    const k = tl[lo], a = I[k * 3] * 3, b = I[k * 3 + 1] * 3, c = I[k * 3 + 2] * 3; let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; } const w = 1 - u - v;
    const x = P[a] * w + P[b] * u + P[c] * v, y = P[a + 1] * w + P[b + 1] * u + P[c + 1] * v, z = P[a + 2] * w + P[b + 2] * u + P[c + 2] * v;
    let owner = -1; for (let q = 0; q < parts.length; q++) if (k >= ranges[q].t0 && k < ranges[q].t1) { owner = q; break; }
    if (hiddenAt(x, y, z, owner)) continue;
    let nx = N[a] * w + N[b] * u + N[c] * v, ny = N[a + 1] * w + N[b + 1] * u + N[c + 1] * v, nz = N[a + 2] * w + N[b + 2] * u + N[c + 2] * v; const l = Math.hypot(nx, ny, nz) || 1;
    cand.push(x, y, z, nx / l, ny / l, nz / l);
  }
  const nc = cand.length / 6, want = Math.min(600, nc), pos = new Float32Array(want * 3), nrm = new Float32Array(want * 3), carea = new Float32Array(want);
  if (want > 0) {
    const dmin = new Float64Array(nc).fill(Infinity); let cur = 0;
    for (let s = 0; s < want; s++) {
      for (let a = 0; a < 3; a++) { pos[s * 3 + a] = cand[cur * 6 + a]; nrm[s * 3 + a] = cand[cur * 6 + 3 + a]; }
      let best = -1, bd = -1; const px = cand[cur * 6], py = cand[cur * 6 + 1], pz = cand[cur * 6 + 2];
      for (let q = 0; q < nc; q++) { const dx = cand[q * 6] - px, dy = cand[q * 6 + 1] - py, dz = cand[q * 6 + 2] - pz, d = dx * dx + dy * dy + dz * dz; if (d < dmin[q]) dmin[q] = d; if (dmin[q] > bd) { bd = dmin[q]; best = q; } }
      cur = best;
    }
    carea.fill(tot / want);
  }

  const wingSpan = bb[5] - bb[2], D = spanning ? (bi.length ? bodyD : bb[4] - bb[1]) : (bi.length ? bodyD : Math.sqrt(4 * frontal / Math.PI));
  const info = { frontal, planform, sideArea, wetted, volume, L: bb[3] - bb[0], D, span: wingSpan, bbox: { min: [bb[0], bb[1], bb[2]], max: [bb[3], bb[4], bb[5]] },
    body: { L: bL, D: bodyD, wetted: bWet, baseArea, noseArea }, wings, fins };
  return { geometry, parts, sdf, spanning, colloc: { pos, nrm, area: carea }, liftingLines, info };
}
