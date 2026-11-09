// test/flow.test.mjs  (P2)  -  node --test test/flow.test.mjs
// Self-contained: builds its own bodies (sphere, 3:1 prolate spheroid, spanning
// cylinder, spanning 12 % wing) and a stub aero result. No other project files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlow, _makeEngine, _workerSource } from '../src/flow/flowfield.js';
import { surfaceFields } from '../src/flow/surface.js';

/* ------------------------------ test bodies ------------------------------ */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function fib(n, off = 0.5) { const o = []; const ga = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < n; i++) { const y = 1 - 2 * (i + off) / n, r = Math.sqrt(1 - y * y), t = ga * i; o.push([Math.cos(t) * r, y, Math.sin(t) * r]); } return o; }

function fakeGeometry(position, normal, index) {
  return { attributes: { position: { array: position, count: position.length / 3 }, normal: { array: normal, count: normal.length / 3 } }, index: { array: index } };
}
function uvSphereGeom(Rx, Ry, Rz, nu, nvv) {
  const pos = [], nrm = [], idx = [];
  for (let j = 0; j <= nvv; j++) for (let i = 0; i <= nu; i++) {
    const th = Math.PI * j / nvv, ph = 2 * Math.PI * i / nu;
    const dx = -Math.cos(th), dy = Math.sin(th) * Math.cos(ph), dz = Math.sin(th) * Math.sin(ph);
    pos.push(Rx * dx, Ry * dy, Rz * dz);
    const gx = dx / Rx, gy = dy / Ry, gz = dz / Rz, gl = Math.hypot(gx, gy, gz);
    nrm.push(gx / gl, gy / gl, gz / gl);
  }
  for (let j = 0; j < nvv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return fakeGeometry(new Float32Array(pos), new Float32Array(nrm), new Uint32Array(idx));
}
function ellipsoid(a, b, M = 600, geomN = [48, 24]) {
  const pts = fib(M), pos = new Float32Array(3 * M), nrm = new Float32Array(3 * M);
  pts.forEach((d, i) => {
    pos.set([a * d[0], b * d[1], b * d[2]], 3 * i);
    const g = [d[0] / a, d[1] / b, d[2] / b], gl = Math.hypot(...g);
    nrm.set([g[0] / gl, g[1] / gl, g[2] / gl], 3 * i);
  });
  const sdf = (x, y, z) => { const g = Math.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / b) ** 2); const gl = Math.sqrt((x / a / a) ** 2 + (y / b / b) ** 2 + (z / b / b) ** 2) / (g || 1e-9); return (g - 1) / gl; };
  return { geometry: uvSphereGeom(a, b, b, geomN[0], geomN[1]), spanning: false, colloc: { pos, nrm }, liftingLines: [], sdf, info: { L: 2 * a, D: 2 * b, body: { L: 2 * a, D: 2 * b } } };
}
function cylinder2D(R = 0.06) {
  const pos = [], nrm = [];
  for (let k = 0; k < 5; k++) for (let i = 0; i < 120; i++) { const t = 2 * Math.PI * (i + 0.5) / 120; pos.push(R * Math.cos(t), R * Math.sin(t), -1.2 + 0.6 * k); nrm.push(Math.cos(t), Math.sin(t), 0); }
  const gp = [], gn = [], gi = [];
  for (let k = 0; k < 2; k++) for (let i = 0; i < 64; i++) { const t = 2 * Math.PI * i / 64; gp.push(R * Math.cos(t), R * Math.sin(t), k ? 1.2 : -1.2); gn.push(Math.cos(t), Math.sin(t), 0); }
  for (let i = 0; i < 64; i++) { const a = i, b = (i + 1) % 64, c = a + 64, d = b + 64; gi.push(a, c, b, b, c, d); }
  return { geometry: fakeGeometry(new Float32Array(gp), new Float32Array(gn), new Uint32Array(gi)), spanning: true, colloc: { pos: new Float32Array(pos), nrm: new Float32Array(nrm) }, liftingLines: [], sdf: (x, y) => Math.hypot(x, y) - R, info: { L: 2 * R, D: 2 * R, body: { L: 2 * R, D: 2 * R } } };
}
function naca0012Wing(c = 0.5) {
  const n = 100, up = [], lo = [];
  for (let i = 0; i <= n; i++) {
    const b = Math.PI * i / n, x = 0.5 * (1 - Math.cos(b));
    const yt = 5 * 0.12 * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    up.push([x * c - 0.25 * c, yt * c]); lo.push([x * c - 0.25 * c, -yt * c]);
  }
  const poly = []; for (let i = n; i >= 0; i--) poly.push(up[i]); for (let i = 1; i <= n; i++) poly.push(lo[i]);
  const N = poly.length;
  const nor = poly.map((p, i) => { const a = poly[(i + N - 1) % N], b = poly[(i + 1) % N]; const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty); return [ty / tl, -tx / tl]; });
  const pos = [], nrm = [];
  for (let k = 0; k < 3; k++) poly.forEach((p, i) => { pos.push(p[0], p[1], -1.2 + 1.2 * k); nrm.push(nor[i][0], nor[i][1], 0); });
  const gp = [], gn = [], gi = [];
  for (let k = 0; k < 2; k++) poly.forEach((p, i) => { gp.push(p[0], p[1], k ? 1.2 : -1.2); gn.push(nor[i][0], nor[i][1], 0); });
  for (let i = 0; i < N; i++) { const a = i, b = (i + 1) % N, cc = a + N, d = b + N; gi.push(a, cc, b, b, cc, d); }
  const sdf = (x, y) => {
    let dmin = 1e9, inside = false;
    for (let i = 0; i < N; i++) {
      const a = poly[i], b = poly[(i + 1) % N];
      const ex = b[0] - a[0], ey = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey)));
      const d = Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey); if (d < dmin) dmin = d;
      if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) / (b[1] - a[1]) * ex) inside = !inside;
    }
    return inside ? -dmin : dmin;
  };
  return {
    geometry: fakeGeometry(new Float32Array(gp), new Float32Array(gn), new Uint32Array(gi)), spanning: true,
    colloc: { pos: new Float32Array(pos), nrm: new Float32Array(nrm) },
    liftingLines: [{ id: 'wing', a: [0, 0, -1.2], b: [0, 0, 1.2], chord: c, spanning: true }], sdf,
    info: { L: c, D: 0.06, body: { L: c, D: 0.06 }, wings: [{ id: 'wing', S: c * 2.4, span: 2.4, chord: c }] }
  };
}

