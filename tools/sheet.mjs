// tools/sheet.mjs — bảng ảnh tổng hợp (docs/contact-sheet.png): trụ, cầu, giọt nước, cánh 2412 ở 4° và 18°, tên lửa M 1,5.
//   node tools/sheet.mjs [--ticks 500] [--tier low|high] [--camera side]
import fs from 'fs';
import { createRequire } from 'module';
import { open, setup, ticks } from './shot.mjs';
const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); A[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
const CFG = [
  { id: 'cylinder', U: 10, alpha: 0, label: 'Hình trụ, 10 m/s' },
  { id: 'sphere', U: 10, alpha: 0, label: 'Hình cầu, 10 m/s' },
  { id: 'teardrop', U: 10, alpha: 0, label: 'Giọt nước, 10 m/s' },
  { id: 'wing_2412', U: 10, alpha: 4, label: 'Cánh NACA 2412, 4°' },
  { id: 'wing_2412', U: 10, alpha: 18, label: 'Cánh NACA 2412, 18°' },
  { id: 'rocket_sounding', U: 515, alpha: 0, label: 'Tên lửa thám không, M 1,5' },
];
const s = await open({ tier: A.tier || 'low', W: 800, H: 500, q: '&q=0' });
const { page } = s;
await page.evaluate(() => { const a = document.getElementById('app'); if (a) a.style.display = 'none'; window.__app.scene.setParent(document.body); });
fs.mkdirSync('shots/sheet', { recursive: true });
const out = [];
for (const [i, c] of CFG.entries()) {
  await setup(page, { model: c.id, U: c.U, alpha: c.alpha, camera: A.camera || 'side' });
  await page.waitForFunction(() => window.__app.ctx.flow.plane.ready(), null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await ticks(page, +(A.ticks || 500), 1 / 30);
  await page.waitForTimeout(+(A.settle || 3500));
  const f = `shots/sheet/${i}.png`; await page.screenshot({ path: f }); out.push([f, c.label]);
  const m = await page.evaluate(() => { const r = window.__app.results; return { M: r.aero && +r.aero.M.toFixed(2), wake: r.aero && r.aero.regime.wake, lvl: window.__app.ctx.flow.plane.stats().level }; });
  console.log(c.label, JSON.stringify(m));
}
await s.close();
fs.writeFileSync('shots/sheet/list.json', JSON.stringify(out));
