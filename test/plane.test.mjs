// test/plane.test.mjs — mid-plane lattice-Boltzmann solver (CPU reference), section tables, new result fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLBM, rasterSdf, sheddingOf } from '../src/flow/lbm.js';
import { createFlow } from '../src/flow/flowfield.js';
import { shockJump } from '../src/flow/plane.js';
import { naca0012, naca2412, NACA0012, NACA2412, HIGH } from '../src/physics/sections.js';
import * as aero from '../src/physics/aero.js';
import { AERO } from '../src/physics/aerodata.js';
import { air as mkAir } from '../src/physics/atmo.js';
import { LIBRARY } from '../src/geom/library.js';
import { assemble } from '../src/geom/assemble.js';

const build = (id) => assemble(LIBRARY.find((e) => e.id === id).build());
const AIR = mkAir({ mode: 'altitude', h: 0 });

test('empty channel conserves mass within 0.5 % over 2000 steps (uniform and disturbed start)', () => {
  for (const kick of [0, 0.02]) {
    const L = createLBM(128, 48);
    L.ufx.fill(0.1); L.params.tau = 0.53; L.init(kick);
    const m0 = L.mass();
    for (let s = 0; s < 2000; s++) L.step();
    const dm = Math.abs(L.mass() / m0 - 1);
    console.log(`  kick ${kick}: mass drift ${(dm * 100).toFixed(4)} %`);
    assert.ok(L.finite()); assert.ok(dm < 0.005, 'mass drift ' + dm);
  }
});

test('cylinder at solver Re 200: Strouhal number 0.19 +/- 0.02', () => {
  const nx = 288, ny = 144, D = 24, U = 0.12, R = D / 2, cx = 72, cy = ny / 2 + 0.3;
  const L = createLBM(nx, ny);
  rasterSdf(L, (x, y) => Math.hypot(x - cx, y - cy) - R, 0, 0, 1, 0);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i + 0.5 - cx, y = j + 0.5 - cy, r2 = Math.max(x * x + y * y, R * R), q = j * nx + i;
    L.ufx[q] = U * (1 - R * R * (x * x - y * y) / (r2 * r2)); L.ufy[q] = U * (-2 * R * R * x * y / (r2 * r2));
  }
  L.params.tau = 0.5 + 3 * U * D / 200; L.init(0.02 * U);
  const sig = [], N = 16000, p = Math.round(cy) * nx + Math.round(cx + 3 * D);
  for (let s = 0; s < N; s++) { L.step(); if (s > N / 2 && s % 4 === 0) sig.push(L.uy[p]); }
  const sh = sheddingOf(Float32Array.from(sig), 4), St = sh.freq * D / U;
  console.log(`  St ${St.toFixed(3)}, v' rms ${(sh.rms / U).toFixed(2)} U, ${sh.cycles} cycles`);
  assert.ok(L.finite()); assert.ok(sh.cycles >= 5); assert.ok(Math.abs(St - 0.19) <= 0.02, 'St ' + St);
});

async function runPlane(id, U, alphaDeg, secs) {
  const model = build(id), res = aero.evaluate({ aeroDef: AERO[id], info: model.info, air: AIR, U, alphaDeg });
  const flow = createFlow({ worker: false, sliceMs: 1e9, planeGovernor: false });
  assert.equal(await flow.setModel(model, AERO[id]), true);
  const Uvis = Math.min(4, 0.55 * Math.pow(U, 0.45)), o = [0, 0, 0], sig = [], b = flow.surfaceData().pb.bbox;
  for (let f = 0; f < secs * 60; f++) {
    flow.update(res, alphaDeg, Uvis * flow.visScale(), 1 / 60);
    if (f > secs * 30) { flow.sample(b.x1 + 1.2 * (b.y1 - b.y0), 0.5 * (b.y0 + b.y1), 0, o); sig.push(o[1] / (Uvis * flow.plane.visScale())); }
  }
  return { flow, res, sh: sheddingOf(Float32Array.from(sig), 1 / 60), Uvis };
}

test('teardrop: attached flow, no shedding; cylinder model: shedding emerges', async () => {
  const t = await runPlane('teardrop', 20, 0, 14);
  console.log(`  teardrop wake '${t.res.regime.wake}', v' rms ${t.sh.rms.toFixed(4)} U, solver ${JSON.stringify(t.flow.plane.stats().backend)}`);
  assert.equal(t.res.regime.wake, 'none'); assert.ok(t.sh.rms < 0.02, 'teardrop wake rms ' + t.sh.rms);
  const c = await runPlane('cylinder', 10, 0, 14);
  console.log(`  cylinder v' rms ${c.sh.rms.toFixed(3)} U`);
  assert.ok(c.sh.rms > 0.15, 'cylinder wake rms ' + c.sh.rms);
});

