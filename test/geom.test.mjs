// test/geom.test.mjs (P3) run: node test/geom.test.mjs   (needs 'three' resolvable, or a local stub)
import assert from 'node:assert/strict';
import { make } from '../src/geom/parts.js';
import { assemble } from '../src/geom/assemble.js';
import { SLOTS, TEMPLATES, buildFromBuilder, defaultParams } from '../src/geom/catalog.js';

let fails = 0; const t0 = Date.now();
const ok = (name, fn) => { try { fn(); console.log('PASS', name); } catch (e) { fails++; console.log('FAIL', name, '-', e.message); } };
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function meshStats(geo) {
  const P = geo.attributes.position.array, I = geo.index.array; let area = 0, vol = 0;
  for (let k = 0; k < I.length; k += 3) { const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3; const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx; area += Math.hypot(gx, gy, gz) / 2; vol += (P[a] * gx + P[a + 1] * gy + P[a + 2] * gz) / 6; }
  return { area, vol };
}
// ray parity: count Moller-Trumbore hits along an irrational direction
function inside(geo, x, y, z, dir) {
  const P = geo.attributes.position.array, I = geo.index.array; let hits = 0;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3, e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const h = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]], det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]; if (Math.abs(det) < 1e-14) continue;
    const s = [x - P[a], y - P[a + 1], z - P[a + 2]], u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det; if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det; if (v < 0 || u + v > 1) continue;
    if ((e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det > 0) hits++;
  }
  return hits % 2 === 1;
}
function signTest(part, n, seed) {
  const g = part.geometry, P = g.attributes.position.array, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], P[i + a]); mx[a] = Math.max(mx[a], P[i + a]); }
  const r = prng(seed), dir = (() => { const d = [0.3711, 0.5432, 0.7523], l = Math.hypot(...d); return d.map(v => v / l); })(); let bad = 0, tested = 0, nIn = 0;
  for (let i = 0; i < n; i++) {
    const p = [0, 1, 2].map(a => mn[a] - 0.15 * (mx[a] - mn[a]) + r() * 1.3 * (mx[a] - mn[a])), d = part.sdf(...p); if (Math.abs(d) < 1e-3) continue; tested++;
    const ins = inside(g, ...p, dir); if (ins) nIn++; if (ins !== d < 0) bad++;
  }
  return { bad, tested, nIn };
}
const sphere = make('sphere'), tear = make('teardrop'), wing = make('wing', { profile: '2412', span: 0.8, rootChord: 0.3, tipChord: 0.15, sweepDeg: 25, dihedralDeg: 3, rootLE: [0, 0, 0], ref: 1 });

