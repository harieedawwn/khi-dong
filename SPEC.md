# SPEC — Ống khí động: khảo sát lực cản và lực nâng (v1)

## 1. Goal
Browser 3D wind-tunnel lab for Vật lí 10 KNTT, Bài 19 "Lực cản và lực nâng" (drag and lift depend on shape and speed; lift differs from Archimedes buoyancy) plus standard fluid mechanics. Exactly one model in the tunnel at a time. Used by a teacher on a projector and by students on phones, including Zalo/Facebook in-app browsers. Runs offline by double-clicking dist/index.html and online on GitHub Pages. All UI text in Vietnamese, no emoji.

## 2. Files and owners (one job per file)
- P7: index.html, src/styles.css, src/state.js, src/ui/shell.js, src/fonts/*
- P1: src/physics/atmo.js, src/physics/aero.js, src/physics/aerodata.js, test/physics.test.mjs
- P2: src/flow/flowfield.js, src/flow/surface.js, test/flow.test.mjs
- P3: src/geom/parts.js, src/geom/assemble.js, src/geom/catalog.js, test/geom.test.mjs
- P4: src/geom/library.js, src/ui/picker.js, src/ui/builder.js
- P5: src/render/scene.js, src/render/modelview.js, src/main.js, test/stubs.mjs
- P6: src/render/smoke.js, src/render/particles.js, src/render/vectors.js, src/audio/sfx.js
- P8: src/config.js, src/ui/controls.js, src/ui/readouts.js, src/ui/charts.js
- P9: package.json, build.mjs, dist/, README.md, ACCEPTANCE.md
Plain ES modules. Only runtime dependency: three (import from 'three' and 'three/addons/...'). esbuild bundles src/main.js into one classic IIFE script dist/app.js so file:// works. Each job tests its files with local stubs of the others.

## 3. World and conventions
- SI units, world in metres. Freestream along +x; y up; z across.
- Test section (glass): x -3..3, y -0.8..0.8, z -1.2..1.2. Contraction upstream of x -3, diffuser and fan downstream of x 3. Smoke rake at x -2.6.
- Model frame: nose toward -x, reference point at the origin; mounted at the world origin on a strut from the floor (no ground effect, also for cars).
- Angle of attack alpha in degrees, -20..30: world = rotateZ(-alpha)·model, so alpha > 0 raises the nose. Drag along +x; lift along y, perpendicular to the freestream.
- Size limits: length <= 1.6 m, span <= 1.6 m, frontal area <= 0.23 m² (6 % blockage). Exception: spanning 2D models (cylinder, wing_*) run wall to wall, z -1.2..1.2.
- Model mesh <= 50 000 vertices; max edge <= 1.5 % of model length (smooth heatmaps).
- Slow motion for visuals: U_vis = min(4, 0.55·U^0.45) m/s. All animation uses U_vis; every displayed number uses the true U. HUD shows "Mô phỏng chậm ×(U/U_vis)".
- UI smooths displayed values (tau 0.25 s). All randomness from seeded PRNGs: same inputs, same picture and numbers.

## 4. State (src/state.js)
API: state.get(); state.set(patch) shallow-merges top-level keys and emits 'change:<key>' and 'change'; state.on(event, fn) returns off(); state.emit(event, data).
Shape and defaults:
{ mode:'library'|'builder' (='library'), modelId:'sphere', builder:{nose:'ogive', body:'round', tail:'point', wing:'none', fins:'cross', p:{catalog defaults}},
  U:20, alphaDeg:0, env:{mode:'altitude'|'custom', h:0, T:288.15, p:101325},
  view:{flow:'smoke'|'particles'|'vectors', smokeColor:'white'|'red'|'blue'|'orange'|'multi', density:0.7, lines:24, rake:'plane'|'grid', heatmap:'off'|'pressure'|'friction', forces:true, shock:true},
  camera:'overview'|'side'|'top'|'wake'|'inside', probe:{on:false, x:0.6, y:0.15, z:0},
  pins:[{id, label, snapshot:{mode, modelId, builder, alphaDeg}}], sound:true, tier:'low'|'high' }
Event 'results' every frame: {air, aero, surface:{frontPa, frontN, cpRange}, probe, U, Uvis, slow, phase}.

## 5. Module APIs
- atmo.air(env) -> {T, p, rho, mu, nu, a}
- aero.evaluate({aeroDef, info, air, U, alphaDeg}) -> {Re, M, q, p0, T0, CD, CL, CDf, CDp, CDi, CDw, FD, FL, LD|null, St, fShed, Dshed, regime:{flow:'subsonic'|'transonic'|'supersonic', bl:'laminar'|'transition'|'turbulent', wake:'none'|'bubble'|'street'|'irregular'}, sepDeg, cpb, Aref, ArefKind:'frontal'|'planform', Lref, power, buoyancy, machAngleDeg|null, surfacesCL:[{id, CL}]}
- aero.fluct(res, phase) -> {dCD, dCL}; aero.curve(aeroDef, info, air, alphaDeg, Umax, n) -> [{U, FD, FL}]
- aerodata.AERO[id] -> aeroDef; aerodata.builderAero(builder, info) -> aeroDef.
  aeroDef = {kind:'sphere'|'cylinder'|'plate'|'buildup', Lref:'D'|'L'|'chord', Aref:'frontal'|'planform', cdRef?, reRef?, clRef?, sep:{mode:'angle'|'edge', lamDeg, turbDeg, reCrit, cpbLam, cpbTurb}, st, wakeMinRe, clAmp, mach:{mdd, kpeak, kinf}, nose:'sharp'|'round'|'blunt', noseHalfDeg, lifting:[{partId, a0, alpha0Deg, tc, e, sharpLE}], source}
- parts.make(kind, params) -> Part {id, kind, role:'nose'|'body'|'tail'|'wing'|'fin'|'wheel'|'rotor'|'detail'|'shape', geometry (indexed BufferGeometry: position, normal, tone 0 main / 1 accent / 2 dark), sdf(x,y,z), flow:boolean, spin?:{axis, rate}, wing?:{rootLE, tipLE, rootChord, tipChord, tc, sweepDeg, spanning, mirror}} in model frame.
- assemble(parts) -> Model {geometry (merged, with 'color' attribute), parts, sdf(x,y,z), spanning:boolean, colloc:{pos, nrm} (Float32Array, <= 600 points on flow parts, none inside other parts), liftingLines:[{id, a:[x,y,z], b:[x,y,z], chord, spanning}], info:{frontal, planform, sideArea, wetted, volume, L, D, span, bbox, body:{L, D, wetted, baseArea, noseArea}, wings:[{id, S, span, chord, tc, sweepDeg, AR, spanning, wetted}]}}
- catalog: SLOTS (Vietnamese labels, options, params {min, max, step, default, unit}): nose cone|ogive|round|flat (noseLen); body round|oval|box (length, diameter, heightRatio); tail point|round|blunt (boattailDeg); wing none|straight|swept|delta (span, chord, profile '0012'|'2412'|'plate', posX); fins none|tee|cross (size). TEMPLATES {rocket, plane, teardrop, car}. buildFromBuilder(builder) -> parts.
- library.LIBRARY = [{id, group, name, note, build() -> parts}] (section 6).
- flow.createFlow() -> {setModel(model, aeroDef) -> Promise (bake, never blocks UI), update(res, alphaDeg, Uvis, dt), sample(x,y,z,out) (world, visual m/s), sdf(x,y,z) (world), phase() (street phase, rad), shock() -> null|{type:'cone'|'bow', apex:[x,y,z], halfAngle, standoff, R}, probe(x,y,z) -> {speed, cp, p, inWake}}
- Mid-plane solver (nhánh nang-cap-dong-chay). flow.plane: live 2D flow on z = 0 from a D2Q9 lattice-Boltzmann solver (src/flow/lbm.js CPU reference, src/flow/lbm-gpu.js WebGL2 half-float; src/flow/plane.js window, regime map, governor). The section of the model at z = 0 is solved as a 2D body (bounce-back from model.sdf at the current alpha); inside the window flow.sample() returns the solver field for |z| small (all z for spanning models) and blends into the analytic 3D field off the plane and at the window edges. At M > 1 the solver is off: the plane shows the potential field with the Rankine-Hugoniot jump at flow.shock().
  - flow.visScale() -> k <= 1: visual time scale of the solver (step budget, governor). main.js multiplies U_vis by k, so results.Uvis and results.slow already include it (amends section 3).
  - flow.plane: {attachGpu(factory, tier), setTier(tier), setView({lines, density}), stats() -> {backend:'gpu'|'cpu', tier, level 0..3, nx, ny, dnx, dny, h, cellsAcross, stepsPerFrame, stepsPerSec, visScale, reSolver, tau, slip, emaDt, lbmOn}, window() -> {x0, y0, x1, y1, h, nx, ny}, backend() (dyeTexture() | dyeData(), dyeSize()), resetDye(), setGovernor(bool)}.
  - aero.evaluate adds: stagPa (p0 - p_inf, Pa, > 0), dragCrisis (bool, inside the crisis band of sphere / cylinder), postCritical (bool), stalled (bool), turb (0..1 turbulent boundary-layer weight). St, fShed, Dshed are now also set for stalled wings (St 0.2) and inclined plates, with Dshed = height projected across the stream. aeroDef.section: '0012' | '2412' selects tabulated section data (src/physics/sections.js: naca0012(alphaDeg, Re), naca2412(alphaDeg, Re) -> {cl, cd, stallDeg}).
  - surface.surfaceFields adds stagPa (q * Cp0, > 0), windwardN (pressure force on the windward faces, N), windwardMeanPa (area mean of the gauge pressure there, may be negative). frontPa / frontN remain as aliases of stagPa / windwardN. results.surface carries all five.
  - flow.probe() adds speedTrue (real m/s); speed is in visual m/s (config.PROBE_SPEED_IS_VISUAL).
- surface.surfaceFields(flow, model, res, air, alphaDeg) -> {cp, tau (Float32Array per vertex), frontPa, frontN, cpRange:[min, max]}
- scene: {three, renderer, scene, camera, root, setCamera(preset), thumbnail(model, px) -> Promise<dataURL>, raycastMidplane(clientX, clientY) -> [x,y,z]|null, onFrame(fn)}
- modelview: setModel(model) (animated swap), applyHeatmap(mode, fields), setForces(res)
- sfx: play('tap'|'toggle'|'tick'|'swap'), setWind(U)
- ctx passed to every init(ctx): {state, scene, flow, aero, atmo, aerodata, library, catalog, assemble, sfx, getModel(), evaluateSnapshot(snapshot, U, air) -> aero result, curveFor(snapshot, air, Umax, n)}. Render modules also have update(dt).
- DOM mounts created by the shell: #title #modeTabs #modelPanel #dock #viewPanel #envPanel #readouts #charts #hud #legend #guide.

## 6. Library ids
- rocket: rocket_water (Tên lửa nước), rocket_sounding (Tên lửa thám không), rocket_launcher (Tên lửa đẩy hai tầng), capsule (Khoang tàu vũ trụ)
- plane: plane_airliner (Máy bay chở khách), plane_fighter (Tiêm kích cánh tam giác), plane_glider (Tàu lượn), plane_prop (Máy bay cánh quạt)
- heli: heli (Trực thăng)
- wing (2D sections, spanning, chord 0.5 m): wing_0012 (Cánh đối xứng NACA 0012), wing_2412 (Cánh khum NACA 2412), wing_wedge (Cánh mỏng siêu âm)
- race: race_f1 (Xe đua bánh hở), race_proto (Xe đua thể thao)
- car: car_sedan (Xe con sedan), car_suv (Xe SUV)
- truck: truck_box (Xe tải thùng), truck_fairing (Xe tải có ốp gió)
- shape: sphere (Hình cầu, D 0.30), cylinder (Hình trụ, D 0.12, spanning), plate (Tấm phẳng 0.40×0.40×0.012, face-on at alpha 0), rhombus (Khối thoi hai nón, D 0.30, L 0.52), teardrop (Giọt nước, D 0.30, L 1.05)

## 7. Physics rules
- F_cản = ½ρU²·C_D·A and F_nâng = ½ρU²·C_L·A (A labelled: chính diện or diện tích cánh). Drag along the freestream, lift perpendicular to it.
- Lift is not Archimedes buoyancy; buoyancy rho_air·g·V is shown separately.
- Lift comes from the pressure difference (faster flow, lower pressure over the upper surface) together with downwash; never the "equal transit time" story.
- Air: ideal gas p = rho·R·T (R 287.05, gamma 1.4); ISA 0-20 km; Sutherland viscosity.
- Streamlined: attached flow, thin wake, no regular shedding. Bluff: separation, wide wake, Kármán street f = St·U/D in the Re ranges where it exists; drag crisis for sphere and cylinder.
- M > 0.8 compressibility; M > 1: shock wave, no upstream influence, Mach angle asin(1/M), wave drag.
- Assumptions shown to users (<= 6 lines): mid-plane smoke from a 2D lattice-Boltzmann solver of the model's section at a reduced Reynolds number chosen by regime (off-plane: potential flow + empirical wake); coefficients from published data; scale model in a closed test section, wall and ground effects ignored; supersonic flow is simulated (real supersonic tunnels need a special nozzle).

## 8. Look and performance
- Clean realistic lab look: no cel shading, ink outlines, neon, glow, bloom, gradient fills or gradient backgrounds. Hall #16181B. Model tones: 0 #E9E6DF satin, 1 #B9BEC4, 2 #2B2F35.
- Pressure heatmap (Cp -1.5 .. Cp_max): #1F4E9C, #5AA9D6, #F2EFE8 (Cp 0), #F2B33D, #C62828. Friction: #2B2F35, #8C5A1E, #F2B33D, #FFF1C2. Particle speed |u|/U 0..1.6: #24364F, #2F7F8C, #8CC084, #F4E3A1.
- Smoke: white #EDEBE6, red #D23A2E, blue #2F6FD0, orange #E8862A, multi = 6 muted distinct hues by line. Force arrows: drag #D98E04, lift #1E9E74.
- UI tokens: --red #C8102E (title, primary actions), --paper #F4F1EA, --ink #1B1D21, --muted #5E636B, --line rgba(27,29,33,.14), radius 6px; easing cubic-bezier(.2,.7,.2,1), 160-320 ms. Fonts self-hosted with Vietnamese: Be Vietnam Pro (UI), Barlow Condensed (title, headings), JetBrains Mono (numbers, tabular).
- Shared classes: .panel .seg .chip .btn .btn-primary .icon-btn .slider .kv .readout .tabbar .sheet .popover .badge .tip
- Tiers low/high: particles 3000/12000; smoke <= 24/48 lines × 110/170 points; vector lattice 16×8 / 24×12 per plane; DPR <= 1.5/2; shadows only on high. Targets 60 fps desktop, >= 30 fps mid phone; flow bake <= 400 ms desktop, never blocking input.

## 9. Acceptance
1. Opens by double-click (file://) and on GitHub Pages; no console errors; Chrome, Safari iOS, Zalo in-app.
2. One screen, no page scroll: phone portrait/landscape, tablet, laptop, desktop; no clipped text.
3. Library/builder switch and model swaps animate in <= 400 ms; only one model in the tunnel.
4. Smoke hugs teardrop and wing at small alpha; periodic vortex street behind cylinder, sphere, plate; wing_2412 shows a broad separated wake past ~15°.
5. Doubling U multiplies F_cản by 4 ± 5 % when the regime is unchanged; F proportional to rho; higher altitude gives smaller forces.
6. At 20 m/s, alpha 0: C_D teardrop < sphere < cylinder < plate; truck_fairing < truck_box; car_sedan < car_suv.
7. wing_2412: lift > 0 at alpha 0; L/D peaks near 4-7°; stall after ~15°.
8. Heatmap red at front stagnation, blue where flow is fastest, uniform base pressure in separated regions; friction highest near leading edges.
9. M > 1: shock visible, Mach angle and wave drag shown, flow unchanged upstream of the shock.
10. Time chart live; compare bars recompute pins at current U and air; F(v) curves.
11. Guide <= 5 steps, skippable, reopenable; sound toggle; no emoji.
12. >= 30 fps on a mid phone (tier low).