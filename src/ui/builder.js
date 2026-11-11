// src/ui/builder.js  (P4)  Công cụ 2 "Tự lắp ghép": chọn mũi, thân, đuôi, cánh, đuôi lái và kéo kích thước.
// Gắn vào #modelPanel khi state.mode === 'builder'. Ghi state.builder (trễ 150 ms). Thanh trượt sinh từ catalog.SLOTS.
const TAB_LABEL = { nose: 'Mũi', body: 'Thân', tail: 'Đuôi', wing: 'Cánh', fins: 'Đuôi lái' };
const TEMPLATE_ORDER = ['rocket', 'plane', 'teardrop', 'car'];
const CSS = `
.bld{display:flex;flex-direction:column;gap:8px;min-height:0;height:100%}
.bld[hidden]{display:none}
.bld-top{display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:0 0 auto}
.bld .chip,.bld .btn{min-height:36px;padding:0 9px;font-size:12.5px;line-height:1.4;cursor:pointer;touch-action:manipulation;justify-content:center}
.bld .btn{display:inline-flex;align-items:center;border:1px solid var(--line,rgba(27,29,33,.14));border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:13px}
.bld-lbl{flex:0 0 auto;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#5E636B)}
.bld-top .chip{font-weight:600;border-color:var(--red,#C8102E);color:var(--red,#C8102E)}
.bld-tabs{display:flex;gap:4px;flex:0 0 auto;border-bottom:1px solid var(--line,rgba(27,29,33,.14))}
.bld-tabs button{flex:1 1 0;min-width:0;min-height:40px;padding:0 4px;border:0;border-bottom:3px solid transparent;background:transparent;color:var(--muted,#5E636B);font:inherit;font-size:13px;font-weight:600;line-height:1.4;cursor:pointer;touch-action:manipulation;overflow-wrap:anywhere}
.bld-tabs button[aria-selected="true"]{color:var(--ink,#1B1D21);border-bottom-color:var(--red,#C8102E)}
.bld-body{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:2px 1px}
.bld-opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(74px,1fr));gap:6px}
.bld-opt{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;min-height:56px;padding:5px 4px;font:inherit;font-size:12px;line-height:1.3;text-align:center;color:inherit;cursor:pointer;touch-action:manipulation;background:var(--paper,#F4F1EA);border:1px solid var(--line,rgba(27,29,33,.14));border-radius:6px;transition:border-color 160ms cubic-bezier(.2,.7,.2,1)}
.bld-opt svg{width:40px;height:22px;flex:0 0 auto;color:var(--ink,#1B1D21)}
.bld-opt[aria-pressed="true"]{border-color:var(--red,#C8102E);box-shadow:inset 0 0 0 1px var(--red,#C8102E)}
.bld-opt span{overflow-wrap:anywhere}
.bld-row{display:flex;flex-direction:column;gap:2px}
.bld-row label{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:12.5px;line-height:1.4}
.bld-row output{font-family:var(--mono,"JetBrains Mono",ui-monospace,Menlo,monospace);font-variant-numeric:tabular-nums;font-size:12.5px;white-space:nowrap}
.bld-row input[type=range]{width:100%;min-height:32px;margin:0;accent-color:var(--red,#C8102E);touch-action:pan-y}
.bld-row .seg{align-self:flex-start}
.bld-row.inline{flex-direction:row;align-items:center;justify-content:space-between;gap:8px}
.bld-row.inline label{flex:1 1 auto;min-width:0}
.bld-row .seg button{min-height:36px;padding:0 10px;font:inherit;font-size:13px;cursor:pointer}
.bld-sum{flex:0 0 auto;font-size:12.5px;line-height:1.4;padding-top:6px;border-top:1px solid var(--line,rgba(27,29,33,.14));font-variant-numeric:tabular-nums}
.bld-sum b{font-weight:600}
@media (pointer:coarse){.bld-row input[type=range]{min-height:40px}.bld .chip,.bld .btn,.bld-row .seg button{min-height:44px}.bld-tabs button{min-height:44px}}
`;
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');
const decimals = step => (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);
const shortLabel = s => s.replace(/\s*\(.*\)\s*/, '');
const clone = b => ({ ...b, p: { ...(b.p || {}) } });

