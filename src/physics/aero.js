// P1 - Khí động lực: hệ số, lực, chế độ dòng. Hàm thuần, không DOM.
import { GAMMA } from './atmo.js';

const PI = Math.PI, D2R = PI / 180, GRAV = 9.81;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);

/* ---------- khí nén ---------- */
export function pitotRatio(M) {
  M = Math.max(0, M);
  if (M < 1) return Math.pow(1 + 0.2 * M * M, 3.5);
  const g = GAMMA;
  return Math.pow((g + 1) / 2 * M * M, g / (g - 1)) * Math.pow((g + 1) / (2 * g * M * M - (g - 1)), 1 / (g - 1));
}
export function dragRiseK(M, m) {
  if (!m) return 1;
  if (M <= m.mdd) return 1;
  if (M < 1.05) return lerp(1, m.kpeak, sstep((M - m.mdd) / (1.05 - m.mdd)));
  if (M < 3) return lerp(m.kpeak, m.kinf, sstep((M - 1.05) / 1.95));
  return m.kinf;
}

/* ---------- hệ số cho các dạng cơ bản ---------- */
export function sphereCD(Re) { // Morrison (2013)
  Re = Math.max(Re, 1e-2);
  const x = Re / 263000;
  return 24 / Re + 2.6 * (Re / 5) / (1 + Math.pow(Re / 5, 1.52))
    + 0.411 * Math.pow(x, -7.94) / (1 + Math.pow(x, -8.0)) + 0.25 * (Re / 1e6) / (1 + Re / 1e6) + Math.pow(Re, 0.8) / 461000;
}
const CYL = [[0.1, 58], [1, 10], [10, 2.8], [100, 1.4], [1e3, 1.0], [1e4, 1.15], [1e5, 1.2], [2e5, 1.0], [3e5, 0.9], [5e5, 0.32], [1e6, 0.35], [3e6, 0.65], [1e7, 0.75]];
export function cylinderCD(Re) {
  Re = clamp(Re, CYL[0][0], CYL[CYL.length - 1][0]);
  for (let i = 1; i < CYL.length; i++) if (Re <= CYL[i][0]) {
    const [r0, c0] = CYL[i - 1], [r1, c1] = CYL[i];
    const t = Math.log(Re / r0) / Math.log(r1 / r0);
    return Math.exp(Math.log(c0) + t * (Math.log(c1) - Math.log(c0)));
  }
  return CYL[CYL.length - 1][1];
}
const PLATE = [[0, 0], [10, 0.45], [20, 0.85], [30, 1.15], [40, 1.25], [50, 1.17], [60, 1.15], [90, 1.17]];
export function plateCoef(alphaDeg) {
  const th = clamp(90 - Math.abs(alphaDeg), 0, 90);
  let CN = PLATE[PLATE.length - 1][1];
  for (let i = 1; i < PLATE.length; i++) if (th <= PLATE[i][0]) {
    const [t0, c0] = PLATE[i - 1], [t1, c1] = PLATE[i];
    CN = lerp(c0, c1, (th - t0) / (t1 - t0)); break;
  }
  const s = alphaDeg < 0 ? -1 : 1;
  return { CN, CD: CN * Math.sin(th * D2R), CL: s * CN * Math.cos(th * D2R) };
}
// Hệ số ma sát tấm phẳng: tầng (Blasius) -> chuyển tiếp -> rối (Schlichting hỗn hợp)
export function cfBlend(Re) {
  Re = Math.max(Re, 100);
  const lam = 1.328 / Math.sqrt(Re);
  const lg = Math.log10(Re);
  const tur = Math.max(0, 0.455 / Math.pow(lg, 2.58) - 1700 / Re);
  const w = sstep((lg - 5.4) / 0.5);
  return { cf: lerp(lam, tur, w), w };
}

