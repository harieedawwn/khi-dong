// P6 — particles.js: fine particles coloured by local speed |u|/U (SPEC §8 map), one draw call.
// Round soft points sized in world units; seeded PRNG; no per-frame allocations.
import * as THREE from 'three';

const COUNTS = { low: 3000, high: 12000 };
const X0 = -3, X1 = 3, YH = 0.8, ZH = 1.2;
const SIZE = 0.011;            // point diameter in metres
const MIN_PX = 1.6;
const FADE_S = 0.25;
const BOX_X = 1.15, BOX_Y = 0.95;
const STOPS = ['#24364F', '#2F7F8C', '#8CC084', '#F4E3A1']; // |u|/U = 0, 0.53, 1.07, 1.6

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERT = /* glsl */`
attribute float aSpeed;
uniform float uScale, uSize, uMinPx;
uniform vec3 uC0, uC1, uC2, uC3;
varying vec3 vCol;
varying float vA;
vec3 ramp(float t){
  float f = clamp(t / 1.6, 0.0, 1.0) * 3.0;
  if (f < 1.0) return mix(uC0, uC1, f);
  if (f < 2.0) return mix(uC1, uC2, f - 1.0);
  return mix(uC2, uC3, f - 2.0);
}
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = uSize * uScale / max(-mv.z, 0.05);
  gl_PointSize = max(px, uMinPx);
  vA = min(px / uMinPx, 1.0) * smoothstep(-3.0, -2.75, position.x) * (1.0 - smoothstep(2.6, 3.0, position.x));
  vCol = ramp(aSpeed);
}`;
const FRAG = /* glsl */`
uniform float uOpacity;
varying vec3 vCol;
varying float vA;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.5, 1.0, r)) * vA * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol, a);
  #include <colorspace_fragment>
}`;

function makeSampler(flow) {
  const out = [0, 0, 0]; out.x = out.y = out.z = NaN;
  let mode = -1;
  const s = { ux: 0, uy: 0, uz: 0, at(x, y, z) {
    if (mode < 0) {
      out[0] = out[1] = out[2] = NaN;
      flow.sample(x, y, z, out);
      mode = Number.isFinite(out.x) ? 1 : 0;
    }
    flow.sample(x, y, z, out);
    if (mode === 1) { s.ux = out.x; s.uy = out.y; s.uz = out.z; }
    else { s.ux = out[0]; s.uy = out[1]; s.uz = out[2]; }
  } };
  return s;
}

