// src/geom/hull.js  Bộ dựng thân xe / tàu từ tiết diện spline, tấm phủ (kính, đèn), thanh, ống, tròn xoay, bánh xe có vành.
// Không import parts.js (tránh vòng): parts.js gọi createHullMakers({MB, zip, discRings, latheMesh, finish, ...}).
// Quy ước: khung mô hình (mũi về -x, y lên, z ngang). Mọi chi tiết "decal" (kính, đèn) không tính vào diện tích, thể tích, lực.
//
//  hull   : thân = các tiết diện (đa giác điều khiển nửa phải, đối xứng qua z = 0, làm trơn bằng B-spline bậc 3) nội suy dọc x.
//           sec(x) -> [[z, y, bội?], ...] từ tâm đáy (z = 0) tới tâm đỉnh (z = 0); số điểm không đổi theo x.
//           stations: các x dựng vòng (dùng stationList để dồn mật độ ở vòm bánh, hai đầu). SDF: khoảng cách có dấu tới đa giác hai vòng kề, nội suy.
//  panel  : mảnh phủ chiếu lên bề mặt một chi tiết khác (theo sdf) dọc trục dir; 4 góc + bo tròn; mirror cho kính hai bên.
//  strut  : thanh vuông thon (nan hoa, giá đỡ, chân càng).   tube : ống quét theo đường gấp khúc (càng trượt, halo, ống xả).
//  revolve: khối tròn xoay từ các hồ sơ kín.   wheel: lốp + vành + nan hoa + đĩa phanh.
const PI = Math.PI, TAU = PI * 2;

/* ---- B-spline kín bậc 3 trên đa giác nửa phải phản chiếu: vòng bắt đầu ở tâm đáy, đi qua phía +z, lên tâm đỉnh, về phía -z */
export function ringFromControl(half, spp) {
  const pts = [];
  for (const q of half) for (let k = 0; k < (q[2] || 1); k++) pts.push([q[0], q[1]]);
  const ring = pts.slice(); for (let i = pts.length - 2; i >= 1; i--) ring.push([-pts[i][0], pts[i][1]]);
  const M = ring.length, out = [];
  for (let i = 0; i < M; i++) {
    const P0 = ring[(i + M - 1) % M], P1 = ring[i], P2 = ring[(i + 1) % M], P3 = ring[(i + 2) % M];
    for (let s = 0; s < spp; s++) {
      const t = s / spp, t2 = t * t, t3 = t2 * t, b0 = (1 - t) ** 3 / 6, b1 = (3 * t3 - 6 * t2 + 4) / 6, b2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, b3 = t3 / 6;
      out.push([b0 * P0[0] + b1 * P1[0] + b2 * P2[0] + b3 * P3[0], b0 * P0[1] + b1 * P1[1] + b2 * P2[1] + b3 * P3[1]]);
    }
  }
  return out;
}

// các x dựng vòng: n điểm mật độ cosine từ x0 đến x1, thêm cụm [xc, r, m] (dồn ở xc ± r, dùng cho vòm bánh)
export function stationList(x0, x1, n, clusters = []) {
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(x0 + (x1 - x0) * (0.5 - 0.5 * Math.cos(PI * i / n)));
  for (const [xc, r, m] of clusters) { for (let i = 0; i <= m; i++) xs.push(xc + r * Math.sin(PI * (i / m - 0.5))); xs.push(xc - r - 0.0015, xc + r + 0.0015); }
  xs.sort((a, b) => a - b);
  const out = [xs[0]]; for (const x of xs) if (x - out[out.length - 1] > 0.0004 * (x1 - x0) && x < x1 - 1e-9) out.push(x); out.push(x1);
  return out;
}

