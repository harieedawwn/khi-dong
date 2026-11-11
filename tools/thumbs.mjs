// tools/thumbs.mjs — dựng ảnh thu nhỏ TĨNH assets/thumbs/<id>.webp (góc 3/4, <= 8 KB) + assets/thumbs/cd.json (C_D ở 20 m/s cho huy hiệu).
// build.mjs nhúng các tệp này vào dist/index.html; picker dùng chúng, không dựng mô hình lúc chạy.
//   npm run build && node tools/thumbs.mjs [--ids a,b]
import fs from 'fs';
import { execFileSync } from 'child_process';
import { open } from './shot.mjs';
const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); A[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
const s = await open({ tier: 'high', W: 600, H: 400, q: '&q=0' });
const ids = A.ids ? String(A.ids).split(',') : await s.page.evaluate(() => window.__app.ctx.library.LIBRARY.map((e) => e.id));
fs.mkdirSync('assets/thumbs', { recursive: true }); fs.mkdirSync('shots/thumbs', { recursive: true });
const cd = fs.existsSync('assets/thumbs/cd.json') ? JSON.parse(fs.readFileSync('assets/thumbs/cd.json', 'utf8')) : {};
for (const id of ids) {
  const r = await s.page.evaluate((id) => {
    const { ctx, scene } = window.__app; const m = ctx.assemble(ctx.library.byId(id).build());
    const air = ctx.atmo.air({ mode: 'altitude', h: 0, T: 288.15, p: 101325 }); let c = null;
    try { c = ctx.aero.evaluate({ aeroDef: ctx.aerodata.AERO[id], info: m.info, air, U: 20, alphaDeg: 0 }).CD; } catch (e) { /* không có */ }
    return { url: scene.thumbnailNow(m, 640, '34'), cd: c };
  }, id);
  fs.writeFileSync(`shots/thumbs/${id}.png`, Buffer.from(r.url.split(',')[1], 'base64')); cd[id] = r.cd == null ? null : +r.cd.toFixed(3);
}
await s.close();
fs.writeFileSync('assets/thumbs/cd.json', JSON.stringify(cd));
execFileSync('python3', ['-I', 'tools/thumbs.py', ...ids], { stdio: 'inherit' });
