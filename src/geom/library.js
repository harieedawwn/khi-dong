// src/geom/library.js  (P4)  Thư viện mẫu: 23 mô hình thu nhỏ dựng từ bộ hình học P3 (parts.make).
// Mỗi mục: {id, group, name, note, build() -> parts}. Kích thước viết bằng mét THẬT rồi nhân tỉ lệ s (frame()).
// Quy ước id của chi tiết nâng (để aerodata nối lifting[].partId): cánh chính 'wing', cánh đuôi ngang 'stab',
// đuôi đứng 'fin_v', cánh canh 'fin_0/90/180/270'; xe đua: 'wing_f' (trước), 'wing_r' (sau).
// Vai trò: mũi/thân/đuôi = nose/body/tail, bánh = wheel, cánh quạt = rotor (flow:false), phụ tùng = detail.
import { make } from './parts.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/* ------------------------------------------------------------------ helpers */
// frame: mét thật -> mét mô hình. (ox, oy) dịch gốc thật để mô hình nằm giữa ống; Lreal chỉ để chọn độ mịn lưới.
function frame(s, ox, oy, Lreal, k = 1) { return { s, ref: 0.97 * k * Lreal * s, X: v => (v + ox) * s, Y: v => (v + oy) * s, Z: v => v * s, m: v => v * s }; }
const sample = (x0, x1, n, fn) => Array.from({ length: n + 1 }, (_, i) => { const x = x0 + (x1 - x0) * (0.5 - 0.5 * Math.cos(Math.PI * i / n)); return [x, ...fn(x)]; });
const rev = rows => rows.map(([x, r, yc = 0]) => [x, yc + r, yc - r, 2 * r]); // [x, r, yc] -> [x, top, bot, width]
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// thân tròn/hộp bằng loft: rows [x, đỉnh, đáy, rộng] (mét thật), n = độ vuông của tiết diện (2 = elip)
function solid(F, rows, o = {}) {
  const x0 = rows[0][0], Lr = rows[rows.length - 1][0] - x0, t = x => (x - x0) / Lr, s = F.s;
  return make('loft', {
    ref: F.ref * (o.rk ?? 1), id: o.id, role: o.role || 'body', tone: o.tone ?? 0, toneFn: o.toneFn, n: o.n ?? 2, x0: F.X(x0), length: Lr * s,
    width: rows.map(r => [t(r[0]), r[3] * s]), height: rows.map(r => [t(r[0]), (r[1] - r[2]) * s]), yOffset: rows.map(r => [t(r[0]), F.Y((r[1] + r[2]) / 2)]),
    creases: (o.creases || []).map(t), capStart: o.capStart, capEnd: o.capEnd,
  });
}
const wing = (F, o) => make('wing', { ref: F.ref, id: o.id ?? 'wing', role: o.role, profile: o.profile ?? '0012', tc: o.tc ?? 0.12, span: F.m(o.span), rootChord: F.m(o.cr), tipChord: F.m(o.ct ?? o.cr), sweepDeg: o.sweep ?? 0, dihedralDeg: o.dih ?? 0, incDeg: o.inc ?? 0, rootLE: [F.X(o.x), F.Y(o.y), 0], tone: o.tone ?? 0 });
const stab = (F, o) => wing(F, { id: 'stab', role: 'fin', tc: 0.09, tone: 1, ...o });
const fin = (F, o) => make('fin', { ref: F.ref, id: o.id ?? 'fin_v', profile: o.profile ?? '0012', tc: o.tc ?? 0.09, span: F.m(o.h), rootChord: F.m(o.cr), tipChord: F.m(o.ct), sweepDeg: o.sweep ?? 0, angleDeg: o.ang ?? 0, rootLE: [F.X(o.x), F.Y(o.y ?? 0), 0], tone: o.tone ?? 1 });
const box = (F, o) => make('roundedBox', { ref: F.ref, id: o.id, role: o.role ?? 'detail', size: o.size.map(F.m), center: [F.X(o.c[0]), F.Y(o.c[1]), F.Z(o.c[2])], radius: F.m(o.r ?? 0.02), tone: o.tone ?? 2 });
const wheel = (F, id, x, y, z, R, w) => make('wheel', { ref: F.ref, id, center: [F.X(x), F.Y(y), F.Z(z)], radius: F.m(R), width: F.m(w), spin: { axis: [0, 0, 1], rate: 24, center: [F.X(x), F.Y(y), F.Z(z)] } });
const nacelle = (F, o) => make('nacelle', { ref: F.ref, id: o.id, x0: F.X(o.x), length: F.m(o.len), radius: F.m(o.r), y: F.Y(o.y), z: F.Z(o.z), endRatio: o.end ?? 0.6, tone: o.tone ?? 1 });
const canopy = (F, o) => make('canopy', { ref: F.ref, id: o.id ?? 'canopy', x0: F.X(o.x), length: F.m(o.len), width: F.m(o.w), height: F.m(o.h), y: F.Y(o.y), peak: o.peak ?? 0.4, tone: o.tone ?? 2 });
const sweepOf = (off, span) => Math.atan2(off, span) * R2D; // độ xuôi mép trước từ độ lệch thật

