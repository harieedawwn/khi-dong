// src/geom/library.js  (P4)  Thư viện mẫu: 23 mô hình thu nhỏ dựng từ bộ hình học P3 (parts.make).
// Mỗi mục: {id, group, name, note, build() -> parts}. Kích thước viết bằng mét THẬT rồi nhân tỉ lệ s (frame()).
// Quy ước id của chi tiết nâng (để aerodata nối lifting[].partId): cánh chính 'wing', cánh đuôi ngang 'stab',
// đuôi đứng 'fin_v', cánh canh 'fin_0/90/180/270'; xe đua: 'wing_f' (trước), 'wing_r' (sau).
// Vai trò: mũi/thân/đuôi = nose/body/tail, bánh = wheel, cánh quạt = rotor (flow:false), phụ tùng = detail.
import { make, profiles } from './parts.js';
import { frame, curve, panel, tube, strut, wheel, blob, box, carHull, archTone, sstep } from './kit.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/* ------------------------------------------------------------------ helpers */
// frame: mét thật -> mét mô hình. (ox, oy) dịch gốc thật để mô hình nằm giữa ống; Lreal chỉ để chọn độ mịn lưới.
// (frame, wheel, box: xem kit.js)
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
const wing = (F, o) => make('wing', { ref: F.ref * (o.e ?? 1.5), id: o.id ?? 'wing', role: o.role, profile: o.profile ?? '0012', tc: o.tc ?? 0.12, span: F.m(o.span), rootChord: F.m(o.cr), tipChord: F.m(o.ct ?? o.cr), sweepDeg: o.sweep ?? 0, dihedralDeg: o.dih ?? 0, incDeg: o.inc ?? 0, rootLE: [F.X(o.x), F.Y(o.y), 0], tone: o.tone ?? 0 });
const stab = (F, o) => wing(F, { id: 'stab', role: 'fin', tc: 0.09, tone: 1, ...o });
const fin = (F, o) => make('fin', { ref: F.ref * (o.e ?? 1.5), id: o.id ?? 'fin_v', profile: o.profile ?? '0012', tc: o.tc ?? 0.09, span: F.m(o.h), rootChord: F.m(o.cr), tipChord: F.m(o.ct), sweepDeg: o.sweep ?? 0, angleDeg: o.ang ?? 0, rootLE: [F.X(o.x), F.Y(o.y ?? 0), 0], tone: o.tone ?? 1 });
const nacelle = (F, o) => make('nacelle', { ref: F.ref, id: o.id, x0: F.X(o.x), length: F.m(o.len), radius: F.m(o.r), y: F.Y(o.y), z: F.Z(o.z), endRatio: o.end ?? 0.6, tone: o.tone ?? 1 });
const canopy = (F, o) => make('canopy', { ref: F.ref, id: o.id ?? 'canopy', x0: F.X(o.x), length: F.m(o.len), width: F.m(o.w), height: F.m(o.h), y: F.Y(o.y), peak: o.peak ?? 0.4, tone: o.tone ?? 2 });
const sweepOf = (off, span) => Math.atan2(off, span) * R2D; // độ xuôi mép trước từ độ lệch thật

/* ------------------------------------------------------------------ chi tiết dùng chung */
// khối tròn xoay quanh trục song song x (động cơ, vòi phun, cửa hút gió): pts [[rho, a]] mét thật (a từ x về phía +x), sil = nửa bao ngoài cho sdf
function lathe(F, o) {
  const c = [F.X(o.x), F.Y(o.y ?? 0), F.Z(o.z ?? 0)], s = F.s, k = o.k ?? 1, sc = ([r, a]) => [r * k * s, a * k * s];
  return make('revolve', { id: o.id, role: o.role ?? 'detail', ref: F.ref, center: c, axis: [1, 0, 0], tone: o.tone ?? 1, chains: [{ pts: o.pts.map(sc), tone: o.tone ?? 1 }], silhouette: (o.sil || o.pts).map(sc), flow: o.flow,
    toneFn: o.toneFn && ((x, y, z, nx, ny, nz) => o.toneFn(Math.hypot(y - c[1], z - c[2]) / (s * k), (x - c[0]) / (s * k), nx, ny, nz)) });
}
// động cơ phản lực cánh quạt: cửa hút gió tối, quạt, vỏ, ống xả
const FAN_PTS = [[0, 0.78], [0.16, 0.52], [0.78, 0.5], [0.8, 0.02], [0.9, -0.04], [0.98, 0.2], [1, 0.9], [0.96, 2.3], [0.82, 3.5], [0.7, 3.95], [0.6, 3.95], [0.48, 3.7], [0.4, 4.15], [0.18, 4.6], [0, 4.75]];
const FAN_SIL = [[0, -0.04], [0.9, -0.04], [0.98, 0.2], [1, 0.9], [0.96, 2.3], [0.82, 3.5], [0.7, 3.95], [0.4, 4.15], [0.18, 4.6], [0, 4.75]];
const turbofan = (F, o) => lathe(F, { ...o, pts: FAN_PTS, sil: FAN_SIL, tone: o.tone ?? 0, toneFn: (r, a) => ((a < 0.56 && r < 0.81) || (a > 3.6 && r < 0.62 && a < 4.2) ? 2 : (r > 0.6 && a < 0.3 ? 1 : (o.tone ?? 0))) });
// vòi phun hình chuông (mũi nhọn quay về +x): bên trong tối
function bellNozzle(F, o) { // x = mặt gắn, len, r0 = bán kính chân, r1 = bán kính miệng
  const L = o.len, r0 = o.r0, r1 = o.r1, w = Math.max(0.02 * r1, 0.012 * L), pts = [[0, 0.02 * L], [r0, 0.02 * L], [r0 * 0.86, 0.22 * L], [r0 * 0.78, 0.42 * L], [r1 * 0.78, 0.7 * L], [r1, L], [r1 - w, L], [r1 * 0.74, 0.74 * L], [r0 * 0.6, 0.5 * L], [0.1 * r0, 0.36 * L], [0, 0.34 * L]];
  const sil = [[0, 0.02 * L], [r0, 0.02 * L], [r0 * 0.86, 0.22 * L], [r0 * 0.78, 0.42 * L], [r1 * 0.78, 0.7 * L], [r1, L], [0, L]];
  return lathe(F, { id: o.id, x: o.x, y: o.y ?? 0, z: o.z ?? 0, pts, sil, tone: o.tone ?? 6, role: o.role ?? 'tail', toneFn: (r, a, nx) => (nx > 0.12 && a > 0.3 * L ? 2 : (o.tone ?? 6)) });
}

