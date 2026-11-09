// src/ui/picker.js  (P4)  Công cụ 1 "Thư viện mẫu": chọn một mô hình có sẵn.
// Gắn vào #modelPanel khi state.mode === 'library'. Đặt state.modelId. Ảnh nhỏ dựng lười, lưu cache; huy hiệu C_D tính ở 20 m/s, ISA mực nước biển.
const GROUP_LABEL = { rocket: 'Tên lửa', plane: 'Máy bay', heli: 'Trực thăng', wing: 'Cánh', race: 'Xe đua', car: 'Xe con', truck: 'Xe tải', shape: 'Hình học' };
const GROUP_ORDER = ['rocket', 'plane', 'heli', 'wing', 'race', 'car', 'truck', 'shape'];
const CSS = `
.pk{display:flex;flex-direction:column;gap:6px;min-height:0;height:100%}
.pk[hidden]{display:none}
.pk-groups{display:flex;flex-wrap:wrap;gap:6px;flex:0 0 auto}
.pk-groups .chip{min-height:36px;padding:0 11px;cursor:pointer;font-size:13px;line-height:1.4;justify-content:center;touch-action:manipulation}
.pk-groups .chip[aria-pressed="true"]{background:var(--red,#C8102E);border-color:var(--red,#C8102E);color:#fff}
.pk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px;align-content:start;flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:1px}
.pk-card{display:flex;flex-direction:column;gap:4px;min-width:0;padding:4px;text-align:left;cursor:pointer;touch-action:manipulation;font:inherit;color:inherit;background:var(--paper,#F4F1EA);border:1px solid var(--line,rgba(27,29,33,.14));border-radius:6px;transition:border-color 160ms cubic-bezier(.2,.7,.2,1),box-shadow 160ms cubic-bezier(.2,.7,.2,1)}
.pk-card:hover{border-color:var(--muted,#5E636B)}
.pk-card[aria-pressed="true"]{border-color:var(--red,#C8102E);box-shadow:inset 0 0 0 1px var(--red,#C8102E)}
.pk-thumb{position:relative;aspect-ratio:16/10;border-radius:4px;overflow:hidden;background:#20242A}
.pk-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity 200ms cubic-bezier(.2,.7,.2,1)}
.pk-thumb img.ok{opacity:1}
.pk-name{font-size:12.5px;line-height:1.3;font-weight:600;overflow-wrap:anywhere}
.pk-card .badge{align-self:flex-start;font-size:11.5px;line-height:1.4;padding:0 6px;border-radius:4px;font-variant-numeric:tabular-nums;white-space:nowrap}
.pk-note{flex:0 0 auto;font-size:12px;line-height:1.4;color:var(--muted,#5E636B);min-height:1.4em}
@media (pointer:coarse){.pk-groups .chip{min-height:44px}}
`;
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');