/* ------------------------------------------------------------------ factory: tên lửa */
// tên lửa: các đoạn thân tròn (rows [x, r]) + cánh ổn định; mọi kích thước mét thật.
function rocket(o) {
  const F = frame(o.s, -o.L / 2, 0, o.L), parts = [];
  for (const g of o.segs) {
    if (g.kind === 'nose') parts.push(make('nose', { ref: F.ref, id: g.id, shape: g.shape, x0: F.X(g.x), length: F.m(g.len), radius: F.m(g.r), tone: g.tone ?? 0 }));
    else if (g.kind === 'tail') parts.push(make('tail', { ref: F.ref, id: g.id, shape: 'blunt', boattailDeg: g.deg, x0: F.X(g.x), length: F.m(g.len), radius: F.m(g.r), tone: g.tone ?? 0 }));
    else if (g.kind === 'cyl') parts.push(make('body', { ref: F.ref, id: g.id, x0: F.X(g.x), length: F.m(g.len), radius: F.m(g.r), tone: g.tone ?? 0, toneFn: g.toneFn && ((x, y, z, nx, ny, nz) => g.toneFn(x / F.s - (-o.L / 2), nx)) }));
    else parts.push(solid(F, rev(g.rows), { id: g.id, role: g.role ?? 'tail', tone: g.tone ?? 0, creases: g.creases }));
  }
  const f = o.fins; // {n, x (mép trước gốc), cr, ct, h (cao ngoài thân), r (bán kính thân), off, tone, profile, tc}
  const ang = f.n === 3 ? [0, 120, 240] : [0, 90, 180, 270];
  for (const a of ang) parts.push(make('fin', { ref: F.ref, id: 'fin_' + a, profile: f.profile ?? '0012', tc: f.tc ?? 0.06, span: F.m(f.r + f.h), rootChord: F.m(f.cr), tipChord: F.m(f.ct), sweepDeg: sweepOf(f.off, f.r + f.h), angleDeg: a, rootLE: [F.X(f.x), 0, 0], tone: f.tone ?? 1 }));
  return parts;
}

/* ------------------------------------------------------------------ factory: máy bay */
// plane: thân (rows) + cánh + đuôi + phụ tùng; tất cả mét thật.
function plane(o) {
  const F = frame(o.s, -o.L / 2, o.oy ?? 0, o.L, o.k), parts = [solid(F, o.fuse, { id: 'fuselage', role: 'body', n: o.n ?? 2, toneFn: o.toneFn && ((x, y, z, nx, ny, nz) => o.toneFn(x, y, nx, ny, nz, F)), creases: o.creases })];
  if (o.wing) parts.push(wing(F, o.wing));
  if (o.stab) parts.push(stab(F, o.stab));
  if (o.fin) parts.push(fin(F, o.fin));
  for (const c of o.canopy || []) parts.push(canopy(F, c));
  for (const n of o.nacelles || []) parts.push(nacelle(F, n));
  for (const b of o.boxes || []) parts.push(box(F, b));
  for (const w of o.wheels || []) parts.push(wheel(F, w.id, w.x, w.y, w.z, w.r, w.w));
  for (const r of o.rotors || []) parts.push(make('rotor', { ref: F.ref, id: r.id, center: [F.X(r.c[0]), F.Y(r.c[1]), F.Z(r.c[2])], axis: r.axis, radius: F.m(r.R), hubRadius: F.m(r.hub), blades: r.blades, chord: F.m(r.chord), taper: r.taper ?? 0.7, pitchDeg: r.pitch ?? 8, rate: r.rate, tone: 2, tc: 0.08 }));
  for (const p of o.extra || []) parts.push(typeof p === 'function' ? p(F) : p);
  return parts;
}

/* ------------------------------------------------------------------ factory: ô tô (xe con, xe đua kín) */
function car(o) {
  const F = frame(o.s, -o.L / 2, -o.H / 2, o.L, o.k), parts = [];
  parts.push(solid(F, o.lower, { id: 'body', role: 'body', n: o.n ?? 4, creases: o.lowerCreases }));
  if (o.house) parts.push(solid(F, o.house, { id: 'cabin', role: 'body', n: 3, rk: o.houseRk, toneFn: (x, y, z, nx, ny) => (ny > 0.9 ? 0 : 2) }));
  const w = o.wheels;
  for (const [i, x] of [w.xf, w.xr].entries()) for (const sz of [-1, 1]) parts.push(wheel(F, `wheel_${i ? 'r' : 'f'}${sz < 0 ? 'L' : 'R'}`, x, w.R, sz * w.z, w.R, w.w));
  for (const b of o.boxes || []) parts.push(box(F, b));
  for (const c of o.canopy || []) parts.push(canopy(F, c));
  for (const q of o.extra || []) parts.push(q(F));
  return parts;
}
const mirrorsAt = (x, y, z) => [{ id: 'mirror_L', size: [0.2, 0.11, 0.2], c: [x, y, -z], r: 0.04, tone: 1 }, { id: 'mirror_R', size: [0.2, 0.11, 0.2], c: [x, y, z], r: 0.04, tone: 1 }];

