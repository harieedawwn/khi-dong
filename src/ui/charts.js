// charts.js (P8): #charts with three canvas charts (time, compare, F(v)) and the pin list.
import {
  TIME_WINDOW, MAX_PINS, PIN_COLORS, CURRENT_COLOR, C, WORD_FLOW,
  fmtNum, fmtFixed, fmtVal, makePin, makeSnapshot, pinLabel, h, setText, ensureStyles, clamp, NB
} from '../config.js';

const TABS = [['time', 'Theo thời gian'], ['compare', 'So sánh'], ['curve', 'F theo v']];
const METRICS = {
  FD: { label: 'F cản', unit: 'N', key: 'FD' },
  CD: { label: 'C_D', unit: '', key: 'CD' },
  FL: { label: 'F nâng', unit: 'N', key: 'FL' }
};
const FONT_UI = '12px "Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_NUM = '12px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

function niceScale(lo, hi, n) {
  if (!(hi > lo)) { hi = lo + 1; }
  const raw = (hi - lo) / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  return { min: Math.floor(lo / step + 1e-9) * step, max: Math.ceil(hi / step - 1e-9) * step, step };
}
function tickText(v, step) {
  if (Math.abs(v) < step * 1e-6) return '0';
  if (Math.abs(v) >= 1000) return fmtNum(v);
  return fmtFixed(v, Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9))));
}
const sameSnap = (a, b) => a && b && a.mode === b.mode && a.modelId === b.modelId && Math.abs(a.alphaDeg - b.alphaDeg) < 1e-6 &&
  (a.mode !== 'builder' || JSON.stringify(a.builder) === JSON.stringify(b.builder));

