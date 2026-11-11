// config.js (P8): wind presets, slider mapping, vi-VN formatting, smoothing, env linking, scenarios, shared UI helpers.
// Plain ES module, no dependencies.

/* ---------- physical constants ---------- */
export const R_AIR = 287.05;      // J/(kg K)
export const GAMMA = 1.4;
export const U_MIN = 1;           // m/s, lowest wind the UI allows
export const U_MAX = 700;         // m/s, slider end
export const ALPHA_MIN = -20;
export const ALPHA_MAX = 30;
export const ALPHA_DETENT = 0.7;  // degrees: pointer drags snap to 0 inside this band
export const SMOOTH_TAU = 0.25;   // s, SPEC section 3
export const MAX_PINS = 6;
export const TIME_WINDOW = 20;    // s, live chart window
export const H_UNIT = 1;          // env.h is stored in metres (SI); UI shows km
// flow.probe().speed is in visual m/s (like flow.sample); the UI multiplies by U/Uvis to show the true speed.
export const PROBE_SPEED_IS_VISUAL = true;

/* ---------- wind ---------- */
export const WIND_PRESETS = [
  { id: 'light',  label: 'Nhẹ',        U: 5 },
  { id: 'mid',    label: 'Trung bình', U: 10 },
  { id: 'strong', label: 'Mạnh',       U: 20 },
  { id: 'storm',  label: 'Bão',        U: 35 },
  { id: 'super',  label: 'Siêu thanh', mach: 1.5 }
];
export const presetU = (p, a) => (p.mach ? p.mach * a : p.U);
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// slider position s in [0,1] <-> wind speed
export const sliderToU = s => U_MAX * Math.pow(clamp(s, 0, 1), 2.2);
export const uToSlider = U => Math.pow(clamp(U, 0, U_MAX) / U_MAX, 1 / 2.2);
export const clampU = U => clamp(U, U_MIN, U_MAX);
export const roundU = U => (U < 100 ? Math.round(U * 10) / 10 : Math.round(U));
export const msToKmh = U => U * 3.6;

/* ---------- vi-VN number formatting ---------- */
const GROUP = ' ';   // narrow no-break space: thousands separator
const NBSP = ' ';    // between number and unit
const MINUS = '−';
const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const sup = n => String(n).split('').map(c => SUP[c] || c).join('');
const group = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
const comma = s => s.replace('.', ',');

function sci(a, sig) {
  let e = Math.floor(Math.log10(a));
  let m = a / Math.pow(10, e);
  let ms = m.toFixed(sig - 1);
  if (parseFloat(ms) >= 10) { e += 1; ms = (m / 10).toFixed(sig - 1); }
  return comma(ms) + ' × 10' + sup(e);
}

/** 3 significant digits by default; integers keep all their digits; thousands grouped; decimal comma. */
export function fmtNum(x, o) {
  const sig = (o && o.sig) || 3;
  if (x == null || typeof x !== 'number' || !isFinite(x)) return '—';
  if (x === 0) return '0';
  const neg = x < 0, a = Math.abs(x);
  let s;
  if (a >= 1e7 || a < 1e-3) s = sci(a, sig);
  else if (a >= 1000) s = group(Math.round(a));
  else {
    const dec = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
    const r = a.toFixed(dec);
    s = parseFloat(r) >= 1000 ? group(Math.round(a)) : comma(r);
  }
  return (neg ? MINUS : '') + s;
}
export function fmtFixed(x, dec) {
  if (x == null || !isFinite(x)) return '—';
  const s = comma(Math.abs(x).toFixed(dec));
  return (x < 0 && parseFloat(s.replace(',', '.')) !== 0 ? MINUS : '') + s;
}
/** number + unit, the unit is always shown (unless the value is missing) */
export function fmtVal(x, unit, o) {
  const s = fmtNum(x, o);
  return s === '—' ? s : s + NBSP + unit;
}
/** Reynolds number: "2,4 × 10⁵"; below 10 000 a grouped integer */
export function fmtRe(Re) {
  if (Re == null || !isFinite(Re)) return '—';
  if (Re < 1e4) return group(Math.round(Re));
  return sci(Re, 2);
}
export const fmtDeg = (x, dec = 1) => (x == null || !isFinite(x) ? '—' : fmtFixed(x, dec) + '°');
export const fmtPct = x => (x == null || !isFinite(x) ? '—' : Math.round(x) + NBSP + '%');
/** angle in labels: 5°, 7,5° (no trailing ",0") */
export function fmtDegShort(x) {
  const r = Math.round(x * 10) / 10;
  return (Number.isInteger(r) ? String(r).replace('-', MINUS) : fmtFixed(r, 1)) + '°';
}
/** parse what a person types: accepts "12,5", "12.5", "1 200" */
export function parseNum(s) {
  if (typeof s !== 'string') return NaN;
  const t = s.replace(/[\s   ]/g, '').replace(MINUS, '-').replace(',', '.');
  return t === '' ? NaN : Number(t);
}
export const NB = NBSP;