/* ---------- tham chiếu ---------- */
function refLength(def, info) {
  let v;
  if (def.Lref === 'D') v = info.D;
  else if (def.Lref === 'chord') {
    let best = null;
    for (const w of info.wings || []) if (!best || w.S > best.S) best = w;
    v = best ? best.chord : info.L;
  } else v = info.L;
  return Math.max(fin(v), 1e-3);
}
function refArea(def, info) {
  return Math.max(fin(def.Aref === 'planform' ? info.planform : info.frontal), 1e-6);
}
function sepBlend(def, Re) {
  const s = def.sep, rc = s.reCrit || 3e5;
  const t = sstep((Re - 0.7 * rc) / (0.6 * rc));
  return { t, sepDeg: lerp(s.lamDeg, s.turbDeg, t), cpb: lerp(s.cpbLam, s.cpbTurb, t) };
}
function blState(t) { return t < 0.02 ? 'laminar' : t > 0.98 ? 'turbulent' : 'transition'; }

/* ---------- buildup ---------- */
function matchLifting(def, id) {
  for (const e of def.lifting || []) {
    const p = e.partId;
    if (p == null || p === '*') return e;
    if (p.endsWith('*')) { if (String(id).startsWith(p.slice(0, -1))) return e; }
    else if (p === id) return e;
  }
  return null;
}

function zeroPieces(def, info, air, U, Aref) {
  const b = info.body || {};
  const L = fin(b.L), D = fin(b.D), Sw = fin(b.wetted);
  let bodyF = 0, bodyForm = 0, nose = 0, base = 0;
  if (L > 1e-6 && Sw > 1e-9) {
    const cfB = cfBlend(air.rho * U * L / air.mu).cf;
    const f = clamp(L / Math.max(D, 1e-6), 3, 60);
    const FF = 1 + 60 / (f * f * f) + f / 400;
    bodyF = cfB * Sw / Aref; bodyForm = bodyF * (FF - 1);
    const dA = PI / 4 * D * D;
    if (def.nose === 'blunt') nose = 0.75 * (b.noseArea > 0 ? b.noseArea : dA) / Aref;
    else if (def.nose === 'sharp' && def.noseHalfDeg > 20) nose = 0.8 * Math.pow(Math.sin(def.noseHalfDeg * D2R), 2) * dA / Aref;
    const cdfb = Math.max((bodyF + bodyForm) * Aref / Math.max(dA, 1e-9), 0.005); // CD ma sát+hình dạng của thân trước, theo diện tích chính diện
    const cdBase = 0.029 / Math.sqrt(cdfb); // Hoerner
    let baseA = fin(b.baseArea);
    const tb = fin(def.boattailDeg);
    if (tb > 15) baseA += dA * 0.5 * Math.min(1, (tb - 15) / 20); // vát đuôi dốc: tách dòng một phần
    base = cdBase * baseA / Aref;
  }
  let sfric = 0, sform = 0;
  for (const w of info.wings || []) {
    const ls = matchLifting(def, w.id);
    const tc = fin(w.tc, ls ? ls.tc : 0.1);
    const c = cfBlend(air.rho * U * Math.max(fin(w.chord), 1e-3) / air.mu).cf;
    const f = c * fin(w.wetted, 2.04 * fin(w.S)) / Aref;
    sfric += f; sform += f * (2 * tc + 60 * Math.pow(tc, 4));
  }
  return { bodyF, bodyForm, nose, base, sfric, sform };
}