test('NACA 0012 lookup reproduces its source points; NACA 2412 reproduces Abbott & von Doenhoff at Re 3.1e6', () => {
  NACA0012.re.forEach((Re, k) => NACA0012.a.forEach((a, i) => {
    const r = naca0012(a, Re);
    assert.ok(Math.abs(r.cl - NACA0012.cl[k][i]) < 1e-9 && Math.abs(r.cd - NACA0012.cd[k][i]) < 1e-9, `0012 Re ${Re} alpha ${a}`);
    assert.ok(Math.abs(naca0012(-a, Re).cl + r.cl) < 1e-12);
  }));
  HIGH.a.forEach((a, i) => { const r = naca0012(a, 5e5); assert.ok(Math.abs(r.cl - HIGH.cl[i]) < 1e-9 && Math.abs(r.cd - HIGH.cd[i]) < 1e-9); });
  NACA2412.a.forEach((a, i) => { const r = naca2412(a, 3.1e6); assert.ok(Math.abs(r.cl - NACA2412.cl[i]) < 1e-9 && Math.abs(r.cd - NACA2412.cd[i]) < 1e-9, '2412 alpha ' + a); });
  // between Reynolds numbers the value lies between the neighbouring tables
  const m = naca0012(12, 3.3e5).cl; assert.ok(m > 0.1533 && m < 1.039);
});

test('wing_2412: lift at 0 deg, L/D peak 4-8 deg, stall near 16 deg with a shedding frequency on the projected height', () => {
  const model = build('wing_2412'), ev = (a) => aero.evaluate({ aeroDef: AERO.wing_2412, info: model.info, air: AIR, U: 20, alphaDeg: a });
  assert.ok(ev(0).CL > 0.15);
  let best = 0, bestA = 0, clmax = 0, aMax = 0;
  for (let a = 0; a <= 25; a += 0.5) { const r = ev(a); if (r.LD > best) { best = r.LD; bestA = a; } if (r.CL > clmax) { clmax = r.CL; aMax = a; } }
  console.log(`  L/D max ${best.toFixed(1)} at ${bestA} deg, CLmax ${clmax.toFixed(2)} at ${aMax} deg`);
  assert.ok(bestA >= 4 && bestA <= 8); assert.ok(aMax >= 14 && aMax <= 17); assert.ok(clmax > 1.3 && clmax < 1.65);
  const pre = ev(10), post = ev(20);
  assert.equal(pre.stalled, false); assert.equal(pre.regime.wake, 'none'); assert.equal(pre.fShed, 0);
  assert.equal(post.stalled, true); assert.ok(post.CL < 0.8 * clmax);
  const h = 0.5 * Math.sin(20 * Math.PI / 180) + 0.06 * Math.cos(20 * Math.PI / 180);
  assert.ok(Math.abs(post.Dshed - h) < 0.01); assert.ok(Math.abs(post.fShed - 0.2 * 20 / h) < 1.5);
});

test('new result fields: stagnation pressure, drag crisis flag, plate F proportional to v^2', () => {
  const sph = build('sphere'), ev = (U) => aero.evaluate({ aeroDef: AERO.sphere, info: sph.info, air: AIR, U, alphaDeg: 0 });
  const r20 = ev(20);
  assert.ok(Math.abs(r20.stagPa - r20.q) / r20.q < 0.01 && r20.stagPa > 0);
  assert.equal(ev(5).dragCrisis, false); assert.equal(ev(14).dragCrisis, true); assert.equal(ev(30).postCritical, true);
  const pl = build('plate');
  for (const U of [2, 5, 10, 20, 40]) {
    const a = aero.evaluate({ aeroDef: AERO.plate, info: pl.info, air: AIR, U, alphaDeg: 0 }), b = aero.evaluate({ aeroDef: AERO.plate, info: pl.info, air: AIR, U: 2 * U, alphaDeg: 0 });
    assert.ok(Math.abs(b.FD / a.FD - 4) < 0.01, 'plate ratio at ' + U);
  }
  const inc = aero.evaluate({ aeroDef: AERO.plate, info: pl.info, air: AIR, U: 20, alphaDeg: 30 });
  assert.ok(inc.Dshed < 0.4 && inc.Dshed > 0.3 && inc.fShed > 0);
});

test('shock: nothing upstream, Rankine-Hugoniot jump right behind it', () => {
  const M = 1.5, mu = Math.asin(1 / M), th = mu + 0.2;
  const SH = { type: 0, planar: false, ax: -0.5, ay: 0, az: 0, sinT: Math.sin(th), cosT: Math.cos(th), xv: 0, Rc: 1, tanMu: 1, cot2: 1, Rn: 0.05, far: 1e9 };
  const j = [0, 0, 0];
  assert.equal(shockJump(SH, M, -0.6, 0.2, 0, j), 0); assert.equal(j[0], 0); assert.equal(j[1], 0);
  const y = 0.3, xs = -0.5 + y * Math.cos(th) / Math.sin(th);
  shockJump(SH, M, xs + 1e-6, y, 0, j);
  const Mn = M * Math.sin(th), r = 2.4 * Mn * Mn / (0.4 * Mn * Mn + 2);
  const un = (1 + j[0]) * Math.sin(th) - j[1] * Math.cos(th), ut = (1 + j[0]) * Math.cos(th) + j[1] * Math.sin(th);
  assert.ok(Math.abs(un - Math.sin(th) / r) < 2e-3, 'normal velocity / density ratio'); assert.ok(Math.abs(ut - Math.cos(th)) < 2e-3, 'tangential velocity kept');
  assert.ok(j[1] > 0, 'flow turns away from the axis');
});