/* ------------------------------------------------------------------ factory: tên lửa */
// tên lửa: các đoạn thân tròn (rows [x, r]) + cánh ổn định; mọi kích thước mét thật.
function rocket(o) {
  const F = frame(o.s, -o.L / 2, 0, o.L), parts = [], rows = [], cuts = [], bells = [];
  const push = (x, r) => { if (!rows.length || x > rows[rows.length - 1][0] + 1e-9) rows.push([x, r]); };
  for (const g of o.segs) {
    if (g.kind === 'bell') { bells.push(g); continue; }
    if (rows.length) cuts.push(g.x);
    if (g.kind === 'nose') { const f = profiles.nose(g.shape, g.len, g.r); for (let i = 0; i <= 24; i++) { const t = (i / 24) ** 1.5; push(g.x + t * g.len, g.r * f(t)); } }
    else if (g.kind === 'cyl') { push(g.x, g.r); push(g.x + g.len, g.r); }
    else if (g.kind === 'tail') { const e = Math.min(1, Math.max(0.25, 1 - g.len * Math.tan(g.deg * D2R) / g.r)); push(g.x, g.r); push(g.x + g.len, g.r * e); }
    else for (const [x, r] of g.rows) push(x, r);
  }
  const seg = xr => { let k = o.segs[0]; for (const g of o.segs) if (g.kind !== 'bell' && g.x <= xr + 1e-6) k = g; return k; };
  // một thân kín duy nhất (mũi + các đoạn): lưới kín nước, sdf tròn xoay
  parts.push(solid(F, rev(rows), { id: 'body', role: 'body', creases: cuts, toneFn: (x, y, z, nx) => { const xr = x / F.s + o.L / 2, g = seg(xr); return g.toneFn ? g.toneFn(xr, nx) : (g.tone ?? 0); } }));
  for (const g of bells) parts.push(bellNozzle(F, { id: g.id, x: g.x, y: g.y ?? 0, z: g.z ?? 0, len: g.len, r0: g.r0, r1: g.r1, tone: g.tone }));
  const f = o.fins; // {n, x (mép trước gốc), cr, ct, h (cao ngoài thân), r (bán kính thân), off, tone, profile, tc}
  const ang = f.n === 3 ? [0, 120, 240] : [0, 90, 180, 270];
  for (const a of ang) parts.push(make('fin', { ref: F.ref * (f.e ?? 1.8), id: 'fin_' + a, profile: f.profile ?? '0012', tc: f.tc ?? 0.07, span: F.m(f.r + f.h), rootChord: F.m(f.cr), tipChord: F.m(f.ct), sweepDeg: sweepOf(f.off, f.r + f.h), angleDeg: a, rootLE: [F.X(f.x), 0, 0], tone: f.tone ?? 1 }));
  parts.palette = o.palette; return parts;
}

/* ------------------------------------------------------------------ factory: máy bay */
// plane: thân (rows) + cánh + đuôi + phụ tùng; tất cả mét thật. o.glass(F, fus) trả về các mảnh kính phủ thân.
function plane(o) {
  const F = frame(o.s, -o.L / 2, o.oy ?? 0, o.L, o.k), fus = solid(F, o.fuse, { id: 'fuselage', role: 'body', n: o.n ?? 2, toneFn: o.toneFn && ((x, y, z, nx, ny, nz) => o.toneFn(x, y, nx, ny, nz, F)), creases: o.creases }), parts = [fus];
  if (o.wing) parts.push(wing(F, o.wing));
  if (o.stab) parts.push(stab(F, o.stab));
  if (o.fin) parts.push(fin(F, o.fin));
  for (const c of o.canopy || []) parts.push(canopy(F, c));
  for (const n of o.nacelles || []) parts.push(nacelle(F, n));
  for (const n of o.fans || []) parts.push(turbofan(F, n));
  for (const n of o.lathes || []) parts.push(lathe(F, n));
  for (const b of o.boxes || []) parts.push(box(F, b));
  for (const w of o.wheels || []) parts.push(wheel(F, w.id, w.x, w.y, w.z, w.r, w.w, w.o));
  for (const r of o.rotors || []) parts.push(make('rotor', { ref: F.ref, id: r.id, center: [F.X(r.c[0]), F.Y(r.c[1]), F.Z(r.c[2])], axis: r.axis, radius: F.m(r.R), hubRadius: F.m(r.hub), blades: r.blades, chord: F.m(r.chord), taper: r.taper ?? 0.7, pitchDeg: r.pitch ?? 8, rate: r.rate, tone: 2, tc: 0.08 }));
  for (const p of o.extra || []) parts.push(typeof p === 'function' ? p(F) : p);
  if (o.glass) for (const g of o.glass(F, fus)) parts.push(g);
  parts.palette = o.palette; return parts;
}
const G = (F, on, dir, corners, o = {}) => panel(F, on, { dir, corners, ...o });
const sq = (x, y, w, h) => [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]];
const row = (x0, x1, n) => Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * i) / (n - 1));

/* ------------------------------------------------------------------ THƯ VIỆN: tên lửa, máy bay, trực thăng */

export const GROUPS = [
  { id: 'rocket', label: 'Tên lửa' }, { id: 'plane', label: 'Máy bay' }, { id: 'heli', label: 'Trực thăng' }, { id: 'wing', label: 'Cánh' },
  { id: 'race', label: 'Xe đua' }, { id: 'car', label: 'Xe con' }, { id: 'truck', label: 'Xe tải' }, { id: 'shape', label: 'Hình học' },
];

/* ---- tên lửa */
function rocketWater() { // chai PET 2 lít + chóp nón + 4 cánh nhựa biên dạng cánh; phóng to 2:1
  const bR = 0.0525;
  return rocket({ s: 2, L: 0.505, palette: { 0: 0x9CC3D8, 1: 0xE9E7E1, 7: 0xD65A2B }, segs: [
    { kind: 'nose', id: 'cone', shape: 'cone', x: 0, len: 0.15, r: bR, tone: 7 },
    { kind: 'cyl', id: 'bottle', x: 0.15, len: 0.255, r: bR, toneFn: (xr) => (xr > 0.22 && xr < 0.3 ? 1 : 0) },
    { kind: 'rows', id: 'neck', rows: [[0.405, bR], [0.415, 0.0505], [0.43, 0.043], [0.445, 0.027], [0.455, 0.0175], [0.465, 0.0155], [0.49, 0.0155], [0.492, 0.019], [0.505, 0.019]], tone: 0 },
  ], fins: { n: 4, x: 0.335, cr: 0.17, ct: 0.07, h: 0.075, r: bR, off: 0.06, tone: 7, profile: '0012', tc: 0.06 } });
}
function rocketSounding() { // tên lửa thám không: đầu ogive 3,7 cỡ, 4 cánh, vòi phun hình chuông
  const R = 0.215;
  return rocket({ s: 0.2, L: 7.3, palette: { 0: 0xE9E7E1, 1: 0x3A3F46, 7: 0xB3322E }, segs: [
    { kind: 'nose', id: 'ogive', shape: 'ogive', x: 0, len: 1.6, r: R, tone: 7 },
    { kind: 'cyl', id: 'motor', x: 1.6, len: 4.9, r: R, toneFn: (xr) => ((xr > 4.1 && xr < 4.3) || (xr > 2.2 && xr < 2.3) ? 2 : 0) },
    { kind: 'tail', id: 'boattail', x: 6.5, len: 0.45, r: R, deg: 12 },
    { kind: 'bell', id: 'nozzle', x: 6.93, len: 0.42, r0: 0.118, r1: 0.19, tone: 6 },
  ], fins: { n: 4, x: 5.6, cr: 1.4, ct: 0.4, h: 0.85, r: R, off: 0.9, tone: 1 } });
}
function rocketLauncher() { // tên lửa đẩy hai tầng, chụp tải trọng, mép loe giữa hai tầng, ba vòi phun
  return rocket({ s: 1 / 40, L: 58.5, palette: { 0: 0xEDECE8, 1: 0x8D939A, 7: 0x2A2E34 }, segs: [
    { kind: 'nose', id: 'fairing_nose', shape: 'ogive', x: 0, len: 8, r: 1.8, tone: 0 },
    { kind: 'cyl', id: 'fairing', x: 8, len: 6, r: 1.8, tone: 0 },
    { kind: 'rows', id: 'adapter', rows: [[14, 1.8], [15.2, 1.5]], role: 'body', tone: 2 },
    { kind: 'cyl', id: 'stage2', x: 15.2, len: 14.8, r: 1.5, toneFn: (xr) => (xr > 21 && xr < 22.2 ? 1 : 0) },
    { kind: 'rows', id: 'interstage', rows: [[30, 1.5], [30.4, 1.55], [33, 2.25]], role: 'body', tone: 2, creases: [30.4] },
    { kind: 'cyl', id: 'stage1', x: 33, len: 21.5, r: 2.25, toneFn: (xr) => (xr > 40 && xr < 41.4 ? 1 : 0) },
    { kind: 'tail', id: 'skirt', x: 54.5, len: 2.5, r: 2.25, deg: 5, tone: 2 },
    ...[[0.95, 0], [-0.5, 0.85], [-0.5, -0.85]].map(([y, z], i) => ({ kind: 'bell', id: 'engine_' + i, x: 56.9, y, z, len: 1.9, r0: 0.5, r1: 0.82, tone: 6 })),
  ], fins: { n: 4, x: 52.0, cr: 4.5, ct: 1.5, h: 2.3, r: 2.25, off: 2.2, tone: 7 } });
}
function capsule() { // kiểu Apollo, 1:8; tấm chắn nhiệt cầu lồi hướng vào gió
  const Rc = 4.69, cap = [], N = 12; for (let i = 0; i <= N; i++) { const x = 0.425 * (0.5 - 0.5 * Math.cos(Math.PI * i / N)); cap.push([x, Math.sqrt(Math.max(0, Rc * Rc - (Rc - x) ** 2))]); }
  const rows = [...cap, [0.52, 1.94], [0.65, 1.86], [1.4, 1.38], [2.78, 0.5], [2.9, 0.4], [3.2, 0.38]];
  const F = frame(1 / 8, -1.6, 0, 3.2), P = [solid(F, rev(rows), { id: 'capsule', role: 'body', rk: 1.7, creases: [0.65, 2.78], toneFn: (x, y, z, nx) => (x < F.X(0.5) ? 2 : (x > F.X(2.78) ? 1 : 0)) })];
  P.palette = { 0: 0xD3D0C8, 1: 0x8D939A, 2: 0x2D2926 }; return P;
}

