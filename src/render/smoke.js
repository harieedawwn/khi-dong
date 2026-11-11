// P6 — smoke.js. rake 'plane': laser-sheet smoke layer on z = 0, the dye field of the mid-plane solver (flow.plane).
// rake 'grid': 3D streaklines drawn as camera-facing ribbons in ONE draw call (adaptive sub-steps, B-spline smoothing,
// stretched segments thin out instead of drawing straight 'lightning' chords).
// Units: metres, world frame (SPEC §3). All motion uses U_vis (slow motion); no per-frame allocations.
import * as THREE from 'three';
import { TUN } from '../flow/plane.js';

const NOZ_X = -2.6, X_END = 3.0, Y_WALL = 0.78, Z_WALL = 1.18;
const TIERS = { low: { L: 24, N: 110 }, high: { L: 48, N: 170 } };
const HEX = { white: '#EDEBE6', red: '#D23A2E', blue: '#2F6FD0', orange: '#E8862A' };
const MULTI = ['#C65A4B', '#4C7FC0', '#D99B4A', '#5BA27F', '#8E74B8', '#CDBB5A']; // 6 muted hues
const FADE_S = 0.25;            // cross-fade between flow views
const W0 = 0.007;               // nozzle ribbon width (m)
const DIFF = 0.004;             // slow diffusion growth (m/s)
const TURB = 0.05;              // extra growth where velocity deviates (m/s)
const W_MAX = 0.14;
const BOX_X = 1.15, BOX_Y = 0.95;   // only ask sdf near the model
const MARGIN = 0.004;           // keep points this far outside the body
const MIN_PX = 1.8;             // minimum ribbon width in device pixels (anti-aliasing / no shimmer)
const WARM_S = 1.4, WARM_K = 3; // after a reset, run time-lapse x3 for 1.4 s so the picture fills fast

const DVERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DFRAG = /* glsl */`
uniform sampler2D uDye;
uniform vec2 uSize;
uniform vec3 uTint;
uniform float uMulti, uOpacity, uGain;
varying vec2 vUv;
void main(){
  // smooth (quintic) reconstruction: crisp filaments without bilinear diamonds, no blur and no glow
  vec2 p = vUv * uSize - 0.5, i = floor(p), f = p - i;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec4 d = texture2D(uDye, (i + 0.5 + f) / uSize);
  float a = smoothstep(0.03, 0.62, d.a * uGain);
  a *= smoothstep(0.0, 0.02, vUv.x - 0.015) * (1.0 - smoothstep(0.93, 0.995, vUv.x));
  if (a < 0.004) discard;
  vec3 c = mix(uTint, d.rgb / max(d.a, 1e-4), uMulti);
  gl_FragColor = vec4(c * 0.94, a * uOpacity);
  #include <colorspace_fragment>
}`;

const VERT = /* glsl */`
attribute vec3 aInfo;   // x across (-1/+1), y alpha, z facing of the +side towards the key light
attribute vec3 aColor;
varying float vAcross, vAlpha, vLit;
varying vec3 vColor;
void main(){
  vAcross = aInfo.x; vAlpha = aInfo.y;
  vLit = 0.5 + 0.5 * aInfo.x * aInfo.z;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */`
