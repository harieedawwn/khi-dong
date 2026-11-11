// P5 — boot, model pipeline and the per-frame loop (SPEC §5).
// frame: atmo (on env change) -> aero.evaluate -> flow.update -> surface fields (<=10 Hz or on alpha/M/regime change)
//        -> modelview -> render modules -> sfx.setWind -> state.emit('results')
import * as stateM from './state.js';
import * as atmoM from './physics/atmo.js';
import * as aeroM from './physics/aero.js';
import * as aerodataM from './physics/aerodata.js';
import * as flowM from './flow/flowfield.js';
import * as surfaceM from './flow/surface.js';
import { createGpuBackend } from './flow/lbm-gpu.js';
import * as assembleM from './geom/assemble.js';
import * as catalogM from './geom/catalog.js';
import * as libraryM from './geom/library.js';
import * as shellM from './ui/shell.js';
import * as pickerM from './ui/picker.js';
import * as builderM from './ui/builder.js';
import * as controlsM from './ui/controls.js';
import * as readoutsM from './ui/readouts.js';
import * as chartsM from './ui/charts.js';
import * as smokeM from './render/smoke.js';
import * as particlesM from './render/particles.js';
import * as vectorsM from './render/vectors.js';
import * as sfxM from './audio/sfx.js';
import { createScene } from './render/scene.js';
import * as modelviewM from './render/modelview.js';

const state = stateM.state || stateM.default;
const assembleFn = assembleM.assemble || assembleM['default'];
const CACHE_MAX = 16, BUILDER_DEBOUNCE_MS = 140;
const SURF_PERIOD = 0.1, SURF_URGENT = 0.05;   // seconds: <=10 Hz steady, <=20 Hz while alpha/M/regime changes

function guessTier() {
  const q = new URLSearchParams(location.search).get('tier');
  if (q === 'low' || q === 'high') return q;
  const mobile = (window.matchMedia && matchMedia('(pointer:coarse)').matches) || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return (mobile || (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 4) ? 'low' : 'high';
}

function fatal(msg) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#16181B;color:#F4F1EA;font:16px/1.5 "Be Vietnam Pro",system-ui,sans-serif;text-align:center;z-index:9999';
  d.textContent = msg; document.body.appendChild(d);
}