/* ------------------------------------------------------------------ factory: xe tải */
function truck(o) {
  const F = frame(o.s, -o.L / 2, -o.H / 2, o.L, 1), parts = [];
  parts.push(solid(F, o.cab, { id: 'cab', role: 'body', n: 4, creases: [0.04 * 2], toneFn: (x, y, z, nx, ny, nz) => ((nx < -0.45 && ny < 0.6 && y > F.Y(1.5)) || (Math.abs(nz) > 0.6 && y > F.Y(1.9) && x < F.X(1.6)) ? 2 : 0) }));
  parts.push(box(F, { id: 'box', role: 'body', size: [o.box.len, o.box.h, o.box.w], c: [o.box.x + o.box.len / 2, o.box.y + o.box.h / 2, 0], r: 0.1, tone: 0 }));
  parts.push(box(F, { id: 'chassis', size: [o.L - 1.0, 0.28, 1.3], c: [o.L / 2 + 0.3, 0.8, 0], r: 0.04, tone: 2 }));
  if (o.fairing) parts.push(solid(F, o.fairing, { id: 'roof_fairing', role: 'detail', n: 4, tone: 1, rk: 0.7 }));
  for (const [i, ax] of o.axles.entries()) for (const sz of [-1, 1]) for (const zz of ax.z) parts.push(wheel(F, `wheel_${i}_${sz < 0 ? 'L' : 'R'}${zz > 0.9 ? 'o' : 'i'}`, ax.x, o.R, sz * zz, o.R, 0.3));
  parts.push(box(F, { id: 'bumper', size: [0.25, 0.3, 2.3], c: [0.05, 0.62, 0], r: 0.08, tone: 1 }));
  return parts;
}

/* ================================================================== THƯ VIỆN */
export const GROUPS = [
  { id: 'rocket', label: 'Tên lửa' }, { id: 'plane', label: 'Máy bay' }, { id: 'heli', label: 'Trực thăng' }, { id: 'wing', label: 'Cánh' },
  { id: 'race', label: 'Xe đua' }, { id: 'car', label: 'Xe con' }, { id: 'truck', label: 'Xe tải' }, { id: 'shape', label: 'Hình học' },
];

/* ---- tên lửa */
function rocketWater() { // chai PET 2 lít + chóp nón + 4 cánh nhựa; phóng to 2:1
  const bR = 0.0525;
  return rocket({ s: 2, L: 0.505, segs: [
    { kind: 'nose', id: 'cone', shape: 'cone', x: 0, len: 0.15, r: bR, tone: 1 },
    { kind: 'cyl', id: 'bottle', x: 0.15, len: 0.255, r: bR, toneFn: (xr) => (xr > 0.22 && xr < 0.3 ? 1 : 0) },
    { kind: 'rows', id: 'neck', rows: [[0.405, bR], [0.415, 0.0505], [0.43, 0.043], [0.445, 0.027], [0.455, 0.0175], [0.465, 0.0155], [0.49, 0.0155], [0.492, 0.019], [0.505, 0.019]], tone: 0 },
  ], fins: { n: 4, x: 0.335, cr: 0.17, ct: 0.07, h: 0.075, r: bR, off: 0.06, tone: 2, profile: 'plate', tc: 0.02 } });
}
function rocketSounding() { // tên lửa thám không: đầu ogive 3,7 cỡ, 4 cánh, vòi phun
  const R = 0.215;
  return rocket({ s: 0.2, L: 7.3, segs: [
    { kind: 'nose', id: 'ogive', shape: 'ogive', x: 0, len: 1.6, r: R, tone: 1 },
    { kind: 'cyl', id: 'motor', x: 1.6, len: 4.9, r: R, toneFn: (xr) => ((xr > 4.1 && xr < 4.3) || (xr > 2.2 && xr < 2.3) ? 2 : 0) },
    { kind: 'tail', id: 'boattail', x: 6.5, len: 0.45, r: R, deg: 12 },
    { kind: 'rows', id: 'nozzle', rows: [[6.95, 0.1], [7.1, 0.12], [7.25, 0.15], [7.3, 0.155]], tone: 2, role: 'tail' },
  ], fins: { n: 4, x: 5.6, cr: 1.4, ct: 0.4, h: 0.85, r: R, off: 0.9, tone: 1 } });
}
function rocketLauncher() { // tên lửa đẩy hai tầng, chụp tải trọng, mép loe giữa hai tầng
  const s = 1 / 40, ro = rocket({ s, L: 58.5, segs: [
    { kind: 'nose', id: 'fairing_nose', shape: 'ogive', x: 0, len: 8, r: 1.8, tone: 0 },
    { kind: 'cyl', id: 'fairing', x: 8, len: 6, r: 1.8, tone: 1 },
    { kind: 'rows', id: 'adapter', rows: [[14, 1.8], [15.2, 1.5]], role: 'body', tone: 2 },
    { kind: 'cyl', id: 'stage2', x: 15.2, len: 14.8, r: 1.5, toneFn: (xr) => (xr > 21 && xr < 22.2 ? 1 : 0) },
    { kind: 'rows', id: 'interstage', rows: [[30, 1.5], [30.4, 1.55], [33, 2.25]], role: 'body', tone: 2, creases: [30.4] },
    { kind: 'cyl', id: 'stage1', x: 33, len: 21.5, r: 2.25, toneFn: (xr) => (xr > 40 && xr < 41.4 ? 1 : 0) },
    { kind: 'tail', id: 'skirt', x: 54.5, len: 2.5, r: 2.25, deg: 5, tone: 2 },
    { kind: 'rows', id: 'engines', rows: [[57, 1.2], [57.6, 1.5], [58.5, 1.7]], tone: 2 },
  ], fins: { n: 4, x: 52.0, cr: 4.5, ct: 1.5, h: 2.3, r: 2.25, off: 2.2, tone: 1 } });
  return ro;
}
function capsule() { // kiểu Apollo, 1:8; tấm chắn nhiệt cầu lồi hướng vào gió
  const Rc = 4.69, cap = [], N = 12; for (let i = 0; i <= N; i++) { const x = 0.425 * (0.5 - 0.5 * Math.cos(Math.PI * i / N)); cap.push([x, Math.sqrt(Math.max(0, Rc * Rc - (Rc - x) ** 2))]); }
  const rows = [...cap, [0.52, 1.94], [0.65, 1.86], [1.4, 1.38], [2.78, 0.5], [2.9, 0.4], [3.2, 0.38]];
  const F = frame(1 / 8, -1.6, 0, 3.2);
  return [solid(F, rev(rows), { id: 'capsule', role: 'body', creases: [0.65, 2.78], toneFn: (x) => (x < F.X(0.5) ? 2 : 0) })];
}