export function init(ctx) {
  const { state, flow } = ctx, sc = ctx.scene;
  const sampler = makeSampler(flow);
  const c = [0, 1, 2, 3].map((i) => new THREE.Color(STOPS[i]));
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uScale: { value: 800 }, uSize: { value: SIZE }, uMinPx: { value: MIN_PX }, uOpacity: { value: 1 },
      uC0: { value: new THREE.Vector3(c[0].r, c[0].g, c[0].b) }, uC1: { value: new THREE.Vector3(c[1].r, c[1].g, c[1].b) },
      uC2: { value: new THREE.Vector3(c[2].r, c[2].g, c[2].b) }, uC3: { value: new THREE.Vector3(c[3].r, c[3].g, c[3].b) },
    },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(new THREE.BufferGeometry(), material);
  points.frustumCulled = false; points.visible = false; points.renderOrder = 4;
  (sc.root || sc.scene).add(points);

  const UV = new Float64Array(1); UV[0] = Math.min(4, 0.55 * Math.pow(state.get().U || 20, 0.45));
  state.on('results', (r) => { if (r && r.Uvis > 0) UV[0] = r.Uvis; });

  let tierName = '', N = 0, pos, spd, age, posAttr, spdAttr;
  const Z = new Float64Array(1);       // Z[0] = fade (no heap boxing per frame)
  // seeded random numbers from a pre-generated table: deterministic and allocation-free in the frame loop
  const TAB = new Float32Array(1 << 17); { const g = mulberry32(0xC0FFEE); for (let i = 0; i < TAB.length; i++) TAB[i] = g(); }
  let ri = 0;
  const rng = () => TAB[(ri++) & 131071];

  function spawn(i) {                      // uniform over the inlet plane
    const j = i * 3;
    pos[j] = X0; pos[j + 1] = (rng() * 2 - 1) * YH; pos[j + 2] = (rng() * 2 - 1) * ZH;
    age[i] = 0;
  }
  function alloc(t) {
    tierName = t === 'high' ? 'high' : 'low'; N = COUNTS[tierName];
    pos = new Float32Array(N * 3); spd = new Float32Array(N); age = new Float32Array(N);
    ri = N;
    for (let i = 0; i < N; i++) {          // start already spread through the tunnel
      const j = i * 3;
      pos[j] = X0 + rng() * (X1 - X0); pos[j + 1] = (rng() * 2 - 1) * YH; pos[j + 2] = (rng() * 2 - 1) * ZH;
      age[i] = rng() * 3; spd[i] = 1;
    }
    const g = new THREE.BufferGeometry();
    posAttr = new THREE.BufferAttribute(pos, 3); spdAttr = new THREE.BufferAttribute(spd, 1);
    posAttr.setUsage(THREE.DynamicDrawUsage); spdAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', posAttr); g.setAttribute('aSpeed', spdAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 12);
    const old = points.geometry; points.geometry = g; if (old) old.dispose();
  }

  function update(dt) {
    dt = dt > 0.05 ? 0.05 : dt < 0 ? 0 : dt;
    const st = state.get();
    if ((st.tier === 'high' ? 'high' : 'low') !== tierName) alloc(st.tier);
    const target = st.view.flow === 'particles' ? 1 : 0, step = dt / FADE_S;
    const df = target - Z[0]; Z[0] += df > step ? step : df < -step ? -step : df;
    if (Z[0] <= 0.001) { if (points.visible) points.visible = false; return; }
    points.visible = true;
    material.uniforms.uOpacity.value = Z[0] * 0.9;
    const cam = sc.camera, H = (sc.renderer && sc.renderer.domElement && sc.renderer.domElement.height) || 800;
    // perspective cameras only (the app uses one): pixels per metre at distance 1
    material.uniforms.uScale.value = H / (2 * Math.tan(cam.fov * Math.PI / 360));
    if (!(UV[0] > 0)) return;

    const U = UV[0], invU = 1 / U, S = sampler;
    let nsub = Math.ceil(dt * U * 1.6 / 0.08); nsub = nsub < 1 ? 1 : nsub > 3 ? 3 : nsub;
    const h = dt / nsub, maxAge = 2.2 * (X1 - X0) / U;
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      let x = pos[j], y = pos[j + 1], z = pos[j + 2];
      for (let s = 0; s < nsub; s++) {       // midpoint step
        S.at(x, y, z);
        S.at(x + 0.5 * h * S.ux, y + 0.5 * h * S.uy, z + 0.5 * h * S.uz);
        x += h * S.ux; y += h * S.uy; z += h * S.uz;
      }
      spd[i] = Math.sqrt(S.ux * S.ux + S.uy * S.uy + S.uz * S.uz) * invU;
      age[i] += dt;
      let dead = x > X1 || age[i] > maxAge || y > YH || y < -YH || z > ZH || z < -ZH;
      if (!dead && x > -BOX_X && x < BOX_X && y > -BOX_Y && y < BOX_Y && flow.sdf(x, y, z) < 0) dead = true;
      if (dead) { spawn(i); spd[i] = 1; }
      else { pos[j] = x; pos[j + 1] = y; pos[j + 2] = z; }
    }
    posAttr.needsUpdate = true; spdAttr.needsUpdate = true;
  }

  alloc(state.get().tier);
  return {
    object: points, update,
    dispose() { points.parent && points.parent.remove(points); points.geometry.dispose(); material.dispose(); },
    _debug: () => ({ pos, spd, N }),
  };
}

export default { init };
