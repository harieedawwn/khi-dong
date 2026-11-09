// P6 — vectors.js: InstancedMesh arrows on a lattice (z = 0 plane, plus y = 0 plane on tier high)
// and the shock surface (cone / bow) with a crisp outline. No per-frame allocations.
import * as THREE from 'three';

const FADE_S = 0.25;
const LAT = {
  low:  { nx: 16, ny: 8,  nz: 0,  rs: 0.0036, rh: 0.011,  headMax: 0.05 },
  high: { nx: 24, ny: 12, nz: 12, rs: 0.0028, rh: 0.0085, headMax: 0.04 },
};
const LX0 = -2.7, LX1 = 2.7, LY = 0.7, LZ = 1.0;
const SEG = 8;
const STOPS = ['#24364F', '#2F7F8C', '#8CC084', '#F4E3A1'];
const KEY = [0.35, 0.85, 0.4];

const AVERT = /* glsl */`
attribute float aPart;
attribute vec2 aInst;          // x = arrow length (m), y = |u|/U
uniform float uRs, uRh, uHeadMax;
uniform vec3 uC0, uC1, uC2, uC3, uLight;
varying vec3 vCol;
vec3 ramp(float t){
  float f = clamp(t / 1.6, 0.0, 1.0) * 3.0;
  if (f < 1.0) return mix(uC0, uC1, f);
  if (f < 2.0) return mix(uC1, uC2, f - 1.0);
  return mix(uC2, uC3, f - 2.0);
}
void main(){
  float len = aInst.x;
  float hl = min(uHeadMax, 0.4 * len), sl = len - hl;
  float x, r;
  if (aPart < 0.5)      { x = position.x * sl; r = uRs; }
  else if (aPart < 1.5) { x = sl;  r = uRh; }
  else if (aPart < 2.5) { x = len; r = 0.0; }
  else if (aPart < 3.5) { x = sl;  r = uRs; }
  else if (aPart < 4.5) { x = sl;  r = uRh; }
  else if (aPart < 5.5) { x = 0.0; r = 0.0; }
  else                  { x = 0.0; r = uRs; }
  vec3 p = vec3(x, position.y * r, position.z * r);
  vec3 n = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * normal));
  float lit = 0.58 + 0.42 * max(dot(n, normalize(uLight)), 0.0);
  vCol = ramp(aInst.y) * lit;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
}`;
const AFRAG = /* glsl */`
uniform float uOpacity;
varying vec3 vCol;
void main(){
  gl_FragColor = vec4(vCol, uOpacity);
  #include <colorspace_fragment>
}`;

const SVERT = /* glsl */`
uniform float uType;      // 0 cone, 1 bow
uniform vec3 uApex;
uniform float uTan, uXc, uA, uB, uXEnd, uRMax;
vec3 shockPos(float s, float phi){
  float x, r;
  if (uType < 0.5) { x = uApex.x + s * (uXEnd - uApex.x); r = min((x - uApex.x) * uTan, uRMax); }
  else             { r = s * uRMax; x = uXc + uA * sqrt(1.0 + r * r / (uB * uB)); }
  float y = clamp(uApex.y + r * cos(phi), -0.8, 0.8);
  float z = clamp(uApex.z + r * sin(phi), -1.2, 1.2);
  return vec3(x, y, z);
}
void main(){
  vec3 p = shockPos(position.x, position.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const SFRAG = /* glsl */`
