// readouts.js (P8): #readouts (numbers), #hud (on the 3D view), #legend (colour bar). Values are smoothed (tau 0.25 s).
import {
  SMOOTH_TAU, PROBE_SPEED_IS_VISUAL, WORD_FLOW, WORD_BL, WORD_WAKE, WORD_AREF, PRESSURE_CP_MIN, C,
  makeSmoother, fmtNum, fmtFixed, fmtVal, fmtRe, fmtDeg, fmtPct, pressureColor, rampColor,
  h, sym, setShown, setText, ensureStyles, NB
} from '../config.js';

const num = v => (typeof v === 'number' && isFinite(v) ? v : NaN);
const DASH = '—';

export function init(ctx) {
  ensureStyles();
  const { state } = ctx;
  const $ = id => document.getElementById(id);
  const root = $('readouts'), hudEl = $('hud'), legendEl = $('legend');

  /* ---------- smoothed channels ---------- */
  const IDS = ['FD', 'FL', 'CD', 'CL', 'LD', 'frontPa', 'frontN', 'fShed', 'U', 'kmh', 'M', 'Re', 'q', 'p0', 'T0', 'mach', 'St',
    'rho', 'p', 'T', 'mu', 'a', 'CDp', 'CDf', 'CDi', 'CDw', 'power', 'buoy', 'sep', 'Aref', 'Lref', 'pSpeed', 'pP', 'pCp', 'slow', 'cpMax', 'q2'];
  const S = {}; IDS.forEach(id => { S[id] = makeSmoother(SMOOTH_TAU); });
  let cur = {};          // smoothed values (numbers)
  let lastRes = null, lastT = 0, sinceDraw = 1, drawn = {};

  function extract(r) {
    const a = r.aero || {}, air = r.air || {}, sf = r.surface || {}, pr = r.probe;
    const M = num(a.M), wake = a.regime && a.regime.wake;
    const U = num(r.U);
    const slow = num(r.slow) || (num(r.Uvis) > 0 ? U / r.Uvis : NaN);
    const sepOK = a.sepDeg != null && isFinite(a.sepDeg);
    const t = {
      FD: num(a.FD), FL: num(a.FL), CD: num(a.CD), CL: num(a.CL), LD: num(a.LD),
      frontPa: num(sf.frontPa), frontN: num(sf.frontN),
      fShed: wake === 'street' && a.fShed > 0 ? num(a.fShed) : NaN,
      U, kmh: U * 3.6, M, Re: num(a.Re), q: num(a.q), p0: num(a.p0), T0: num(a.T0) - 273.15,
      mach: M > 1 ? num(a.machAngleDeg) : NaN, St: num(a.St),
      rho: num(air.rho), p: num(air.p), T: num(air.T), mu: num(air.mu), a: num(air.a),
      CDp: Math.max(0, num(a.CDp) || 0), CDf: Math.max(0, num(a.CDf) || 0), CDi: Math.max(0, num(a.CDi) || 0), CDw: Math.max(0, num(a.CDw) || 0),
      power: num(a.power), buoy: num(a.buoyancy), sep: sepOK ? num(a.sepDeg) : NaN, Aref: num(a.Aref), Lref: num(a.Lref),
      slow,
      cpMax: sf.cpRange ? num(sf.cpRange[1]) : NaN, q2: num(a.q)
    };
    if (pr && typeof pr === 'object') {
      const k = PROBE_SPEED_IS_VISUAL && slow > 0 ? slow : 1;
      t.pSpeed = num(pr.speed) * k; t.pP = num(pr.p); t.pCp = num(pr.cp);
    } else { t.pSpeed = NaN; t.pP = NaN; t.pCp = NaN; }
    return t;
  }

  /* ---------- DOM ---------- */
  const el = {};   // value nodes by key
  function tile(key, labelNode, cls, withUnit) {
    const v = h('b', { class: 'p8-num' }), u = h('span', { class: 'p8-u' }), w = h('span', { class: 'p8-w' });
    el[key] = { v, u, w };
    return h('div', { class: 'readout p8-tile ' + (cls || ''), 'data-k': key },
      h('span', { class: 'p8-tile-l' }, labelNode),
      h('span', { class: 'p8-tile-v' }, v, u, w));
  }
  function kvRow(key, label, extra) {
    const v = h('span', { class: 'p8-num' }), w = h('span', { class: 'p8-w' });
    el[key] = { v, w };
    const row = h('div', { class: 'kv p8-kv', 'data-k': key }, h('span', null, label), h('span', null, v, extra ? ' ' : null, w));
    el[key].row = row;
    return row;
  }
  const group = (title, kids) => h('section', { class: 'p8-stack', style: 'gap:4px' }, h('h4', { class: 'p8-h', text: title }), kids);

  const mainGroup = group('Chính', h('div', { class: 'p8-grid' },
    tile('FD', sym('F', 'cản'), 'p8-w6'),
    tile('FL', sym('F', 'nâng'), 'p8-w6'),
    tile('CD', sym('C', 'D')),
    tile('CL', sym('C', 'L')),
    tile('LD', h('span', null, 'F nâng / F cản')),
    tile('front', h('span', null, 'Áp lực mặt trước'), 'p8-w6'),
    tile('fShed', h('span', null, 'Tần số tách xoáy f'), 'p8-w6')));

  const probeGroup = group('Đầu dò', h('div', { class: 'p8-kvs' },
    kvRow('pSpeed', 'v cục bộ'), kvRow('pP', 'p cục bộ'), kvRow('pCp', h('span', null, 'C', h('span', { class: 'p8-s' }, 'p'))),
    h('div', { class: 'p8-hint', 'data-k': 'wake' })));
  const wakeNote = probeGroup.querySelector('[data-k="wake"]');
  setShown(probeGroup, false);

  const flowGroup = group('Dòng khí', h('div', { class: 'p8-kvs' },
    kvRow('vel', 'v', true), kvRow('M', 'Số Mach', true), kvRow('Re', 'Số Reynolds', true),
    kvRow('q', 'Áp suất động q'), kvRow('p0', h('span', null, 'Áp suất toàn phần p', h('span', { class: 'p8-s' }, '0'))),
    kvRow('T0', h('span', null, 'Nhiệt độ hãm T', h('span', { class: 'p8-s' }, '0'))),
    kvRow('mach', 'Góc Mach'), kvRow('St', 'Số Strouhal')));
  const airGroup = group('Không khí', h('div', { class: 'p8-kvs' },
    kvRow('rho', 'Khối lượng riêng ρ'), kvRow('p', 'Áp suất p'), kvRow('T', 'Nhiệt độ T'), kvRow('mu', 'Độ nhớt μ'), kvRow('a', 'Tốc độ âm thanh a')));

  const seg = { p: h('i'), f: h('i'), i: h('i'), w: h('i') };
  const barLegend = {
    p: h('span', null, h('i', { style: 'background:' + C.cdPressure }), 'Áp suất ', h('span', { class: 'p8-num' })),
    f: h('span', null, h('i', { style: 'background:' + C.cdFriction }), 'Ma sát ', h('span', { class: 'p8-num' })),
    i: h('span', null, h('i', { style: 'background:' + C.cdInduced }), 'Cảm ứng ', h('span', { class: 'p8-num' })),
    w: h('span', null, h('i', { style: 'background:' + C.cdWave }), 'Sóng ', h('span', { class: 'p8-num' }))
  };
  seg.p.style.background = C.cdPressure; seg.f.style.background = C.cdFriction; seg.i.style.background = C.cdInduced; seg.w.style.background = C.cdWave;
  const stack = h('div', { class: 'p8-bar', role: 'img', 'aria-label': 'Thành phần lực cản' }, seg.p, seg.f, seg.i, seg.w);
  const stackBox = h('div', null, h('div', { class: 'p8-lab', text: 'Thành phần lực cản' }), stack, h('div', { class: 'p8-bar-l' }, barLegend.p, barLegend.f, barLegend.i, barLegend.w));
  const analysisGroup = group('Phân tích', h('div', { class: 'p8-stack', style: 'gap:6px' }, stackBox, h('div', { class: 'p8-kvs' },
    kvRow('power', 'Công suất thắng lực cản P = F·v'),
    kvRow('buoy', 'Lực đẩy Archimedes (trong không khí)', true),
    kvRow('sep', 'Góc tách dòng'),
    kvRow('Aref', 'Diện tích tham chiếu A', true),
    kvRow('Lref', 'Chiều dài tham chiếu L'))));

  const detail = h('div', { class: 'p8-stack', id: 'p8-detail' }, flowGroup, airGroup, analysisGroup);
  const toggle = h('button', { type: 'button', class: 'btn p8-btn', 'aria-expanded': 'false', 'aria-controls': 'p8-detail', onClick: () => setExpanded(!expanded) }, 'Thêm số đo');
  let expanded = false;
  function setExpanded(on) {
    expanded = !!on;
    setShown(detail, expanded);
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    setText(toggle, expanded ? 'Ẩn bớt số đo' : 'Thêm số đo');
    if (root) root.classList.toggle('p8-expanded', expanded);
  }
  if (root) {
    root.textContent = '';
    root.appendChild(h('div', { class: 'p8-stack' }, mainGroup, probeGroup, toggle, detail));
    setExpanded(false);
  }

  /* HUD */
  const hudF = { FD: h('span', { class: 'p8-num' }), FL: h('span', { class: 'p8-num' }), U: h('span', { class: 'p8-num' }), slow: h('span', { class: 'p8-num' }) };
  if (hudEl) {
    hudEl.textContent = '';
    hudEl.appendChild(h('div', { class: 'p8-hud' },
      h('span', null, sym('F', 'cản'), ' ', hudF.FD), h('span', null, sym('F', 'nâng'), ' ', hudF.FL),
      h('span', null, 'v ', hudF.U), h('span', { class: 'p8-sub' }, 'Mô phỏng chậm ', hudF.slow)));
  }

  /* Legend */
  const lg = { box: h('div', { class: 'p8-lg' }), heat: null, part: null };
  function legendBlock(title) {
    const cv = h('canvas', { 'aria-hidden': 'true', height: 12 });
    const t = h('div', { class: 'p8-lg-t' }, h('span', { text: title }), h('span', { class: 'p8-num' }));
    const r1 = h('div', { class: 'p8-lg-r' }), r2 = h('div', { class: 'p8-lg-r' });
    const box = h('div', null, t, cv, r1, r2);
    return { box, cv, t: t.children[0], t2: t.children[1], r1, r2, key: '' };
  }
  lg.heat = legendBlock(''); lg.part = legendBlock('');
  if (legendEl) {
    legendEl.textContent = '';
    lg.box.appendChild(lg.heat.box); lg.box.appendChild(lg.part.box);
    legendEl.appendChild(lg.box);
  }
  function paintBar(block, colorAt) {
    const cv = block.cv, W = Math.max(40, Math.round(cv.clientWidth || 160)), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(12 * dpr);
    const g = cv.getContext('2d'); if (!g) return;
    const bands = 32, bw = cv.width / bands;
    for (let i = 0; i < bands; i++) {
      const c = colorAt((i + 0.5) / bands);
      g.fillStyle = 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
      g.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, cv.height);
    }
    g.strokeStyle = 'rgba(27,29,33,.35)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, cv.width - 1, cv.height - 1);
  }
  function ticks(block, items) {   // items [{f, a, b}] f in 0..1
    for (const row of [block.r1, block.r2]) row.textContent = '';
    items.forEach((it, i) => {
      const cls = i === 0 ? 'p8-first' : i === items.length - 1 ? 'p8-last' : '';
      const mk = txt => h('span', { class: cls + (/^[\d\u2212\-,.\s\u202F\u2009]*$/.test(txt) ? ' p8-num' : ''), style: 'left:' + (it.f * 100).toFixed(2) + '%' }, txt);
      block.r1.appendChild(mk(it.a)); block.r2.appendChild(mk(it.b));
    });
  }
  function drawLegend(force) {
    if (!legendEl) return;
    const v = state.get().view, q = cur.q, cpMax = Math.max(0.5, isFinite(cur.cpMax) ? cur.cpMax : 1);
    const wide = (legendEl.clientWidth || 300) >= 300;
    // heatmap
    const showHeat = v.heatmap === 'pressure' || v.heatmap === 'friction';
    setShown(lg.heat.box, showHeat);
    if (showHeat) {
      if (v.heatmap === 'pressure') {
        const qk = isFinite(q) ? Math.round(q) : 0, key = 'p|' + qk + '|' + cpMax.toFixed(2) + '|' + wide;
        if (force || lg.heat.key !== key) {
          lg.heat.key = key;
          setText(lg.heat.t, 'Bản đồ áp suất'); setText(lg.heat.t2, 'C_p  ·  Pa');
          const span = cpMax - PRESSURE_CP_MIN, pos = cp => (cp - PRESSURE_CP_MIN) / span;
          paintBar(lg.heat, t => pressureColor(PRESSURE_CP_MIN + t * span, cpMax));
          let cps = wide ? [-1.5, -1, -0.5, 0, 0.5, 1] : [-1.5, 0, 1];
          cps = cps.filter(c => c < cpMax - 0.12);
          cps.push(cpMax);
          ticks(lg.heat, cps.map(cp => ({ f: pos(cp), a: fmtFixed(cp, cp === cpMax ? 2 : 1), b: isFinite(q) ? fmtNum(cp * q, { sig: 3 }) : DASH })));
        }
      } else if (force || lg.heat.key !== 'f') {
        lg.heat.key = 'f';
        setText(lg.heat.t, 'Ứng suất ma sát'); setText(lg.heat.t2, '');
        paintBar(lg.heat, t => rampColor(C.friction, t));
        ticks(lg.heat, [{ f: 0, a: 'thấp', b: '' }, { f: 1, a: 'cao', b: '' }]);
      }
    }
    // particle speed map
    const showPart = v.flow === 'particles';
    setShown(lg.part.box, showPart);
    if (showPart) {
      const U = isFinite(cur.U) ? Math.round(cur.U * 10) / 10 : 0, key = 'u|' + U + '|' + wide;
      if (force || lg.part.key !== key) {
        lg.part.key = key;
        setText(lg.part.t, 'Tốc độ hạt |u|/U'); setText(lg.part.t2, '|u|/U  ·  m/s');
        paintBar(lg.part, t => rampColor(C.speed, t));
        const fr = wide ? [0, 0.4, 0.8, 1.2, 1.6] : [0, 0.8, 1.6];
        ticks(lg.part, fr.map(x => ({ f: x / 1.6, a: fmtFixed(x, 1), b: fmtNum(x * U) })));
      }
    }
    setShown(lg.box, showHeat || showPart);
  }

  /* ---------- paint ---------- */
  function setTile(k, valText, unit, word) {
    const e = el[k]; if (!e) return;
    setText(e.v, valText); if (e.u) setText(e.u, valText === DASH ? '' : (unit ? NB + unit : ''));
    if (e.w) setText(e.w, word || '');
  }
  function setKv(k, valText, word) { const e = el[k]; setText(e.v, valText); if (e.w) setText(e.w, word || ''); }
  function paint() {
    const c = cur, r = lastRes || {}, a = r.aero || {}, rg = a.regime || {};
    drawn = {};
    const D = (k, txt) => { drawn[k] = txt; return txt; };
    setTile('FD', D('FD', fmtNum(c.FD)), 'N'); setTile('FL', D('FL', fmtNum(c.FL)), 'N');
    setTile('CD', D('CD', fmtNum(c.CD)), ''); setTile('CL', D('CL', fmtNum(c.CL)), '');
    setTile('LD', D('LD', fmtNum(c.LD)), '');
    const fp = fmtNum(c.frontPa), fn = fmtNum(c.frontN);
    setTile('front', D('front', fp === DASH ? DASH : fp + NB + 'Pa · ' + fn + NB + 'N'), '');
    const street = isFinite(c.fShed);
    setTile('fShed', D('fShed', street ? fmtNum(c.fShed) : DASH), 'Hz', WORD_WAKE[rg.wake] || '');
    setKv('vel', D('vel', fmtVal(c.U, 'm/s') + ' · ' + fmtVal(c.kmh, 'km/h')));
    setKv('M', D('M', fmtNum(c.M)), WORD_FLOW[rg.flow] || '');
    setKv('Re', D('Re', fmtRe(c.Re)), WORD_BL[rg.bl] || '');
    setKv('q', D('q', fmtVal(c.q, 'Pa'))); setKv('p0', D('p0', fmtVal(c.p0, 'Pa')));
    setKv('T0', D('T0', fmtVal(c.T0, '°C')));
    const showMach = isFinite(c.mach);
    setShown(el.mach.row, showMach); setKv('mach', D('mach', showMach ? fmtDeg(c.mach) : DASH));
    setKv('St', D('St', fmtNum(c.St)));
    setKv('rho', D('rho', fmtVal(c.rho, 'kg/m³'))); setKv('p', D('p', fmtVal(c.p / 1000, 'kPa')));
    setKv('T', D('T', fmtVal(c.T - 273.15, '°C') + ' (' + fmtVal(c.T, 'K') + ')'));
    setKv('mu', D('mu', fmtVal(c.mu, 'Pa·s'))); setKv('a', D('a', fmtVal(c.a, 'm/s')));
    // drag split
    const parts = { p: c.CDp, f: c.CDf, i: c.CDi, w: c.CDw };
    const sum = (parts.p || 0) + (parts.f || 0) + (parts.i || 0) + (parts.w || 0);
    for (const k of ['p', 'f', 'i', 'w']) {
      const pct = sum > 0 ? 100 * (parts[k] || 0) / sum : 0;
      const present = k === 'p' || k === 'f' ? sum > 0 : (parts[k] > 1e-4 && pct >= 0.5);
      seg[k].style.width = (present ? pct : 0).toFixed(2) + '%';
      setShown(barLegend[k], present);
      setText(barLegend[k].lastChild, fmtPct(pct));
    }
    const P = c.power;
    setKv('power', D('power', Math.abs(P) >= 1000 ? fmtVal(P / 1000, 'kW') : fmtVal(P, 'W')));
    setKv('buoy', D('buoy', fmtVal(c.buoy, 'N')), '(khác F nâng: ' + fmtVal(c.FL, 'N') + ')');
    setKv('sep', D('sep', isFinite(c.sep) ? fmtDeg(c.sep) : DASH));
    setKv('Aref', D('Aref', fmtVal(c.Aref, 'm²')), a.ArefKind ? '(' + (WORD_AREF[a.ArefKind] || a.ArefKind) + ')' : '');
    setKv('Lref', D('Lref', fmtVal(c.Lref, 'm')));
    // probe
    const on = !!state.get().probe.on && r.probe;
    setShown(probeGroup, !!on);
    if (on) {
      setKv('pSpeed', D('pSpeed', fmtVal(c.pSpeed, 'm/s') + ' · ' + fmtVal(c.pSpeed * 3.6, 'km/h')));
      setKv('pP', D('pP', fmtVal(c.pP, 'Pa'))); setKv('pCp', D('pCp', fmtNum(c.pCp)));
      setShown(wakeNote, !!r.probe.inWake);
      setText(wakeNote, r.probe.inWake ? 'Đầu dò đang nằm trong vùng sau vật: dòng xoáy, tốc độ nhỏ, áp suất gần áp suất đáy.' : '');
    }
    // HUD
    setText(hudF.FD, D('hudFD', fmtVal(c.FD, 'N'))); setText(hudF.FL, D('hudFL', fmtVal(c.FL, 'N')));
    setText(hudF.U, D('hudU', fmtVal(c.U, 'm/s'))); setText(hudF.slow, D('hudSlow', '×' + fmtNum(c.slow, { sig: 2 })));
    drawLegend(false);
  }

  /** feed one results frame; dt in seconds (taken from the clock when omitted) */
  function feed(res, dt) {
    if (!res) return;
    const now = performance.now();
    if (dt == null) dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
    lastT = now;
    lastRes = res;
    const t = extract(res);
    for (const id of IDS) if (id in t) cur[id] = S[id].update(t[id], dt);
    sinceDraw += dt;
    if (sinceDraw >= 1 / 12 || dt === 0) { sinceDraw = 0; paint(); }
  }

  const offs = [
    state.on('results', r => feed(r, null)),
    state.on('readouts:expand', () => setExpanded(true)),
    state.on('change:view', () => drawLegend(true)),
    state.on('change:probe', () => { if (lastRes) paint(); })
  ];
  let ro = null;
  if (legendEl && typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => drawLegend(true));
    ro.observe(legendEl);
  }
  drawLegend(true);

  return {
    feed, paint, setExpanded,
    values: () => ({ ...cur }),
    text: () => ({ ...drawn }),
    reset() { IDS.forEach(id => S[id].reset()); cur = {}; },
    destroy() { offs.forEach(f => f && f()); if (ro) ro.disconnect(); }
  };
}
