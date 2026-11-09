// src/flow/flowfield.js  (P2)
// Flow-field core of the wind-tunnel simulator. Contract: SPEC.md section 5.
//   createFlow() -> { setModel, update, sample, sdf, phase, shock, probe, ... }
// Units: world metres, visual m/s (U_vis) for sample(); probe() reports true values.
// Model frame: nose toward -x. World = rotateZ(-alpha) * model.
//
// Method (decided in the job): method of fundamental solutions (interior point
// sources, Tikhonov least squares + closure row), horseshoe vortices for lift,
// grid bake (Worker or time-sliced main thread), Prandtl-Glauert on perturbations,
// Lamb-Oseen street / bubble / curl-noise wake, Billig bow shock / conical shock.
//
// Extra (non-contract) members used by surface.js and tests:
//   flow.surfaceData(), flow.gammaND(res), flow._debug
// shock() returns halfAngle in RADIANS (also halfAngleDeg); planar:true for 2D models.

const PI = Math.PI;
const DEG = PI / 180;
const TWO_PI = 2 * PI;
const GAMMA_AIR = 1.4;
const R_AIR = 287.05;
const EDGE_DEG = Math.acos(-0.15) / DEG; // n.Uhat > 0.15  <=>  phi > 98.6 deg

/* ------------------------------------------------------------------------ */
/* Engine: self-contained (no outer references) so it can be stringified into */
/* a Blob-URL Worker. Everything numeric of the bake lives here.              */
/* ------------------------------------------------------------------------ */
function makeEngine() {
  const EPS2 = 1e-6; // (1 mm)^2 softening

  // Regularised Biot-Savart: finite segments (stride 11), semi-infinite +x legs
  // (stride 5), 2D point vortices (stride 4). Strengths pre-divided by 4pi / 2pi.
  function makeVortexField(bnd, nb, leg, nl, v2, n2) {
    if (nb + nl + n2 === 0) return null;
    return function vortexAt(x, y, z, out, o) {
      let vx = 0, vy = 0, vz = 0;
      for (let s = 0; s < nb; s++) {
        const b = s * 11;
        const r1x = x - bnd[b], r1y = y - bnd[b + 1], r1z = z - bnd[b + 2];
        const r2x = x - bnd[b + 3], r2y = y - bnd[b + 4], r2z = z - bnd[b + 5];
        const cx = r1y * r2z - r1z * r2y, cy = r1z * r2x - r1x * r2z, cz = r1x * r2y - r1y * r2x;
        const c2 = cx * cx + cy * cy + cz * cz, d2 = bnd[b + 7];
        const cc = c2 > d2 ? c2 : d2; // Rankine core: exact 1/r outside the core
        const m1 = 1 / (Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z) + 1e-12);
        const m2 = 1 / (Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z) + 1e-12);
        const k = bnd[b + 8] * (r1x * m1 - r2x * m2) + bnd[b + 9] * (r1y * m1 - r2y * m2) + bnd[b + 10] * (r1z * m1 - r2z * m2);
        const f = bnd[b + 6] * k / cc;
        vx += f * cx; vy += f * cy; vz += f * cz;
      }
      for (let s = 0; s < nl; s++) {
        const b = s * 5;
        const rx = x - leg[b], ry = y - leg[b + 1], rz = z - leg[b + 2];
        let c2 = ry * ry + rz * rz; if (c2 < leg[b + 4]) c2 = leg[b + 4];
        const rr = Math.sqrt(rx * rx + ry * ry + rz * rz) + 1e-12;
        const f = leg[b + 3] * (1 + rx / rr) / c2;
        vy -= rz * f; vz += ry * f;
      }
      for (let s = 0; s < n2; s++) {
        const b = s * 4;
        const dx = x - v2[b], dy = y - v2[b + 1];
        let r2 = dx * dx + dy * dy; if (r2 < v2[b + 3]) r2 = v2[b + 3];
        const f = v2[b + 2] / r2;
        vx += f * dy; vy -= f * dx;
      }
      out[o] += vx; out[o + 1] += vy; out[o + 2] += vz;
    };
  }

  // evalAt(x,y,z,out9,needG): out = [Xpert(3), Ypert(3), Gpert(3)] (perturbation
  // velocity for unit freestream along +x, +y and unit circulation).
  // Beyond 3 cloud radii the source part is a dipole (monopole is zero by closure).
  function makeEvaluator(P) {
    const dim2 = P.dim2, K = P.K, src = P.src, sx = P.sx, sy = P.sy, sg = P.sg, vort = P.vort;
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < K; j++) { cx += src[3 * j]; cy += src[3 * j + 1]; cz += src[3 * j + 2]; }
    cx /= K; cy /= K; cz = dim2 ? 0 : cz / K;
    let Rb = 0;
    let pxx = 0, pxy = 0, pxz = 0, pyx = 0, pyy = 0, pyz = 0, pgx = 0, pgy = 0, pgz = 0;
    for (let j = 0; j < K; j++) {
      const dx = src[3 * j] - cx, dy = src[3 * j + 1] - cy, dz = dim2 ? 0 : src[3 * j + 2] - cz;
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r > Rb) Rb = r;
      pxx += sx[j] * dx; pxy += sx[j] * dy; pxz += sx[j] * dz;
      pyx += sy[j] * dx; pyy += sy[j] * dy; pyz += sy[j] * dz;
      pgx += sg[j] * dx; pgy += sg[j] * dy; pgz += sg[j] * dz;
    }
    const far2 = 9 * Rb * Rb;
    return function evalAt(x, y, z, out, needG) {
      const rx = x - cx, ry = y - cy, rz = dim2 ? 0 : z - cz;
      const rr2 = rx * rx + ry * ry + rz * rz;
      let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, gx = 0, gy = 0, gz = 0;
      if (rr2 > far2) {
        if (dim2) {
          const i2 = 1 / rr2, i4 = i2 * i2;
          const dX = rx * pxx + ry * pxy, dY = rx * pyx + ry * pyy, dG = rx * pgx + ry * pgy;
          ax = 2 * rx * dX * i4 - pxx * i2; ay = 2 * ry * dX * i4 - pxy * i2;
          bx = 2 * rx * dY * i4 - pyx * i2; by = 2 * ry * dY * i4 - pyy * i2;
          gx = 2 * rx * dG * i4 - pgx * i2; gy = 2 * ry * dG * i4 - pgy * i2;
        } else {
          const i2 = 1 / rr2, inv = i2 / Math.sqrt(rr2);
          const dX = rx * pxx + ry * pxy + rz * pxz, dY = rx * pyx + ry * pyy + rz * pyz, dG = rx * pgx + ry * pgy + rz * pgz;
          ax = (3 * rx * dX * i2 - pxx) * inv; ay = (3 * ry * dX * i2 - pxy) * inv; az = (3 * rz * dX * i2 - pxz) * inv;
          bx = (3 * rx * dY * i2 - pyx) * inv; by = (3 * ry * dY * i2 - pyy) * inv; bz = (3 * rz * dY * i2 - pyz) * inv;
          gx = (3 * rx * dG * i2 - pgx) * inv; gy = (3 * ry * dG * i2 - pgy) * inv; gz = (3 * rz * dG * i2 - pgz) * inv;
        }
      } else if (dim2) {
        for (let j = 0; j < K; j++) {
          const dx = x - src[3 * j], dy = y - src[3 * j + 1];
          let r2 = dx * dx + dy * dy; if (r2 < EPS2) r2 = EPS2;
          const inv = 1 / r2, tx = dx * inv, ty = dy * inv;
          const a = sx[j], b = sy[j], c = sg[j];
          ax += a * tx; ay += a * ty; bx += b * tx; by += b * ty; gx += c * tx; gy += c * ty;
        }
      } else {
        for (let j = 0; j < K; j++) {
          const j3 = 3 * j;
          const dx = x - src[j3], dy = y - src[j3 + 1], dz = z - src[j3 + 2];
          let r2 = dx * dx + dy * dy + dz * dz; if (r2 < EPS2) r2 = EPS2;
          const inv = 1 / (r2 * Math.sqrt(r2));
          const tx = dx * inv, ty = dy * inv, tz = dz * inv;
          const a = sx[j], b = sy[j], c = sg[j];
          ax += a * tx; ay += a * ty; az += a * tz;
          bx += b * tx; by += b * ty; bz += b * tz;
          gx += c * tx; gy += c * ty; gz += c * tz;
        }
      }
      out[0] = ax; out[1] = ay; out[2] = az;
      out[3] = bx; out[4] = by; out[5] = bz;
      out[6] = gx; out[7] = gy; out[8] = gz;
      if (needG && vort !== null) vort(x, y, z, out, 6);
    };
  }

  function clampW(t) { return t < 0.5 ? 0.5 : t > 6 ? 6 : t; }
  function chol(L, n) {
    for (let j = 0; j < n; j++) {
      const jn = j * n;
      let s = L[jn + j];
      for (let k = 0; k < j; k++) s -= L[jn + k] * L[jn + k];
      if (!(s > 1e-300)) return false;
      const d = Math.sqrt(s);
      L[jn + j] = d;
      for (let i = j + 1; i < n; i++) {
        const in_ = i * n;
        let t = L[in_ + j];
        for (let k = 0; k < j; k++) t -= L[in_ + k] * L[jn + k];
        L[in_ + j] = t / d;
      }
    }
    return true;
  }
  function csolve(L, n, b, y) {
    for (let i = 0; i < n; i++) {
      let s = b[i];
      for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
      y[i] = s / L[i * n + i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= L[k * n + i] * y[k];
      y[i] = s / L[i * n + i];
    }
  }

  // Generator: yields between chunks of work (<~1 ms each); returns the result.
  function* bake(inp) {
    const dim2 = inp.dim2, M = inp.M, K = inp.K, pos = inp.pos, nrm = inp.nrm, src = inp.src;
    const vort = makeVortexField(inp.bnd, inp.nb, inp.leg, inp.nl, inp.v2, inp.n2);
    const R = M + 1;
    const A = new Float64Array(R * K);
    let ss = 0;
    for (let i = 0; i < M; i++) {
      const cx = pos[3 * i], cy = pos[3 * i + 1], cz = dim2 ? 0 : pos[3 * i + 2];
      const nx = nrm[3 * i], ny = nrm[3 * i + 1], nz = dim2 ? 0 : nrm[3 * i + 2];
      const o = i * K;
      for (let j = 0; j < K; j++) {
        const dx = cx - src[3 * j], dy = cy - src[3 * j + 1];
        let v;
        if (dim2) {
          let r2 = dx * dx + dy * dy; if (r2 < EPS2) r2 = EPS2;
          v = (dx * nx + dy * ny) / r2;
        } else {
          const dz = cz - src[3 * j + 2];
          let r2 = dx * dx + dy * dy + dz * dz; if (r2 < EPS2) r2 = EPS2;
          v = (dx * nx + dy * ny + dz * nz) / (r2 * Math.sqrt(r2));
        }
        A[o + j] = v; ss += v * v;
      }
      if ((i & 127) === 127) yield 0;
    }
    const rms = Math.sqrt(ss / (M * K));
    const cw = inp.closeW * rms;
    for (let j = 0; j < K; j++) A[M * K + j] = cw;
    const D = new Float64Array(K);
    for (let i = 0; i < M; i++) { const o = i * K; for (let j = 0; j < K; j++) D[j] += A[o + j] * A[o + j]; }
    for (let j = 0; j < K; j++) D[j] = Math.sqrt(D[j]) + 1e-300;
    for (let i = 0; i < R; i++) { const o = i * K; for (let j = 0; j < K; j++) A[o + j] /= D[j]; }
    yield 0;
    // RHS vectors (b) per row; weighted normal equations are rebuilt per IRLS pass
    const bX = new Float64Array(R), bY = new Float64Array(R), bG = new Float64Array(R);
    const t3 = new Float64Array(3);
    for (let i = 0; i < M; i++) {
      const nx = nrm[3 * i], ny = nrm[3 * i + 1], nz = dim2 ? 0 : nrm[3 * i + 2];
      bX[i] = -nx; bY[i] = -ny;
      if (vort !== null) {
        t3[0] = 0; t3[1] = 0; t3[2] = 0;
        vort(pos[3 * i], pos[3 * i + 1], dim2 ? 0 : pos[3 * i + 2], t3, 0);
        bG[i] = -(t3[0] * nx + t3[1] * ny + t3[2] * nz);
      }
    }
    const w = new Float64Array(R).fill(1);
    w[M] = 1;
    const N = new Float64Array(K * K), Lm = new Float64Array(K * K);
    const r0 = new Float64Array(K), r1 = new Float64Array(K), r2 = new Float64Array(K);
    const sx = new Float64Array(K), sy = new Float64Array(K), sg = new Float64Array(K);
    const yx = new Float64Array(K), yy = new Float64Array(K), yg = new Float64Array(K);
    let lamEff = 0, ok = false;
    const passes = inp.irls === undefined ? 0 : inp.irls;
    for (let pass = 0; pass <= passes; pass++) {
      N.fill(0); r0.fill(0); r1.fill(0); r2.fill(0);
      for (let i = 0; i < R; i++) {
        const o = i * K, wi = w[i];
        const bx = wi * bX[i], by = wi * bY[i], bg = wi * bG[i];
        for (let j = 0; j < K; j++) {
          const aj = A[o + j], oj = j * K, waj = wi * aj;
          for (let k = 0; k <= j; k++) N[oj + k] += waj * A[o + k];
          r0[j] += aj * bx; r1[j] += aj * by; r2[j] += aj * bg;
        }
        if ((i & 15) === 15) yield 0;
      }
      let tr = 0;
      for (let j = 0; j < K; j++) tr += N[j * K + j];
      lamEff = inp.lambda * tr / K; ok = false;
      for (let attempt = 0; attempt < 10 && !ok; attempt++) {
        Lm.set(N);
        for (let j = 0; j < K; j++) Lm[j * K + j] += lamEff;
        ok = chol(Lm, K);
        if (!ok) lamEff *= 10;
      }
      csolve(Lm, K, r0, yx); csolve(Lm, K, r1, yy); csolve(Lm, K, r2, yg);
      if (pass === passes) break;
      // reweight rows by residual (pushes the fit toward minimax)
      let sumE = 0;
      const e = new Float64Array(M);
      for (let i = 0; i < M; i++) {
        const o = i * K;
        let rx = -bX[i], ry = -bY[i];
        for (let j = 0; j < K; j++) { rx += A[o + j] * yx[j]; ry += A[o + j] * yy[j]; }
        e[i] = Math.sqrt(rx * rx + ry * ry); sumE += e[i] * e[i];
      }
      const rmsE = Math.sqrt(sumE / M) + 1e-12;
      for (let i = 0; i < M; i++) {
        const t = clampW(e[i] / rmsE);
        w[i] = Math.sqrt(w[i] * t);
      }
      yield 0;
    }
    for (let j = 0; j < K; j++) { sx[j] = yx[j] / D[j]; sy[j] = yy[j] / D[j]; sg[j] = yg[j] / D[j]; }
    yield 0;

    const ev = makeEvaluator({ dim2, K, src, sx, sy, sg, vort });
    const g = inp.grid, nxg = g.nx, nyg = g.ny, nzg = g.nz;
    const nNodes = nxg * nyg * nzg;
    const grid = new Float32Array(nNodes * 9);
    const tmp = new Float64Array(9);
    const inside = inp.inside;
    let idx = 0, cnt = 0;
    for (let k = 0; k < nzg; k++) {
      const z = g.z0 + k * g.hz;
      for (let j = 0; j < nyg; j++) {
        const y = g.y0 + j * g.hy;
        for (let i = 0; i < nxg; i++, idx++) {
          if (inside[idx] !== 0) continue;
          ev(g.x0 + i * g.hx, y, z, tmp, true);
          const o = idx * 9;
          for (let c = 0; c < 9; c++) grid[o + c] = tmp[c];
          if ((++cnt & 255) === 0) yield 0;
        }
      }
    }
    const nv = inp.nv, vpos = inp.vpos;
    const surf = new Float32Array(nv * 9);
    for (let v = 0; v < nv; v++) {
      ev(vpos[3 * v], vpos[3 * v + 1], vpos[3 * v + 2], tmp, true);
      const o = v * 9;
      for (let c = 0; c < 9; c++) surf[o + c] = tmp[c];
      surf[o] += 1;      // full velocity for unit freestream +x
      surf[o + 4] += 1;  // and +y
      if ((v & 255) === 255) yield 0;
    }
    return { sx, sy, sg, grid, surf, lambda: lamEff, ok };
  }

  return { bake, makeEvaluator, makeVortexField };
}