/* ---- máy bay */
function airliner() { // kiểu A320, 1:30: mũi vuốt thấp, kính buồng lái, hàng cửa sổ, cánh xuôi gắn thấp, 2 động cơ, đuôi chữ thập
  const R = 2.07, L = 37.6;
  const fuse = sample(0, L, 56, x => {
    let top, bot;
    if (x < 5.6) { const u = x / 5.6; top = -0.42 + 2.49 * Math.pow(u, 1.2); bot = -0.42 - 1.65 * u; return [top, bot, top - bot]; }
    if (x < 27) return [R, -R, 2 * R];
    const u = (x - 27) / (L - 27), r = R * (1 - 0.93 * Math.pow(u, 1.6)), yc = 0.95 * Math.pow(u, 1.8); return [yc + r, yc - r, 2 * r];
  });
  return plane({ s: 1 / 30, L, fuse, palette: { 0: 0xEEEFF0, 1: 0xB4B9BF, 7: 0x1D3F73 },
    toneFn: (x, y, nx, ny, nz, F) => (ny < -0.45 && x > F.X(6) && x < F.X(30) ? 1 : 0),
    wing: { x: 13.0, y: -1.15, span: 35.8, cr: 6.3, ct: 1.6, sweep: 27, dih: 5, profile: '2412', tc: 0.12 },
    fans: [5.8, -5.8].map((z, i) => ({ id: 'engine_' + (i ? 'L' : 'R'), x: 10.6, y: -2.0, z, k: 0.95, tone: 0 })),
    boxes: [5.8, -5.8].map((z, i) => ({ id: 'pylon_' + (i ? 'L' : 'R'), size: [3.2, 0.55, 0.32], c: [13.2, -1.15, z], r: 0.1, tone: 1 })),
    fin: { x: 28.4, y: 1.2, h: 7.0, cr: 6.9, ct: 2.6, sweep: 35, tone: 7 },
    stab: { x: 31.4, y: 0.6, span: 12.4, cr: 3.6, ct: 1.2, sweep: 33, dih: 6 },
    extra: [F => solid(F, [[12.2, -1.7, -2.1, 0.4], [14.2, -1.2, -2.42, 2.7], [18, -1.1, -2.45, 3.3], [21.5, -1.3, -2.36, 2.5], [24.5, -1.8, -2.1, 0.5]], { id: 'belly_fairing', role: 'detail', tone: 1, n: 2.4 })],
    glass: (F, fus) => [
      G(F, fus, [0, -1, 0], [[3.2, 0.03], [4.5, 0.03], [4.5, 0.8], [3.2, 0.7]], { mirror: true, round: 3 }),
      G(F, fus, [0, 0, -1], [[4.25, 0.5], [5.1, 0.5], [5.1, 1.0], [4.5, 1.05]], { mirror: true, round: 3 }),
      ...row(6.4, 24.6, 36).map(x => G(F, fus, [0, 0, -1], sq(x, 0.66, 0.3, 0.4), { mirror: true, round: 2.5, res: [3, 3], off: 0.0006 })),
    ] });
}
function planeFighter() { // kiểu Mirage 2000, 1:12: cánh tam giác, buồng lái, 1 đuôi đứng, 2 cửa hút gió, vòi phun
  const L = 14.4;
  const fuse = sample(0, L, 40, x => {
    let r; if (x < 3.6) r = 0.72 * Math.pow(1 - Math.pow((3.6 - x) / 3.6, 1.8), 1 / 1.8); else if (x < 10.5) r = 0.72; else r = 0.72 - 0.27 * Math.pow((x - 10.5) / 3.9, 1.3);
    return [r, -r, 2 * r];
  });
  return plane({ s: 1 / 12, L, fuse, k: 1.15, palette: { 0: 0x8A9199, 1: 0x6A7179, 2: 0x2B2F35 }, toneFn: (x, y, nx, ny, nz, F) => (x > F.X(13.6) ? 2 : 0),
    wing: { x: 5.0, y: -0.15, span: 9.13, cr: 9.2, ct: 1.5, sweep: 58, profile: '0012', tc: 0.05, tone: 1 },
    fin: { x: 9.6, y: 0.4, h: 3.5, cr: 4.0, ct: 1.4, sweep: 45, tc: 0.06, tone: 1 },
    canopy: [{ x: 2.5, len: 2.7, w: 0.85, h: 1.05, y: 0.62, peak: 0.42, tone: 3 }],
    fans: [0.98, -0.98].map((z, i) => ({ id: 'intake_' + (i ? 'L' : 'R'), x: 2.9, y: -0.1, z, k: 0.4, tone: 1 })),
    lathes: [{ id: 'nozzle', x: 14.0, y: 0, z: 0, pts: [[0, 0], [0.5, 0], [0.5, 0.01], [0.55, 0.9], [0.5, 0.92], [0.3, 0.5], [0, 0.45]], sil: [[0, 0], [0.5, 0], [0.55, 0.9], [0, 0.9]], tone: 6, role: 'tail', toneFn: (r, a, nx) => (nx > 0.15 && a > 0.3 ? 2 : 6) }] });
}
function planeGlider() { // tàu lượn kiểu LS4, 1:10: cánh dài 15 m, đuôi chữ T, nắp kính
  const L = 6.8;
  const fuse = [[0, 0, 0, 0], [0.2, 0.3, -0.25, 0.3], [0.7, 0.46, -0.3, 0.58], [1.5, 0.56, -0.3, 0.64], [2.6, 0.4, -0.22, 0.5], [4.0, 0.2, -0.12, 0.26], [5.6, 0.12, -0.06, 0.14], [6.8, 0.1, -0.04, 0.07]];
  return plane({ s: 1 / 10, L, fuse, n: 2.4, palette: { 0: 0xEFEEEA, 7: 0xB5342F },
    wing: { x: 1.9, y: 0.2, span: 15.0, cr: 1.05, ct: 0.45, sweep: 2, dih: 2.5, profile: '2412', tc: 0.13 },
    fin: { x: 5.4, y: 0.0, h: 1.3, cr: 1.0, ct: 0.45, sweep: 30, tone: 7 },
    stab: { x: 5.95, y: 1.3, span: 2.6, cr: 0.65, ct: 0.4, sweep: 8, tone: 0 },
    canopy: [{ x: 0.7, len: 1.9, w: 0.5, h: 0.78, y: 0.45, peak: 0.4, tone: 3 }] });
}
function planeProp() { // kiểu Cessna 172, 1:8: cánh cao, mũi có chóp quay, cánh quạt, càng cố định, kính cabin
  const L = 8.0;
  const fuse = [[0.45, 0.35, -0.35, 0.7], [0.7, 0.58, -0.5, 0.95], [1.45, 0.75, -0.55, 1.05], [2.05, 1.22, -0.6, 1.18], [3.25, 1.25, -0.65, 1.15], [4.05, 1.12, -0.6, 1.0], [5.45, 0.7, -0.4, 0.55], [7.05, 0.35, -0.15, 0.3], [7.75, 0.3, -0.1, 0.2]];
  const gear = [];
  for (const z of [1.05, -1.05]) { gear.push({ id: 'wheel_m' + (z > 0 ? 'R' : 'L'), x: 2.7, y: -1.5, z, r: 0.19, w: 0.13, o: { rim: 0.6, spokes: 6, rate: 40 } }); }
  gear.push({ id: 'wheel_nose', x: 1.5, y: -1.38, z: 0, r: 0.15, w: 0.1, o: { rim: 0.6, spokes: 6, rate: 40 } });
  return plane({ s: 1 / 8, L: 8.5, fuse, n: 2.3, oy: 0.1, k: 0.85, palette: { 0: 0xF1F0EC, 1: 0xB5BAC0, 7: 0x23527F },
    toneFn: (x, y, nx, ny, nz, F) => ((y / F.s - F.oy > -0.05 && y / F.s - F.oy < 0.22) ? 7 : 0),
    wing: { x: 1.95, y: 1.12, span: 11.0, cr: 1.63, ct: 1.13, sweep: 2, dih: 1.5, profile: '2412', tc: 0.12 },
    fin: { x: 6.3, y: 0.4, h: 1.55, cr: 1.4, ct: 0.6, sweep: 40, tone: 7 },
    stab: { x: 6.8, y: 0.3, span: 3.4, cr: 0.95, ct: 0.6, sweep: 8, tone: 0 },
    wheels: gear,
    boxes: [{ id: 'leg_R', size: [0.14, 0.95, 0.09], c: [2.55, -1.0, 0.9], tone: 2 }, { id: 'leg_L', size: [0.14, 0.95, 0.09], c: [2.55, -1.0, -0.9], tone: 2 }, { id: 'leg_nose', size: [0.1, 0.85, 0.08], c: [1.5, -0.95, 0], tone: 2 }, { id: 'brace_R', size: [0.12, 0.1, 0.9], c: [2.55, -0.62, 0.45], tone: 2, r: 0.03 }, { id: 'brace_L', size: [0.12, 0.1, 0.9], c: [2.55, -0.62, -0.45], tone: 2, r: 0.03 }],
    extra: [F => solid(F, rev([[-0.02, 0], [0.08, 0.1], [0.22, 0.18], [0.36, 0.215], [0.45, 0.22]].map(([x, r]) => [x, r])), { id: 'spinner', role: 'nose', tone: 6 }),
      F => strut(F, { id: 'wing_strut_R', a: [2.9, -0.5, 0.35], b: [3.1, 1.1, 3.0], wa: [0.12, 0.06], tone: 1 }), F => strut(F, { id: 'wing_strut_L', a: [2.9, -0.5, -0.35], b: [3.1, 1.1, -3.0], wa: [0.12, 0.06], tone: 1 })],
    rotors: [{ id: 'propeller', c: [-0.03, 0, 0], axis: [1, 0, 0], R: 0.95, hub: 0.08, blades: 2, chord: 0.15, taper: 0.6, pitch: 24, rate: 60 }],
    glass: (F, fus) => [
      G(F, fus, [0, -1, 0], [[1.55, -0.6], [2.12, -0.58], [2.12, 0.58], [1.55, 0.6]], { round: 4 }),
      G(F, fus, [0, 0, -1], [[1.85, 0.52], [2.75, 0.52], [2.75, 1.12], [2.1, 1.12]], { mirror: true, round: 4 }),
      G(F, fus, [0, 0, -1], [[2.9, 0.52], [3.7, 0.55], [3.6, 1.05], [2.9, 1.12]], { mirror: true, round: 4 }),
      G(F, fus, [0, -1, 0], [[4.2, -0.3], [4.9, -0.26], [4.9, 0.26], [4.2, 0.3]], { round: 4 })] });
}

