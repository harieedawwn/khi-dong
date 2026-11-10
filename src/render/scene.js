// P5 — 3D stage: wind tunnel, hall, lights, camera, thumbnails, render loop.
// createScene({parent?, tier?}) -> scene API (SPEC §5). Procedural only.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries as mergeRaw } from 'three/addons/utils/BufferGeometryUtils.js';

// mergeGeometries returns null when index/attribute sets differ; normalise first, and fail loudly with the block name.
function mergeGeometries(list, useGroups, name = 'geometry') {
  if (!list.length) throw new Error('mergeGeometries: danh sách rỗng (' + name + ')');
  const anyIdx = list.some((g) => g.index), allIdx = list.every((g) => g.index);
  const gs = (anyIdx && !allIdx) ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list;
  const common = Object.keys(gs[0].attributes).filter((k) => gs.every((g) => g.attributes[k]));
  for (const g of gs) for (const k of Object.keys(g.attributes)) if (!common.includes(k)) g.deleteAttribute(k);
  for (const g of gs) g.morphAttributes = {};
  const m = mergeRaw(gs, useGroups);
  if (!m) throw new Error('mergeGeometries thất bại: ' + name + ' [' + common.join(',') + ']');
  return m;
}
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const DEG = Math.PI / 180;
// Test section (SPEC §3)
const X0 = -3, X1 = 3, YH = 0.8, ZH = 1.2;
const FLOOR_Y = -YH;            // top of the floor panel
const HALL_Y = -2.0;            // hall floor
const CAM_MIN_Y = FLOOR_Y + 0.06; // camera never goes below the tunnel floor
const HALL = 0x16181B;
const BALANCE_TOP = -1.05;      // top of the force-balance box
const DPR_CAP = { low: 1.5, high: 2 };

function ensureStage() {
  let el = document.getElementById('stage');
  if (!el) {
    el = document.createElement('div');
    el.id = 'stage';
    el.style.cssText = 'position:fixed;inset:0;z-index:0;overflow:hidden;';
    document.body.insertBefore(el, document.body.firstChild);
  }
  return el;
}