const WORKER_SRC =
  '(function(){var eng=(' + makeEngine.toString() + ')();' +
  'self.onmessage=function(e){try{var g=eng.bake(e.data);var r;do{r=g.next();}while(!r.done);var o=r.value;' +
  'self.postMessage({ok:true,out:o},[o.grid.buffer,o.surf.buffer,o.sx.buffer,o.sy.buffer,o.sg.buffer]);}' +
  'catch(err){self.postMessage({ok:false,msg:String(err&&err.message||err)});}};})();';

/* ------------------------------------------------------------------------ */
/* helpers                                                                    */
/* ------------------------------------------------------------------------ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function smooth01(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

const NV = 40;          // street vortices
const NMODE = 5;        // curl-noise modes
const WAKE_CODE = { none: 0, bubble: 1, street: 2, irregular: 3 };

export function createFlow(opts) {
  opts = opts || {};
  const sliceMs = opts.sliceMs === undefined ? 8 : opts.sliceMs;
  const wantWorker = opts.worker !== false;
  const lambda = opts.lambda === undefined ? 1e-9 : opts.lambda;
  const closeW = opts.closeW === undefined ? 30 : opts.closeW;
  const curvBeta = opts.curvBeta === undefined ? 0.1 : opts.curvBeta;
  const curvF = opts.curvF === undefined ? 0.6 : opts.curvF; // source depth <= curvF x local curvature radius
  const ENG = makeEngine();
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  let cur = null;       // baked model state
  let jobSeq = 0;
  let activeJob = null;

  // ----- runtime state (no allocation after construction) -----
  const R = {
    alphaRad: 0, ca: 1, sa: 0, Uvis: 1, U: 1, q: 0, pInf: 101325,
    M: 0, invb: 1, gnd: 0, needG: false,
    St: 0.2, D: 0.1, Re: 1e5, wake: 0, sepDeg: 180, cpb: -0.2,
    hasRes: false, sepKey: '', simT: 0, phU: 0, nextPh: 0, relIdx: 0, xconv: 0, tAnim: 0, lastD: -1,
    shockOn: false
  };
  const W = {
    xUp: 0, yUp: 0, xLo: 0, yLo: 0, xs: 0, yc: 0, zc: 0, zspan: 0.1,
    xNose: 0, yNose: 0, zNose: 0, nAct: 0, active: false, spanning: false, ampT: 0.04
  };
  const vX = new Float64Array(NV), vY = new Float64Array(NV), vYr = new Float64Array(NV), vYt = new Float64Array(NV);
  const vG0 = new Float64Array(NV), vAge = new Float64Array(NV);
  const vAct = new Uint8Array(NV), vSeq = new Float64Array(NV);
  const pX = new Float64Array(NV + 2), pY = new Float64Array(NV + 2), pG = new Float64Array(NV + 2), pS2 = new Float64Array(NV + 2);
  let relSeq = 0;
  const relT = new Float64Array(512); let relN = 0;
  let rng = mulberry32(1234);
  const SH = { type: 0, planar: false, ax: 0, ay: 0, az: 0, sinT: 0, cosT: 1, xv: 0, Rc: 1, tanMu: 1, cot2: 1 };
  const shockObj = { type: 'cone', apex: [0, 0, 0], halfAngle: 0, halfAngleDeg: 0, standoff: 0, R: 0, planar: false };
  const probeOut = { speed: 0, cp: 0, p: 0, inWake: false };
  const sc = new Float64Array(9), wk = new Float64Array(3), pv = new Float64Array(3);

  // curl-noise modes (fixed seed; wavevectors scaled by the wake diameter in update)
  const tDir = new Float64Array(NMODE * 3), tAmpDir = new Float64Array(NMODE * 3), tPh = new Float64Array(NMODE), tOm = new Float64Array(NMODE);
  const tLamF = [0.35, 0.5, 0.7, 1.0, 1.4];
  const tK = new Float64Array(NMODE * 3), tA = new Float64Array(NMODE * 3), tKA = new Float64Array(NMODE * 3);
  (function initModes() {
    const r = mulberry32(777);
    for (let m = 0; m < NMODE; m++) {
      for (let pass = 0; pass < 2; pass++) {
        let a = r() * 2 - 1, b = r() * 2 - 1, c = r() * 2 - 1, n = Math.hypot(a, b, c) || 1;
        const arr = pass === 0 ? tDir : tAmpDir;
        arr[3 * m] = a / n; arr[3 * m + 1] = b / n; arr[3 * m + 2] = c / n;
      }
      tPh[m] = r() * TWO_PI; tOm[m] = (r() * 2 - 1);
    }
  })();

  function setModes(D) {
    for (let m = 0; m < NMODE; m++) {
      const kk = TWO_PI / (D * tLamF[m]);
      const kx = tDir[3 * m] * kk, ky = tDir[3 * m + 1] * kk, kz = tDir[3 * m + 2] * kk;
      let ax = tAmpDir[3 * m], ay = tAmpDir[3 * m + 1], az = tAmpDir[3 * m + 2];
      let cx = ky * az - kz * ay, cy = kz * ax - kx * az, cz = kx * ay - ky * ax;
      const cn = Math.hypot(cx, cy, cz);
      if (cn < 0.2 * kk) { // nearly parallel: rotate amplitude direction
        const t = ax; ax = -ay; ay = az; az = t;
        cx = ky * az - kz * ay; cy = kz * ax - kx * az; cz = kx * ay - ky * ax;
      }
      const s = 1 / (Math.hypot(cx, cy, cz) + 1e-12); // |k x a| = 1
      tK[3 * m] = kx; tK[3 * m + 1] = ky; tK[3 * m + 2] = kz;
      tA[3 * m] = ax * s; tA[3 * m + 1] = ay * s; tA[3 * m + 2] = az * s;
      tKA[3 * m] = cx * s; tKA[3 * m + 1] = cy * s; tKA[3 * m + 2] = cz * s;
    }
  }

  /* ---------------------------- baking ---------------------------------- */
  function* prepareGen(model, aeroDef) {
    const dim2 = !!model.spanning;
    const geo = model.geometry;
    const gpos = geo && geo.attributes && geo.attributes.position ? geo.attributes.position.array : null;
    const cposIn = model.colloc && model.colloc.pos, cnrmIn = model.colloc && model.colloc.nrm;
    const M0 = cposIn ? Math.floor(cposIn.length / 3) : 0;
    // bbox (model frame)
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    const bsrc = gpos && gpos.length >= 3 ? gpos : cposIn;
    if (bsrc) {
      for (let i = 0; i + 2 < bsrc.length; i += 3) {
        const x = bsrc[i], y = bsrc[i + 1], z = bsrc[i + 2];
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; if (z < bz0) bz0 = z; if (z > bz1) bz1 = z;
      }
    }
    if (!(bx1 > bx0) || M0 < 8) return { trivial: true, model, aeroDef };
    const info = model.info || {};
    const L = Math.max(bx1 - bx0, 1e-3), Dy = by1 - by0, Dz = bz1 - bz0;
    const sdfAt = dim2 ? (x, y) => model.sdf(x, y, 0) : (x, y, z) => model.sdf(x, y, z);

    // collocation points (2D: contour points deduplicated in the x-y plane)
    let M = 0, pos, nrm;
    if (dim2) {
      const seen = new Set(); const pl = [];
      for (let i = 0; i < M0; i++) {
        let nx = cnrmIn[3 * i], ny = cnrmIn[3 * i + 1];
        const nl = Math.hypot(nx, ny);
        if (nl < 0.5) continue;
        const key = Math.round(cposIn[3 * i] * 1e4) + ',' + Math.round(cposIn[3 * i + 1] * 1e4);
        if (seen.has(key)) continue;
        seen.add(key);
        pl.push(cposIn[3 * i], cposIn[3 * i + 1], nx / nl, ny / nl);
      }
      M = pl.length / 4;
      pos = new Float64Array(M * 3); nrm = new Float64Array(M * 3);
      for (let i = 0; i < M; i++) { pos[3 * i] = pl[4 * i]; pos[3 * i + 1] = pl[4 * i + 1]; nrm[3 * i] = pl[4 * i + 2]; nrm[3 * i + 1] = pl[4 * i + 3]; }
    } else {
      M = M0; pos = new Float64Array(M * 3); nrm = new Float64Array(M * 3);
      for (let i = 0; i < M; i++) {
        const nx = cnrmIn[3 * i], ny = cnrmIn[3 * i + 1], nz = cnrmIn[3 * i + 2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        pos[3 * i] = cposIn[3 * i]; pos[3 * i + 1] = cposIn[3 * i + 1]; pos[3 * i + 2] = cposIn[3 * i + 2];
        nrm[3 * i] = nx / nl; nrm[3 * i + 1] = ny / nl; nrm[3 * i + 2] = nz / nl;
      }
    }
    if (M < 8) return { trivial: true, model, aeroDef };

    // interior sources: p - n*delta, delta = 0.35 * local half-thickness (>= 4 mm)
    const K = clamp(Math.round(M / (opts.kDiv || 3)), 6, opts.kMax || 200);
    const srcL = [], cand3 = [], candW = [];
    const step = Math.max(2e-4, 0.004 * L);
    const Lmax = Math.max(L, Dy, dim2 ? 0 : Dz);
    const maxSteps = Math.ceil(0.9 * Lmax / step);
    for (let i = 0; i < M; i++) {
      const px = pos[3 * i], py = pos[3 * i + 1], pz = pos[3 * i + 2];
      const nx = nrm[3 * i], ny = nrm[3 * i + 1], nz = nrm[3 * i + 2];
      let best = sdfAt(px, py, pz), bestS = 0;
      for (let s = 1; s <= maxSteps; s++) {
        const t = s * step;
        const v = sdfAt(px - nx * t, py - ny * t, pz - nz * t);
        if (v < best) { best = v; bestS = t; }
        else if (v > best + 0.3 * step || v >= 0) break;
      }
      // local curvature radius from neighbouring collocation normals (tight tips -> shallow sources)
      let rho = 1e9;
      for (let q = 0; q < M; q++) {
        if (q === i) continue;
        const dd = Math.sqrt((pos[3 * q] - px) ** 2 + (pos[3 * q + 1] - py) ** 2 + (dim2 ? 0 : (pos[3 * q + 2] - pz) ** 2));
        if (dd > 0.25 * Lmax) continue;
        const dn = Math.sqrt((nrm[3 * q] - nx) ** 2 + (nrm[3 * q + 1] - ny) ** 2 + (dim2 ? 0 : (nrm[3 * q + 2] - nz) ** 2));
        if (dn > 1e-6 && dd / dn < rho) rho = dd / dn;
      }
      let delta = Math.max(0.004, Math.min(0.35 * bestS, curvF * rho));
      let sx = px - nx * delta, sy = py - ny * delta, sz = pz - nz * delta;
      if (sdfAt(sx, sy, sz) >= -0.3 * delta) {
        delta *= 0.5;
        sx = px - nx * delta; sy = py - ny * delta; sz = pz - nz * delta;
        if (sdfAt(sx, sy, sz) >= -0.3 * delta) continue;
      }
      cand3.push(sx, sy, dim2 ? 0 : sz); candW.push(1 + curvBeta * Math.min(Lmax / rho, 40));
      if ((i & 7) === 7) yield 0;
    }
    {
      // choose K sources evenly in cumulative (1 + beta * curvature) weight: more sources at tight tips/edges
      const nc = cand3.length / 3;
      let tot = 0;
      for (let c = 0; c < nc; c++) tot += candW[c];
      let acc = 0, c = 0;
      for (let t = 0; t < Math.min(K, nc); t++) {
        const target = (t + 0.5) / K * tot;
        while (c < nc - 1 && acc + candW[c] < target) { acc += candW[c]; c++; }
        srcL.push(cand3[3 * c], cand3[3 * c + 1], cand3[3 * c + 2]);
        acc += candW[c]; if (c < nc - 1) c++;
      }
    }
    const Ks = srcL.length / 3;
    if (Ks < 6) return { trivial: true, model, aeroDef };
    const src = Float64Array.from(srcL);

    // lifting lines -> horseshoe data (weights r = (S/b)/max)
    const bndL = [], legL = [], v2L = [], lines = [];
    const ll = model.liftingLines || [];
    const wingsInfo = info.wings || [];
    const cand = [];
    for (let li = 0; li < ll.length; li++) {
      const ln = ll[li];
      let a = ln.a, b = ln.b;
      const c = ln.chord > 0 ? ln.chord : 0.1;
      const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (dim2) {
        cand.push({ id: ln.id, a, b, c, span, S: c, bb: 1, w2: true });
      } else {
        if (ln.spanning) continue;
        if (Math.abs(b[1] - a[1]) > Math.abs(b[2] - a[2])) continue; // vertical surface: no lift loading
        let S = span * c;
        for (let w = 0; w < wingsInfo.length; w++) if (wingsInfo[w].id === ln.id && wingsInfo[w].S > 0) S = wingsInfo[w].S;
        cand.push({ id: ln.id, a, b, c, span, S, bb: span, w2: false });
      }
    }
    let rmax = 0;
    for (const cd of cand) { cd.r0 = cd.S / cd.bb; if (cd.r0 > rmax) rmax = cd.r0; }
    for (const cd of cand) {
      const r = rmax > 0 ? cd.r0 / rmax : 1;
      const core = 0.04 * cd.c;
      lines.push({ id: cd.id, r, S: cd.S, b: cd.span, c: cd.c });
      if (cd.w2) {
        v2L.push(0.5 * (cd.a[0] + cd.b[0]), 0.5 * (cd.a[1] + cd.b[1]), r / TWO_PI, core * core);
      } else {
        let a = cd.a, b = cd.b;
        if (b[2] > a[2]) { const t = a; a = b; b = t; } // bound circulation along -z
        const G = new Float64Array(8);
        for (let i = 0; i < 8; i++) { const s = (i + 0.5) / 8 * 2 - 1; G[i] = r * Math.sqrt(Math.max(0, 1 - s * s)); }
        const P = [];
        for (let j = 0; j <= 8; j++) P.push([a[0] + (b[0] - a[0]) * j / 8, a[1] + (b[1] - a[1]) * j / 8, a[2] + (b[2] - a[2]) * j / 8]);
        for (let i = 0; i < 8; i++) {
          const p1 = P[i], p2 = P[i + 1];
          const r0x = p2[0] - p1[0], r0y = p2[1] - p1[1], r0z = p2[2] - p1[2];
          bndL.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], G[i] / (4 * PI), core * core * (r0x * r0x + r0y * r0y + r0z * r0z), r0x, r0y, r0z);
        }
        for (let j = 0; j <= 8; j++) {
          const gl = (j > 0 ? G[j - 1] : 0) - (j < 8 ? G[j] : 0);
          legL.push(P[j][0], P[j][1], P[j][2], gl / (4 * PI), core * core);
        }
      }
    }

    // grid
    const cyc = 0.5 * (by0 + by1), czc = 0.5 * (bz0 + bz1);
    const gx0 = bx0 - 1.0 * L, gx1 = bx1 + 2.5 * L;
    let nx, ny, nz, hw;
    if (dim2) {
      hw = Math.max(1.2 * Dy, 0.6 * L);
      nx = 96; const hx = (gx1 - gx0) / (nx - 1);
      ny = clamp(Math.round(2 * hw / hx) + 1, 24, 96); nz = 1;
    } else {
      hw = Math.max(1.2 * Math.max(Dz, Dy), 0.35 * L);
      nx = 64; const hx = (gx1 - gx0) / (nx - 1);
      ny = nz = clamp(Math.round(2 * hw / hx) + 1, 20, 42);
    }
    const grid = {
      x0: gx0, y0: cyc - hw, z0: dim2 ? 0 : czc - hw,
      hx: (gx1 - gx0) / (nx - 1), hy: 2 * hw / (ny - 1), hz: nz > 1 ? 2 * hw / (nz - 1) : 1,
      nx, ny, nz
    };
    grid.ihx = 1 / grid.hx; grid.ihy = 1 / grid.hy; grid.ihz = 1 / grid.hz;
    const nNodes = nx * ny * nz;
    const inside = new Uint8Array(nNodes);
    const sdfN = new Float32Array(nNodes).fill(1e9);
    const iA = Math.max(0, Math.floor((bx0 - grid.x0) / grid.hx) - 3), iB = Math.min(nx - 1, Math.ceil((bx1 - grid.x0) / grid.hx) + 3);
    const jA = Math.max(0, Math.floor((by0 - grid.y0) / grid.hy) - 3), jB = Math.min(ny - 1, Math.ceil((by1 - grid.y0) / grid.hy) + 3);
    const kA = nz > 1 ? Math.max(0, Math.floor((bz0 - grid.z0) / grid.hz) - 3) : 0, kB = nz > 1 ? Math.min(nz - 1, Math.ceil((bz1 - grid.z0) / grid.hz) + 3) : 0;
    let cnt = 0;
    for (let k = kA; k <= kB; k++) for (let j = jA; j <= jB; j++) for (let i = iA; i <= iB; i++) {
      const idx = (k * ny + j) * nx + i;
      const d = sdfAt(grid.x0 + i * grid.hx, grid.y0 + j * grid.hy, grid.z0 + k * grid.hz);
      sdfN[idx] = d; if (d < 0) inside[idx] = 1;
      if ((++cnt & 511) === 0) yield 0;
    }
    const nzc = nz > 1 ? nz - 1 : 1;
    const flags = new Uint8Array((nx - 1) * (ny - 1) * nzc);
    const thr = 1.5 * Math.max(grid.hx, grid.hy, nz > 1 ? grid.hz : 0);
    const kLast = nz > 1 ? kB - 1 : 0;
    for (let k = kA; k <= kLast; k++) {
      for (let j = jA; j < jB; j++) for (let i = iA; i < iB; i++) {
        let mn = 1e9;
        const kk = nz > 1 ? 2 : 1;
        for (let dk = 0; dk < kk; dk++) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
          const v = sdfN[((k + dk) * ny + (j + dj)) * nx + (i + di)];
          if (v < mn) mn = v;
        }
        if (mn < thr) flags[(k * (ny - 1) + j) * (nx - 1) + i] = 1;
      }
    }

    const nv = gpos ? Math.floor(gpos.length / 3) : 0;
    const vpos = gpos ? Float32Array.from(gpos.subarray ? gpos.subarray(0, nv * 3) : gpos) : new Float32Array(0);
    const inp = {
      dim2, M, K: Ks, pos, nrm, src, lambda, closeW, irls: opts.irls,
      bnd: Float64Array.from(bndL), nb: bndL.length / 11, leg: Float64Array.from(legL), nl: legL.length / 5,
      v2: Float64Array.from(v2L), n2: v2L.length / 4,
      grid, inside, nv, vpos
    };
    const bodyD = info.body && info.body.D > 0 ? info.body.D : info.D > 0 ? info.D : Math.max(Dy, 1e-3);
    const meta = {
      model, aeroDef, dim2, bbox: { x0: bx0, x1: bx1, y0: by0, y1: by1, z0: bz0, z1: bz1 }, L, Dy, Dz,
      zc: czc, zspan: dim2 ? 2.4 : Dz, noseR: 0.5 * bodyD,
      grid, flags, lines, nv, cpos: pos, cnrm: nrm, cM: M, src, K: Ks,
      bnd: inp.bnd, nb: inp.nb, leg: inp.leg, nl: inp.nl, v2: inp.v2, n2: inp.n2
    };
    return { inp, meta };
  }

  function drive(gen, job) {
    return new Promise((resolve) => {
      function tick() {
        if (job.cancelled) { resolve(null); return; }
        const t0 = now();
        let r;
        do {
          r = gen.next();
          if (r.done) { resolve(r.value); return; }
        } while (now() - t0 < sliceMs);
        setTimeout(tick, 0);
      }
      tick();
    });
  }

  function bakeInWorker(inp, job) {
    return new Promise((resolve) => {
      let w = null;
      try {
        const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
        w = new Worker(url);
        job.worker = w;
        const fallback = () => {
          try { w.terminate(); } catch (e) { /* ignore */ }
          job.worker = null;
          resolve(drive(ENG.bake(inp), job));
        };
        w.onerror = fallback;
        w.onmessageerror = fallback;
        w.onmessage = (e) => {
          const d = e.data;
          try { w.terminate(); } catch (err) { /* ignore */ }
          job.worker = null;
          if (job.cancelled) { resolve(null); return; }
          if (d && d.ok) resolve(d.out); else resolve(drive(ENG.bake(inp), job));
        };
        w.postMessage(inp);
      } catch (e) {
        resolve(drive(ENG.bake(inp), job));
      }
    });
  }

  function resetWake() {
    vAct.fill(0); W.nAct = 0; R.simT = 0; R.phU = 0; R.nextPh = 0; R.relIdx = 0; R.xconv = 0; R.tAnim = 0; R.sepKey = '';
    relN = 0; relSeq = 0; rng = mulberry32(1234); R.lastD = -1;
  }

  function setModel(model, aeroDef) {
    if (activeJob) { activeJob.cancelled = true; if (activeJob.worker) { try { activeJob.worker.terminate(); } catch (e) { /* ignore */ } } }
    const job = { id: ++jobSeq, cancelled: false, worker: null };
    activeJob = job;
    return (async () => {
      const prep = await drive(prepareGen(model, aeroDef), job);
      if (job.cancelled || prep === null) return false;
      let state;
      if (prep.trivial) {
        state = { trivial: true, model, aeroDef, dim2: !!model.spanning, nv: 0, surf: new Float32Array(0), lines: [], needG: false };
      } else {
        const inp = prep.inp, meta = prep.meta;
        const canWorker = wantWorker && typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL;
        const out = canWorker ? await bakeInWorker(inp, job) : await drive(ENG.bake(inp), job);
        if (job.cancelled || out === null) return false;
        const vort = ENG.makeVortexField(meta.bnd, meta.nb, meta.leg, meta.nl, meta.v2, meta.n2);
        meta.evalAt = ENG.makeEvaluator({ dim2: meta.dim2, K: meta.K, src: meta.src, sx: out.sx, sy: out.sy, sg: out.sg, vort });
        meta.gdata = out.grid; meta.surf = out.surf; meta.sx = out.sx; meta.sy = out.sy; meta.sg = out.sg; meta.lambdaEff = out.lambda;
        meta.hasLines = vort !== null; meta.needG = vort !== null; meta.trivial = false;
        state = meta;
      }
      cur = state;
      resetWake();
      R.gnd = 0; R.needG = false;
      if (activeJob === job) activeJob = null;
      return true;
    })();
  }

  /* ------------------------ per-frame update ----------------------------- */
  function findCL(res, id) {
    const a = res.surfacesCL;
    if (a) for (let i = 0; i < a.length; i++) if (a[i].id === id) return a[i].CL;
    return res.CL || 0;
  }
  function gammaND(res) {
    if (!cur || !cur.lines || cur.lines.length === 0 || !res) return 0;
    let num = 0, den = 0;
    const dim2 = cur.dim2;
    for (let i = 0; i < cur.lines.length; i++) {
      const l = cur.lines[i];
      const CL = findCL(res, l.id);
      const g = dim2 ? 0.5 * l.c * CL : 2 * l.S * CL / (PI * l.b);
      num += g * l.r; den += l.r * l.r;
    }
    return den > 0 ? num / den : 0;
  }

  function readRes(res) {
    R.hasRes = true;
    const M = Number.isFinite(res.M) ? res.M : 0;
    R.M = M;
    const Mc = Math.min(M, 0.8);
    R.invb = 1 / Math.sqrt(1 - Mc * Mc);
    R.St = res.St > 0 ? res.St : 0.2;
    R.D = Math.max(res.Dshed > 0 ? res.Dshed : 0.1, 0.01);
    R.Re = res.Re > 0 ? res.Re : 1e5;
    R.wake = res.regime && WAKE_CODE[res.regime.wake] !== undefined ? WAKE_CODE[res.regime.wake] : 0;
    R.sepDeg = Number.isFinite(res.sepDeg) ? res.sepDeg : 180;
    R.cpb = Number.isFinite(res.cpb) ? res.cpb : -0.2;
    R.q = res.q > 0 ? res.q : 0;
    const T0 = res.T0 > 0 ? res.T0 : 288.15;
    const f = 1 + 0.2 * M * M;
    if (Number.isFinite(res.U) && res.U > 0) R.U = res.U;
    else R.U = M > 0 ? M * Math.sqrt(GAMMA_AIR * R_AIR * T0 / f) : R.Uvis;
    R.pInf = res.p0 > 0 ? res.p0 / Math.pow(f, 3.5) : 101325;
  }

  function computeSep(alphaRad) {
    const m = cur, pos = m.cpos, nrm = m.cnrm, n = m.cM;
    const ca = Math.cos(alphaRad), sa = Math.sin(alphaRad);
    const mode = m.aeroDef && m.aeroDef.sep ? m.aeroDef.sep.mode : 'angle';
    const phiS = mode === 'edge' ? Math.min(R.sepDeg, EDGE_DEG) : R.sepDeg;
    let ymin = Infinity, ymax = -Infinity, xmin = Infinity, iN = 0;
    for (let i = 0; i < n; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1];
      const xw = x * ca + y * sa, yw = -x * sa + y * ca;
      if (yw < ymin) ymin = yw; if (yw > ymax) ymax = yw;
      if (xw < xmin) { xmin = xw; iN = i; }
    }
    const ymid = 0.5 * (ymin + ymax), hh = 0.5 * (ymax - ymin) + 1e-9;
    const zc = m.zc, band = Math.max(0.15 * (m.dim2 ? 0 : m.zspan), 0.02);
    for (let side = 0; side < 2; side++) {
      let bestK = Infinity, bestX = 0, bestY = 0, anyX = 0, anyY = 0, anyPhi = -1;
      for (let i = 0; i < n; i++) {
        if (!m.dim2 && Math.abs(pos[3 * i + 2] - zc) > band) continue;
        const nx = nrm[3 * i], ny = nrm[3 * i + 1];
        const nxw = nx * ca + ny * sa, nyw = -nx * sa + ny * ca;
        if (side === 0 ? nyw < 0 : nyw > 0) continue;
        const x = pos[3 * i], y = pos[3 * i + 1];
        const xw = x * ca + y * sa, yw = -x * sa + y * ca;
        const phi = Math.acos(clamp(-nxw, -1, 1)) / DEG;
        const yh = (yw - ymid) / hh;
        if (phi > anyPhi) { anyPhi = phi; anyX = xw; anyY = yw; }
        if (phi >= phiS) {
          const key = phi - 20 * (side === 0 ? yh : -yh);
          if (key < bestK) { bestK = key; bestX = xw; bestY = yw; }
        }
      }
      if (bestK === Infinity) { bestX = anyX; bestY = anyY; }
      if (side === 0) { W.xUp = bestX; W.yUp = bestY; } else { W.xLo = bestX; W.yLo = bestY; }
    }
    if (W.yUp < W.yLo) { const t = W.yUp; W.yUp = W.yLo; W.yLo = t; }
    W.xs = Math.min(W.xUp, W.xLo);
    W.yc = 0.5 * (W.yUp + W.yLo);
    W.xNose = xmin;
    W.yNose = -pos[3 * iN] * sa + pos[3 * iN + 1] * ca;
    W.zNose = m.dim2 ? 0 : pos[3 * iN + 2];
    W.zc = m.zc; W.zspan = m.zspan; W.spanning = m.dim2;
  }

  function updateShock() {
    R.shockOn = false;
    const m = cur, M = R.M;
    if (!m || !(M > 1.0)) return;
    const ad = m.aeroDef || {};
    const mu = Math.asin(1 / M);
    SH.planar = m.dim2; SH.ay = W.yNose; SH.az = W.zNose;
    shockObj.planar = m.dim2;
    if (ad.nose === 'sharp') {
      const th = Math.min(mu + 0.5 * (ad.noseHalfDeg || 0) * DEG, 85 * DEG);
      SH.type = 0; SH.ax = W.xNose; SH.sinT = Math.sin(th); SH.cosT = Math.cos(th);
      shockObj.type = 'cone'; shockObj.halfAngle = th; shockObj.standoff = 0; shockObj.R = 0;
      shockObj.apex[0] = W.xNose; shockObj.apex[1] = W.yNose; shockObj.apex[2] = W.zNose;
    } else {
      const Rn = m.noseR, pl = m.dim2;
      // Billig (1967). Constants: sphere 0.143/3.24 and 1.143/0.54/1.2; cylinder (2D) 0.386/4.67, 1.386/1.8/0.75
      const delta = Rn * (pl ? 0.386 * Math.exp(4.67 / (M * M)) : 0.143 * Math.exp(3.24 / (M * M)));
      const dm = Math.max(M - 1, 0.02);
      const Rc = Rn * (pl ? 1.386 * Math.exp(1.8 / Math.pow(dm, 0.75)) : 1.143 * Math.exp(0.54 / Math.pow(dm, 1.2)));
      SH.type = 1; SH.xv = W.xNose - delta; SH.Rc = Rc; SH.tanMu = Math.tan(mu); SH.cot2 = 1 / (SH.tanMu * SH.tanMu);
      shockObj.type = 'bow'; shockObj.halfAngle = mu; shockObj.standoff = delta; shockObj.R = Rn;
      shockObj.apex[0] = SH.xv; shockObj.apex[1] = W.yNose; shockObj.apex[2] = W.zNose;
    }
    shockObj.halfAngleDeg = shockObj.halfAngle / DEG;
    R.shockOn = true;
  }

  function shockGate(x, y, z) {
    const dy = y - SH.ay;
    const rho = SH.planar ? Math.abs(dy) : Math.sqrt(dy * dy + (z - SH.az) * (z - SH.az));
    let d;
    if (SH.type === 0) d = (x - SH.ax) * SH.sinT - rho * SH.cosT;
    else {
      const q = SH.tanMu * rho / SH.Rc, s = Math.sqrt(1 + q * q);
      const xs = SH.xv + SH.Rc * SH.cot2 * (s - 1);
      const slope = (rho / SH.Rc) / s;
      d = (x - xs) / Math.sqrt(1 + slope * slope);
    }
    if (d <= 0) return 0;
    if (d >= 0.02) return 1;
    const t = d / 0.02;
    return t * t * (3 - 2 * t);
  }

  function packVortices() {
    let n = 0;
    for (let i = 0; i < NV; i++) {
      if (!vAct[i]) continue;
      pX[n] = vX[i]; pY[n] = vY[i]; pG[n] = vG0[i] * Math.exp(-vAge[i] * (R.St * R.Uvis / R.D) * 0.25) / TWO_PI;
      pS2[n] = 0.01 * R.D * R.D + 4 * (R.Uvis * R.D / Math.max(R.Re, 10)) * vAge[i];
      n++;
    }
    if (R.wake === 1) { // steady recirculation pair
      const Lb = Math.min(0.05 * R.Re * R.D, 2 * R.D);
      const xc = W.xs + 0.5 * Lb, h = 0.3 * R.D;
      const G = 0.3 * PI * R.Uvis * h;
      const s2 = Math.pow(Math.max(0.2 * Lb, 0.1 * R.D), 2);
      pX[n] = xc; pY[n] = W.yc + h; pG[n] = -G / TWO_PI; pS2[n] = s2; n++;
      pX[n] = xc; pY[n] = W.yc - h; pG[n] = G / TWO_PI; pS2[n] = s2; n++;
    }
    W.nAct = n;
  }

  function releaseVortex(side, age0) {
    let slot = -1, oldest = 0, oldSeq = Infinity;
    for (let i = 0; i < NV; i++) {
      if (!vAct[i]) { slot = i; break; }
      if (vSeq[i] < oldSeq) { oldSeq = vSeq[i]; oldest = i; }
    }
    if (slot < 0) slot = oldest;
    const D = R.D, f = R.St * R.Uvis / D;
    const jit = 1 + 0.08 * (2 * rng() - 1);
    const mag = 2.2 * R.Uvis * D * jit * (R.wake === 3 ? 0.4 : 1);
    const a = 0.85 * R.Uvis / f, h = 0.28 * a;
    vG0[slot] = side === 0 ? -mag : mag;
    vYr[slot] = side === 0 ? W.yUp : W.yLo;
    vYt[slot] = W.yc + (side === 0 ? 0.5 * h : -0.5 * h);
    vX[slot] = (side === 0 ? W.xUp : W.xLo) + 0.85 * R.Uvis * age0;
    vAge[slot] = age0; vAct[slot] = 1; vSeq[slot] = ++relSeq;
    vY[slot] = vYr[slot];
  }

  function update(res, alphaDeg, Uvis, dt) {
    R.Uvis = Uvis;
    if (res) readRes(res);
    const a = alphaDeg * DEG;
    if (a !== R.alphaRad) { R.alphaRad = a; R.ca = Math.cos(a); R.sa = Math.sin(a); }
    const m = cur;
    if (m === null || m.trivial || !res) { W.active = false; R.shockOn = false; return; }
    R.gnd = gammaND(res);
    R.needG = m.needG && Math.abs(R.gnd) > 1e-12;
    const key = alphaDeg + '|' + R.sepDeg + '|' + (m.aeroDef && m.aeroDef.sep ? m.aeroDef.sep.mode : '');
    if (key !== R.sepKey) { R.sepKey = key; computeSep(a); }
    updateShock();
    W.active = true;
    if (!(dt > 0)) { packVortices(); return; }
    if (dt > 0.1) dt = 0.1;
    const D = R.D;
    if (Math.abs(D - R.lastD) > 0.01 * D) { R.lastD = D; setModes(D); }
    W.ampT = (R.wake === 0 ? 0.04 : 0.25) * Uvis;
    R.simT += dt; R.xconv += 0.85 * Uvis * dt; R.tAnim += dt;
    const f = R.St * Uvis / D;
    // advance existing vortices
    const tau = 1 / (2 * f);
    for (let i = 0; i < NV; i++) {
      if (!vAct[i]) continue;
      vAge[i] += dt; vX[i] += 0.85 * Uvis * dt;
      vY[i] = vYr[i] + (vYt[i] - vYr[i]) * (1 - Math.exp(-vAge[i] / tau));
      if (vAge[i] * f > 14 || vX[i] > 4.2) vAct[i] = 0;
    }
    // release
    if ((R.wake === 2 || R.wake === 3) && f > 0) {
      R.phU += TWO_PI * f * dt;
      let guard = 0;
      while (R.phU >= R.nextPh && guard++ < 4) {
        const over = (R.phU - R.nextPh) / (TWO_PI * f);
        releaseVortex(R.relIdx & 1, over);
        if (relN < relT.length) relT[relN++] = R.simT - over;
        R.relIdx++;
        R.nextPh += PI * (R.wake === 3 ? 1 + 0.4 * (2 * rng() - 1) : 1);
      }
    }
    packVortices();
  }

  /* --------------------------- wake sampling ----------------------------- */
  function addWake(x, y, z) {
    wk[0] = 0; wk[1] = 0; wk[2] = 0;
    const dxs = x - W.xs;
    if (dxs <= 0) return;
    const D = R.D;
    if (W.nAct > 0) {
      const gate = smooth01(dxs / (0.15 * D));
      let ez = 1;
      if (!W.spanning) {
        const t = (Math.abs(z - W.zc) - 0.5 * W.zspan) / (0.3 * W.zspan + 0.5 * D);
        ez = 1 - smooth01(t);
      }
      const gg = gate * ez;
      if (gg > 0) {
        const R1 = 5 * D, R2 = 8 * D, R1s = R1 * R1, span = R2 - R1;
        let ux = 0, uy = 0;
        for (let i = 0; i < W.nAct; i++) {
          const dx = x - pX[i];
          if (dx > R2 || dx < -R2) continue;
          const dy = y - pY[i];
          const r2 = dx * dx + dy * dy;
          if (r2 < 1e-12) continue;
          let f = 1 / r2;
          const s2 = pS2[i];
          if (r2 < 20 * s2) f *= 1 - Math.exp(-r2 / s2);
          if (r2 > R1s) { const r = Math.sqrt(r2); if (r >= R2) continue; const w = 0.5 * (1 + Math.cos(PI * (r - R1) / span)); f *= w; }
          f *= pG[i];
          ux -= f * dy; uy += f * dx;
        }
        wk[0] += ux * gg; wk[1] += uy * gg;
      }
    }
    // curl-noise turbulence inside the wake envelope
    const amp = W.ampT;
    if (amp > 0) {
      const hy = 0.5 * D + 0.12 * dxs;
      const ty = y - W.yc;
      const sy = Math.abs(ty) / hy;
      if (sy >= 1.2) return;
      let hz = 1e3, sz = 0, tz = 0;
      if (!W.spanning) {
        hz = 0.5 * Math.max(W.zspan, D) + 0.12 * dxs; tz = z - W.zc; sz = Math.abs(tz) / hz;
        if (sz >= 1.2) return;
      }
      // envelope pieces
      const Tr = 0.3 * D;
      const t1 = dxs / Tr;
      const ru = t1 >= 1 ? 1 : t1 * t1 * (3 - 2 * t1), dru = t1 >= 1 ? 0 : 6 * t1 * (1 - t1) / Tr;
      const Ld = 8 * D, dec = Math.exp(-dxs / Ld);
      const ex = ru * dec, dex = dru * dec - ru * dec / Ld;
      let ey = 1, dey_s = 0;
      if (sy > 0.6) { const th = PI * (sy - 0.6) / 0.6; ey = 0.5 * (1 + Math.cos(th)); dey_s = -0.5 * Math.sin(th) * PI / 0.6; }
      let ez = 1, dez_s = 0;
      if (sz > 0.6) { const th = PI * (sz - 0.6) / 0.6; ez = 0.5 * (1 + Math.cos(th)); dez_s = -0.5 * Math.sin(th) * PI / 0.6; }
      const env = ex * ey * ez;
      if (env <= 0 && dex === 0) return;
      const dEy = dey_s * (ty >= 0 ? 1 : -1) / hy;
      const dEx = dex * ey * ez + ex * ez * dey_s * (-sy / hy) * 0.12 + (sz > 0 ? ex * ey * dez_s * (-sz / hz) * 0.12 : 0);
      const dEyy = ex * ez * dEy;
      const dEz = sz > 0 ? ex * ey * dez_s * (tz >= 0 ? 1 : -1) / hz : 0;
      const xr = x - R.xconv;
      let cx = 0, cy = 0, cz = 0, px = 0, py = 0, pz = 0;
      for (let m = 0; m < NMODE; m++) {
        const th = tK[3 * m] * xr + tK[3 * m + 1] * y + tK[3 * m + 2] * z + tPh[m] + tOm[m] * 0.6 * R.tAnim;
        const s = Math.sin(th), c = Math.cos(th);
        cx -= tKA[3 * m] * s; cy -= tKA[3 * m + 1] * s; cz -= tKA[3 * m + 2] * s;
        px += tA[3 * m] * c; py += tA[3 * m + 1] * c; pz += tA[3 * m + 2] * c;
      }
      // u = env * curl(psi0) + grad(env) x psi0
      const ux = env * cx + (dEyy * pz - dEz * py);
      const uy = env * cy + (dEz * px - dEx * pz);
      const uz = env * cz + (dEx * py - dEyy * px);
      const sc2 = amp * Math.sqrt(2 / NMODE);
      wk[0] += ux * sc2; wk[1] += uy * sc2; wk[2] += uz * sc2;
    }
  }

  function inEnvelope(x, y, z) {
    if (!W.active) return false;
    const dxs = x - W.xs;
    if (dxs <= 0) return false;
    const k = R.wake === 0 ? 0.25 : 1;
    const hy = k * (0.5 * R.D + 0.12 * dxs);
    if (Math.abs(y - W.yc) > hy) return false;
    if (!W.spanning) {
      const hz = 0.5 * Math.max(W.zspan, R.D) + 0.12 * dxs;
      if (Math.abs(z - W.zc) > hz) return false;
    }
    return dxs < 40 * R.D;
  }

  /* ------------------------------ sampling ------------------------------- */
  function worldSdf(x, y, z) {
    const m = cur;
    if (m === null || m.trivial) return 1;
    const ca = R.ca, sa = R.sa;
    return m.model.sdf(x * ca - y * sa, x * sa + y * ca, m.dim2 ? 0 : z);
  }

  function insideSample(mx, my, mz, d, out) {
    const m = cur, model = m.model, e = 2e-3;
    const z0 = m.dim2 ? 0 : mz;
    let gx = model.sdf(mx + e, my, z0) - model.sdf(mx - e, my, z0);
    let gy = model.sdf(mx, my + e, z0) - model.sdf(mx, my - e, z0);
    let gz = m.dim2 ? 0 : model.sdf(mx, my, z0 + e) - model.sdf(mx, my, z0 - e);
    let gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (gl < 1e-12) { gx = 1; gy = 0; gz = 0; gl = 1; }
    gx /= gl; gy /= gl; gz /= gl;
    const sx = mx - d * gx, sy = my - d * gy, sz = z0 - d * gz;
    m.evalAt(sx, sy, sz, iv9, R.needG);
    const Uv = R.Uvis, ib = R.invb, ca = R.ca, sa = R.sa;
    const k = Uv * ib;
    const vx = Uv * ca + k * (ca * iv9[0] + sa * iv9[3] + R.gnd * iv9[6]);
    const vy = Uv * sa + k * (ca * iv9[1] + sa * iv9[4] + R.gnd * iv9[7]);
    const vz = k * (ca * iv9[2] + sa * iv9[5] + R.gnd * iv9[8]);
    const vn = vx * gx + vy * gy + vz * gz;
    const tx = vx - vn * gx, ty = vy - vn * gy, tz = vz - vn * gz;
    out[0] = tx * ca + ty * sa; out[1] = -tx * sa + ty * ca + 0; out[2] = tz + 0;
    return out;
  }
  const iv9 = new Float64Array(9);

  function sample(x, y, z, out) {
    const m = cur;
    const Uv = R.Uvis;
    if (m === null || m.trivial) { out[0] = Uv; out[1] = 0; out[2] = 0; return out; }
    const ca = R.ca, sa = R.sa;
    const mx = x * ca - y * sa, my = x * sa + y * ca;
    const dim2 = m.dim2;
    const g = m.grid;
    const fx = (mx - g.x0) * g.ihx, fy = (my - g.y0) * g.ihy;
    const fz = dim2 ? 0 : (z - g.z0) * g.ihz;
    const needG = R.needG;
    let exact = true;
    if (fx >= 0 && fx < g.nx - 1 && fy >= 0 && fy < g.ny - 1 && (dim2 || (fz >= 0 && fz < g.nz - 1))) {
      const i0 = fx | 0, j0 = fy | 0, k0 = fz | 0;
      if (m.flags[(k0 * (g.ny - 1) + j0) * (g.nx - 1) + i0] === 0) {
        exact = false;
        const tx = fx - i0, ty = fy - j0, tz = fz - k0;
        const ux = 1 - tx, uy = 1 - ty, uz = 1 - tz;
        const w000 = ux * uy * uz, w100 = tx * uy * uz, w010 = ux * ty * uz, w110 = tx * ty * uz;
        const w001 = ux * uy * tz, w101 = tx * uy * tz, w011 = ux * ty * tz, w111 = tx * ty * tz;
        const nx = g.nx, dj = nx * 9, dk = nx * g.ny * 9;
        const b = ((k0 * g.ny + j0) * nx + i0) * 9;
        const d = m.gdata;
        const nc = needG ? 9 : 6;
        for (let c = 0; c < nc; c++) {
          const o = b + c;
          sc[c] = w000 * d[o] + w100 * d[o + 9] + w010 * d[o + dj] + w110 * d[o + dj + 9] +
            (dim2 ? 0 : w001 * d[o + dk] + w101 * d[o + dk + 9] + w011 * d[o + dk + dj] + w111 * d[o + dk + dj + 9]);
        }
      } else {
        const dd = m.model.sdf(mx, my, dim2 ? 0 : z);
        if (dd < 0) return insideSample(mx, my, z, dd, out);
      }
    }
    if (exact) m.evalAt(mx, my, z, sc, needG);
    const k = Uv * R.invb, gnd = needG ? R.gnd : 0;
    const px = k * (ca * sc[0] + sa * sc[3] + gnd * sc[6]);
    const py = k * (ca * sc[1] + sa * sc[4] + gnd * sc[7]);
    const pz = k * (ca * sc[2] + sa * sc[5] + gnd * sc[8]);
    let wx = px * ca + py * sa, wy = -px * sa + py * ca, wz = pz;
    if (W.active) {
      addWake(x, y, z);
      wx += wk[0]; wy += wk[1]; wz += wk[2];
    }
    if (R.shockOn) {
      const gt = shockGate(x, y, z);
      wx *= gt; wy *= gt; wz *= gt;
    }
    out[0] = Uv + wx; out[1] = wy + 0; out[2] = wz + 0; // +0 normalises -0
    return out;
  }

  function probe(x, y, z) {
    sample(x, y, z, pv);
    const sv = Math.sqrt(pv[0] * pv[0] + pv[1] * pv[1] + pv[2] * pv[2]);
    const Uv = Math.max(R.Uvis, 1e-9);
    probeOut.speed = sv * (R.U / Uv);
    const r = sv / Uv;
    probeOut.cp = 1 - r * r;
    probeOut.p = R.pInf + R.q * probeOut.cp;
    probeOut.inWake = inEnvelope(x, y, z);
    return probeOut;
  }

  const dbg = {
    evalExact(x, y, z, out) { // model frame, perturbation fields (X, Y, G)
      if (!cur || cur.trivial) { out.fill(0); return out; }
      cur.evalAt(x, y, z, out, true); return out;
    },
    grid() { return cur ? cur.grid : null; },
    state() { return cur; },
    wake() {
      const x = [], y = [];
      for (let i = 0; i < NV; i++) if (vAct[i]) { x.push(vX[i]); y.push(vY[i]); }
      return { x, y, xSep: W.xs, yUp: W.yUp, yLo: W.yLo, xNose: W.xNose };
    },
    releases() { return Array.from(relT.subarray(0, relN)); },
    lambda() { return cur ? cur.lambdaEff : 0; }
  };

  return {
    setModel,
    update,
    sample,
    sdf: worldSdf,
    phase() { const p = R.phU % TWO_PI; return p < 0 ? p + TWO_PI : p; },
    shock() { return R.shockOn ? shockObj : null; },
    probe,
    surfaceData() { return cur; },
    gammaND,
    _debug: dbg
  };
}

export const _makeEngine = makeEngine;
export const _workerSource = WORKER_SRC;
