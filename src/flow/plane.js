// src/flow/plane.js — live 2D flow on the mid-plane z = 0 (the plane of the smoke rake).
// Owns: the solver window that follows the model, the regime -> solver Reynolds number map,
// time scaling, the frame-time governor, the dye (smoke) state and the CPU copy of the
// velocity field that flow.sample() reads. The numerical work is done by a backend:
//   'gpu'  src/flow/lbm-gpu.js (WebGL2 float / half-float render targets)
//   'cpu'  src/flow/lbm.js      (reduced resolution; also what the node tests run)
// No three.js import here: the file must load in node.
import { createLBM, createDye } from './lbm.js';

export const TUN = { x0: -2.7, x1: 3.0, y0: -0.8, y1: 0.8, noz: -2.6 };
// nx, ny: lattice; dnx, dny: dye grid over the whole test section; rate: lattice steps per second budget;
// ulb: lattice speed of the free stream; cells: target cells across the bluff dimension
export const TIERS = {
  low: { nx: 256, ny: 96, dnx: 768, dny: 216, rate: 960, ulb: 0.15, cells: 24 },
  high: { nx: 384, ny: 144, dnx: 1280, dny: 360, rate: 2400, ulb: 0.13, cells: 32 },
  cpu: { nx: 128, ny: 48, dnx: 256, dny: 72, rate: 300, ulb: 0.16, cells: 12 },
};
// governor levels: grid scale and step-rate scale relative to the tier
const LEVELS = [{ g: 1, r: 1 }, { g: 1, r: 0.6 }, { g: 0.75, r: 0.6 }, { g: 0.5, r: 0.6 }];
const HEX = { white: [0.93, 0.92, 0.9], red: [0.82, 0.23, 0.18], blue: [0.18, 0.44, 0.82], orange: [0.91, 0.53, 0.16] };
const MULTI = [[0.78, 0.35, 0.29], [0.3, 0.5, 0.75], [0.85, 0.61, 0.29], [0.36, 0.64, 0.5], [0.56, 0.45, 0.72], [0.8, 0.73, 0.35]];
export const TUNE = {
  reBubble: 28, reStreet: 190, reIrregular: 600, reNone: 300,    // solver Reynolds numbers on the projected height
  slipTurb: 0.85, slipNone: 0.6,                                // wall-model slip: turbulent layer / attached streamlined flow
  cs: 0.22, tauMin: 0.512, kick: 0.02,
};
const DEG = Math.PI / 180;
const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/* ---------------------------------------------------------------------------------------- */
/* Far field (shared maths with the GLSL in lbm-gpu.js): free stream + baked potential       */
/* perturbation (model frame, faded at the edge of the baked box) + 2D bound vortices +      */
/* the Rankine-Hugoniot jump behind the shock. Velocities in units of the free-stream speed. */
/* ---------------------------------------------------------------------------------------- */
export function fieldAt(pb, mx, my, S, out) {            // model frame -> [px, py] perturbation, returns the fade
  const F = pb.field, fx = (mx - F.x0) / F.h, fy = (my - F.y0) / F.h;
  let px = 0, py = 0, fade = 0;
  if (fx > 0 && fy > 0 && fx < F.nx - 1 && fy < F.ny - 1) {
    const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0, d = F.d, o = (j0 * F.nx + i0) * 6, r = F.nx * 6;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    const ca = S.ca, sa = S.sa, g = S.gnd;
    for (let k = 0; k < 2; k++) {
      const X = w00 * d[o + k] + w10 * d[o + 6 + k] + w01 * d[o + r + k] + w11 * d[o + r + 6 + k];
      const Y = w00 * d[o + 2 + k] + w10 * d[o + 8 + k] + w01 * d[o + r + 2 + k] + w11 * d[o + r + 8 + k];
      const G = w00 * d[o + 4 + k] + w10 * d[o + 10 + k] + w01 * d[o + r + 4 + k] + w11 * d[o + r + 10 + k];
      const v = ca * X + sa * Y + g * G;
      if (k === 0) px = v; else py = v;
    }
    const ex = Math.min(fx, F.nx - 1 - fx) / (0.12 * F.nx), ey = Math.min(fy, F.ny - 1 - fy) / (0.12 * F.ny);
    fade = sm(ex) * sm(ey);
  }
  out[0] = px; out[1] = py;
  return fade;
}
function vortAt(pb, mx, my, S, out) {                    // 2D bound vortices (exact everywhere, soft core)
  const v = pb.vort; let ux = 0, uy = 0;
  for (let k = 0; k < v.length; k += 4) {
    const dx = mx - v[k], dy = my - v[k + 1]; let r2 = dx * dx + dy * dy; if (r2 < v[k + 3]) r2 = v[k + 3];
    const f = S.gnd * v[k + 2] / r2; ux += f * dy; uy -= f * dx;
  }
  out[0] = ux; out[1] = uy;
}
export function shockJump(SH, M, x, y, z, out) {         // -> gate; out = velocity jump / U (world)
  out[0] = 0; out[1] = 0; out[2] = 0;
  const dy = y - SH.ay, dz = SH.planar ? 0 : z - SH.az;
  const rho = Math.sqrt(dy * dy + dz * dz);
  let d, nx, nr, sinB;
  if (SH.type === 0) { d = (x - SH.ax) * SH.sinT - rho * SH.cosT; nx = SH.sinT; nr = -SH.cosT; sinB = SH.sinT; }
  else {
    const q = SH.tanMu * rho / SH.Rc, s = Math.sqrt(1 + q * q);
    const xs = SH.xv + SH.Rc * SH.cot2 * (s - 1), slope = (rho / SH.Rc) / s, il = 1 / Math.sqrt(1 + slope * slope);
    d = (x - xs) * il; nx = il; nr = -slope * il; sinB = il;
  }
  if (d <= 0) return 0;
  const Mn = M * sinB;
  if (Mn > 1) {
    const r = 2.4 * Mn * Mn / (0.4 * Mn * Mn + 2);
    const ell = 0.4 * rho + 0.5 * SH.Rn + 0.02;
    const k = -(1 - 1 / r) * sinB * Math.exp(-d / ell) / (1 + rho / SH.far);
    const ir = rho > 1e-9 ? 1 / rho : 0;
    out[0] = k * nx; out[1] = k * nr * dy * ir; out[2] = k * nr * dz * ir;
  }
  return d >= 0.02 ? 1 : sm(d / 0.02);
}
// Far field of the 2D section: dipole of the equivalent ellipse (semi-axes a, b; exact for an ellipse:
// mu = (a + b)/2 * (b Ux + i a Uy)), finite inside the clamp radius. Model frame, unit free stream (ux, uy).
export function dipoleAt(dp, mx, my, ux, uy, out) {
  const dx = mx - dp.xc, dy = my - dp.yc, k = 0.5 * (dp.a + dp.b), mr = k * dp.b * ux, mi = k * dp.a * uy;
  let r2 = dx * dx + dy * dy; if (r2 < dp.rc2) r2 = dp.rc2;
  const i4 = 1 / (r2 * r2), c = dx * dx - dy * dy, d = 2 * dx * dy;
  out[0] = -(mr * c + mi * d) * i4; out[1] = (mi * c - mr * d) * i4;
}
const t2 = new Float64Array(2), t3 = new Float64Array(3);
// world z = 0 -> out [ux, uy] / U.  S.dipK: section dipole on; S.gridK: baked grid on (for 2D models the grid
// holds exact - dipole; for 3D models it holds the in-plane 3D potential flow, used when the solver is off).
export function farAt(pb, S, x, y, out) {
  let ux = 1, uy = 0;
  if (pb) {
    const ca = S.ca, sa = S.sa, mx = x * ca - y * sa, my = x * sa + y * ca;
    let px = 0, py = 0;
    if (S.gridK > 0) { const fade = fieldAt(pb, mx, my, S, t2); px = t2[0] * fade; py = t2[1] * fade; }
    if (S.dipK > 0) { dipoleAt(pb.dip, mx, my, ca, sa, t2); px += t2[0]; py += t2[1]; }
    if (pb.vort.length && S.gnd !== 0) { vortAt(pb, mx, my, S, t2); px += t2[0]; py += t2[1]; }
    px *= S.invb; py *= S.invb;
    let wx = px * ca + py * sa, wy = -px * sa + py * ca;
    if (S.shock) {
      const g = shockJump(S.shock, S.M, x, y, 0, t3);
      wx = wx * g + t3[0]; wy = wy * g + t3[1];
    }
    ux += wx; uy += wy;
  }
  out[0] = ux; out[1] = uy;
}
export function sdfAt(pb, mx, my) {                      // model frame, bilinear; far outside -> large
  const G = pb.sdf, fx = (mx - G.x0) / G.h, fy = (my - G.y0) / G.h;
  const cx = fx < 0 ? 0 : fx > G.nx - 1.001 ? G.nx - 1.001 : fx, cy = fy < 0 ? 0 : fy > G.ny - 1.001 ? G.ny - 1.001 : fy;
  const i0 = cx | 0, j0 = cy | 0, tx = cx - i0, ty = cy - j0, o = j0 * G.nx + i0, d = G.d;
  const v = (1 - tx) * (1 - ty) * d[o] + tx * (1 - ty) * d[o + 1] + (1 - tx) * ty * d[o + G.nx] + tx * ty * d[o + G.nx + 1];
  return v + Math.hypot(fx - cx, fy - cy) * G.h;
}

