// src/geom/catalog.js  (P3)  "Assemble your own model": slots, templates, buildFromBuilder(builder) -> parts.
// builder = {nose, body, tail, wing, fins, p:{noseLen,length,diameter,heightRatio,boattailDeg,wheels,span,chord,profile,posX,size}}
// All lengths in metres, angles in degrees. posX = fraction (0..1) of the free body length where the wing leading edge sits.
// Every combination is valid: sizes are clamped to SPEC section 3 (length <= 1.6, span <= 1.6, frontal <= 0.23 m^2).
// Model is centred in x (middle of nose..tail at x = 0), nose toward -x, axis on y = z = 0.
import { make, profiles } from './parts.js';
import { frame, carHull, archTone, curve, panel, wheel, blob } from './kit.js';
import { solid, canopy, bellNozzle } from './library.js';

const O = (id, label) => ({ id, label });
export const SLOTS = [
  { key: 'nose', label: 'Mũi', options: [O('cone', 'Nón nhọn'), O('ogive', 'Ogive (đầu đạn)'), O('round', 'Bán cầu'), O('flat', 'Mũi phẳng')],
    params: [{ id: 'noseLen', label: 'Chiều dài mũi', min: 0.05, max: 0.6, step: 0.01, default: 0.25, unit: 'm' }] },
  { key: 'body', label: 'Thân', options: [O('round', 'Tròn'), O('oval', 'Bầu dục'), O('box', 'Hộp bo góc')],
    params: [
      { id: 'length', label: 'Chiều dài thân', min: 0.1, max: 1.2, step: 0.01, default: 0.5, unit: 'm' },
      { id: 'diameter', label: 'Đường kính / bề rộng', min: 0.04, max: 0.4, step: 0.01, default: 0.1, unit: 'm' },
      { id: 'heightRatio', label: 'Tỉ lệ cao / rộng', min: 0.4, max: 1.6, step: 0.05, default: 1, unit: '' },
      { id: 'wheels', label: 'Bánh xe (0 = không, 1 = có)', min: 0, max: 1, step: 1, default: 0, unit: '' }] },
  { key: 'tail', label: 'Đuôi', options: [O('point', 'Thon nhọn'), O('round', 'Bo tròn'), O('blunt', 'Cụt phẳng')],
    params: [{ id: 'boattailDeg', label: 'Góc thu đuôi', min: 3, max: 25, step: 1, default: 8, unit: 'độ' }] },
  { key: 'wing', label: 'Cánh', options: [O('none', 'Không có'), O('straight', 'Cánh thẳng'), O('swept', 'Cánh xuôi'), O('delta', 'Cánh tam giác')],
    params: [
      { id: 'span', label: 'Sải cánh', min: 0.1, max: 1.6, step: 0.01, default: 0.8, unit: 'm' },
      { id: 'chord', label: 'Dây cung gốc', min: 0.04, max: 0.6, step: 0.01, default: 0.2, unit: 'm' },
      { id: 'profile', label: 'Biên dạng cánh', type: 'choice', options: [O('0012', 'NACA 0012 đối xứng'), O('2412', 'NACA 2412 khum'), O('plate', 'Tấm phẳng')], default: '0012' },
      { id: 'posX', label: 'Vị trí dọc thân', min: 0, max: 1, step: 0.05, default: 0.4, unit: '' }] },
  { key: 'fins', label: 'Cánh ổn định', options: [O('none', 'Không có'), O('tee', 'Đuôi chữ T'), O('cross', 'Bốn cánh chữ thập')],
    params: [{ id: 'size', label: 'Cỡ cánh ổn định', min: 0.02, max: 0.3, step: 0.01, default: 0.08, unit: 'm' }] },
];
export const PARAMS = {}; for (const s of SLOTS) for (const q of s.params) PARAMS[q.id] = q;
export const DEFAULT_BUILDER = { nose: 'ogive', body: 'round', tail: 'point', wing: 'none', fins: 'cross' };
export function defaultParams() { const p = {}; for (const k in PARAMS) p[k] = PARAMS[k].default; return p; }