/* ---- máy bay */
function airliner() { // kiểu A320, 1:30: cánh xuôi gắn thấp, 2 động cơ dưới cánh, đuôi chữ thập thông thường
  const R = 2.07, L = 37.6;
  const fuse = sample(0, L, 46, x => {
    let r, yc = 0;
    if (x < 5.5) { const u = (5.5 - x) / 5.5; r = R * Math.pow(1 - Math.pow(u, 2.3), 1 / 2.3); yc = -0.12 * u; }
    else if (x < 27) r = R;
    else { const u = (x - 27) / (L - 27); r = R * (1 - 0.93 * Math.pow(u, 1.6)); yc = 0.95 * Math.pow(u, 1.8); }
    return [yc + r, yc - r, 2 * r];
  });
  return plane({ s: 1 / 30, L, fuse,
    toneFn: (x, y, nx, ny, nz, F) => ((x > F.X(1.8) && x < F.X(3.9) && ny > 0.3 && nx < 0.3 && y > F.Y(0.5) ? 2 : 0)),
    wing: { x: 13.0, y: -1.15, span: 35.8, cr: 6.3, ct: 1.6, sweep: 27, dih: 5, profile: '2412', tc: 0.12 },
    nacelles: [5.8, -5.8].map((z, i) => ({ id: 'engine_' + (i ? 'L' : 'R'), x: 11.2, len: 4.4, r: 0.95, y: -2.0, z, end: 0.62, tone: 1 })),
    boxes: [5.8, -5.8].map((z, i) => ({ id: 'pylon_' + (i ? 'L' : 'R'), size: [3.2, 0.55, 0.32], c: [13.2, -1.15, z], r: 0.1, tone: 1 })),
    fin: { x: 28.4, y: 1.2, h: 7.0, cr: 6.9, ct: 2.6, sweep: 35, tone: 1 },
    stab: { x: 31.4, y: 0.6, span: 12.4, cr: 3.6, ct: 1.2, sweep: 33, dih: 6 } });
}
function planeFighter() { // kiểu Mirage 2000, 1:12: cánh tam giác, buồng lái, 1 đuôi đứng, 2 cửa hút gió
  const L = 14.4;
  const fuse = sample(0, L, 40, x => {
    let r; if (x < 3.6) r = 0.72 * Math.pow(1 - Math.pow((3.6 - x) / 3.6, 1.8), 1 / 1.8); else if (x < 10.5) r = 0.72; else r = 0.72 - 0.27 * Math.pow((x - 10.5) / 3.9, 1.3);
    return [r, -r, 2 * r];
  });
  return plane({ s: 1 / 12, L, fuse, k: 1.15, toneFn: (x, y, nx, ny, nz, F) => (x > F.X(13.6) ? 2 : 0),
    wing: { x: 5.0, y: -0.15, span: 9.13, cr: 9.2, ct: 1.5, sweep: 58, profile: '0012', tc: 0.05, tone: 1 },
    fin: { x: 9.6, y: 0.4, h: 3.5, cr: 4.0, ct: 1.4, sweep: 45, tc: 0.06, tone: 1 },
    canopy: [{ x: 2.5, len: 2.7, w: 0.85, h: 1.05, y: 0.62, peak: 0.42 }],
    nacelles: [0.98, -0.98].map((z, i) => ({ id: 'intake_' + (i ? 'L' : 'R'), x: 3.0, len: 3.4, r: 0.36, y: -0.1, z, end: 0.7, tone: 1 })) });
}
function planeGlider() { // tàu lượn kiểu LS4, 1:10: cánh dài 15 m, đuôi chữ T
  const L = 6.8;
  const fuse = [[0, 0.02, -0.02, 0], [0.2, 0.3, -0.25, 0.3], [0.7, 0.46, -0.3, 0.58], [1.5, 0.56, -0.3, 0.64], [2.6, 0.4, -0.22, 0.5], [4.0, 0.2, -0.12, 0.26], [5.6, 0.12, -0.06, 0.14], [6.8, 0.1, -0.04, 0.07]];
  return plane({ s: 1 / 10, L, fuse, n: 2.4,
    wing: { x: 1.9, y: 0.2, span: 15.0, cr: 1.05, ct: 0.45, sweep: 2, dih: 2.5, profile: '2412', tc: 0.13 },
    fin: { x: 5.4, y: 0.0, h: 1.3, cr: 1.0, ct: 0.45, sweep: 30, tone: 0 },
    stab: { x: 5.95, y: 1.3, span: 2.6, cr: 0.65, ct: 0.4, sweep: 8, tone: 0 },
    canopy: [{ x: 0.7, len: 1.9, w: 0.5, h: 0.78, y: 0.45, peak: 0.4 }] });
}
function planeProp() { // kiểu Cessna 172, 1:8: cánh cao, mũi có chóp quay, cánh quạt, càng cố định
  const L = 8.0; // từ chóp (x = 0) tới đuôi; thân bắt đầu ở x = 0.45
  const fuse = [[0.45, 0.35, -0.35, 0.7], [0.7, 0.58, -0.5, 0.95], [1.45, 0.75, -0.55, 1.05], [2.05, 1.22, -0.6, 1.18], [3.25, 1.25, -0.65, 1.15], [4.05, 1.12, -0.6, 1.0], [5.45, 0.7, -0.4, 0.55], [7.05, 0.35, -0.15, 0.3], [7.75, 0.3, -0.1, 0.2]];
  const gear = [];
  for (const z of [1.05, -1.05]) { gear.push({ id: 'wheel_m' + (z > 0 ? 'R' : 'L'), x: 2.7, y: -1.5, z, r: 0.19, w: 0.13 }); }
  gear.push({ id: 'wheel_nose', x: 1.5, y: -1.38, z: 0, r: 0.15, w: 0.1 });
  return plane({ s: 1 / 8, L: 8.5, fuse, n: 2.3, oy: 0.1, k: 0.85,
    wing: { x: 1.95, y: 1.12, span: 11.0, cr: 1.63, ct: 1.13, sweep: 2, dih: 1.5, profile: '2412', tc: 0.12 },
    fin: { x: 6.3, y: 0.4, h: 1.55, cr: 1.4, ct: 0.6, sweep: 40, tone: 1 },
    stab: { x: 6.8, y: 0.3, span: 3.4, cr: 0.95, ct: 0.6, sweep: 8 },
    wheels: gear,
    boxes: [{ id: 'leg_R', size: [0.14, 0.95, 0.09], c: [2.55, -1.0, 0.9], tone: 2 }, { id: 'leg_L', size: [0.14, 0.95, 0.09], c: [2.55, -1.0, -0.9], tone: 2 }, { id: 'leg_nose', size: [0.1, 0.85, 0.08], c: [1.5, -0.95, 0], tone: 2 }, { id: 'brace_R', size: [0.12, 0.1, 0.9], c: [2.55, -0.62, 0.45], tone: 2, r: 0.03 }, { id: 'brace_L', size: [0.12, 0.1, 0.9], c: [2.55, -0.62, -0.45], tone: 2, r: 0.03 }],
    extra: [F => solid(F, rev([[-0.02, 0], [0.08, 0.1], [0.22, 0.18], [0.36, 0.215], [0.45, 0.22]].map(([x, r]) => [x, r])), { id: 'spinner', role: 'nose', tone: 1 })],
    rotors: [{ id: 'propeller', c: [-0.03, 0, 0], axis: [1, 0, 0], R: 0.95, hub: 0.08, blades: 2, chord: 0.15, taper: 0.6, pitch: 24, rate: 60 }] });
}

