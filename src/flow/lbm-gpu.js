// src/flow/lbm-gpu.js — WebGL2 backend of the mid-plane solver (same update as lbm.js, see there).
// Half-float render targets: populations in three MRT textures (A: g0..g3, B: g4..g7, C: g8, -, ux, uy),
// dye in RGBA16F over the whole test section (MacCormack, two passes per sub-step).
// Uses the three.js renderer of the scene so the dye texture can be drawn directly.
import * as THREE from 'three';
import { TUN } from './plane.js';

const VS = `in vec3 position; void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const HEAD = `precision highp float; precision highp sampler2D;\n`;

// far field: must mirror farAt() / dipoleAt() / shockJump() / sdfAt() in plane.js
const FAR = `
uniform sampler2D tSdf, tF0, tF1;
uniform vec4 uSdfBox, uFldBox;      // x0, y0, 1/(nx*h), 1/(ny*h) in texture space (texel centres at nodes)
uniform vec2 uSdfN, uFldN;
uniform float uSdfH;
uniform vec2 uCS;                   // cos, sin of alpha
uniform vec4 uK;                    // gnd, invb, dipK, gridK
uniform vec4 uDip; uniform float uDipRc2;   // xc, yc, a, b
uniform vec4 uVort[4]; uniform int uNV;
uniform float uHasPb;
uniform vec4 uSh0, uSh1, uSh2;      // (on, type, ax, ay) (sinT, cosT, xv, Rc) (tanMu, cot2, Rn, far)
uniform float uM;
float sm(float t){ t = clamp(t, 0.0, 1.0); return t*t*(3.0-2.0*t); }
vec2 mfr(vec2 w){ return vec2(w.x*uCS.x - w.y*uCS.y, w.x*uCS.y + w.y*uCS.x); }
float sdfM(vec2 m){
  vec2 f = (m - uSdfBox.xy) / uSdfH, c = clamp(f, vec2(0.0), uSdfN - 1.0);
  return texture(tSdf, (c + 0.5) / uSdfN).r + length(f - c) * uSdfH;
}
vec2 farW(vec2 w){
  if (uHasPb < 0.5) return vec2(1.0, 0.0);
  vec2 m = mfr(w), p = vec2(0.0);
  if (uK.w > 0.5) {
    vec2 f = (m - uFldBox.xy) * uFldBox.zw;             // 0..nx-1 in node units
    if (f.x > 0.0 && f.y > 0.0 && f.x < uFldN.x - 1.0 && f.y < uFldN.y - 1.0) {
      vec2 uv = (f + 0.5) / uFldN; vec4 a = texture(tF0, uv), g = texture(tF1, uv);
      vec2 e = min(f, uFldN - 1.0 - f) / (0.12 * uFldN);
      p = (uCS.x * a.xy + uCS.y * a.zw + uK.x * g.xy) * sm(e.x) * sm(e.y);
    }
  }
  if (uK.z > 0.5) {
    vec2 d = m - uDip.xy; float k = 0.5 * (uDip.z + uDip.w), mr = k * uDip.w * uCS.x, mi = k * uDip.z * uCS.y;
    float r2 = max(dot(d, d), uDipRc2), i4 = 1.0 / (r2 * r2), c = d.x*d.x - d.y*d.y, q = 2.0*d.x*d.y;
    p += vec2(-(mr*c + mi*q), mi*c - mr*q) * i4;
  }
  for (int i = 0; i < 4; i++) { if (i >= uNV) break;
    vec2 d = m - uVort[i].xy; float f = uK.x * uVort[i].z / max(dot(d, d), uVort[i].w); p += vec2(f * d.y, -f * d.x); }
  p *= uK.y;
  vec2 v = vec2(p.x*uCS.x + p.y*uCS.y, -p.x*uCS.y + p.y*uCS.x);
  if (uSh0.x > 0.5) {
    float dy = w.y - uSh0.w, rho = abs(dy), d, nx, nr, sinB;
    if (uSh0.y < 0.5) { d = (w.x - uSh0.z) * uSh1.x - rho * uSh1.y; nx = uSh1.x; nr = -uSh1.y; sinB = uSh1.x; }
    else { float q = uSh2.x * rho / uSh1.w, s = sqrt(1.0 + q*q), xs = uSh1.z + uSh1.w * uSh2.y * (s - 1.0), sl = (rho / uSh1.w) / s, il = inversesqrt(1.0 + sl*sl);
      d = (w.x - xs) * il; nx = il; nr = -sl * il; sinB = il; }
    if (d <= 0.0) return vec2(1.0, 0.0);
    float Mn = uM * sinB; vec2 j = vec2(0.0);
    if (Mn > 1.0) { float r = 2.4*Mn*Mn / (0.4*Mn*Mn + 2.0), ell = 0.4*rho + 0.5*uSh2.z + 0.02;
      float k = -(1.0 - 1.0/r) * sinB * exp(-d/ell) / (1.0 + rho/uSh2.w); j = vec2(k*nx, k*nr*sign(dy)); }
    v = v * sm(d / 0.02) + j;
  }
  return vec2(1.0, 0.0) + v;
}`;

const FS_STATIC = HEAD + FAR + `
uniform vec4 uWin; uniform float uPad, uUlb;      // x0, y0, h, -
layout(location=0) out vec4 o;
void main(){
  vec2 w = uWin.xy + gl_FragCoord.xy * uWin.z;
  float e = 0.0;
  if (uHasPb > 0.5) e = clamp(0.5 - (sdfM(mfr(w)) - uPad) / uWin.z, 0.0, 1.0);
  o = vec4(e, 0.0, farW(w) * uUlb);
}`;
const FS_FARDYE = HEAD + FAR + `
uniform vec4 uTun;                                // x0, y0, dh, -
layout(location=0) out vec4 o;
void main(){
  vec2 w = uTun.xy + gl_FragCoord.xy * uTun.z;
  o = vec4(farW(w), (uHasPb > 0.5 && sdfM(mfr(w)) < 0.0) ? 1.0 : 0.0, 0.0);
}`;

const EQ = `
const float W0 = 4.0/9.0, W1 = 1.0/9.0, W2 = 1.0/36.0;
void eqOut(vec2 v, out vec4 a, out vec4 b, out vec4 c){
  float uu = 1.5 * dot(v, v), cp = v.x + v.y, cm = v.y - v.x;
  a = vec4(W0 * (-uu), W1 * (3.0*v.x + 4.5*v.x*v.x - uu), W1 * (3.0*v.y + 4.5*v.y*v.y - uu), W1 * (-3.0*v.x + 4.5*v.x*v.x - uu));
  b = vec4(W1 * (-3.0*v.y + 4.5*v.y*v.y - uu), W2 * (3.0*cp + 4.5*cp*cp - uu), W2 * (3.0*cm + 4.5*cm*cm - uu), W2 * (-3.0*cp + 4.5*cp*cp - uu));
  c = vec4(W2 * (-3.0*cm + 4.5*cm*cm - uu), 0.0, v);
}`;
const FS_INIT = HEAD + EQ + `
uniform sampler2D tS; uniform float uKick;
layout(location=0) out vec4 oA; layout(location=1) out vec4 oB; layout(location=2) out vec4 oC;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy); vec4 s = texelFetch(tS, p, 0);
  float f = 1.0 - s.x, h = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0;
  eqOut(vec2(s.z * f, s.w * f + uKick * f * h), oA, oB, oC);
}`;
const FS_STEP = HEAD + EQ + `
uniform sampler2D tA, tB, tC, tS;
uniform ivec2 uN; uniform vec4 uP;                // tau0, 18*sqrt2*cs^2, slip, -
layout(location=0) out vec4 oA; layout(location=1) out vec4 oB; layout(location=2) out vec4 oC;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy); vec4 st = texelFetch(tS, p, 0);
  if (p.x == 0 || p.y == 0 || p.y == uN.y - 1) { eqOut(st.zw, oA, oB, oC); return; }
  if (p.x == uN.x - 1) {
    ivec2 q = p - ivec2(1, 0); vec4 a = texelFetch(tA, q, 0), b = texelFetch(tB, q, 0), c = texelFetch(tC, q, 0);
    float dr = a.x + a.y + a.z + a.w + b.x + b.y + b.z + b.w + c.x;
    oA = a - vec4(W0, W1, W1, W1) * dr; oB = b - vec4(W1, W2, W2, W2) * dr; oC = vec4(c.x - W2 * dr, 0.0, c.zw); return;
  }
  float f0 = texelFetch(tA, p, 0).x, f1 = texelFetch(tA, p + ivec2(-1, 0), 0).y, f2 = texelFetch(tA, p + ivec2(0, -1), 0).z, f3 = texelFetch(tA, p + ivec2(1, 0), 0).w;
  float f4 = texelFetch(tB, p + ivec2(0, 1), 0).x, f5 = texelFetch(tB, p + ivec2(-1, -1), 0).y, f6 = texelFetch(tB, p + ivec2(1, -1), 0).z, f7 = texelFetch(tB, p + ivec2(1, 1), 0).w;
  float f8 = texelFetch(tC, p + ivec2(-1, 1), 0).x;
  float dr = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8, r = clamp(1.0 + dr, 0.5, 1.5);
  vec2 v = vec2(f1 - f3 + f5 - f6 - f7 + f8, f2 - f4 + f5 + f6 - f7 - f8) / r;
  float v2 = dot(v, v); if (v2 > 0.1225) v *= 0.35 * inversesqrt(v2);
  float d3 = dr / 3.0;
  float pxx = f1 + f3 + f5 + f6 + f7 + f8 - d3 - r*v.x*v.x, pyy = f2 + f4 + f5 + f6 + f7 + f8 - d3 - r*v.y*v.y, pxy = f5 - f6 + f7 - f8 - r*v.x*v.y;
  float tx = (float(p.x) - 0.9 * float(uN.x - 1)) / (0.1 * float(uN.x - 1));
  float t0 = uP.x + (tx > 0.0 ? 0.35 * tx * tx : 0.0);
  float tau = 0.5 * (t0 + sqrt(t0*t0 + uP.y * sqrt(pxx*pxx + pyy*pyy + 2.0*pxy*pxy) / r)), om = 1.0 - 1.0 / tau;
  float uu = 1.5 * dot(v, v), cp = v.x + v.y, cm = v.y - v.x;
  float ax = om * 1.5 * (2.0*pxx - pyy), ay = om * 1.5 * (2.0*pyy - pxx), ad = om * 3.0 * (pxx + pyy), ao = om * 9.0 * pxy;
  float o0 = W0 * (dr - r*uu - om * 1.5 * (pxx + pyy));
  float o1 = W1 * (dr + r * (3.0*v.x + 4.5*v.x*v.x - uu) + ax), o3 = W1 * (dr + r * (-3.0*v.x + 4.5*v.x*v.x - uu) + ax);
  float o2 = W1 * (dr + r * (3.0*v.y + 4.5*v.y*v.y - uu) + ay), o4 = W1 * (dr + r * (-3.0*v.y + 4.5*v.y*v.y - uu) + ay);
  float o5 = W2 * (dr + r * (3.0*cp + 4.5*cp*cp - uu) + ad + ao), o7 = W2 * (dr + r * (-3.0*cp + 4.5*cp*cp - uu) + ad + ao);
  float o6 = W2 * (dr + r * (3.0*cm + 4.5*cm*cm - uu) + ad - ao), o8 = W2 * (dr + r * (-3.0*cm + 4.5*cm*cm - uu) + ad - ao);
  float e = st.x;
  if (e > 0.0) {
    float k = uP.z * (1.0 - e), us = uu * k * k; vec2 s = v * k; float sp = cp * k, sq = cm * k;
    o0 = mix(o0, f0 + W0 * r * (uu - us), e);
    o1 = mix(o1, f3 + W1 * r * (3.0*s.x + 4.5*s.x*s.x - us + 3.0*v.x - 4.5*v.x*v.x + uu), e);
    o3 = mix(o3, f1 + W1 * r * (-3.0*s.x + 4.5*s.x*s.x - us - 3.0*v.x - 4.5*v.x*v.x + uu), e);
    o2 = mix(o2, f4 + W1 * r * (3.0*s.y + 4.5*s.y*s.y - us + 3.0*v.y - 4.5*v.y*v.y + uu), e);
    o4 = mix(o4, f2 + W1 * r * (-3.0*s.y + 4.5*s.y*s.y - us - 3.0*v.y - 4.5*v.y*v.y + uu), e);
    o5 = mix(o5, f7 + W2 * r * (3.0*sp + 4.5*sp*sp - us + 3.0*cp - 4.5*cp*cp + uu), e);
    o7 = mix(o7, f5 + W2 * r * (-3.0*sp + 4.5*sp*sp - us - 3.0*cp - 4.5*cp*cp + uu), e);
    o6 = mix(o6, f8 + W2 * r * (3.0*sq + 4.5*sq*sq - us + 3.0*cm - 4.5*cm*cm + uu), e);
    o8 = mix(o8, f6 + W2 * r * (-3.0*sq + 4.5*sq*sq - us - 3.0*cm - 4.5*cm*cm + uu), e);
  }
  oA = vec4(o0, o1, o2, o3); oB = vec4(o4, o5, o6, o7); oC = vec4(o8, 0.0, v * (1.0 - e));
}`;
const FS_PACK = HEAD + `
uniform sampler2D tC; uniform float uIu;
layout(location=0) out vec4 o;
vec2 enc(float v){ float t = clamp(v * 0.25 + 0.5, 0.0, 1.0) * 65535.0; float hi = floor(t / 256.0); return vec2(hi, t - hi * 256.0) / 255.0; }
void main(){ vec2 v = texelFetch(tC, ivec2(gl_FragCoord.xy), 0).zw * uIu; o = vec4(enc(v.x), enc(v.y)); }`;

const DYEV = `
uniform sampler2D tFar, tC;
uniform vec4 uTun, uWin;             // tunnel x0, y0, dh, -   window x0, y0, 1/(nx h), 1/(ny h)
uniform vec4 uD;                     // displacement in dye cells for U, lbm on, 1/ulb, -
uniform vec2 uDN;
float sm(float t){ t = clamp(t, 0.0, 1.0); return t*t*(3.0-2.0*t); }
vec2 velAt(vec2 fc){
  vec2 v = texture(tFar, fc / uDN).xy;
  if (uD.y > 0.5) {
    vec2 f = (uTun.xy + fc * uTun.z - uWin.xy) * uWin.zw;
    if (f.x > 0.0 && f.x < 1.0 && f.y > 0.0 && f.y < 1.0) {
      float w = sm(f.x / 0.05) * sm((1.0 - f.x) / 0.11) * sm(min(f.y, 1.0 - f.y) / 0.07);
      v = mix(v, texture(tC, f).zw * uD.z, w);
    }
  }
  return v * uD.x;
}`;
const FS_ADV1 = HEAD + DYEV + `
uniform sampler2D tDye; layout(location=0) out vec4 o;
void main(){ o = texture(tDye, (gl_FragCoord.xy - velAt(gl_FragCoord.xy)) / uDN); }`;
const FS_ADV2 = HEAD + DYEV + `
uniform sampler2D tDye, tFw, tNoz; uniform float uNozCol;
layout(location=0) out vec4 o;
void main(){
  vec2 fc = gl_FragCoord.xy; ivec2 p = ivec2(fc);
  if (texelFetch(tFar, p, 0).z > 0.5 || fc.x > uDN.x - 2.0) { o = vec4(0.0); return; }
  if (fc.x < uNozCol + 2.0 + uD.x) { o = fc.x > uNozCol - 1.0 ? texelFetch(tNoz, ivec2(p.y, 0), 0) : vec4(0.0); return; }
  vec2 v = velAt(fc), b = fc - v;
  vec4 c = texelFetch(tDye, p, 0), fw = texelFetch(tFw, p, 0), bk = texture(tFw, (fc + v) / uDN);
  ivec2 q = ivec2(floor(b - 0.5)), mx = ivec2(uDN) - 1;
  vec4 a0 = texelFetch(tDye, clamp(q, ivec2(0), mx), 0), a1 = texelFetch(tDye, clamp(q + ivec2(1, 0), ivec2(0), mx), 0);
  vec4 a2 = texelFetch(tDye, clamp(q + ivec2(0, 1), ivec2(0), mx), 0), a3 = texelFetch(tDye, clamp(q + ivec2(1, 1), ivec2(0), mx), 0);
  o = clamp(fw + 0.5 * (c - bk), min(min(a0, a1), min(a2, a3)), max(max(a0, a1), max(a2, a3)));
}`;

export function createGpuBackend(renderer) {
  const gl = renderer.getContext();
  if (!renderer.capabilities.isWebGL2) throw new Error('webgl2');
  if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) throw new Error('no float targets');
  const HF = THREE.HalfFloatType;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), scene = new THREE.Scene();
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(tri, null); mesh.frustumCulled = false; scene.add(mesh);
  const mat = (fs, u) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  const V4 = () => new THREE.Vector4(), V2 = () => new THREE.Vector2();
  const far = () => ({
    tSdf: { value: null }, tF0: { value: null }, tF1: { value: null }, uSdfBox: { value: V4() }, uFldBox: { value: V4() }, uSdfN: { value: V2() }, uFldN: { value: V2() }, uSdfH: { value: 1 },
    uCS: { value: V2() }, uK: { value: V4() }, uDip: { value: V4() }, uDipRc2: { value: 1 }, uVort: { value: [V4(), V4(), V4(), V4()] }, uNV: { value: 0 }, uHasPb: { value: 0 },
    uSh0: { value: V4() }, uSh1: { value: V4() }, uSh2: { value: V4() }, uM: { value: 0 },
  });
  const mStatic = mat(FS_STATIC, Object.assign(far(), { uWin: { value: V4() }, uPad: { value: 0 }, uUlb: { value: 0.15 } }));
  const mFarDye = mat(FS_FARDYE, Object.assign(far(), { uTun: { value: V4() } }));
  const mInit = mat(FS_INIT, { tS: { value: null }, uKick: { value: 0 } });
  const mStep = mat(FS_STEP, { tA: { value: null }, tB: { value: null }, tC: { value: null }, tS: { value: null }, uN: { value: V2() }, uP: { value: V4() } });
  const mPack = mat(FS_PACK, { tC: { value: null }, uIu: { value: 1 } });
  const dyeU = () => ({ tFar: { value: null }, tC: { value: null }, uTun: { value: V4() }, uWin: { value: V4() }, uD: { value: V4() }, uDN: { value: V2() }, tDye: { value: null } });
  const mAdv1 = mat(FS_ADV1, dyeU());
  const mAdv2 = mat(FS_ADV2, Object.assign(dyeU(), { tFw: { value: null }, tNoz: { value: null }, uNozCol: { value: 0 } }));

  let nx = 0, ny = 0, dnx = 0, dny = 0, pa = null, pb_ = null, sRT = null, farRT = null, d0 = null, d1 = null, dF = null, packRT = null;
  let nozTex = null, sdfTex = null, f0Tex = null, f1Tex = null, bake = null;
  let pbos = [], issued = [], slot = 0, bytes = null, lastWin = null, clearDyePending = true;
  const rt = (w, h, count, linear) => {
    const t = new THREE.WebGLRenderTarget(w, h, { count: count || 1, type: HF, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      minFilter: linear ? THREE.LinearFilter : THREE.NearestFilter, magFilter: linear ? THREE.LinearFilter : THREE.NearestFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    return t;
  };
  function pass(m, target) {
    const prev = renderer.getRenderTarget(), ac = renderer.autoClear;
    renderer.autoClear = false; mesh.material = m;
    renderer.setRenderTarget(target); renderer.render(scene, cam);
    renderer.setRenderTarget(prev); renderer.autoClear = ac;
  }
  function disposeRT() { for (const t of [pa, pb_, sRT, farRT, d0, d1, dF, packRT]) if (t) t.dispose(); if (nozTex) nozTex.dispose(); for (const b of pbos) gl.deleteBuffer(b); pbos = []; issued = []; slot = 0; }
  function half(arr, n, ch, pick) {
    const out = new Uint16Array(n * 4);
    for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) { const k = pick[c]; out[4 * i + c] = THREE.DataUtils.toHalfFloat(k < 0 ? 0 : Math.max(-60000, Math.min(60000, arr[i * ch + k]))); }
    return out;
  }
  function dtex(data, w, h) {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, HF);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false; t.needsUpdate = true; return t;
  }
  function setFar(u, S) {
    u.uHasPb.value = bake ? 1 : 0; u.uCS.value.set(S.ca, S.sa); u.uK.value.set(S.gnd, S.invb, S.dipK, S.gridK); u.uM.value = S.M;
    if (bake) {
      const g = bake.sdf, f = bake.field, d = bake.dip, v = bake.vort;
      u.tSdf.value = sdfTex; u.tF0.value = f0Tex; u.tF1.value = f1Tex;
      u.uSdfBox.value.set(g.x0, g.y0, 0, 0); u.uSdfN.value.set(g.nx, g.ny); u.uSdfH.value = g.h;
      u.uFldBox.value.set(f.x0, f.y0, 1 / f.h, 1 / f.h); u.uFldN.value.set(f.nx, f.ny);
      u.uDip.value.set(d.xc, d.yc, d.a, d.b); u.uDipRc2.value = d.rc2;
      const nv = Math.min(4, v.length / 4); u.uNV.value = S.gnd !== 0 ? nv : 0;
      for (let i = 0; i < nv; i++) u.uVort.value[i].set(v[4 * i], v[4 * i + 1], v[4 * i + 2], v[4 * i + 3]);
    }
    const sh = S.shock;
    if (sh) { u.uSh0.value.set(1, sh.type, sh.ax, sh.ay); u.uSh1.value.set(sh.sinT, sh.cosT, sh.xv, sh.Rc); u.uSh2.value.set(sh.tanMu, sh.cot2, sh.Rn, sh.far); }
    else u.uSh0.value.set(0, 0, 0, 0);
  }
  return {
    kind: 'gpu',
    resize(a, b, c, d) {
      disposeRT(); nx = a; ny = b; dnx = c; dny = d;
      pa = rt(nx, ny, 3, true); pb_ = rt(nx, ny, 3, true); sRT = rt(nx, ny, 1, false); farRT = rt(dnx, dny, 1, true);
      d0 = rt(dnx, dny, 1, true); d1 = rt(dnx, dny, 1, true); dF = rt(dnx, dny, 1, true);
      packRT = new THREE.WebGLRenderTarget(nx, ny, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      nozTex = new THREE.DataTexture(new Float32Array(dny * 4), dny, 1, THREE.RGBAFormat, THREE.FloatType);
      nozTex.minFilter = nozTex.magFilter = THREE.NearestFilter; nozTex.needsUpdate = true;
      bytes = new Uint8Array(nx * ny * 4);
      for (let i = 0; i < 2; i++) { const b = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, nx * ny * 4, gl.STREAM_READ); pbos.push(b); issued.push(false); }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      clearDyePending = true;
    },
    setBake(b) {
      bake = b;
      for (const t of [sdfTex, f0Tex, f1Tex]) if (t) t.dispose();
      sdfTex = f0Tex = f1Tex = null;
      if (b) {
        sdfTex = dtex(half(b.sdf.d, b.sdf.nx * b.sdf.ny, 1, [0, -1, -1, -1]), b.sdf.nx, b.sdf.ny);
        f0Tex = dtex(half(b.field.d, b.field.nx * b.field.ny, 6, [0, 1, 2, 3]), b.field.nx, b.field.ny);
        f1Tex = dtex(half(b.field.d, b.field.nx * b.field.ny, 6, [4, 5, -1, -1]), b.field.nx, b.field.ny);
      }
    },
    setStatic(S) {
      lastWin = S.win;
      let u = mStatic.uniforms; setFar(u, S); u.uWin.value.set(S.win.x0, S.win.y0, S.win.h, 0); u.uPad.value = S.pad; u.uUlb.value = S.ulb;
      pass(mStatic, sRT);
      u = mFarDye.uniforms; setFar(u, S); u.uTun.value.set(TUN.x0, TUN.y0, (TUN.x1 - TUN.x0) / dnx, 0);
      pass(mFarDye, farRT);
    },
    init(kick) { mInit.uniforms.tS.value = sRT.texture; mInit.uniforms.uKick.value = kick; pass(mInit, pa); },
    step(n, P) {
      const u = mStep.uniforms; u.tS.value = sRT.texture; u.uN.value.set(nx, ny); u.uP.value.set(P.tau, 18 * Math.SQRT2 * P.cs * P.cs, P.slip, 0);
      for (let i = 0; i < n; i++) {
        u.tA.value = pa.textures[0]; u.tB.value = pa.textures[1]; u.tC.value = pa.textures[2];
        pass(mStep, pb_); const t = pa; pa = pb_; pb_ = t;
      }
    },
    advectDye(disp, nsub, lbmOn, ulb) {
      if (clearDyePending) {      // transparent black: renderer.clear() alone would fill with the scene's clear colour (alpha 1 = a white sheet)
        const prev = renderer.getRenderTarget(), oc = new THREE.Color(), oa = renderer.getClearAlpha(); renderer.getClearColor(oc); renderer.setClearColor(0x000000, 0);
        for (const t of [d0, d1, dF]) { renderer.setRenderTarget(t); renderer.clear(); }
        renderer.setRenderTarget(prev); renderer.setClearColor(oc, oa); clearDyePending = false;
      }
      const dh = (TUN.x1 - TUN.x0) / dnx;
      for (const m of [mAdv1, mAdv2]) {
        const u = m.uniforms; u.tFar.value = farRT.texture; u.tC.value = pa.textures[2]; u.uTun.value.set(TUN.x0, TUN.y0, dh, 0);
        if (lastWin) u.uWin.value.set(lastWin.x0, lastWin.y0, 1 / (nx * lastWin.h), 1 / (ny * lastWin.h));
        u.uD.value.set(disp / nsub, lbmOn ? 1 : 0, 1 / ulb, 0); u.uDN.value.set(dnx, dny);
      }
      mAdv2.uniforms.tNoz.value = nozTex; mAdv2.uniforms.uNozCol.value = Math.round((TUN.noz - TUN.x0) / dh);
      for (let s = 0; s < nsub; s++) {
        mAdv1.uniforms.tDye.value = d0.texture; pass(mAdv1, dF);
        mAdv2.uniforms.tDye.value = d0.texture; mAdv2.uniforms.tFw.value = dF.texture; pass(mAdv2, d1);
        const t = d0; d0 = d1; d1 = t;
      }
    },
    setNozzles(profile) { nozTex.image.data.set(profile); nozTex.needsUpdate = true; },
    clearDye() { clearDyePending = true; },
    // read-back through a ring of two pixel pack buffers, no fences (Chrome only reports a fence as signalled after
    // a later task, so polling it starved the CPU copy in slow / software WebGL): the buffer written two calls ago is
    // read now (the GPU has long finished it; if not, the read waits, which also paces a backed-up software GPU).
    // Returns true when dst holds a new field.
    readVelocity(dst, ulb) {
      let fresh = false;
      const b = pbos[slot];
      if (issued[slot]) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const n = nx * ny;
        for (let i = 0; i < n; i++) { const o = 4 * i; dst[2 * i] = ((bytes[o] * 256 + bytes[o + 1]) / 65535 - 0.5) * 4; dst[2 * i + 1] = ((bytes[o + 2] * 256 + bytes[o + 3]) / 65535 - 0.5) * 4; }
        fresh = true;
      }
      mPack.uniforms.tC.value = pa.textures[2]; mPack.uniforms.uIu.value = 1 / ulb;
      const prev = renderer.getRenderTarget(), ac = renderer.autoClear;
      renderer.autoClear = false; mesh.material = mPack; renderer.setRenderTarget(packRT); renderer.render(scene, cam);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.readPixels(0, 0, nx, ny, gl.RGBA, gl.UNSIGNED_BYTE, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      issued[slot] = true; slot = (slot + 1) % pbos.length;
      renderer.setRenderTarget(prev); renderer.autoClear = ac;
      return fresh;
    },
    dyeTexture() { return d0 ? d0.texture : null; },
    dyeData() { return null; },
    dyeSize() { return [dnx, dny]; },
    gpuMs() { return 0; },
    dispose() { disposeRT(); for (const t of [sdfTex, f0Tex, f1Tex]) if (t) t.dispose(); },
  };
}