export const TEMPLATES = {
  rocket: { label: 'Tên lửa', builder: { nose: 'ogive', body: 'round', tail: 'blunt', wing: 'none', fins: 'cross', p: { ...defaultParams(), noseLen: 0.28, length: 0.6, diameter: 0.1, boattailDeg: 6, size: 0.09 } } },
  plane: { label: 'Máy bay', builder: { nose: 'round', body: 'oval', tail: 'point', wing: 'swept', fins: 'tee', p: { ...defaultParams(), noseLen: 0.2, length: 0.62, diameter: 0.14, heightRatio: 0.9, boattailDeg: 7, span: 1.0, chord: 0.26, profile: '2412', posX: 0.35, size: 0.1 } } },
  teardrop: { label: 'Giọt nước', builder: { nose: 'round', body: 'round', tail: 'point', wing: 'none', fins: 'none', p: { ...defaultParams(), noseLen: 0.15, length: 0.15, diameter: 0.3, boattailDeg: 10 } } },
  car: { label: 'Ô tô', builder: { nose: 'round', body: 'box', tail: 'round', wing: 'none', fins: 'none', p: { ...defaultParams(), noseLen: 0.2, length: 0.5, diameter: 0.3, heightRatio: 0.5, boattailDeg: 5, wheels: 1 } } },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pick = (v, list, d) => (list.includes(v) ? v : d);
let _seArea = {}; function seArea(n) { if (_seArea[n]) return _seArea[n]; let s = 0; const M = 400; for (let i = 0; i < M; i++) { const x = (i + 0.5) / M; s += Math.pow(1 - Math.pow(x, n), 1 / n); } return (_seArea[n] = 4 * s / M); } // area for half axes 1,1

// resolve a builder into plain numbers (no meshes). Exported for tests/UI.
export function layout(builder) {
  const b = builder || {}, nose = pick(b.nose, ['cone', 'ogive', 'round', 'flat'], 'ogive'), body = pick(b.body, ['round', 'oval', 'box'], 'round'), tail = pick(b.tail, ['point', 'round', 'blunt'], 'point'), wing = pick(b.wing, ['none', 'straight', 'swept', 'delta'], 'none'), fins = pick(b.fins, ['none', 'tee', 'cross'], 'cross');
  const raw = { ...defaultParams(), ...(b.p || {}) }, p = {};
  for (const k in PARAMS) { const q = PARAMS[k]; if (q.type === 'choice') p[k] = q.options.some(o => o.id === raw[k]) ? raw[k] : q.default; else { const v = Number(raw[k]); p[k] = clamp(Number.isFinite(v) ? v : q.default, q.min, q.max); } }
  const n = body === 'box' ? 4.5 : 2, wheels = p.wheels >= 0.5, wtc = p.profile === 'plate' ? 0.02 : 0.12;
  let D = p.diameter; const hr = body === 'round' ? 1 : p.heightRatio;
  const est = () => {
    const H = D * hr, a = D * H * (n === 2 ? Math.PI / 4 : seArea(n) / 4);
    let f = a; if (wing !== 'none') f += Math.max(p.span, D + 0.06) * wtc * p.chord;
    if (fins !== 'none') f += 2 * (D + 2 * p.size) * 0.06 * Math.min(0.5, 1.4 * p.size + 0.03);
    if (wheels) f += 2 * (2 * Math.min(0.5 * H, 0.2) * 0.08);
    return f;
  };
  for (let i = 0; i < 60 && est() > 0.215 && D > 0.04; i++) D = Math.max(0.04, D * 0.96);
  const W = D, Hh = D * hr, Rm = Math.min(W, Hh) / 2;
  let nl = p.noseLen, Lb = p.length, tl = tail === 'point' ? clamp(Rm / Math.tan(p.boattailDeg * Math.PI / 180), 0.5 * Rm, 0.9) : tail === 'round' ? 1.5 * Rm : 0.9 * Rm;
  if (nose === 'flat') nl = Math.min(nl, 0.3);
  if (nl + Lb + tl > 1.598) { Lb = Math.max(0.05, 1.598 - nl - tl); if (nl + Lb + tl > 1.6) { const f = (1.598 - Lb) / (nl + tl); nl *= f; tl *= f; } }
  const Ltot = nl + Lb + tl, x0 = -Ltot / 2, xb0 = x0 + nl, xt0 = xb0 + Lb, xEnd = x0 + Ltot;
  let wingL = null;
  if (wing !== 'none') {
    const span = clamp(Math.max(p.span, W + 0.06), 0.1, 1.6), semi = span / 2, cr = Math.min(p.chord, Math.max(0.04, Lb)), ct = wing === 'delta' ? 0.01 * cr : wing === 'swept' ? 0.45 * cr : 0.8 * cr;
    const le = xb0 + p.posX * Math.max(0, Lb - cr); let dx = wing === 'delta' ? cr - ct : wing === 'swept' ? semi * Math.tan(32 * Math.PI / 180) : 0;
    dx = clamp(Math.min(dx, xEnd - le - ct), 0, 1e9);
    wingL = { span, cr, ct, le, sweepDeg: Math.atan2(dx, semi) * 180 / Math.PI, dihedralDeg: wing === 'swept' ? 2 : 0, profile: p.profile, tc: wtc };
  }
  let finL = null;
  if (fins !== 'none') {
    const cr = clamp(1.4 * p.size + 0.03, 0.05, Math.min(0.5, 0.5 * Ltot)), ct = 0.45 * cr, dx = Math.min(p.size * Math.tan(35 * Math.PI / 180), cr - ct);
    finL = { size: p.size, cr, ct, dx, sweepDeg: Math.atan2(Math.min(dx, cr - ct), Math.max(p.size, 0.02)) * 180 / Math.PI };
  }
  return { nose, body, tail, wing, fins, p, n, W, Hh, nl, Lb, tl, Ltot, x0, xb0, xt0, xEnd, wingL, finL, wheels };
}


// ---- bảng màu sơn theo kiểu mô hình (tông 0 sơn chính, 1 sơn phụ / viền, 2 đen, 7 sơn phụ thứ hai)
function paletteOf(Lo) {
  if (Lo.wheels) return { 0: 0x34475E, 1: 0xB5BAC0 };
  if (Lo.wing !== 'none') return { 0: 0xEEEFF0, 1: 0xB4B9BF, 7: 0x1D3F73 };
  if (Lo.fins !== 'none') return { 0: 0xEDECE8, 1: 0xC8102E, 7: 0x2A2E34 };
  return { 0: 0x9CC3D8, 1: 0xE9E7E1 };
}
export function buildFromBuilder(builder) {
  const Lo = layout(builder);
  // vertex budget (<= 50 000): normally edge <= 1.5 % of length; only for extreme size combinations the mesh is coarsened
  for (const k of [1, 1.2, 1.45, 1.8, 2.2, 2.8, 3.6]) { const parts = buildParts(Lo, k); let nv = 0; for (const q of parts) nv += q.geometry.attributes.position.count; if (nv <= 40000 || k === 3.6) return parts; }
}
const TAU_DEG = Math.PI / 180;
// thân kín một khối (mũi + thân + đuôi) bằng loft: rows [x, đỉnh, đáy, rộng]
function bodyLoft(F, Lo, tone) {
  const { nose, tail, W, Hh, nl, Lb, tl, n, p } = Lo, Rm = Math.min(W, Hh) / 2, rows = [], cuts = [];
  const push = (x, f) => { if (!rows.length || x > rows[rows.length - 1][0] + 1e-9) rows.push([x, Hh / 2 * f, -Hh / 2 * f, W * f]); };
  const fn = profiles.nose(nose, nl, Rm); for (let i = 0; i <= 26; i++) { const t = (i / 26) ** 1.5; push(t * nl, Math.max(0, fn(t))); }
  push(nl + Lb, 1);
  const ft = profiles.tail(tail, tl, Rm, p.boattailDeg); for (let i = 1; i <= 18; i++) { const t = i / 18; push(nl + Lb + t * tl, Math.max(0, ft(t))); }
  if (nose === 'cone' || nose === 'flat') cuts.push(nl);
  if (tail !== 'round' && Lb > 1e-3) cuts.push(nl + Lb);
  const xe = nl + Lb + tl;
  return solid(F, rows, { id: 'b_body', role: 'body', n, creases: cuts, capStart: true, capEnd: true,
    toneFn: (x, y, z, nx, ny) => tone(x + xe / 2, ny) });
}
// thân xe: hull có vòm bánh, kính, đèn, gương, bánh có vành; dựng trong khung thật 1,8 m rộng
function carParts(Lo, k) {
  const { W, Hh, Ltot, nose, tail, body } = Lo, s = W / 1.8, Lr = Ltot / s, Hr = Hh / s, w = 0.9;
  const F = frame(s, -Lr / 2, -Hr / 2, Lr, k), P = [];
  const R = Math.min(0.24 * Hr, 0.075 * Lr), Ra = 1.2 * R, fl = 0.32 * R, xf = 0.2 * Lr, xr = 0.79 * Lr;
  const topN = { round: [[0, .5], [.06, .56], [.2, .62], [.31, .66], [.34, .74], [.44, .95], [.51, 1]], cone: [[0, .36], [.1, .46], [.25, .57], [.38, .63], [.42, .72], [.5, .94], [.57, 1]],
    ogive: [[0, .42], [.08, .53], [.22, .61], [.34, .65], [.38, .73], [.47, .95], [.54, 1]], flat: [[0, .6], [.02, .67], [.15, .75], [.24, .8], [.28, .92], [.33, 1]] }[nose];
  const topT = { point: [[.6, 1], [.7, .96], [.8, .83], [.9, .68], [1, .6]], round: [[.66, 1], [.76, .97], [.85, .85], [.9, .72], [.95, .66], [1, .62]], blunt: [[.8, 1], [.9, .975], [.95, .92], [1, .84]] }[tail];
  const topPts = [...topN, ...topT.filter(q => q[0] > topN[topN.length - 1][0] + 0.02)].map(([u, v]) => [u * Lr, v * Hr]);
  const topC = curve(topPts), beltRaw = [[0, .4], [.3, .55], [.6, .6], [1, .55]].map(([u, v]) => [u * Lr, v * Hr]), beltC = curve(beltRaw);
  const belt = [0, .05, .1, .2, .3, .4, .5, .6, .7, .8, .9, .95, 1].map(u => [u * Lr, Math.min(beltC(u * Lr), topC(u * Lr) - 0.07 * Hr)]);
  const sq = body === 'box' ? 0 : body === 'oval' ? 1 : 2, ledge = [.12, .18, .24][sq] * 1, tumble = [.22, .36, .5][sq];
  const half = [[0, .7 * w], [.1 * Lr, .93 * w], [.5 * Lr, w], [.9 * Lr, .92 * w], [Lr, .8 * w]], floorY = [[0, fl + .1 * R], [.1 * Lr, fl], [.9 * Lr, fl], [Lr, fl + .1 * R]];
  const arches = [{ x: xf, y: R, R: Ra }, { x: xr, y: R, R: Ra }], zi = 0.62, trim = () => fl + 0.12 * Hr;
  const hull = carHull(F, { L: Lr, top: topPts, belt, floor: floorY, half, arches, zi, ledge, tumble, tuck: 0.05, endF: nose === 'flat' ? 0.1 : 0.22 * Lr * 0.5, endR: tail === 'blunt' ? 0.1 : 0.18 * Lr * 0.5, n: 80, vsub: 2, spp: 4, roofR: sq === 0 ? .06 : .12, toneFn: archTone(arches, zi, trim) });
  P.push(hull);
  const ww = 0.68 * R, track = 0.78 / 0.9 * w;
  for (const [i, x] of [xf, xr].entries()) for (const sz of [-1, 1]) P.push(wheel(F, `b_wheel_${i ? 'r' : 'f'}${sz < 0 ? 'L' : 'R'}`, x, R, sz * track, R, ww, { rim: 0.68, spokes: 5 }));
  const G = (dir, corners, extra = {}) => P.push(panel(F, hull, { dir, corners, ...extra }));
  const wsU = { round: [.33, .5], cone: [.4, .56], ogive: [.35, .53], flat: [.27, .34] }[nose], bl = { point: [.6, .88], round: [.7, .86], blunt: [.8, .93] }[tail];
  const roofEnd = topT[0][0];
  G([0, -1, 0], [[wsU[0] * Lr, -.62 * w], [wsU[1] * Lr, -.52 * w], [wsU[1] * Lr, .52 * w], [wsU[0] * Lr, .62 * w]]);
  if (tail !== 'blunt') G([0, -1, 0], [[bl[0] * Lr, -.5 * w], [bl[1] * Lr, -.55 * w], [bl[1] * Lr, .55 * w], [bl[0] * Lr, .5 * w]]);
  else G([-1, 0, 0], [[.86 * Hr, -.55 * w], [.86 * Hr, .55 * w], [.97 * Hr, .5 * w], [.97 * Hr, -.5 * w]].map(([a, b]) => [Math.min(a, topC(Lr - 0.02) - 0.08 * Hr), b]), { round: 4 });
  const xa = (wsU[1] + 0.02) * Lr, xb = Math.min(roofEnd + 0.12, bl[0] + 0.08) * Lr, xm = (xa + xb) / 2, yb = x => beltC(x) + 0.025 * Hr, yt = x => topC(x) - 0.04 * Hr;
  if (xb > xa + 0.1) {
    for (const [a, b] of [[xa, xm - 0.03 * Lr], [xm + 0.03 * Lr, xb]]) G([0, 0, -1], [[a, yb(a)], [b, yb(b)], [b - .02 * Lr, yt(b)], [a + .02 * Lr, yt(a)]], { mirror: true });
    G([0, 0, -1], [[xm - .008 * Lr, yb(xm)], [xm + .008 * Lr, yb(xm)], [xm + .008 * Lr, yt(xm)], [xm - .008 * Lr, yt(xm)]], { mirror: true, tone: 2, round: 2, res: [2, 14], off: 0.0005 });
  }
  const yF = Math.max(topC(0.05 * Lr) - 0.05 * Hr, fl + .2 * Hr), tE = topC(Lr * 0.995);
  G([1, 0, 0], [[yF - .14 * Hr, .5 * w], [yF - .14 * Hr, .86 * w], [yF, .82 * w], [yF, .55 * w]], { mirror: true, tone: 4, round: 3 });
  G([-1, 0, 0], [[tE - .2 * Hr, .5 * w], [tE - .2 * Hr, .8 * w], [tE - .06 * Hr, .76 * w], [tE - .06 * Hr, .54 * w]], { mirror: true, tone: 5, round: 3 });
  G([1, 0, 0], [[fl + .16 * Hr, -.42 * w], [fl + .16 * Hr, .42 * w], [fl + .3 * Hr, .36 * w], [fl + .3 * Hr, -.36 * w]], { tone: 2, round: 4 });
  for (const sz of [-1, 1]) P.push(blob(F, { id: 'b_mirror_' + (sz < 0 ? 'L' : 'R'), x: xa - .01 * Lr, y: beltC(xa) + .05 * Hr + 0.07, z: sz * 1.0 * w, len: 0.2, w: 0.12, h: 0.11, tone: 0 }));
  return P;
}
function buildParts(Lo, k) {
  const { n, W, Hh, nl, Lb, tl, Ltot, x0, xb0, xt0, xEnd } = Lo, parts = [];
  const ref = Math.max(Ltot, 0.5) * k;
  if (Lo.wheels) parts.push(...carParts(Lo, k));
  else {
    // đuôi cụt trên thân tròn / bầu dục: vòi phun hình chuông; kính buồng lái cho máy bay; cửa sổ tròn cho tên lửa
    const Rm = Math.min(W, Hh) / 2, rEnd = Rm * Math.max(0, profiles.tail(Lo.tail, tl, Rm, Lo.p.boattailDeg)(1));
    const nozzle = Lo.tail === 'blunt' && Lo.body !== 'box' && rEnd > 0.012 ? Math.min(1.1 * rEnd, (1.598 - Ltot) / 0.75) : 0, noz = nozzle > 0.015;
    const F = frame(1, -Ltot / 2, 0, Ltot, k), plane = Lo.wing !== 'none', rocket = !plane && Lo.fins !== 'none';
    const tone = (xr, ny) => (plane ? (ny < -0.45 && xr > nl ? 1 : 0) : rocket && (Lo.nose === 'ogive' || Lo.nose === 'cone') && xr < nl ? 1 : 0);
    const hullBody = bodyLoft(F, Lo, tone); parts.push(hullBody);
    if (noz) parts.push(bellNozzle(F, { id: 'b_nozzle', x: Ltot - 0.25 * nozzle, len: nozzle, r0: 0.55 * rEnd, r1: 0.9 * rEnd, tone: 6 }));
    if (plane && Lb > 0.05) { const len = Math.min(0.3 * (nl + Lb), 0.3 * Ltot); parts.push(canopy(F, { id: 'b_canopy', x: nl - 0.3 * len, len, w: 0.62 * W, h: 0.62 * Hh, y: 0.3 * Hh, peak: 0.45, tone: 3 })); }
    if (rocket && Lb > 0.12 && Lo.body !== 'box') {
      const r = Math.min(0.22 * Rm, 0.03), xp = nl + Math.min(0.3 * Lb, 0.2);
      parts.push(panel(F, hullBody, { dir: [0, 0, -1], mirror: true, tone: 3, round: 8, off: 0.0005, corners: [[xp - r, -r], [xp + r, -r], [xp + r, r], [xp - r, r]] }));
    }
  }
  if (Lo.wingL) { const w = Lo.wingL; parts.push(make('wing', { profile: w.profile, span: w.span, rootChord: w.cr, tipChord: w.ct, sweepDeg: w.sweepDeg, dihedralDeg: w.dihedralDeg, rootLE: [w.le, 0, 0], ref, id: 'b_wing', tone: 1 })); }
  if (Lo.finL) {
    const f = Lo.finL, ang = Lo.fins === 'cross' ? [0, 90, 180, 270] : [0];
    ang.forEach(a => { const rad = a % 180 === 0 ? Hh / 2 : W / 2, sp = rad + f.size, sw = Math.atan2(Math.min(sp * Math.tan(35 * Math.PI / 180), f.cr - f.ct), sp) * 180 / Math.PI; parts.push(make('fin', { span: sp, rootChord: f.cr, tipChord: f.ct, sweepDeg: sw, angleDeg: a, rootLE: [xEnd - f.cr, 0, 0], ref, id: 'b_fin' + a, tone: Lo.wing !== 'none' ? 7 : 1 })); });
    if (Lo.fins === 'tee') {
      const cs = 0.6 * f.cr, cts = 0.4 * cs, span = clamp(2.2 * f.size, 0.1, 0.7), dxs = Math.min(0.5 * span * Math.tan(30 * Math.PI / 180), cs - cts);
      parts.push(make('wing', { role: 'fin', profile: '0012', tc: 0.06, span, rootChord: cs, tipChord: cts, sweepDeg: Math.atan2(dxs, span / 2) * 180 / Math.PI, rootLE: [xEnd - cs, Hh / 2 + f.size - 0.004, 0], ref, id: 'b_stab', tone: Lo.wing !== 'none' ? 7 : 1 }));
    }
  }
  parts.palette = paletteOf(Lo);
  return parts;
}