function surfaceLift(w, ls, air, U, alpha, M, Aref) {
  const Rec = air.rho * U * Math.max(fin(w.chord), 1e-3) / air.mu;
  const spanning = !!w.spanning;
  const S = fin(w.S);
  const AR = spanning ? Infinity : (fin(w.AR) > 0 ? w.AR : (S > 0 ? w.span * w.span / S : 4));
  const share = ls.share == null ? 1 : ls.share;
  const sweep = fin(w.sweepDeg) * D2R;
  const tc = fin(w.tc, fin(ls.tc, 0.1));
  const a0 = ls.a0 || 6.0;
  const x = spanning ? 0 : a0 / (PI * AR);
  const aH = a0 / (Math.sqrt(1 + x * x) + x);                 // Helmbold
  const Mc = Math.min(M, 0.8);
  const a = aH * Math.cos(sweep) / Math.sqrt(1 - Mc * Mc);     // Prandtl-Glauert
  const lg = Math.log10(Math.max(Rec, 1) / 1e5);
  const sharp = !!ls.sharpLE;
  const CLmax = sharp ? 0.8 : clamp(0.9 + 0.25 * lg, 0.9, 1.6);
  const as0 = sharp ? 9 : clamp(15 + 1.5 * (lg - 1), 12, 17);  // góc tách dòng (độ)
  const ap = alpha - fin(ls.alpha0Deg);                          // góc từ lúc lực nâng bằng 0
  const sg = ap < 0 ? -1 : 1, aa = Math.abs(ap);
  const asSide = as0 - sg * fin(ls.alpha0Deg);
  const lin = a * aa * D2R;
  const n = 8;
  const CLs = sg * Math.pow(Math.pow(Math.max(lin, 1e-12), -n) + Math.pow(CLmax, -n), -1 / n);
  const wSt = sstep((aa - asSide) / 4);
  const CN = 1.98 * Math.sin(aa * D2R) / (1 + (spanning ? 0 : 2 / AR));
  const CLpost = sg * CN * Math.cos(aa * D2R), CDpost = CN * Math.sin(aa * D2R);
  const CLsub = lerp(CLs, CLpost, wSt);
  const wSup = sstep((M - 0.9) / 0.3);
  const den = Math.sqrt(Math.max(M * M - 1, 0.44));
  const apr = ap * D2R;
  const CLsup = 4 * apr / den;
  const CL = lerp(CLsub, CLsup, wSup);
  const k = sharp ? 1 : 0.9;
  const sub = (1 - wSup);
  const e = ls.e || 0.85;
  const induced = spanning ? 0 : sub * (1 - wSt) * CLs * CLs / (PI * e * AR);
  const profile = sub * (1 - wSt) * 0.012 * CLs * CLs;
  const post = sub * wSt * CDpost;
  const wave = wSup * (4 * apr * apr * share + 4 * k * tc * tc) / den;
  const r = S / Aref;
  return {
    CL: CL * share, wCL: CL * share * r, wCDi: induced * share * r, wCDp: (profile * share + post * share) * r, wCDw: wave * r,
    wSt, frac: sstep((aa - 0.5 * asSide) / (0.5 * asSide + 4)), S, share
  };
}