/* ---- trực thăng */
function heli() { // kiểu Bell 206, 1:8: cabin kính, đuôi dài, rotor 4 cánh, rotor đuôi, càng trượt bằng ống
  const s = 1 / 8, F = frame(s, -4.7, -1.45, 9.5), P = [];
  const cabin = [[0, 1.15, 1.15, 0], [0.12, 1.55, 0.7, 0.7], [0.45, 1.95, 0.55, 1.15], [1.2, 2.15, 0.5, 1.38], [2.4, 2.2, 0.55, 1.42], [3.3, 2.1, 0.7, 1.2], [4.2, 1.85, 1.0, 0.7], [4.8, 1.62, 1.25, 0.34]];
  const hull = solid(F, cabin, { id: 'cabin', role: 'body', n: 2.6, toneFn: (x, y, z, nx, ny) => ((y / s - 1.45 > 1.25 - 1.45 + 0.05 && y / s - 1.45 < 1.55 - 1.45) ? 7 : 0) }); P.push(hull);
  P.push(solid(F, [[4.1, 1.78, 1.15, 0.6], [5.5, 1.72, 1.3, 0.4], [7.5, 1.7, 1.4, 0.26], [9.3, 1.68, 1.45, 0.2]], { id: 'boom', role: 'tail', n: 2 }));
  P.push(solid(F, [[1.7, 2.3, 2.1, 0.3], [2.1, 2.58, 2.1, 0.95], [3.2, 2.62, 2.1, 1.0], [4.1, 2.3, 2.1, 0.3]], { id: 'cowl', role: 'detail', n: 2.4 }));
  P.push(tube(F, { id: 'mast', path: [[2.5, 2.5, 0], [2.5, 3.25, 0]], r: 0.16, tone: 1, sides: 10 }));
  P.push(fin(F, { x: 8.4, y: 1.45, h: 1.15, cr: 1.0, ct: 0.5, sweep: 32, tone: 7 }));
  P.push(stab(F, { x: 7.7, y: 1.5, span: 2.3, cr: 0.5, ct: 0.4, sweep: 5, tone: 0 }));
  for (const z of [0.95, -0.95]) {
    const n = z > 0 ? 'R' : 'L';
    P.push(tube(F, { id: 'skid_' + n, path: [[0.3, 0.52, z], [0.55, 0.2, z], [0.9, 0.12, z], [3.2, 0.12, z], [3.5, 0.2, z], [3.75, 0.5, z]], r: 0.055, tone: 2, sides: 8 }));
    for (const [x, xt] of [[1.15, 1.3], [3.05, 2.9]]) P.push(tube(F, { id: `strut_${n}${x}`, path: [[x, 0.14, z], [xt, 0.95, z * 0.62]], r: 0.04, tone: 2, sides: 6 }));
  }
  const R = (id, c, axis, rad, hub, blades, chord, rate) => make('rotor', { ref: F.ref, id, center: [F.X(c[0]), F.Y(c[1]), F.Z(c[2])], axis, radius: F.m(rad), hubRadius: F.m(hub), blades, chord: F.m(chord), taper: 0.8, pitchDeg: 6, rate, tone: 2, tc: 0.08 });
  P.push(R('main_rotor', [2.5, 3.25, 0], [0, 1, 0], 5.1, 0.22, 4, 0.33, 24));
  P.push(R('tail_rotor', [9.0, 1.95, 0.32], [0, 0, 1], 0.85, 0.1, 2, 0.2, 70));
  P.push(G(F, hull, [1, 0, 0], [[1.4, -0.66], [1.4, 0.66], [2.1, 0.6], [2.1, -0.6]], { round: 4 }));
  P.push(G(F, hull, [0, 0, -1], [[0.55, 1.32], [1.55, 1.32], [1.55, 2.0], [0.9, 2.02]], { mirror: true, round: 4 }));
  P.push(G(F, hull, [0, 0, -1], [[1.7, 1.32], [2.55, 1.34], [2.55, 2.0], [1.7, 2.04]], { mirror: true, round: 4 }));
  P.palette = { 0: 0xE7E5DF, 1: 0xB5BAC0, 7: 0x1E4B6E }; return P;
}