export function init(ctx) {
  const { state, library } = ctx, host = document.getElementById('modelPanel');
  if (!host || !library || !library.LIBRARY) return;
  if (!document.getElementById('p4-pk-css')) { const st = document.createElement('style'); st.id = 'p4-pk-css'; st.textContent = CSS; document.head.appendChild(st); }
  const entries = library.LIBRARY, cache = new Map(); // id -> {cd, url} (không giữ mô hình)
  const groups = GROUP_ORDER.filter(g => entries.some(e => e.group === g));
  const entryOf = id => entries.find(e => e.id === id);
  let group = (entryOf(state.get().modelId) || entries[0]).group, token = 0, observer = null;

  const root = document.createElement('section'); root.className = 'tool pk'; root.setAttribute('aria-label', 'Thư viện mẫu');
  const chipBox = document.createElement('div'); chipBox.className = 'pk-groups'; chipBox.setAttribute('role', 'group'); chipBox.setAttribute('aria-label', 'Nhóm mô hình');
  const grid = document.createElement('div'); grid.className = 'pk-grid';
  const note = document.createElement('div'); note.className = 'pk-note'; note.setAttribute('aria-live', 'polite');
  root.append(chipBox, grid, note); host.appendChild(root);

  const chips = {};
  for (const g of groups) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = GROUP_LABEL[g] || g; b.dataset.g = g;
    b.addEventListener('click', () => { if (group === g) return; ctx.sfx && ctx.sfx.play('tick'); group = g; renderGrid(); syncChips(); });
    chipBox.appendChild(b); chips[g] = b;
  }
  const syncChips = () => { for (const g of groups) chips[g].setAttribute('aria-pressed', String(g === group)); };

  // ---- hàng đợi dựng ảnh nhỏ: từng mô hình một, không chặn giao diện
  const queue = []; let busy = false;
  const schedule = fn => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 300 }) : setTimeout(fn, 16));
  async function work() {
    if (busy) return; busy = true;
    try {
      while (queue.length) {
        const job = queue.shift(); if (job.tk !== token && !job.card.isConnected) continue;
        await new Promise(r => schedule(r));
        if (cache.has(job.e.id)) { paint(job.card, job.e.id); continue; }
        try {
          const model = ctx.assemble(job.e.build()), air = ctx.atmo.air({ mode: 'altitude', h: 0, T: 288.15, p: 101325 });
          let cd = NaN; try { cd = ctx.aero.evaluate({ aeroDef: ctx.aerodata.AERO[job.e.id], info: model.info, air, U: 20, alphaDeg: 0 }).CD; } catch (err) { /* thiếu dữ liệu khí động: huy hiệu "—" */ }
          let url = ''; try { url = await ctx.scene.thumbnail(model, Math.round(220 * Math.min(window.devicePixelRatio || 1, 2))); } catch (err) { /* không có ảnh */ }
          cache.set(job.e.id, { cd, url });
        } catch (err) { cache.set(job.e.id, { cd: NaN, url: '' }); }
        paint(job.card, job.e.id);
      }
    } finally { busy = false; }
  }
  function paint(card, id) {
    const c = cache.get(id); if (!c || !card.isConnected) return;
    const img = card.querySelector('img'), bd = card.querySelector('.badge');
    if (c.url) { img.src = c.url; img.onload = () => img.classList.add('ok'); if (img.complete) img.classList.add('ok'); }
    bd.innerHTML = Number.isFinite(c.cd) ? `C<sub>D</sub> ${fmt(c.cd)}` : 'C<sub>D</sub> —';
    bd.title = 'Hệ số cản ở 20 m/s, góc tới 0 độ, khí quyển chuẩn mực nước biển';
  }
  const request = card => { const e = entryOf(card.dataset.id); if (card.dataset.q) return; card.dataset.q = '1'; queue.push({ e, card, tk: token }); work(); };

  function renderGrid() {
    token++; queue.length = 0; if (observer) observer.disconnect(); grid.textContent = ''; grid.scrollTop = 0;
    const sel = state.get().modelId, cards = [];
    for (const e of entries.filter(x => x.group === group)) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'pk-card'; card.dataset.id = e.id; card.title = e.note || e.name;
      card.setAttribute('aria-pressed', String(e.id === sel));
      card.innerHTML = '<span class="pk-thumb"><img alt="" decoding="async"></span><span class="pk-name"></span><span class="badge">C<sub>D</sub> …</span>';
      card.querySelector('.pk-name').textContent = e.name; card.querySelector('img').alt = e.name;
      card.addEventListener('click', () => choose(e.id));
      grid.appendChild(card); cards.push(card);
      if (cache.has(e.id)) paint(card, e.id);
    }
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(list => { for (const it of list) if (it.isIntersecting) { request(it.target); observer.unobserve(it.target); } }, { root: grid, rootMargin: '80px' });
      cards.forEach(c => observer.observe(c));
    } else cards.forEach(request);
    showNote();
  }
  function showNote() { const e = entryOf(state.get().modelId); note.textContent = e ? `${e.name}. ${e.note || ''}` : ''; }
  function choose(id) {
    if (state.get().modelId === id && state.get().mode === 'library') return;
    ctx.sfx && ctx.sfx.play('swap'); state.set({ modelId: id, mode: 'library' });
  }
  function syncSelection() {
    const id = state.get().modelId, e = entryOf(id);
    if (e && e.group !== group) { group = e.group; renderGrid(); syncChips(); return; }
    grid.querySelectorAll('.pk-card').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.id === id))); showNote();
  }
  const syncMode = () => { root.hidden = state.get().mode !== 'library'; };

  state.on('change:modelId', syncSelection); state.on('change:mode', syncMode);
  syncChips(); renderGrid(); syncMode();
}
