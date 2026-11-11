// tools/look.mjs — ảnh kiểm tra hình học: mỗi mô hình ở nhiều hướng nhìn, ghép thành một ảnh (không có ống gió, không bộ giải).
//   node tools/look.mjs --ids car_sedan,car_suv --views 34,side,front,top [--px 360] [--out shots/look.png]
// Dùng scene.thumbnailNow (cùng bộ dựng với ảnh thu nhỏ), nền xám nhạt, ghép bằng Python/PIL.
import fs from 'fs';
import { execFileSync } from 'child_process';
import { open } from './shot.mjs';
const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); A[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
const px = +(A.px || 360), views = String(A.views || '34,side,front,top').split(','), out = A.out || 'shots/look.png';
const s = await open({ tier: 'low', W: 600, H: 400, q: '&q=0' });
const ids = A.ids ? String(A.ids).split(',') : await s.page.evaluate(() => window.__app.ctx.library.LIBRARY.map((e) => e.id));
fs.mkdirSync('shots/look', { recursive: true });
const rows = [];
for (const id of ids) {
  const r = await s.page.evaluate(([id, px, views]) => {
    const { ctx, scene } = window.__app; const t = performance.now(); const m = ctx.assemble(ctx.library.byId(id).build()); const ms = performance.now() - t;
    return { ms: Math.round(ms), v: m.geometry.attributes.position.count, urls: views.map((v) => scene.thumbnailNow(m, px, v)) };
  }, [id, px, views]);
  const files = r.urls.map((u, i) => { const f = `shots/look/${id}_${views[i]}.png`; fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')); return f; });
  rows.push(files); console.log(id, r.ms + ' ms', r.v + ' đỉnh');
}
await s.close();
fs.writeFileSync('shots/look/list.json', JSON.stringify({ rows, px, out, grid: +(A.grid || 0), ids }));
execFileSync('python3', ['-I', 'tools/look.py'], { stdio: 'inherit' });