function buildupCoef(def, info, air, U, alpha, M, Re, Aref, Lref) {
  const ar = alpha * D2R, sg = alpha < 0 ? -1 : 1;
  const z = zeroPieces(def, info, air, U, Aref);
  let s = 1;
  if (def.cdRef > 0) {
    const Uref = (def.reRef || 1e6) * air.mu / (air.rho * Lref);
    const zr = zeroPieces(def, info, air, Uref, Aref);
    const sum = zr.bodyF + zr.bodyForm + zr.nose + zr.base + zr.sfric + zr.sform;
    if (sum > 1e-6) s = def.cdRef / sum;
  }
  const K = dragRiseK(M, def.mach), wS = sstep((M - 0.9) / 0.3), Ks = 1 + (K - 1) * (1 - wS);
  const bodyNo = (z.bodyF + z.bodyForm + z.nose + z.base) * s, surfNo = (z.sfric + z.sform) * s;
  let CD = bodyNo * K + surfNo * Ks;
  let CDw = bodyNo * (K - 1) + surfNo * (Ks - 1);
  const CDf = (z.bodyF + z.sfric) * s;
  let CDi = 0, CL = 0, stallW = 0, fracW = 0, sArea = 0;
  const surfacesCL = [];
  for (const w of info.wings || []) {
    const ls = matchLifting(def, w.id);
    if (!ls) continue;
    const r = surfaceLift(w, ls, air, U, alpha, M, Aref);
    surfacesCL.push({ id: w.id, CL: r.CL });
    CL += r.wCL; CDi += r.wCDi; CD += r.wCDi + r.wCDp + r.wCDw; CDw += r.wCDw;
    if (r.share > 0 && r.S > 0) { stallW += r.wSt * r.S; fracW += r.frac * r.S; sArea += r.S; }
  }
  if (sArea > 0) { stallW /= sArea; fracW /= sArea; }
  const b = info.body || {};
  if (def.clRef != null) { // xe đua: lực ép (âm) + 0.04 mỗi độ
    CL += def.clRef + 0.04 * alpha;
  } else if (fin(b.L) > 1e-6) { // thân thon: Allen
    const sideB = Math.min(fin(info.sideArea), fin(b.L) * fin(b.D));
    const sa = Math.sin(ar);
    const CN = Math.sin(2 * ar) * Math.cos(ar / 2) * fin(b.baseArea) / Aref + sg * 1.2 * sa * sa * sideB / Aref;
    CL += CN * Math.cos(ar); CD += CN * sa;
  }
  const sb = sepBlend(def, Re);
  let sepDeg = sb.sepDeg, cpb = sb.cpb;
  sepDeg = lerp(sepDeg, 90, fracW); cpb = lerp(cpb, -0.7, fracW);
  const bl = blState(cfBlend(Re).w);
  let wake, St = 0, amp = 0;
  const stalled = stallW > 0.3;
  if (stalled) { wake = 'irregular'; amp = 0.1 * stallW; }
  else if (def.st > 0) {
    if (Re >= def.wakeMinRe) { wake = 'street'; St = def.st; amp = def.clAmp || 0; }
    else wake = Re >= 10 ? 'bubble' : 'none';
  } else wake = sepDeg < 150 ? 'irregular' : 'none';
  if (wake === 'irregular' && !stalled) amp = 0.5 * (def.clAmp || 0);
  return { CD, CL, CDf, CDi, CDw, bl, wake, St, sepDeg, cpb, clAmp: amp, surfacesCL };
}