const AIR = { rho: 1.225, mu: 1.81e-5 };
function mkRes(o) {
  return Object.assign({ M: 0, q: 0.5 * 1.225 * 400, p0: 101325 * 1.002, T0: 288.15, Re: 4e5, St: 0.2, Dshed: 0.3, regime: { flow: 'subsonic', bl: 'turbulent', wake: 'street' }, sepDeg: 180, cpb: -0.3, surfacesCL: [], CL: 0 }, o || {});
}
const AD = { sep: { mode: 'angle' }, nose: 'round', noseHalfDeg: 0 };
async function bakeModel(model, ad = AD, opts = { sliceMs: 1e9, worker: false }) { const f = createFlow(opts); const ok = await f.setModel(model, ad); assert.equal(ok, true); return f; }

/* ------------------------------------ tests ------------------------------ */
test('sphere: surface speed 1.5U, stagnation Cp 1, normal residual', async () => {
  const R = 0.15, model = ellipsoid(R, R, 600);
  const f = await bakeModel(model);
  const out = new Float64Array(9), r = rng(5);
  let sumN2 = 0, maxUt = 0;
  const NP = 500;
  for (let i = 0; i < NP; i++) {
    const d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1], dl = Math.hypot(...d), n = d.map((v) => v / dl);
    f._debug.evalExact(R * n[0], R * n[1], R * n[2], out);
    const u = [1 + out[0], out[1], out[2]], un = u[0] * n[0] + u[1] * n[1] + u[2] * n[2];
    sumN2 += un * un; const ut = Math.sqrt(Math.max(0, u[0] ** 2 + u[1] ** 2 + u[2] ** 2 - un * un)); if (ut > maxUt) maxUt = ut;
  }
  const rms = Math.sqrt(sumN2 / NP);
  let eq = 0;
  for (let i = 0; i < 64; i++) { const t = 2 * Math.PI * i / 64; f._debug.evalExact(0, R * Math.cos(t), R * Math.sin(t), out); eq += Math.hypot(1 + out[0], out[1], out[2]); }
  eq /= 64;
  f._debug.evalExact(-R, 0, 0, out);
  const cpStag = 1 - ((1 + out[0]) ** 2 + out[1] ** 2 + out[2] ** 2);
  console.log(`  sphere: lambda_eff ${f._debug.lambda().toExponential(2)}  rms(u.n) ${rms.toFixed(4)}  equator speed ${eq.toFixed(4)}  max random ${maxUt.toFixed(4)}  Cp_stag ${cpStag.toFixed(4)}`);
  assert.ok(rms < 0.02, 'normal residual RMS ' + rms);
  assert.ok(Math.abs(eq / 1.5 - 1) < 0.03, 'equator speed ' + eq);
  assert.ok(Math.abs(maxUt / 1.5 - 1) < 0.03, 'max speed ' + maxUt);
  assert.ok(Math.abs(cpStag - 1) < 0.03, 'Cp stag ' + cpStag);
});

