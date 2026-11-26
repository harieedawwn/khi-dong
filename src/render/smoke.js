// P6 — smoke.js. rake 'plane': VOLUMETRIC smoke (ray-marched slab around z = 0) built on the dye field of the mid-plane solver (flow.plane).
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

// rake 'plane' as a VOLUME: the solver's mid-plane dye field is the core at z = 0; off the plane it is extruded with a
// Gaussian thickness H(x) that grows downstream (thin round-ish filaments at the nozzle, about the model's width at the
// model, wider in the wake) and warped by a 3D noise carried with the flow, so filaments twist into real 3D wisps.
// From the side the picture is the solver's (the column integral is normalised by H); from any other angle it has depth.
const VVERT = /* glsl */`
varying vec3 vW;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const VFRAG = /* glsl */`
#include <packing>
uniform sampler2D uDye, uNoise, uDepth;
uniform vec2 uSize, uRes;
uniform vec3 uBMin, uBMax, uTint, uFwd;
uniform vec4 uTun;                       // x0, x1, y0, y1 of the dye grid
uniform vec4 uH;                         // nozzle half-thickness, model add, wake add, puff/twist amount
uniform vec4 uMod;                       // model x0, x1, y centre, y half-height
uniform float uMulti, uOpacity, uGain, uTime, uU, uNear, uFar, uOrtho, uSteps, uStepMax, uDepthOn, uDepthTap;
varying vec3 vW;
vec4 dye(vec2 uv){                       // quintic reconstruction: crisp filaments without bilinear diamonds
  vec2 p = uv * uSize - 0.5, i = floor(p), f = p - i;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return texture2D(uDye, (i + 0.5 + f) / uSize);
}
void main(){
  vec3 rd = uOrtho > 0.5 ? uFwd : normalize(vW - cameraPosition);
  vec3 ro = uOrtho > 0.5 ? vW - rd * 60.0 : cameraPosition;
  vec3 inv = 1.0 / rd, ta = (uBMin - ro) * inv, tb = (uBMax - ro) * inv;
  vec3 tn = min(ta, tb), tx = max(ta, tb);
  float t0 = max(max(tn.x, tn.y), max(tn.z, 0.0)), t1 = min(min(tx.x, tx.y), tx.z);
  if (uDepthOn > 0.5) {                  // stop at the model (its own depth pass)
    vec2 duv = gl_FragCoord.xy / uRes;
    float dd = unpackRGBAToDepth(texture2D(uDepth, duv));
    if (uDepthTap > 0.5) {               // half-resolution depth: take the farthest of the 4 nearest texels so no step shows at the silhouette
      vec2 q = duv * uRes * 0.5 - 0.5, i0 = floor(q), r = uRes * 0.5;
      dd = 0.0;
      for (int k = 0; k < 4; k++) { vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2)); dd = max(dd, unpackRGBAToDepth(texture2D(uDepth, (i0 + o + 0.5) / r))); }
    }
    if (dd < 0.9999) {
      float vz = uOrtho > 0.5 ? orthographicDepthToViewZ(dd, uNear, uFar) : perspectiveDepthToViewZ(dd, uNear, uFar);
      t1 = min(t1, (-vz - dot(ro - cameraPosition, uFwd)) / max(dot(rd, uFwd), 1e-3));
    }
  }
  if (t1 - t0 <= 1e-4) discard;
  // adaptive march: about 10 samples across the local Gaussian slab whatever its thickness, jump over empty space
  float az0 = max(abs(rd.z), 0.12), jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float t = t0, first = 1.0;
  vec3 acc = vec3(0.0); float T = 1.0;
  float sx = 1.0 / (uTun.y - uTun.x), sy = 1.0 / (uTun.w - uTun.z);
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps || t >= t1 || T < 0.015) break;
    vec3 p = ro + rd * t;
    float grow = smoothstep(uTun.x, uMod.x, p.x);
    float wk = smoothstep(uMod.x, uMod.y + 1.6, p.x);
    float H = uH.x + uH.y * grow * grow + uH.z * wk;
    float zeta = p.z / H;
    if (abs(zeta) > 2.2) {
      if (p.z * rd.z < 0.0) { t += max((abs(p.z) - 2.1 * H) / az0, 0.002); continue; }   // heading into the slab
      if (abs(rd.z) > 0.3 && abs(p.z) > 2.2 * H) break;                                   // left it and still moving away from z = 0
      t += 0.06; continue;                                                                // grazing: H may still grow
    }
    float ds = max(min(0.42 * H / az0, uStepMax), (t1 - t0) / uSteps);   // always reach the far end within uSteps
    if (first > 0.5) { first = 0.0; t += ds * jit; continue; }
    t += ds;
    float env = exp(-2.0 * zeta * zeta);
    // noise carried with the flow (two slices of a 2D noise make a cheap 3D field)
    vec3 q = vec3(p.x - uTime * uU, p.y, p.z);
    vec4 n1 = texture2D(uNoise, q.xy * 1.3 + q.z * vec2(0.83, 1.21));
    vec4 n2 = texture2D(uNoise, q.xz * 2.4 + q.y * vec2(1.07, -0.61) + 0.37);
    float az = min(abs(zeta), 1.6);
    // off the plane a filament bends in y (twisting curtain), more near/after the model where the flow is disturbed
    float near = 1.0 - smoothstep(0.0, 1.0, abs(p.y - uMod.z) / (uMod.w + 0.25));
    float amp = uH.w * H * az * (0.55 + 0.9 * wk + 0.5 * near * grow);
    float dy = amp * ((n1.r - 0.5) * 1.6 + (n2.g - 0.5) * 0.9);
    vec2 uv = vec2((p.x - uTun.x) * sx, (p.y + dy - uTun.z) * sy);
    if (uv.y < 0.0 || uv.y > 1.0) { t += ds; continue; }
    vec4 d = dye(uv);
    float v = clamp(d.a * uGain, 0.0, 1.0);
    if (v < 0.01) { t += ds; continue; }
    float puff = mix(1.0, 0.25 + 1.5 * n2.b, uH.w * min(az, 1.0) * (0.5 + 0.5 * wk));
    float fx = smoothstep(0.0, 0.02, uv.x - 0.015) * (1.0 - smoothstep(0.93, 0.995, uv.x));
    float sig = 1.55 * v * env * puff * fx / H * clamp(pow(H / 0.03, 0.3), 1.0, 1.5);   // column over z = 1.94 v (the flat sheet), more where the smoke is thick
    float e = exp(-sig * ds);
    vec3 c = mix(uTint, d.rgb / max(d.a, 1e-4), uMulti);
    c *= 0.86 + 0.22 * n1.g - 0.1 * az;                   // soft self-shading: denser core, darker rim
    acc += T * (1.0 - e) * c; T *= e;
  }
  float a = 1.0 - T;
  if (a < 0.004) discard;
  gl_FragColor = vec4(acc / a * 0.95, a * uOpacity);
  #include <colorspace_fragment>
}`;

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
  // thin soft filaments: no saturated plateau, a bright thin core that falls off smoothly (real smoke-tunnel photos)
  float v = clamp(d.a * uGain, 0.0, 1.0);
  float a = 0.85 * smoothstep(0.05, 0.7, v);
  a *= smoothstep(0.0, 0.02, vUv.x - 0.015) * (1.0 - smoothstep(0.93, 0.995, vUv.x));
  if (a < 0.004) discard;
  vec3 c = mix(uTint, d.rgb / max(d.a, 1e-4), uMulti);
  gl_FragColor = vec4(c * 0.94, a * uOpacity);
  #include <colorspace_fragment>
}`;