/* ---- trực thăng */
function heli() { // kiểu Bell 206, 1:8: cabin kính, đuôi dài, rotor 4 cánh, rotor đuôi, càng trượt
  const s = 1 / 8, F = frame(s, -4.7, -1.45, 9.5), P = [];
  const cabin = [[0, 1.2, 1.1, 0], [0.12, 1.55, 0.7, 0.7], [0.45, 1.95, 0.55, 1.15], [1.2, 2.15, 0.5, 1.38], [2.4, 2.2, 0.55, 1.42], [3.3, 2.1, 0.7, 1.2], [4.2, 1.85, 1.0, 0.7], [4.8, 1.62, 1.25, 0.34]];
  P.push(solid(F, cabin, { id: 'cabin', role: 'body', n: 2.6, toneFn: (x, y, z, nx, ny) => (x < F.X(2.2) && y > F.Y(1.05) && y < F.Y(2.0) && ny < 0.75 ? 2 : 0) }));
  P.push(solid(F, [[4.1, 1.78, 1.15, 0.6], [5.5, 1.72, 1.3, 0.4], [7.5, 1.7, 1.4, 0.26], [9.3, 1.68, 1.45, 0.2]], { id: 'boom', role: 'tail', n: 2 }));
  P.push(solid(F, [[1.7, 2.3, 2.1, 0.3], [2.1, 2.58, 2.1, 0.95], [3.2, 2.62, 2.1, 1.0], [4.1, 2.3, 2.1, 0.3]], { id: 'cowl', role: 'detail', n: 2.4 }));
  P.push(box(F, { id: 'mast', size: [0.26, 0.55, 0.26], c: [2.5, 2.9, 0], r: 0.06, tone: 1 }));
  P.push(fin(F, { x: 8.4, y: 1.45, h: 1.15, cr: 1.0, ct: 0.5, sweep: 32, tone: 1 }));
  P.push(stab(F, { x: 7.7, y: 1.5, span: 2.3, cr: 0.5, ct: 0.4, sweep: 5 }));
  for (const z of [0.95, -0.95]) {
    const n = z > 0 ? 'R' : 'L';
    P.push(box(F, { id: 'skid_' + n, size: [3.3, 0.1, 0.1], c: [2.1, 0.12, z], r: 0.04 }));
    for (const x of [1.15, 3.05]) P.push(box(F, { id: `strut_${n}${x}`, size: [0.1, 0.55, 0.1], c: [x, 0.42, z], r: 0.03 }));
  }
  for (const x of [1.15, 3.05]) P.push(box(F, { id: 'cross_' + x, size: [0.1, 0.1, 1.9], c: [x, 0.66, 0], r: 0.03 }));
  const R = (id, c, axis, rad, hub, blades, chord, rate) => make('rotor', { ref: F.ref, id, center: [F.X(c[0]), F.Y(c[1]), F.Z(c[2])], axis, radius: F.m(rad), hubRadius: F.m(hub), blades, chord: F.m(chord), taper: 0.8, pitchDeg: 6, rate, tone: 2, tc: 0.08 });
  P.push(R('main_rotor', [2.5, 3.2, 0], [0, 1, 0], 5.1, 0.22, 4, 0.33, 24));
  P.push(R('tail_rotor', [9.0, 1.95, 0.32], [0, 0, 1], 0.85, 0.1, 2, 0.2, 70));
  return P;
}

