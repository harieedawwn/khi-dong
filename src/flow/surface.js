// src/flow/surface.js  (P2)
// Per-vertex surface pressure coefficient and skin friction from the baked unit
// fields of flowfield.js. Model frame, current alpha applied.
//   surfaceFields(flow, model, res, air, alphaDeg)
//     -> { cp, tau, frontPa, frontN, cpRange:[min,max] }
// The returned object and its arrays are reused between calls (no per-frame allocation);
// copy them if you need to keep a snapshot.

const DEG = Math.PI / 180;
const GAMMA = 1.4;
const EDGE_DEG = Math.acos(-0.15) / DEG;

const cache = new WeakMap();
const UT_MAX = 3; // cap on surface speed (guards near-source spikes)

function smooth01(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

// Stagnation pressure coefficient: isentropic (M<1), Rayleigh pitot (M>=1)
export function cp0(M) {
  if (!(M > 1e-3)) return 1;
  const g = GAMMA, m2 = M * M;
  let ratio;
  if (M < 1) ratio = Math.pow(1 + 0.5 * (g - 1) * m2, g / (g - 1));
  else {
    const a = Math.pow(((g + 1) * (g + 1) * m2) / (4 * g * m2 - 2 * (g - 1)), g / (g - 1));
    ratio = a * (1 - g + 2 * g * m2) / (g + 1);
  }
  return (ratio - 1) / (0.5 * g * m2);
}

function getCache(flow, nv) {
  let c = cache.get(flow);
  if (!c || c.nv !== nv) {
    c = { nv, cp: new Float32Array(nv), tau: new Float32Array(nv), proj: new Float32Array(nv),
      out: { cp: null, tau: null, frontPa: 0, frontN: 0, stagPa: 0, windwardN: 0, windwardMeanPa: 0, cpRange: [0, 0] } };
    c.out.cp = c.cp; c.out.tau = c.tau;
    cache.set(flow, c);
  }
  return c;
}

export function surfaceFields(flow, model, res, air, alphaDeg) {
  const geo = model.geometry;
  const posA = geo.attributes.position, nrmA = geo.attributes.normal;
  const pos = posA.array, nrm = nrmA.array;
  const nv = posA.count !== undefined ? posA.count : Math.floor(pos.length / 3);
  const c = getCache(flow, nv);
  const out = c.out, cp = c.cp, tau = c.tau;
  const sd = flow.surfaceData();
  if (!sd || sd.model !== model || sd.trivial || sd.nv !== nv) {
    cp.fill(0); tau.fill(0);
    out.frontPa = 0; out.frontN = 0; out.stagPa = 0; out.windwardN = 0; out.windwardMeanPa = 0; out.cpRange[0] = 0; out.cpRange[1] = 0;
    return out;
  }
  const vel = sd.surf;
  const a = alphaDeg * DEG, ca = Math.cos(a), sa = Math.sin(a);
  const M = res.M || 0;
  const Mc = Math.min(M, 0.8), invb = 1 / Math.sqrt(1 - Mc * Mc);
  const gnd = flow.gammaND(res);
  const rho = air.rho, mu = air.mu;
  const q = res.q > 0 ? res.q : 0;
  const U = q > 0 ? Math.sqrt(2 * q / rho) : 0;
  const C0 = cp0(M);
  const ad = sd.aeroDef || {};
  const mode = ad.sep ? ad.sep.mode : 'angle';
  const sepDeg = Number.isFinite(res.sepDeg) ? res.sepDeg : 180;
  const phiS = mode === 'edge' ? Math.min(sepDeg, EDGE_DEG) : sepDeg;
  const cpb = Number.isFinite(res.cpb) ? res.cpb : -0.2;
  const bl = res.regime ? res.regime.bl : 'turbulent';
  const sBlend = M > 1 ? smooth01((M - 1) / 0.2) : 0;
  const cpVac = M > 1 ? -1 / (M * M) : 0;

  // streamwise coordinate (projection on the freestream); front point = minimum
  const proj = c.proj;
  let pmin = Infinity, pmax = -Infinity;
  for (let v = 0; v < nv; v++) {
    const p = pos[3 * v] * ca + pos[3 * v + 1] * sa;
    proj[v] = p;
    if (p < pmin) pmin = p; if (p > pmax) pmax = p;
  }
  const Lm = model.info && model.info.L > 0 ? model.info.L : Math.max(pmax - pmin, 1e-3);
  const sMin = 0.02 * Lm;

  let cmin = Infinity, cmax = -Infinity;
  for (let v = 0; v < nv; v++) {
    const b = 9 * v;
    const fx = ca * vel[b] + sa * vel[b + 3];
    const fy = ca * vel[b + 1] + sa * vel[b + 4];
    const fz = ca * vel[b + 2] + sa * vel[b + 5];
    const ux = ca + (fx - ca + gnd * vel[b + 6]) * invb;
    const uy = sa + (fy - sa + gnd * vel[b + 7]) * invb;
    const uz = (fz + gnd * vel[b + 8]) * invb;
    const nx = nrm[3 * v], ny = nrm[3 * v + 1], nz = nrm[3 * v + 2];
    const un = ux * nx + uy * ny + uz * nz;
    const tx = ux - un * nx, ty = uy - un * ny, tz = uz - un * nz;
    let ut = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (ut > UT_MAX) ut = UT_MAX; // guard against near-source spikes
    const nU = nx * ca + ny * sa;                    // n . Uhat
    const phi = Math.acos(Math.max(-1, Math.min(1, -nU))) / DEG;
    const w = smooth01((phi - (phiS - 4)) / 8);      // separated weight, 8 deg blend
    let cpv = 1 - ut * ut;
    cpv += w * (cpb - cpv);
    if (sBlend > 0) {
      const cpn = nU < 0 ? C0 * nU * nU : cpVac;
      cpv += sBlend * (cpn - cpv);
    }
    if (cpv > C0) cpv = C0;
    cp[v] = cpv;
    if (cpv < cmin) cmin = cpv; if (cpv > cmax) cmax = cpv;
    // skin friction
    const ue = ut * U;
    const s = Math.max(sMin, proj[v] - pmin);
    let Res = rho * ue * s / mu; if (Res < 100) Res = 100;
    const cfl = 0.664 / Math.sqrt(Res);
    const cft = 0.0592 * Math.pow(Res, -0.2);
    let wt = bl === 'laminar' ? 0 : bl === 'turbulent' ? 1 : smooth01((Res - 3.5e5) / 3e5);
    const cf = cfl + wt * (cft - cfl);
    const tauAtt = 0.5 * rho * ue * ue * cf;
    tau[v] = (1 - w) * tauAtt + w * 0.03 * q;
  }

  // windward-face integrals
  const idx = geo.index ? geo.index.array : null;
  const nt = idx ? Math.floor(idx.length / 3) : Math.floor(nv / 3);
  let sumA = 0, sumP = 0, sumF = 0;
  for (let t = 0; t < nt; t++) {
    const i0 = idx ? idx[3 * t] : 3 * t, i1 = idx ? idx[3 * t + 1] : 3 * t + 1, i2 = idx ? idx[3 * t + 2] : 3 * t + 2;
    const ax = pos[3 * i1] - pos[3 * i0], ay = pos[3 * i1 + 1] - pos[3 * i0 + 1], az = pos[3 * i1 + 2] - pos[3 * i0 + 2];
    const bx = pos[3 * i2] - pos[3 * i0], by = pos[3 * i2 + 1] - pos[3 * i0 + 1], bz = pos[3 * i2 + 2] - pos[3 * i0 + 2];
    let cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (cl < 1e-18) continue;
    const area = 0.5 * cl;
    let sgn = 1;
    const vx = nrm[3 * i0] + nrm[3 * i1] + nrm[3 * i2], vy = nrm[3 * i0 + 1] + nrm[3 * i1 + 1] + nrm[3 * i2 + 1], vz = nrm[3 * i0 + 2] + nrm[3 * i1 + 2] + nrm[3 * i2 + 2];
    if (cx * vx + cy * vy + cz * vz < 0) sgn = -1;
    const nfU = sgn * (cx * ca + cy * sa) / cl;
    if (nfU >= 0) continue; // leeward
    const cpf = (cp[i0] + cp[i1] + cp[i2]) / 3;
    sumA += area; sumP += cpf * area; sumF += cpf * (-nfU) * area;
  }
  // stagPa: stagnation pressure above ambient, p0 - p_inf = q * Cp0 (always positive).
  // windwardN: pressure force (gauge) on the windward faces along the stream. windwardMeanPa: area mean of the
  // gauge pressure there; it can be negative (suction on the shoulders outweighs the stagnation region).
  // frontPa / frontN are the old names kept for the UI: frontPa now carries stagPa, frontN carries windwardN.
  out.stagPa = q * C0; out.windwardN = q * sumF; out.windwardMeanPa = sumA > 0 ? q * sumP / sumA : 0;
  out.frontPa = out.stagPa; out.frontN = out.windwardN;
  out.cpRange[0] = cmin; out.cpRange[1] = cmax;
  return out;
}