function noiseTexture() {                // tileable value-noise fbm, 4 independent channels
  const S = 128, d = new Uint8Array(S * S * 4);
  const lat = (g, seed) => { const a = new Float32Array(g * g); let s = seed; for (let i = 0; i < a.length; i++) { s = (s * 16807) % 2147483647; a[i] = s / 2147483647; } return a; };
  const val = (a, g, x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const i0 = ((xi % g) + g) % g, j0 = ((yi % g) + g) % g, i1 = (i0 + 1) % g, j1 = (j0 + 1) % g;
    const a0 = a[j0 * g + i0] + (a[j0 * g + i1] - a[j0 * g + i0]) * fx, a1 = a[j1 * g + i0] + (a[j1 * g + i1] - a[j1 * g + i0]) * fx;
    return a0 + (a1 - a0) * fy;
  };
  for (let c = 0; c < 4; c++) {
    const oct = [[4, 0.6], [8, 0.27], [16, 0.13]].map(([g, w], k) => ({ g, w, a: lat(g, 1 + c * 97 + k * 13) }));
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      let v = 0; for (const o of oct) v += o.w * val(o.a, o.g, i / S * o.g, j / S * o.g);
      d[(j * S + i) * 4 + c] = Math.round(255 * Math.min(1, Math.max(0, (v - 0.5) * 1.5 + 0.5)));
    }
  }
  const tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}
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
  const noise = noiseTexture();
  const vMat = new THREE.ShaderMaterial({
    vertexShader: VVERT, fragmentShader: VFRAG, transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide,
    uniforms: {
      uDye: { value: null }, uNoise: { value: noise }, uDepth: { value: null }, uSize: { value: new THREE.Vector2(1, 1) }, uRes: { value: new THREE.Vector2(1, 1) },
      uBMin: { value: new THREE.Vector3() }, uBMax: { value: new THREE.Vector3() }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uFwd: { value: new THREE.Vector3(0, 0, -1) },
      uTun: { value: new THREE.Vector4(TUN.x0, TUN.x1, TUN.y0, TUN.y1) }, uH: { value: new THREE.Vector4(0.006, 0.1, 0.06, 0.6) }, uMod: { value: new THREE.Vector4(-0.2, 0.2, 0, 0.1) },
      uMulti: { value: 0 }, uOpacity: { value: 1 }, uGain: { value: 1 }, uTime: { value: 0 }, uU: { value: 1 }, uNear: { value: 0.05 }, uFar: { value: 200 }, uOrtho: { value: 0 }, uSteps: { value: 40 }, uDepthTap: { value: 1 }, uStepMax: { value: 0.012 }, uDepthOn: { value: 0 },
    },
  });
  // adjustable (multipliers / overrides): ?smokeSpread=&smokeWisp=&smokeSteps= or ctx.smoke.cfg at runtime;
  // state.view.smokeSpread (0 = flat laser sheet, 1 = about the model's width) and smokeWisp (0 = smooth, 1 = very curly) from the panel
  const cfg = { spread: 1, wisp: 1, steps: 0, depth: true };
  try { const q = new URLSearchParams(location.search); for (const k of ['spread', 'wisp', 'steps']) { const v = parseFloat(q.get('smoke' + k[0].toUpperCase() + k.slice(1))); if (v >= 0) cfg[k] = v; } } catch (e) { /* no location */ }
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), vMat);
  sheet.frustumCulled = false; sheet.visible = false; sheet.renderOrder = 5;
  (sc.root || sc.scene).add(sheet);
  const dMat = new THREE.ShaderMaterial({
    vertexShader: DVERT, fragmentShader: DFRAG, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    uniforms: { uDye: { value: null }, uSize: { value: new THREE.Vector2(1, 1) }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uMulti: { value: 0 }, uOpacity: { value: 1 }, uGain: { value: 1 } },
  });
  const flatSheet = new THREE.Mesh(new THREE.PlaneGeometry(TUN.x1 - TUN.x0, TUN.y1 - TUN.y0), dMat);
  flatSheet.position.set(0.5 * (TUN.x0 + TUN.x1), 0.5 * (TUN.y0 + TUN.y1), 0);
  flatSheet.frustumCulled = false; flatSheet.visible = false; flatSheet.renderOrder = 5;
  (sc.root || sc.scene).add(flatSheet);
  // model depth pass (layer 7 only), drawn from inside the main render so the camera is exactly the one used
  const DLAYER = 7;
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  let depthRT = null, layered = null;
  const dFrame = [0, NaN, 0, null];          // frame counter, view key, frame of the last depth pass, model group
  const sz2 = new THREE.Vector2(), oc = new THREE.Color(), fwd = new THREE.Vector3();
  sheet.onBeforeRender = (renderer, scene, camera) => {
    const u = vMat.uniforms;
    camera.getWorldDirection(fwd); u.uFwd.value.copy(fwd);
    u.uNear.value = camera.near; u.uFar.value = camera.far; u.uOrtho.value = camera.isOrthographicCamera ? 1 : 0;
    // inside the slab (rare): draw the back faces without depth test
    const inside = camPos.x > u.uBMin.value.x && camPos.x < u.uBMax.value.x && camPos.y > u.uBMin.value.y && camPos.y < u.uBMax.value.y && camPos.z > u.uBMin.value.z && camPos.z < u.uBMax.value.z;
    const side = inside ? THREE.BackSide : THREE.FrontSide;
    if (vMat.side !== side) { vMat.side = side; vMat.depthTest = !inside; vMat.needsUpdate = true; }
    const mv = ctx.modelview && ctx.modelview.view;
    if (!cfg.depth || !mv || !mv.group) { u.uDepthOn.value = 0; return; }
    if (mv.phase && mv.phase !== 'idle') dFrame[0] += 6;   // model growing / leaving: refresh every frame
    if (layered !== mv.group) { mv.group.traverse((o) => o.layers.enable(DLAYER)); layered = mv.group; }
    const target = renderer.getRenderTarget();
    if (target) sz2.set(target.width, target.height); else renderer.getDrawingBufferSize(sz2);
    u.uRes.value.copy(sz2);
    const dsc = state.get().tier === 'high' ? 1 : 0.5; u.uDepthTap.value = dsc < 1 ? 1 : 0;
    const w = Math.max(1, Math.round(sz2.x * dsc)), hgt = Math.max(1, Math.round(sz2.y * dsc));
    if (!depthRT) { depthRT = new THREE.WebGLRenderTarget(w, hgt, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true }); }
    else if (depthRT.width !== w || depthRT.height !== hgt) depthRT.setSize(w, hgt);
    // re-draw only when the view changed (or every 6th frame for spinning rotors / the model sliding in)
    const me = camera.matrixWorld.elements, pe = camera.projectionMatrix.elements;
    let key = w * 7.31 + hgt * 1.17;
    for (let i = 0; i < 16; i++) key += me[i] * (i + 1.37) + pe[i] * (i + 2.11);
    dFrame[0]++;
    if (u.uDepthOn.value > 0.5 && key === dFrame[1] && layered === dFrame[3] && (dFrame[0] - dFrame[2]) < 6) return;
    dFrame[1] = key; dFrame[2] = dFrame[0]; dFrame[3] = layered;
    const mask = camera.layers.mask, bg = scene.background, ov = scene.overrideMaterial, au = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(oc); const oa = renderer.getClearAlpha();
    camera.layers.set(DLAYER); scene.background = null; scene.overrideMaterial = depthMat; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(depthRT); renderer.setClearColor(0xffffff, 1); renderer.clear(true, true, false);
    renderer.render(scene, camera);
    camera.layers.mask = mask; scene.background = bg; scene.overrideMaterial = ov; renderer.shadowMap.autoUpdate = au;
    renderer.setClearColor(oc, oa); renderer.setRenderTarget(target);
    u.uDepth.value = depthRT.texture; u.uDepthOn.value = 1;
  };
  const zBox = new THREE.Box3(); let zGeo = null, zHalf = 0.1, yC = 0, yH = 0.1;
  function modelWidth() {                // robust half-width in z: median |z| (rotor discs / wings / spans do not count)
    const mv = ctx.modelview && ctx.modelview.view, g = mv && mv.model && mv.model.geometry;
    if (!g || g === zGeo) return;
    zGeo = g; const pos = g.attributes.position, n = pos.count, st = Math.max(1, Math.floor(n / 4000)), a = [];
    for (let i = 0; i < n; i += st) a.push(Math.abs(pos.getZ(i)));
    a.sort((p, q) => p - q); zHalf = a.length ? a[Math.floor(0.5 * (a.length - 1))] : 0.1;
    if (!g.boundingBox) g.computeBoundingBox(); zBox.copy(g.boundingBox);
    yC = 0.5 * (zBox.min.y + zBox.max.y); yH = 0.5 * (zBox.max.y - zBox.min.y);
  }
  let cpuTex = null, cpuBytes = null;
  function dyeTexture() {
    const be = plane.backend(); if (!be) return null;
    const sz = be.dyeSize(); vMat.uniforms.uSize.value.set(sz[0], sz[1]);
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
  const VT = new Float64Array(1);        // noise clock (s, slow-motion time; frozen while paused)
  function updateSheet(view, fade, dt) {
    plane.setView({ lines: view.lines * (ctx.quality ? ctx.quality.scale : 1), density: view.density });
    const tex = dyeTexture();
    if (!tex) { sheet.visible = false; flatSheet.visible = false; return; }
    const qs = ctx.quality ? ctx.quality.scale : 1, sq = view.smokeQ || 'auto';
    const mode = sq !== 'auto' ? sq : qs <= 0.35 ? 'flat' : state.get().tier === 'high' ? 'high' : 'low';
    if (mode === 'flat') {
      const d = dMat.uniforms; d.uDye.value = tex; d.uSize.value.copy(vMat.uniforms.uSize.value);
      col.set(HEX[view.smokeColor] || HEX.white); d.uTint.value.set(col.r, col.g, col.b);
      d.uMulti.value = view.smokeColor === 'multi' ? 1 : 0;
      d.uOpacity.value = fade * (0.5 + 0.5 * view.density); d.uGain.value = 1.15 + 0.5 * view.density;
      sheet.visible = false; flatSheet.visible = true; return;
    }
    flatSheet.visible = false;
    modelWidth();
    const u = vMat.uniforms; u.uDye.value = tex;
    VT[0] += dt; u.uTime.value = VT[0] % 1000; u.uU.value = UV[0] * 0.9;
    const spread = Math.max(0, (view.smokeSpread ?? 1) * cfg.spread), wisp = Math.max(0, Math.min(1.5, (view.smokeWisp ?? 0.6) * cfg.wisp));
    const zh = Math.min(0.12, Math.max(0.045, zHalf));
    const hn = 0.004 + 0.006 * Math.min(1, spread), hm = 1.0 * zh * spread, hw = 0.7 * zh * spread + 0.04 * spread;
    u.uH.value.set(hn, hm, hw, spread > 0.02 ? wisp : 0);
    const bx = ctx.modelview && ctx.modelview.box;
    u.uMod.value.set(bx ? bx.x0 : -0.2, bx ? bx.x1 : 0.2, yC, yH);
    const zb = Math.min(1.1, 1.9 * (hn + hm + hw) + 0.01);
    const yLo = Math.max(TUN.y0, -0.70), yHi = Math.min(TUN.y1, 0.70);
    u.uBMin.value.set(TUN.x0 + 0.02, yLo, -zb); u.uBMax.value.set(TUN.x1 - 0.02, yHi, zb);
    sheet.scale.set(u.uBMax.value.x - u.uBMin.value.x, yHi - yLo, 2 * zb);
    sheet.position.set(0.5 * (u.uBMin.value.x + u.uBMax.value.x), 0.5 * (yLo + yHi), 0);
    const base = mode === 'high' ? 56 : mode === 'mid' ? 30 : 18;
    u.uSteps.value = cfg.steps > 0 ? Math.min(96, cfg.steps) : Math.round(Math.max(12, base * Math.min(1, 0.4 + 0.6 * qs)));
    sc.camera.getWorldPosition(camPos);
    col.set(HEX[view.smokeColor] || HEX.white); u.uTint.value.set(col.r, col.g, col.b);
    u.uMulti.value = view.smokeColor === 'multi' ? 1 : 0;
    u.uOpacity.value = fade * (0.5 + 0.5 * view.density); u.uGain.value = 1.15 + 0.5 * view.density;
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
    if (Z[0] <= 0.001) { if (mesh.visible) mesh.visible = false; if (sheet.visible) sheet.visible = false; if (flatSheet.visible) flatSheet.visible = false; return; }
    if (plane && view.rake !== 'grid') {             // laser sheet: the solver's dye field
      if (mesh.visible) { mesh.visible = false; nL = 0; }
      updateSheet(view, Z[0], dt);
      return;
    }
    if (sheet.visible) sheet.visible = false;
    if (flatSheet.visible) flatSheet.visible = false;
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
  return ctx.smoke = {
    object: mesh, cfg, update, reset: () => { if (nL) reset(); },
    dispose() { mesh.parent && mesh.parent.remove(mesh); mesh.geometry.dispose(); material.dispose(); profile.dispose(); vMat.dispose(); noise.dispose(); depthMat.dispose(); if (depthRT) depthRT.dispose(); sheet.parent && sheet.parent.remove(sheet); flatSheet.parent && flatSheet.parent.remove(flatSheet); flatSheet.geometry.dispose(); dMat.dispose(); },
    // exposed for tests
    _debug: () => ({ P, cnt, head, N, L, nL }),
  };
}

export default { init };