/* ------------------------------------------- CPU backend ------------------------------------------- */
function createCpuBackend() {
  let L = null, D = null, pb = null, far = null, win = null, vel = null;
  let nozzle = null, nozCol = 0, nozW = 1;
  const o2 = new Float64Array(2);
  const inject = (i, j, c, o) => {
    if (i <= nozCol + nozW) {
      const p = j * 4, on = i >= nozCol - 1 ? 1 : 0;
      c[o] = nozzle[p] * on; c[o + 1] = nozzle[p + 1] * on; c[o + 2] = nozzle[p + 2] * on; c[o + 3] = nozzle[p + 3] * on;
    } else if (i >= D.nx - 2) { c[o] = c[o + 1] = c[o + 2] = c[o + 3] = 0; }
  };
  return {
    kind: 'cpu',
    resize(nx, ny, dnx, dny) {
      L = createLBM(nx, ny); D = createDye(dnx, dny, 4); far = new Float32Array(dnx * dny * 2); vel = new Float32Array(nx * ny * 2);
      for (let i = 0; i < dnx * dny; i++) far[2 * i] = 1;
      nozzle = new Float32Array(dny * 4);
    },
    setBake(b) { pb = b; },
    setStatic(S) {
      win = S.win;
      const { nx, ny } = L, h = win.h, ulb = S.ulb, ca = S.ca, sa = S.sa;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const q = j * nx + i, x = win.x0 + (i + 0.5) * h, y = win.y0 + (j + 0.5) * h;
        farAt(pb, S, x, y, o2);
        L.ufx[q] = o2[0] * ulb; L.ufy[q] = o2[1] * ulb;
        let e = 0;
        if (pb) {
          const mx = x * ca - y * sa, my = x * sa + y * ca;
          e = 0.5 - (sdfAt(pb, mx, my) - S.pad) / h; e = e < 0 ? 0 : e > 1 ? 1 : e;
        }
        L.eps[q] = e;
      }
      const dh = (TUN.x1 - TUN.x0) / D.nx;
      for (let j = 0; j < D.ny; j++) for (let i = 0; i < D.nx; i++) {
        const q = j * D.nx + i, x = TUN.x0 + (i + 0.5) * dh, y = TUN.y0 + (j + 0.5) * dh;
        farAt(pb, S, x, y, o2); far[2 * q] = o2[0]; far[2 * q + 1] = o2[1];
        D.solid[q] = pb && sdfAt(pb, x * ca - y * sa, x * sa + y * ca) < 0 ? 1 : 0;
      }
      nozCol = Math.round((TUN.noz - TUN.x0) / dh);
    },
    init(kick) { L.init(kick); },
    step(n, P) { L.params.tau = P.tau; L.params.cs2 = P.cs * P.cs; L.params.slip = P.slip; for (let i = 0; i < n; i++) L.step(); },
    // disp: free-stream displacement in dye cells for this frame; lbmOn: use the lattice inside the window
    advectDye(disp, nsub, lbmOn, ulb) {
      const dnx = D.nx, dny = D.ny, dh = (TUN.x1 - TUN.x0) / dnx, k = disp / nsub;
      const nx = L.nx, ny = L.ny, ux = L.ux, uy = L.uy, iu = 1 / ulb;
      for (let j = 0; j < dny; j++) for (let i = 0; i < dnx; i++) {
        const q = j * dnx + i;
        let vx = far[2 * q], vy = far[2 * q + 1];
        if (lbmOn) {
          const x = TUN.x0 + (i + 0.5) * dh, y = TUN.y0 + (j + 0.5) * dh;
          const w = windowWeight(win, nx, ny, x, y);
          if (w > 0) {
            let fx = (x - win.x0) / win.h - 0.5, fy = (y - win.y0) / win.h - 0.5;
            if (fx < 0) fx = 0; else if (fx > nx - 1.001) fx = nx - 1.001; if (fy < 0) fy = 0; else if (fy > ny - 1.001) fy = ny - 1.001;
            const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0, o = j0 * nx + i0;
            const lx = ((1 - tx) * ux[o] + tx * ux[o + 1]) * (1 - ty) + ((1 - tx) * ux[o + nx] + tx * ux[o + nx + 1]) * ty;
            const ly = ((1 - tx) * uy[o] + tx * uy[o + 1]) * (1 - ty) + ((1 - tx) * uy[o + nx] + tx * uy[o + nx + 1]) * ty;
            vx += w * (lx * iu - vx); vy += w * (ly * iu - vy);
          }
        }
        D.vx[q] = vx * k; D.vy[q] = vy * k;
      }
      nozW = 1 + Math.ceil(k);
      for (let s = 0; s < nsub; s++) D.step(inject);
    },
    setNozzles(profile) { nozzle.set(profile); },
    clearDye() { D.clear(); },
    readVelocity(dst, ulb) {
      const n = L.n, ux = L.ux, uy = L.uy, eps = L.eps, iu = 1 / ulb;
      for (let i = 0; i < n; i++) { const f = (1 - eps[i]) * iu; dst[2 * i] = ux[i] * f; dst[2 * i + 1] = uy[i] * f; }
      return true;
    },
    dyeData() { return D.data(); },
    dyeSize() { return [D.nx, D.ny]; },
    lbm() { return L; },
    gpuMs() { return 0; },
    dispose() {},
  };
}

