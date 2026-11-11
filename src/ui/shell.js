/* shell.js — app shell: layout, mounts, shared components, onboarding (SPEC §4, §5 mounts, §8).
 *
 *   import { createShell, init, ui } from './ui/shell.js'
 *   createShell(state)  builds the DOM once (idempotent) and returns the shell. Call before other init()s.
 *   init(ctx)           wires sound/sfx and the first-visit guide. Idempotent.
 *
 * Mounts (ids): #title #modeTabs #modelPanel #dock #viewPanel #envPanel #readouts #charts #hud #legend #guide
 * plus #stage (the 3D view; scene.js appends its canvas here, full-bleed behind everything).
 * Conventions for other modules:
 *  - A button with data-pop="viewPanel" | "envPanel" inside #dock toggles that popover (hidden on phones, where the tabs show it).
 *  - Mark guide targets with data-guide="speed" | "view" | "readouts" | "pin" (falls back to the mounts).
 *  - state.on('layout', e) -> {layout:'desktop'|'tablet'|'phone-p'|'phone-l', insetL, insetR, stageW, stageH}
 *    insetL/insetR = part of the 3D view covered by panels, so scene.js can centre the model in the free area.
 *  - state.on('tab', name) fires when a phone tab is shown (model|wind|view|env|read|chart) — charts should redraw.
 *  - ui.slider / ui.seg / ui.chip / ui.icon build the shared components.
 */

import { state as defaultState } from '../state.js';

const SCHOOL = 'TRƯỜNG THPT TRẦN QUỐC TOẢN (ĐỒNG THÁP)';
const TITLE = 'THÍ NGHIỆM ỐNG KHÍ ĐỘNG: LỰC CẢN VÀ LỰC NÂNG';
const GUIDE_KEY = 'phieu-ongkhidong-guide-v1';

const ASSUMPTIONS = [
  'Khói ở mặt phẳng giữa là lời giải 2D (lattice-Boltzmann) quanh thiết diện mô hình, ở số Reynolds thu nhỏ theo chế độ dòng; ngoài mặt phẳng dùng dòng thế và vệt hậu theo kinh nghiệm.',
  'Số đo (C_D, C_L, lực) lấy từ số liệu thực nghiệm đã công bố, không tính từ lời giải 2D.',
  'Mô hình thu nhỏ trong buồng thử kín; bỏ qua ảnh hưởng của vách và mặt đất.',
  'Dòng siêu âm chỉ là mô phỏng; ống khí động siêu âm thật cần vòi phun đặc biệt.',
  'Lực nâng không phải lực đẩy Archimedes: nó đến từ chênh lệch áp suất quanh vật.',
  'Hoạt hình chạy chậm cho dễ quan sát; mọi số hiển thị dùng tốc độ thật.'
];

const STEPS = [
  { sel: ['#modeTabs'], tab: 'model', text: 'Chọn mẫu có sẵn hoặc tự lắp ghép mô hình.' },
  { sel: ['[data-guide="speed"]', '#dock'], tab: 'wind', text: 'Kéo thanh trượt để đổi tốc độ gió và góc tấn.' },
  { sel: ['[data-guide="view"]', '[data-pop="viewPanel"]', '#viewPanel'], tab: 'view', text: 'Đổi kiểu hiển thị dòng khí: khói, hạt hoặc vectơ.' },
  { sel: ['[data-guide="readouts"]', '#readouts'], tab: 'read', drawer: true, text: 'Xem số đo lực và bản đồ áp suất trên bề mặt.' },
  { sel: ['[data-guide="pin"]', '#charts'], tab: 'chart', drawer: true, text: 'Ghim mô hình để so sánh lực cản với mô hình khác.' }
];

const TABS = [
  { id: 'model', label: 'Mô hình', icon: 'box', mounts: ['modeTabs', 'modelPanel'] },
  { id: 'wind', label: 'Gió', icon: 'wind', mounts: ['dock'] },
  { id: 'view', label: 'Hiển thị', icon: 'eye', mounts: ['viewPanel'] },
  { id: 'env', label: 'Môi trường', icon: 'thermometer', mounts: ['envPanel'] },
  { id: 'read', label: 'Số đo', icon: 'gauge', mounts: ['readouts'] },
  { id: 'chart', label: 'Biểu đồ', icon: 'chart', mounts: ['charts'] }
];

