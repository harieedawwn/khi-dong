// tools/qa.mjs — kiểm tra bố cục ở nhiều cỡ màn hình: ảnh chụp, cuộn trang, chữ bị cắt, hộp chữ chồng nhau, chữ vẽ ra ngoài khung.
//   node tools/qa.mjs [--sizes 360x740,844x390,...] [--model car_sedan] [--out shots/qa] [--shots 1]
import fs from 'fs';
import { open } from './shot.mjs';
const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); A[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
const sizes = String(A.sizes || '360x740,844x390,768x1024,1366x768,1920x1080').split(',').map((s) => s.split('x').map(Number));
const out = A.out || 'shots/qa'; fs.mkdirSync(out, { recursive: true });
let bad = 0;
for (const [W, H] of sizes) {
  const s = await open({ tier: 'low', W, H, q: '&q=12' });
  const { page } = s;
  await page.evaluate((m) => { const { ctx } = window.__app; ctx.state.set({ mode: 'library', modelId: m, U: 20 }); }, A.model || 'car_sedan');
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const de = document.documentElement, res = { scrollX: de.scrollWidth > innerWidth + 1, scrollY: de.scrollHeight > innerHeight + 1, bodyScroll: document.body.scrollHeight > innerHeight + 1, clipped: [], overlap: [], layout: de.getAttribute('data-layout') };
    const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
    // chữ bị cắt: phần tử có chữ mà scrollWidth/Height > client (overflow hidden/clip) hoặc nằm ngoài khung nhìn
    const texts = [];
    for (const e of document.querySelectorAll('#app *')) {
      if (!vis(e) || e.closest('svg') || e.closest('[hidden]') || e.closest('#guide:not(.is-on)') || e.closest('#park')) continue;
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0); if (!own) continue;
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      let scr = false; for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a); if (/(auto|scroll)/.test(o.overflowY + o.overflowX)) { scr = true; break; } } // cuộn được trong khung: không phải bị cắt
      if (!scr && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1)) { if (!e.closest('.popover:not(.is-open)') && !e.closest('#colR:not(.is-open)')) res.clipped.push('ngoài khung: ' + (e.id || e.className || e.tagName) + ' "' + e.textContent.trim().slice(0, 30) + '"'); }
      if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2) && cs.display !== 'inline') res.clipped.push('cắt: ' + (e.id || e.className || e.tagName) + ' "' + e.textContent.trim().slice(0, 30) + '" ' + e.scrollWidth + '>' + e.clientWidth + ' / ' + e.scrollHeight + '>' + e.clientHeight);
      texts.push({ e, r });
    }
    // chồng nhau: các khối chính nhìn thấy (không lồng nhau) giao nhau
    const ids = ['title', 'topRight', 'tools', 'hud', 'colL', 'colR', 'dock', 'legend', 'tabbar', 'sheet'];
    const boxes = ids.map((id) => [id, id === 'title' ? document.querySelector('#title .plate') : document.getElementById(id)]).filter(([, e]) => e && vis(e)).map(([id, e]) => [id, e.getBoundingClientRect()]);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i][1], b = boxes[j][1]; if ((boxes[i][0] === 'topRight' && boxes[j][0] === 'hud') || (boxes[i][0] === 'sheet' && boxes[j][0] === 'tabbar')) continue;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2) res.overlap.push(boxes[i][0] + ' x ' + boxes[j][0] + ' (' + Math.round(ox) + 'x' + Math.round(oy) + ')');
    }
    // chữ trong các khối chồng lên nhau (hai nút / hai nhãn khác nhau giao nhau)
    const leaf = texts.filter((t) => !texts.some((u) => u.e !== t.e && t.e.contains(u.e) && u.e !== t.e)).slice(0, 400);
    for (let i = 0; i < leaf.length; i++) for (let j = i + 1; j < leaf.length; j++) {
      const a = leaf[i].r, b = leaf[j].r; if (leaf[i].e.contains(leaf[j].e) || leaf[j].e.contains(leaf[i].e)) continue;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 3 && oy > 3) res.overlap.push('chữ: "' + leaf[i].e.textContent.trim().slice(0, 22) + '" x "' + leaf[j].e.textContent.trim().slice(0, 22) + '"');
    }
    res.canvas = (() => { const c = document.querySelector('#stage canvas'); return c ? [c.width, c.height] : null; })();
    return res;
  });
  const flags = (r.scrollX ? ' CUỘN-NGANG' : '') + (r.scrollY || r.bodyScroll ? ' CUỘN-DỌC' : '');
  const n = r.clipped.length + r.overlap.length + (flags ? 1 : 0); bad += n;
  console.log(`${W}x${H} [${r.layout}]${flags} cắt:${r.clipped.length} chồng:${r.overlap.length}`);
  for (const m of [...r.clipped, ...r.overlap].slice(0, 12)) console.log('   ', m);
  if (A.shots !== '0') await page.screenshot({ path: `${out}/${W}x${H}.png` });
  if (s.logs.length) console.log('   console:', s.logs.slice(0, 3).join(' | '));
  await s.close();
}
process.exit(bad ? 1 : 0);
