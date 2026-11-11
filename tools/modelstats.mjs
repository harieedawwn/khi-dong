// Thống kê mọi mô hình thư viện: kích thước, số đỉnh, diện tích chính diện, CD/CL ở 20 m/s (dùng để đối chiếu trước/sau khi dựng lại hình)
import { LIBRARY } from '../src/geom/library.js';
import { assemble } from '../src/geom/assemble.js';
import { air } from '../src/physics/atmo.js';
import { evaluate } from '../src/physics/aero.js';
import { AERO } from '../src/physics/aerodata.js';
const only = process.argv[2]; const a = air({ mode: 'altitude', h: 0 }); const rows = [];
for (const e of LIBRARY) { if (only && !e.id.startsWith(only)) continue;
  const t = Date.now(), m = assemble(e.build()), i = m.info, r = evaluate({ aeroDef: AERO[e.id], info: i, air: a, U: 20, alphaDeg: 0 });
  rows.push({ id: e.id, ms: Date.now() - t, verts: m.geometry.attributes.position.count, L: +i.L.toFixed(3), span: +i.span.toFixed(3), frontal: +i.frontal.toFixed(4), CD: +r.CD.toFixed(3), CL: +r.CL.toFixed(3), FD: +r.FD.toFixed(2) }); }
console.table(rows);