/* ---- cánh 2D (chạy hết ống, dây cung 0,5 m) */
const spanWing = (profile, tc, hex) => () => { const P = [make('wing', { id: 'wing', profile, tc, spanning: true, rootChord: 0.5, tipChord: 0.5, rootLE: [-0.25, 0, 0], ref: 0.5, tone: 0 })]; P.palette = { 0: hex }; return P; };

/* ---- xe đua */
function raceF1() { // 1:4, bánh hở: thân + sidepod một khối hull, halo, cánh trước 3 tầng, cánh sau 2 tầng + cánh dầm
  const F = frame(0.25, -2.75, -0.56, 5.5), F2 = frame(0.25, -2.75 + 0.2, -0.56, 5.5), P = [], LH = 5.15;
  const tf = (x, y, z, nx, ny, nz) => (x < 0.42 ? 7 : (y < 0.1 ? 2 : 0));
  const hull = carHull(F2, { id: 'body', L: LH, endF: 0.16, endR: 0.12, ledge: 0.3, tumble: 0.12, tuck: 0.05, roofR: 0.1, gh0: 0.12, gh1: 0.3, hoodR: 0.06, n: 100, toneFn: tf,
    top: [[0, 0.22], [0.5, 0.3], [1.0, 0.4], [1.4, 0.5], [1.7, 0.52], [2.2, 0.62], [2.45, 0.9], [2.9, 1.0], [3.6, 0.96], [4.2, 0.78], [4.7, 0.58], [5.15, 0.46]],
    belt: [[0, 0.18], [0.8, 0.2], [1.6, 0.32], [2.1, 0.42], [3.0, 0.44], [4.0, 0.38], [4.6, 0.3], [5.15, 0.26]],
    floor: [[0, 0.12], [2, 0.06], [4.0, 0.06], [4.6, 0.16], [5.15, 0.3]],
    half: [[0, 0.07], [0.4, 0.12], [1.0, 0.2], [1.6, 0.3], [2.1, 0.52], [3.0, 0.56], [3.8, 0.46], [4.5, 0.3], [5.15, 0.18]] });
  P.push(hull);
  P.push(panel(F2, hull, { dir: [0, -1, 0], corners: [[1.35, -0.17], [2.25, -0.19], [2.25, 0.19], [1.35, 0.17]], tone: 2, round: 3, off: 0.0009 }));
  P.push(blob(F2, { id: 'helmet', x: 1.95, y: 0.56, z: 0, len: 0.3, w: 0.26, h: 0.28, tone: 7 }));
  P.push(panel(F2, hull, { dir: [1, 0, 0], mirror: true, corners: [[0.12, 0.34], [0.12, 0.5], [0.36, 0.5], [0.36, 0.36]], tone: 2, round: 3, off: 0.0009 }));
  P.push(panel(F2, hull, { dir: [-1, 0, 0], tone: 5, corners: [[0.36, -0.07], [0.36, 0.07], [0.45, 0.06], [0.45, -0.06]], round: 3, off: 0.0009 }));
  for (const sz of [-1, 1]) P.push(tube(F2, { id: 'halo_' + (sz < 0 ? 'L' : 'R'), path: [[1.5, 0.52, 0], [1.62, 0.7, sz * 0.05], [1.85, 0.86, sz * 0.2], [2.2, 0.86, sz * 0.26], [2.42, 0.74, sz * 0.2]], r: 0.018, tone: 2, sides: 8 }));
  P.push(tube(F2, { id: 'halo_pillar', path: [[1.5, 0.5, 0], [1.56, 0.78, 0], [1.66, 0.86, 0]], r: 0.02, tone: 2, sides: 8 }));
  for (const [i, x, R, w] of [[0, 1.25, 0.33, 0.3], [1, 4.7, 0.35, 0.405]]) for (const sz of [-1, 1]) {
    const n = (i ? 'r' : 'f') + (sz < 0 ? 'L' : 'R');
    P.push(wheel(F, 'wheel_' + n, x, R, sz * 0.78, R, w, { rim: 0.62, spokes: 10, rimTone: 1, rate: 30 }));
    const zb = sz * (i ? 0.26 : 0.22), zw = sz * (0.78 - w / 2);
    P.push(tube(F, { id: `arm_${n}0`, path: [[x - 0.12, R + 0.12, zb], [x, R + 0.02, zw]], r: 0.014, tone: 2, sides: 6 }));
    P.push(tube(F, { id: `arm_${n}1`, path: [[x + 0.18, R - 0.12, zb], [x, R - 0.04, zw]], r: 0.014, tone: 2, sides: 6 }));
    P.push(tube(F, { id: `arm_${n}2`, path: [[x, R + 0.2, zb], [x, R - 0.02, zw]], r: 0.01, tone: 2, sides: 6 }));
  }
  P.push(wing(F, { id: 'wing_f', role: 'wing', x: 0.0, y: 0.12, span: 1.8, cr: 0.3, profile: '0012', tc: 0.1, inc: -8, tone: 1 }));
  P.push(wing(F, { id: 'wing_f2', role: 'detail', x: 0.02, y: 0.2, span: 1.7, cr: 0.2, profile: '0012', tc: 0.08, inc: -20, tone: 1 }));
  P.push(wing(F, { id: 'wing_f3', role: 'detail', x: 0.06, y: 0.28, span: 1.6, cr: 0.14, profile: '0012', tc: 0.08, inc: -30, tone: 1 }));
  for (const sz of [-1, 1]) {
    P.push(box(F, { id: 'endplate_f' + (sz < 0 ? 'L' : 'R'), size: [0.42, 0.24, 0.025], c: [0.17, 0.22, sz * 0.9], r: 0.01, tone: 1 }));
    P.push(strut(F, { id: 'noseleg_' + sz, a: [0.5, 0.2, sz * 0.05], b: [0.22, 0.14, sz * 0.12], wa: [0.05, 0.05], tone: 1 }));
  }
  P.push(wing(F, { id: 'wing_r', role: 'wing', x: 5.0, y: 0.98, span: 0.95, cr: 0.36, profile: '0012', tc: 0.1, inc: -9, tone: 1 }));
  P.push(wing(F, { id: 'wing_r2', role: 'detail', x: 5.06, y: 1.12, span: 0.95, cr: 0.22, profile: '0012', tc: 0.08, inc: -24, tone: 1 }));
  P.push(wing(F, { id: 'beam_wing', role: 'detail', x: 4.95, y: 0.6, span: 0.7, cr: 0.2, profile: '0012', tc: 0.08, inc: -4, tone: 1 }));
  for (const sz of [-1, 1]) P.push(box(F, { id: 'endplate_r' + (sz < 0 ? 'L' : 'R'), size: [0.55, 0.5, 0.025], c: [5.22, 0.85, sz * 0.5], r: 0.01, tone: 1 }));
  P.push(box(F, { id: 'pylon_r', size: [0.2, 0.55, 0.06], c: [5.2, 0.7, 0], r: 0.02, tone: 1 }));
  P.palette = { 0: 0xB3202A, 1: 0x23262C, 7: 0xE8E4D8 }; return P;
}