test('prolate spheroid 3:1: max speed and near-surface normal velocity', async () => {
  const a = 0.45, b = 0.15, model = ellipsoid(a, b, 600);
  const f = await bakeModel(model);
  const e = Math.sqrt(1 - (b / a) ** 2), a0 = (2 * (1 - e * e) / e ** 3) * (0.5 * Math.log((1 + e) / (1 - e)) - e), k = a0 / (2 - a0), umax = 1 + k;
  const out = new Float64Array(9), r = rng(11);
  let eq = 0;
  for (let i = 0; i < 64; i++) { const t = 2 * Math.PI * i / 64; const y = b * Math.cos(t), z = b * Math.sin(t); f._debug.evalExact(0, y, z, out); const n = [0, Math.cos(t), Math.sin(t)]; const u = [1 + out[0], out[1], out[2]]; const un = u[1] * n[1] + u[2] * n[2]; eq += Math.sqrt(u[0] ** 2 + u[1] ** 2 + u[2] ** 2 - un * un); }
  eq /= 64;
  let maxUn = 0, sum2 = 0; const NP = 2000; const nrmErr = [];
  for (let i = 0; i < NP; i++) {
    const d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1], dl = Math.hypot(...d);
    const p = [a * d[0] / dl, b * d[1] / dl, b * d[2] / dl];
    const g = [p[0] / a / a, p[1] / b / b, p[2] / b / b], gl = Math.hypot(...g), n = g.map((v) => v / gl);
    const off = r() * 0.002; // within 2 mm outside the surface
    f._debug.evalExact(p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off, out);
    const un = (1 + out[0]) * n[0] + out[1] * n[1] + out[2] * n[2];
    nrmErr.push(Math.abs(un)); if (Math.abs(un) > maxUn) maxUn = Math.abs(un); sum2 += un * un;
  }
  console.log(`  spheroid: analytic max ${umax.toFixed(4)}  equator ${eq.toFixed(4)}  max|u.n| ${maxUn.toFixed(4)}  rms ${Math.sqrt(sum2 / NP).toFixed(4)}`);
  assert.ok(Math.abs(eq / umax - 1) < 0.03, 'max speed ' + eq + ' vs ' + umax);
  nrmErr.sort((x, y) => x - y);
  const p95 = nrmErr[Math.floor(0.95 * NP)];
  console.log(`  spheroid |u.n|: p95 ${p95.toFixed(4)}, p99 ${nrmErr[Math.floor(0.99 * NP)].toFixed(4)}, max ${maxUn.toFixed(4)} (worst at the pointed tips)`);
  assert.ok(p95 < 0.03, 'p95 normal velocity ' + p95);
  assert.ok(maxUn < 0.08, 'max normal velocity ' + maxUn);
});