function segD2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py; return qx * qx + qy * qy;
}
// khoảng cách có dấu (z, y) tới nửa đa giác (z >= 0); tính theo |z|
function polyDist(poly, z, y) {
  z = Math.abs(z); let best = 1e30, cross = 0; const n = poly.length / 2;
  for (let k = 0; k < n - 1; k++) {
    const ax = poly[2 * k], ay = poly[2 * k + 1], bx = poly[2 * k + 2], by = poly[2 * k + 3], d = segD2(z, y, ax, ay, bx, by); if (d < best) best = d;
    if ((ay > y) !== (by > y) && ax + ((y - ay) / (by - ay)) * (bx - ax) > z) cross ^= 1;
  }
  const d = Math.sqrt(best); return cross ? -d : d;
}
function hullSDF(xs, polys) {
  const N = xs.length, x0 = xs[0], x1 = xs[N - 1];
  return (x, y, z) => {
    if (x <= x0 || x >= x1) { const dx = x <= x0 ? x0 - x : x - x1, dc = polyDist(polys[x <= x0 ? 0 : N - 1], z, y); return dc <= 0 ? dx : Math.hypot(dx, dc); }
    let lo = 0, hi = N - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    const f = (x - xs[lo]) / (xs[hi] - xs[lo]), da = polyDist(polys[lo], z, y), db = polyDist(polys[hi], z, y), g = (db - da) / (xs[hi] - xs[lo]);
    return (da + (db - da) * f) / Math.sqrt(1 + g * g);
  };
}