// cubic-bezier(.2,.7,.2,1) solver (SPEC §8 easing)
function makeBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t;
  const Y = (t) => ((ay * t + by) * t + cy) * t;
  const dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) { const e = X(t) - x; const d = dX(t); if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1;
    if (Math.abs(X(t) - x) > 1e-4) { t = x; for (let i = 0; i < 24; i++) { if (X(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
    return Y(t);
  };
}
export const ease = makeBezier(0.2, 0.7, 0.2, 1);

export function createScene(opts = {}) {
  let tier = opts.tier === 'high' ? 'high' : 'low';
  const parent = opts.parent || ensureStage();

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(HALL, 1);
  renderer.toneMapping = THREE.NoToneMapping;          // exact palette (SPEC §8)
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Ống khí động 3D');
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  parent.appendChild(canvas);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(HALL);
  scene.fog = new THREE.Fog(HALL, 12, 38);   // distances follow the camera distance (stepCamera), so the model is never fogged
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
  const root = new THREE.Group(); root.name = 'modelRoot';   // modelview adds model + arrows here
  scene.add(root);

  /* ---------------------------------------------------------------- lights */
  const hemi = new THREE.HemisphereLight(0xB4C6D8, 0x2A2E34, 0.95);
  const key = new THREE.DirectionalLight(0xFFF3E4, 2.4);
  key.position.set(-2.5, 5.5, 4.2);
  key.target.position.set(0, -0.3, 0);
  const sc = key.shadow.camera;
  sc.left = -3.8; sc.right = 3.8; sc.top = 2.0; sc.bottom = -2.0; sc.near = 1; sc.far = 14;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
  const rim = new THREE.DirectionalLight(0xC9DAFF, 1.5);   // from behind: edge light, lights the smoke
  rim.position.set(3.5, 2.6, -5.5);
  rim.target.position.set(0, 0, 0);
  scene.add(hemi, key, key.target, rim, rim.target);

  /* --------------------------------------------------------------- helpers */
  const steelGeos = [];
  const tmpC = new THREE.Color();
  function paint(g, hex) {
    tmpC.set(hex);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[3 * i] = tmpC.r; a[3 * i + 1] = tmpC.g; a[3 * i + 2] = tmpC.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  }
  function box(w, h, d, x, y, z, hex, r = 0.006) {
    const rr = Math.min(r, w * 0.49, h * 0.49, d * 0.49);
    const g = new RoundedBoxGeometry(w, h, d, 2, rr);
    g.translate(x, y, z); paint(g, hex); steelGeos.push(g);
  }
  function cyl(rt, rb, h, seg, x, y, z, hex, axis = 'y') {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z); paint(g, hex); steelGeos.push(g);
  }
  function bolt(x, y, z, axis) { cyl(0.014, 0.014, 0.01, 6, x, y, z, 0xB4BBC2, axis); }

  /* ---------------------------------------------- steel frame (one draw call) */
  const FRAME = 0x6A727C, FLANGE = 0x8A929B, LEG = 0x474E56, DARK = 0x2B2F35;
  const BY = YH + 0.07, BZ = ZH + 0.07;                     // outer rib extents
  const RIB_X = [-3, -2, -1, 1, 2, 3];                      // no rib at 0: keeps the model visible from above
  for (const x of RIB_X) {
    box(0.07, 0.07, 2 * BZ, x, YH + 0.035 + 0.004, 0, FRAME);                      // top bar
    box(0.07, 0.07, 2 * BZ, x, FLOOR_Y - 0.062 - 0.035, 0, FRAME);                 // bottom bar (under floor)
    const sideH = (YH + 0.07) - (FLOOR_Y - 0.062 - 0.07) ;
    const sideY = (YH + 0.07 + FLOOR_Y - 0.062 - 0.07) / 2;
    for (const s of [-1, 1]) box(0.07, sideH, 0.07, x, sideY, s * (ZH + 0.035 + 0.004), FRAME); // side bars
    // flanges on both faces + bolts
    for (const s of [-1, 1]) {
      const fx = x + s * 0.045;
      box(0.02, 0.05, 2 * BZ + 0.1, fx, YH + 0.035 + 0.004, 0, FLANGE, 0.004);
      box(0.02, 0.05, 2 * BZ + 0.1, fx, FLOOR_Y - 0.062 - 0.035, 0, FLANGE, 0.004);
      for (const t of [-1, 1]) box(0.02, sideH, 0.05, fx, sideY, t * (ZH + 0.035 + 0.004), FLANGE, 0.004);
      for (let k = -3; k <= 3; k++) {
        const bz = k * 0.38;
        bolt(fx + s * 0.012, YH + 0.039, bz, 'x'); bolt(fx + s * 0.012, FLOOR_Y - 0.097, bz, 'x');
      }
      for (let k = 0; k < 4; k++) {
        const by = sideY - sideH / 2 + 0.14 + k * (sideH - 0.28) / 3;
        for (const t of [-1, 1]) bolt(fx + s * 0.012, by, t * (ZH + 0.039), 'x');
      }
    }
  }
  // long rails beside the glass corners (outside the glass, no overlap with it)
  for (const sy of [1, -1]) for (const sz of [-1, 1]) {
    const y = sy > 0 ? YH + 0.03 + 0.004 : FLOOR_Y - 0.062 - 0.035;
    box(6 + 0.02, 0.05, 0.05, 0, y, sz * (ZH + 0.03 + 0.004), FRAME, 0.005);
  }
  // under-floor beams, legs, feet, cross members
  for (const sz of [-1, 1]) box(6.1, 0.08, 0.1, 0, FLOOR_Y - 0.062 - 0.075, sz * (ZH + 0.02), LEG);
  for (const lx of [-1.6, 1.6]) for (const sz of [-1, 1]) {
    const zc = sz * (ZH + 0.02);
    box(0.1, 1.0, 0.1, lx, (-0.98 + HALL_Y) / 2 + 0.01, zc, LEG, 0.008);
    box(0.24, 0.02, 0.24, lx, HALL_Y + 0.01, zc, FRAME, 0.004);
    for (const bx of [-0.07, 0.07]) for (const bz of [-0.07, 0.07]) bolt(lx + bx, HALL_Y + 0.025, zc + bz, 'y');
  }
  for (const sz of [-1, 1]) box(3.3, 0.07, 0.07, 0, -1.3, sz * (ZH + 0.02), LEG);
  for (const lx of [-1.6, 1.6]) box(0.07, 0.07, 2 * ZH + 0.04, lx, -1.3, 0, LEG);

  // force-balance box under the floor + load cells
  box(0.9, 0.5, 0.6, 0, BALANCE_TOP - 0.25, 0, DARK, 0.02);
  box(0.92, 0.03, 0.62, 0, BALANCE_TOP + 0.004, 0, 0x555D66, 0.01);
  for (const bx of [-0.3, 0.3]) for (const bz of [-0.2, 0.2]) {
    cyl(0.03, 0.03, 0.1, 14, bx, BALANCE_TOP + 0.06, bz, 0x7E96AE);
  }
  box(0.04, 0.2, 0.3, 0.47, BALANCE_TOP - 0.25, 0, 0x555D66, 0.008);
  cyl(0.012, 0.012, 0.7, 8, 0.6, BALANCE_TOP - 0.55, 0.2, 0x1B1D21);   // cable
  // strut mounting flange on the floor
  cyl(0.075, 0.075, 0.012, 24, 0, FLOOR_Y + 0.004, 0, 0x555D66);
  cyl(0.06, 0.06, 0.012, 24, 0, FLOOR_Y + 0.014, 0, 0x7E868F);

  // smoke rake at x -2.6: vertical nozzle comb + horizontal feeder tube through the wall
  const RX = -2.6;
  cyl(0.011, 0.011, 1.3, 14, RX - 0.045, 0.0, 0, DARK);                       // comb body
  {
    const g = new THREE.CylinderGeometry(0.02, 0.02, ZH + 0.18, 16); g.rotateX(Math.PI / 2);
    g.translate(RX - 0.045, 0.66, -(ZH + 0.18) / 2); paint(g, DARK); steelGeos.push(g);
  }
  box(0.12, 0.12, 0.12, RX - 0.045, 0.66, -(ZH + 0.12), 0x555D66, 0.012);     // fitting outside the glass
  box(0.05, 0.05, 0.05, RX - 0.045, 0.66, 0, DARK, 0.01);                      // elbow
  for (let i = 0; i < 25; i++) {
    const y = -0.6 + i * 0.05;
    cyl(0.0042, 0.0056, 0.05, 8, RX - 0.025, y, 0, 0xB08D57, 'x');           // nozzle tips end at x = RX
  }

  /* steel material + merge */
  const steelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.42 });
  const steel = new THREE.Mesh(mergeGeometries(steelGeos, false, 'steel'), steelMat);
  steel.name = 'frame';
  scene.add(steel);
  for (const g of steelGeos) g.dispose();

  /* ------------------------------------------------ contraction + diffuser */
  const K = 96;
  function ringPos(k, zz, yy, c, R, out, o, x) {
    const p = (k / K) * 4, side = Math.min(3, Math.floor(p)), f = p - side;
    let u, v;
    if (side === 0) { u = 1; v = -1 + 2 * f; } else if (side === 1) { u = 1 - 2 * f; v = 1; }
    else if (side === 2) { u = -1; v = 1 - 2 * f; } else { u = -1 + 2 * f; v = -1; }
    let z = u * zz, y = v * yy;
    if (c > 0) { const th = Math.atan2(v, u); z += (R * Math.cos(th) - z) * c; y += (R * Math.sin(th) - y) * c; }
    out[o] = x; out[o + 1] = y; out[o + 2] = z;
  }
  function loft(xa, xb, nx, fn) {
    const pos = new Float32Array((nx + 1) * K * 3), idx = [], s = { zz: 0, yy: 0, c: 0, R: 0 };
    for (let i = 0; i <= nx; i++) {
      const t = i / nx, x = xa + (xb - xa) * t; fn(t, s);
      for (let k = 0; k < K; k++) ringPos(k, s.zz, s.yy, s.c, s.R, pos, (i * K + k) * 3, x);
    }
    for (let i = 0; i < nx; i++) for (let k = 0; k < K; k++) {
      const a = i * K + k, b = i * K + (k + 1) % K, c2 = (i + 1) * K + k, d = (i + 1) * K + (k + 1) % K;
      idx.push(a, c2, b, b, c2, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  const CX0 = -6.4, CZ0 = 2.0, CY0 = 1.45;
  const sm = (t) => t * t * (3 - 2 * t);
  const contraction = loft(CX0, X0, 24, (t, s) => { const e = sm(t); s.zz = CZ0 + (ZH - CZ0) * e; s.yy = CY0 + (YH - CY0) * e; s.c = 0; });
  const R_F = 1.15, DX1 = 5.4, HX1 = 6.3;
  const dif = loft(X1, DX1, 24, (t, s) => { const e = sm(t); s.zz = ZH + (R_F - ZH) * e; s.yy = YH + (R_F - YH) * e; s.c = e; s.R = R_F; });
  const housing = loft(DX1, HX1, 4, (t, s) => { s.zz = R_F; s.yy = R_F; s.c = 1; s.R = R_F; });
  const duct = new THREE.Mesh(mergeGeometries([contraction], false, 'contraction'),
    new THREE.MeshStandardMaterial({ color: 0x7F8A96, metalness: 0.35, roughness: 0.55, side: THREE.DoubleSide }));
  const diffuser = new THREE.Mesh(mergeGeometries([dif, housing], false, 'diffuser'),
    new THREE.MeshStandardMaterial({ color: 0x7B8590, metalness: 0.35, roughness: 0.55, side: THREE.DoubleSide }));
  scene.add(duct, diffuser);
  // housing flange rings
  {
    const rg = [];
    for (const x of [DX1, HX1]) {
      const g = new THREE.TorusGeometry(R_F + 0.01, 0.035, 8, 64); g.rotateY(Math.PI / 2); g.translate(x, 0, 0); paint(g, FLANGE); rg.push(g);
    }
    const m = new THREE.Mesh(mergeGeometries(rg, false, 'rings'), steelMat); scene.add(m);
  }

  // honeycomb straightener + screens (alpha-tested textures)
  function csec(x) { const e = sm((x - CX0) / (X0 - CX0)); return [CZ0 + (ZH - CZ0) * e, CY0 + (YH - CY0) * e]; }
  function hexTexture() {
    const r = 30, w = Math.round(3 * r), h = Math.round(Math.sqrt(3) * 2 * r / 2 * 2);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.strokeStyle = '#0E1114'; g.lineWidth = 3.2; g.lineJoin = 'round';
    const hex = (cx, cy) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a); i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); g.stroke(); };
    const dy = Math.sqrt(3) * r;
    for (let ix = -1; ix <= 2; ix++) for (let iy = -1; iy <= 3; iy++) hex(ix * 1.5 * r + 0, iy * dy + (ix % 2 ? dy / 2 : 0));
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function meshTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'); g.fillStyle = '#9AA1AA'; g.fillRect(0, 0, 32, 2.4); g.fillRect(0, 0, 2.4, 32);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const hexTex = hexTexture(), meshTex = meshTexture();
  function screenPlane(x, tex, repX, repY, color) {
    const [zz, yy] = csec(x);
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(repX * zz, repY * yy);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * (zz - 0.012), 2 * (yy - 0.012)),
      new THREE.MeshStandardMaterial({ map: t, color, alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.6 }));
    m.rotation.y = Math.PI / 2; m.position.x = x; scene.add(m); return m;
  }
  screenPlane(CX0 + 0.03, hexTex, 16.7, 14.4, 0x39414A);   // hex cell r = 0.04 m
  screenPlane(CX0 + 0.11, hexTex, 16.7, 14.4, 0x39414A);
  screenPlane(CX0 + 0.55, meshTex, 33, 33, 0xFFFFFF);
  screenPlane(CX0 + 1.1, meshTex, 50, 50, 0xFFFFFF);

  /* ------------------------------------------------------- fan + nacelle */
  const fan = new THREE.Group(); fan.position.set(5.75, 0, 0);
  {
    const parts = [];
    const hub = new THREE.CylinderGeometry(0.17, 0.2, 0.34, 24); hub.rotateZ(Math.PI / 2); paint(hub, 0x444B53); parts.push(hub);
    for (let i = 0; i < 7; i++) {
      const b = new THREE.BoxGeometry(0.17, 0.9, 0.012, 1, 4, 1); b.rotateY(0.45); b.translate(0, 0.18 + 0.45, 0);
      b.rotateX(i * 2 * Math.PI / 7); paint(b, 0x363C43); parts.push(b);
    }
    for (const g of parts) { if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
    const fm = new THREE.Mesh(mergeGeometries(parts, false, 'fan'), new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide }));
    fan.add(fm);
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.8, 24).rotateZ(Math.PI / 2).translate(0.55, 0, 0),
      new THREE.MeshStandardMaterial({ color: 0x4A525B, metalness: 0.5, roughness: 0.45 }));
    scene.add(nac); nac.position.x = 5.75;
    for (const a of [0, 1, 2, 3]) { // stator struts
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, R_F, 0.03).translate(0, R_F / 2, 0), steelMat.clone());
      s.material.vertexColors = false; s.material.color.set(0x4A525B);
      s.rotation.x = a * Math.PI / 2; s.position.set(6.1, 0, 0); scene.add(s);
    }
  }
  scene.add(fan);

  /* ----------------------------------------------------- glass test section */
  {
    const bg = new THREE.BoxGeometry(X1 - X0, 2 * YH, 2 * ZH);
    const full = bg.index.array, keep = [];               // faces: px nx py ny pz nz (6 indices each); keep roof + both walls
    for (const f of [2, 4, 5]) for (let i = 0; i < 6; i++) keep.push(full[f * 6 + i]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', bg.attributes.position); g.setAttribute('normal', bg.attributes.normal); g.setIndex(keep);
    const mk = (side, op) => new THREE.MeshStandardMaterial({ color: 0xBFD8E2, metalness: 0, roughness: 0.06, transparent: true, opacity: op, side, depthWrite: false });
    const back = new THREE.Mesh(g, mk(THREE.BackSide, 0.07)); back.renderOrder = 1;
    const front = new THREE.Mesh(g, mk(THREE.FrontSide, 0.045)); front.renderOrder = 6;
    scene.add(back, front);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bg), new THREE.LineBasicMaterial({ color: 0xE6F0F4, transparent: true, opacity: 0.8, depthWrite: false }));
    edges.renderOrder = 7; scene.add(edges);
  }

  /* ------------------------------------------------------------- floors */
  function gridTexture() {
    const S = 1000, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'); g.fillStyle = '#23272D'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#313741';                                       // 0.1 m fine lines
    for (let i = 0; i < 10; i++) { const p = i * 100; g.fillRect(p - 1, 0, 2, S); g.fillRect(0, p - 1, S, 2); }
    g.fillStyle = '#5B6471';                                       // 0.5 m bold lines
    for (const p of [0, 500]) { g.fillRect(p - 2.5, 0, 5, S); g.fillRect(0, p - 2.5, S, 5); }
    g.fillRect(S - 2.5, 0, 2.5, S); g.fillRect(0, S - 2.5, S, 2.5);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const floorBody = new THREE.Mesh(new THREE.BoxGeometry(6, 0.06, 2 * ZH).translate(0, FLOOR_Y - 0.03 - 0.002, 0),
    new THREE.MeshStandardMaterial({ color: 0x2F343B, metalness: 0.3, roughness: 0.6 }));
  const fg = new THREE.PlaneGeometry(6, 2 * ZH); fg.rotateX(-Math.PI / 2); fg.translate(0, FLOOR_Y, 0);
  { const p = fg.attributes.position, uv = fg.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i)); } // 1 tile = 1 m, origin at world origin
  const floorTop = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: gridTexture(), metalness: 0.1, roughness: 0.75 }));
  floorTop.receiveShadow = true;
  scene.add(floorBody, floorTop);
  const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500).rotateX(-Math.PI / 2).translate(0, HALL_Y, 0),
    new THREE.MeshStandardMaterial({ color: 0x1C1F24, metalness: 0, roughness: 0.95 }));
  scene.add(hallFloor);

  /* -------------------------------------------------------------- strut */
  const strutGeo = new THREE.CylinderGeometry(1, 1, 1, 20).translate(0, 0.5, 0);   // unit, scaled below
  const strut = new THREE.Mesh(strutGeo, new THREE.MeshStandardMaterial({ color: 0xB6BCC3, metalness: 0.8, roughness: 0.33 }));
  strut.castShadow = true;
  scene.add(strut);
  let strutTop = 0, strutTarget = 0;
  function applyStrut() {
    const h = Math.max(0.05, strutTop - BALANCE_TOP);
    strut.scale.set(0.024, h, 0.008); strut.position.set(0, BALANCE_TOP, 0);
  }
  applyStrut();

  /* -------------------------------------------------------------- camera */
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.enablePan = false;
  controls.rotateSpeed = 0.7; controls.zoomSpeed = 0.8; controls.minDistance = 0.35; controls.maxDistance = 32;
  controls.minPolarAngle = 0.001;
  let aspect = 1, focusR = 0.4, userMoved = false, currentPreset = 'overview';
  const tanHalf = Math.tan(camera.fov * DEG / 2);
  const fit = (hw, hh) => { if (aspect < 0.8) hw = Math.min(hw, 1.5); return Math.max(hh / tanHalf, hw / (tanHalf * aspect)) * 1.08; };   // phones in portrait: frame the middle of the section
  const P = { tx: 0, ty: 0, tz: 0, dx: 0, dy: 0, dz: 1, dist: 5 };
  function preset(name, o) {
    const dir = (x, y, z, d) => { const l = Math.hypot(x, y, z); o.dx = x / l; o.dy = y / l; o.dz = z / l; o.dist = d; };
    switch (name) {
      case 'side':   o.tx = 0; o.ty = 0; o.tz = 0; dir(0, 0.04, 1, fit(3.25, 1.05)); break;
      case 'top':    o.tx = 0; o.ty = 0; o.tz = 0; dir(0, 1, 0.03, fit(3.25, 1.35)); break;
      case 'wake':   o.tx = 1.3; o.ty = 0; o.tz = 0; dir(0.8, 0.2, 0.56, fit(1.7, 0.95)); break;
      case 'inside': o.tx = 0.4; o.ty = 0; o.tz = -0.05; { const px = -2.25, py = 0.2, pz = 1.02; dir(px - o.tx, py - o.ty, pz - o.tz, Math.hypot(px - o.tx, py - o.ty, pz - o.tz)); } break;
      default:       o.tx = 0.1; o.ty = -0.05; o.tz = 0; dir(0.55, 0.32, 0.77, fit(3.45, 1.55));
    }
  }
  const anim = { on: false, t: 0, dur: 0.6, fx: 0, fy: 0, fz: 0, fdx: 0, fdy: 0, fdz: 1, fd: 5, to: { tx: 0, ty: 0, tz: 0, dx: 0, dy: 0, dz: 1, dist: 5 } };
  const _v = new THREE.Vector3();
  function startAnim(to) {
    _v.copy(camera.position).sub(controls.target);
    const d = _v.length() || 1;
    anim.fd = d; anim.fdx = _v.x / d; anim.fdy = _v.y / d; anim.fdz = _v.z / d;
    anim.fx = controls.target.x; anim.fy = controls.target.y; anim.fz = controls.target.z;
    Object.assign(anim.to, to); anim.t = 0; anim.on = true;
    controls.enabled = false;
  }
  function setCamera(name) {
    if (!['overview', 'side', 'top', 'wake', 'inside'].includes(name)) name = 'overview';
    currentPreset = name; userMoved = false;
    preset(name, P); startAnim(P);
  }
  function refocus() {
    const o = P; o.tx = 0; o.ty = 0; o.tz = 0;
    _v.copy(camera.position).sub(controls.target).normalize();
    o.dx = _v.x; o.dy = _v.y; o.dz = _v.z; o.dist = Math.max(0.9, fit(focusR * 1.5, focusR * 1.5));
    userMoved = true; startAnim(o);
  }
  controls.addEventListener('start', () => { userMoved = true; anim.on = false; controls.enabled = true; });
  function stepCamera(dt) {
    if (anim.on) {
      anim.t += dt; const k = ease(anim.t / anim.dur), T = anim.to;
      const dx = anim.fdx + (T.dx - anim.fdx) * k, dy = anim.fdy + (T.dy - anim.fdy) * k, dz = anim.fdz + (T.dz - anim.fdz) * k;
      const il = 1 / (Math.hypot(dx, dy, dz) || 1), d = anim.fd + (T.dist - anim.fd) * k;
      const tx = anim.fx + (T.tx - anim.fx) * k, ty = anim.fy + (T.ty - anim.fy) * k, tz = anim.fz + (T.tz - anim.fz) * k;
      controls.target.set(tx, ty, tz);
      camera.position.set(tx + dx * il * d, Math.max(CAM_MIN_Y, ty + dy * il * d), tz + dz * il * d);
      if (anim.t >= anim.dur) { anim.on = false; controls.enabled = true; }
    }
    // never below the floor: limit the polar angle from the current distance
    const dist = camera.position.distanceTo(controls.target);
    scene.fog.near = dist * 1.6; scene.fog.far = dist * 4.5;
    const c = (CAM_MIN_Y - controls.target.y) / Math.max(dist, 1e-3);
    controls.maxPolarAngle = Math.acos(Math.max(-1, Math.min(1, c)));
    controls.update();
    if (camera.position.y < CAM_MIN_Y) camera.position.y = CAM_MIN_Y;
  }

  /* ------------------------------------------------- picking / raycasting */
  const ray = new THREE.Raycaster(); ray.layers.set(1);
  const ndc = new THREE.Vector2();
  function setRay(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function raycastMidplane(cx, cy) {
    setRay(cx, cy);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (Math.abs(d.z) < 1e-6) return null;
    const t = -o.z / d.z; if (t < 0) return null;
    const x = o.x + d.x * t, y = o.y + d.y * t;
    if (x < X0 || x > X1 || y < FLOOR_Y || y > YH) return null;
    return [x, y, 0];
  }
  function hitModel(cx, cy) { setRay(cx, cy); return ray.intersectObject(root, true).length > 0; }
  canvas.addEventListener('dblclick', (e) => { if (hitModel(e.clientX, e.clientY)) refocus(); });
  let tapT = 0, tapX = 0, tapY = 0, downX = 0, downY = 0;
  canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch') return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 10) return;      // it was a drag
    const now = performance.now();
    if (now - tapT < 320 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 28) { tapT = 0; if (hitModel(e.clientX, e.clientY)) refocus(); }
    else { tapT = now; tapX = e.clientX; tapY = e.clientY; }
  });

  /* ----------------------------------------------------------- thumbnails */
  let th = null; const thumbCache = new WeakMap(), thumbRT = new Map();
  function thumbnail(model, px = 128) {
    let m = thumbCache.get(model); if (!m) { m = new Map(); thumbCache.set(model, m); }
    if (m.has(px)) return Promise.resolve(m.get(px));
    if (!th) {
      const s = new THREE.Scene();
      s.add(new THREE.HemisphereLight(0xFFFFFF, 0x8A9099, 1.15));
      const dl = new THREE.DirectionalLight(0xFFFFFF, 2.1); dl.position.set(-1.2, 1.6, 1.4); s.add(dl, dl.target);
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }));
      s.add(mesh); th = { s, mesh, cam: new THREE.PerspectiveCamera(28, 1, 0.02, 30), box: new THREE.Box3(), ctr: new THREE.Vector3(), sz: new THREE.Vector3() };
    }
    const src = model.geometry, g = new THREE.BufferGeometry();
    for (const n of ['position', 'normal', 'color']) if (src.attributes[n]) g.setAttribute(n, src.attributes[n]);
    if (src.index) g.setIndex(src.index);
    g.computeBoundingBox(); th.box.copy(g.boundingBox); th.box.getCenter(th.ctr); th.box.getSize(th.sz);
    const rad = Math.max(0.05, th.sz.length() / 2), dist = rad / Math.sin(th.cam.fov * DEG / 2) * 1.04;
    th.cam.position.set(th.ctr.x - 0.45 * dist, th.ctr.y + 0.4 * dist, th.ctr.z + 0.95 * dist).sub(th.ctr).setLength(dist).add(th.ctr);
    th.cam.lookAt(th.ctr); th.cam.updateMatrixWorld();
    th.mesh.geometry = g;
    let rt = thumbRT.get(px);
    if (!rt) { rt = new THREE.WebGLRenderTarget(px, px, { samples: 4, type: THREE.UnsignedByteType }); rt.texture.colorSpace = THREE.SRGBColorSpace; thumbRT.set(px, rt); }
    const oc = new THREE.Color(), oa = renderer.getClearAlpha(); renderer.getClearColor(oc);
    renderer.setRenderTarget(rt); renderer.setClearColor(0xD9DBDE, 0); renderer.clear(); renderer.render(th.s, th.cam);
    const buf = new Uint8Array(px * px * 4); renderer.readRenderTargetPixels(rt, 0, 0, px, px, buf);
    renderer.setRenderTarget(null); renderer.setClearColor(oc, oa);
    g.dispose();
    const out = new Uint8ClampedArray(px * px * 4);
    for (let y = 0; y < px; y++) out.set(buf.subarray((px - 1 - y) * px * 4, (px - y) * px * 4), y * px * 4);
    const cv = document.createElement('canvas'); cv.width = cv.height = px;
    cv.getContext('2d').putImageData(new ImageData(out, px, px), 0, 0);
    const url = cv.toDataURL('image/png'); m.set(px, url);
    return Promise.resolve(url);
  }

  /* ------------------------------------------------------------ loop etc. */
  const frameCbs = []; let fanVis = 0, raf = 0, last = 0, running = false;
  function onFrame(fn) { frameCbs.push(fn); return () => { const i = frameCbs.indexOf(fn); if (i >= 0) frameCbs.splice(i, 1); }; }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000)); last = t;
    for (let i = 0; i < frameCbs.length; i++) frameCbs[i](dt);
    if (strutTarget !== strutTop) { strutTop = strutTarget; applyStrut(); }
    fan.rotation.x += Math.min(fanVis * 3, 12) * dt;
    stepCamera(dt);
    renderer.render(scene, camera);
  }
  function start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  document.addEventListener('visibilitychange', () => { document.hidden ? stop() : start(); });

  function resize() {
    const w = Math.max(1, parent.clientWidth), h = Math.max(1, parent.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP[tier]));
    renderer.setSize(w, h, false);
    const portrait = h > w; aspect = w / h;
    camera.aspect = aspect; camera.updateProjectionMatrix();
    if (!userMoved) {
      if (anim.on) preset(currentPreset, anim.to);          // re-aim the running animation at the new framing
      else { preset(currentPreset, P); controls.target.set(P.tx, P.ty, P.tz); camera.position.set(P.tx + P.dx * P.dist, Math.max(CAM_MIN_Y, P.ty + P.dy * P.dist), P.tz + P.dz * P.dist); }
    }
    return portrait;
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(parent);
  window.addEventListener('resize', resize);

  function setTier(t) {
    tier = t === 'high' ? 'high' : 'low';
    renderer.shadowMap.enabled = tier === 'high'; key.castShadow = tier === 'high';
    if (tier === 'high' && !key.shadow.map) key.shadow.mapSize.set(2048, 2048);
    scene.traverse((o) => { if (o.material) { for (const m of [].concat(o.material)) m.needsUpdate = true; } });
    resize();
  }

  setTier(tier);
  preset('overview', P); controls.target.set(P.tx, P.ty, P.tz);
  camera.position.set(P.tx + P.dx * P.dist, P.ty + P.dy * P.dist, P.tz + P.dz * P.dist);
  controls.update();
  start();

  return {
    three: THREE, renderer, scene, camera, root, controls, canvas,
    setCamera, thumbnail, raycastMidplane, onFrame, setTier, refocus,
    setWind(uvis) { fanVis = uvis; },
    setStrutTop(y) { strutTarget = y; },
    setFocusRadius(r) { focusR = Math.max(0.1, r); },
    getTier() { return tier; }, resize, start, stop,
  };
}