// 1 well inside the solver window, 0 outside; ramps over the inflow / lateral margins and the outlet sponge
export function windowWeight(win, nx, ny, x, y) {
  const fx = (x - win.x0) / (nx * win.h), fy = (y - win.y0) / (ny * win.h);
  if (fx <= 0 || fx >= 1 || fy <= 0 || fy >= 1) return 0;
  const a = sm(fx / 0.05) * sm((1 - fx) / 0.11);
  const fb = fy < 0.5 ? fy : 1 - fy;
  return a * sm(fb / 0.07);
}

/* ---------------------------------------------- plane ---------------------------------------------- */
export function createPlane(opts) {
  opts = opts || {};
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  let backend = null, gpuFactory = null, tierName = opts.tier || 'cpu', tier = TIERS.cpu, level = 0;
  let pb = null, win = { x0: -1, y0: -0.3, h: 0.0125 }, nx = 0, ny = 0, dnx = 0, dny = 0;
  let vel = null, velFresh = false, ready = false, lbmOn = false;
  let band = 10, staticKey = '', nozKey = '', needInit = true, warm = 0;
  let stepAcc = 0, kVis = 1, simTime = 0, frames = 0;
  // governor state
  let emaDt = 1 / 60, slowT = 0, fastT = 0, lockT = 0, lastUp = -1e9, cpuMs = 0;
  const S = { win, ca: 1, sa: 0, gnd: 0, invb: 1, M: 0, pad: 0, ulb: 0.15, dipK: 1, gridK: 1, shock: null };
  const P = { tau: 0.56, cs: TUNE.cs, slip: 0 };
  const stat = { backend: 'none', tier: tierName, level: 0, nx: 0, ny: 0, dnx: 0, dny: 0, h: 0, cellsAcross: 0, stepsPerFrame: 0, stepsPerSec: 0, visScale: 1, reSolver: 0, tau: 0, slip: 0, gpuMs: 0, cpuMs: 0, emaDt: 0, lbmOn: false };
  const nozBuf = { a: null };
  let govOn = opts.governor !== false;
  const viewCfg = { lines: 24, density: 0.7 };

  function pickBackend() {
    if (backend) backend.dispose();
    backend = null;
    if (gpuFactory && tierName !== 'cpu') { try { backend = gpuFactory(); } catch (e) { backend = null; } }
    if (!backend) { backend = createCpuBackend(); tier = opts.cpu ? Object.assign({}, TIERS.cpu, opts.cpu) : TIERS.cpu; }
    else tier = TIERS[tierName] || TIERS.low;
    stat.backend = backend.kind;
    nx = 0; layout();
  }
  function layout() {                      // grid sizes for the current level
    const lv = LEVELS[level], q = (v) => Math.max(16, Math.round(v * lv.g / 4) * 4);
    const a = q(tier.nx), b = q(tier.ny), c = q(tier.dnx), d = q(tier.dny);
    if (a !== nx || b !== ny || c !== dnx || d !== dny) {
      nx = a; ny = b; dnx = c; dny = d;
      backend.resize(nx, ny, dnx, dny);
      if (pb) backend.setBake(pb);
      vel = new Float32Array(nx * ny * 2); velFresh = false;
      nozBuf.a = new Float32Array(dny * 4);
      staticKey = ''; nozKey = ''; needInit = true;
    }
    computeWindow();
  }
  // Window (world frame, independent of alpha inside one band): 1.5 S upstream, 4 S downstream,
  // S = max(height, length / 3); cell = bluff dimension / tier.cells unless the window needs coarser cells.
  function computeWindow() {
    if (!pb) return;
    const b = pb.bbox, Lx = b.x1 - b.x0, Hy = b.y1 - b.y0, Sc = Math.max(Hy, Lx / 3);
    const bluff = Math.max(Math.min(Lx, Hy), 0.2 * Math.max(Lx, Hy));
    const ar = band * DEG;
    const need = Lx + 5.5 * Sc, needY = 2.4 * (Lx * Math.sin(ar) + Hy * Math.cos(ar));
    let h = Math.max(bluff / (tier.cells * LEVELS[level].g), need / nx, needY / ny);
    let W = nx * h;
    if (W > TUN.x1 - TUN.x0 - 0.1) { W = TUN.x1 - TUN.x0 - 0.1; h = W / nx; }
    let x0 = b.x0 - 1.5 * Sc - (W - need) * 0.2;
    if (x0 < TUN.x0 + 0.05) x0 = TUN.x0 + 0.05;
    if (x0 + W > TUN.x1 + 0.02) x0 = TUN.x1 + 0.02 - W;
    const nw = { x0, y0: -0.5 * ny * h + 0.5 * (b.y0 + b.y1), h };
    if (Math.abs(nw.h - win.h) > 1e-9 || Math.abs(nw.x0 - win.x0) > 1e-9 || Math.abs(nw.y0 - win.y0) > 1e-9) {
      win = nw; S.win = win; staticKey = ''; needInit = true; velFresh = false;
    }
    S.pad = Math.max(0, 0.5 * (1.6 * h - Math.min(Lx, Hy)));
    stat.h = h; stat.cellsAcross = Math.min(Lx, Hy) / h;
  }

  function setBake(b) {
    pb = b; ready = !!b; band = 10; needInit = true; staticKey = ''; velFresh = false;
    if (!backend) pickBackend();
    backend.setBake(pb);
    if (pb) computeWindow();
    warm = 1.2;
  }

  function nozzles(view) {
    let L = Math.round(view.lines || 24); L = L < 1 ? 1 : L > 64 ? 64 : L;
    const dens = view.density == null ? 0.7 : view.density;
    const key = L + '|' + dens + '|' + dny;
    if (key === nozKey) return;
    nozKey = key;
    const a = nozBuf.a, dh = (TUN.y1 - TUN.y0) / dny;
    a.fill(0);
    const sig = Math.max(0.0035 * (0.7 + 0.6 * dens), 0.62 * dh);
    for (let l = 0; l < L; l++) {
      const u = (l + 0.5) / L * 2 - 1, y = 0.55 * Math.sign(u) * Math.pow(Math.abs(u), 1.25), c = MULTI[l % 6];
      const j0 = Math.floor((y - 4 * sig - TUN.y0) / dh), j1 = Math.ceil((y + 4 * sig - TUN.y0) / dh);
      for (let j = Math.max(0, j0); j <= Math.min(dny - 1, j1); j++) {
        const d = TUN.y0 + (j + 0.5) * dh - y, g = Math.exp(-0.5 * d * d / (sig * sig));
        if (g > a[4 * j + 3]) { a[4 * j] = c[0] * g; a[4 * j + 1] = c[1] * g; a[4 * j + 2] = c[2] * g; a[4 * j + 3] = g; }
      }
    }
    backend.setNozzles(a);
  }

  function govern(dt) {
    emaDt += (dt - emaDt) * Math.min(1, dt / 0.5);
    lockT -= dt;
    const budgetMs = backend.kind === 'cpu' ? 7 : 1e9;
    if (emaDt > 0.25 && level < 3) { setLevel(3); return; }
    if (emaDt > 1 / 22 || cpuMs > budgetMs) { slowT += dt; fastT = 0; } else if (emaDt < 1 / 50) { fastT += dt; slowT = 0; } else { slowT = 0; fastT = 0; }
    if (slowT > 1.0 && level < 3) { if (simTime - lastUp < 12) lockT = 45; setLevel(level + 1); }
    else if (fastT > 5 && level > 0 && lockT <= 0) { lastUp = simTime; setLevel(level - 1); }
  }
  function setLevel(l) { level = l; slowT = 0; fastT = 0; stat.level = l; layout(); }

  // p: {alphaDeg, ca, sa, gnd, invb, M, wake (0 none, 1 bubble, 2 street, 3 irregular), Re, turb (0..1), shock|null}
  // UvisIn: nominal U_vis (before the visual scale k); the plane runs at k * U_vis
  function update(p, UvisIn, dt) {
    if (!backend) pickBackend();
    frames++;
    if (dt > 0 && govOn) govern(dt);
    const t0 = now();
    const a = Math.abs(p.alphaDeg);
    const nb = a <= (band === 10 ? 11 : 10) ? 10 : a <= (band === 30 ? 20 : 21) ? 20 : 30;
    if (nb !== band) { band = nb; computeWindow(); }
    nozzles(viewCfg);
    const sup = !!p.shock;
    lbmOn = ready && !sup;
    S.ca = p.ca; S.sa = p.sa; S.invb = p.invb; S.M = p.M; S.shock = p.shock; S.ulb = tier.ulb;
    // 3D models: the solver treats the mid-plane section as a 2D body (far field = section dipole, no circulation);
    // with the solver off (M > 1) the plane shows the in-plane 3D potential flow instead.
    const d2 = !!(pb && pb.dim2);
    S.dipK = d2 || lbmOn ? 1 : 0; S.gridK = d2 || !lbmOn ? 1 : 0; S.gnd = d2 || !lbmOn ? p.gnd : 0;
    const key = p.alphaDeg + '|' + S.gnd.toFixed(5) + '|' + p.invb.toFixed(4) + '|' + (sup ? p.M.toFixed(3) + p.shock.key : '') + '|' + (pb ? pb.id : 0) + '|' + S.dipK + S.gridK;
    if (key !== staticKey && (backend.kind !== 'cpu' || (frames & 1) === 0 || needInit)) { staticKey = key; backend.setStatic(S); }

    // regime -> solver Reynolds number (on the projected height) and wall slip
    let hp = 24;
    if (pb) { const b = pb.bbox; hp = Math.max((b.x1 - b.x0) * Math.abs(p.sa) + (b.y1 - b.y0) * p.ca, 0.3 * (b.y1 - b.y0)) / win.h; }
    let re = TUNE.reNone, slip = TUNE.slipNone;
    if (p.wake === 1) { re = TUNE.reBubble; slip = 0; }
    else if (p.wake === 2) { re = p.Re < TUNE.reStreet ? Math.max(p.Re, 50) : TUNE.reStreet; slip = TUNE.slipTurb * p.turb; }
    else if (p.wake === 3) { re = TUNE.reIrregular; slip = TUNE.slipTurb * p.turb; }
    else if (p.Re < 40) { re = Math.max(p.Re, 5); slip = 0; }
    P.tau = Math.max(TUNE.tauMin, 0.5 + 3 * tier.ulb * hp / re); P.slip = slip; P.cs = TUNE.cs;
    stat.reSolver = re; stat.tau = P.tau; stat.slip = slip;

    // time: lattice steps per second needed for U_vis, clipped by the budget -> visual scale k
    const lv = LEVELS[level];
    const Unom = UvisIn;
    const rateNeed = Unom / (win.h * tier.ulb), rateMax = tier.rate * lv.r;
    const k = lbmOn ? Math.min(1, rateMax / rateNeed) : 1;
    kVis += (k - kVis) * Math.min(1, (dt || 0) * 4 + (needInit ? 1 : 0));
    const Ueff = Unom * kVis;
    let sdt = dt > 0.05 ? 0.05 : dt > 0 ? dt : 0;
    if (lbmOn && needInit) { backend.init(TUNE.kick * tier.ulb); needInit = false; stepAcc = 0; velFresh = false; }
    let n = 0;
    if (lbmOn && sdt > 0) {
      stepAcc += sdt * Ueff / (win.h * tier.ulb) * (warm > 0 ? 2 : 1);
      n = Math.floor(stepAcc); stepAcc -= n;
      const cap = Math.max(2, Math.ceil(rateMax * 0.05 * (warm > 0 ? 2 : 1)));
      if (n > cap) { n = cap; stepAcc = 0; }
      if (n > 0) backend.step(n, P);
      warm -= sdt;
    }
    if (sdt > 0) {
      const dh = (TUN.x1 - TUN.x0) / dnx;
      const disp = lbmOn ? n * tier.ulb * win.h / dh : sdt * Ueff / dh;
      if (disp > 0) backend.advectDye(disp, Math.min(3, Math.max(1, Math.ceil(disp / 2.5))), lbmOn, tier.ulb);
      simTime += sdt;
    }
    if (lbmOn && backend.readVelocity(vel, tier.ulb)) velFresh = true;
    cpuMs += (now() - t0 - cpuMs) * 0.1;
    stat.stepsPerFrame = n; stat.stepsPerSec = lbmOn ? Ueff / (win.h * tier.ulb) : 0; stat.visScale = kVis; stat.nx = nx; stat.ny = ny; stat.dnx = dnx; stat.dny = dny;
    stat.cpuMs = cpuMs; stat.gpuMs = backend.gpuMs(); stat.emaDt = emaDt; stat.lbmOn = lbmOn; stat.level = level;
  }

  // weight of the solver field at a world point of the plane, and its velocity / U (bilinear, CPU copy)
  function weight(x, y) { return lbmOn && velFresh ? windowWeight(win, nx, ny, x, y) : 0; }
  function velAt(x, y, out) {
    let fx = (x - win.x0) / win.h - 0.5, fy = (y - win.y0) / win.h - 0.5;
    if (fx < 0) fx = 0; else if (fx > nx - 1.001) fx = nx - 1.001; if (fy < 0) fy = 0; else if (fy > ny - 1.001) fy = ny - 1.001;
    const i0 = fx | 0, j0 = fy | 0, tx = fx - i0, ty = fy - j0, o = (j0 * nx + i0) * 2, r = nx * 2, v = vel;
    out[0] = ((1 - tx) * v[o] + tx * v[o + 2]) * (1 - ty) + ((1 - tx) * v[o + r] + tx * v[o + r + 2]) * ty;
    out[1] = ((1 - tx) * v[o + 1] + tx * v[o + 3]) * (1 - ty) + ((1 - tx) * v[o + r + 1] + tx * v[o + r + 3]) * ty;
  }

  return {
    setBake, update, weight, velAt,
    setView(v) { if (v) { viewCfg.lines = v.lines; viewCfg.density = v.density; } },
    attachGpu(factory, tierN) { gpuFactory = factory; tierName = tierN === 'high' ? 'high' : 'low'; stat.tier = tierName; level = 0; pickBackend(); if (pb) { backend.setBake(pb); computeWindow(); } },
    setTier(t) { const n = t === 'high' ? 'high' : 'low'; if (gpuFactory && n !== tierName) { tierName = n; stat.tier = n; level = 0; pickBackend(); if (pb) { backend.setBake(pb); computeWindow(); } } },
    visScale: () => kVis,
    ready: () => ready,
    active: () => lbmOn,
    window: () => ({ x0: win.x0, y0: win.y0, x1: win.x0 + nx * win.h, y1: win.y0 + ny * win.h, h: win.h, nx, ny }),
    stats: () => stat,
    backend: () => backend,
    colors: { HEX, MULTI },
    resetDye() { if (backend) backend.clearDye(); },
    reinit() { needInit = true; },
    setGovernor(on) { govOn = !!on; },   // debugging / screenshots: pin the level
    _setLevel: setLevel,
  };
}
