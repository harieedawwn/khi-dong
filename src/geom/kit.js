// src/geom/kit.js  Bộ dụng cụ dựng mô hình thu nhỏ: khung toạ độ thật -> mô hình, đường cong, thân xe, kính, đèn, bánh.
// Mọi số liệu viết bằng mét THẬT (kích thước xe thật) rồi nhân tỉ lệ s; x tính từ mũi, y từ mặt đất / trục, z ngang.
import { make, stationList } from './parts.js';

export const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// frame: (ox, oy) dịch gốc thật để mô hình nằm giữa ống; Lreal chỉ để chọn độ mịn lưới (k nới thêm).
export function frame(s, ox, oy, Lreal, k = 1) { return { s, ox, oy, ref: 0.97 * k * Lreal * s, X: v => (v + ox) * s, Y: v => (v + oy) * s, Z: v => v * s, m: v => v * s, inv: v => v / s - ox }; }

// đường cong trơn qua các điểm [x, v] (đơn điệu khối, không vọt)
export function curve(pts) {
  const n = pts.length, x = pts.map(p => p[0]), y = pts.map(p => p[1]), h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = x[i + 1] - x[i]; d[i] = (y[i + 1] - y[i]) / h[i]; }
  if (n === 2) m[0] = m[1] = d[0];
  else {
    for (let i = 1; i < n - 1; i++) if (d[i - 1] * d[i] > 0) { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
    m[0] = d[0]; m[n - 1] = d[n - 2];
  }
  return t => {
    if (t <= x[0]) return y[0]; if (t >= x[n - 1]) return y[n - 1];
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] <= t) lo = mid; else hi = mid; }
    const s = (t - x[lo]) / h[lo], s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y[lo] + (s3 - 2 * s2 + s) * h[lo] * m[lo] + (-2 * s3 + 3 * s2) * y[lo + 1] + (s3 - s2) * h[lo] * m[lo + 1];
  };
}
// bo tròn hai đầu theo cung elip: giá trị tại x = 0 và x = L là giá trị bảng, tăng nhanh (tiếp tuyến thẳng đứng) trong ef / er đầu
export function rounded(f, L, ef, er) {
  const f0 = f(0), f1 = f(L), u = (d, e) => (d >= e ? 1 : Math.sqrt(Math.max(0, 1 - (1 - d / e) ** 2)));
  return x => { let v = f(x); if (x < ef) v = f0 + (v - f0) * u(x, ef); if (x > L - er) v = f1 + (v - f1) * u(L - x, er); return v; };
}

/* ------------------------------------------------------------------ chi tiết lắp lên thân */
// mảnh phủ (kính, đèn, lưới) chiếu lên chi tiết `on`; corners là 4 góc theo mét thật, trong mặt phẳng vuông góc dir.
export function panel(F, on, o) {
  const k = o.dir.findIndex(v => v !== 0), ax = [0, 1, 2].filter(a => a !== k), cv = [F.X, F.Y, F.Z];
  return make('panel', { on, dir: o.dir, mirror: o.mirror, ref: F.ref * (o.rk ?? 1), tone: o.tone ?? 3, round: o.round ?? 5, off: o.off, res: o.res, id: o.id,
    corners: o.corners.map(c => [cv[ax[0]](c[0]), cv[ax[1]](c[1])]) });
}
export function strut(F, o) { return make('strut', { id: o.id, tone: o.tone ?? 2, a: o.a.map((v, i) => [F.X, F.Y, F.Z][i](v)), b: o.b.map((v, i) => [F.X, F.Y, F.Z][i](v)), wa: o.wa.map(F.m), wb: (o.wb || o.wa).map(F.m), up: o.up }); }
export function tube(F, o) { return make('tube', { id: o.id, tone: o.tone ?? 2, ref: F.ref, path: o.path.map(p => [F.X(p[0]), F.Y(p[1]), F.Z(p[2])]), radius: typeof o.r === 'number' ? F.m(o.r) : o.r.map(F.m), sides: o.sides, role: o.role }); }
export function wheel(F, id, x, y, z, R, w, o = {}) {
  const c = [F.X(x), F.Y(y), F.Z(z)];
  return make('wheel', { ref: F.ref, id, center: c, radius: F.m(R), width: F.m(w), rimRatio: o.rim ?? 0.66, spokes: o.spokes ?? 5, rimTone: o.rimTone ?? 6, discTone: o.discTone ?? 2, edge: F.ref * 0.0105 * (o.coarse ?? 1.9), spin: { axis: [0, 0, 1], rate: o.rate ?? 24, center: c } });
}
// khối elip mảnh (gương, đèn pha lồi, cánh ổn định nhỏ): dài theo x
export function blob(F, o) {
  const f = t => Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
  return make('loft', { id: o.id, role: 'detail', tone: o.tone ?? 0, ref: F.ref, n: o.n ?? 2, x0: F.X(o.x - o.len / 2), length: F.m(o.len), width: t => F.m(o.w) * f(t), height: t => F.m(o.h) * f(t), yOffset: F.Y(o.y), zOffset: F.Z(o.z), capStart: false, capEnd: false });
}
export function box(F, o) {
  return make('roundedBox', { ref: F.ref, edge: F.ref * 0.0105 * (o.e ?? 1), id: o.id, role: o.role ?? 'detail', size: o.size.map(F.m), center: [F.X(o.c[0]), F.Y(o.c[1]), F.Z(o.c[2])], radius: F.m(o.r ?? 0.02), tone: o.tone ?? 2 });
}

