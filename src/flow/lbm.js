// src/flow/lbm.js — D2Q9 lattice-Boltzmann core, CPU reference implementation.
// Used by the node tests and as the fallback when WebGL2 float render targets are missing.
// The GPU backend (lbm-gpu.js) implements exactly the same update in GLSL.
//
// Scheme (one pull step per cell):
//   stream      g_i(x) <- g_i(x - c_i)                 (g = f - w: deviation form, half-float safe)
//   collide     regularised BGK (Latt & Chopard 2006) with a Smagorinsky eddy viscosity
//   body        partially saturated bounce-back (Noble & Torczynski 1998) with solid fraction eps
//               rasterised from the model sdf; `slip` is a wall model for turbulent boundary layers
//   inflow      x = 0, y = 0, y = ny-1: equilibrium at the far-field velocity (uf)
//   outflow     x = nx-1: zero-gradient copy with the density pinned to 1, plus a viscous sponge
// Lattice units: dx = dt = 1, cs^2 = 1/3.

export const W0 = 4 / 9, W1 = 1 / 9, W2 = 1 / 36;
export const SMAG_K = 18 * Math.SQRT2;   // tau_eff = (tau0 + sqrt(tau0^2 + SMAG_K * Cs^2 * |Pi|/rho)) / 2
export const SPONGE_FRAC = 0.10;         // last 10 % of the window in x
export const SPONGE_TAU = 0.35;          // extra tau at the outlet column

