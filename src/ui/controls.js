// controls.js (P8): #dock, #viewPanel, #envPanel, scenarios menu, probe dragging.
import {
  WIND_PRESETS, SCENARIOS, ALPHA_MIN, ALPHA_MAX, ALPHA_DETENT, ENV_LIMITS, RHO_LIMITS, R_AIR,
  presetU, sliderToU, uToSlider, clampU, roundU, clamp, msToKmh, linkEnv, rhoOf,
  fmtNum, fmtFixed, fmtVal, fmtDeg, parseNum, makePin, makeSnapshot, h, setShown, setText, ensureStyles, NB, C
} from '../config.js';

const CAMERAS = [['overview', 'Tổng quan'], ['side', 'Cạnh bên'], ['top', 'Từ trên'], ['wake', 'Phía sau'], ['inside', 'Trong ống']];
const SMOKE = [['white', 'Trắng'], ['red', 'Đỏ'], ['blue', 'Xanh'], ['orange', 'Cam'], ['multi', 'Đa sắc']];
const FLOWS = [['smoke', 'Khói'], ['particles', 'Hạt'], ['vectors', 'Vectơ']];

export function init(ctx) {
  ensureStyles();
  const { state, atmo, scene, sfx } = ctx;
  const $ = id => document.getElementById(id);
  const dock = $('dock'), viewPanel = $('viewPanel'), envPanel = $('envPanel');

  /* ---------- helpers ---------- */
  let lastTick = 0;
  const play = (kind, throttle) => {
    try {
      if (state.get().sound === false || !sfx || !sfx.play) return;
      const now = performance.now();
      if (throttle && now - lastTick < throttle) return;
      lastTick = now;
      sfx.play(kind);
    } catch (e) { /* sound must never break controls */ }
  };
  const air = () => atmo.air(state.get().env);
  const setView = patch => state.set({ view: { ...state.get().view, ...patch } });

  function seg(options, onPick, label) {
    const btns = new Map();
    const el = h('div', { class: 'seg p8-seg', role: 'radiogroup', 'aria-label': label || null });
    for (const [value, text] of options) {
      const b = h('button', {
        type: 'button', class: 'btn', role: 'radio', 'aria-pressed': 'false', 'aria-checked': 'false', 'data-v': String(value),
        onClick: () => { play('toggle'); onPick(value); }
      }, text);
      btns.set(String(value), b);
      el.appendChild(b);
    }
    return {
      el,
      set(value) {
        for (const [k, b] of btns) {
          const on = k === String(value);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          b.setAttribute('aria-checked', on ? 'true' : 'false');
          b.classList.toggle('is-active', on);
        }
      }
    };
  }
  function slider(min, max, step, onInput, label) {
    const input = h('input', { type: 'range', class: 'slider', min, max, step, 'aria-label': label });
    input.addEventListener('input', () => onInput(+input.value));
    return input;
  }

  /* ---------- panels ---------- */
  function setPanel(el, open) {
    if (!el) return;
    el.hidden = !open;
    el.style.display = open ? '' : 'none';
    el.classList.toggle('is-open', !!open);
    el.setAttribute('aria-hidden', open ? 'false' : 'true');
    el.dispatchEvent(new CustomEvent('panel:toggle', { detail: { open: !!open } }));
    syncButtons();
  }
  const isOpen = el => !!el && !el.hidden && el.style.display !== 'none';
  function togglePanel(el, other) {
    const open = !isOpen(el);
    if (open && other) setPanel(other, false);
    setPanel(el, open);
    play('tap');
  }
  function panelHead(title, el) {
    return h('div', { class: 'p8-ph' },
      h('h3', { class: 'p8-h', text: title }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Đóng', onClick: () => { setPanel(el, false); play('tap'); } }, '×'));
  }

  /* ---------- DOM: dock ---------- */
  const uVal = h('span', { class: 'p8-val p8-num', 'aria-live': 'off' });
  const uRange = slider(uToSlider(1), 1, 0.001, s => {
    const U = roundU(clampU(sliderToU(s)));
    play('tick', 70);
    self = true; state.set({ U }); self = false; syncWind(true);
  }, 'Tốc độ gió');
  const machTick = h('i', { class: 'p8-tick', 'aria-hidden': 'true' });
  const machTickL = h('span', { class: 'p8-tick-l', 'aria-hidden': 'true' }, 'M 1');
  const uNum = h('input', { type: 'text', inputmode: 'decimal', class: 'p8-in p8-num', 'aria-label': 'Nhập tốc độ gió (m/s)', autocomplete: 'off' });
  const commitU = () => {
    const v = parseNum(uNum.value);
    if (isFinite(v)) { state.set({ U: roundU(clampU(v)) }); play('tap'); }
    syncWind();
  };
  uNum.addEventListener('change', commitU);
  uNum.addEventListener('keydown', e => { if (e.key === 'Enter') { commitU(); uNum.blur(); } });
  const presetBtns = WIND_PRESETS.map(p => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-preset': p.id,
    onClick: () => { play('tap'); state.set({ U: roundU(clampU(presetU(p, air().a))) }); }
  }, p.mach ? p.label + ' M ' + fmtNum(p.mach, { sig: 2 }) : p.label + ' ' + p.U));

  const aVal = h('span', { class: 'p8-val p8-num' });
  let kbAlpha = false;
  const aRange = slider(ALPHA_MIN, ALPHA_MAX, 0.1, v => {
    stopSweep();
    if (!kbAlpha && Math.abs(v) < ALPHA_DETENT) { v = 0; aRange.value = '0'; }
    v = Math.round(v * 10) / 10;
    if (v !== state.get().alphaDeg) {
      if (v === 0 || Math.round(v) !== Math.round(state.get().alphaDeg)) play('tick', 60);
      self = true; state.set({ alphaDeg: v }); self = false;
    }
    setText(aVal, fmtDeg(v));
  }, 'Góc tấn');
  aRange.addEventListener('keydown', () => { kbAlpha = true; });
  aRange.addEventListener('pointerdown', () => { kbAlpha = false; stopSweep(); });
  const zeroPct = (0 - ALPHA_MIN) / (ALPHA_MAX - ALPHA_MIN);
  const tickPos = (el, f) => { el.style.left = 'calc(var(--p8-thumb,20px) / 2 + (100% - var(--p8-thumb,20px)) * ' + f + ')'; };
  const zeroTick = h('i', { class: 'p8-tick p8-zero', 'aria-hidden': 'true' });
  const zeroTickL = h('span', { class: 'p8-tick-l p8-zero', 'aria-hidden': 'true' }, '0°');
  tickPos(zeroTick, zeroPct); tickPos(zeroTickL, zeroPct);

  const flowSeg = seg(FLOWS, v => setView({ flow: v }), 'Kiểu dòng khí');
  const camSeg = seg(CAMERAS, v => { state.set({ camera: v }); try { scene && scene.setCamera && scene.setCamera(v); } catch (e) { /* ignore */ } }, 'Góc nhìn');
  const probeBtn = h('button', {
    type: 'button', class: 'btn', 'aria-pressed': 'false', onClick: () => {
      const p = state.get().probe; play('toggle'); state.set({ probe: { ...p, on: !p.on } });
    }
  }, 'Đầu dò');
  const viewBtn = h('button', { type: 'button', class: 'btn', 'aria-expanded': 'false', onClick: () => togglePanel(viewPanel, envPanel) }, 'Hiển thị');
  const envBtn = h('button', { type: 'button', class: 'btn', 'aria-expanded': 'false', onClick: () => togglePanel(envPanel, viewPanel) }, 'Không khí');
  const scBtn = h('button', { type: 'button', class: 'btn btn-primary', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onClick: () => toggleMenu() }, 'Thí nghiệm gợi ý');

  const taskText = h('span');
  const taskBox = h('div', { class: 'p8-task', role: 'note', hidden: true, style: 'display:none' },
    taskText,
    h('button', { type: 'button', class: 'btn', onClick: () => { stopSweep(); setShown(taskBox, false); play('tap'); } }, 'Xong'));

  const extra = h('div', { class: 'p8-stack p8-extra p8-collapsed' },
    h('div', { class: 'p8-stack' }, h('span', { class: 'p8-lab' }, 'Dòng khí'), flowSeg.el),
    h('div', { class: 'p8-row' }, viewBtn, envBtn, probeBtn),
    h('div', { class: 'p8-stack' }, h('span', { class: 'p8-lab' }, 'Góc nhìn'), camSeg.el));
  const moreBtn = h('button', {
    type: 'button', class: 'btn p8-more', 'aria-expanded': 'false', onClick: () => {
      const open = extra.classList.contains('p8-collapsed');
      extra.classList.toggle('p8-collapsed', !open);
      moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      setText(moreBtn, open ? 'Bớt điều khiển' : 'Thêm điều khiển');
      play('tap');
    }
  }, 'Thêm điều khiển');

  if (dock) {
    dock.textContent = '';
    dock.appendChild(h('div', { class: 'p8-stack' },
      taskBox,
      h('div', { class: 'p8-stack' },
        h('div', { class: 'p8-row p8-between' }, h('span', { class: 'p8-lab' }, 'Tốc độ gió'), uVal),
        h('div', { class: 'p8-row' },
          h('div', { class: 'p8-sw' }, machTickL, machTick, uRange),
          uNum, h('span', { class: 'p8-lab' }, 'm/s')),
        h('div', { class: 'p8-chips' }, presetBtns)),
      h('div', { class: 'p8-stack' },
        h('div', { class: 'p8-row p8-between' }, h('span', { class: 'p8-lab' }, 'Góc tấn α'), aVal),
        h('div', { class: 'p8-sw' }, zeroTickL, zeroTick, aRange)),
      h('div', { class: 'p8-row p8-half' }, scBtn, moreBtn),
      extra));
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      dock.classList.toggle('p8-narrow', dock.clientWidth < 520);
    }) : null;
    if (ro) ro.observe(dock); else dock.classList.toggle('p8-narrow', (dock.clientWidth || 360) < 520);
  }

  /* ---------- DOM: view panel ---------- */
  const smokeBtns = new Map();
  const smokeRow = h('div', { class: 'p8-chips', role: 'radiogroup', 'aria-label': 'Màu khói' });
  for (const [id, name] of SMOKE) {
    const sw = id === 'multi'
      ? h('span', { class: 'p8-swatch' }, C.multi.map(c => h('i', { style: 'background:' + c })))
      : h('span', { class: 'p8-swatch', style: 'background:' + C.smoke[id] });
    const b = h('button', {
      type: 'button', class: 'chip', role: 'radio', 'aria-pressed': 'false',
      onClick: () => { play('toggle'); setView({ smokeColor: id }); }
    }, sw, name);
    smokeBtns.set(id, b);
    smokeRow.appendChild(b);
  }
  const densVal = h('span', { class: 'p8-val p8-num' });
  const densRange = slider(0.1, 1, 0.05, v => { play('tick', 70); selfView = true; setView({ density: v }); selfView = false; setText(densVal, Math.round(v * 100) + NB + '%'); }, 'Độ đậm khói');
  const linesVal = h('span', { class: 'p8-val p8-num' });
  const linesRange = slider(6, 24, 1, v => { play('tick', 70); selfView = true; setView({ lines: v }); selfView = false; setText(linesVal, String(v)); }, 'Số đường khói');
  const rakeSeg = seg([['plane', 'Mặt phẳng'], ['grid', 'Lưới 3D']], v => setView({ rake: v }), 'Giá phun khói');
  const heatSeg = seg([['off', 'Tắt'], ['pressure', 'Áp suất'], ['friction', 'Ma sát']], v => setView({ heatmap: v }), 'Bản đồ nhiệt');
  const forcesSeg = seg([[true, 'Bật'], [false, 'Tắt']], v => setView({ forces: v }), 'Mũi tên lực');
  const shockSeg = seg([[true, 'Bật'], [false, 'Tắt']], v => setView({ shock: v }), 'Sóng xung kích');
  if (viewPanel) {
    viewPanel.textContent = '';
    viewPanel.appendChild(h('div', { class: 'p8-stack' },
      panelHead('Hiển thị', viewPanel),
      h('div', { class: 'p8-stack' }, h('span', { class: 'p8-lab' }, 'Màu khói'), smokeRow),
      h('div', { class: 'p8-stack' }, h('div', { class: 'p8-row p8-between' }, h('span', { class: 'p8-lab' }, 'Độ đậm'), densVal), densRange),
      h('div', { class: 'p8-stack' }, h('div', { class: 'p8-row p8-between' }, h('span', { class: 'p8-lab' }, 'Số đường khói'), linesVal), linesRange),
      h('div', { class: 'p8-stack' }, h('span', { class: 'p8-lab' }, 'Giá phun khói'), rakeSeg.el),
      h('div', { class: 'p8-stack' }, h('span', { class: 'p8-lab' }, 'Bản đồ nhiệt'), heatSeg.el),
      h('div', { class: 'p8-stack' }, h('span', { class: 'p8-lab' }, 'Mũi tên lực'), forcesSeg.el),
      h('div', { class: 'p8-stack' }, h('span', { class: 'p8-lab' }, 'Sóng xung kích'), shockSeg.el)));
  }

  /* ---------- DOM: env panel ---------- */
  const envMode = seg([['altitude', 'Độ cao giả lập'], ['custom', 'Tùy chỉnh']], v => setEnvMode(v), 'Chế độ không khí');
  const hVal = h('span', { class: 'p8-val p8-num' });
  const hRange = slider(ENV_LIMITS.hKm[0], ENV_LIMITS.hKm[1], 0.1, km => {
    const a = atmo.air({ mode: 'altitude', h: km * 1000 });
    play('tick', 70); selfEnv = 'h';
    state.set({ env: { ...state.get().env, mode: 'altitude', h: Math.round(km * 1000), T: a.T, p: a.p } });
    selfEnv = null;
  }, 'Độ cao giả lập');
  const roKvs = {
    T: h('span', { class: 'p8-num' }), p: h('span', { class: 'p8-num' }), rho: h('span', { class: 'p8-num' })
  };
  const kv = (label, el) => h('div', { class: 'kv p8-kv' }, h('span', null, label), el);
  const altBlock = h('div', { class: 'p8-stack' },
    h('div', { class: 'p8-stack' }, h('div', { class: 'p8-row p8-between' }, h('span', { class: 'p8-lab' }, 'Độ cao'), hVal), hRange),
    h('div', { class: 'p8-kvs' }, kv('Nhiệt độ T', roKvs.T), kv('Áp suất p', roKvs.p), kv('Khối lượng riêng ρ', roKvs.rho)));
  const tVal = h('span', { class: 'p8-val p8-num' }), pVal = h('span', { class: 'p8-val p8-num' }), rVal = h('span', { class: 'p8-val p8-num' });
  const edit = (kind, v) => {
    const e = state.get().env;
    const T = e.mode === 'custom' ? e.T : air().T, p = e.mode === 'custom' ? e.p : air().p;
    const r = linkEnv(kind, v, T, p);
    selfEnv = kind;
    state.set({ env: { ...e, mode: 'custom', T: r.T, p: r.p } });
    selfEnv = null;
  };
  const tRange = slider(ENV_LIMITS.Tc[0], ENV_LIMITS.Tc[1], 'any', v => { play('tick', 70); edit('T', v); }, 'Nhiệt độ T');
  const pRange = slider(ENV_LIMITS.pkPa[0], ENV_LIMITS.pkPa[1], 'any', v => { play('tick', 70); edit('p', v); }, 'Áp suất p');
  const rRange = slider(RHO_LIMITS[0], RHO_LIMITS[1], 'any', v => { play('tick', 70); edit('rho', v); }, 'Khối lượng riêng');
  const customBlock = h('div', { class: 'p8-stack' },
    h('div', { class: 'p8-stack' }, h('div', { class: 'p8-row p8-between' }, h('span', { class: 'p8-lab' }, 'Nhiệt độ T'), tVal), tRange),
    h('div', { class: 'p8-stack' }, h('div', { class: 'p8-row p8-between' }, h('span', { class: 'p8-lab' }, 'Áp suất p'), pVal), pRange),
    h('div', { class: 'p8-stack' }, h('div', { class: 'p8-row p8-between' }, h('span', { class: 'p8-lab' }, 'Khối lượng riêng ρ'), rVal), rRange));
  if (envPanel) {
    envPanel.textContent = '';
    envPanel.appendChild(h('div', { class: 'p8-stack' },
      panelHead('Không khí', envPanel),
      envMode.el, altBlock, customBlock,
      h('p', { class: 'p8-hint', text: 'p = ρ·R·T, với R = 287,05 J/(kg·K). Lực cản và lực nâng tỉ lệ với ρ.' })));
  }
  function setEnvMode(mode) {
    const e = state.get().env;
    if (mode === 'custom') {
      const a = atmo.air(e);
      const r = linkEnv('p', a.p / 1000, clamp(a.T, ENV_LIMITS.Tc[0] + 273.15, ENV_LIMITS.Tc[1] + 273.15), a.p);
      state.set({ env: { ...e, mode: 'custom', T: r.T, p: r.p } });
    } else {
      const a = atmo.air({ mode: 'altitude', h: e.h });
      state.set({ env: { ...e, mode: 'altitude', T: a.T, p: a.p } });
    }
  }

  /* ---------- scenarios menu ---------- */
  let menu = null, offMenu = [];
  function closeMenu() {
    if (!menu) return;
    menu.remove(); menu = null;
    offMenu.forEach(f => f()); offMenu = [];
    scBtn.setAttribute('aria-expanded', 'false');
  }
  function toggleMenu() {
    if (menu) { closeMenu(); return; }
    play('tap');
    menu = h('div', { class: 'popover p8-pop', role: 'menu', 'aria-label': 'Thí nghiệm gợi ý' },
      SCENARIOS.map((sc, i) => h('button', {
        type: 'button', class: 'p8-sc', role: 'menuitem',
        onClick: () => { closeMenu(); runScenario(sc); }
      }, h('strong', null, (i + 1) + '. ' + sc.title), h('span', null, sc.sub))));
    document.body.appendChild(menu);
    const r = scBtn.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    const left = clamp(r.left, 8, Math.max(8, innerWidth - mw - 8));
    menu.style.left = left + 'px';
    if (innerHeight - r.bottom - 8 >= mh || r.top < mh) menu.style.top = clamp(r.bottom + 6, 8, Math.max(8, innerHeight - mh - 8)) + 'px';
    else menu.style.top = Math.max(8, r.top - mh - 6) + 'px';
    scBtn.setAttribute('aria-expanded', 'true');
    const onDown = e => { if (menu && !menu.contains(e.target) && !scBtn.contains(e.target)) closeMenu(); };
    const onKey = e => { if (e.key === 'Escape') { closeMenu(); scBtn.focus(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    offMenu.push(() => document.removeEventListener('pointerdown', onDown, true), () => document.removeEventListener('keydown', onKey));
  }

  let sweepRaf = 0;
  function stopSweep() { if (sweepRaf) { cancelAnimationFrame(sweepRaf); sweepRaf = 0; } }
  function startSweep(sw) {
    stopSweep();
    const t0 = performance.now();
    const step = now => {
      const k = clamp((now - t0) / (sw.seconds * 1000), 0, 1);
      state.set({ alphaDeg: Math.round((sw.from + (sw.to - sw.from) * k) * 100) / 100 });
      sweepRaf = k < 1 ? requestAnimationFrame(step) : 0;
    };
    sweepRaf = requestAnimationFrame(step);
  }
  function runScenario(sc) {
    if (typeof sc === 'string') sc = SCENARIOS.find(s => s.id === sc);
    if (!sc) return;
    stopSweep();
    const st = state.get();
    let env = st.env;
    if (sc.env === 'sea') { const a = atmo.air({ mode: 'altitude', h: 0 }); env = { mode: 'altitude', h: 0, T: a.T, p: a.p }; }
    const a = atmo.air(env);
    const alphaDeg = sc.sweep ? sc.sweep.from : sc.alphaDeg;
    const patch = {
      mode: 'library', modelId: sc.modelId, alphaDeg, env,
      U: roundU(clampU(sc.mach ? sc.mach * a.a : sc.U)),
      camera: sc.camera, view: { ...st.view, flow: sc.flow, ...(sc.shock ? { shock: true } : {}) }
    };
    patch.pins = sc.pin.map(id => makePin(ctx, makeSnapshot({ ...st, ...patch }, { mode: 'library', modelId: id, alphaDeg })));
    state.set(patch);
    try { scene && scene.setCamera && scene.setCamera(sc.camera); } catch (e) { /* ignore */ }
    state.emit('chart:tab', { tab: sc.tab, metric: sc.metric });
    if (sc.clearTime) state.emit('chart:clear');
    state.emit('charts:show', { tab: sc.tab });
    if (sc.expand) state.emit('readouts:expand');
    setText(taskText, sc.task);
    setShown(taskBox, true);
    if (sc.sweep) startSweep(sc.sweep);
    play('swap');
  }

  /* ---------- probe: tap or drag on the 3D view ---------- */
  const canvas = scene && scene.renderer && scene.renderer.domElement;
  let dragging = false, savedTouch = '';
  function moveProbe(e) {
    const p = scene.raycastMidplane(e.clientX, e.clientY);
    if (!p) return;
    const pr = state.get().probe;
    state.set({ probe: { ...pr, on: true, x: clamp(p[0], -2.95, 2.95), y: clamp(p[1], -0.75, 0.75), z: p[2] || 0 } });
  }
  if (canvas) {
    const host = canvas.parentElement || canvas;
    host.addEventListener('pointerdown', e => {
      if (e.target !== canvas || !state.get().probe.on || (e.button != null && e.button > 0)) return;
      e.stopPropagation(); e.preventDefault();
      dragging = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      moveProbe(e); play('tick', 80);
    }, true);
    host.addEventListener('pointermove', e => {
      if (!dragging) return;
      e.stopPropagation(); moveProbe(e);
    }, true);
    const end = e => { if (dragging) { dragging = false; e.stopPropagation(); } };
    host.addEventListener('pointerup', end, true);
    host.addEventListener('pointercancel', end, true);
  }

  /* ---------- sync UI from state ---------- */
  let self = false, selfView = false, selfEnv = null;
  function syncWind(fromSlider) {
    const st = state.get(), U = st.U, a = air().a;
    setText(uVal, fmtVal(U, 'm/s') + ' · ' + fmtVal(msToKmh(U), 'km/h') + ' · M' + NB + fmtNum(U / a));
    if (!fromSlider && !self) uRange.value = String(uToSlider(U));
    if (document.activeElement !== uNum) uNum.value = fmtNum(U).replace(/ /g, '');
    const f = uToSlider(a);
    machTick.style.display = machTickL.style.display = f <= 1 ? '' : 'none';
    tickPos(machTick, f); tickPos(machTickL, f);
    presetBtns.forEach((b, i) => {
      const p = WIND_PRESETS[i], on = Math.abs(U - presetU(p, a)) <= 0.005 * Math.max(U, 1) + 0.05;
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('is-active', on);
    });
  }
  function syncButtons() {
    const st = state.get();
    probeBtn.setAttribute('aria-pressed', st.probe.on ? 'true' : 'false');
    probeBtn.classList.toggle('is-active', !!st.probe.on);
    viewBtn.setAttribute('aria-expanded', isOpen(viewPanel) ? 'true' : 'false');
    envBtn.setAttribute('aria-expanded', isOpen(envPanel) ? 'true' : 'false');
    if (canvas) {
      if (st.probe.on) { if (canvas.style.touchAction !== 'none') savedTouch = canvas.style.touchAction; canvas.style.touchAction = 'none'; canvas.style.cursor = 'crosshair'; }
      else { canvas.style.touchAction = savedTouch; canvas.style.cursor = ''; }
    }
  }
  function syncAlpha() {
    const v = state.get().alphaDeg;
    if (!self) aRange.value = String(v);
    setText(aVal, fmtDeg(v));
  }
  function syncView() {
    const st = state.get(), v = st.view;
    flowSeg.set(v.flow); rakeSeg.set(v.rake); heatSeg.set(v.heatmap); forcesSeg.set(!!v.forces); shockSeg.set(!!v.shock);
    for (const [id, b] of smokeBtns) { const on = id === v.smokeColor; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('is-active', on); }
    const maxLines = st.tier === 'high' ? 48 : 24;
    linesRange.max = String(maxLines);
    if (!selfView) { densRange.value = String(v.density); linesRange.value = String(Math.min(v.lines, maxLines)); }
    setText(densVal, Math.round(v.density * 100) + NB + '%');
    setText(linesVal, String(Math.min(v.lines, maxLines)));
    camSeg.set(st.camera);
  }
  function syncEnv() {
    const e = state.get().env, custom = e.mode === 'custom';
    envMode.set(e.mode);
    setShown(altBlock, !custom); setShown(customBlock, custom);
    const a = custom ? { T: e.T, p: e.p, rho: rhoOf(e.p, e.T) } : atmo.air(e);
    setText(hVal, fmtVal(e.h / 1000, 'km'));
    if (selfEnv !== 'h') hRange.value = String(e.h / 1000);
    setText(roKvs.T, fmtVal(a.T - 273.15, '°C')); setText(roKvs.p, fmtVal(a.p / 1000, 'kPa')); setText(roKvs.rho, fmtVal(a.rho, 'kg/m³'));
    setText(tVal, fmtVal(a.T - 273.15, '°C') + ' (' + fmtVal(a.T, 'K') + ')');
    setText(pVal, fmtVal(a.p / 1000, 'kPa'));
    setText(rVal, fmtVal(a.rho, 'kg/m³'));
    // always follow the real (possibly clamped) values; equal values leave the thumb alone
    const put = (el, v) => { if (!(Math.abs(+el.value - v) <= 1e-9 * Math.max(1, Math.abs(v)))) el.value = String(v); };
    put(tRange, a.T - 273.15); put(pRange, a.p / 1000); put(rRange, a.rho);
    syncWind(); // Mach tick and Mach number follow the air
  }
  function syncAll() { syncWind(); syncAlpha(); syncView(); syncEnv(); syncButtons(); }

  const offs = [
    state.on('change:U', () => syncWind()),
    state.on('change:alphaDeg', syncAlpha),
    state.on('change:view', syncView),
    state.on('change:camera', syncView),
    state.on('change:tier', syncView),
    state.on('change:env', syncEnv),
    state.on('change:probe', syncButtons),
    state.on('change:mode', () => { /* model changes do not alter controls */ })
  ];
  setPanel(viewPanel, false); setPanel(envPanel, false);
  syncAll();

  return {
    scenarios: SCENARIOS, runScenario, stopSweep, setPanel, isOpen, syncAll,
    destroy() { stopSweep(); closeMenu(); offs.forEach(f => f && f()); }
  };
}