test('spanning cylinder: speed 2U at 90 degrees', async () => {
  const R = 0.06, f = await bakeModel(cylinder2D(R));
  const out = new Float64Array(9);
  let s = 0;
  for (const sg of [1, -1]) { f._debug.evalExact(0, sg * R, 0.3, out); s += Math.hypot(1 + out[0], out[1]); }
  s /= 2;
  // 45 degree point: analytic 2 sin(45) = sqrt(2)
  f._debug.evalExact(R * Math.SQRT1_2, R * Math.SQRT1_2, 0, out);
  const s45 = Math.hypot(1 + out[0], out[1]);
  console.log(`  cylinder: speed@90deg ${s.toFixed(4)} speed@45deg ${s45.toFixed(4)} (1.4142)`);
  assert.ok(Math.abs(s / 2 - 1) < 0.03, 'speed ' + s);
  assert.ok(Math.abs(s45 / Math.SQRT2 - 1) < 0.03);
});

test('12 % wing, alpha 5 deg, CL 0.5: upper faster than lower, integrated lift within 25 %', async () => {
  const model = naca0012Wing(), f = await bakeModel(model, { sep: { mode: 'angle' }, nose: 'round' });
  const alpha = 5, res = mkRes({ surfacesCL: [{ id: 'wing', CL: 0.5 }], Dshed: 0.06, regime: { flow: 'subsonic', bl: 'turbulent', wake: 'none' } });
  f.update(res, alpha, 1, 1 / 60);
  const sf = surfaceFields(f, model, res, AIR, alpha);
  const pos = model.geometry.attributes.position.array, nrm = model.geometry.attributes.normal.array, idx = model.geometry.index.array;
  let su = 0, nu = 0, sl = 0, nl = 0;
  for (let v = 0; v < pos.length / 3; v++) { const sp = Math.sqrt(Math.max(0, 1 - sf.cp[v])); if (nrm[3 * v + 1] > 0) { su += sp; nu++; } else { sl += sp; nl++; } }
  const a = alpha * Math.PI / 180, l = [-Math.sin(a), Math.cos(a)];
  let Lsum = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2], P = (i) => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
    const p0 = P(i0), p1 = P(i1), p2 = P(i2), A = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], B = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let c = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]]; const cl = Math.hypot(...c);
    const vn = [0, 1, 2].map((k) => nrm[3 * i0 + k] + nrm[3 * i1 + k] + nrm[3 * i2 + k]); if (c[0] * vn[0] + c[1] * vn[1] + c[2] * vn[2] < 0) c = c.map((x) => -x);
    const cpf = (sf.cp[i0] + sf.cp[i1] + sf.cp[i2]) / 3;
    Lsum += -cpf * (c[0] * l[0] + c[1] * l[1]) * 0.5; // c has |c| = 2*area, c/|c| = n
  }
  const CLint = Lsum / (0.5 * 2.4);
  console.log(`  wing: mean speed upper ${(su / nu).toFixed(3)} lower ${(sl / nl).toFixed(3)}  CL(int) ${CLint.toFixed(3)} (target 0.5)`);
  assert.ok(su / nu > sl / nl);
  assert.ok(Math.abs(CLint / 0.5 - 1) < 0.25, 'CL ' + CLint);
});

test('finite lifting line: downwash behind, upwash outboard (sign check)', async () => {
  const model = ellipsoid(0.15, 0.15, 600);
  model.liftingLines = [{ id: 'w', a: [0, 0, -0.1], b: [0, 0, 0.1], chord: 0.1, spanning: false }];
  model.info.wings = [{ id: 'w', S: 0.02, span: 0.2, chord: 0.1 }];
  const f = await bakeModel(model);
  const out = new Float64Array(9);
  f._debug.evalExact(0.6, 0, 0, out); const dw = out[7];
  f._debug.evalExact(0.6, 0, 0.3, out); const uw = out[7];
  console.log(`  horseshoe: G_y behind centre ${dw.toFixed(3)}, behind outboard ${uw.toFixed(3)}`);
  assert.ok(dw < 0 && uw > 0);
});