uniform vec3 uColor; uniform float uOpacity;
void main(){
  gl_FragColor = vec4(uColor, uOpacity);
  #include <colorspace_fragment>
}`;

function makeSampler(flow) {
  const out = [0, 0, 0]; out.x = out.y = out.z = NaN;
  let mode = -1;
  const s = { ux: 0, uy: 0, uz: 0, at(x, y, z) {
    if (mode < 0) { out[0] = out[1] = out[2] = NaN; flow.sample(x, y, z, out); mode = Number.isFinite(out.x) ? 1 : 0; }
    flow.sample(x, y, z, out);
    if (mode === 1) { s.ux = out.x; s.uy = out.y; s.uz = out.z; } else { s.ux = out[0]; s.uy = out[1]; s.uz = out[2]; }
  } };
  return s;
}

function arrowGeometry() {              // pos = (t, cosφ, sinφ), real size is built in the vertex shader
  const pos = [], nor = [], part = [], idx = [];
  const ring = (px, p, nx, nyScale) => {
    const base = pos.length / 3;
    for (let i = 0; i < SEG; i++) {
      const a = i / SEG * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(px, c, s); part.push(p);
      const l = Math.hypot(nx, nyScale);
      nor.push(nx / l, c * nyScale / l, s * nyScale / l);
    }
    return base;
  };
  const quads = (a, b) => { for (let i = 0; i < SEG; i++) { const j = (i + 1) % SEG; idx.push(a + i, b + i, b + j, a + i, b + j, a + j); } };
  const sh0 = ring(0, 0, 0, 1), sh1 = ring(1, 0, 0, 1); quads(sh0, sh1);           // shaft
  const cb = ring(0, 1, 0.45, 1), ct = ring(1, 2, 0.45, 1); quads(cb, ct);          // cone
  const ai = ring(0, 3, -1, 0), ao = ring(0, 4, -1, 0); quads(ai, ao);              // cone base annulus
  const cc = pos.length / 3; pos.push(0, 0, 0); nor.push(-1, 0, 0); part.push(5);   // back cap
  const cr = ring(0, 6, -1, 0);
  for (let i = 0; i < SEG; i++) idx.push(cc, cr + (i + 1) % SEG, cr + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(part), 1));
  g.setIndex(idx);
  return g;
}

function shockGeometries() {            // (s, phi, 0) grid, positions are computed in the shader
  const S = 40, P = 72, pos = [], idx = [];
  for (let i = 0; i <= S; i++) for (let j = 0; j <= P; j++) pos.push(i / S, j / P * Math.PI * 2, 0);
  for (let i = 0; i < S; i++) for (let j = 0; j < P; j++) {
    const a = i * (P + 1) + j, b = a + P + 1; idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const surf = new THREE.BufferGeometry();
  surf.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); surf.setIndex(idx);
  const lp = [];                        // outline: end ring + four meridians
  for (let j = 0; j < P; j++) lp.push(1, j / P * Math.PI * 2, 0, 1, (j + 1) / P * Math.PI * 2, 0);
  for (let m = 0; m < 4; m++) for (let i = 0; i < S; i++) lp.push(i / S, m * Math.PI / 2, 0, (i + 1) / S, m * Math.PI / 2, 0);
  const line = new THREE.BufferGeometry();
  line.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lp), 3));
  return { surf, line };
}

export function init(ctx) {
  const { state, flow } = ctx, sc = ctx.scene;
  const sampler = makeSampler(flow);
  const root = sc.root || sc.scene;
  const cs = STOPS.map((h) => new THREE.Color(h));
  const v3 = (c) => new THREE.Vector3(c.r, c.g, c.b);

  // ---------- arrows ----------
  const aMat = new THREE.ShaderMaterial({
    vertexShader: AVERT, fragmentShader: AFRAG, transparent: true, depthWrite: true, depthTest: true, side: THREE.DoubleSide,
    uniforms: {
      uRs: { value: 0.003 }, uRh: { value: 0.009 }, uHeadMax: { value: 0.04 }, uOpacity: { value: 1 },
      uC0: { value: v3(cs[0]) }, uC1: { value: v3(cs[1]) }, uC2: { value: v3(cs[2]) }, uC3: { value: v3(cs[3]) },
      uLight: { value: new THREE.Vector3(KEY[0], KEY[1], KEY[2]) },
    },
  });
  const aGeo = arrowGeometry();
  let tierName = '', cfg = null, arrows = null, inst = null, instAttr = null, lat = null, lunit = 0.1, nZ = 0, nCount = 0;

  function buildLattice(t) {
    tierName = t === 'high' ? 'high' : 'low'; cfg = LAT[tierName];
    const n = cfg.nx * cfg.ny + cfg.nx * cfg.nz;
    if (arrows) { root.remove(arrows); arrows.dispose(); arrows.geometry.dispose(); }
    arrows = new THREE.InstancedMesh(aGeo, aMat, n);
    arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    arrows.frustumCulled = false; arrows.visible = false; arrows.renderOrder = 3;
    inst = new Float32Array(n * 2);
    instAttr = new THREE.InstancedBufferAttribute(inst, 2); instAttr.setUsage(THREE.DynamicDrawUsage);
    // the arrow geometry is shared, so the per-instance attribute is attached to a private clone of the geometry
    const g = aGeo.clone(); g.setAttribute('aInst', instAttr); arrows.geometry = g;
    lat = new Float32Array(n * 3);
    let q = 0;
    for (let j = 0; j < cfg.ny; j++) for (let i = 0; i < cfg.nx; i++) {
      lat[q++] = LX0 + (i + 0.5) * (LX1 - LX0) / cfg.nx; lat[q++] = -LY + (j + 0.5) * 2 * LY / cfg.ny; lat[q++] = 0;
    }
    for (let k = 0; k < cfg.nz; k++) for (let i = 0; i < cfg.nx; i++) {
      lat[q++] = LX0 + (i + 0.5) * (LX1 - LX0) / cfg.nx; lat[q++] = 0; lat[q++] = -LZ + (k + 0.5) * 2 * LZ / cfg.nz;
    }
    nCount = n; lunit = 0.62 * (LX1 - LX0) / cfg.nx;
    const u = aMat.uniforms; u.uRs.value = cfg.rs; u.uRh.value = cfg.rh; u.uHeadMax.value = cfg.headMax;
    root.add(arrows);
  }

  // ---------- shock ----------
  const sg = shockGeometries();
  const sU = {
    uType: { value: 0 }, uApex: { value: new THREE.Vector3() }, uTan: { value: 0.5 }, uXc: { value: 0 },
    uA: { value: 1 }, uB: { value: 1 }, uXEnd: { value: 3 }, uRMax: { value: 1.6 },
  };
  const sSurfMat = new THREE.ShaderMaterial({
    vertexShader: SVERT, fragmentShader: SFRAG, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    uniforms: Object.assign({ uColor: { value: v3(new THREE.Color('#A9C7DC')) }, uOpacity: { value: 0.12 } }, sU),
  });
  const sLineMat = new THREE.ShaderMaterial({
    vertexShader: SVERT, fragmentShader: SFRAG, transparent: true, depthWrite: false, depthTest: true,
    uniforms: Object.assign({ uColor: { value: v3(new THREE.Color('#DCE8EF')) }, uOpacity: { value: 0.7 } }, sU),
  });
  const shockSurf = new THREE.Mesh(sg.surf, sSurfMat), shockLine = new THREE.LineSegments(sg.line, sLineMat);
  for (const o of [shockSurf, shockLine]) { o.frustumCulled = false; o.visible = false; root.add(o); }
  shockSurf.renderOrder = 6; shockLine.renderOrder = 7;
  const UV = new Float64Array(1); UV[0] = Math.min(4, 0.55 * Math.pow(state.get().U || 20, 0.45));
  const Z = new Float64Array(3);       // 0 M, 1 vFade, 2 sFade (no heap boxing per frame)
  state.on('results', (r) => { if (r) { if (r.Uvis > 0) UV[0] = r.Uvis; if (r.aero && r.aero.M != null) Z[0] = r.aero.M; } });

  function setShock(sk) {               // halfAngle in radians (degrees are accepted if > pi/2)
    let mu = sk.halfAngle; if (mu > 1.5708) mu *= Math.PI / 180;
    mu = Math.min(Math.max(mu, 0.02), 1.5);
    const tn = Math.tan(mu);
    sU.uType.value = sk.type === 'bow' ? 1 : 0;
    sU.uApex.value.set(sk.apex[0], sk.apex[1], sk.apex[2]);
    sU.uTan.value = tn;
    if (sk.type === 'bow') {
      const Rc = sk.R > 0 ? sk.R : Math.max(0.3, (sk.standoff || 0.05) * 6);
      const a = Rc / (tn * tn), b = Rc / tn, xs = sk.apex[0] - (sk.standoff || 0), xc = xs - a;
      sU.uA.value = a; sU.uB.value = b; sU.uXc.value = xc;
      const q = (3 - xc) / a; sU.uRMax.value = Math.min(1.6, q > 1 ? b * Math.sqrt(q * q - 1) : 0.05);
    } else sU.uRMax.value = 1.6;
  }

  function update(dt) {
    dt = dt > 0.05 ? 0.05 : dt < 0 ? 0 : dt;
    const st = state.get(), view = st.view, step = dt / FADE_S;
    if ((st.tier === 'high' ? 'high' : 'low') !== tierName) buildLattice(st.tier);

    // arrows
    let df = (view.flow === 'vectors' ? 1 : 0) - Z[1]; Z[1] += df > step ? step : df < -step ? -step : df;
    if (Z[1] <= 0.001) { arrows.visible = false; }
    else if (UV[0] > 0) {
      arrows.visible = true; aMat.uniforms.uOpacity.value = Z[1];
      const S = sampler, U = UV[0], invU = 1 / U, m = arrows.instanceMatrix.array;
      for (let i = 0; i < nCount; i++) {
        const j = i * 3, x = lat[j], y = lat[j + 1], z = lat[j + 2], o = i * 16;
        let len = 0, r = 0, dx = 1, dy = 0, dz = 0;
        if (flow.sdf(x, y, z) > 0.012) {
          S.at(x, y, z);
          const sp = Math.sqrt(S.ux * S.ux + S.uy * S.uy + S.uz * S.uz);
          r = sp * invU; const rc = r < 0.04 ? 0.04 : r > 1.6 ? 1.6 : r;
          len = rc * lunit;
          if (sp > 1e-6) { dx = S.ux / sp; dy = S.uy / sp; dz = S.uz / sp; }
        }
        // orthonormal frame: e1 = flow direction, e2 from the up vector, e3 = e1 x e2
        let hx = 0, hy = 1, hz = 0; if (dy > 0.95 || dy < -0.95) { hx = 0; hy = 0; hz = 1; }
        const hd = hx * dx + hy * dy + hz * dz;
        let ex = hx - hd * dx, ey = hy - hd * dy, ez = hz - hd * dz;
        const el = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1; ex /= el; ey /= el; ez /= el;
        m[o] = dx; m[o + 1] = dy; m[o + 2] = dz; m[o + 3] = 0;
        m[o + 4] = ex; m[o + 5] = ey; m[o + 6] = ez; m[o + 7] = 0;
        m[o + 8] = dy * ez - dz * ey; m[o + 9] = dz * ex - dx * ez; m[o + 10] = dx * ey - dy * ex; m[o + 11] = 0;
        m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
        inst[i * 2] = len; inst[i * 2 + 1] = r;
      }
      arrows.instanceMatrix.needsUpdate = true; instAttr.needsUpdate = true;
    }

    // shock (independent of the selected flow view)
    const sk = (view.shock && Z[0] > 1) ? flow.shock() : null;
    if (sk) setShock(sk);
    df = (sk ? 1 : 0) - Z[2]; Z[2] += df > step ? step : df < -step ? -step : df;
    const vis = Z[2] > 0.001; shockSurf.visible = vis; shockLine.visible = vis;
    if (vis) { sSurfMat.uniforms.uOpacity.value = 0.12 * Z[2]; sLineMat.uniforms.uOpacity.value = 0.7 * Z[2]; }
  }

  buildLattice(state.get().tier);
  return {
    object: arrows, update,
    dispose() {
      root.remove(arrows, shockSurf, shockLine);
      arrows.dispose(); arrows.geometry.dispose(); aGeo.dispose(); aMat.dispose();
      sg.surf.dispose(); sg.line.dispose(); sSurfMat.dispose(); sLineMat.dispose();
    },
    _debug: () => ({ inst, nCount }),
  };
}

export default { init };