/* ---- cánh 2D (chạy hết ống, dây cung 0,5 m) */
const spanWing = (profile, tc) => () => [make('wing', { id: 'wing', profile, tc, spanning: true, rootChord: 0.5, tipChord: 0.5, rootLE: [-0.25, 0, 0], ref: 0.5, tone: 0 })];

/* ---- xe đua */
function raceF1() { // 1:4, bánh hở, cánh trước + cánh sau
  const F = frame(0.25, -2.75, -0.56, 5.5), P = [];
  P.push(solid(F, [[0.2, 0.24, 0.14, 0.14], [0.7, 0.33, 0.13, 0.22], [1.2, 0.45, 0.11, 0.4], [1.6, 0.52, 0.1, 0.5], [2.4, 0.7, 0.1, 0.62], [3.2, 0.72, 0.1, 0.95], [3.8, 0.72, 0.1, 1.05], [4.4, 0.62, 0.1, 0.8], [5.1, 0.5, 0.12, 0.4], [5.35, 0.45, 0.2, 0.18]], { id: 'body', role: 'body', n: 3 }));
  P.push(solid(F, [[2.55, 0.8, 0.65, 0.2], [2.8, 1.0, 0.65, 0.3], [3.3, 1.0, 0.65, 0.32], [4.3, 0.72, 0.6, 0.2]], { id: 'airbox', role: 'detail', n: 2.5 }));
  P.push(canopy(F, { x: 1.75, len: 0.7, w: 0.34, h: 0.3, y: 0.78, tone: 2 }));
  for (const [i, x, R, w] of [[0, 1.25, 0.33, 0.3], [1, 4.7, 0.35, 0.405]]) for (const sz of [-1, 1]) {
    const z = sz * (i ? 0.78 : 0.78), n = (i ? 'r' : 'f') + (sz < 0 ? 'L' : 'R');
    P.push(wheel(F, 'wheel_' + n, x, R, z, R, w));
    for (const [k, y] of [[0, R - 0.12], [1, R + 0.1]]) P.push(box(F, { id: `arm_${n}${k}`, size: [0.06, 0.035, 0.62], c: [x, y, sz * 0.5], r: 0.012, tone: 2 }));
  }
  P.push(wing(F, { id: 'wing_f', role: 'wing', x: 0.0, y: 0.12, span: 1.8, cr: 0.3, profile: '0012', tc: 0.1, inc: -8, tone: 1 }));
  for (const sz of [-1, 1]) P.push(box(F, { id: 'endplate_f' + (sz < 0 ? 'L' : 'R'), size: [0.4, 0.22, 0.025], c: [0.15, 0.2, sz * 0.9], r: 0.01, tone: 1 }));
  P.push(wing(F, { id: 'wing_r', role: 'wing', x: 5.0, y: 0.98, span: 0.95, cr: 0.36, profile: '0012', tc: 0.1, inc: -9, tone: 1 }));
  for (const sz of [-1, 1]) P.push(box(F, { id: 'endplate_r' + (sz < 0 ? 'L' : 'R'), size: [0.55, 0.5, 0.025], c: [5.22, 0.85, sz * 0.5], r: 0.01, tone: 1 }));
  P.push(box(F, { id: 'pylon_r', size: [0.2, 0.55, 0.06], c: [5.2, 0.7, 0], r: 0.02, tone: 1 }));
  return P;
}
function raceProto() { // 1:4, thân kín, buồng lái kính, đuôi đứng + cánh sau
  return car({ s: 0.25, L: 4.75, H: 1.2, n: 3.2,
    lower: [[0, 0.42, 0.16, 1.1], [0.15, 0.52, 0.12, 1.55], [0.8, 0.62, 0.1, 1.9], [1.6, 0.7, 0.1, 1.95], [2.2, 0.75, 0.1, 1.9], [3.4, 0.78, 0.1, 1.85], [4.1, 0.7, 0.1, 1.55], [4.6, 0.55, 0.12, 1.0], [4.75, 0.48, 0.2, 0.7]],
    wheels: { xf: 1.0, xr: 3.75, R: 0.35, w: 0.32, z: 0.88 },
    canopy: [{ x: 1.65, len: 1.7, w: 0.95, h: 0.62, y: 0.78, peak: 0.42 }],
    extra: [
      F => fin(F, { x: 3.2, y: 0.7, h: 0.3, cr: 1.5, ct: 0.5, sweep: 55, tone: 1 }),
      F => wing(F, { id: 'wing_r', role: 'wing', x: 4.25, y: 1.0, span: 1.5, cr: 0.5, profile: '0012', tc: 0.1, inc: -8, tone: 1 }),
      F => box(F, { id: 'endplate_rL', size: [0.6, 0.32, 0.03], c: [4.5, 0.98, -0.75], r: 0.01, tone: 1 }),
      F => box(F, { id: 'endplate_rR', size: [0.6, 0.32, 0.03], c: [4.5, 0.98, 0.75], r: 0.01, tone: 1 }),
      F => box(F, { id: 'splitter', size: [0.5, 0.04, 1.5], c: [0.15, 0.14, 0], r: 0.01, tone: 2 })] });
}

