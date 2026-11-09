// src/geom/catalog.js  (P3)  "Assemble your own model": slots, templates, buildFromBuilder(builder) -> parts.
// builder = {nose, body, tail, wing, fins, p:{noseLen,length,diameter,heightRatio,boattailDeg,wheels,span,chord,profile,posX,size}}
// All lengths in metres, angles in degrees. posX = fraction (0..1) of the free body length where the wing leading edge sits.
// Every combination is valid: sizes are clamped to SPEC section 3 (length <= 1.6, span <= 1.6, frontal <= 0.23 m^2).
// Model is centred in x (middle of nose..tail at x = 0), nose toward -x, axis on y = z = 0.
import { make } from './parts.js';

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
  car: { label: 'Ô tô', builder: { nose: 'round', body: 'box', tail: 'blunt', wing: 'none', fins: 'none', p: { ...defaultParams(), noseLen: 0.2, length: 0.7, diameter: 0.34, heightRatio: 0.5, boattailDeg: 5, wheels: 1 } } },
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
  if (nl + Lb + tl > 1.6) { Lb = Math.max(0.05, 1.6 - nl - tl); if (nl + Lb + tl > 1.6) { const f = (1.6 - Lb) / (nl + tl); nl *= f; tl *= f; } }
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

export function buildFromBuilder(builder) {
  const Lo = layout(builder);
  // vertex budget (<= 50 000): normally edge <= 1.5 % of length; only for extreme size combinations the mesh is coarsened
  for (const k of [1, 1.2, 1.45, 1.8, 2.2, 2.8, 3.6]) { const parts = buildParts(Lo, Math.max(Lo.Ltot, 0.5) * k); let nv = 0; for (const q of parts) nv += q.geometry.attributes.position.count; if (nv <= 47000 || k === 3.6) return parts; }
}
function buildParts(Lo, ref) {
  const { n, W, Hh, nl, Lb, tl, Ltot, x0, xb0, xt0, xEnd } = Lo, parts = [];
  const sec = { width: W, height: Hh, n };
  parts.push(make('nose', { ...sec, shape: Lo.nose, length: nl, x0, ref, id: 'b_nose', tone: Lo.nose === 'ogive' || Lo.nose === 'cone' ? 1 : 0 }));
  parts.push(make('body', { ...sec, length: Lb, x0: xb0, ref, id: 'b_body', tone: 0 }));
  parts.push(make('tail', { ...sec, shape: Lo.tail, length: tl, x0: xt0, boattailDeg: Lo.p.boattailDeg, ref, id: 'b_tail', tone: 0 }));
  if (Lo.wingL) { const w = Lo.wingL; parts.push(make('wing', { profile: w.profile, span: w.span, rootChord: w.cr, tipChord: w.ct, sweepDeg: w.sweepDeg, dihedralDeg: w.dihedralDeg, rootLE: [w.le, 0, 0], ref, id: 'b_wing', tone: 0 })); }
  if (Lo.finL) {
    const f = Lo.finL, ang = Lo.fins === 'cross' ? [0, 90, 180, 270] : [0];
    ang.forEach(a => { const rad = a % 180 === 0 ? Hh / 2 : W / 2, sp = rad + f.size, sw = Math.atan2(Math.min(sp * Math.tan(35 * Math.PI / 180), f.cr - f.ct), sp) * 180 / Math.PI; parts.push(make('fin', { span: sp, rootChord: f.cr, tipChord: f.ct, sweepDeg: sw, angleDeg: a, rootLE: [xEnd - f.cr, 0, 0], ref, id: 'b_fin' + a, tone: 1 })); });
    if (Lo.fins === 'tee') {
      const cs = 0.6 * f.cr, cts = 0.4 * cs, span = clamp(2.2 * f.size, 0.1, 0.7), dxs = Math.min(0.5 * span * Math.tan(30 * Math.PI / 180), cs - cts);
      parts.push(make('wing', { role: 'fin', profile: '0012', tc: 0.06, span, rootChord: cs, tipChord: cts, sweepDeg: Math.atan2(dxs, span / 2) * 180 / Math.PI, rootLE: [xEnd - cs, Hh / 2 + f.size - 0.004, 0], ref, id: 'b_stab', tone: 1 }));
    }
  }
  if (Lo.wheels) {
    const rw = clamp(0.5 * Hh * 0.95, 0.02, 0.2), ww = clamp(0.8 * rw, 0.02, 0.15), yw = -0.35 * Hh, zw = W / 2 - ww / 2 + 0.015;
    for (const fx of [0.22, 0.78]) for (const sz of [-1, 1]) parts.push(make('wheel', { center: [x0 + fx * Ltot, yw, sz * zw], radius: rw, width: ww, ref, id: `b_wheel_${fx}_${sz}` }));
  }
  return parts;
}