/* ---------- đánh giá ---------- */
export function evaluate({ aeroDef: def, info, air, U, alphaDeg }) {
  U = Number.isFinite(U) && U > 0 ? U : 0;
  const alpha = clamp(Number.isFinite(alphaDeg) ? alphaDeg : 0, -45, 45);
  info = info || {};
  const Lref = refLength(def, info), Aref = refArea(def, info);
  const Re = air.rho * U * Lref / air.mu, M = U / air.a, q = 0.5 * air.rho * U * U;
  const ReC = Math.max(Re, 1e-2);
  let r;
  if (def.kind === 'sphere' || def.kind === 'cylinder') {
    const cyl = def.kind === 'cylinder';
    const K = dragRiseK(M, def.mach);
    const base = cyl ? cylinderCD(ReC) : sphereCD(ReC);
    const CD = base * K;
    const sb = sepBlend(def, ReC);
    let wake = 'none', St = 0;
    if (cyl) {
      if (Re < 5) wake = 'none';
      else if (Re < 47) wake = 'bubble';
      else if (Re < 180) { wake = 'street'; St = 0.212 * (1 - 21.2 / Re); }
      else if (Re < 2e5) { wake = 'street'; St = 0.198 * (1 - 19.7 / Re); }
      else if (Re < 3e5) { wake = 'street'; St = lerp(0.198, 0.3, sstep((Re - 2e5) / 1e5)); }
      else if (Re < 3e6) { wake = 'irregular'; St = 0.3; }
      else { wake = 'street'; St = 0.27; }
    } else {
      if (Re < 20) wake = 'none';
      else if (Re < 280) wake = 'bubble';
      else if (sb.t > 0.5) { wake = 'irregular'; St = 0.2; }
      else { wake = 'street'; St = def.st || 0.18; }
    }
    const amp = (wake === 'street' || wake === 'irregular') ? lerp(def.clAmp, def.clAmpSuper == null ? def.clAmp : def.clAmpSuper, sb.t) : 0;
    r = { CD, CL: 0, CDf: Math.min(CD, base * 0.667 / (1 + Re / 100)), CDi: 0, CDw: CD * (1 - 1 / K), bl: blState(sb.t), wake, St, sepDeg: sb.sepDeg, cpb: sb.cpb, clAmp: amp, surfacesCL: [] };
  } else if (def.kind === 'plate') {
    const K = dragRiseK(M, def.mach);
    const pc = plateCoef(alpha);
    const CD = pc.CD * K;
    let wake = 'none', St = 0;
    if (Re >= (def.wakeMinRe || 100)) { wake = 'street'; St = def.st || 0.15; } else if (Re >= 10) wake = 'bubble';
    r = { CD, CL: pc.CL, CDf: 0, CDi: 0, CDw: CD * (1 - 1 / K), bl: blState(cfBlend(Re).w), wake, St, sepDeg: def.sep.lamDeg, cpb: def.sep.cpbLam, clAmp: wake === 'street' ? def.clAmp : 0, surfacesCL: [] };
  } else r = buildupCoef(def, info, air, U, alpha, M, ReC, Aref, Lref);

  const CD = clamp(fin(r.CD), 0, 1000), CL = clamp(fin(r.CL), -10, 10);
  const CDf = clamp(fin(r.CDf), 0, CD), CDi = clamp(fin(r.CDi), 0, CD), CDw = clamp(fin(r.CDw), 0, CD);
  const CDp = Math.max(0, CD - CDf - CDi - CDw);
  const FD = q * CD * Aref, FL = q * CL * Aref;
  const Dshed = fin(info.D) > 1e-6 ? info.D : Math.sqrt(Aref);
  const St = clamp(fin(r.St), 0, 1);
  const p0 = air.p * pitotRatio(M);
  const out = {
    Re, M, q, p0, T0: air.T * (1 + 0.2 * M * M),
    CD, CL, CDf, CDp, CDi, CDw, FD, FL,
    LD: Math.abs(FD) < 1e-6 ? null : clamp(FL / FD, -200, 200),
    St, fShed: St * U / Dshed, Dshed,
    regime: { flow: M > 1 ? 'supersonic' : M >= 0.8 ? 'transonic' : 'subsonic', bl: r.bl, wake: r.wake },
    sepDeg: clamp(fin(r.sepDeg, 90), 0, 180), cpb: clamp(fin(r.cpb, -0.2), -2, 0.5),
    Aref, ArefKind: def.Aref === 'planform' ? 'planform' : 'frontal', Lref,
    power: FD * U, buoyancy: air.rho * GRAV * fin(info.volume),
    machAngleDeg: M > 1 ? Math.asin(1 / M) / D2R : null,
    surfacesCL: r.surfacesCL.map((s) => ({ id: s.id, CL: clamp(fin(s.CL), -10, 10) })),
    clAmp: clamp(fin(r.clAmp), 0, 2)
  };
  return out;
}

export function fluct(res, phase) {
  const a = res && res.clAmp ? res.clAmp : 0;
  return { dCL: a * Math.sin(phase), dCD: 0.1 * a * Math.sin(2 * phase) };
}

export function curve(aeroDef, info, air, alphaDeg, Umax, n) {
  n = Math.max(2, Math.floor(n || 40));
  const out = [];
  for (let i = 0; i < n; i++) {
    const U = Umax * i / (n - 1);
    const r = evaluate({ aeroDef, info, air, U, alphaDeg });
    out.push({ U, FD: r.FD, FL: r.FL });
  }
  return out;
}