/* ---- xe con: thân hull (đường nóc, vai, đáy, nửa bề rộng), vòm bánh, kính, đèn, gương */
const trimLow = (xf, xr, hi, lo) => x => lo + (hi - lo) * Math.max(sstep((xf - x) / 0.45), sstep((x - xr) / 0.45));
function sedanLike(o) {
  const F = frame(0.25, -o.L / 2, -o.H / 2, o.L, o.k ?? 0.88), P = [];
  const arches = [{ x: o.xf, y: o.R, R: o.Ra }, { x: o.xr, y: o.R, R: o.Ra }], zi = o.zi ?? 0.62, trim = trimLow(0.4, o.L - 0.4, o.trimHi ?? 0.46, o.trimLo ?? 0.27);
  const tf = archTone(arches, zi, trim);
  const hull = carHull(F, { L: o.L, top: o.top, belt: o.belt, floor: o.floor, half: o.half, arches, zi, ledge: o.ledge, tumble: o.tumble, tuck: o.tuck, endF: o.endF, endR: o.endR, n: o.n ?? 96, toneFn: tf });
  P.push(hull);
  for (const [i, x] of [o.xf, o.xr].entries()) for (const sz of [-1, 1]) P.push(wheel(F, `wheel_${i ? 'r' : 'f'}${sz < 0 ? 'L' : 'R'}`, x, o.R, sz * o.track, o.R, o.ww, { rim: o.rim ?? 0.68, spokes: o.spokes ?? 5 }));
  const G = (dir, corners, extra = {}) => P.push(panel(F, hull, { dir, corners, ...extra }));
  G([0, -1, 0], o.windshield); if (o.backlight) G([0, -1, 0], o.backlight); if (o.rearGlass) G([-1, 0, 0], o.rearGlass, { round: 4 });
  for (const q of o.sideGlass) G([0, 0, -1], q, { mirror: true });
  for (const [x, y0, y1] of o.shut || []) G([0, 0, -1], [[x - 0.007, y0], [x + 0.007, y0], [x + 0.007, y1], [x - 0.007, y1]], { mirror: true, tone: 2, round: 2, res: [2, 14], off: 0.0005 });
  for (const [x, y] of o.handles || []) G([0, 0, -1], [[x - 0.09, y], [x + 0.09, y], [x + 0.09, y + 0.03], [x - 0.09, y + 0.03]], { mirror: true, tone: 6, round: 4, res: [6, 2], off: 0.0009 });
  for (const q of o.lamps || []) G([1, 0, 0], q, { mirror: true, tone: 4, round: 3 });
  for (const q of o.tails || []) G([-1, 0, 0], q, { mirror: true, tone: 5, round: 3 });
  for (const q of o.grilles || []) G([1, 0, 0], q, { tone: 2, round: 4 });
  for (const m of o.mirrors || []) for (const sz of [-1, 1]) P.push(blob(F, { id: 'mirror_' + (sz < 0 ? 'L' : 'R'), x: m.x, y: m.y, z: sz * m.z, len: 0.2, w: 0.12, h: 0.11, tone: 0 }));
  if (o.rails) for (const sz of [-1, 1]) P.push(tube(F, { id: 'rail_' + (sz < 0 ? 'L' : 'R'), path: o.rails.map(q => [q[0], q[1], sz * q[2]]), r: 0.017, tone: 6, sides: 8 }));
  P.palette = o.palette; return P;
}
function raceProto() { // 1:4, thân kín kiểu nguyên mẫu Le Mans: buồng lái kính, vây lưng, cánh sau
  const F = frame(0.25, -4.75 / 2, -1.2 / 2, 4.75, 0.9), P = [];
  const arches = [{ x: 1.0, y: 0.35, R: 0.43 }, { x: 3.75, y: 0.35, R: 0.43 }], zi = 0.7, tf = archTone(arches, zi, trimLow(0.4, 4.35, 0.3, 0.16));
  const hull = carHull(F, { L: 4.75, endF: 0.28, endR: 0.2, arches, zi, ledge: 0.2, tumble: 0.32, tuck: 0.03, roofR: 0.12, gh0: 0.12, gh1: 0.3, n: 130, toneFn: tf,
    top: [[0, 0.34], [0.4, 0.42], [1.0, 0.58], [1.5, 0.66], [1.95, 0.86], [2.35, 1.04], [2.85, 1.1], [3.3, 1.02], [3.8, 0.86], [4.3, 0.8], [4.75, 0.72]],
    belt: [[0, 0.28], [1.0, 0.52], [2.0, 0.62], [3.0, 0.7], [4.0, 0.74], [4.75, 0.66]],
    floor: [[0, 0.16], [0.35, 0.11], [1, 0.1], [3.8, 0.1], [4.3, 0.19], [4.75, 0.3]],
    half: [[0, 0.5], [0.5, 0.85], [1.0, 1.04], [1.9, 0.9], [2.6, 0.86], [3.3, 0.95], [3.75, 1.04], [4.3, 0.95], [4.75, 0.6]] });
  P.push(hull);
  for (const [i, x] of [1.0, 3.75].entries()) for (const sz of [-1, 1]) P.push(wheel(F, `wheel_${i ? 'r' : 'f'}${sz < 0 ? 'L' : 'R'}`, x, 0.35, sz * 0.88, 0.35, 0.32, { rim: 0.62, spokes: 6, rimTone: 1 }));
  P.push(panel(F, hull, { dir: [0, -1, 0], corners: [[2.0, -0.4], [3.35, -0.36], [3.35, 0.36], [2.0, 0.4]], round: 3 }));
  P.push(panel(F, hull, { dir: [0, 0, -1], mirror: true, corners: [[2.1, 0.86], [3.2, 0.86], [3.05, 1.0], [2.3, 1.0]], round: 3 }));
  P.push(panel(F, hull, { dir: [1, 0, 0], mirror: true, tone: 4, round: 3, corners: [[0.3, 0.45], [0.3, 0.85], [0.42, 0.8], [0.42, 0.5]] }));
  P.push(panel(F, hull, { dir: [-1, 0, 0], mirror: true, tone: 5, round: 3, corners: [[0.52, 0.45], [0.52, 0.85], [0.62, 0.8], [0.62, 0.5]] }));
  P.push(fin(F, { x: 3.2, y: 0.7, h: 0.3, cr: 1.5, ct: 0.5, sweep: 55, tone: 0 }));
  P.push(wing(F, { id: 'wing_r', role: 'wing', x: 4.25, y: 1.0, span: 1.5, cr: 0.5, profile: '0012', tc: 0.1, inc: -8, tone: 1 }));
  for (const sz of [-1, 1]) P.push(box(F, { id: 'endplate_r' + (sz < 0 ? 'L' : 'R'), size: [0.6, 0.32, 0.03], c: [4.5, 0.98, sz * 0.75], r: 0.01, tone: 1 }));
  P.push(box(F, { id: 'splitter', size: [0.5, 0.04, 1.6], c: [0.2, 0.1, 0], r: 0.01, tone: 2 }));
  P.palette = { 0: 0x1F4A3A, 1: 0xB5BAC0 }; return P;
}