/* ---------- Lucide line icons (inline, 24x24, stroke 2 scaled by CSS) ---------- */
const ICONS = {
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  volumeOff: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  wind: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
};

export function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
  return t.content.firstChild;
}

export function el(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  if (children) for (const c of [].concat(children)) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

/* number formatting with Vietnamese decimal comma */
function fmtNum(v, step) {
  const s = String(step || 1);
  const d = s.indexOf('.') > -1 ? s.length - s.indexOf('.') - 1 : 0;
  try { return Number(v).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d }); } catch (e) { return Number(v).toFixed(d); }
}

/* ---------- shared components ---------- */
function seg(opts) {
  const items = opts.items;
  const root = el('div', { class: 'seg' + (opts.class ? ' ' + opts.class : ''), role: 'group', 'aria-label': opts.label || null });
  root.style.setProperty('--n', items.length);
  const btns = items.map((it, i) => {
    const b = el('button', { type: 'button', 'data-value': it.value, 'data-key': it.key || null, title: it.title || null }, [it.icon ? icon(it.icon) : null, el('span', { text: it.label })]);
    b.addEventListener('click', () => { if (opts.onChange) opts.onChange(it.value, i); });
    root.append(b);
    return b;
  });
  function set(v) {
    let idx = 0;
    items.forEach((it, i) => { const on = it.value === v; if (on) idx = i; btns[i].setAttribute('aria-pressed', on ? 'true' : 'false'); });
    root.style.setProperty('--i', idx);
  }
  set(opts.value !== undefined ? opts.value : items[0].value);
  return { el: root, set, get: () => (btns.find(b => b.getAttribute('aria-pressed') === 'true') || btns[0]).dataset.value };
}

function chip(label, opts) {
  opts = opts || {};
  const b = el('button', { type: 'button', class: 'chip', 'aria-pressed': opts.pressed ? 'true' : 'false' }, [opts.icon ? icon(opts.icon) : null, el('span', { text: label })]);
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (opts.onToggle) opts.onToggle(on);
  });
  return b;
}

/* ui.slider({label,min,max,step,value,unit,format,ticks:[{v,label?}]|number,id,onInput,onChange}) -> {el,input,set(v,silent),get()} */
function slider(o) {
  const min = o.min != null ? o.min : 0, max = o.max != null ? o.max : 100, step = o.step || 1;
  const fmt = o.format || (v => fmtNum(v, step));
  const root = el('div', { class: 'slider' + (o.class ? ' ' + o.class : '') });
  const val = el('span', { class: 'slider__value' });
  const bubble = el('div', { class: 'slider__bubble', 'aria-hidden': 'true' });
  const fill = el('div', { class: 'slider__fill' });
  const input = el('input', { class: 'slider__input', type: 'range', min, max, step, id: o.id || null, 'aria-label': o.label || null });
  const field = el('div', { class: 'slider__field' }, [el('div', { class: 'slider__track' }, fill)]);
  if (o.label || o.unit) root.append(el('div', { class: 'slider__head' }, [o.label ? el('label', { class: 'slider__label', text: o.label, for: o.id || null }) : el('span'), val]));
  let ticks = o.ticks;
  if (typeof ticks === 'number') { ticks = []; for (let i = 0; i <= o.ticks; i++) ticks.push({ v: min + (max - min) * i / o.ticks }); }
  let marks = null;
  if (ticks && ticks.length) {
    const tk = el('div', { class: 'slider__ticks' });
    ticks.forEach(t => { const i = el('i'); i.style.setProperty('--p', ((t.v - min) / (max - min)) * 100); tk.append(i); });
    field.append(tk);
    if (ticks.some(t => t.label != null)) {
      marks = el('div', { class: 'slider__marks' });
      ticks.forEach(t => { if (t.label == null) return; const s = el('span', { text: t.label }); s.style.setProperty('--p', ((t.v - min) / (max - min)) * 100); marks.append(s); });
    }
  }
  field.append(input, bubble);
  root.append(field);
  if (marks) root.append(marks);

  function paint() {
    const v = parseFloat(input.value);
    root.style.setProperty('--pct', ((v - min) / (max - min)) * 100);
    const txt = fmt(v);
    val.textContent = txt;
    if (o.unit) val.append(el('small', { text: o.unit }));
    bubble.textContent = txt + (o.unit ? ' ' + o.unit : '');
    input.setAttribute('aria-valuetext', txt + (o.unit ? ' ' + o.unit : ''));
  }
  input.value = o.value != null ? o.value : min;
  paint();
  input.addEventListener('input', () => { paint(); if (o.onInput) o.onInput(parseFloat(input.value)); });
  input.addEventListener('change', () => { if (o.onChange) o.onChange(parseFloat(input.value)); });
  const on = () => root.classList.add('is-active'), off = () => root.classList.remove('is-active');
  input.addEventListener('pointerdown', on);
  input.addEventListener('touchstart', on, { passive: true });
  ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'blur'].forEach(ev => input.addEventListener(ev, off));
  return {
    el: root, input,
    set(v, silent) { input.value = v; paint(); if (!silent && o.onInput) o.onInput(parseFloat(input.value)); },
    get: () => parseFloat(input.value),
    disable(d) { root.classList.toggle('is-disabled', !!d); input.disabled = !!d; }
  };
}