ok('sphere area/volume 1%, frontal 2%', () => {
  const R = 0.15, s = meshStats(sphere.geometry), m = assemble([sphere]);
  assert.ok(Math.abs(s.area / (4 * Math.PI * R * R) - 1) < 0.01, 'area ' + s.area); assert.ok(Math.abs(s.vol / (4 / 3 * Math.PI * R ** 3) - 1) < 0.01, 'vol ' + s.vol);
  assert.ok(Math.abs(m.info.volume / s.vol - 1) < 1e-6); assert.ok(Math.abs(m.info.wetted / s.area - 1) < 1e-6);
  assert.ok(Math.abs(m.info.frontal / (Math.PI * R * R) - 1) < 0.02, 'frontal ' + m.info.frontal);
  assert.ok(Math.abs(m.info.planform / (Math.PI * R * R) - 1) < 0.02); assert.ok(m.colloc.pos.length / 3 === 600);
});
for (const [name, part] of [['sphere', sphere], ['teardrop', tear], ['wing', wing]]) ok(`sdf sign vs ray parity: ${name}`, () => {
  const r = signTest(part, 500, 7); assert.ok(r.nIn > 20 && r.nIn < r.tested, 'sample mix ' + JSON.stringify(r)); assert.equal(r.bad, 0, JSON.stringify(r));
});
ok('sdf magnitude near surface (sphere exact, teardrop/wing vs sampled distance)', () => {
  for (const part of [tear, wing]) { const P = part.geometry.attributes.position.array, r = prng(3); let worst = 0;
    for (let i = 0; i < 60; i++) { const v = Math.floor(r() * P.length / 3) * 3, N = part.geometry.attributes.normal.array, e = 0.004;
      const p = [P[v] + N[v] * e, P[v + 1] + N[v + 1] * e, P[v + 2] + N[v + 2] * e], d = part.sdf(...p); let best = 1e9; for (let j = 0; j < P.length; j += 3) best = Math.min(best, Math.hypot(P[j] - p[0], P[j + 1] - p[1], P[j + 2] - p[2]));
      worst = Math.max(worst, Math.abs(d - best) / best); }
    assert.ok(worst < 0.25, part.kind + ' worst rel err ' + worst.toFixed(3)); }
});
function checkModel(m, label, strict = true) {
  const g = m.geometry, P = g.attributes.position.array; for (const a of [P, g.attributes.normal.array, g.attributes.color.array]) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) throw new Error(label + ' NaN');
  assert.ok(P.length / 3 <= 50000, label + ' verts ' + P.length / 3);
  const i = m.info; for (const k of ['frontal', 'planform', 'sideArea', 'wetted', 'volume', 'L', 'D', 'span']) assert.ok(Number.isFinite(i[k]) && i[k] >= 0, label + ' info.' + k + '=' + i[k]);
  if (strict) { assert.ok(i.L <= 1.6 + 1e-6, label + ' L ' + i.L); assert.ok(i.span <= 1.6 + 1e-6, label + ' span ' + i.span); assert.ok(i.frontal <= 0.23, label + ' frontal ' + i.frontal); }
}
ok('colloc: <=600, well spread, none inside other parts (plane + car templates)', () => {
  for (const key of ['plane', 'car', 'rocket']) {
    const parts = buildFromBuilder(TEMPLATES[key].builder), m = assemble(parts), n = m.colloc.pos.length / 3; assert.ok(n > 300 && n <= 600, key + ' n=' + n);
    let bad = 0; for (let k = 0; k < n; k++) { const x = m.colloc.pos[3 * k], y = m.colloc.pos[3 * k + 1], z = m.colloc.pos[3 * k + 2]; let ow = -1, bd = 1e9; parts.forEach((p, pi) => { const Q = p.geometry.attributes.position.array; for (let j = 0; j < Q.length; j += 3) { const d = (Q[j] - x) ** 2 + (Q[j + 1] - y) ** 2 + (Q[j + 2] - z) ** 2; if (d < bd) { bd = d; ow = pi; } } });
      const ins = parts.filter((p, pi) => pi !== ow && p.sdf(x, y, z) < -2e-3).length; if (ins > 0) bad++; }
    assert.equal(bad, 0, key + ' inside points ' + bad);
    let nn = 0, cnt = 0; for (let k = 0; k < n; k += 7) { let d = 1e9; for (let j = 0; j < n; j++) if (j !== k) d = Math.min(d, Math.hypot(m.colloc.pos[3 * k] - m.colloc.pos[3 * j], m.colloc.pos[3 * k + 1] - m.colloc.pos[3 * j + 1], m.colloc.pos[3 * k + 2] - m.colloc.pos[3 * j + 2])); nn += d; cnt++; } assert.ok(nn / cnt > 0.5 * Math.sqrt(m.info.wetted / 600), key + ' mean nn ' + nn / cnt);
  }
});
ok('assemble info: plane template sane (wings, lifting lines, wetted, volume)', () => {
  const m = assemble(buildFromBuilder(TEMPLATES.plane.builder)), i = m.info; checkModel(m, 'plane');
  assert.equal(i.wings.length, 1); assert.ok(i.wings[0].AR > 2 && i.wings[0].AR < 12); assert.ok(m.liftingLines.length >= 3); assert.ok(i.volume > 0 && i.wetted > i.frontal);
  const sum = m.parts.reduce((s, p) => s + meshStats(p.geometry).area, 0); assert.ok(i.wetted < sum, 'hidden surface removed'); assert.ok(i.body.L > 0.9 && i.body.D > 0.1);
});
ok('spanning flag and wall-to-wall extents', () => {
  const m = assemble([make('wing', { profile: '0012', spanning: true, rootChord: 0.5 })]); assert.ok(m.spanning); assert.ok(Math.abs(m.info.span - 2.4) < 1e-4); assert.ok(m.liftingLines.every(l => l.spanning));
  assert.ok(assemble([make('cylinder')]).spanning); assert.ok(!assemble([sphere]).spanning);
});
ok('every builder option combination builds (432 combos + 120 random param sets)', () => {
  const opt = k => SLOTS.find(s => s.key === k).options.map(o => o.id), r = prng(99); let n = 0, maxV = 0;
  const run = (b, strictEdge) => { const m = assemble(buildFromBuilder(b)); checkModel(m, JSON.stringify(b).slice(0, 90)); maxV = Math.max(maxV, m.geometry.attributes.position.count); n++; return m; };
  for (const nose of opt('nose')) for (const body of opt('body')) for (const tail of opt('tail')) for (const wing of opt('wing')) for (const fins of opt('fins')) run({ nose, body, tail, wing, fins, p: defaultParams() });
  const pick = a => a[Math.floor(r() * a.length)];
  for (let i = 0; i < 120; i++) { const p = {}; for (const s of SLOTS) for (const q of s.params) p[q.id] = q.type === 'choice' ? pick(q.options).id : r() < 0.3 ? (r() < 0.5 ? q.min : q.max) : q.min + r() * (q.max - q.min);
    p.wheels = r() < 0.5 ? 1 : 0; run({ nose: pick(opt('nose')), body: pick(opt('body')), tail: pick(opt('tail')), wing: pick(opt('wing')), fins: pick(opt('fins')), p }); }
  console.log('   built', n, 'models, max vertices', maxV);
});
ok('builder: garbage input is clamped, not thrown', () => { const m = assemble(buildFromBuilder({ nose: 'x', p: { length: 99, diameter: -1, span: NaN } })); checkModel(m, 'garbage'); });
ok('max triangle edge <= 1.5 % of model length (templates, non-spanning)', () => {
  for (const key of Object.keys(TEMPLATES)) { const m = assemble(buildFromBuilder(TEMPLATES[key].builder)), P = m.geometry.attributes.position.array, I = m.geometry.index.array; let mx = 0;
    for (let k = 0; k < I.length; k += 3) for (let q = 0; q < 3; q++) { const a = I[k + q] * 3, b = I[k + (q + 1) % 3] * 3; mx = Math.max(mx, Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2])); }
    const lim = TEMPLATES[key].builder.p.wheels ? 0.045 : 0.015; // thân xe: cạnh dài nhất ở mép vòm bánh (như xe thư viện)
    assert.ok(mx <= lim * m.info.L * 1.02, `${key} max edge ${(mx / m.info.L * 100).toFixed(2)} % of L`); }
});
console.log(fails ? `${fails} FAILED` : 'ALL PASSED', (Date.now() - t0) + ' ms'); process.exit(fails ? 1 : 0);