/* ---- xe con */
function carSedan() { // 1:4, ba khoang
  return sedanLike({ L: 4.85, H: 1.5, xf: 1.0, xr: 3.85, R: 0.33, Ra: 0.38, ww: 0.225, track: 0.78,
    top: [[0, 0.8], [0.3, 0.85], [0.8, 0.92], [1.25, 0.98], [1.5, 1.12], [1.85, 1.33], [2.15, 1.42], [2.6, 1.455], [3.1, 1.45], [3.5, 1.4], [3.85, 1.28], [4.1, 1.08], [4.3, 1.02], [4.6, 1.02], [4.85, 0.98]],
    belt: [[0, 0.74], [0.6, 0.82], [1.2, 0.92], [2.0, 0.97], [3.0, 0.99], [4.0, 1.0], [4.5, 1.0], [4.85, 0.95]],
    floor: [[0, 0.32], [0.4, 0.21], [1.0, 0.16], [3.8, 0.16], [4.5, 0.24], [4.85, 0.34]],
    half: [[0, 0.64], [0.5, 0.85], [1.0, 0.905], [2.5, 0.915], [3.8, 0.9], [4.4, 0.85], [4.85, 0.7]],
    windshield: [[1.33, -0.6], [2.12, -0.5], [2.12, 0.5], [1.33, 0.6]], backlight: [[3.55, -0.5], [4.08, -0.55], [4.08, 0.55], [3.55, 0.5]],
    shut: [[1.74, 0.3, 0.97], [2.7, 0.3, 0.98], [3.6, 0.3, 0.99]], handles: [[2.3, 0.88], [3.15, 0.89]],
    sideGlass: [[[1.66, 1.015], [2.66, 1.015], [2.66, 1.385], [2.03, 1.37]], [[2.78, 1.015], [3.5, 1.02], [3.3, 1.33], [2.78, 1.385]]],
    lamps: [[[0.64, 0.44], [0.64, 0.82], [0.73, 0.8], [0.74, 0.5]]], tails: [[[0.86, 0.52], [0.86, 0.86], [0.97, 0.84], [0.97, 0.55]]], grilles: [[[0.5, -0.36], [0.5, 0.36], [0.62, 0.32], [0.62, -0.32]], [[0.33, -0.5], [0.33, 0.5], [0.43, 0.46], [0.43, -0.46]]],
    mirrors: [{ x: 2.0, y: 1.03, z: 0.99 }], palette: { 0: 0x34475E, 1: 0xB5BAC0 } });
}
function carSuv() { // 1:4, cao hơn, đuôi thẳng đứng, gầm cao, giá nóc
  return sedanLike({ L: 4.75, H: 1.77, k: 0.9, xf: 1.05, xr: 3.75, R: 0.37, Ra: 0.43, ww: 0.245, track: 0.83, ledge: 0.15, tumble: 0.2, trimHi: 0.62, trimLo: 0.36, zi: 0.66,
    top: [[0, 0.98], [0.4, 1.05], [1.0, 1.12], [1.6, 1.17], [2.0, 1.45], [2.4, 1.72], [2.8, 1.77], [4.25, 1.77], [4.55, 1.7], [4.68, 1.4], [4.75, 1.12]],
    belt: [[0, 0.92], [1.0, 1.08], [2.0, 1.12], [4.2, 1.14], [4.75, 1.1]],
    floor: [[0, 0.5], [0.4, 0.38], [1.05, 0.3], [3.75, 0.3], [4.5, 0.36], [4.75, 0.46]],
    half: [[0, 0.7], [0.5, 0.9], [1.0, 0.955], [2.5, 0.96], [4.0, 0.95], [4.5, 0.9], [4.75, 0.76]],
    windshield: [[1.62, -0.6], [2.36, -0.58], [2.36, 0.58], [1.62, 0.6]],     shut: [[1.95, 0.4, 1.12], [2.95, 0.4, 1.13], [3.95, 0.4, 1.14]], handles: [[2.45, 0.98], [3.4, 0.99]], rearGlass: [[1.2, -0.58], [1.2, 0.58], [1.66, 0.55], [1.66, -0.55]],
    sideGlass: [[[1.95, 1.17], [2.9, 1.17], [2.9, 1.69], [2.4, 1.69]], [[3.0, 1.17], [3.9, 1.17], [3.9, 1.69], [3.0, 1.69]], [[4.0, 1.17], [4.5, 1.17], [4.42, 1.64], [4.0, 1.69]]],
    lamps: [[[0.84, 0.5], [0.84, 0.88], [0.95, 0.86], [0.95, 0.56]]], tails: [[[1.18, 0.74], [1.18, 0.9], [1.5, 0.88], [1.5, 0.76]]], grilles: [[[0.66, -0.4], [0.66, 0.4], [0.82, 0.36], [0.82, -0.36]], [[0.5, -0.5], [0.5, 0.5], [0.6, 0.46], [0.6, -0.46]]],
    mirrors: [{ x: 2.05, y: 1.22, z: 1.04 }], rails: [[2.3, 1.82, 0.56], [3.3, 1.82, 0.56], [4.3, 1.82, 0.56]], palette: { 0: 0x45594A, 1: 0xB5BAC0 } });
}