// hình bóng nhỏ cho từng lựa chọn (viewBox 40x22); mũi hướng về bên trái, cánh nhìn từ trên, đuôi lái nhìn từ phía sau
const F = 'fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"';
const ICON = {
  nose: { cone: `<path ${F} d="M3 11 L35 3 L35 19 Z"/>`, ogive: `<path ${F} d="M3 11 C12 4 22 3 35 3 L35 19 C22 19 12 18 3 11 Z"/>`, round: `<path ${F} d="M35 3 L20 3 A15 8 0 0 0 20 19 L35 19 Z"/>`, flat: `<path ${F} d="M5 4 L35 3 L35 19 L5 18 Z"/>` },
  body: { round: `<circle ${F} cx="20" cy="11" r="8"/>`, oval: `<ellipse ${F} cx="20" cy="11" rx="12" ry="7"/>`, box: `<rect ${F} x="9" y="3" width="22" height="16" rx="5"/>` },
  tail: { point: `<path ${F} d="M5 3 L36 11 L5 19 Z"/>`, round: `<path ${F} d="M5 3 L19 3 A15 8 0 0 1 19 19 L5 19 Z"/>`, blunt: `<path ${F} d="M5 3 L30 6 L30 16 L5 19 Z"/>` },
  wing: { none: `<rect ${F} x="4" y="9" width="32" height="4" rx="2"/>`, straight: `<rect ${F} x="4" y="9" width="32" height="4" rx="2"/><path ${F} d="M16 9 L16 1 L25 1 L25 9 Z M16 13 L16 21 L25 21 L25 13 Z"/>`, swept: `<rect ${F} x="4" y="9" width="32" height="4" rx="2"/><path ${F} d="M14 9 L26 1 L30 1 L25 9 Z M14 13 L26 21 L30 21 L25 13 Z"/>`, delta: `<rect ${F} x="4" y="9" width="32" height="4" rx="2"/><path ${F} d="M12 9 L28 1 L28 9 Z M12 13 L28 21 L28 13 Z"/>` },
  fins: { none: `<circle cx="20" cy="11" r="3.5" fill="none" stroke="currentColor" stroke-width="1.4"/>`, tee: `<circle ${F} cx="20" cy="15" r="3.5"/><path d="M20 12 L20 3 M12 3 L28 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>`, cross: `<circle ${F} cx="20" cy="11" r="3.5"/><path d="M20 2 L20 20 M11 11 L29 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>` },
};
const icon = (slot, id) => `<svg viewBox="0 0 40 22" aria-hidden="true" focusable="false">${(ICON[slot] && ICON[slot][id]) || ''}</svg>`;