uniform sampler2D uProfile;
uniform float uOpacity;
varying float vAcross, vAlpha, vLit;
varying vec3 vColor;
void main(){
  float prof = texture2D(uProfile, vec2(vAcross * 0.5 + 0.5, 0.5)).r;
  float a = prof * vAlpha * uOpacity;
  if (a < 0.004) discard;
  vec3 c = vColor * (0.68 + 0.32 * vLit);
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

function makeSampler(flow) {            // tolerant of out[0..2] or out.x/y/z conventions
  const out = [0, 0, 0]; out.x = out.y = out.z = NaN;
  let mode = -1;
  const s = { ux: 0, uy: 0, uz: 0, at(x, y, z) {
    if (mode < 0) {
      out[0] = out[1] = out[2] = NaN;
      const r = flow.sample(x, y, z, out);
      mode = Number.isFinite(out.x) ? 1 : (Number.isFinite(out[0]) ? 0 : 2);
      if (mode === 2 && r) { s.ux = r.x ?? r[0]; s.uy = r.y ?? r[1]; s.uz = r.z ?? r[2]; return; }
    }
    const r = flow.sample(x, y, z, out);
    if (mode === 1) { s.ux = out.x; s.uy = out.y; s.uz = out.z; }
    else if (mode === 0) { s.ux = out[0]; s.uy = out[1]; s.uz = out[2]; }
    else if (r) { s.ux = r.x ?? r[0]; s.uy = r.y ?? r[1]; s.uz = r.z ?? r[2]; }
  } };
  return s;
}

function profileTexture() {            // 1D alpha profile across the ribbon, soft edges
  const n = 64, d = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = Math.abs((i + 0.5) / n * 2 - 1);
    let t = Math.min(1, Math.max(0, (x - 0.22) / 0.78));
    const a = 1 - t * t * (3 - 2 * t);
    const v = Math.round(255 * Math.pow(a, 1.15));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(d, n, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false; tex.needsUpdate = true;
  return tex;
}

export function init(ctx) {
  const { state, flow } = ctx;
  const sc = ctx.scene;
  const sampler = makeSampler(flow);
  const col = new THREE.Color();
  const camPos = new THREE.Vector3();
  const profile = profileTexture();
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uProfile: { value: profile }, uOpacity: { value: 1 } },
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 5;
  (sc.root || sc.scene).add(mesh);

  const UV = new Float64Array(1); UV[0] = Math.min(4, 0.55 * Math.pow(state.get().U || 20, 0.45));
  state.on('results', (r) => { if (r && r.Uvis > 0) UV[0] = r.Uvis; });

  // ---- laser-sheet dye layer (rake 'plane') ----
  const plane = flow.plane || null;
  const dMat = new THREE.ShaderMaterial({
    vertexShader: DVERT, fragmentShader: DFRAG, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    uniforms: { uDye: { value: null }, uSize: { value: new THREE.Vector2(1, 1) }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uMulti: { value: 0 }, uOpacity: { value: 1 }, uGain: { value: 1 } },
  });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(TUN.x1 - TUN.x0, TUN.y1 - TUN.y0), dMat);
  sheet.position.set(0.5 * (TUN.x0 + TUN.x1), 0.5 * (TUN.y0 + TUN.y1), 0);
  sheet.frustumCulled = false; sheet.visible = false; sheet.renderOrder = 5;
  (sc.root || sc.scene).add(sheet);
  let cpuTex = null, cpuBytes = null;
  function dyeTexture() {
    const be = plane.backend(); if (!be) return null;
    const sz = be.dyeSize(); dMat.uniforms.uSize.value.set(sz[0], sz[1]);
    if (be.kind === 'gpu') return be.dyeTexture();
    const d = be.dyeData(), n = sz[0] * sz[1] * 4;
    if (!cpuTex || cpuBytes.length !== n) {
      if (cpuTex) cpuTex.dispose();
      cpuBytes = new Uint8Array(n); cpuTex = new THREE.DataTexture(cpuBytes, sz[0], sz[1], THREE.RGBAFormat, THREE.UnsignedByteType);
      cpuTex.minFilter = cpuTex.magFilter = THREE.LinearFilter; cpuTex.generateMipmaps = false;
    }
    for (let i = 0; i < n; i++) { const v = d[i] * 255; cpuBytes[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
    cpuTex.needsUpdate = true;
    return cpuTex;
  }
  function updateSheet(view, fade) {
    plane.setView({ lines: view.lines * (ctx.quality ? ctx.quality.scale : 1), density: view.density });
    const tex = dyeTexture();
    if (!tex) { sheet.visible = false; return; }
    const u = dMat.uniforms; u.uDye.value = tex;
    col.set(HEX[view.smokeColor] || HEX.white); u.uTint.value.set(col.r, col.g, col.b);
    u.uMulti.value = view.smokeColor === 'multi' ? 1 : 0;
    u.uOpacity.value = fade * (0.45 + 0.55 * view.density); u.uGain.value = 0.8 + 0.6 * view.density;
    sheet.visible = true;
  }

  // key light direction (world), default if the scene has none
  const Ldir = [0.35, 0.85, 0.4];
  function findLight() {
    let found = null;
    (sc.scene || sc.root).traverse((o) => { if (!found && o.isDirectionalLight) found = o; });
    if (found) {
      const t = found.target ? found.target.position : { x: 0, y: 0, z: 0 };
      const x = found.position.x - t.x, y = found.position.y - t.y, z = found.position.z - t.z;
      const l = Math.hypot(x, y, z) || 1; Ldir[0] = x / l; Ldir[1] = y / l; Ldir[2] = z / l;
    }
  }

  // ---- buffers (rebuilt only when the tier changes) ----
  let tierName = '', L = 0, N = 0;
  let P, W, F, head, cnt, prevN, nozY, nozZ, lineR, lineG, lineB;
  let posA, infoA, colA, posAttr, infoAttr, colAttr;
  let nL = 0, curRake = '', curColor = '';
  const Z = new Float64Array(3);       // scalars that change every frame live here: 0 fade, 1 emit accumulator, 2 warm-up time (no heap boxing)

  function alloc(t) {
    tierName = t === 'high' ? 'high' : 'low';
    ({ L, N } = TIERS[tierName]);
    P = new Float32Array(L * N * 3); W = new Float32Array(L * N); F = new Float32Array(L * N);
    head = new Int32Array(L); cnt = new Int32Array(L); prevN = new Int32Array(L);
    nozY = new Float32Array(L); nozZ = new Float32Array(L);
    lineR = new Float32Array(L); lineG = new Float32Array(L); lineB = new Float32Array(L);
    const V = L * N * 2;
    posA = new Float32Array(V * 3); infoA = new Float32Array(V * 3); colA = new Float32Array(V * 3);
    const idx = new Uint16Array(L * (N - 1) * 6);
    let q = 0;
    for (let l = 0; l < L; l++) for (let k = 0; k < N - 1; k++) {
      const a = (l * N + k) * 2;
      idx[q++] = a; idx[q++] = a + 1; idx[q++] = a + 2;
      idx[q++] = a + 1; idx[q++] = a + 3; idx[q++] = a + 2;
    }
    const g = new THREE.BufferGeometry();
    posAttr = new THREE.BufferAttribute(posA, 3); infoAttr = new THREE.BufferAttribute(infoA, 3); colAttr = new THREE.BufferAttribute(colA, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage); infoAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', posAttr); g.setAttribute('aInfo', infoAttr); g.setAttribute('aColor', colAttr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 12);
    const old = mesh.geometry; mesh.geometry = g; if (old) old.dispose();
    curRake = ''; curColor = ''; nL = 0;
  }

  function layout(view) {                 // nozzle positions on the rake (x = -2.6)
    if (view.rake === 'grid') {
      const r = Math.max(2, Math.round(Math.sqrt(nL / 2))), c = Math.ceil(nL / r);
      for (let l = 0; l < nL; l++) {
        const i = l % r, j = (l / r) | 0;
        const u = r > 1 ? (i + 0.5) / r * 2 - 1 : 0, v = c > 1 ? (j + 0.5) / c * 2 - 1 : 0;
        nozY[l] = 0.55 * Math.sign(u) * Math.pow(Math.abs(u), 1.25);
        nozZ[l] = 0.85 * v;
      }
    } else {
      for (let l = 0; l < nL; l++) {
        const u = (l + 0.5) / nL * 2 - 1;  // denser near y = 0
        nozY[l] = 0.55 * Math.sign(u) * Math.pow(Math.abs(u), 1.25);
        nozZ[l] = 0;
      }
    }
  }

  function setColors(view) {
    for (let l = 0; l < L; l++) {
      col.set(view.smokeColor === 'multi' ? MULTI[l % 6] : (HEX[view.smokeColor] || HEX.white));
      lineR[l] = col.r; lineG[l] = col.g; lineB[l] = col.b;
      const o = l * N * 6;
      for (let v = 0; v < N * 2; v++) { colA[o + v * 3] = col.r; colA[o + v * 3 + 1] = col.g; colA[o + v * 3 + 2] = col.b; }
    }
    colAttr.needsUpdate = true;
  }

  function reset() {
    cnt.fill(0); prevN.fill(0); head.fill(0); Z[1] = 0; Z[2] = WARM_S;
    infoA.fill(0); posA.fill(0); infoAttr.needsUpdate = true; posAttr.needsUpdate = true;
  }

  const gradEps = 0.005;
  function pushOut(x, y, z, sd, o, j) {   // move point out of the body along the sdf gradient
    const gx = flow.sdf(x + gradEps, y, z) - flow.sdf(x - gradEps, y, z);
    const gy = flow.sdf(x, y + gradEps, z) - flow.sdf(x, y - gradEps, z);
    const gz = flow.sdf(x, y, z + gradEps) - flow.sdf(x, y, z - gradEps);
    const g = Math.hypot(gx, gy, gz);
    if (g < 1e-9) { o[j + 1] += 0.01; return; }
    const d = (MARGIN - sd) / g;
    o[j] = x + gx * d; o[j + 1] = y + gy * d; o[j + 2] = z + gz * d;
  }

  function simulate(dt, view) {
    const sdt = dt * (Z[2] > 0 ? WARM_K : 1);
    Z[2] -= dt;
    const U = UV[0];
    let nsub = Math.ceil(sdt * U * 1.6 / 0.08); nsub = nsub < 1 ? 1 : nsub > 5 ? 5 : nsub;
    const h = sdt / nsub, invU = 1 / U;
    const kUp = Math.min(1, sdt * 6), kDown = Math.min(1, sdt * 0.8);
    const S = sampler;
    for (let l = 0; l < nL; l++) {
      const n = cnt[l]; if (!n) continue;
      const base = l * N, hd = head[l];
      for (let k = 0; k < n; k++) {
        let id = hd - k; if (id < 0) id += N;
        const pi = base + id, j = pi * 3;
        let x = P[j], y = P[j + 1], z = P[j + 2];
        // RK2 (midpoint) with adaptive sub-steps: halve the step while the velocity turns by more than ~20 % per step
        let left = sdt, hs = h, guard = 0;
        while (left > 1e-7 && guard++ < 24) {
          if (hs > left) hs = left;
          S.at(x, y, z);
          const ax = S.ux, ay = S.uy, az = S.uz;
          S.at(x + 0.5 * hs * ax, y + 0.5 * hs * ay, z + 0.5 * hs * az);
          const ex = S.ux - ax, ey = S.uy - ay, ez = S.uz - az;
          if (ex * ex + ey * ey + ez * ez > 0.04 * U * U && hs > sdt / 16) { hs *= 0.5; continue; }
          x += hs * S.ux; y += hs * S.uy; z += hs * S.uz; left -= hs; hs *= 1.5;
        }
        // fluctuation proxy: deviation of the local velocity from the free stream
        const dx = S.ux - U, dev = Math.sqrt(dx * dx + S.uy * S.uy + S.uz * S.uz) * invU;
        const tg = dev > 1 ? 1 : dev, f = F[pi];
        F[pi] = f + (tg - f) * (tg > f ? kUp : kDown);
        let w = W[pi] + sdt * (DIFF + TURB * F[pi]); W[pi] = w > W_MAX ? W_MAX : w;
        if (y > Y_WALL) y = Y_WALL; else if (y < -Y_WALL) y = -Y_WALL;
        if (z > Z_WALL) z = Z_WALL; else if (z < -Z_WALL) z = -Z_WALL;
        P[j] = x; P[j + 1] = y; P[j + 2] = z;
        if (x > -BOX_X && x < BOX_X && y > -BOX_Y && y < BOX_Y) {
          const sd = flow.sdf(x, y, z);
          if (sd < MARGIN) pushOut(x, y, z, sd, P, j);
        }
      }
      // drop what has left the test section (oldest first)
      let m = cnt[l];
      while (m > 0) {
        let id = hd - (m - 1); if (id < 0) id += N;
        if (P[(base + id) * 3] > X_END) m--; else break;
      }
      cnt[l] = m;
    }
    // emission (frame-rate independent): same interval for all nozzles
    const interval = (X_END - NOZ_X) / (N - 10) / U;
    Z[1] += sdt;
    let m = Math.floor(Z[1] / interval); if (m > 8) m = 8;
    const left = Z[1] - m * interval; if (m > 0) Z[1] = left > interval ? interval : left;
    for (let e = 1; e <= m; e++) {
      const age = left + (m - e) * interval;
      for (let l = 0; l < nL; l++) {
        let hd = head[l] + 1; if (hd >= N) hd = 0;
        head[l] = hd;
        if (cnt[l] < N) cnt[l]++;           // else the oldest slot is overwritten
        const pi = l * N + hd, j = pi * 3;
        P[j] = NOZ_X + U * age; P[j + 1] = nozY[l]; P[j + 2] = nozZ[l];
        W[pi] = W0; F[pi] = 0;
      }
    }
  }

  function buildRibbons(view) {
    const cam = sc.camera;
    cam.getWorldPosition(camPos);
    const cx = camPos.x, cy = camPos.y, cz = camPos.z;
    const H = (sc.renderer && sc.renderer.domElement && sc.renderer.domElement.height) || 800;
    const persp = !cam.isOrthographic;
    const pxK = persp ? 2 * Math.tan(cam.fov * Math.PI / 360) / H * MIN_PX : (cam.top - cam.bottom) / (cam.zoom || 1) / H * MIN_PX;
    const wScale = 0.7 + 0.6 * view.density;
    const lx = Ldir[0], ly = Ldir[1], lz = Ldir[2];
    const seg0 = 2.6 * (X_END - NOZ_X) / (N - 10);
    let sx = 0, sy = 0, sz = 1;
    for (let l = 0; l < nL; l++) {
      const n = cnt[l], base = l * N, hd = head[l];
      for (let k = 0; k < n; k++) {
        let id = hd - k; if (id < 0) id += N;
        const pi = base + id, j = pi * 3;
        let ia = k > 0 ? hd - (k - 1) : hd - k; if (ia < 0) ia += N;      // newer neighbour
        let ib = k < n - 1 ? hd - (k + 1) : hd - k; if (ib < 0) ib += N;  // older neighbour
        const ja = (base + ia) * 3, jb = (base + ib) * 3;
        // quadratic B-spline smoothing of the polyline (1/4, 1/2, 1/4): no corners, hence no zigzag
        const x = 0.25 * (P[ja] + P[jb]) + 0.5 * P[j], y = 0.25 * (P[ja + 1] + P[jb + 1]) + 0.5 * P[j + 1], z = 0.25 * (P[ja + 2] + P[jb + 2]) + 0.5 * P[j + 2];
        let tx = P[ja] - P[jb], ty = P[ja + 1] - P[jb + 1], tz = P[ja + 2] - P[jb + 2];
        const seg2 = tx * tx + ty * ty + tz * tz;
        if (seg2 < 1e-14) { tx = 1; ty = 0; tz = 0; }
        const vx = cx - x, vy = cy - y, vz = cz - z;
        let ux = ty * vz - tz * vy, uy = tz * vx - tx * vz, uz = tx * vy - ty * vx;
        const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        if (ul > 1e-9) { sx = ux / ul; sy = uy / ul; sz = uz / ul; }      // else keep the previous side
        const dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
        let w = W[pi] * wScale; const wm = (persp ? dist : 1) * pxK; if (w < wm) w = wm;
        const hw = w * 0.5;
        // alpha: soft nozzle start, fade near the outlet and at the tail of a full ring
        let a = k < 5 ? (k + 0.5) / 5 : 1;
        const xf = x > 2.2 ? (X_END - x) / 0.8 : 1; if (xf < a) a = xf < 0 ? 0 : xf;
        const rf = (N - 1 - k) / 12; if (rf < a) a = rf;
        // a stretched filament is thinner smoke: fade with the stretch (2 * emission spacing = unstretched)
        const st = seg0 / Math.sqrt(seg2 + 1e-12); if (st < 1) a *= st * st;
        const facing = sx * lx + sy * ly + sz * lz;
        const o = (base + k) * 6;
        posA[o] = x - sx * hw; posA[o + 1] = y - sy * hw; posA[o + 2] = z - sz * hw;
        posA[o + 3] = x + sx * hw; posA[o + 4] = y + sy * hw; posA[o + 5] = z + sz * hw;
        infoA[o] = -1; infoA[o + 1] = a; infoA[o + 2] = facing;
        infoA[o + 3] = 1; infoA[o + 4] = a; infoA[o + 5] = facing;
      }
      for (let k = n; k < prevN[l]; k++) {   // hide vertices that are no longer used
        const o = (base + k) * 6;
        infoA[o + 1] = 0; infoA[o + 4] = 0;
      }
      prevN[l] = n;
    }
    posAttr.needsUpdate = true; infoAttr.needsUpdate = true;
    mesh.geometry.setDrawRange(0, nL * (N - 1) * 6);
  }

  function update(dt) {
    dt = dt > 0.05 ? 0.05 : dt < 0 ? 0 : dt;
    const st = state.get(), view = st.view;
    if ((st.tier === 'high' ? 'high' : 'low') !== tierName) alloc(st.tier);
    const target = view.flow === 'smoke' ? 1 : 0, step = dt / FADE_S;
    const df = target - Z[0]; Z[0] += df > step ? step : df < -step ? -step : df;
    if (Z[0] <= 0.001) { if (mesh.visible) mesh.visible = false; if (sheet.visible) sheet.visible = false; return; }
    if (plane && view.rake !== 'grid') {             // laser sheet: the solver's dye field
      if (mesh.visible) { mesh.visible = false; nL = 0; }
      updateSheet(view, Z[0]);
      return;
    }
    if (sheet.visible) sheet.visible = false;
    let want = Math.round(view.lines * (ctx.quality ? ctx.quality.scale : 1)); want = want < 1 ? 1 : want > L ? L : want;
    if (!mesh.visible) { mesh.visible = true; findLight(); nL = 0; }
    if (want !== nL || view.rake !== curRake) { nL = want; curRake = view.rake; layout(view); reset(); }
    if (view.smokeColor !== curColor) { curColor = view.smokeColor; setColors(view); }
    material.uniforms.uOpacity.value = Z[0] * (0.35 + 0.6 * view.density);
    if (!(UV[0] > 0)) return;
    simulate(dt, view);
    buildRibbons(view);
  }

  alloc(state.get().tier);
  return {
    object: mesh, update, reset: () => { if (nL) reset(); },
    dispose() { mesh.parent && mesh.parent.remove(mesh); mesh.geometry.dispose(); material.dispose(); profile.dispose(); },
    // exposed for tests
    _debug: () => ({ P, cnt, head, N, L, nL }),
  };
}

export default { init };
