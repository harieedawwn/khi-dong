// Số đỉnh từng chi tiết của một mô hình: node tools/partstats.mjs truck_box
import { byId } from '../src/geom/library.js';
const parts = byId(process.argv[2]).build(); let t = 0; const rows = [];
for (const p of parts) { const n = p.geometry.attributes.position.count; t += n; rows.push([p.id, p.kind, n]); }
rows.sort((a, b) => b[2] - a[2]); for (const r of rows.slice(0, +(process.argv[3] || 12))) console.log(r.join('\t')); console.log('tổng', t);