test('base field is divergence free (exact sum and sampled grid)', async () => {
  const R = 0.15, f = await bakeModel(ellipsoid(R, R, 600));
  f.update(mkRes({ regime: { flow: 'subsonic', bl: 'turbulent', wake: 'none' }, Dshed: 0.3 }), 0, 1, 0);
  const r = rng(21), g = f._debug.grid(), h = Math.max(g.hx, g.hy), out = new Float64Array(9), a = new Float64Array(3), b = new Float64Array(3);
  const eps = 1e-4; let maxE = 0, maxS = 0, nS = 0;
  const unitL = 1 / 0.3;
  const Dv = (fn, p, i, d) => { const q = p.slice(); q[i] += d; fn(q[0], q[1], q[2], a); q[i] -= 2 * d; fn(q[0], q[1], q[2], b); return (a[i] - b[i]) / (2 * d); };
  const ex = (x, y, z, o) => { f._debug.evalExact(x, y, z, out); o[0] = 1 + out[0]; o[1] = out[1]; o[2] = out[2]; };
  for (let i = 0; i < 300; i++) {
    const p = [(r() * 2 - 1) * 0.6, (r() * 2 - 1) * 0.5, (r() * 2 - 1) * 0.5]; const rr = Math.hypot(...p); if (rr < 0.25 || rr > 0.7) continue;
    const dv = Dv(ex, p, 0, eps) + Dv(ex, p, 1, eps) + Dv(ex, p, 2, eps); maxE = Math.max(maxE, Math.abs(dv));
    const sm = (x, y, z, o) => f.sample(x, y, z, o);
    if (rr > 0.3) { const ds = Dv(sm, p, 0, h) + Dv(sm, p, 1, h) + Dv(sm, p, 2, h); maxS = Math.max(maxS, Math.abs(ds)); nS++; }
  }
  console.log(`  divergence: exact max ${maxE.toExponential(2)} (limit ${(0.02 * unitL).toFixed(3)}), sampled-grid max ${maxS.toFixed(4)} over ${nS} pts, cell ${h.toFixed(4)} m`);
  assert.ok(maxE < 0.02 * unitL);
  assert.ok(maxS < 0.02 * unitL, 'sampled divergence ' + maxS);
});

test('street: release period 1/(2 f_vis), nothing upstream of the separation line', async () => {
  const f = await bakeModel(ellipsoid(0.15, 0.15, 600));
  const Uvis = 2, St = 0.2, D = 0.3, fv = St * Uvis / D;
  const res = mkRes({ St, Dshed: D, Re: 2e5, sepDeg: 100, regime: { flow: 'subsonic', bl: 'laminar', wake: 'street' } });
  let minGap = 1e9, minX = 1e9;
  for (let i = 0; i < 60 * 25; i++) {
    f.update(res, 0, Uvis, 1 / 60);
    if (i % 5 === 0) { const w = f._debug.wake(); for (const x of w.x) minX = Math.min(minX, x - w.xSep); }
  }
  const t = f._debug.releases(), gaps = []; for (let i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1]);
  const T = 1 / (2 * fv), worst = Math.max(...gaps.map((g) => Math.abs(g / T - 1)));
  const w = f._debug.wake();
  assert.ok(f.phase() >= 0 && f.phase() < 2 * Math.PI);
  console.log(`  street: ${t.length} releases, half period ${T.toFixed(4)} s, worst deviation ${(100 * worst).toFixed(3)} %, x_sep ${w.xSep.toFixed(3)}, min(x - x_sep) ${minX.toFixed(4)}, alive ${w.x.length}`);
  assert.ok(t.length > 20 && worst < 0.02);
  assert.ok(minX >= -1e-9, 'vortex upstream of separation line');
  assert.ok(w.x.length <= 40);
  // velocity upstream of separation line carries no wake term
  const o = new Float64Array(3), o2 = new Float64Array(3);
  const sepUp = w.xSep - 0.01;
  f.sample(sepUp, 0.5, 0.1, o);
  const f2 = await bakeModel(ellipsoid(0.15, 0.15, 600)); f2.update(mkRes({ regime: { flow: 'subsonic', bl: 'laminar', wake: 'none' }, Dshed: D, Re: 2e5, sepDeg: 100 }), 0, Uvis, 0); f2.sample(sepUp, 0.5, 0.1, o2);
  assert.ok(Math.hypot(o[0] - o2[0], o[1] - o2[1], o[2] - o2[2]) < 1e-12);
});