/* ------------------------------------------------------------------ thân xe con / xe tải / xe đua kín (hull) */
// o: { L, top:[[x,y]..] (đường nóc/mui/nắp), belt:[[x,y]..] (đường vai), floor:[[x,y]..], half:[[x,w]..] (nửa bề rộng thân),
//      ledge (thụt kính so với vai), tumble (độ nghiêng kính hông), gh0/gh1 (ngưỡng cao kính để có khoang lái),
//      arches:[{x, y, R}], zi (thành trong vòm), endF, endR (độ dài bo mũi / đuôi), tuck (thụt sườn dưới), n (số trạm), toneFn }
export function carHull(F, o) {
  const L = o.L, ef = o.endF ?? 0.2, er = o.endR ?? 0.18, R = f => rounded(curve(f), L, ef, er);
  const yT = R(o.top), yS = R(o.belt), yB = R(o.floor), wH = R(o.half);
  const arches = o.arches || [], ledge = o.ledge ?? 0.14, tumble = o.tumble ?? 0.3, g0 = o.gh0 ?? 0.06, g1 = o.gh1 ?? 0.2, tuck = o.tuck ?? 0.05, rr = o.roofR ?? 0.09, hoodR = o.hoodR ?? 0.04;
  const archY = x => { let m = -1e9; for (const a of arches) { const dx = x - a.x; if (Math.abs(dx) < a.R) m = Math.max(m, a.y + Math.sqrt(a.R * a.R - dx * dx)); } return m; };
  const lerp2 = (a, b, g) => [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g];
  const secReal = x => {
    const w = wH(x), top = yT(x), belt = yS(x), fl = yB(x), hh = Math.max(0.01, top - belt), g = sstep((hh - g0) / (g1 - g0));
    const ya = archY(x), yL = Math.max(fl, Math.min(belt - 0.12, Math.max(fl, ya))), zi = Math.max(0.2, (o.zi ?? 0.62) * Math.min(1, w / 0.9)), dY = belt - yL;
    const wgb = w - ledge, wgt = Math.max(0.2, wgb - tumble * hh);
    const hood = [[w - 0.01, belt + 0.15 * hh], [w - hoodR, belt + 0.8 * hh], [w * 0.80, top - 0.1 * hh], [w * 0.60, top - 0.03 * hh], [w * 0.30, top], [0, top]];
    const gh = [[wgb, belt + 0.02], lerp2([wgb, belt + 0.02], [wgt, top], 0.82), [wgt, top], [wgt - rr, top], [wgt * 0.45, top], [0, top]];
    const up = hood.map((p, i) => lerp2(p, gh[i], g));
    return [[0, fl], [zi * 0.5, fl], [zi, fl], [zi, yL], [Math.max(zi, w - tuck - 0.05), yL], [w - tuck, yL], [w - 0.35 * tuck, yL + 0.3 * dY], [w, yL + 0.65 * dY], [w - 0.01, belt, 2], ...up];
  };
  const stationsReal = stationList(0, L, o.n ?? 130, arches.map(a => [a.x, a.R, 18]));
  const stations = stationsReal.map(F.X);
  const sec = xm => secReal(F.inv(xm)).map(p => [F.Z(p[0]), F.Y(p[1]), p[2]]);
  const toneFn = o.toneFn && ((x, y, z, nx, ny, nz) => o.toneFn(F.inv(x), y / F.s - F.oy, z / F.s, nx, ny, nz));
  const hull = make('hull', { id: o.id ?? 'body', role: 'body', ref: F.ref, stations, sec, spp: 3, tone: 0, toneFn });
  hull.secReal = secReal; return hull;
}
// vòm bánh tối + nẹp thấp đen: hàm tông dùng chung cho xe con
export function archTone(arches, zi, yTrim, xEnds) {
  return (x, y, z, nx, ny, nz) => {
    for (const a of arches) { const dx = x - a.x; if (Math.abs(dx) < a.R + 0.012 && y < a.y + Math.sqrt(Math.max(0, a.R * a.R - Math.min(dx * dx, a.R * a.R))) + 0.012 && Math.abs(z) > zi - 0.02) return 2; }
    if (y < yTrim(x)) return 2;
    return 0;
  };
}
