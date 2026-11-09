// P5 — model view: tone colours, heatmaps, animated swap, spinning parts, force arrows.
// init(ctx) -> { setModel(model), applyHeatmap(mode, fields), setForces(res), update(dt) }
import * as THREE from 'three';
import { ease } from './scene.js';

const DEG = Math.PI / 180;
const TONE_HEX = [0xE9E6DF, 0xB9BEC4, 0x2B2F35];           // SPEC §8 model tones
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const TONE = TONE_HEX.map(lin);
const PRESS = [0x1F4E9C, 0x5AA9D6, 0xF2EFE8, 0xF2B33D, 0xC62828].map(lin);   // Cp -1.5 .. Cp_max
const FRIC = [0x2B2F35, 0x8C5A1E, 0xF2B33D, 0xFFF1C2].map(lin);              // friction low .. high
const CP_MIN = -1.5;

const SWAP_OUT = 0.30, SWAP_IN = 0.35, SLIDE = 1.5;          // seconds / metres
const HEAT_TAU = 0.065;                                       // ~200 ms to settle
const ARROW_COL = { drag: 0xD98E04, lift: 0x1E9E74 };
const ARROW_MAX = 0.6, F0 = 0.01, FS = 200;                   // arrow length = ARROW_MAX*ln(1+F/F0)/ln(1+FS/F0)
const ARROW_NORM = 1 / Math.log(1 + FS / F0);
const HEAD_L = 0.09, HEAD_R = 0.032, SHAFT_R = 0.011;
const ROOM_TOP = 0.8, FLOOR = -0.8;

function mixStops(stops, a, f, out, o) {
  const p = stops[a], q = stops[a + 1];
  out[o] = p[0] + (q[0] - p[0]) * f; out[o + 1] = p[1] + (q[1] - p[1]) * f; out[o + 2] = p[2] + (q[2] - p[2]) * f;
}
export function pressureRGB(cp, cpMax, out, o) {
  if (!(cp === cp)) cp = 0;
  const h = cpMax * 0.5;
  if (cp <= CP_MIN) mixStops(PRESS, 0, 0, out, o);
  else if (cp < -0.75) mixStops(PRESS, 0, (cp - CP_MIN) / 0.75, out, o);
  else if (cp < 0) mixStops(PRESS, 1, (cp + 0.75) / 0.75, out, o);
  else if (cp < h) mixStops(PRESS, 2, cp / h, out, o);
  else if (cp < cpMax) mixStops(PRESS, 3, (cp - h) / h, out, o);
  else mixStops(PRESS, 3, 1, out, o);
}
export function frictionRGB(t, out, o) {
  if (!(t === t) || t < 0) t = 0; if (t > 1) t = 1;
  const x = t * 3, a = Math.min(2, Math.floor(x));
  mixStops(FRIC, a, x - a, out, o);
}

function toAxis(a, out) {
  if (typeof a === 'string') { out.set(a === 'x' ? 1 : 0, a === 'y' ? 1 : 0, a === 'z' ? 1 : 0); }
  else if (Array.isArray(a)) out.set(a[0] || 0, a[1] || 0, a[2] || 0);
  else if (a && typeof a === 'object') out.set(a.x || 0, a.y || 0, a.z || 0);
  else out.set(1, 0, 0);
  if (out.lengthSq() < 1e-9) out.set(1, 0, 0);
  return out.normalize();
}