export function createLBM(nx, ny) {
  const n = nx * ny;
  let A = [], B = [];
  for (let i = 0; i < 9; i++) { A.push(new Float32Array(n)); B.push(new Float32Array(n)); }
  const eps = new Float32Array(n), ufx = new Float32Array(n), ufy = new Float32Array(n);
  const rho = new Float32Array(n).fill(1), ux = new Float32Array(n), uy = new Float32Array(n);
  const spg = new Float32Array(nx);
  for (let x = 0; x < nx; x++) { const t = (x - (1 - SPONGE_FRAC) * (nx - 1)) / (SPONGE_FRAC * (nx - 1)); spg[x] = t > 0 ? SPONGE_TAU * t * t : 0; }
  const P = { tau: 0.56, cs2: 0.16 * 0.16, slip: 0, steps: 0 };

  function eqCell(i, vx, vy, bufs) {
    const uu = 1.5 * (vx * vx + vy * vy);
    bufs[0][i] = W0 * (-uu);
    bufs[1][i] = W1 * (3 * vx + 4.5 * vx * vx - uu); bufs[3][i] = W1 * (-3 * vx + 4.5 * vx * vx - uu);
    bufs[2][i] = W1 * (3 * vy + 4.5 * vy * vy - uu); bufs[4][i] = W1 * (-3 * vy + 4.5 * vy * vy - uu);
    let c = vx + vy; bufs[5][i] = W2 * (3 * c + 4.5 * c * c - uu); bufs[7][i] = W2 * (-3 * c + 4.5 * c * c - uu);
    c = vy - vx; bufs[6][i] = W2 * (3 * c + 4.5 * c * c - uu); bufs[8][i] = W2 * (-3 * c + 4.5 * c * c - uu);
  }

  // Start from the far field (zero inside the body). `kick` adds a small seeded cross-flow
  // disturbance so a symmetric body does not need thousands of steps of round-off to start shedding.
  function init(kick) {
    let a = 12345;
    for (let i = 0; i < n; i++) {
      const f = 1 - eps[i];
      let vy = ufy[i] * f;
      if (kick) { a = (Math.imul(a, 1664525) + 1013904223) | 0; vy += kick * f * ((a >>> 8) / 8388608 - 1); }
      eqCell(i, ufx[i] * f, vy, A);
      rho[i] = 1; ux[i] = ufx[i] * f; uy[i] = vy;
    }
    P.steps = 0;
  }

  function step() {
    const a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3], a4 = A[4], a5 = A[5], a6 = A[6], a7 = A[7], a8 = A[8];
    const b0 = B[0], b1 = B[1], b2 = B[2], b3 = B[3], b4 = B[4], b5 = B[5], b6 = B[6], b7 = B[7], b8 = B[8];
    const tau0 = P.tau, smag = SMAG_K * P.cs2, slip = P.slip;
    for (let y = 1; y < ny - 1; y++) {
      const row = y * nx;
      for (let x = 1; x < nx - 1; x++) {
        const i = row + x;
        const f0 = a0[i], f1 = a1[i - 1], f2 = a2[i - nx], f3 = a3[i + 1], f4 = a4[i + nx];
        const f5 = a5[i - nx - 1], f6 = a6[i - nx + 1], f7 = a7[i + nx + 1], f8 = a8[i + nx - 1];
        const dr = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
        let r = 1 + dr; if (r < 0.5) r = 0.5; else if (r > 1.5) r = 1.5;
        let vx = (f1 - f3 + f5 - f6 - f7 + f8) / r, vy = (f2 - f4 + f5 + f6 - f7 - f8) / r;
        const v2 = vx * vx + vy * vy;
        if (v2 > 0.1225) { const k = 0.35 / Math.sqrt(v2); vx *= k; vy *= k; }   // Mach guard
        rho[i] = r; ux[i] = vx; uy[i] = vy;
        const d3 = dr / 3;
        const pxx = f1 + f3 + f5 + f6 + f7 + f8 - d3 - r * vx * vx;
        const pyy = f2 + f4 + f5 + f6 + f7 + f8 - d3 - r * vy * vy;
        const pxy = f5 - f6 + f7 - f8 - r * vx * vy;
        const t0 = tau0 + spg[x];
        const tau = 0.5 * (t0 + Math.sqrt(t0 * t0 + smag * Math.sqrt(pxx * pxx + pyy * pyy + 2 * pxy * pxy) / r));
        const om = 1 - 1 / tau;
        const uu = 1.5 * (vx * vx + vy * vy);
        const ax = om * 4.5 * (2 * pxx - pyy) / 3, ay = om * 4.5 * (2 * pyy - pxx) / 3;   // axis-aligned Q:Pi
        const ad = om * 4.5 * (pxx + pyy) * 2 / 3, ao = om * 9 * pxy;
        const cp = vx + vy, cm = vy - vx;
        let o0 = W0 * (dr - r * uu - om * 1.5 * (pxx + pyy));
        let o1 = W1 * (dr + r * (3 * vx + 4.5 * vx * vx - uu) + ax);
        let o3 = W1 * (dr + r * (-3 * vx + 4.5 * vx * vx - uu) + ax);
        let o2 = W1 * (dr + r * (3 * vy + 4.5 * vy * vy - uu) + ay);
        let o4 = W1 * (dr + r * (-3 * vy + 4.5 * vy * vy - uu) + ay);
        let o5 = W2 * (dr + r * (3 * cp + 4.5 * cp * cp - uu) + ad + ao);
        let o7 = W2 * (dr + r * (-3 * cp + 4.5 * cp * cp - uu) + ad + ao);
        let o6 = W2 * (dr + r * (3 * cm + 4.5 * cm * cm - uu) + ad - ao);
        let o8 = W2 * (dr + r * (-3 * cm + 4.5 * cm * cm - uu) + ad - ao);
        const e = eps[i];
        if (e > 0) {
          // solid part: bounce-back of the incoming populations; the wall "moves" with k * u (slip wall model)
          const k = slip * (1 - e), k2 = k * k, uus = uu * k2;
          const sx = vx * k, sy = vy * k, sp = cp * k, sm = cm * k;
          const s0 = f0 + W0 * r * (uu - uus);
          const s1 = f3 + W1 * r * (3 * sx + 4.5 * sx * sx - uus + 3 * vx - 4.5 * vx * vx + uu);
          const s3 = f1 + W1 * r * (-3 * sx + 4.5 * sx * sx - uus - 3 * vx - 4.5 * vx * vx + uu);
          const s2 = f4 + W1 * r * (3 * sy + 4.5 * sy * sy - uus + 3 * vy - 4.5 * vy * vy + uu);
          const s4 = f2 + W1 * r * (-3 * sy + 4.5 * sy * sy - uus - 3 * vy - 4.5 * vy * vy + uu);
          const s5 = f7 + W2 * r * (3 * sp + 4.5 * sp * sp - uus + 3 * cp - 4.5 * cp * cp + uu);
          const s7 = f5 + W2 * r * (-3 * sp + 4.5 * sp * sp - uus - 3 * cp - 4.5 * cp * cp + uu);
          const s6 = f8 + W2 * r * (3 * sm + 4.5 * sm * sm - uus + 3 * cm - 4.5 * cm * cm + uu);
          const s8 = f6 + W2 * r * (-3 * sm + 4.5 * sm * sm - uus - 3 * cm - 4.5 * cm * cm + uu);
          o0 += e * (s0 - o0); o1 += e * (s1 - o1); o2 += e * (s2 - o2); o3 += e * (s3 - o3); o4 += e * (s4 - o4);
          o5 += e * (s5 - o5); o6 += e * (s6 - o6); o7 += e * (s7 - o7); o8 += e * (s8 - o8);
        }
        b0[i] = o0; b1[i] = o1; b2[i] = o2; b3[i] = o3; b4[i] = o4; b5[i] = o5; b6[i] = o6; b7[i] = o7; b8[i] = o8;
      }
    }
    // far field: inflow column, top and bottom rows
    for (let x = 0; x < nx; x++) {
      let i = x; eqCell(i, ufx[i], ufy[i], B); rho[i] = 1; ux[i] = ufx[i]; uy[i] = ufy[i];
      i = (ny - 1) * nx + x; eqCell(i, ufx[i], ufy[i], B); rho[i] = 1; ux[i] = ufx[i]; uy[i] = ufy[i];
    }
    for (let y = 1; y < ny - 1; y++) {
      let i = y * nx; eqCell(i, ufx[i], ufy[i], B); rho[i] = 1; ux[i] = ufx[i]; uy[i] = ufy[i];
      // outflow: previous populations of the neighbour column, density pinned to 1
      i = y * nx + nx - 1; const j = i - 1;
      const dr = a0[j] + a1[j] + a2[j] + a3[j] + a4[j] + a5[j] + a6[j] + a7[j] + a8[j];
      b0[i] = a0[j] - W0 * dr; b1[i] = a1[j] - W1 * dr; b2[i] = a2[j] - W1 * dr; b3[i] = a3[j] - W1 * dr; b4[i] = a4[j] - W1 * dr;
      b5[i] = a5[j] - W2 * dr; b6[i] = a6[j] - W2 * dr; b7[i] = a7[j] - W2 * dr; b8[i] = a8[j] - W2 * dr;
      rho[i] = 1; ux[i] = ux[j]; uy[i] = uy[j];
    }
    const t = A; A = B; B = t;
    P.steps++;
  }

  function mass() {
    let m = 0;
    for (let k = 0; k < 9; k++) { const a = A[k]; let s = 0; for (let i = 0; i < n; i++) s += a[i]; m += s; }
    return n + m;
  }
  function finite() { const a = A[0]; for (let i = 0; i < n; i += 7) if (!(a[i] === a[i])) return false; return true; }

  return { nx, ny, n, eps, ufx, ufy, rho, ux, uy, params: P, init, step, mass, finite, pops: () => A };
}