test('M 2 sphere: zero perturbation ahead of the bow shock, Billig standoff', async () => {
  const R = 0.15, f = await bakeModel(ellipsoid(R, R, 600));
  const M = 2, Uvis = 3;
  f.update(mkRes({ M, Dshed: 0.3, Re: 1e6, regime: { flow: 'supersonic', bl: 'turbulent', wake: 'street' }, cpb: -0.25 }), 0, Uvis, 1 / 60);
  const sh = f.shock();
  assert.ok(sh && sh.type === 'bow');
  const out = new Float64Array(3);
  const xv = sh.apex[0];
  const bill = R * 0.143 * Math.exp(3.24 / (M * M));
  // locate the shock on the axis from the sampled field: first x where the field differs from freestream
  let lo = xv - 0.5, hi = -R - 1e-3;      // lo: surely upstream (exact), hi: surely downstream of shock vertex
  f.sample(hi, 0, 0, out); assert.ok(out[0] !== Uvis);
  for (let i = 0; i < 60; i++) { const mid = 0.5 * (lo + hi); f.sample(mid, 0, 0, out); if (out[0] === Uvis && out[1] === 0 && out[2] === 0) lo = mid; else hi = mid; }
  const standoffMeasured = -R - hi;
  f.sample(xv - 0.05, 0, 0, out);
  console.log(`  bow shock: standoff reported ${sh.standoff.toFixed(4)} m, Billig ${bill.toFixed(4)} m, measured from sampled field ${standoffMeasured.toFixed(4)} m`);
  assert.equal(out[0], Uvis); assert.equal(out[1], 0); assert.equal(out[2], 0);
  assert.ok(Math.abs(sh.standoff / bill - 1) < 0.02);
  assert.ok(Math.abs(standoffMeasured / bill - 1) < 0.02);
  // off-axis point 5 cm upstream of the shock surface, also exactly freestream
  f.sample(xv - 0.05, 0.3, 0.0, out); assert.equal(out[1], 0);
});

test('conical shock for sharp nose, wedge shock planar', async () => {
  const f = await bakeModel(ellipsoid(0.45, 0.15, 600), { sep: { mode: 'angle' }, nose: 'sharp', noseHalfDeg: 12 });
  f.update(mkRes({ M: 2, regime: { flow: 'supersonic', bl: 'turbulent', wake: 'none' } }), 0, 3, 1 / 60);
  const sh = f.shock();
  const mu = Math.asin(0.5);
  assert.equal(sh.type, 'cone');
  assert.ok(Math.abs(sh.halfAngle - (mu + 6 * Math.PI / 180)) < 1e-9);
  const out = new Float64Array(3); f.sample(sh.apex[0] - 0.05, 0, 0, out); assert.equal(out[0], 3);
  f.update(mkRes({ M: 0.5 }), 0, 3, 1 / 60); assert.equal(f.shock(), null);
});

test('Worker source is self-contained and reproduces the main-thread bake', () => {
  const eng = new Function('return (' + _makeEngine.toString() + ')();')();
  const eng2 = _makeEngine();
  const M = 60, K = 20, pos = new Float64Array(3 * M), nrm = new Float64Array(3 * M), src = new Float64Array(3 * K);
  fib(M).forEach((d, i) => { pos.set(d.map((v) => v * 0.1), 3 * i); nrm.set(d, 3 * i); });
  fib(K).forEach((d, i) => src.set(d.map((v) => v * 0.05), 3 * i));
  const grid = { x0: -0.3, y0: -0.3, z0: -0.3, hx: 0.1, hy: 0.1, hz: 0.1, nx: 7, ny: 7, nz: 7 };
  const mk = () => ({ dim2: false, M, K, pos, nrm, src, lambda: 1e-9, closeW: 30, bnd: new Float64Array(0), nb: 0, leg: new Float64Array(0), nl: 0, v2: new Float64Array(0), n2: 0, grid, inside: new Uint8Array(343), nv: 2, vpos: new Float32Array([0.1, 0, 0, 0, 0.1, 0]) });
  const run = (e) => { const g = e.bake(mk()); let r; do { r = g.next(); } while (!r.done); return r.value; };
  const a = run(eng), b = run(eng2);
  assert.deepEqual(Array.from(a.grid), Array.from(b.grid));
  assert.ok(_workerSource.includes('self.onmessage'));
});