/* ---- xe con */
function carSedan() { // 1:4, ba khoang: nắp ca-pô, khoang lái, cốp
  return car({ s: 0.25, L: 4.85, H: 1.5, k: 0.88,
    lower: [[0, 0.7, 0.4, 1.5], [0.1, 0.78, 0.34, 1.7], [0.5, 0.86, 0.3, 1.8], [1.2, 0.9, 0.3, 1.84], [1.7, 0.95, 0.3, 1.84], [2.8, 0.98, 0.3, 1.84], [4.2, 0.99, 0.3, 1.82], [4.6, 0.96, 0.34, 1.74], [4.85, 0.9, 0.42, 1.55]],
    house: [[1.5, 0.97, 0.9, 1.55], [1.95, 1.2, 0.9, 1.52], [2.45, 1.4, 0.9, 1.48], [2.9, 1.45, 0.9, 1.46], [3.4, 1.43, 0.9, 1.44], [3.75, 1.3, 0.9, 1.46], [4.0, 1.02, 0.9, 1.52]],
    wheels: { xf: 1.0, xr: 3.8, R: 0.31, w: 0.2, z: 0.88 }, boxes: mirrorsAt(1.95, 1.04, 0.99) });
}
function carSuv() { // 1:4, cao hơn, mui kéo dài về đuôi thẳng đứng, gầm cao
  return car({ s: 0.25, L: 4.75, H: 1.77, k: 0.9, houseRk: 0.72,
    lower: [[0, 0.78, 0.5, 1.6], [0.1, 0.92, 0.42, 1.8], [0.5, 1.0, 0.38, 1.9], [1.2, 1.05, 0.34, 1.92], [1.8, 1.08, 0.34, 1.92], [3.0, 1.1, 0.34, 1.92], [4.4, 1.1, 0.36, 1.9], [4.65, 1.05, 0.44, 1.84], [4.75, 0.98, 0.5, 1.76]],
    house: [[1.6, 1.08, 1.0, 1.6], [2.0, 1.4, 1.0, 1.62], [2.5, 1.7, 1.0, 1.6], [3.0, 1.76, 1.0, 1.58], [4.0, 1.76, 1.0, 1.58], [4.3, 1.74, 1.0, 1.58], [4.55, 1.52, 1.0, 1.56], [4.7, 1.22, 1.0, 1.5], [4.75, 1.04, 1.0, 1.3]],
    wheels: { xf: 1.05, xr: 3.75, R: 0.37, w: 0.245, z: 0.93 }, boxes: mirrorsAt(2.0, 1.2, 1.03) });
}

/* ---- xe tải (1:7) */
const cabRows = [[0, 2.3, 0.45, 2.3], [0.05, 2.6, 0.4, 2.42], [0.4, 2.98, 0.4, 2.45], [1.9, 3.0, 0.4, 2.45]];
function truckBox() { return truck({ s: 1 / 7, L: 7.6, H: 3.5, R: 0.5, cab: cabRows, box: { x: 2.1, y: 1.15, len: 5.5, h: 2.35, w: 2.45 }, axles: [{ x: 1.0, z: [1.05] }, { x: 6.0, z: [1.05, 0.7] }] }); }
function truckFairing() {
  return truck({ s: 1 / 7, L: 7.6, H: 3.5, R: 0.5, cab: cabRows, box: { x: 2.1, y: 1.15, len: 5.5, h: 2.35, w: 2.45 }, axles: [{ x: 1.0, z: [1.05] }, { x: 6.0, z: [1.05, 0.7] }],
    fairing: [[0.6, 2.99, 2.9, 2.0], [1.2, 3.08, 2.9, 2.3], [1.7, 3.3, 2.9, 2.4], [2.1, 3.5, 2.9, 2.42], [2.2, 3.5, 2.9, 2.42]] });
}