/* --------------------------------------------------------------------------------------------- */
/* Dye: passive scalar on its own grid, MacCormack (BFECC-type) semi-Lagrangian advection with a  */
/* min/max limiter. c holds `ch` channels per cell (rgb premultiplied by density, a = density).    */
/* vx, vy: displacement per step in dye cells.                                                     */
/* --------------------------------------------------------------------------------------------- */
export function createDye(nx, ny, ch) {
  ch = ch || 4;
  const n = nx * ny;
  let c = new Float32Array(n * ch), nw = new Float32Array(n * ch);
  const fw = new Float32Array(n * ch);
  const vx = new Float32Array(n), vy = new Float32Array(n), solid = new Float32Array(n);
  const tmp = new Float64Array(ch), lo = new Float64Array(ch), hi = new Float64Array(ch);

  function sampleInto(a, x, y, out, mm) {
    if (x < 0) x = 0; else if (x > nx - 1.001) x = nx - 1.001;
    if (y < 0) y = 0; else if (y > ny - 1.001) y = ny - 1.001;
    const i0 = x | 0, j0 = y | 0, tx = x - i0, ty = y - j0;
    const p = (j0 * nx + i0) * ch, q = p + nx * ch;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    for (let k = 0; k < ch; k++) {
      const v0 = a[p + k], v1 = a[p + ch + k], v2 = a[q + k], v3 = a[q + ch + k];
      out[k] = w00 * v0 + w10 * v1 + w01 * v2 + w11 * v3;
      if (mm) { lo[k] = Math.min(v0, v1, v2, v3); hi[k] = Math.max(v0, v1, v2, v3); }
    }
  }

  // inject(i, j, outCell, o) may overwrite the freshly advected value (nozzles, outlet)
  function step(inject) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {       // forward estimate
      const q = j * nx + i;
      sampleInto(c, i - vx[q], j - vy[q], tmp, false);
      for (let k = 0; k < ch; k++) fw[q * ch + k] = tmp[k];
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {       // backward estimate + correction + limiter
      const q = j * nx + i, o = q * ch;
      if (solid[q] > 0.5) { for (let k = 0; k < ch; k++) nw[o + k] = 0; continue; }
      sampleInto(fw, i + vx[q], j + vy[q], tmp, false);
      for (let k = 0; k < ch; k++) nw[o + k] = fw[o + k] + 0.5 * (c[o + k] - tmp[k]);
      sampleInto(c, i - vx[q], j - vy[q], tmp, true);
      for (let k = 0; k < ch; k++) { let v = nw[o + k]; if (v < lo[k]) v = lo[k]; else if (v > hi[k]) v = hi[k]; nw[o + k] = v; }
      if (inject) inject(i, j, nw, o);
    }
    const t = c; c = nw; nw = t;
  }
  return { nx, ny, ch, vx, vy, solid, step, data: () => c, clear() { c.fill(0); nw.fill(0); } };
}