/* ---- xe tải (1:7): cabin hull đầu bằng + thùng + khung gầm + bánh đôi */
function truck(o) {
  const F = frame(1 / 7, -3.8, -1.75, 7.6, 1), P = [], CL = 2.1;
  const arches = [{ x: 1.0, y: 0.5, R: 0.57 }], zi = 0.8, tf = archTone(arches, zi, x => 0.62 + 0.0 * x);
  const cab = carHull(F, { id: 'cab', L: CL, endF: 0.14, endR: 0.05, arches, zi, ledge: 0.03, tumble: 0.05, tuck: 0.02, roofR: 0.12, gh0: 0.08, gh1: 0.3, hoodR: 0.1, n: 64, toneFn: tf,
    top: [[0, 1.8], [0.05, 2.2], [0.12, 2.7], [0.25, 3.0], [0.5, 3.1], [2.1, 3.12]], belt: [[0, 1.72], [2.1, 1.78]], floor: [[0, 0.56], [2.1, 0.62]], half: [[0, 1.12], [0.14, 1.22], [2.1, 1.25]] });
  P.push(cab);
  P.push(box(F, { id: 'box', role: 'body', size: [o.box.len, o.box.h, o.box.w], c: [o.box.x + o.box.len / 2, o.box.y + o.box.h / 2, 0], r: 0.1, tone: 7, e: 1.5 }));
  P.push(box(F, { id: 'box_skirt', size: [o.box.len - 0.6, 0.18, o.box.w - 0.08], c: [o.box.x + o.box.len / 2, o.box.y - 0.04, 0], r: 0.04, tone: 2, e: 4 }));
  P.push(box(F, { id: 'chassis', size: [o.L - 1.0, 0.28, 1.3], c: [o.L / 2 + 0.3, 0.8, 0], r: 0.04, tone: 2, e: 4 }));
  if (o.fairing) P.push(solid(F, o.fairing, { id: 'roof_fairing', role: 'detail', n: 4, tone: 0, rk: 1.6 }));
  for (const [i, ax] of o.axles.entries()) for (const sz of [-1, 1]) for (const zz of ax.z) P.push(wheel(F, `wheel_${i}_${sz < 0 ? 'L' : 'R'}${zz > 0.9 ? 'o' : 'i'}`, ax.x, o.R, sz * zz, o.R, 0.3, { rim: 0.6, spokes: 8, rate: 18 }));
  P.push(box(F, { id: 'bumper', size: [0.25, 0.3, 2.3], c: [0.05, 0.62, 0], r: 0.08, tone: 2 }));
  const G = (dir, corners, ex = {}) => P.push(panel(F, cab, { dir, corners, ...ex }));
  G([1, 0, 0], [[1.98, -1.04], [1.98, 1.04], [2.92, 1.0], [2.92, -1.0]], { round: 4 });
  G([0, 0, -1], [[0.32, 1.95], [1.42, 1.95], [1.42, 2.88], [0.42, 2.88]], { mirror: true, round: 4 });
  G([0, 0, -1], [[1.5 - 0.007, 0.7], [1.5 + 0.007, 0.7], [1.5 + 0.007, 1.9], [1.5 - 0.007, 1.9]], { mirror: true, tone: 2, round: 2, res: [2, 14], off: 0.0005 });
  G([1, 0, 0], [[0.95, 0.66], [0.95, 1.1], [1.15, 1.08], [1.15, 0.7]], { mirror: true, tone: 4, round: 3 });
  G([1, 0, 0], [[0.88, -0.55], [0.88, 0.55], [1.6, 0.52], [1.6, -0.52]], { tone: 2, round: 6 });
  for (const sz of [-1, 1]) {
    P.push(strut(F, { id: 'mirror_arm_' + sz, a: [0.5, 2.2, sz * 1.22], b: [0.35, 2.4, sz * 1.5], wa: [0.06, 0.06], tone: 2 }));
    P.push(box(F, { id: 'mirror_' + (sz < 0 ? 'L' : 'R'), size: [0.12, 0.55, 0.2], c: [0.33, 2.5, sz * 1.55], r: 0.04, tone: 2 }));
    P.push(tube(F, { id: 'stack_' + (sz < 0 ? 'L' : 'R'), path: [[2.22, 0.9, sz * 1.18], [2.22, 3.05, sz * 1.18]], r: 0.065, tone: 6, sides: 10 }));
    P.push(box(F, { id: 'tank_' + (sz < 0 ? 'L' : 'R'), size: [0.9, 0.5, 0.5], c: [2.9, 0.68, sz * 0.9], r: 0.2, tone: 6 }));
  }
  P.palette = { 0: 0x2F4A66, 1: 0xB5BAC0, 7: 0xE3E1DA }; return P;
}
const cabRows = null;
function truckBox() { return truck({ L: 7.6, R: 0.5, box: { x: 2.1, y: 1.15, len: 5.5, h: 2.35, w: 2.45 }, axles: [{ x: 1.0, z: [1.05] }, { x: 6.0, z: [1.05, 0.7] }] }); }
function truckFairing() {
  return truck({ L: 7.6, R: 0.5, box: { x: 2.1, y: 1.15, len: 5.5, h: 2.35, w: 2.45 }, axles: [{ x: 1.0, z: [1.05] }, { x: 6.0, z: [1.05, 0.7] }],
    fairing: [[0.6, 3.1, 3.0, 2.0], [1.2, 3.18, 3.0, 2.3], [1.7, 3.35, 3.0, 2.4], [2.1, 3.5, 3.0, 2.42], [2.2, 3.5, 3.0, 2.42]] });
}

/* ---- hình học */
const shape = (kind, o, hex) => () => { const P = [make(kind, { ref: o.ref, ...o.p })]; P.palette = { 0: hex }; return P; };

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
  { id: 'wing_0012', group: 'wing', name: 'Cánh đối xứng NACA 0012', note: 'Mặt cắt 2D, dây cung 0,5 m, chạy hết ống', build: spanWing('0012', 0.12, 0xB9C0C8) },
  { id: 'wing_2412', group: 'wing', name: 'Cánh khum NACA 2412', note: 'Mặt cắt 2D, dây cung 0,5 m, chạy hết ống', build: spanWing('2412', 0.12, 0x9DB4C8) },
  { id: 'wing_wedge', group: 'wing', name: 'Cánh mỏng siêu âm', note: 'Mặt cắt 2D hình thoi, dây cung 0,5 m', build: spanWing('wedge', 0.06, 0x8F959C) },
  { id: 'race_f1', group: 'race', name: 'Xe đua bánh hở', note: 'Mô hình tỉ lệ 1:4', build: raceF1 },
  { id: 'race_proto', group: 'race', name: 'Xe đua thể thao', note: 'Mô hình tỉ lệ 1:4', build: raceProto },
  { id: 'car_sedan', group: 'car', name: 'Xe con sedan', note: 'Mô hình tỉ lệ 1:4', build: carSedan },
  { id: 'car_suv', group: 'car', name: 'Xe SUV', note: 'Mô hình tỉ lệ 1:4', build: carSuv },
  { id: 'truck_box', group: 'truck', name: 'Xe tải thùng', note: 'Mô hình tỉ lệ 1:7', build: truckBox },
  { id: 'truck_fairing', group: 'truck', name: 'Xe tải có ốp gió', note: 'Mô hình tỉ lệ 1:7, ốp gió trên nóc cabin', build: truckFairing },
  { id: 'sphere', group: 'shape', name: 'Hình cầu', note: 'Đường kính 0,30 m', build: shape('sphere', { ref: 0.3, p: { id: 'sphere', D: 0.3 } }, 0x7F97AE) },
  { id: 'cylinder', group: 'shape', name: 'Hình trụ', note: 'Đường kính 0,12 m, chạy hết ống', build: shape('cylinder', { ref: 0.12, p: { id: 'cylinder', D: 0.12 } }, 0xA5ABB2) },
  { id: 'plate', group: 'shape', name: 'Tấm phẳng', note: '0,40 × 0,40 × 0,012 m, đặt vuông góc dòng khí', build: shape('plate', { ref: 0.4, p: { id: 'plate', size: [0.012, 0.4, 0.4] } }, 0xC2B49A) },
  { id: 'rhombus', group: 'shape', name: 'Khối thoi hai nón', note: 'Đường kính 0,30 m, dài 0,52 m', build: shape('rhombus', { ref: 0.52, p: { id: 'rhombus', D: 0.3, length: 0.52 } }, 0xC9B79C) },
  { id: 'teardrop', group: 'shape', name: 'Giọt nước', note: 'Đường kính 0,30 m, dài 1,05 m', build: shape('teardrop', { ref: 1.05, p: { id: 'teardrop', D: 0.3, length: 1.05 } }, 0x7FA7A3) },
];
export const byId = id => LIBRARY.find(e => e.id === id) || null;