export function createHullMakers(H) {
  const { MB, zip, discRings, latheMesh, finish, EK } = H;
  const M = {};
  const bbox = g => { const P = g.attributes.position.array, b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { if (P[i + a] < b[a]) b[a] = P[i + a]; if (P[i + a] > b[a + 3]) b[a + 3] = P[i + a]; } return b; };

  /* ---------------------------------------------------------------- hull */
  M.hull = p => {
    const xs = p.stations, N = xs.length, spp = p.spp ?? 3, edge = p.edge ?? EK * (p.ref ?? 1);
    const rings = xs.map(x => ringFromControl(p.sec(x), spp)), K = rings[0].length, mb = new MB(); mb.tone = p.tone ?? 0;
    const idx = rings.map((r, i) => r.map(q => mb.v(xs[i], q[1], q[0], 0, 0, 0)));
    const P = mb.P, I = mb.I, d3 = (a, b) => Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < K; j++) {
      const a = idx[i][j], b = idx[i][(j + 1) % K], c = idx[i + 1][j], d = idx[i + 1][(j + 1) % K];
      if (d3(a, d) < d3(b, c)) { mb.tri(a, d, b); mb.tri(a, c, d); } else { mb.tri(a, c, b); mb.tri(b, c, d); }
    }
    const Nn = mb.N; // normales trung bình theo diện tích
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { Nn[q] += gx; Nn[q + 1] += gy; Nn[q + 2] += gz; }
    }
    for (let i = 0; i < Nn.length; i += 3) { const l = Math.hypot(Nn[i], Nn[i + 1], Nn[i + 2]) || 1; Nn[i] /= l; Nn[i + 1] /= l; Nn[i + 2] /= l; }
    for (const [i, nx, on] of [[0, -1, p.capStart !== false], [N - 1, 1, p.capEnd !== false]]) {
      if (!on) continue;
      const pts = rings[i].map(q => [xs[i], q[1], q[0]]);
      let y0 = 1e9, y1 = -1e9, z1 = 0; for (const q of pts) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); z1 = Math.max(z1, Math.abs(q[2])); }
      const m = Math.max(2, Math.ceil(Math.max(z1, (y1 - y0) / 2) / (0.7 * edge)));
      discRings(mb, pts, [xs[i], (y0 + y1) / 2, 0], nx, 0, 0, m, true);
    }
    const polys = rings.map(r => { const h = new Float64Array(K + 2); for (let j = 0; j <= K / 2; j++) { h[2 * j] = Math.abs(r[j][0]); h[2 * j + 1] = r[j][1]; } return h; });
    const part = finish('hull', p.role ?? 'body', mb, hullSDF(xs, polys), p);
    part.stations = xs; return part;
  };

  /* ---------------------------------------------------------------- panel (kính, đèn, lưới tản nhiệt) */
  M.panel = p => {
    const on = p.on, dir = p.dir, k = dir.findIndex(v => v !== 0), sg = Math.sign(dir[k]), ax = [0, 1, 2].filter(a => a !== k);
    const bb = bbox(on.geometry), edge = p.edge ?? EK * (p.ref ?? 1), off = p.off ?? 0.0007, nr = p.round ?? 5, C = p.corners;
    const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const ns = p.res ? p.res[0] : Math.max(3, Math.ceil(Math.max(len(C[0], C[1]), len(C[3], C[2])) / edge)), nt = p.res ? p.res[1] : Math.max(3, Math.ceil(Math.max(len(C[0], C[3]), len(C[1], C[2])) / edge));
    const start = sg < 0 ? bb[k + 3] + 0.01 : bb[k] - 0.01, travel = bb[k + 3] - bb[k] + 0.02, STEPS = 48, mb = new MB(); mb.tone = p.tone ?? 3;
    const q = [0, 0, 0], at = t => { q[k] = start + sg * t; return on.sdf(q[0], q[1], q[2]); };
    const proj = (a, b) => {
      q[ax[0]] = a; q[ax[1]] = b; let t0 = 0, t1 = -1;
      for (let s = 1; s <= STEPS; s++) { const t = (travel * s) / STEPS; if (at(t) < 0) { t1 = t; break; } t0 = t; }
      if (t1 < 0) return null;
      for (let it = 0; it < 26; it++) { const m = (t0 + t1) / 2; if (at(m) < 0) t1 = m; else t0 = m; }
      const o = [0, 0, 0]; o[ax[0]] = a; o[ax[1]] = b; o[k] = start + sg * ((t0 + t1) / 2); return o;
    };
    const grid = [];
    for (let i = 0; i <= ns; i++) { grid[i] = []; for (let j = 0; j <= nt; j++) {
      let sg1 = (2 * i) / ns - 1, tg1 = (2 * j) / nt - 1; const rinf = Math.max(Math.abs(sg1), Math.abs(tg1)), rn = Math.pow(Math.pow(Math.abs(sg1), nr) + Math.pow(Math.abs(tg1), nr), 1 / nr), kk = rn > 0 ? rinf / rn : 1;
      sg1 *= kk; tg1 *= kk; const s = (sg1 + 1) / 2, t = (tg1 + 1) / 2;
      const a = (1 - s) * (1 - t) * C[0][0] + s * (1 - t) * C[1][0] + s * t * C[2][0] + (1 - s) * t * C[3][0], b = (1 - s) * (1 - t) * C[0][1] + s * (1 - t) * C[1][1] + s * t * C[2][1] + (1 - s) * t * C[3][1];
      grid[i][j] = proj(a, b);
    } }
    const addMesh = flip => {
      const i0 = mb.mark(), ids = [];
      for (let i = 0; i <= ns; i++) { ids[i] = []; for (let j = 0; j <= nt; j++) {
        const g = grid[i][j]; if (!g) { ids[i][j] = -1; continue; }
        const A = grid[Math.min(ns, i + 1)][j] || g, B = grid[Math.max(0, i - 1)][j] || g, Cc = grid[i][Math.min(nt, j + 1)] || g, D = grid[i][Math.max(0, j - 1)] || g;
        const tx = A[0] - B[0], ty = A[1] - B[1], tz = A[2] - B[2], ux = Cc[0] - D[0], uy = Cc[1] - D[1], uz = Cc[2] - D[2];
        let nx = ty * uz - tz * uy, ny = tz * ux - tx * uz, nz = tx * uy - ty * ux; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        if (nx * dir[0] + ny * dir[1] + nz * dir[2] > 0) { nx = -nx; ny = -ny; nz = -nz; }
        const px = g[0] + nx * off, py = g[1] + ny * off, pz = g[2] + nz * off;
        ids[i][j] = flip ? mb.v(px, py, -pz, nx, ny, -nz) : mb.v(px, py, pz, nx, ny, nz);
      } }
      for (let i = 0; i < ns; i++) for (let j = 0; j < nt; j++) {
        const a = ids[i][j], b = ids[i + 1][j], c = ids[i + 1][j + 1], d = ids[i][j + 1]; if (a < 0 || b < 0 || c < 0 || d < 0) continue; mb.tri(a, b, c); mb.tri(a, c, d);
      }
      mb.fix(i0);
    };
    addMesh(false); if (p.mirror) addMesh(true);
    return finish('panel', 'detail', mb, () => 1e3, { ...p, flow: false, decal: true });
  };

  /* ---------------------------------------------------------------- strut: thanh vuông thon a -> b */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  function strutInto(mb, a, b, wa, wb, upHint, edge = 1e9) {
    const e = norm(sub(b, a)); let s = cross(e, upHint); if (Math.hypot(...s) < 1e-6) s = cross(e, [1, 0, 0]); s = norm(s); const u = norm(cross(s, e));
    const corner = (c, w, i) => [c[0] + s[0] * w[0] * (i & 1 ? 0.5 : -0.5) + u[0] * w[1] * (i & 2 ? 0.5 : -0.5), c[1] + s[1] * w[0] * (i & 1 ? 0.5 : -0.5) + u[1] * w[1] * (i & 2 ? 0.5 : -0.5), c[2] + s[2] * w[0] * (i & 1 ? 0.5 : -0.5) + u[2] * w[1] * (i & 2 ? 0.5 : -0.5)];
    const A = [0, 1, 2, 3].map(i => corner(a, wa, i)), B = [0, 1, 2, 3].map(i => corner(b, wb, i));
    const face = (q0, q1, q2, q3) => { const i0 = mb.mark(), n = norm(cross(sub(q1, q0), sub(q3, q0))); const v = [q0, q1, q2, q3].map(q => mb.v(q[0], q[1], q[2], n[0], n[1], n[2])); mb.tri(v[0], v[1], v[2]); mb.tri(v[0], v[2], v[3]); const cx = (q0[0] + q2[0]) / 2, cy = (q0[1] + q2[1]) / 2, cz = (q0[2] + q2[2]) / 2, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; if ((cx - m[0]) * n[0] + (cy - m[1]) * n[1] + (cz - m[2]) * n[2] < 0) for (let i = 0; i < v.length; i++) { mb.N[3 * v[i]] *= -1; mb.N[3 * v[i] + 1] *= -1; mb.N[3 * v[i] + 2] *= -1; } mb.fix(i0); };
    const nL = Math.max(1, Math.ceil(Math.hypot(...sub(b, a)) / edge)), mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    face(A[0], A[1], A[3], A[2]); face(B[0], B[1], B[3], B[2]);
    for (let k = 0; k < nL; k++) for (const [i, j] of [[0, 1], [2, 3], [0, 2], [1, 3]]) { const t0 = k / nL, t1 = (k + 1) / nL; face(mix(A[i], B[i], t0), mix(A[j], B[j], t0), mix(A[j], B[j], t1), mix(A[i], B[i], t1)); }
  }
  M.strut = p => {
    const mb = new MB(); mb.tone = p.tone ?? 2; strutInto(mb, p.a, p.b, p.wa, p.wb ?? p.wa, p.up ?? [0, 1, 0], p.edge ?? EK * (p.ref ?? 1));
    const a = p.a, b = p.b, h = Math.max(...p.wa, ...(p.wb ?? p.wa)) / 2, ab = sub(b, a), l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const sdf = (x, y, z) => { const t = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / l2)); return Math.hypot(x - a[0] - t * ab[0], y - a[1] - t * ab[1], z - a[2] - t * ab[2]) - 0.7 * h; };
    return finish('strut', p.role ?? 'detail', mb, sdf, p);
  };

  /* ---------------------------------------------------------------- tube: ống tròn quét theo đường gấp khúc (Catmull-Rom) */
  M.tube = p => {
    const ctrl = p.path, edge = p.edge ?? EK * (p.ref ?? 1), rfun = typeof p.radius === 'function' ? p.radius : Array.isArray(p.radius) ? (t => p.radius[0] + (p.radius[1] - p.radius[0]) * t) : (() => p.radius ?? 0.005);
    const pts = [], cr = (a, b, c, d, t) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)], n = Math.max(2, Math.ceil(Math.hypot(...sub(p2, p1)) / (1.2 * edge)));
      for (let s = 0; s < n; s++) { const t = s / n; pts.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t), cr(p0[2], p1[2], p2[2], p3[2], t)]); }
    }
    pts.push(ctrl[ctrl.length - 1].slice());
    const n = pts.length, ks = p.sides ?? 14, mb = new MB(); mb.tone = p.tone ?? 2;
    let tan = norm(sub(pts[1], pts[0])), nrm = norm(cross(tan, Math.abs(tan[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); const rings = [], rr = [];
    for (let i = 0; i < n; i++) {
      const t0 = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])); const dot = nrm[0] * t0[0] + nrm[1] * t0[1] + nrm[2] * t0[2];
      nrm = norm([nrm[0] - dot * t0[0], nrm[1] - dot * t0[1], nrm[2] - dot * t0[2]]); const bn = cross(t0, nrm), r = rfun(i / (n - 1)); rr.push(r); const ring = [];
      for (let j = 0; j < ks; j++) { const th = (j / ks) * TAU, c = Math.cos(th), s = Math.sin(th); ring.push(mb.v(pts[i][0] + r * (c * nrm[0] + s * bn[0]), pts[i][1] + r * (c * nrm[1] + s * bn[1]), pts[i][2] + r * (c * nrm[2] + s * bn[2]), c * nrm[0] + s * bn[0], c * nrm[1] + s * bn[1], c * nrm[2] + s * bn[2])); }
      rings.push(ring);
    }
    let i0 = mb.mark(); for (let i = 0; i < n - 1; i++) zip(mb, rings[i], rings[i + 1]); mb.fix(i0);
    for (const [i, sgn] of [[0, -1], [n - 1, 1]]) {
      const t0 = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])), nx = t0[0] * sgn, ny = t0[1] * sgn, nz = t0[2] * sgn;
      const ring = rings[i].map(v => mb.v(mb.P[3 * v], mb.P[3 * v + 1], mb.P[3 * v + 2], nx, ny, nz)), c = mb.v(pts[i][0], pts[i][1], pts[i][2], nx, ny, nz), j0 = mb.mark(); zip(mb, ring, [c]); mb.fix(j0);
    }
    const sdf = (x, y, z) => { let best = 1e9; for (let i = 0; i < n - 1; i++) { const a = pts[i], b = pts[i + 1], ab = sub(b, a), l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-12, t = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / l2)); const d = Math.hypot(x - a[0] - t * ab[0], y - a[1] - t * ab[1], z - a[2] - t * ab[2]) - (rr[i] + (rr[i + 1] - rr[i]) * t); if (d < best) best = d; } return best; };
    return finish('tube', p.role ?? 'detail', mb, sdf, p);
  };

  /* ---------------------------------------------------------------- revolve: các hồ sơ kín (rho, dọc trục) quay quanh trục */
  const orient = pts => { let A = 0; for (let i = 0; i < pts.length; i++) { const q = pts[i], r = pts[(i + 1) % pts.length]; A += q[0] * r[1] - r[0] * q[1]; } return A > 0 ? 1 : -1; };
  M.revolve = p => {
    const c = p.center ?? [0, 0, 0], axis = p.axis ?? [1, 0, 0], edge = p.edge ?? EK * (p.ref ?? 1), mb = new MB();
    const chains = p.chains.map(ch => { const pts = ch.pts.concat([ch.pts[0]]); return { pts, tone: ch.tone ?? 0, sgn: orient(ch.pts) }; });
    latheMesh(mb, { origin: c, axis, chains, edge });
    // SDF: bao ngoài lớn nhất theo mọi hồ sơ (khối tròn xoay đặc xấp xỉ)
    const al = Math.hypot(...axis), a = axis.map(v => v / al), env = p.chains.flatMap(ch => ch.pts);
    let lo = 1e9, hi = -1e9, rmax = 0; for (const q of env) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); rmax = Math.max(rmax, q[0]); }
    const prof = p.silhouette ?? [[0, lo], [rmax, lo], [rmax, hi], [0, hi]];
    const poly = new Float64Array(prof.length * 2); prof.forEach((q, i) => { poly[2 * i] = q[0]; poly[2 * i + 1] = q[1]; });
    const sdf = (x, y, z) => { const rx = x - c[0], ry = y - c[1], rz = z - c[2], h = rx * a[0] + ry * a[1] + rz * a[2], rho = Math.hypot(rx - h * a[0], ry - h * a[1], rz - h * a[2]); return polyDist(poly, rho, h); };
    return finish('revolve', p.role ?? 'detail', mb, sdf, p, { spin: p.spin });
  };

  /* ---------------------------------------------------------------- wheel: lốp + vành + nan hoa + đĩa phanh (trục z) */
  M.wheel = p => {
    const R = p.radius ?? 0.07, W = p.width ?? 0.05, w = W / 2, c = p.center ?? [0, 0, 0], edge = p.edge ?? EK * (p.ref ?? 1.0);
    const rim = (p.rimRatio ?? 0.66) * R, ns = p.spokes ?? 5, tone = p.rimTone ?? 6;
    const half = [[rim * 0.97, 0.90 * w], [rim + 0.30 * (R - rim), 1.0 * w], [rim + 0.72 * (R - rim), 0.96 * w], [R - 0.045 * R, 0.80 * w], [R - 0.012 * R, 0.66 * w], [R, 0.56 * w], [R, 0.30 * w], [R - 0.010 * R, 0.26 * w], [R - 0.010 * R, 0.17 * w], [R, 0.13 * w], [R, 0]];
    const tyre = [[rim * 0.93, -0.88 * w], ...half.slice().reverse().slice(1).map(q => [q[0], -q[1]]), ...half.slice(0, -1), [rim * 0.93, 0.88 * w]];
    const lip = [[0.78 * rim, 0.70 * w], [0.92 * rim, 0.80 * w], [1.0 * rim, 0.86 * w], [1.0 * rim, -0.86 * w], [0.92 * rim, -0.80 * w], [0.78 * rim, -0.70 * w]];
    const hub = [[0, 0.64 * w], [0.12 * rim, 0.70 * w], [0.24 * rim, 0.62 * w], [0.26 * rim, 0.50 * w], [0.26 * rim, -0.50 * w], [0.24 * rim, -0.62 * w], [0.12 * rim, -0.70 * w], [0, -0.64 * w]];
    const disc = [[0.18 * rim, 0.34 * w], [0.80 * rim, 0.34 * w], [0.80 * rim, -0.34 * w], [0.18 * rim, -0.34 * w]];
    const mb = new MB();
    const ch = [{ pts: tyre.map(q => [q[0], q[1]]), tone: 2 }, { pts: lip, tone }, { pts: hub, tone }, { pts: disc, tone: p.discTone ?? 2 }].map(o => ({ pts: o.pts.concat([o.pts[0]]), tone: o.tone, sgn: orient(o.pts) }));
    latheMesh(mb, { origin: c, axis: [0, 0, 1], chains: ch, edge });
    for (let k = 0; k < ns; k++) for (const sz of [1, -1]) {
      const th = (k / ns) * TAU, ca = Math.cos(th), sa = Math.sin(th), z = c[2] + sz * 0.52 * w;
      mb.tone = tone; strutInto(mb, [c[0] + ca * 0.22 * rim, c[1] + sa * 0.22 * rim, z], [c[0] + ca * 0.90 * rim, c[1] + sa * 0.90 * rim, z], [Math.min(0.16 * rim, 0.8 * edge), 0.16 * w], [Math.min(0.26 * rim, 0.95 * edge), 0.16 * w], [-sa, ca, 0], edge);
    }
    const cr = Math.min(0.28 * R, 0.5 * w), sdf = (x, y, z) => { const rho = Math.hypot(x - c[0], y - c[1]), az = Math.abs(z - c[2]), qx = rho - (R - cr), qy = az - (w - cr), dr = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - cr;
      return Math.max(dr, -Math.max(rho - 0.8 * rim, 0.18 * rim - rho, 0.34 * w - az)); }; // vòng lốp + vành; khoang giữa (đĩa phanh) rỗng như ảnh
    return finish('wheel', p.role ?? 'wheel', mb, sdf, p, { spin: p.spin });
  };
  return M;
}
