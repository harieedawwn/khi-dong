import test from 'node:test';
import assert from 'node:assert/strict';
import { air } from '../src/physics/atmo.js';
import { evaluate, fluct, curve, pitotRatio } from '../src/physics/aero.js';
import { AERO, builderAero } from '../src/physics/aerodata.js';

const PI = Math.PI;
const STD = air({ mode: 'altitude', h: 0 });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} ±${tol}`);
const rel = (a, b, r, msg) => near(a, b, Math.abs(b) * r, msg);

/* ---- info thủ công theo SPEC §5 Model.info ---- */
const wg = (id, span, chord, tc, sweepDeg = 0, spanning = false) => {
  const S = span * chord;
  return { id, S, span, chord, tc, sweepDeg, AR: span * span / S, spanning, wetted: 2.04 * S };
};
const rev = (L, D, o = {}) => ({
  frontal: o.frontal ?? PI / 4 * D * D, planform: o.planform ?? 0.8 * L * D, sideArea: 0.8 * L * D,
  wetted: 0.72 * PI * D * L, volume: o.volume ?? 0.55 * PI / 4 * D * D * L, L, D, span: o.span ?? D,
  bbox: [L, D, D],
  body: { L, D, wetted: o.wet ?? 0.72 * PI * D * L, baseArea: o.base ?? 0, noseArea: o.noseA ?? 0 },
  wings: o.wings || []
});
const noBody = { L: 0, D: 0, wetted: 0, baseArea: 0, noseArea: 0 };
const wingInfo = (chord, tc) => {
  const w = wg('w', 2.4, chord, tc, 0, true);
  return { frontal: tc * chord * 2.4, planform: w.S, sideArea: tc * chord * 2.4, wetted: w.wetted, volume: 0.68 * tc * chord * chord * 2.4,
    L: chord, D: tc * chord, span: 2.4, bbox: [chord, tc * chord, 2.4], body: noBody, wings: [w] };
};
const sphereInfo = { frontal: PI / 4 * 0.09, planform: PI / 4 * 0.09, sideArea: PI / 4 * 0.09, wetted: PI * 0.09, volume: PI * 0.027 / 6, L: 0.3, D: 0.3, span: 0.3, bbox: [0.3, 0.3, 0.3], body: noBody, wings: [] };
const cylInfo = { frontal: 0.12 * 2.4, planform: 0.12 * 2.4, sideArea: 0.288, wetted: PI * 0.12 * 2.4, volume: PI / 4 * 0.0144 * 2.4, L: 0.12, D: 0.12, span: 2.4, bbox: [0.12, 0.12, 2.4], body: noBody, wings: [] };
const plateInfo = { frontal: 0.16, planform: 0.16, sideArea: 0.0048, wetted: 0.33, volume: 0.16 * 0.012, L: 0.4, D: 0.4, span: 0.4, bbox: [0.012, 0.4, 0.4], body: noBody, wings: [] };

const INFOS = {
  rocket_water: rev(0.9, 0.1, { base: PI / 4 * 0.01, wings: [wg('fin_a', 0.1, 0.05, 0.04), wg('fin_b', 0.1, 0.05, 0.04)] }),
  rocket_sounding: rev(1.5, 0.12, { base: 0.006, wings: [wg('fin_a', 0.12, 0.1, 0.04), wg('fin_b', 0.12, 0.1, 0.04)] }),
  rocket_launcher: rev(1.6, 0.14, { base: 0.009, wings: [wg('fin_a', 0.14, 0.12, 0.04)] }),
  capsule: rev(0.35, 0.5, { base: 0.196, noseA: 0.196 }),
  plane_airliner: rev(1.5, 0.15, { frontal: 0.03, planform: 0.4, wings: [wg('wing_main', 1.6, 0.2, 0.12), wg('tail_h', 0.5, 0.1, 0.1)] }),
  plane_fighter: rev(1.5, 0.15, { frontal: 0.025, planform: 0.35, wings: [wg('wing_main', 1.0, 0.3, 0.05, 55)] }),
  plane_glider: rev(1.2, 0.1, { frontal: 0.01, planform: 0.22, wings: [wg('wing_main', 1.6, 0.12, 0.12)] }),
  plane_prop: rev(1.2, 0.18, { frontal: 0.03, planform: 0.28, wings: [wg('wing_main', 1.4, 0.2, 0.12)] }),
  heli: rev(1.2, 0.3, { frontal: 0.07, wings: [wg('rotor', 1.4, 0.06, 0.1)] }),
  wing_0012: wingInfo(0.5, 0.12), wing_2412: wingInfo(0.5, 0.12), wing_wedge: wingInfo(0.5, 0.05),
  race_f1: rev(1.4, 0.35, { frontal: 0.1, base: 0.05 }), race_proto: rev(1.4, 0.35, { frontal: 0.1, base: 0.05 }),
  car_sedan: rev(1.2, 0.45, { frontal: 0.16, base: 0.12 }), car_suv: rev(1.2, 0.5, { frontal: 0.2, base: 0.17 }),
  truck_box: rev(1.2, 0.5, { frontal: 0.2, base: 0.2 }), truck_fairing: rev(1.2, 0.5, { frontal: 0.2, base: 0.2 }),
  sphere: sphereInfo, cylinder: cylInfo, plate: plateInfo,
  rhombus: rev(0.52, 0.3, { base: 0 }), teardrop: rev(1.05, 0.3)
};
const ev = (id, U, alphaDeg = 0, a = STD) => evaluate({ aeroDef: AERO[id], info: INFOS[id], air: a, U, alphaDeg });
const Uat = (id, Re, a = STD) => Re * a.mu / (a.rho * ev(id, 1, 0, a).Lref);

test('khí quyển ISA', () => {
  near(air({ mode: 'altitude', h: 0 }).rho, 1.225, 0.001, 'rho 0');
  near(air({ mode: 'altitude', h: 5000 }).rho, 0.7364, 0.001, 'rho 5km');
  near(air({ mode: 'altitude', h: 11000 }).rho, 0.3639, 0.001, 'rho 11km');
  const a15 = air({ mode: 'custom', T: 288.15, p: 101325 });
  rel(a15.a, 340.3, 0.01, 'a'); rel(a15.mu, 1.789e-5, 0.01, 'mu');
});

test('CD cầu Re 1e4 và 6e5', () => {
  near(ev('sphere', Uat('sphere', 1e4)).CD, 0.41, 0.04, 'sphere 1e4');
  assert.ok(ev('sphere', Uat('sphere', 6e5)).CD < 0.2, 'sphere 6e5');
});
test('CD cầu Re 1e5 = 0.47 ± 0.04', () => near(ev('sphere', Uat('sphere', 1e5)).CD, 0.47, 0.04, 'sphere 1e5'));
test('CD trụ, tấm, giọt nước', () => {
  near(ev('cylinder', Uat('cylinder', 1e4)).CD, 1.15, 0.05, 'cyl 1e4');
  near(ev('plate', 20).CD, 1.17, 0.005, 'plate');
  const t = ev('teardrop', Uat('teardrop', 1e6)).CD;
  assert.ok(t >= 0.04 && t <= 0.07, 'teardrop ' + t);
});

test('tỉ lệ U^2, rho, độ cao', () => {
  rel(ev('plate', 40).FD / ev('plate', 20).FD, 4, 0.01, 'plate 2U');
  rel(ev('sphere', 1.2).FD / ev('sphere', 0.6).FD, 4, 0.05, 'sphere 2U (Re 1e4), SPEC 9.5');
  const a2 = air({ mode: 'custom', T: 288.15, p: 2 * 101325 });
  rel(ev('plate', 20, 0, a2).FD / ev('plate', 20).FD, 2, 1e-6, 'F ~ rho');
  const hi = air({ mode: 'altitude', h: 5000 });
  for (const id of ['plate', 'wing_2412', 'car_sedan', 'truck_box']) assert.ok(ev(id, 20, 3, hi).FD < ev(id, 20, 3).FD, id + ' ở 5 km');
});

test('cánh 0012 và 2412', () => {
  const c = ev('wing_0012', 20, 5).CL; assert.ok(c >= 0.5 && c <= 0.56, 'CL0012(5)=' + c);
  const c0 = ev('wing_2412', 20, 0).CL; assert.ok(c0 >= 0.18 && c0 <= 0.26, 'CL2412(0)=' + c0);
  let pk = -1, pkA = 0, ldA = 0, ld = -1;
  for (let a = 0; a <= 30; a += 0.5) {
    const r = ev('wing_2412', 20, a);
    if (r.CL > pk) { pk = r.CL; pkA = a; }
    if (a <= 20 && r.LD > ld) { ld = r.LD; ldA = a; }
  }
  assert.ok(pkA >= 14 && pkA <= 17, 'đỉnh CL tại ' + pkA);
  assert.ok(ev('wing_2412', 20, pkA + 4).CL < 0.85 * pk, 'CL giảm sau đỉnh');
  assert.ok(ldA >= 3 && ldA <= 8, 'L/D đỉnh tại ' + ldA);
  assert.equal(ev('wing_2412', 20, 20).regime.wake, 'irregular');
  assert.ok(ev('wing_2412', 20, 20).sepDeg < ev('wing_2412', 20, 2).sepDeg - 30);
});

test('nén được: Ackeret, pitot, St', () => {
  const a = STD.a;
  const r = ev('wing_wedge', 2 * a, 5);
  rel(r.CL, 0.2016, 0.01, 'Ackeret'); assert.equal(r.regime.flow, 'supersonic');
  near(r.machAngleDeg, 30, 1e-6); assert.ok(r.CDw > 0);
  rel(r.p0 / STD.p, 5.64, 0.01, 'pitot'); rel(pitotRatio(2), 5.64, 0.01);
  near(ev('cylinder', Uat('cylinder', 1e4)).St, 0.198, 0.01, 'St');
  assert.ok(Math.abs(fluct(ev('cylinder', Uat('cylinder', 1e4)), PI / 2).dCL) > 0.3);
});

test('thứ tự CD ở 20 m/s, alpha 0', () => {
  const cd = (id) => ev(id, 20).CD;
  assert.ok(cd('teardrop') < cd('sphere'), `teardrop ${cd('teardrop')} < sphere ${cd('sphere')}`);
  assert.ok(cd('sphere') < cd('cylinder'), 'sphere < cylinder');
  assert.ok(cd('truck_fairing') < cd('truck_box'), 'truck');
  assert.ok(cd('car_sedan') < cd('car_suv'), 'car');
});

test('CD trụ < tấm ở 20 m/s', () => assert.ok(ev('cylinder', 20).CD < ev('plate', 20).CD, `cylinder ${ev('cylinder', 20).CD} < plate ${ev('plate', 20).CD}`));

test('lực đẩy nổi, U = 0, builder', () => {
  const r = ev('sphere', 20);
  rel(r.buoyancy, STD.rho * 9.81 * PI * 0.027 / 6, 1e-9, 'buoyancy');
  for (const id of Object.keys(AERO)) {
    const z = ev(id, 0, 5);
    for (const [k, v] of Object.entries(z)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${id}.${k} U=0`);
    assert.equal(z.FD, 0); assert.equal(z.LD, null);
  }
  const bi = rev(1.0, 0.1, { base: 0.002, wings: [wg('wing_1', 0.4, 0.1, 0.12), wg('fin_1', 0.1, 0.05, 0.04)] });
  const def = builderAero({ nose: 'cone', body: 'round', tail: 'blunt', wing: 'straight', fins: 'cross', p: { noseLen: 0.2, diameter: 0.1, profile: '2412' } }, bi);
  const e1 = evaluate({ aeroDef: def, info: bi, air: STD, U: 30, alphaDeg: 4 });
  assert.ok(e1.CD > 0 && e1.CL > 0 && Number.isFinite(e1.FD));
  assert.equal(curve(AERO.sphere, sphereInfo, STD, 0, 40, 10).length, 10);
});

test('bảng thư viện ở 20 m/s', () => {
  const rows = Object.keys(INFOS).map((id) => {
    const r = ev(id, 20);
    return { id, CD: +r.CD.toFixed(3), CL: +r.CL.toFixed(3), FD: +r.FD.toFixed(2), FL: +r.FL.toFixed(2), Re: Math.round(r.Re),
      regime: `${r.regime.flow}/${r.regime.bl}/${r.regime.wake}` };
  });
  console.table(rows);
  assert.equal(rows.length, 23);
});