/* ---------- smoothing (exponential, tau 0.25 s) ---------- */
export function makeSmoother(tau = SMOOTH_TAU) {
  let v = null;
  return {
    update(target, dt) {
      if (typeof target !== 'number' || !isFinite(target)) { v = null; return NaN; }
      if (v === null || !isFinite(v) || !(dt > 0)) { if (v === null || !isFinite(v)) v = target; return v; }
      v += (target - v) * (1 - Math.exp(-dt / tau));
      return v;
    },
    get value() { return v == null ? NaN : v; },
    reset() { v = null; }
  };
}

/* ---------- regime words ---------- */
export const WORD_FLOW = { subsonic: 'dưới âm', transonic: 'cận âm', supersonic: 'siêu âm' };
export const WORD_BL = { laminar: 'lớp biên tầng', transition: 'chuyển tiếp', turbulent: 'rối' };
export const WORD_WAKE = { none: 'không có xoáy', bubble: 'bọt tách', street: 'xoáy Kármán', irregular: 'hỗn loạn' };
export const WORD_AREF = { frontal: 'chính diện', planform: 'diện tích cánh' };

/* ---------- air environment: linked p = rho R T ---------- */
export const ENV_LIMITS = { Tc: [-40, 60], pkPa: [20, 110], hKm: [0, 20] };
export const RHO_LIMITS = (() => {
  const lo = ENV_LIMITS.pkPa[0] * 1000 / (R_AIR * (ENV_LIMITS.Tc[1] + 273.15));
  const hi = ENV_LIMITS.pkPa[1] * 1000 / (R_AIR * (ENV_LIMITS.Tc[0] + 273.15));
  return [lo, hi];
})();
export const rhoOf = (p, T) => p / (R_AIR * T);
/**
 * Apply one edit to the (T [K], p [Pa]) pair and return the new pair plus rho.
 * kind 'T' (value in degC) keeps p; 'p' (value in kPa) keeps T; 'rho' (kg/m3) keeps T and changes p.
 */
export function linkEnv(kind, value, T, p) {
  const pMin = ENV_LIMITS.pkPa[0] * 1000, pMax = ENV_LIMITS.pkPa[1] * 1000;
  if (kind === 'T') T = clamp(value, ENV_LIMITS.Tc[0], ENV_LIMITS.Tc[1]) + 273.15;
  else if (kind === 'p') p = clamp(value * 1000, pMin, pMax);
  else if (kind === 'rho') p = clamp(value * R_AIR * T, pMin, pMax);
  return { T, p, rho: rhoOf(p, T) };
}

/* ---------- colours (SPEC section 8) ---------- */
export const C = {
  drag: '#D98E04', lift: '#1E9E74', red: '#C8102E', ink: '#1B1D21', muted: '#5E636B', paper: '#F4F1EA',
  line: 'rgba(27,29,33,.14)',
  smoke: { white: '#EDEBE6', red: '#D23A2E', blue: '#2F6FD0', orange: '#E8862A' },
  multi: ['#C0504D', '#D98E04', '#6B8E23', '#2F7F8C', '#2F6FD0', '#7A4B8C'],
  pressure: ['#1F4E9C', '#5AA9D6', '#F2EFE8', '#F2B33D', '#C62828'],
  friction: ['#2B2F35', '#8C5A1E', '#F2B33D', '#FFF1C2'],
  speed: ['#24364F', '#2F7F8C', '#8CC084', '#F4E3A1'],
  cdPressure: '#1F4E9C', cdFriction: '#D98E04', cdInduced: '#1E9E74', cdWave: '#C62828'
};
export const PIN_COLORS = ['#1F4E9C', '#2F7F8C', '#D98E04', '#6B8E23', '#7A4B8C', '#5E636B'];
export const CURRENT_COLOR = '#C8102E';
export const PRESSURE_CP_MIN = -1.5;

