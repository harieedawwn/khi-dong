// tools/shot.mjs — dựng dist/, mở trong Chromium (SwiftShader), đặt trạng thái, đợi, chụp / đo.
// Ví dụ:
//   node tools/shot.mjs --model cylinder --U 10 --camera side --ticks 1500 --out shots/cyl.png
//   node tools/shot.mjs --model cylinder --U 10 --ticks 3000 --st            (đo St ở vệt sau)
//   node tools/shot.mjs --model wing_2412 --alpha 18 --ticks 1500 --out a.png --eval "plane.stats()"
// Tuỳ chọn: --backend gpu|cpu (mặc định gpu) --tier low|high --size 800x500 --level n --browser chromium|firefox
//   --ticks N : tua nhanh N lần tick(dt) trong trang (không vẽ, nhanh hơn thời gian thực trong SwiftShader)
//   --dt 0.033 --wait ms (đợi thời gian thực thêm) --camera side|overview|... --M số Mach (đặt qua độ cao/nhiệt không dùng: --U m/s)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const { chromium, firefox } = createRequire(import.meta.url)('playwright');

const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; A[k] = v; }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const [W, H] = String(A.size || '800x500').split('x').map(Number);

export async function serve() {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0]; const f = path.join(dist, u === '/' ? 'index.html' : u);
    if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, url: 'http://127.0.0.1:' + srv.address().port + '/' };
}

export async function open(opts) {
  const { srv, url } = await serve();
  const br = await (opts.browser === 'firefox' ? firefox : chromium).launch(opts.browser === 'firefox' ? {} : { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await br.newContext({ viewport: { width: opts.W || W, height: opts.H || H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.addInitScript(() => { try { localStorage.setItem('phieu-ongkhidong-guide-v1', '1'); } catch (e) {} });
  await page.goto(url + '?tier=' + (opts.tier || 'low') + (opts.q || ''));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return { page, br, srv, logs, close: async () => { await br.close(); srv.close(); } };
}

// đặt trạng thái; ép backend nếu cần
export async function setup(page, o) {
  await page.evaluate((o) => {
    const { ctx } = window.__app; const st = ctx.state; const plane = ctx.flow.plane;
    if (o.backend === 'cpu') { plane.attachGpu(null, 'low'); }
    const patch = {};
    if (o.model) { patch.mode = 'library'; patch.modelId = o.model; }
    if (o.U != null) patch.U = +o.U;
    if (o.alpha != null) patch.alphaDeg = +o.alpha;
    if (o.camera) patch.camera = o.camera;
    if (o.view) patch.view = Object.assign({}, st.get().view, o.view);
    st.set(patch);
    if (o.level != null) { plane.setGovernor(false); plane._setLevel(+o.level); }
  }, o);
}
// tua nhanh và đo vệt sau: v_y trên trục tại vài x -> rms/U, St = f * D_chiếu / U_vis
export async function measureSt(page, n, dt, xs) {
  return page.evaluate(async ([n, dt, xs]) => {
    const { ctx, tick } = window.__app, flow = ctx.flow, out = [0, 0, 0]; ctx.scene.stop();
    const bb = ctx.getModel().info.bbox || null;
    const series = xs.map(() => []);
    let Uv = 0;
    for (let i = 0; i < n; i++) {
      tick(dt); ctx.scene.renderer.getContext().finish(); await new Promise((r) => requestAnimationFrame(r));   // Chrome chỉ báo fence xong sau khi nhả vòng lặp sự kiện
      if (i >= n / 2) xs.forEach((x, k) => { flow.sample(x, 0, 0, out); series[k].push(out[1]); }); Uv = ctx.uvis;
    }
    const res = xs.map((x, k) => {
      const a = series[k], m = a.reduce((p, c) => p + c, 0) / a.length;
      let rms = 0; for (const v of a) rms += (v - m) * (v - m); rms = Math.sqrt(rms / a.length);
      let st = 0, first = -1, last = -1, cnt = 0; const hy = 0.25 * rms;
      for (let i = 0; i < a.length; i++) { const v = a[i] - m; if (st <= 0 && v > hy) { if (st < 0) { if (first < 0) first = i; else cnt++; last = i; } st = 1; } else if (st >= 0 && v < -hy) st = -1; }
      const f = cnt > 0 ? cnt / ((last - first) * dt) : 0;
      return { x, rmsOverUv: +(rms / Uv).toFixed(4), f: +f.toFixed(4), cycles: cnt, mean: +(m / Uv).toFixed(3), s: k === 1 ? a.filter((_, i) => i % 6 === 0).map((v) => +(v / Uv).toFixed(2)) : undefined };
    });
    const b = ctx.flow.plane.window ? null : null;
    return { Uv: +Uv.toFixed(3), res, stats: flow.plane.stats() };
  }, [n, dt, xs]);
}
export async function ticks(page, n, dt) {
  return page.evaluate(async ([n, dt]) => { const t = window.__app.tick; for (let i = 0; i < n; i++) { t(dt); await new Promise((r) => setTimeout(r, 0)); } return window.__app.ctx.flow.plane.stats(); }, [n, dt]);
}

if (process.argv[1] && process.argv[1].endsWith('shot.mjs')) {
  const s = await open({ tier: A.tier, browser: A.browser, q: A.q ? '&q=' + A.q : '' });
  const { page } = s;
  await setup(page, { ...A, view: A.rake ? { rake: A.rake } : undefined });
  await page.waitForFunction(() => window.__app.ctx.flow.plane.ready(), null, { timeout: 60000 });
  if (A.ticks) console.log(JSON.stringify(await ticks(page, +A.ticks, +(A.dt || 1 / 30))));
  if (A.wait) await page.waitForTimeout(+A.wait);
  if (A.st) { const r = await measureSt(page, +A.st, +(A.dt || 1 / 30), String(A.xs || '0.15,0.3,0.6').split(',').map(Number)); const D = +(A.D || 0); console.log(JSON.stringify(r, (k, v) => (k === 'stats' ? { level: v.level, k: +v.visScale.toFixed(3), cells: +v.cellsAcross.toFixed(1), re: v.reSolver, h: v.h, backend: v.backend, steps: v.stepsPerFrame } : v))); if (D) for (const q of r.res) console.log('St =', (q.f * D / r.Uv).toFixed(3), 'at x', q.x); }
  if (A.eval) console.log(JSON.stringify(await page.evaluate(`(() => { const {ctx}=window.__app; const flow=ctx.flow, plane=flow.plane, state=ctx.state; return ${A.eval}; })()`)));
  if (A.out) {
    // chụp riêng cảnh 3D: ẩn giao diện, canvas phủ cả khung; đợi vài khung thật để camera chạy xong
    await page.evaluate(() => { const a = document.getElementById('app'); if (a) a.style.display = 'none'; window.__app.scene.setParent(document.body); });
    await page.waitForTimeout(+(A.settle || 2500));
    fs.mkdirSync(path.dirname(path.resolve(A.out)), { recursive: true }); await page.screenshot({ path: A.out }); }
  if (s.logs.length) console.log('LOGS', s.logs.slice(0, 8));
  await s.close();
}