/* Rasterise a signed distance function into the solid fraction: eps = clamp(0.5 - (d - pad)/h, 0, 1). */
export function rasterSdf(lbm, sdf, x0, y0, h, pad) {
  const { nx, ny, eps } = lbm;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const d = sdf(x0 + (i + 0.5) * h, y0 + (j + 0.5) * h) - (pad || 0);
    const e = 0.5 - d / h;
    eps[j * nx + i] = e < 0 ? 0 : e > 1 ? 1 : e;
  }
}

/* Dominant frequency (cycles per step) and rms amplitude of a signal, from mean-crossings. */
export function sheddingOf(sig, dtSteps) {
  const n = sig.length; let mean = 0;
  for (let i = 0; i < n; i++) mean += sig[i];
  mean /= n;
  let rms = 0, first = -1, last = -1, cnt = 0;
  for (let i = 0; i < n; i++) rms += (sig[i] - mean) * (sig[i] - mean);
  rms = Math.sqrt(rms / n);
  const hyst = 0.2 * rms; let st = 0;
  for (let i = 0; i < n; i++) {
    const v = sig[i] - mean;
    if (st <= 0 && v > hyst) { if (st < 0) { const t = i; if (first < 0) first = t; else cnt++; last = t; } st = 1; }
    else if (st >= 0 && v < -hyst) st = -1;
  }
  const freq = cnt > 0 ? cnt / ((last - first) * dtSteps) : 0;
  return { freq, rms, mean, cycles: cnt };
}
