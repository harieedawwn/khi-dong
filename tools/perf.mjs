// tools/perf.mjs — đo khung hình thật (không tua nhanh): fps, tác vụ > 50 ms sau khi khởi động, lỗi console.
//   node tools/perf.mjs [--size 1000x640] [--secs 12] [--browser chromium|firefox] [--model id] [--level quality-step]
import { open, setup } from './shot.mjs';
const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); A[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
const [W, H] = String(A.size || '1000x640').split('x').map(Number);
const t0 = Date.now();
const s = await open({ tier: A.tier || 'low', W, H, browser: A.browser, q: A.q || '' });
const bootMs = Date.now() - t0;
const { page } = s;
await page.evaluate(() => {
  window.__long = []; window.__frames = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  const loop = (t) => { window.__frames.push(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
});
if (A.noui) await page.evaluate(() => { document.getElementById('app').style.display = 'none'; window.__app.scene.setParent(document.body); });
if (A.model) await setup(page, { model: A.model, U: A.U, alpha: A.alpha });
await page.waitForTimeout(+(A.warm || 4000));                       // khởi động / bake xong rồi mới tính
await page.evaluate(() => { window.__long.length = 0; window.__frames.length = 0; });
await page.waitForTimeout(+(A.secs || 12) * 1000);
const r = await page.evaluate(() => {
  const f = window.__frames, d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
  d.sort((a, b) => a - b);
  const info = window.__app.scene.renderer.info;
  const q = window.__app.quality ? window.__app.quality.state() : null;
  return { frames: f.length, fps: +(f.length / ((f[f.length - 1] - f[0]) / 1000)).toFixed(2), medMs: Math.round(d[d.length >> 1] || 0), p95Ms: Math.round(d[Math.floor(d.length * 0.95)] || 0),
    long: window.__long.slice(0, 12), nLong: window.__long.length, tris: info.render.triangles, calls: info.render.calls, geoms: info.memory.geometries, q };
});
console.log(JSON.stringify({ boot: bootMs, ...r }));
if (s.logs.length) console.log('LOGS', s.logs.filter((l) => !/GPU stall|performance warning|GL Driver/.test(l)).slice(0, 8));
await s.close();