async function boot() {
  /* ------------------------------------------------------------ scene, ctx */
  state.set({ tier: guessTier() });
  let scene;
  try { scene = createScene({ tier: state.get().tier }); }
  catch (e) { console.error(e); fatal('Thiết bị hoặc trình duyệt này không hỗ trợ WebGL, nên không hiển thị được ống khí động 3D. (' + (e && e.message ? e.message : e) + ')'); return; }
  state.on('change:tier', () => scene.setTier(state.get().tier));

  const flow = flowM.createFlow();
  // mid-plane solver on the scene's WebGL2 context (falls back to the CPU backend when float targets are missing)
  if (flow.plane) { flow.plane.attachGpu(() => createGpuBackend(scene.renderer), state.get().tier); state.on('change:tier', () => flow.plane.setTier(state.get().tier)); }
  let sfxH = null;
  const sfx = { play: (...a) => (sfxH && sfxH.play ? sfxH.play(...a) : undefined), setWind: (u) => (sfxH && sfxH.setWind ? sfxH.setWind(u) : undefined) };

  /* ----------------------------------------------------- model pipeline */
  const cache = new Map();             // key -> {model, aeroDef}; insertion order = LRU order
  let active = null, activeKey = '', bakeToken = 0, flowReady = false;

  const snapshotOf = (s) => ({ mode: s.mode, modelId: s.modelId, builder: s.builder, alphaDeg: s.alphaDeg });
  const keyOf = (snap) => (snap.mode === 'builder' ? 'B:' + JSON.stringify(snap.builder) : 'L:' + snap.modelId);

  function buildEntry(snap) {
    let parts, aeroDef;
    if (snap.mode === 'builder') parts = catalogM.buildFromBuilder(snap.builder);
    else {
      const L = libraryM.LIBRARY, item = L.find((e) => e.id === snap.modelId) || L[0];
      parts = item.build();
    }
    const model = assembleFn(parts);
    if (snap.mode === 'builder') aeroDef = aerodataM.builderAero(snap.builder, model.info);
    else aeroDef = aerodataM.AERO[snap.modelId] || aerodataM.AERO[libraryM.LIBRARY[0].id];
    return { model, aeroDef };
  }
  function entryFor(snap) {
    const k = keyOf(snap); let e = cache.get(k);
    if (e) { cache.delete(k); cache.set(k, e); return e; }
    e = buildEntry(snap); cache.set(k, e);
    if (cache.size > CACHE_MAX) for (const [ck, ce] of cache) { if (ce !== active && ck !== k) { cache.delete(ck); break; } }
    return e;
  }

  let surfFields = null, surfDirty = true, evalDirty = true;
  function loadModel(force) {
    const snap = snapshotOf(state.get()), key = keyOf(snap);
    if (!force && key === activeKey) return;
    let e;
    try { e = entryFor(snap); } catch (err) { console.error('[model]', err); return; }
    activeKey = key; active = e;
    surfFields = null; flowReady = false; surfDirty = true; evalDirty = true;
    modelview.setModel(e.model);
    const tk = ++bakeToken;
    Promise.resolve(flow.setModel(e.model, e.aeroDef)).then(() => { if (tk === bakeToken) { flowReady = true; surfDirty = true; } }).catch((err) => console.error('[flow bake]', err));
    state.emit('model:ready', { key, model: e.model });
  }
  let builderTimer = 0;
  function scheduleLoad(debounce) {
    clearTimeout(builderTimer);
    if (debounce) builderTimer = setTimeout(() => loadModel(false), BUILDER_DEBOUNCE_MS); else loadModel(false);
  }

  const ctx = {
    state, scene, flow, aero: aeroM, atmo: atmoM, aerodata: aerodataM, library: libraryM, catalog: catalogM,
    assemble: assembleFn, sfx, uvis: 0,
    getModel: () => (active ? active.model : null),
    evaluateSnapshot(snapshot, U, air) {
      const e = entryFor(snapshot);
      return aeroM.evaluate({ aeroDef: e.aeroDef, info: e.model.info, air, U, alphaDeg: snapshot.alphaDeg });
    },
    curveFor(snapshot, air, Umax, n) {
      const e = entryFor(snapshot);
      return aeroM.curve(e.aeroDef, e.model.info, air, snapshot.alphaDeg, Umax, n);
    },
  };

  /* ---------------------------------------------------------------- init */
  const initMod = async (name, mod) => {
    try { const r = typeof mod.init === 'function' ? await mod.init(ctx) : undefined; return r && typeof r === 'object' ? r : mod; }
    catch (e) { console.error('[init ' + name + ']', e); return null; }
  };
  sfxH = await initMod('sfx', sfxM);
  await initMod('shell', shellM);
  { const st = document.querySelector('#app .stage'); if (st) scene.setParent(st); }
  const modelview = modelviewM.init(ctx); ctx.modelview = modelview;
  loadModel(true);                                    // first model before UI modules ask for ctx.getModel()
  await initMod('controls', controlsM);
  await initMod('readouts', readoutsM);
  await initMod('charts', chartsM);
  await initMod('picker', pickerM);
  await initMod('builder', builderM);
  const renderMods = [];
  for (const [n, m] of [['smoke', smokeM], ['particles', particlesM], ['vectors', vectorsM]]) { const h = await initMod(n, m); if (h && typeof h.update === 'function') renderMods.push(h); }

  state.on('change:mode', () => scheduleLoad(false));
  state.on('change:modelId', () => scheduleLoad(false));
  state.on('change:builder', () => scheduleLoad(true));
  state.on('change:camera', () => scene.setCamera(state.get().camera));
  scene.setCamera(state.get().camera || 'overview');

  /* ----------------------------------------------------------- frame loop */
  const evalArgs = { aeroDef: null, info: null, air: null, U: 0, alphaDeg: 0 };
  const results = { air: null, aero: null, surface: { frontPa: 0, frontN: 0, stagPa: 0, windwardN: 0, windwardMeanPa: 0, cpRange: [0, 1] }, probe: null, U: 0, Uvis: 0, slow: 1, phase: 0 };
  let air = null, envH = NaN, envT = NaN, envP = NaN, envMode = '';
  let res = null, lastU = NaN, lastAlpha = NaN, lastAir = null, lastActive = null;
  let clock = 0, lastSurf = -1, pending = false, urgent = false;
  let lastSA = NaN, lastSM = NaN, lastFlow = '', lastBl = '', lastWake = '', lastHeat = '', lastWindU = NaN, lastSound = null;

  function tick(dt) {
    if (!active) return;
    clock += dt;
    const s = state.get(), env = s.env;
    if (!air || env.h !== envH || env.T !== envT || env.p !== envP || env.mode !== envMode) {
      envH = env.h; envT = env.T; envP = env.p; envMode = env.mode; air = atmoM.air(env);
    }
    const U = s.U, alpha = s.alphaDeg;
    // U_vis (SPEC 3) times the solver's visual time scale k <= 1 (step budget / governor), so every animation stays consistent
    const Uvis = Math.min(4, 0.55 * Math.pow(U, 0.45)) * (flow.visScale ? flow.visScale() : 1);
    ctx.uvis = Uvis;

    let inputsChanged = false;
    if (evalDirty || U !== lastU || alpha !== lastAlpha || air !== lastAir || active !== lastActive) {
      evalArgs.aeroDef = active.aeroDef; evalArgs.info = active.model.info; evalArgs.air = air; evalArgs.U = U; evalArgs.alphaDeg = alpha;
      res = aeroM.evaluate(evalArgs);
      lastU = U; lastAlpha = alpha; lastAir = air; lastActive = active; evalDirty = false; inputsChanged = true;
    }

    if (flowReady) flow.update(res, alpha, Uvis, dt);

    // surface fields: <= 10 Hz, sooner when alpha / Mach / regime change
    const rg = res.regime || {};
    if (inputsChanged) {
      pending = true;
      if (alpha !== lastSA || Math.abs(res.M - lastSM) > 0.005 || rg.flow !== lastFlow || rg.bl !== lastBl || rg.wake !== lastWake) urgent = true;
    }
    if (flowReady && (pending || surfDirty) && clock - lastSurf >= (urgent || surfDirty ? SURF_URGENT : SURF_PERIOD)) {
      surfFields = surfaceM.surfaceFields(flow, active.model, res, air, alpha);
      lastSurf = clock; pending = urgent = surfDirty = false;
      lastSA = alpha; lastSM = res.M; lastFlow = rg.flow; lastBl = rg.bl; lastWake = rg.wake;
      lastHeat = s.view.heatmap;
      modelview.applyHeatmap(lastHeat, surfFields);
    } else if (s.view.heatmap !== lastHeat) {
      lastHeat = s.view.heatmap; modelview.applyHeatmap(lastHeat, surfFields);
    }

    modelview.setForces(res);
    modelview.update(dt);
    scene.setWind(Uvis);
    for (let i = 0; i < renderMods.length; i++) renderMods[i].update(dt);
    if (U !== lastWindU || s.sound !== lastSound) { lastWindU = U; lastSound = s.sound; sfx.setWind(s.sound === false ? 0 : U); }

    results.air = air; results.aero = res; results.U = U; results.Uvis = Uvis; results.slow = Uvis > 0 ? U / Uvis : 1;
    results.phase = flowReady ? flow.phase() : 0;
    const sf = results.surface;
    if (surfFields) { sf.frontPa = surfFields.frontPa; sf.frontN = surfFields.frontN; sf.stagPa = surfFields.stagPa; sf.windwardN = surfFields.windwardN; sf.windwardMeanPa = surfFields.windwardMeanPa; sf.cpRange = surfFields.cpRange; } else { sf.frontPa = 0; sf.frontN = 0; sf.stagPa = 0; sf.windwardN = 0; sf.windwardMeanPa = 0; }
    const pr = s.probe;
    results.probe = pr && pr.on && flowReady ? flow.probe(pr.x, pr.y, pr.z) : null;
    state.emit('results', results);
  }
  scene.onFrame(tick);

  scene.renderer.compile(scene.scene, scene.camera);   // warm up shaders before the first interaction
  window.__kit = { renderer: scene.renderer, tier: state.get().tier };
  window.__app = { ctx, modelview, scene, results, loadModel };
  window.__ready = true;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