test('determinism: same inputs give the same picture', async () => {
  const run = async () => {
    const f = await bakeModel(ellipsoid(0.15, 0.15, 400));
    const res = mkRes({ St: 0.2, Dshed: 0.3, regime: { flow: 'subsonic', bl: 'laminar', wake: 'irregular' }, sepDeg: 100 });
    for (let i = 0; i < 400; i++) f.update(res, 3, 2, 1 / 60);
    const out = new Float64Array(3), acc = [];
    for (let i = 0; i < 50; i++) { f.sample(0.3 + i * 0.03, 0.1 * Math.sin(i), 0.05 * i % 0.3, out); acc.push(out[0], out[1], out[2]); }
    return acc;
  };
  assert.deepEqual(await run(), await run());
});

test('wake sanity: curl noise zero upstream/inside, probe fields', async () => {
  const f = await bakeModel(ellipsoid(0.15, 0.15, 600));
  const res = mkRes({ regime: { flow: 'subsonic', bl: 'laminar', wake: 'street' }, sepDeg: 100, Re: 2e5, M: 0.05 });
  for (let i = 0; i < 300; i++) f.update(res, 0, 2, 1 / 60);
  const out = new Float64Array(3);
  f.sample(0.02, 0.01, 0.03, out); // inside the body: tangential velocity, finite
  assert.ok(Number.isFinite(out[0]) && Number.isFinite(out[1]));
  const pr = f.probe(0.8, 0.05, 0);
  assert.ok(pr.inWake && Number.isFinite(pr.speed) && Number.isFinite(pr.p));
  const pr2 = f.probe(-1, 0.6, 0);
  assert.ok(!pr2.inWake && Math.abs(pr2.cp) < 0.05, 'far upstream Cp ' + pr2.cp);
  assert.ok(f.sdf(0.02, 0, 0) < 0 && f.sdf(1, 0, 0) > 0);
});

test('surface fields: sphere Cp, separation, friction, front pressure', async () => {
  const R = 0.15, model = ellipsoid(R, R, 600, [64, 32]), f = await bakeModel(model);
  const res = mkRes({ sepDeg: 82, cpb: -0.4, regime: { flow: 'subsonic', bl: 'transition', wake: 'street' } });
  f.update(res, 0, 1, 1 / 60);
  const sf = surfaceFields(f, model, res, AIR, 0);
  const pos = model.geometry.attributes.position.array, nv = pos.length / 3;
  let stag = -9, dmin = 9, cpEq = 0, nEq = 0, back = 0, nBack = 0, tFront = 0, tMid = 0;
  for (let v = 0; v < nv; v++) {
    const x = pos[3 * v] / R;
    if (x < -0.999) { stag = Math.max(stag, sf.cp[v]); tFront = Math.max(tFront, sf.tau[v]); }
    if (Math.abs(x) < 0.05 && sf.cp[v] < dmin) { dmin = sf.cp[v]; }
    if (x > 0.6) { back += sf.cp[v]; nBack++; }
    if (x > -0.5 && x < -0.2) tMid = Math.max(tMid, sf.tau[v]);
  }
  console.log(`  surface: Cp_stag ${stag.toFixed(3)}  Cp(x~0) ${dmin.toFixed(3)}  mean Cp rear ${(back / nBack).toFixed(3)}  cpRange [${sf.cpRange[0].toFixed(2)}, ${sf.cpRange[1].toFixed(2)}]  frontPa ${sf.frontPa.toFixed(1)}  frontN ${sf.frontN.toFixed(2)}  tau front/mid ${tFront.toFixed(3)}/${tMid.toFixed(3)}`);
  assert.ok(Math.abs(stag - 1) < 0.03);
  assert.ok(Math.abs(back / nBack - (-0.4)) < 0.01, 'separated Cp = cpb');
  assert.ok(Number.isFinite(sf.frontPa) && Number.isFinite(sf.frontN) && sf.cpRange[1] <= 1.0001);
  assert.ok(tMid > 0 && Number.isFinite(tFront));
  // supersonic: Cp0 cap and Newtonian windward
  const res2 = mkRes({ M: 2, q: 0.5 * 1.4 * 101325 * 4, sepDeg: 180, cpb: -0.2 });
  f.update(res2, 0, 3, 1 / 60);
  const s2 = surfaceFields(f, model, res2, AIR, 0);
  assert.ok(s2.cpRange[1] <= 1.6567 + 1e-3 && s2.cpRange[1] > 1.6, 'Cp0(M2) ' + s2.cpRange[1]);
});