export function init(ctx) {
  const { state, scene } = ctx;
  const root = scene.root;
  const tmpRGB = [0, 0, 0];
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Vector3();

  /* ------------------------------------------------------------ materials */
  function makeMaterial() {
    const heat = { value: 0 };
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.02, transparent: true, opacity: 1 });
    m.userData.heat = heat;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uHeat = heat;
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform float uHeat;\nvoid main() {')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * uHeat;');
    };
    m.customProgramCacheKey = () => 'p5model-heat';
    return m;
  }

  /* ------------------------------------------------------------ build view */
  function buildView(model) {
    const src = model.geometry, pos = src.attributes.position, n = pos.count;
    const tone = src.attributes.tone, c0 = src.attributes.color;
    const base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (tone) { const t = TONE[Math.max(0, Math.min(2, Math.round(tone.getX(i))))]; base[3 * i] = t[0]; base[3 * i + 1] = t[1]; base[3 * i + 2] = t[2]; }
      else if (c0) { base[3 * i] = c0.getX(i); base[3 * i + 1] = c0.getY(i); base[3 * i + 2] = c0.getZ(i); }
      else { base[3 * i] = TONE[0][0]; base[3 * i + 1] = TONE[0][1]; base[3 * i + 2] = TONE[0][2]; }
    }
    const col = new Float32Array(base);
    const colAttr = new THREE.BufferAttribute(col, 3); colAttr.setUsage(THREE.DynamicDrawUsage);
    const srcIdx = src.index ? src.index.array : null, triN = srcIdx ? srcIdx.length / 3 : n / 3;
    const vi = (k) => (srcIdx ? srcIdx[k] : k);

    // bounding box (model frame)
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }

    // split spinning parts out of the static mesh (vertex ranges follow part order)
    const owner = new Int16Array(n).fill(-1), spinParts = [];
    const parts = model.parts || [];
    let off = 0, okRanges = true;
    for (let pi = 0; pi < parts.length; pi++) {
      const g = parts[pi].geometry; if (!g) { okRanges = false; break; }
      const c = g.attributes.position.count;
      if (parts[pi].spin) { spinParts.push({ part: parts[pi], lo: off, hi: off + c, id: spinParts.length }); for (let v = off; v < off + c; v++) owner[v] = spinParts.length - 1; }
      off += c;
    }
    if (!okRanges || off !== n) spinParts.length = 0;

    const staticIdx = [], spinIdx = spinParts.map(() => []);
    for (let t = 0; t < triN; t++) {
      const a = vi(3 * t), b = vi(3 * t + 1), c = vi(3 * t + 2), ow = spinParts.length ? owner[a] : -1;
      const dst = ow >= 0 ? spinIdx[ow] : staticIdx; dst.push(a, b, c);
    }
    const mat = makeMaterial();
    const group = new THREE.Group();           // sw: slide + grow
    const rot = new THREE.Group();             // alpha rotation about the origin
    group.add(rot);
    const geos = [], spinners = [];
    const mk = (idx) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', pos); if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal);
      g.setAttribute('color', colAttr); g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
      const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = false; m.layers.enable(1); m.frustumCulled = false;
      geos.push(g); rot.add(m); return m;
    };
    mk(staticIdx);
    spinParts.forEach((sp, i) => {
      const m = mk(spinIdx[i]);
      let a0 = 1e9, b0 = 1e9, c0z = 1e9, a1 = -1e9, b1 = -1e9, c1 = -1e9;
      for (let v = sp.lo; v < sp.hi; v++) {
        const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        if (x < a0) a0 = x; if (x > a1) a1 = x; if (y < b0) b0 = y; if (y > b1) b1 = y; if (z < c0z) c0z = z; if (z > c1) c1 = z;
      }
      const spin = sp.part.spin || {};
      m.matrixAutoUpdate = false;
      spinners.push({ mesh: m, axis: toAxis(spin.axis, new THREE.Vector3()), rate: +spin.rate || 0, pivot: new THREE.Vector3((a0 + a1) / 2, (b0 + b1) / 2, (c0z + c1) / 2), ang: 0 });
    });

    const L = x1 - x0, H = y1 - y0;
    return {
      model, group, rot, mat, geos, colAttr, col, base, tgt: base, n, spinners,
      bb: { x0, y0, z0, x1, y1, z1 }, radius: 0.5 * Math.max(L, H, 0.1),
      t: 0, phase: 'in', slide: 0, active: false, heatT: 0,
    };
  }

  /* -------------------------------------------------------- view bookkeeping */
  let cur = null; const leaving = [];
  let heatMode = 'off', lastFields = null, ext = { xmax: 0.2, ymax: 0.15, ymin: -0.15 }, extAlpha = 1e9;

  function computeExtents(alphaDeg) {
    if (!cur) return;
    const a = -alphaDeg * DEG, cs = Math.cos(a), sn = Math.sin(a), b = cur.bb;
    let xm = -1e9, ym = -1e9, yn = 1e9;
    for (let i = 0; i < 4; i++) {
      const x = (i & 1) ? b.x1 : b.x0, y = (i & 2) ? b.y1 : b.y0;
      const wx = x * cs - y * sn, wy = x * sn + y * cs;
      if (wx > xm) xm = wx; if (wy > ym) ym = wy; if (wy < yn) yn = wy;
    }
    ext.xmax = xm; ext.ymax = ym; ext.ymin = yn; extAlpha = alphaDeg;
    scene.setStrutTop(yn + 0.03);
  }

  function setModel(model) {
    if (!model || !model.geometry) return;
    const v = buildView(model);
    if (cur) { cur.phase = 'out'; cur.t = 0; leaving.push(cur); }
    cur = v; cur.phase = 'in'; cur.t = 0;
    cur.group.scale.setScalar(0.001);
    root.add(cur.group);
    cur.rot.rotation.z = -state.get().alphaDeg * DEG;
    extAlpha = 1e9; computeExtents(state.get().alphaDeg);
    scene.setFocusRadius(cur.radius * (model.spanning ? 0.8 : 1));
    applyHeatmap(heatMode, null);          // new model starts neutral; main supplies fields when baked
    arrowsReset = true;
  }

  function dispose(v) {
    root.remove(v.group);
    for (const g of v.geos) g.dispose();
    v.mat.dispose();
  }

  /* --------------------------------------------------------------- heatmap */
  function applyHeatmap(mode, fields) {
    heatMode = mode || 'off'; lastFields = fields;
    if (!cur) return;
    const n = cur.n; let tgt = cur.base, mx = 0;
    if (heatMode === 'pressure' && fields && fields.cp && fields.cp.length === n) {
      const cp = fields.cp, cpMax = Math.max(0.5, Math.min(2, fields.cpRange ? fields.cpRange[1] : 1));
      if (tgt === cur.base || tgt.length !== n * 3) tgt = cur.tgtBuf || (cur.tgtBuf = new Float32Array(n * 3));
      for (let i = 0; i < n; i++) { pressureRGB(cp[i], cpMax, tmpRGB, 0); tgt[3 * i] = tmpRGB[0]; tgt[3 * i + 1] = tmpRGB[1]; tgt[3 * i + 2] = tmpRGB[2]; }
      mx = 1;
    } else if (heatMode === 'friction' && fields && fields.tau && fields.tau.length === n) {
      const tau = fields.tau; let tm = 1e-12;
      for (let i = 0; i < n; i++) { const t = Math.abs(tau[i]); if (t > tm) tm = t; }
      tgt = cur.tgtBuf || (cur.tgtBuf = new Float32Array(n * 3));
      for (let i = 0; i < n; i++) { frictionRGB(Math.pow(Math.abs(tau[i]) / tm, 0.75), tmpRGB, 0); tgt[3 * i] = tmpRGB[0]; tgt[3 * i + 1] = tmpRGB[1]; tgt[3 * i + 2] = tmpRGB[2]; }
      mx = 1;
    }
    cur.tgt = tgt; cur.heatT = mx ? 0.6 : 0; cur.active = true;
  }

  /* ---------------------------------------------------------- force arrows */
  const arrowGroup = new THREE.Group(); arrowGroup.visible = false; root.add(arrowGroup);
  function makeArrow(hex) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.4, metalness: 0.1, emissive: hex, emissiveIntensity: 0.25 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT_R, SHAFT_R, 1, 14, 1).translate(0, 0.5, 0), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(HEAD_R, HEAD_L, 18, 1).translate(0, HEAD_L / 2, 0), mat);
    g.add(shaft, head); arrowGroup.add(g);
    return { g, shaft, head, len: 0, tgt: 0 };
  }
  function makeLabel(textMain, textSub, hex) {
    const W = 320, Hh = 100, cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const draw = () => {
      const c = cv.getContext('2d'); c.clearRect(0, 0, W, Hh);
      c.fillStyle = 'rgba(22,24,27,0.82)'; c.beginPath(); c.roundRect ? c.roundRect(2, 12, W - 4, Hh - 24, 14) : c.rect(2, 12, W - 4, Hh - 24); c.fill();
      c.fillStyle = '#' + hex.toString(16).padStart(6, '0'); c.fillRect(2, 12, 8, Hh - 24);
      c.textBaseline = 'alphabetic';
      c.font = '700 56px "Barlow Condensed","Be Vietnam Pro",sans-serif'; c.fillText(textMain, 28, 66);
      const w = c.measureText(textMain).width;
      c.font = '600 36px "Barlow Condensed","Be Vietnam Pro",sans-serif'; c.fillText(textSub, 28 + w + 3, 74);
      tex.needsUpdate = true;
    };
    draw(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.scale.set(0.3, 0.3 * Hh / W, 1); sp.renderOrder = 20; arrowGroup.add(sp); return sp;
  }
  const aD = makeArrow(ARROW_COL.drag), aL = makeArrow(ARROW_COL.lift);
  const lD = makeLabel('F', '_cản', ARROW_COL.drag), lL = makeLabel('F', '_nâng', ARROW_COL.lift);
  let forcesOn = true, arrowsReset = true, liftSign = 1, tgtD = 0, tgtL = 0;
  const arrowLen = (F) => { F = Math.abs(F); return F > 0 && F === F ? ARROW_MAX * Math.log(1 + F / F0) * ARROW_NORM : 0; };

  function setForces(res) {
    forcesOn = state.get().view.forces !== false;
    if (!res) { tgtD = tgtL = 0; return; }
    tgtD = arrowLen(res.FD); tgtL = arrowLen(res.FL); liftSign = res.FL < 0 ? -1 : 1;
  }
  function placeArrow(a, len, label, baseX, baseY, rotZ, labOffX, labOffY) {
    const show = len > 0.02;
    a.g.visible = show; label.visible = show;
    if (!show) return;
    const headL = Math.min(HEAD_L, len * 0.45);
    a.shaft.scale.y = Math.max(0.001, len - headL);
    a.head.position.y = len - headL; a.head.scale.set(headL / HEAD_L > 0.5 ? 1 : 0.7, headL / HEAD_L, headL / HEAD_L > 0.5 ? 1 : 0.7);
    a.g.position.set(baseX, baseY, 0); a.g.rotation.z = rotZ;
    const tipX = baseX - Math.sin(rotZ) * len, tipY = baseY + Math.cos(rotZ) * len;
    label.position.set(tipX + labOffX, tipY + labOffY, 0);
  }

  /* ----------------------------------------------------------------- update */
  function update(dt) {
    const s = state.get(), alpha = s.alphaDeg || 0;
    const uvis = ctx.uvis || 0;

    // alpha rotation + strut/arrow anchors
    if (cur) {
      cur.rot.rotation.z = -alpha * DEG;
      if (alpha !== extAlpha) computeExtents(alpha);
    }

    // entering model grows on the strut, leaving ones slide downstream and fade
    if (cur && cur.phase === 'in') {
      cur.t += dt; const k = Math.min(1, cur.t / SWAP_IN), e = ease(k);
      const sc = 0.001 + 0.999 * e;
      cur.group.scale.setScalar(sc); cur.group.position.set(0, ext.ymin * (1 - sc), 0);
      if (k >= 1) { cur.phase = 'idle'; cur.group.scale.setScalar(1); cur.group.position.set(0, 0, 0); }
    }
    for (let i = leaving.length - 1; i >= 0; i--) {
      const v = leaving[i]; v.t += dt; const k = Math.min(1, v.t / SWAP_OUT), e = ease(k);
      v.group.position.x = SLIDE * e; v.mat.opacity = 1 - e;
      if (k >= 1) { dispose(v); leaving.splice(i, 1); }
    }

    // heat transition (per vertex, ~200 ms)
    if (cur && cur.active) {
      const k = 1 - Math.exp(-dt / HEAT_TAU), c = cur.col, t = cur.tgt, m = cur.n * 3;
      let maxd = 0;
      for (let i = 0; i < m; i++) { const d = t[i] - c[i]; c[i] += d * k; const ad = d < 0 ? -d : d; if (ad > maxd) maxd = ad; }
      cur.colAttr.needsUpdate = true;
      const hv = cur.mat.userData.heat, dh = cur.heatT - hv.value; hv.value += dh * k;
      if (maxd < 0.003 && Math.abs(dh) < 0.01) { c.set(t); hv.value = cur.heatT; cur.active = false; }
    }

    // spinning parts (rotor, wheels, propeller): speed follows the slowed visual wind
    if (cur) {
      const f = Math.min(1, uvis / 2);
      for (const sp of cur.spinners) {
        sp.ang += Math.max(-25, Math.min(25, sp.rate)) * f * dt;
        _m.makeRotationAxis(sp.axis, sp.ang);
        _p.copy(sp.pivot).applyMatrix4(_m); _t.copy(sp.pivot).sub(_p);
        sp.mesh.matrix.copy(_m).setPosition(_t); sp.mesh.matrixWorldNeedsUpdate = true;
      }
    }

    // force arrows
    arrowGroup.visible = forcesOn && !!cur;
    if (arrowGroup.visible) {
      const kk = arrowsReset ? 1 : 1 - Math.exp(-dt / 0.12); arrowsReset = false;
      aD.len += (tgtD - aD.len) * kk; aL.len += (tgtL - aL.len) * kk;
      const up = liftSign >= 0;
      const room = up ? ROOM_TOP - 0.04 - (ext.ymax + 0.05) : (ext.ymin - 0.05) - (FLOOR + 0.04);
      const lenL = Math.min(aL.len, Math.max(0.03, room));
      placeArrow(aD, aD.len, lD, ext.xmax + 0.05, 0, -Math.PI / 2, 0.02, 0.07);
      placeArrow(aL, lenL, lL, 0, up ? ext.ymax + 0.05 : ext.ymin - 0.05, up ? 0 : Math.PI, 0.17, up ? 0.03 : -0.03);
    }
  }

  return { setModel, applyHeatmap, setForces, update, get view() { return cur; }, get fields() { return lastFields; } };
}