export function init(ctx) {
  ensureStyles();
  const { state, atmo, flow, aero } = ctx;
  const mount = document.getElementById('charts');

  let tab = 'time', metric = 'FD', paused = false;
  const buf = [];                // time series {t, fd, fl}
  let clock = 0, lastSample = -1, lastClockWall = 0;
  let yr = null;                 // smoothed y range of the time chart
  let entries = [], curves = [], sig = '', lastMap = null;

  /* ---------- DOM ---------- */
  const tabBtns = new Map();
  const tabbar = h('div', { class: 'tabbar', role: 'tablist', 'aria-label': 'Biểu đồ' },
    TABS.map(([id, name]) => {
      const b = h('button', { type: 'button', class: 'btn', role: 'tab', 'aria-selected': 'false', onClick: () => setTab(id) }, name);
      tabBtns.set(id, b); return b;
    }));
  const metricBtns = new Map();
  const metricBox = h('div', { class: 'seg p8-seg', role: 'radiogroup', 'aria-label': 'Đại lượng' });
  for (const k of ['FD', 'CD', 'FL']) {
    const b = h('button', { type: 'button', class: 'btn', role: 'radio', 'aria-pressed': 'false', 'data-m': k, onClick: () => setMetric(k) },
      k === 'CD' ? h('span', null, 'C', h('span', { class: 'p8-s' }, 'D')) : METRICS[k].label);
    metricBtns.set(k, b); metricBox.appendChild(b);
  }
  const pauseBtn = h('button', { type: 'button', class: 'btn', onClick: () => setPaused(!paused) }, 'Tạm dừng');
  const clearBtn = h('button', { type: 'button', class: 'btn', onClick: () => clearTime() }, 'Xóa');
  const timeTools = h('div', { class: 'p8-row' }, pauseBtn, clearBtn);
  
  const cv = h('canvas', { role: 'img', 'aria-label': 'Biểu đồ lực' });
  const cvWrap = h('div', { class: 'p8-ch-cv' }, cv);
  const pinBtn = h('button', { type: 'button', class: 'btn btn-primary', onClick: () => addPin() }, 'Ghim cấu hình');
  const pinList = h('div', { class: 'p8-pins', 'aria-label': 'Cấu hình đã ghim' });
  const bar = h('div', { class: 'p8-ch-bar' }, pinBtn, h('span', { class: 'p8-sp' }), metricBox, timeTools);
  if (mount) {
    mount.textContent = '';
    mount.appendChild(h('div', { class: 'p8-ch' }, tabbar, cvWrap, bar, pinList));
  }

  /* ---------- theme + canvas ---------- */
  let th = null;
  function theme() {
    const cs = mount ? getComputedStyle(mount) : null, v = n => (cs && cs.getPropertyValue(n).trim()) || '';
    th = { ink: v('--ink') || C.ink, muted: v('--muted') || C.muted, line: v('--line') || C.line, paper: v('--paper') || C.paper, red: v('--red') || C.red };
  }
  let dpr = 1, W = 0, H = 0, g = null;
  function fit() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!th) theme();
    return g;
  }
  const crisp = v => Math.round(v) + 0.5;
  function ellipsize(text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }
  function frame(L, R, T, B) { return { L, R: W - R, T, B: H - B, w: Math.max(10, W - L - R), h: Math.max(10, H - T - B) }; }
  function axes(rect, xs, ys, xLabel, yLabel, xFmt) {
    g.font = FONT_NUM; g.textBaseline = 'middle'; g.textAlign = 'right';
    g.lineWidth = 1;
    const ty = (y) => rect.B - (y - ys.min) / (ys.max - ys.min) * rect.h;
    for (let v = ys.min; v <= ys.max + ys.step * 1e-6; v += ys.step) {
      const y = crisp(ty(v));
      g.strokeStyle = Math.abs(v) < ys.step * 1e-6 ? th.muted : th.line;
      g.beginPath(); g.moveTo(rect.L, y); g.lineTo(rect.R, y); g.stroke();
      g.fillStyle = th.muted; g.fillText(tickText(v, ys.step), rect.L - 6, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    const tx = x => rect.L + (x - xs.min) / (xs.max - xs.min) * rect.w;
    for (let v = xs.min; v <= xs.max + xs.step * 1e-6; v += xs.step) {
      const x = crisp(tx(v));
      g.strokeStyle = th.line; g.beginPath(); g.moveTo(x, rect.T); g.lineTo(x, rect.B); g.stroke();
      g.fillStyle = th.muted; g.fillText(xFmt ? xFmt(v, xs.step) : tickText(v, xs.step), x, rect.B + 4);
    }
    g.font = FONT_UI; g.textAlign = 'right'; g.textBaseline = 'alphabetic'; g.fillStyle = th.muted;
    if (xLabel) g.fillText(xLabel, rect.R, H - 1);
    g.textAlign = 'left'; if (yLabel) g.fillText(yLabel, 2, 11);
  }

  /* ---------- time chart ---------- */
  function feed(res, dt) {
    if (!res || !res.aero) return;
    if (dt == null) { const now = performance.now(); dt = lastClockWall ? Math.min(0.1, (now - lastClockWall) / 1000) : 0; lastClockWall = now; }
    if (paused) return;
    clock += dt;
    if (lastSample >= 0 && clock - lastSample < 0.03) return;
    lastSample = clock;
    const a = res.aero;
    let fl = { dCD: 0, dCL: 0 };
    try { fl = aero.fluct(a, flow && flow.phase ? flow.phase() : res.phase) || fl; } catch (e) { /* keep steady values */ }
    const qA = (a.q || 0) * (a.Aref || 0);
    buf.push({ t: clock, fd: a.FD + qA * (fl.dCD || 0), fl: a.FL + qA * (fl.dCL || 0) });
    while (buf.length && buf[0].t < clock - TIME_WINDOW - 1) buf.shift();
  }
  function clearTime() { buf.length = 0; yr = null; lastSample = -1; draw(); }
  function setPaused(on) {
    paused = !!on;
    setText(pauseBtn, paused ? 'Tiếp tục' : 'Tạm dừng');
    pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    lastClockWall = 0;
  }
  function drawTime() {
    const rect = frame(48, 12, 24, 28);
    const t1 = clock, t0 = t1 - TIME_WINDOW;
    let lo = 0, hi = 0;
    for (const p of buf) { if (p.t < t0) continue; lo = Math.min(lo, p.fd, p.fl); hi = Math.max(hi, p.fd, p.fl); }
    if (hi - lo < 1e-9) hi = lo + 1;
    const pad = (hi - lo) * 0.08;
    let tMin = lo < 0 ? lo - pad : 0, tMax = hi + pad;
    if (yr) {   // grow at once, shrink slowly (unrounded smoothed range, rounded only for display)
      if (tMax < yr.max) tMax = yr.max + (tMax - yr.max) * 0.1;
      if (tMin > yr.min) tMin = yr.min + (tMin - yr.min) * 0.1;
    }
    yr = { min: tMin, max: tMax };
    const ys = niceScale(tMin, tMax, 4);
    const X = t => rect.L + (t - t0) / TIME_WINDOW * rect.w, Y = v => rect.B - (v - ys.min) / (ys.max - ys.min) * rect.h;
    // grid and labels (x labels as seconds before now)
    axes(rect, { min: 0, max: TIME_WINDOW, step: 5 }, ys, 't (s)', 'N', (v) => (v === TIME_WINDOW ? '0' : '−' + fmtFixed(TIME_WINDOW - v, 0)));
    g.save(); g.beginPath(); g.rect(rect.L, rect.T - 2, rect.w, rect.h + 4); g.clip();
    g.lineJoin = 'round'; g.lineWidth = 2;
    for (const [key, col] of [['fd', C.drag], ['fl', C.lift]]) {
      g.strokeStyle = col; g.beginPath();
      let first = true;
      for (const p of buf) { if (p.t < t0 - 0.5) continue; const x = X(p.t), y = Y(p[key]); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
      if (buf.length === 1) { g.moveTo(X(buf[0].t) - 1, Y(buf[0][key])); g.lineTo(X(buf[0].t) + 1, Y(buf[0][key])); }
      g.stroke();
    }
    g.restore();
    // legend
    g.font = FONT_UI; g.textBaseline = 'middle'; g.textAlign = 'left';
    let lx = rect.L + 4;
    for (const [txt, col] of [['F cản', C.drag], ['F nâng', C.lift]]) {
      g.fillStyle = col; g.fillRect(lx, 8, 10, 10); g.fillStyle = th.ink; g.fillText(txt, lx + 14, 13); lx += 14 + g.measureText(txt).width + 14;
    }
    if (paused) { g.textAlign = 'right'; g.fillStyle = th.muted; g.fillText('Tạm dừng', rect.R, 13); }
    // value of the newest sample
    lastMap = { tab: 'time', rect, x: t => X(t), y: v => Y(v), dpr, tNow: t1 };
  }

  /* ---------- compare / curve data ---------- */
  function currentSnap() { return makeSnapshot(state.get()); }
  function buildEntries() {
    const st = state.get(), cs = currentSnap(), pins = st.pins || [];
    let matched = -1;
    pins.forEach((p, i) => { if (matched < 0 && sameSnap(p.snapshot, cs)) matched = i; });
    const out = [];
    if (matched < 0) out.push({ label: pinLabel(ctx, cs) + ' (hiện tại)', snap: cs, color: CURRENT_COLOR, current: true });
    pins.forEach((p, i) => out.push({
      label: p.label + (i === matched ? ' (hiện tại)' : ''), snap: p.snapshot, current: i === matched,
      color: i === matched ? CURRENT_COLOR : PIN_COLORS[i % PIN_COLORS.length], pinId: p.id
    }));
    return out;
  }
  function signature() {
    const st = state.get(), e = st.env;
    return [st.U, e.mode, e.h, e.T, e.p, st.alphaDeg, st.modelId, st.mode, st.mode === 'builder' ? JSON.stringify(st.builder) : '',
      (st.pins || []).map(p => p.id + p.snapshot.modelId + p.snapshot.alphaDeg + p.snapshot.mode).join(',')].join('|');
  }
  function recompute() {
    const st = state.get(), U = st.U, air = atmo.air(st.env);
    entries = buildEntries();
    const Umax = Math.max(60, 1.5 * U);
    if (tab === 'compare') {
      for (const en of entries) {
        try { en.res = ctx.evaluateSnapshot(en.snap, U, air); } catch (err) { en.res = null; }
      }
    } else if (tab === 'curve') {
      curves = entries.map(en => {
        let pts = [];
        try { pts = ctx.curveFor(en.snap, air, Umax, 64) || []; } catch (err) { pts = []; }
        return { ...en, pts };
      });
      curves.U = U; curves.Umax = Umax; curves.a = air.a;
    }
    sig = signature();
  }
  const valueOf = (en, m) => (en.res && typeof en.res[METRICS[m].key] === 'number' ? en.res[METRICS[m].key] : NaN);

  /* ---------- compare chart ---------- */
  function drawCompare() {
    const st = state.get(), U = st.U;
    const m = METRICS[metric];
    g.textBaseline = 'middle';
    g.font = FONT_UI; g.textAlign = 'left'; g.fillStyle = th.ink;
    g.fillText(m.label + (m.unit ? ' (' + m.unit + ')' : '') + ' · v = ' + fmtFixed(U, U < 100 ? 1 : 0).replace(/ /g, '') + ' m/s, không khí hiện tại', 2, 10);
    const rows = entries.length, top = 26, availH = H - top - 4;
    const rowH = clamp(availH / Math.max(rows, 1), 22, 36);
    const labW = Math.min(Math.round(W * 0.4), 150), valW = 76;
    const x0 = labW + 8, x1 = W - valW - 6;
    const vals = entries.map(en => valueOf(en, metric));
    let lo = 0, hi = 0;
    vals.forEach(v => { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    if (hi - lo < 1e-12) hi = lo + 1;
    const zx = x0 + (0 - lo) / (hi - lo) * (x1 - x0);
    g.strokeStyle = th.muted; g.lineWidth = 1; g.beginPath(); g.moveTo(crisp(zx), top - 2); g.lineTo(crisp(zx), top + rows * rowH); g.stroke();
    const bars = [];
    entries.forEach((en, i) => {
      const cy = top + rowH * i + rowH / 2, v = vals[i];
      g.font = (en.current ? '600 ' : '') + FONT_UI; g.textAlign = 'left'; g.fillStyle = en.current ? th.red : th.ink;
      g.fillText(ellipsize(en.label, labW), 2, cy);
      if (isFinite(v)) {
        const xv = x0 + (v - lo) / (hi - lo) * (x1 - x0), xa = Math.min(zx, xv), bw = Math.max(1, Math.abs(xv - zx)), bh = Math.min(18, rowH - 8);
        g.fillStyle = en.color; g.fillRect(xa, cy - bh / 2, bw, bh);
        bars.push({ i, v, x: xv, y: cy, x0: xa, w: bw, color: en.color });
      }
      g.font = FONT_NUM; g.textAlign = 'right'; g.fillStyle = th.ink;
      g.fillText(isFinite(v) ? fmtNum(v) : '—', W - 2, cy);
    });
    if (entries.length === 1) {
      g.font = FONT_UI; g.textAlign = 'left'; g.fillStyle = th.muted;
      g.fillText('Bấm "Ghim cấu hình" để so sánh thêm.', 2, top + rowH + 12);
    }
    lastMap = { tab: 'compare', bars, dpr, zeroX: zx, scale: { lo, hi, x0, x1 }, rowH, top };
  }

  /* ---------- F(v) chart ---------- */
  function drawCurve() {
    const rect = frame(52, 12, 14, 28);
    const key = metric === 'FL' ? 'FL' : 'FD', U = curves.U || state.get().U, Umax = curves.Umax || Math.max(60, 1.5 * U);
    let lo = 0, hi = 0;
    for (const c of curves) for (const p of c.pts) { const v = p[key]; if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (hi - lo < 1e-12) hi = lo + 1;
    const ys = niceScale(lo, hi * 1.04, 4), xs = niceScale(0, Umax, 6);
    const X = v => rect.L + (v - 0) / (Umax - 0) * rect.w, Y = v => rect.B - (v - ys.min) / (ys.max - ys.min) * rect.h;
    axes(rect, { min: 0, max: Umax, step: xs.step }, ys, 'v (m/s)', 'N', (v, st) => tickText(v, st));
    g.save(); g.beginPath(); g.rect(rect.L, rect.T, rect.w, rect.h); g.clip();
    // Mach 1
    if (curves.a && curves.a < Umax) {
      g.setLineDash([4, 4]); g.strokeStyle = th.muted; g.lineWidth = 1; g.beginPath();
      g.moveTo(crisp(X(curves.a)), rect.T); g.lineTo(crisp(X(curves.a)), rect.B); g.stroke(); g.setLineDash([]);
    }
    // F ~ v^2 through the current point (drag only)
    const curSeries = curves.find(c => c.current) || curves[0];
    let dot = null;
    if (curSeries && curSeries.pts.length > 1) {
      const pts = curSeries.pts;
      let k = pts.findIndex(p => p.U >= U); if (k < 1) k = 1; if (k >= pts.length) k = pts.length - 1;
      const a = pts[k - 1], b = pts[k], f = b.U > a.U ? (U - a.U) / (b.U - a.U) : 0;
      dot = { x: U, y: a[key] + (b[key] - a[key]) * f };
      if (key === 'FD' && dot.y > 0) {
        g.setLineDash([5, 4]); g.strokeStyle = th.muted; g.lineWidth = 1.25; g.beginPath();
        for (let i = 0; i <= 60; i++) { const v = Umax * i / 60, y = dot.y * Math.pow(v / U, 2); if (i === 0) g.moveTo(X(v), Y(y)); else g.lineTo(X(v), Y(y)); }
        g.stroke(); g.setLineDash([]);
      }
    }
    // vertical line at the current U
    g.strokeStyle = th.muted; g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(crisp(X(U)), rect.T); g.lineTo(crisp(X(U)), rect.B); g.stroke(); g.setLineDash([]);
    g.lineJoin = 'round';
    const order = curves.slice().sort((a, b) => (a.current ? 1 : 0) - (b.current ? 1 : 0));
    for (const c of order) {
      g.strokeStyle = c.color; g.lineWidth = c.current ? 2.5 : 1.75; g.beginPath();
      c.pts.forEach((p, i) => { const x = X(p.U), y = Y(p[key]); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
      g.stroke();
    }
    if (dot) { g.fillStyle = CURRENT_COLOR; g.strokeStyle = th.paper; g.lineWidth = 2; g.beginPath(); g.arc(X(dot.x), Y(dot.y), 4.5, 0, Math.PI * 2); g.fill(); g.stroke(); }
    g.restore();
    g.font = FONT_UI; g.textBaseline = 'alphabetic'; g.fillStyle = th.muted;
    if (curves.a && curves.a < Umax) { g.textAlign = 'left'; g.fillText('M 1', Math.min(rect.R - 24, X(curves.a) + 4), rect.T + 12); }
    if (key === 'FD') { g.textAlign = 'right'; g.fillText('nét đứt: F ∝ v²', rect.R - 4, rect.T + 12); }
    lastMap = { tab: 'curve', rect, x: v => X(v), y: v => Y(v), dpr, key, dot };
  }

  /* ---------- draw ---------- */
  function draw() {
    if (!cv.isConnected) return;
    fit();
    if (!W || !H) return;
    if (tab === 'time') drawTime();
    else {
      if (!entries.length || sig === '') recompute();
      if (tab === 'compare') drawCompare(); else drawCurve();
    }
  }

  /* ---------- tabs, pins ---------- */
  function setTab(id, m) {
    if (!TABS.some(t => t[0] === id)) return;
    tab = id;
    if (m && METRICS[m]) metric = m;
    if (tab === 'curve' && metric === 'CD') metric = 'FD';
    for (const [k, b] of tabBtns) { b.setAttribute('aria-selected', k === id ? 'true' : 'false'); b.classList.toggle('is-active', k === id); }
    for (const [k, b] of metricBtns) {
      const on = k === metric; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('is-active', on);
      b.style.display = tab === 'curve' && k === 'CD' ? 'none' : '';
    }
    metricBox.style.display = tab === 'time' ? 'none' : '';
    timeTools.style.display = tab === 'time' ? '' : 'none';
    sig = ''; entries = [];
    draw();
  }
  function setMetric(m) { if (!METRICS[m]) return; metric = m; setTab(tab); }

  function addPin() {
    const st = state.get(), pins = st.pins || [];
    if (pins.length >= MAX_PINS) return;
    state.set({ pins: [...pins, makePin(ctx, makeSnapshot(st))] });
  }
  function removePin(id) { state.set({ pins: (state.get().pins || []).filter(p => p.id !== id) }); }
  let chipTimer = 0;
  function renderChips() {
    chipTimer = 0;
    const st = state.get(), pins = st.pins || [], list = buildEntries();
    pinList.textContent = '';
    for (const en of list) {
      const chip = h('span', { class: 'p8-pin' }, h('b', { style: 'background:' + en.color }), h('span', { title: en.label }, en.label));
      if (en.pinId) chip.appendChild(h('button', { type: 'button', 'aria-label': 'Gỡ ' + en.label, onClick: () => removePin(en.pinId) }, '×'));
      else chip.style.paddingRight = '8px';
      pinList.appendChild(chip);
    }
    const full = pins.length >= MAX_PINS;
    pinBtn.disabled = full;
    setText(pinBtn, full ? 'Đã đủ ' + MAX_PINS + ' cấu hình' : 'Ghim cấu hình (' + pins.length + '/' + MAX_PINS + ')');
  }
  const scheduleChips = () => { if (!chipTimer) chipTimer = setTimeout(renderChips, 90); };

  /* ---------- frame loop ---------- */
  let raf = 0, lastDraw = 0, lastCheck = 0, alive = true;
  function visible() { return mount && mount.isConnected && mount.getClientRects().length > 0; }
  function loop(ts) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden || !visible()) return;
    if (tab === 'time') { if (ts - lastDraw >= 33) { lastDraw = ts; draw(); } }
    else if (ts - lastCheck >= 100) {
      lastCheck = ts;
      const s = signature();
      if (s !== sig) { recompute(); draw(); }
    }
  }

  const offs = [
    state.on('results', r => feed(r, null)),
    state.on('chart:tab', d => d && setTab(d.tab, d.metric)),
    state.on('chart:clear', () => clearTime()),
    state.on('change:pins', () => { scheduleChips(); sig = ''; }),
    state.on('change:modelId', scheduleChips), state.on('change:mode', scheduleChips),
    state.on('change:alphaDeg', scheduleChips), state.on('change:builder', scheduleChips)
  ];
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => { theme(); draw(); }); ro.observe(cvWrap); }
  const onDpr = () => draw();
  window.addEventListener('resize', onDpr);
  setTab('time');
  renderChips();
  raf = requestAnimationFrame(loop);

  return {
    feed, draw, setTab, setMetric, setPaused, addPin, removePin, clear: clearTime, recompute,
    get tab() { return tab; }, get canvas() { return cv; },
    timeSeries: () => buf.map(p => ({ ...p })),
    compareBars: () => { recompute(); return entries.map(en => ({ label: en.label, current: !!en.current, FD: valueOf(en, 'FD'), CD: valueOf(en, 'CD'), FL: valueOf(en, 'FL') })); },
    curveSeries: () => { recompute(); return curves.map(c => ({ label: c.label, current: !!c.current, pts: c.pts })); },
    plotMap: () => lastMap,
    destroy() { alive = false; cancelAnimationFrame(raf); clearTimeout(chipTimer); offs.forEach(f => f && f()); if (ro) ro.disconnect(); window.removeEventListener('resize', onDpr); }
  };
}