export const ui = { icon, el, seg, chip, slider, fmtNum };

/* ---------- shell ---------- */
let shell = null;

export function createShell(state) {
  if (shell) return shell;
  state = state || defaultState;
  const doc = document, html = doc.documentElement;
  const isTouchOnly = () => html.classList.contains('is-touch');
  let sfx = null;
  const play = n => { try { if (sfx && sfx.play) sfx.play(n); } catch (e) {} };

  /* --- DOM --- */
  let app = doc.getElementById('app');
  if (!app) { app = el('div', { id: 'app' }); doc.body.prepend(app); }
  app.textContent = '';

  const title = el('div', { id: 'title', class: 'title-wrap' });
  const plate = el('div', { class: 'plate' });
  plate.append(el('h1', { class: 'plate__title', text: TITLE }));
  title.append(plate);

  const stage = el('div', { id: 'stage', class: 'stage' });
  const hud = el('div', { id: 'hud', 'aria-live': 'off' });
  const school = el('div', { class: 'school', text: SCHOOL });
  const topRight = el('div', { id: 'topRight' }, [school, hud]);
  const legend = el('div', { id: 'legend' });
  const dock = el('div', { id: 'dock', class: 'panel', role: 'group', 'aria-label': 'Điều khiển gió' });
  const dockWrap = el('div', { class: 'dock-wrap' }, dock);

  const btnGuide = el('button', { type: 'button', class: 'icon-btn', id: 'btnGuide', 'aria-label': 'Hướng dẫn', title: 'Hướng dẫn' }, icon('help'));
  const btnAssume = el('button', { type: 'button', class: 'icon-btn', id: 'btnAssume', 'aria-label': 'Giả thiết mô hình', title: 'Giả thiết mô hình', 'data-float': 'assumptions', 'aria-expanded': 'false' }, icon('info'));
  const btnSound = el('button', { type: 'button', class: 'icon-btn', id: 'btnSound', 'aria-label': 'Âm thanh', title: 'Âm thanh', 'aria-pressed': 'true' });
  const btnFull = el('button', { type: 'button', class: 'icon-btn', id: 'btnFull', 'aria-label': 'Toàn màn hình', title: 'Toàn màn hình' }, icon('maximize'));
  const tools = el('div', { id: 'tools', class: 'toolbar panel', role: 'toolbar', 'aria-label': 'Công cụ' }, [btnGuide, btnAssume, btnSound, btnFull]);

  const viewPanel = el('div', { id: 'viewPanel', class: 'panel popover', role: 'dialog', 'aria-label': 'Hiển thị' });
  const envPanel = el('div', { id: 'envPanel', class: 'panel popover', role: 'dialog', 'aria-label': 'Môi trường' });
  const assume = el('div', { id: 'assumptions', class: 'panel popover popover--float', role: 'dialog', 'aria-label': 'Giả thiết mô hình' }, [
    el('div', { class: 'panel-h', text: 'Giả thiết mô hình' }),
    el('ol', null, ASSUMPTIONS.map(t => el('li', { text: t })))
  ]);

  const edgeL = el('button', { type: 'button', class: 'edge-btn edge-btn--l', id: 'edgeL', 'aria-label': 'Thu gọn bảng mô hình', title: 'Thu gọn / mở bảng mô hình', 'aria-expanded': 'true' }, icon('left'));
  const edgeR = el('button', { type: 'button', class: 'edge-btn edge-btn--r', id: 'edgeR', 'aria-label': 'Thu gọn bảng số đo', title: 'Thu gọn / mở bảng số đo', 'aria-expanded': 'true' }, icon('right'));
  const dockTab = el('button', { type: 'button', class: 'dock-tab', id: 'dockTab', 'aria-label': 'Thu gọn bảng điều khiển gió', title: 'Thu gọn / mở điều khiển gió', 'aria-expanded': 'true' }, [icon('down'), el('span', { text: 'Điều khiển gió' })]);
  dockWrap.prepend(dockTab);
  stage.append(title, topRight, legend, dockWrap, tools, edgeL, edgeR, viewPanel, envPanel, assume);

  const modeTabs = el('div', { id: 'modeTabs', class: 'panel', 'data-guide': 'mode' });
  const modelPanel = el('div', { id: 'modelPanel', class: 'panel' });
  const colL = el('aside', { id: 'colL', class: 'col', 'aria-label': 'Mô hình' }, [modeTabs, modelPanel]);

  const readouts = el('div', { id: 'readouts', class: 'panel' });
  const charts = el('div', { id: 'charts', class: 'panel' });
  const handle = el('button', { type: 'button', class: 'drawer-handle', 'aria-label': 'Số đo và biểu đồ', 'aria-expanded': 'false' }, icon('left'));
  const colR = el('aside', { id: 'colR', class: 'col', 'aria-label': 'Số đo và biểu đồ' }, [handle, readouts, charts]);

  const tabbar = el('nav', { id: 'tabbar', class: 'tabbar', role: 'tablist', 'aria-label': 'Bảng điều khiển' });
  tabbar.style.setProperty('--n', TABS.length);
  const tabBtns = TABS.map(t => {
    const b = el('button', { type: 'button', role: 'tab', 'data-tab': t.id, 'aria-label': t.label, 'aria-selected': 'false' }, [icon(t.icon), el('span', { text: t.label })]);
    b.addEventListener('click', () => { play('tap'); setTab(t.id); });
    tabbar.append(b);
    return b;
  });
  const sheetBody = el('div', { class: 'sheet__body', role: 'tabpanel' });
  const sheet = el('section', { id: 'sheet', class: 'sheet' }, sheetBody);
  const park = el('div', { id: 'park', hidden: true });
  const guide = el('div', { id: 'guide', class: 'guide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Hướng dẫn sử dụng' });

  app.append(stage, colL, colR, tabbar, sheet, park, guide);

  const mounts = { title, stage, modeTabs, modelPanel, dock, viewPanel, envPanel, readouts, charts, hud, legend, guide };
  const byId = { modeTabs, modelPanel, dock, viewPanel, envPanel, readouts, charts };

  /* --- mode switch (crossfade 250 ms = 125 out + 125 in) --- */
  const modeSeg = seg({
    label: 'Chế độ mô hình',
    items: [{ value: 'library', label: 'Thư viện mẫu', key: '1' }, { value: 'builder', label: 'Tự lắp ghép', key: '2' }],
    value: state.get().mode,
    onChange: v => { play('toggle'); switchMode(v); }
  });
  modeTabs.append(modeSeg.el);
  let ownMode = false, fadeTimer = 0;
  function switchMode(m) {
    if (state.get().mode === m) { modeSeg.set(m); return; }
    modeSeg.set(m);
    clearTimeout(fadeTimer);
    modelPanel.classList.remove('is-fadein');
    modelPanel.classList.add('is-fading');
    fadeTimer = setTimeout(() => {
      ownMode = true; state.set({ mode: m }); ownMode = false;
      modelPanel.classList.remove('is-fading');
      modelPanel.classList.add('is-fadein');
      fadeTimer = setTimeout(() => modelPanel.classList.remove('is-fadein'), 160);
    }, 125);
  }
  state.on('change:mode', m => {
    modeSeg.set(m);
    if (!ownMode) { modelPanel.classList.remove('is-fadein'); void modelPanel.offsetWidth; modelPanel.classList.add('is-fadein'); setTimeout(() => modelPanel.classList.remove('is-fadein'), 160); }
  });
  doc.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox')) return;
    if (guideOn) return;
    if (e.key === '1') { play('toggle'); switchMode('library'); }
    else if (e.key === '2') { play('toggle'); switchMode('builder'); }
  });

  /* --- sound / fullscreen --- */
  function paintSound() {
    const on = !!state.get().sound;
    btnSound.replaceChildren(icon(on ? 'volume' : 'volumeOff'));
    btnSound.setAttribute('aria-pressed', on ? 'true' : 'false');
    btnSound.title = on ? 'Âm thanh: bật' : 'Âm thanh: tắt';
    btnSound.classList.toggle('is-off', !on);
  }
  paintSound();
  btnSound.addEventListener('click', () => { state.set({ sound: !state.get().sound }); play('toggle'); });
  state.on('change:sound', paintSound);

  const fsOK = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled) && !html.classList.contains('is-inapp');
  if (!fsOK) btnFull.hidden = true;
  const fsEl = () => doc.fullscreenElement || doc.webkitFullscreenElement;
  btnFull.addEventListener('click', () => {
    play('tap');
    try {
      if (fsEl()) (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      else (html.requestFullscreen || html.webkitRequestFullscreen).call(html);
    } catch (e) {}
  });
  const paintFs = () => { btnFull.replaceChildren(icon(fsEl() ? 'minimize' : 'maximize')); btnFull.title = fsEl() ? 'Thoát toàn màn hình' : 'Toàn màn hình'; };
  doc.addEventListener('fullscreenchange', paintFs); doc.addEventListener('webkitfullscreenchange', paintFs);

  /* --- thu gọn bảng bên / dock: bảng không che mô hình --- */
  const COL_KEY = 'phieu-ongkhidong-cols-v1';
  const cols = { l: false, r: false, d: false };
  try { Object.assign(cols, JSON.parse(localStorage.getItem(COL_KEY) || '{}')); } catch (e) { /* không có bộ nhớ */ }
  function paintCols() {
    html.classList.toggle('collapse-l', cols.l); html.classList.toggle('collapse-r', cols.r); html.classList.toggle('collapse-d', cols.d);
    edgeL.setAttribute('aria-expanded', String(!cols.l)); edgeR.setAttribute('aria-expanded', String(!cols.r)); dockTab.setAttribute('aria-expanded', String(!cols.d));
    edgeL.setAttribute('aria-label', cols.l ? 'Mở bảng mô hình' : 'Thu gọn bảng mô hình'); edgeR.setAttribute('aria-label', cols.r ? 'Mở bảng số đo' : 'Thu gọn bảng số đo');
    dockTab.setAttribute('aria-label', cols.d ? 'Mở điều khiển gió' : 'Thu gọn điều khiển gió');
    try { localStorage.setItem(COL_KEY, JSON.stringify(cols)); } catch (e) { /* bỏ qua */ }
    scheduleSync(); setTimeout(scheduleSync, 340);
  }
  edgeL.addEventListener('click', () => { play('tap'); cols.l = !cols.l; paintCols(); });
  edgeR.addEventListener('click', () => { play('tap'); if (layout === 'tablet') setDrawer(!drawerOpen); else { cols.r = !cols.r; paintCols(); } });
  dockTab.addEventListener('click', () => { play('tap'); cols.d = !cols.d; paintCols(); });

  /* --- layout --- */
  let layout = '', tab = 'model', drawerOpen = false;
  function viewSize() {
    const vv = window.visualViewport;
    return { w: Math.round(vv ? vv.width : window.innerWidth), h: Math.round(vv ? vv.height : window.innerHeight) };
  }
  function computeLayout() {
    const { w, h } = viewSize();
    if (w < 600 && h >= w) return 'phone-p';
    if (h < 520 && w > h && w < 1000) return 'phone-l';
    if (w < 1100) return 'tablet';
    return 'desktop';
  }
  const isPhone = () => layout.indexOf('phone') === 0;

  function place() {
    if (isPhone()) {
      for (const t of TABS) for (const id of t.mounts) if (!(t.id === tab)) park.append(byId[id]);
      const cur = TABS.find(t => t.id === tab);
      sheetBody.replaceChildren(...cur.mounts.map(id => byId[id]));
      sheetBody.setAttribute('aria-label', cur.label);
    } else {
      colL.append(modeTabs, modelPanel);
      colR.append(readouts, charts);
      dockWrap.append(dock);
      app.append(viewPanel, envPanel);
      sheetBody.replaceChildren();
    }
  }
  function paintTabs() {
    const idx = TABS.findIndex(t => t.id === tab);
    tabbar.style.setProperty('--i', idx);
    tabBtns.forEach((b, i) => b.setAttribute('aria-selected', i === idx ? 'true' : 'false'));
  }
  function setTab(id) {
    if (!TABS.some(t => t.id === id)) return;
    tab = id;
    paintTabs();
    if (isPhone()) { closePopovers(); place(); sheetBody.scrollTop = 0; scheduleSync(); }
    state.emit('tab', tab);
  }
  function setDrawer(open) {
    drawerOpen = !!open;
    colR.classList.toggle('is-open', drawerOpen);
    html.classList.toggle('drawer-open', drawerOpen);
    handle.setAttribute('aria-expanded', drawerOpen ? 'true' : 'false');
    handle.setAttribute('aria-label', drawerOpen ? 'Đóng số đo và biểu đồ' : 'Mở số đo và biểu đồ');
    if (drawerOpen) closePopovers();
    scheduleSync();
    setTimeout(scheduleSync, 340);
  }
  handle.addEventListener('click', () => { play('tap'); setDrawer(!drawerOpen); });

  function applyLayout() {
    const next = computeLayout();
    if (next === layout) return;
    layout = next;
    html.setAttribute('data-layout', layout);
    closePopovers();
    if (layout !== 'tablet') setDrawer(false);
    place();
    paintTabs();
    scheduleSync();
  }

  /* --- popovers (viewPanel, envPanel, assumptions) --- */
  let openPop = null, openBtn = null;
  function positionPop(pop, anchor) {
    const { w: W, h: H } = viewSize();
    const inDock = anchor.closest && anchor.closest('#dock');
    const r = (inDock || anchor).getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const above = r.top + r.height / 2 > H / 2;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(W - pw - 8, left));
    let top = above ? r.top - ph - 10 : r.bottom + 10;
    if (inDock) left = Math.max(8, Math.min(W - pw - 8, anchor.getBoundingClientRect().left + anchor.offsetWidth / 2 - pw / 2));
    top = Math.max(8, Math.min(H - ph - 8, top));
    if (pop.id === 'assumptions' && (layout === 'desktop' || layout === 'tablet')) {
      /* toolbar sits top-right: open below it, right-aligned to its left side where there is room */
      const vertical = layout === 'tablet';
      if (vertical) { left = Math.max(8, r.left - pw - 10); top = Math.max(8, Math.min(H - ph - 8, r.top)); }
    } else if (pop.id === 'assumptions' && isPhone()) {
      left = Math.max(8, r.left - pw - 10); top = Math.max(8, Math.min(H - ph - 8, r.top));
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function closePopovers() {
    for (const p of [viewPanel, envPanel, assume]) p.classList.remove('is-open');
    for (const b of tools.querySelectorAll('[data-float]')) { b.setAttribute('aria-expanded', 'false'); b.classList.remove('is-open'); }
    for (const b of doc.querySelectorAll('[data-pop]')) { b.setAttribute('aria-expanded', 'false'); b.classList.remove('is-open'); }
    openPop = null; openBtn = null;
  }
  function togglePopover(id, btn) {
    const pop = doc.getElementById(id);
    if (!pop) return;
    if (pop.classList.contains('is-open')) { closePopovers(); return; }
    if (isPhone() && !pop.classList.contains('popover--float')) return;
    closePopovers();
    positionPop(pop, btn);
    pop.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true'); btn.classList.add('is-open');
    openPop = pop; openBtn = btn;
  }
  doc.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-pop],[data-float]');
    if (b) { play('tap'); togglePopover(b.getAttribute('data-pop') || b.getAttribute('data-float'), b); return; }
    if (openPop && !openPop.contains(e.target)) closePopovers();
  });

  /* --- measure + publish layout --- */
  let syncQueued = false;
  function scheduleSync() { if (syncQueued) return; syncQueued = true; requestAnimationFrame(() => { syncQueued = false; sync(); }); }
  function sync() {
    const { w } = viewSize();
    let insetL = 0, insetR = 0;
    if (!isPhone()) {
      insetL = cols.l ? 12 : Math.round(colL.getBoundingClientRect().right + 16);
      if (layout === 'desktop') insetR = cols.r ? 12 : Math.round(w - colR.getBoundingClientRect().left + 16);
      else if (layout === 'tablet' && drawerOpen && w >= 900) insetR = Math.round((colR.offsetWidth || 352) + 24);
    }
    const insetT = Math.round(Math.max(plate.getBoundingClientRect().bottom, layout === 'desktop' ? 0 : topRight.getBoundingClientRect().bottom) + 8), insetB = isPhone() ? 8 : Math.round(innerHeight - dockWrap.getBoundingClientRect().top + 8);
    const root = html.style;
    root.setProperty('--inset-l', insetL + 'px');
    root.setProperty('--inset-r', insetR + 'px');
    root.setProperty('--plate-h', Math.round(plate.getBoundingClientRect().height) + 'px');
    root.setProperty('--tr-h', Math.round(topRight.getBoundingClientRect().height) + 'px');
    root.setProperty('--tr-w', Math.round(topRight.getBoundingClientRect().width) + 'px');
    root.setProperty('--tools-w', Math.round(tools.getBoundingClientRect().width) + 'px');
    root.setProperty('--dock-h', (isPhone() ? 0 : Math.round(dock.getBoundingClientRect().height)) + 'px');
    root.setProperty('--drawer-w', Math.round(colR.getBoundingClientRect().width || 352) + 'px');
    if (openPop && openBtn) positionPop(openPop, openBtn);
    const sr = stage.getBoundingClientRect();
    state.emit('layout', { layout, insetL, insetR, insetT, insetB, stageW: Math.round(sr.width), stageH: Math.round(sr.height) });
  }
  window.addEventListener('resize', () => { applyLayout(); scheduleSync(); if (guideOn) renderStep(true); });
  window.addEventListener('orientationchange', () => setTimeout(() => { applyLayout(); scheduleSync(); }, 260));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { applyLayout(); scheduleSync(); });
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(scheduleSync);
    [colL, colR, plate, dock, stage, topRight, tools, dockWrap].forEach(n => ro.observe(n));
  }

  /* --- guide (coach marks) --- */
  let guideOn = false, step = 0, openedDrawer = false;
  const hole = el('div', { class: 'guide__hole' });
  const card = el('div', { class: 'guide__card panel' });
  const gStep = el('div', { class: 'guide__step' });
  const gText = el('p', { class: 'guide__text' });
  const dots = el('div', { class: 'guide__dots', 'aria-hidden': 'true' }, STEPS.map(() => el('i')));
  const btnSkip = el('button', { type: 'button', class: 'btn', text: 'Bỏ qua' });
  const btnNext = el('button', { type: 'button', class: 'btn btn-primary', text: 'Tiếp' });
  card.append(gStep, gText, el('div', { class: 'guide__foot' }, [dots, el('div', { class: 'guide__btns' }, [btnSkip, btnNext])]));
  guide.append(hole, card);

  function visible(n) {
    if (!n || n.closest('#park') || n.closest('[hidden]')) return false;
    const r = n.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (let p = n; p && p !== doc.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    }
    return true;
  }
  function findTarget(s) {
    for (const q of s.sel) { const n = doc.querySelector(q); if (visible(n)) return n; }
    return null;
  }
  function renderStep(instant) {
    const s = STEPS[step];
    if (!s) return;
    if (isPhone()) { if (tab !== s.tab) { tab = s.tab; paintTabs(); place(); state.emit('tab', tab); } }
    else if (layout === 'tablet' && s.drawer && !drawerOpen) { openedDrawer = true; setDrawer(true); }
    else if (layout === 'tablet' && !s.drawer && drawerOpen && openedDrawer) { setDrawer(false); openedDrawer = false; }
    const go = () => {
      const t = findTarget(s);
      const { w: W, h: H } = viewSize();
      let r;
      if (t) { const b = t.getBoundingClientRect(); r = { left: b.left - 6, top: b.top - 6, width: b.width + 12, height: b.height + 12 }; }
      else r = { left: W / 2 - 40, top: H / 2 - 20, width: 80, height: 40 };
      r.left = Math.max(2, r.left); r.top = Math.max(2, r.top);
      r.width = Math.min(W - 4 - r.left, r.width); r.height = Math.min(H - 4 - r.top, r.height);
      if (instant) { hole.style.transition = 'none'; card.style.transition = 'none'; }
      hole.style.left = r.left + 'px'; hole.style.top = r.top + 'px'; hole.style.width = r.width + 'px'; hole.style.height = r.height + 'px';
      gStep.textContent = 'Bước ' + (step + 1) + '/' + STEPS.length;
      gText.textContent = s.text;
      [...dots.children].forEach((d, i) => d.classList.toggle('is-on', i === step));
      btnNext.textContent = step === STEPS.length - 1 ? 'Xong' : 'Tiếp';
      const cw = Math.min(320, W - 24), ch = card.offsetHeight || 150, g = 14;
      const cands = [
        { left: r.left + r.width / 2 - cw / 2, top: r.top + r.height + g },
        { left: r.left + r.width / 2 - cw / 2, top: r.top - ch - g },
        { left: r.left + r.width + g, top: r.top + r.height / 2 - ch / 2 },
        { left: r.left - cw - g, top: r.top + r.height / 2 - ch / 2 }
      ];
      let pos = cands.find(c => c.left >= 8 && c.left + cw <= W - 8 && c.top >= 8 && c.top + ch <= H - 8);
      if (!pos) pos = { left: W / 2 - cw / 2, top: r.top + r.height / 2 > H / 2 ? 12 : H - ch - 12 };
      card.style.left = Math.max(8, Math.min(W - cw - 8, pos.left)) + 'px';
      card.style.top = Math.max(8, Math.min(H - ch - 8, pos.top)) + 'px';
      if (instant) requestAnimationFrame(() => { hole.style.transition = ''; card.style.transition = ''; });
    };
    /* wait a frame (and the drawer/tab transition) so the target has its final box */
    requestAnimationFrame(() => setTimeout(go, layout === 'tablet' && s.drawer ? 340 : 30));
  }
  function startGuide() {
    if (guideOn) return;
    closePopovers();
    guideOn = true; step = 0; openedDrawer = false;
    guide.classList.add('is-on');
    renderStep(true);
    btnNext.focus({ preventScroll: true });
  }
  function endGuide() {
    if (!guideOn) return;
    guideOn = false;
    guide.classList.remove('is-on');
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) {}
    if (openedDrawer) { setDrawer(false); openedDrawer = false; }
    btnGuide.focus({ preventScroll: true });
  }
  btnNext.addEventListener('click', () => { play('tap'); if (step >= STEPS.length - 1) endGuide(); else { step++; renderStep(false); } });
  btnSkip.addEventListener('click', () => { play('tap'); endGuide(); });
  btnGuide.addEventListener('click', () => { play('tap'); startGuide(); });
  doc.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (guideOn) endGuide(); else closePopovers(); }
    else if (guideOn && (e.key === 'Enter' || e.key === 'ArrowRight') && e.target === doc.body) btnNext.click();
  });
  function guideSeen() { try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { return false; } }

  /* boot */
  applyLayout();
  paintCols();
  setTab('model');
  paintFs();
  scheduleSync();

  shell = {
    mounts, state, setTab, getTab: () => tab, setDrawer, openGuide: startGuide, closeGuide: endGuide,
    closePopovers, togglePopover, layout: () => layout, resync: scheduleSync,
    setSfx: s => { sfx = s; },
    autoGuide: () => { if (!guideSeen()) setTimeout(startGuide, 900); },
    guideSeen
  };
  return shell;
}

let inited = false;
export function init(ctx) {
  const sh = createShell(ctx.state);
  if (inited) return sh;
  inited = true;
  sh.setSfx(ctx.sfx);
  sh.autoGuide();
  return sh;
}

export function getShell() { return shell; }