/** colour along a list of evenly spaced stops; t in 0..1 -> [r,g,b] */
export function rampColor(stops, t) {
  const n = stops.length - 1, x = clamp(t, 0, 1) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
  const a = hex(stops[i]), b = hex(stops[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
/** pressure map: Cp -1.5 .. cpMax with Cp 0 on the middle stop (#F2EFE8); returns [r,g,b] */
export function pressureColor(cp, cpMax) {
  const S = C.pressure;
  if (cp <= 0) return rampColor(S.slice(0, 3), (cp - PRESSURE_CP_MIN) / (0 - PRESSURE_CP_MIN));
  return rampColor(S.slice(2), cp / Math.max(cpMax, 0.1));
}

/* ---------- pins ---------- */
export function deepCopy(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
export function modelName(ctx, snap) {
  if (snap.mode === 'builder') return 'Tự chế';
  const lib = ctx && ctx.library && ctx.library.LIBRARY;
  const item = lib && lib.find(m => m.id === snap.modelId);
  return item ? item.name : String(snap.modelId);
}
export function pinLabel(ctx, snap) { return modelName(ctx, snap) + ', α ' + fmtDegShort(snap.alphaDeg); }
let pinSeq = 0;
export function makeSnapshot(st, over) {
  const o = over || {};
  return {
    mode: o.mode || st.mode, modelId: o.modelId || st.modelId,
    builder: deepCopy(o.builder || st.builder),
    alphaDeg: o.alphaDeg != null ? o.alphaDeg : st.alphaDeg
  };
}
export function makePin(ctx, snap) {
  return { id: 'pin' + (++pinSeq) + '_' + Math.floor(Math.random() * 1e6).toString(36), label: pinLabel(ctx, snap), snapshot: snap };
}

/* ---------- guided experiments ("Thí nghiệm gợi ý") ---------- */
// Declarative. controls.js runs them. U is fixed (U) or a Mach number at the air in use (mach).
export const SCENARIOS = [
  { id: 'shape', title: 'Hình dạng và lực cản',
    sub: 'Tấm phẳng, hình cầu, giọt nước ở 20 m/s',
    task: 'Cùng gió 20 m/s, so sánh lực cản của tấm phẳng, hình cầu và giọt nước trên các thanh ngang. Hình nào cản gió ít nhất, vì sao?',
    modelId: 'plate', U: 20, alphaDeg: 0, env: 'sea', camera: 'side', flow: 'smoke',
    pin: ['plate', 'sphere', 'teardrop'], tab: 'compare', metric: 'FD' },
  { id: 'speed', title: 'Lực cản và tốc độ',
    sub: 'Tấm phẳng, đồ thị F theo v',
    task: 'Kéo thanh tốc độ và đọc F cản trên đồ thị. Gió tăng gấp đôi thì F cản tăng khoảng 4 lần: F tỉ lệ với v² (đường nét đứt).',
    modelId: 'plate', U: 20, alphaDeg: 0, env: 'sea', camera: 'side', flow: 'smoke',
    pin: [], tab: 'curve', metric: 'FD' },
  { id: 'lift', title: 'Lực nâng và góc tấn',
    sub: 'Cánh NACA 2412, góc tấn 0° đến 20° trong 8 s',
    task: 'Góc tấn tăng từ 0° đến 20° trong 8 s. Quan sát F nâng trên đồ thị theo thời gian: tăng dần, rồi tụt mạnh khi dòng khí tách khỏi mặt trên cánh (thất tốc) quanh 15°.',
    modelId: 'wing_2412', U: 20, alphaDeg: 0, env: 'sea', camera: 'side', flow: 'smoke',
    pin: [], tab: 'time', clearTime: true, sweep: { from: 0, to: 20, seconds: 8 } },
  { id: 'cars', title: 'Ô tô A và B ở 72 km/h',
    sub: 'Xe sedan và xe tải thùng, công suất P = F·v',
    task: 'Hai xe cùng chạy 72 km/h (20 m/s). So sánh F cản, rồi đọc công suất thắng lực cản P = F·v ở mục Phân tích. Xe nào tốn công suất hơn?',
    modelId: 'car_sedan', U: 20, alphaDeg: 0, env: 'sea', camera: 'side', flow: 'smoke',
    pin: ['car_sedan', 'truck_box'], tab: 'compare', metric: 'FD', expand: true },
  { id: 'super', title: 'Vượt tốc độ âm thanh',
    sub: 'Tên lửa thám không ở M 1,5',
    task: 'Tên lửa bay ở M 1,5. Mũi tên lửa tròn nên có sóng xung kích cong tách khỏi mũi; xa mũi sóng tiến gần góc Mach ≈ 41,8° (sinμ = 1/M). Xem lực cản tăng vọt khi vượt M 1 trên đồ thị F theo v.',
    modelId: 'rocket_sounding', mach: 1.5, alphaDeg: 0, camera: 'side', flow: 'smoke', shock: true,
    pin: [], tab: 'curve', metric: 'FD', expand: true }
];

/* ---------- shared UI helpers ---------- */
/** tiny DOM builder: h('button', {class:'btn', onClick: fn, 'aria-pressed': 'false'}, 'text', child) */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const k of Object.keys(props)) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.length > 2 && k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = k => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else el.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k);
  };
  kids.forEach(add);
  return el;
}
/** symbol with a subscript, e.g. sym('F','cản') -> F_cản (sub is 11 px minimum) */
export const sym = (a, b) => h('span', null, a, h('span', { class: 'p8-s' }, b));
export function setShown(el, on) {
  el.hidden = !on;
  el.style.display = on ? '' : 'none';
}
export function setText(el, s) { if (el.textContent !== s) el.textContent = s; }