export function init(ctx) {
  const { state, catalog } = ctx, host = document.getElementById('modelPanel');
  if (!host || !catalog || !catalog.SLOTS) return;
  if (!document.getElementById('p4-bld-css')) { const st = document.createElement('style'); st.id = 'p4-bld-css'; st.textContent = CSS; document.head.appendChild(st); }
  const SLOTS = catalog.SLOTS;
  let local = clone(state.get().builder || {}), slot = SLOTS[0].key, timer = 0, selfSet = false;

  const root = document.createElement('section'); root.className = 'tool bld'; root.setAttribute('aria-label', 'Tự lắp ghép');
  root.innerHTML = '<div class="bld-top" role="group" aria-label="Mẫu có sẵn"></div><div class="bld-tabs" role="tablist" aria-label="Bộ phận"></div><div class="bld-body" role="tabpanel"></div><div class="bld-sum" aria-live="polite"></div>';
  host.appendChild(root);
  const top = root.querySelector('.bld-top'), tabs = root.querySelector('.bld-tabs'), body = root.querySelector('.bld-body'), sum = root.querySelector('.bld-sum');

  // ---- dựng từ mẫu (bấm là có hình đẹp, rồi chỉnh tham số) + đặt lại
  const lbl = document.createElement('div'); lbl.className = 'bld-lbl'; lbl.textContent = 'Dựng từ mẫu'; top.appendChild(lbl);
  for (const k of TEMPLATE_ORDER.filter(k => catalog.TEMPLATES && catalog.TEMPLATES[k])) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = catalog.TEMPLATES[k].label;
    b.addEventListener('click', () => { ctx.sfx && ctx.sfx.play('tap'); setAll(clone(catalog.TEMPLATES[k].builder)); }); top.appendChild(b);
  }
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'btn'; reset.textContent = 'Đặt lại';
  reset.addEventListener('click', () => { ctx.sfx && ctx.sfx.play('tap'); setAll({ ...catalog.DEFAULT_BUILDER, p: catalog.defaultParams() }); }); top.appendChild(reset);

  // ---- tab bộ phận
  for (const s of SLOTS) {
    const t = document.createElement('button'); t.type = 'button'; t.setAttribute('role', 'tab'); t.dataset.k = s.key; t.textContent = TAB_LABEL[s.key] || s.label;
    t.addEventListener('click', () => { if (slot === s.key) return; ctx.sfx && ctx.sfx.play('tick'); slot = s.key; renderSlot(); }); tabs.appendChild(t);
  }

  function commit(now) { // cập nhật state.builder, trễ 150 ms khi đang kéo
    clearTimeout(timer);
    const go = () => { selfSet = true; try { state.set({ builder: clone(local) }); } finally { selfSet = false; } };
    if (now) go(); else timer = setTimeout(go, 150);
  }
  function setAll(b) { local = clone(b); renderSlot(); commit(true); }

  // thông số nào có tác dụng với lựa chọn hiện tại
  function relevant(key, pid) {
    if (key === 'body' && pid === 'heightRatio') return local.body !== 'round';
    if (key === 'tail' && pid === 'boattailDeg') return local.tail !== 'round';
    if (key === 'wing') return local.wing !== 'none';
    if (key === 'fins') return local.fins !== 'none';
    return true;
  }
  function renderSlot() {
    const S = SLOTS.find(x => x.key === slot) || SLOTS[0];
    tabs.querySelectorAll('button').forEach(t => { const on = t.dataset.k === S.key; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    body.textContent = '';
    const opts = document.createElement('div'); opts.className = 'bld-opts'; opts.setAttribute('role', 'group'); opts.setAttribute('aria-label', TAB_LABEL[S.key] || S.label);
    for (const o of S.options) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'bld-opt'; b.title = o.label; b.setAttribute('aria-pressed', String(local[S.key] === o.id));
      b.innerHTML = icon(S.key, o.id) + '<span></span>'; b.querySelector('span').textContent = shortLabel(o.label);
      b.addEventListener('click', () => { if (local[S.key] === o.id) return; ctx.sfx && ctx.sfx.play('toggle'); local[S.key] = o.id; renderSlot(); commit(false); });
      opts.appendChild(b);
    }
    body.appendChild(opts);
    for (const q of S.params) { if (!relevant(S.key, q.id)) continue; body.appendChild(paramRow(q)); }
    summary();
  }
  function paramRow(q) {
    const row = document.createElement('div'); row.className = 'bld-row';
    const cur = local.p[q.id] ?? q.default;
    if (q.type === 'choice') { // biên dạng cánh
      row.innerHTML = '<label><span></span></label><div class="seg" role="group"></div>'; row.querySelector('label span').textContent = q.label; const seg = row.querySelector('.seg');
      for (const o of q.options) { const b = document.createElement('button'); b.type = 'button'; b.textContent = shortLabel(o.label); b.setAttribute('aria-pressed', String(cur === o.id)); b.title = o.label;
        b.addEventListener('click', () => { local.p[q.id] = o.id; seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); ctx.sfx && ctx.sfx.play('tick'); summary(); commit(false); }); seg.appendChild(b); }
      return row;
    }
    if (q.max - q.min <= 1 && q.step >= 1) { // công tắc 0/1 (bánh xe)
      row.classList.add('inline'); row.innerHTML = '<label><span></span></label><div class="seg" role="group"></div>'; row.querySelector('label span').textContent = q.label.replace(/\s*\(.*\)/, ''); const seg = row.querySelector('.seg');
      for (const [v, t] of [[0, 'Không'], [1, 'Có']]) { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.setAttribute('aria-pressed', String(Math.round(cur) === v));
        b.addEventListener('click', () => { local.p[q.id] = v; seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); ctx.sfx && ctx.sfx.play('toggle'); summary(); commit(false); }); seg.appendChild(b); }
      return row;
    }
    const id = 'bld-' + q.id, d = decimals(q.step), unit = q.unit ? ' ' + q.unit : '';
    row.classList.add('slider');
    row.innerHTML = `<label for="${id}"><span></span><output class="num"></output></label><input id="${id}" class="range" type="range" min="${q.min}" max="${q.max}" step="${q.step}">`;
    const inp = row.querySelector('input'), out = row.querySelector('output'); row.querySelector('label span').textContent = q.label;
    inp.value = cur; out.textContent = fmt(+cur, d) + unit;
    inp.addEventListener('input', () => { const v = +inp.value; local.p[q.id] = v; out.textContent = fmt(v, d) + unit; summary(); commit(false); });
    return row;
  }
  function summary() { // một dòng: L, D, độ thuôn L/D (theo kích thước thực sau khi bị giới hạn vào ống)
    let txt = '';
    try {
      const Lo = catalog.layout(local), D = Math.sqrt(Lo.W * Lo.Hh), L = Lo.Ltot;
      const shrunk = Lo.W < (local.p.diameter ?? Lo.W) - 5e-4 || Lo.nl + Lo.Lb < (local.p.noseLen + local.p.length) - 5e-4;
      txt = `<b>L</b> ${fmt(L)} m · <b>D</b> ${fmt(D)} m · <b>độ thuôn L/D</b> ${fmt(L / D, 1)}` + (shrunk ? ' · đã thu nhỏ cho vừa ống' : '');
    } catch (err) { txt = ''; }
    sum.innerHTML = txt;
  }

  state.on('change:builder', () => { if (selfSet) return; local = clone(state.get().builder); renderSlot(); });
  state.on('change:mode', () => { root.hidden = state.get().mode !== 'builder'; });
  root.hidden = state.get().mode !== 'builder'; renderSlot();
}
