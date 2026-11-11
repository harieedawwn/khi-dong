// Kiểm tra lưới từng chi tiết dòng chảy: kín nước (mỗi cạnh dùng đúng 2 lần sau khi hàn đỉnh), thể tích dương, sdf đúng dấu (chiếu tia lẻ).
//   node tools/meshcheck.mjs [tiền_tố_id] [--sdf]
import { LIBRARY } from '../src/geom/library.js';
import { TEMPLATES, SLOTS, buildFromBuilder, defaultParams } from '../src/geom/catalog.js';
// --builder: các mẫu lắp ghép + mỗi lựa chọn mũi/thân/đuôi/cánh/đuôi lái (có và không có bánh xe)
const only = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '', doSdf = process.argv.includes('--sdf');
function weld(P) { const q = 1e-6, map = new Map(), id = new Int32Array(P.length / 3); for (let i = 0; i < id.length; i++) { const k = Math.round(P[3 * i] / q) + ',' + Math.round(P[3 * i + 1] / q) + ',' + Math.round(P[3 * i + 2] / q); let v = map.get(k); if (v === undefined) { v = map.size; map.set(k, v); } id[i] = v; } return id; }
function check(part) {
  const P = part.geometry.attributes.position.array, I = part.geometry.index.array, id = weld(P), E = new Map(); let vol = 0, degen = 0;
  for (let k = 0; k < I.length; k += 3) {
    const a = id[I[k]], b = id[I[k + 1]], c = id[I[k + 2]]; if (a === b || b === c || a === c) { degen++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const key = u < v ? u + '_' + v : v + '_' + u; const e = E.get(key) || [0, 0]; e[u < v ? 0 : 1]++; E.set(key, e); }
    const A = I[k] * 3, B = I[k + 1] * 3, C = I[k + 2] * 3; vol += (P[A] * (P[B + 1] * P[C + 2] - P[B + 2] * P[C + 1]) - P[A + 1] * (P[B] * P[C + 2] - P[B + 2] * P[C]) + P[A + 2] * (P[B] * P[C + 1] - P[B + 1] * P[C])) / 6;
  }
  let open = 0, nonman = 0, misor = 0; for (const [, e] of E) { const n = e[0] + e[1]; if (n === 1) open++; else if (n > 2) nonman++; else if (e[0] !== 1) misor++; }
  return { open, nonman, misor, vol, degen };
}
function inside(P, I, x, y, z, dir) { // Moller-Trumbore, đếm chẵn lẻ
  let hits = 0;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3, e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const h = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]], det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]; if (Math.abs(det) < 1e-14) continue;
    const s = [x - P[a], y - P[a + 1], z - P[a + 2]], u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det; if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det; if (v < 0 || u + v > 1) continue;
    if ((e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det > 0) hits++;
  }
  return hits % 2 === 1;
}
let bad = 0, rs = 12345; const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
const opt = k => SLOTS.find(x => x.key === k).options.map(o => o.id), BUILD = [];
for (const k in TEMPLATES) BUILD.push({ id: 'tpl_' + k, build: () => buildFromBuilder(TEMPLATES[k].builder) });
for (const wheels of [0, 1]) for (const nose of opt('nose')) for (const body of opt('body')) for (const tail of opt('tail')) { const b = { nose, body, tail, wing: wheels ? 'none' : 'swept', fins: wheels ? 'none' : 'cross', p: { ...defaultParams(), wheels } }; BUILD.push({ id: `b_${nose}_${body}_${tail}_${wheels}`, build: () => buildFromBuilder(b) }); }
for (const e of process.argv.includes('--builder') ? BUILD : LIBRARY) {
  if (only && !e.id.startsWith(only)) continue;
  const parts = e.build(), notes = [];
  for (const p of parts) {
    if (p.decal || p.flow === false) continue; const r = check(p);
    if (r.open || r.nonman || r.misor || r.vol <= 0) notes.push(`${p.id}: mở ${r.open}, ngoài đa tạp ${r.nonman}, ngược chiều ${r.misor}, V ${r.vol.toExponential(1)}`);
    if (doSdf && p.sdf && !['wheel', 'revolve', 'tube', 'strut'].includes(p.kind)) { const P = p.geometry.attributes.position.array, I = p.geometry.index.array, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], P[i + a]); mx[a] = Math.max(mx[a], P[i + a]); }
      const dir = [0.3711, 0.5432, 0.7523], l = Math.hypot(...dir); dir.forEach((v, i) => (dir[i] = v / l)); let wrong = 0, tested = 0;
      for (let i = 0; i < 160; i++) { const q = [0, 1, 2].map(a => mn[a] - 0.1 * (mx[a] - mn[a]) + rnd() * 1.2 * (mx[a] - mn[a])), d = p.sdf(...q); if (Math.abs(d) < 1.5e-3) continue; tested++; if (inside(P, I, ...q, dir) !== d < 0) wrong++; }
      if (wrong > 0.03 * tested) notes.push(`${p.id}: sdf sai dấu ${wrong}/${tested}`); }
  }
  bad += notes.length; console.log(e.id.padEnd(16), notes.length ? 'LỖI\n  ' + notes.join('\n  ') : 'ổn (' + parts.filter(p => !p.decal && p.flow !== false).length + ' chi tiết dòng chảy)');
}
process.exit(bad ? 1 : 0);