/** Scoped styles for the P8 widgets. Low specificity (:where) so the shell can override anything. */
const CSS = `
:where(.p8-num){font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
:where(.p8-s){font-size:11px;line-height:0;vertical-align:-.25em;margin-left:1px}
:where(.p8-stack){display:flex;flex-direction:column;gap:8px;min-width:0}
:where(.p8-row){display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
:where(.p8-row.p8-between){justify-content:space-between}
:where(.p8-h){font-family:"Barlow Condensed","Be Vietnam Pro",system-ui,sans-serif;font-weight:600;font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#5E636B);margin:0}
:where(.p8-lab){font-size:13px;color:var(--muted,#5E636B)}
:where(.p8-val){font-size:13px;color:var(--ink,#1B1D21)}
:where(.p8-sw){position:relative;min-width:120px;padding-top:12px}
:where(.p8-row>.p8-sw){flex:1 1 140px}
:where(.p8-row.p8-half>button){flex:1 1 0;min-width:0;padding:0 8px}
:where(.p8-sw input[type=range]){display:block;width:100%;margin:0;height:32px}
:where(.p8-tick){position:absolute;top:12px;height:32px;width:2px;margin-left:-1px;pointer-events:none;background:var(--red,#C8102E);opacity:.8}
:where(.p8-tick.p8-zero){background:var(--muted,#5E636B);opacity:.55}
:where(.p8-tick-l){position:absolute;top:0;transform:translateX(-50%);font-size:11px;line-height:12px;pointer-events:none;color:var(--red,#C8102E);white-space:nowrap}
:where(.p8-tick-l.p8-zero){color:var(--muted,#5E636B)}
:where(.p8-chips){display:flex;flex-wrap:wrap;gap:8px}
:where(.p8-chips>button,.p8-seg>button,.p8-btn){min-height:40px}
:where(.p8-seg){display:flex;flex-wrap:wrap;gap:0}
:where(.p8-seg.seg>button){flex:1 1 auto}
:where(.seg button[aria-pressed="true"],.chip[aria-pressed="true"],.btn[aria-pressed="true"]){background:var(--ink,#1B1D21);color:var(--paper,#F4F1EA)}
:where(.p8-in){width:5.5em;min-height:40px;padding:0 8px;font:inherit;text-align:right;border:1px solid var(--line,rgba(27,29,33,.14));border-radius:6px;background:transparent;color:inherit}
:where(.p8-task){display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-left:3px solid var(--red,#C8102E);background:rgba(200,16,46,.06);font-size:13px;line-height:1.4}
:where(.p8-task>span){flex:1;min-width:0}
:where(.p8-pop){position:fixed;z-index:60;max-width:min(380px,calc(100vw - 16px));max-height:min(70vh,calc(100vh - 16px));overflow:auto;padding:6px;background:var(--paper,#F4F1EA);color:var(--ink,#1B1D21);border:1px solid var(--line,rgba(27,29,33,.14));border-radius:6px;box-shadow:0 4px 18px rgba(27,29,33,.18)}
:where(.p8-sc){display:block;width:100%;min-height:48px;padding:8px 10px;text-align:left;font:inherit;color:inherit;background:transparent;border:0;border-radius:6px;cursor:pointer}
:where(.p8-sc:hover,.p8-sc:focus-visible){background:rgba(27,29,33,.07)}
:where(.p8-sc strong){display:block;font-size:14px}
:where(.p8-sc span){display:block;font-size:12px;color:var(--muted,#5E636B)}
:where(.p8-ph){display:flex;align-items:center;justify-content:space-between;gap:8px}
:where(.p8-ph button){min-width:40px;min-height:40px}
:where(.p8-swatch){display:inline-flex;width:14px;height:14px;border-radius:3px;border:1px solid var(--line,rgba(27,29,33,.25));margin-right:6px;vertical-align:-2px;overflow:hidden}
:where(.p8-swatch i){flex:1}
:where(.p8-hint){font-size:12px;color:var(--muted,#5E636B);line-height:1.4;margin:0}
:where(.p8-more){display:none}
:where(.p8-narrow .p8-more){display:inline-flex}
:where(.p8-narrow .p8-extra.p8-collapsed){display:none}
:where(.p8-kvs){display:flex;flex-direction:column}
:where(.p8-kv){display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:3px 0;border-bottom:1px solid var(--line,rgba(27,29,33,.14));font-size:13px;min-width:0}
:where(.p8-kv>span:first-child){color:var(--muted,#5E636B);flex:0 1 auto;min-width:0}
:where(.p8-kv>span:last-child){text-align:right;flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
:where(.p8-grid){display:grid;grid-template-columns:repeat(12,1fr);gap:6px}
:where(.p8-tile){grid-column:span 4;min-width:0;padding:5px 8px;border:1px solid var(--line,rgba(27,29,33,.14));border-radius:6px;display:flex;flex-direction:column;gap:1px}
:where(.p8-tile.p8-w6){grid-column:span 6}
:where(.p8-tile.p8-w12){grid-column:span 12}
:where(.p8-tile-l){font-size:12px;color:var(--muted,#5E636B);line-height:1.2}
:where(.p8-tile-v){font-size:17px;line-height:1.25;color:var(--ink,#1B1D21);overflow-wrap:anywhere}
:where(.p8-tile-v .p8-u){font-size:12px;color:var(--muted,#5E636B);margin-left:3px}
:where(.p8-tile-v .p8-w){font-size:12px;color:var(--muted,#5E636B);margin-left:6px;font-family:inherit}
:where(.p8-bar){display:flex;height:12px;border-radius:3px;overflow:hidden;background:var(--line,rgba(27,29,33,.14))}
:where(.p8-bar>i){display:block;height:100%}
:where(.p8-bar-l){display:flex;flex-wrap:wrap;gap:2px 12px;font-size:12px;color:var(--muted,#5E636B);margin-top:4px}
:where(.p8-bar-l i){display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
:where(.p8-hud){display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;font-size:13px;padding:4px 8px;border-radius:6px;background:rgba(244,241,234,.92);color:var(--ink,#1B1D21);pointer-events:none}
:where(.p8-hud .p8-sub){color:var(--muted,#5E636B);font-size:12px}
:where(.p8-lg){display:flex;flex-direction:column;gap:2px;padding:4px 8px;border-radius:6px;background:rgba(244,241,234,.92);color:var(--ink,#1B1D21);font-size:11px;pointer-events:none}
:where(.p8-lg canvas){display:block;width:100%;height:12px}
:where(.p8-lg-t){display:flex;justify-content:space-between;gap:8px;font-size:12px}
:where(.p8-lg-r){position:relative;height:13px;font-size:11px;line-height:13px;white-space:nowrap}
:where(.p8-lg-r>span){position:absolute;transform:translateX(-50%)}
:where(.p8-lg-r>span.p8-first){transform:none}
:where(.p8-lg-r>span.p8-last){transform:translateX(-100%)}
:where(.p8-ch){display:flex;flex-direction:column;gap:6px;height:100%;min-height:0;min-width:0}
:where(.p8-ch-tools){display:flex;gap:6px;align-items:center;flex-wrap:wrap}
:where(.p8-ch-tools>.p8-sp){flex:1}
:where(.p8-ch-cv){position:relative;flex:1 1 140px;min-height:120px;min-width:0}
:where(.p8-ch-cv canvas){position:absolute;inset:0;width:100%;height:100%;display:block}
:where(.p8-pins){display:flex;gap:6px;flex-wrap:wrap;align-items:center;max-height:80px;overflow:auto}
:where(.p8-ch-bar){display:flex;gap:6px;align-items:center;flex-wrap:wrap}
:where(.p8-ch-bar>.p8-sp){flex:1}
:where(.p8-pin){display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 4px 0 8px;border:1px solid var(--line,rgba(27,29,33,.14));border-radius:6px;font-size:12px;max-width:100%}
:where(.p8-pin b){display:inline-block;width:10px;height:10px;border-radius:2px;flex:none}
:where(.p8-pin span){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
:where(.p8-pin button){min-width:40px;min-height:40px;font:inherit;background:transparent;border:0;color:inherit;cursor:pointer}
:where(.p8-fieldset){border:0;margin:0;padding:0;min-width:0}
`;
export function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('p8-style')) return;
  const s = document.createElement('style');
  s.id = 'p8-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}
