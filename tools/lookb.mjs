// tools/lookb.mjs — ảnh kiểm tra chế độ Tự lắp ghép: mẫu hoặc cấu hình JSON ở nhiều hướng nhìn (như look.mjs).
//   node tools/lookb.mjs --tpl car,rocket,plane,teardrop [--cfg '{"nose":"cone","body":"box","tail":"blunt","wheels":1}'] --views 34,side,top [--px 300] [--out shots/lookb.png]
import fs from 'fs';
import { execFileSync } from 'child_process';
import { open } from './shot.mjs';
const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); A[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
const px = +(A.px || 300), views = String(A.views || '34,side,top').split(','), out = A.out || 'shots/lookb.png';
const items = [...(A.tpl ? String(A.tpl).split(',').map((t) => ({ name: t, tpl: t })) : []), ...(A.cfg ? [].concat(JSON.parse('[' + A.cfg + ']')).map((c, i) => ({ name: 'cfg' + i, cfg: c })) : [])];
const s = await open({ tier: 'low', W: 600, H: 400, q: '&q=0' });
fs.mkdirSync('shots/look', { recursive: true });
const rows = [], ids = [];
for (const it of items) {
  const r = await s.page.evaluate(([it, px, views]) => {
    const { ctx, scene } = window.__app, cat = ctx.catalog;
    const b = it.tpl ? JSON.parse(JSON.stringify(cat.TEMPLATES[it.tpl].builder)) : { nose: it.cfg.nose, body: it.cfg.body, tail: it.cfg.tail, wing: it.cfg.wing || 'none', fins: it.cfg.fins || 'none', p: { ...cat.defaultParams(), ...(it.cfg.p || {}), wheels: it.cfg.wheels || 0 } };
    const t = performance.now(); const m = ctx.assemble(cat.buildFromBuilder(b)); const ms = performance.now() - t;
    return { ms: Math.round(ms), v: m.geometry.attributes.position.count, urls: views.map((v) => scene.thumbnailNow(m, px, v)) };
  }, [it, px, views]);
  const files = r.urls.map((u, i) => { const f = `shots/look/b_${it.name}_${views[i]}.png`; fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')); return f; });
  rows.push(files); ids.push(it.name); console.log(it.name, r.ms + ' ms', r.v + ' đỉnh');
}
await s.close();
fs.writeFileSync('shots/look/list.json', JSON.stringify({ rows, px, out, grid: 0, ids }));
execFileSync('python3', ['-I', 'tools/look.py'], { stdio: 'inherit' });