/* ---- hình học */
const shape = (kind, o) => () => [make(kind, { ref: o.ref, ...o.p })];

export const LIBRARY = [
  { id: 'rocket_water', group: 'rocket', name: 'Tên lửa nước', note: 'Mô hình tỉ lệ 2:1 (phóng to), chai PET 2 lít', build: rocketWater },
  { id: 'rocket_sounding', group: 'rocket', name: 'Tên lửa thám không', note: 'Mô hình tỉ lệ 1:5', build: rocketSounding },
  { id: 'rocket_launcher', group: 'rocket', name: 'Tên lửa đẩy hai tầng', note: 'Mô hình tỉ lệ 1:40', build: rocketLauncher },
  { id: 'capsule', group: 'rocket', name: 'Khoang tàu vũ trụ', note: 'Mô hình tỉ lệ 1:8, tấm chắn nhiệt hướng vào gió', build: capsule },
  { id: 'plane_airliner', group: 'plane', name: 'Máy bay chở khách', note: 'Mô hình tỉ lệ 1:30', build: airliner },
  { id: 'plane_fighter', group: 'plane', name: 'Tiêm kích cánh tam giác', note: 'Mô hình tỉ lệ 1:12', build: planeFighter },
  { id: 'plane_glider', group: 'plane', name: 'Tàu lượn', note: 'Mô hình tỉ lệ 1:10', build: planeGlider },
  { id: 'plane_prop', group: 'plane', name: 'Máy bay cánh quạt', note: 'Mô hình tỉ lệ 1:8', build: planeProp },
  { id: 'heli', group: 'heli', name: 'Trực thăng', note: 'Mô hình tỉ lệ 1:8, rotor không tạo nhiễu dòng', build: heli },
  { id: 'wing_0012', group: 'wing', name: 'Cánh đối xứng NACA 0012', note: 'Mặt cắt 2D, dây cung 0,5 m, chạy hết ống', build: spanWing('0012', 0.12) },
  { id: 'wing_2412', group: 'wing', name: 'Cánh khum NACA 2412', note: 'Mặt cắt 2D, dây cung 0,5 m, chạy hết ống', build: spanWing('2412', 0.12) },
  { id: 'wing_wedge', group: 'wing', name: 'Cánh mỏng siêu âm', note: 'Mặt cắt 2D hình thoi, dây cung 0,5 m', build: spanWing('wedge', 0.06) },
  { id: 'race_f1', group: 'race', name: 'Xe đua bánh hở', note: 'Mô hình tỉ lệ 1:4', build: raceF1 },
  { id: 'race_proto', group: 'race', name: 'Xe đua thể thao', note: 'Mô hình tỉ lệ 1:4', build: raceProto },
  { id: 'car_sedan', group: 'car', name: 'Xe con sedan', note: 'Mô hình tỉ lệ 1:4', build: carSedan },
  { id: 'car_suv', group: 'car', name: 'Xe SUV', note: 'Mô hình tỉ lệ 1:4', build: carSuv },
  { id: 'truck_box', group: 'truck', name: 'Xe tải thùng', note: 'Mô hình tỉ lệ 1:7', build: truckBox },
  { id: 'truck_fairing', group: 'truck', name: 'Xe tải có ốp gió', note: 'Mô hình tỉ lệ 1:7, ốp gió trên nóc cabin', build: truckFairing },
  { id: 'sphere', group: 'shape', name: 'Hình cầu', note: 'Đường kính 0,30 m', build: shape('sphere', { ref: 0.3, p: { id: 'sphere', D: 0.3 } }) },
  { id: 'cylinder', group: 'shape', name: 'Hình trụ', note: 'Đường kính 0,12 m, chạy hết ống', build: shape('cylinder', { ref: 0.12, p: { id: 'cylinder', D: 0.12 } }) },
  { id: 'plate', group: 'shape', name: 'Tấm phẳng', note: '0,40 × 0,40 × 0,012 m, đặt vuông góc dòng khí', build: shape('plate', { ref: 0.4, p: { id: 'plate', size: [0.012, 0.4, 0.4] } }) },
  { id: 'rhombus', group: 'shape', name: 'Khối thoi hai nón', note: 'Đường kính 0,30 m, dài 0,52 m', build: shape('rhombus', { ref: 0.52, p: { id: 'rhombus', D: 0.3, length: 0.52 } }) },
  { id: 'teardrop', group: 'shape', name: 'Giọt nước', note: 'Đường kính 0,30 m, dài 1,05 m', build: shape('teardrop', { ref: 1.05, p: { id: 'teardrop', D: 0.3, length: 1.05 } }) },
];
export const byId = id => LIBRARY.find(e => e.id === id) || null;