test('performance: bake time (M=600, 50k vertices) and sample throughput', async () => {
  const model = ellipsoid(0.15, 0.15, 600, [220, 227]); // ~50k vertices
  const nv = model.geometry.attributes.position.count;
  const f = createFlow({ sliceMs: 1e9, worker: false });
  const t0 = performance.now(); await f.setModel(model, AD); const tBake = performance.now() - t0;
  const res = mkRes({ regime: { flow: 'subsonic', bl: 'turbulent', wake: 'street' }, sepDeg: 100, Re: 2e5 });
  for (let i = 0; i < 300; i++) f.update(res, 4, 2, 1 / 60);
  const r = rng(3), out = new Float64Array(3), N = 2000000;
  const P = new Float64Array(3 * 4096); for (let i = 0; i < P.length; i += 3) { P[i] = -3 + 6 * r(); P[i + 1] = -0.8 + 1.6 * r(); P[i + 2] = -1.2 + 2.4 * r(); }
  for (let i = 0; i < 200000; i++) { const j = 3 * (i & 4095); f.sample(P[j], P[j + 1], P[j + 2], out); }
  const t1 = performance.now(); let acc = 0;
  for (let i = 0; i < N; i++) { const j = 3 * (i & 4095); f.sample(P[j], P[j + 1], P[j + 2], out); acc += out[0]; }
  const dt = performance.now() - t1;
  // near-body worst case: points in the shell around the sphere
  const Q = new Float64Array(3 * 4096); for (let i = 0; i < Q.length; i += 3) { const d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1], l = Math.hypot(...d), rad = 0.17 + 0.2 * r(); Q[i] = d[0] / l * rad; Q[i + 1] = d[1] / l * rad; Q[i + 2] = d[2] / l * rad; }
  const t2 = performance.now(); for (let i = 0; i < 500000; i++) { const j = 3 * (i & 4095); f.sample(Q[j], Q[j + 1], Q[j + 2], out); acc += out[0]; } const dn = performance.now() - t2;
  console.log(`  bake ${tBake.toFixed(0)} ms (M 600, ${nv} vertices);  sample ${(N / dt / 1e3).toFixed(2)} M calls/s (whole tunnel, street wake on);  near-body shell ${(500000 / dn / 1e3).toFixed(2)} M calls/s  [${acc > 0 ? 'ok' : ''}]`);
  assert.ok(tBake < 400, 'bake ' + tBake);
  assert.ok(N / dt / 1e3 >= 1.5, 'throughput ' + (N / dt / 1e3));
});

test('time-sliced main-thread bake (no Worker) matches single-slice bake; newer setModel cancels older', async () => {
  const mA = ellipsoid(0.15, 0.15, 600), mB = ellipsoid(0.3, 0.1, 600);
  const fa = createFlow(); // default: 8 ms slices, Worker unavailable in Node -> sliced fallback
  const t0 = performance.now();
  const p1 = fa.setModel(mB, AD), p2 = fa.setModel(mA, AD); // second call cancels the first
  const [r1, r2] = await Promise.all([p1, p2]);
  const dt = performance.now() - t0;
  const fb = await bakeModel(mA);
  const o1 = new Float64Array(3), o2 = new Float64Array(3);
  let worst = 0;
  for (let i = 0; i < 100; i++) { const x = -0.5 + i * 0.012, y = 0.2 * Math.sin(i), z = 0.1 * Math.cos(i); fa.sample(x, y, z, o1); fb.sample(x, y, z, o2); worst = Math.max(worst, Math.abs(o1[0] - o2[0]), Math.abs(o1[1] - o2[1])); }
  console.log(`  sliced bake finished in ${dt.toFixed(0)} ms, first job cancelled: ${r1 === false}, field difference ${worst.toExponential(1)}`);
  assert.equal(r1, false); assert.equal(r2, true); assert.ok(worst < 1e-12);
  // before the first bake completes sample() keeps working (freestream only)
  const fc = createFlow(); const pend = fc.setModel(mA, AD); fc.sample(0, 0, 0, o1); assert.equal(o1[0], 1); await pend;
});
