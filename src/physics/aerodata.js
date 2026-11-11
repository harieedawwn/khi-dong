// P1 - Dữ liệu khí động cho từng mô hình thư viện + ánh xạ bộ dựng.
// Ghi chú: lifting[].partId hỗ trợ '*' (mọi cánh), 'tiền_tố*' hoặc id đúng; mục khớp đầu tiên được dùng.
const BLUNT_MACH = { mdd: 0.55, kpeak: 2.0, kinf: 1.8 };
const EDGE = (cpb) => ({ mode: 'edge', lamDeg: 90, turbDeg: 90, reCrit: 1e5, cpbLam: cpb, cpbTurb: cpb });
const ANG = (lam, turb, cpbL, cpbT, rc = 3e5) => ({ mode: 'angle', lamDeg: lam, turbDeg: turb, reCrit: rc, cpbLam: cpbL, cpbTurb: cpbT });

function mk(o) {
  return Object.assign({
    kind: 'buildup', Lref: 'L', Aref: 'frontal', sep: ANG(105, 160, -0.1, -0.1), st: 0, wakeMinRe: 1e4, clAmp: 0,
    mach: { mdd: 0.85, kpeak: 1.8, kinf: 1.3 }, nose: 'round', noseHalfDeg: 15, lifting: [], source: ''
  }, o);
}
const fins = (share = 0.5) => ({ partId: 'fin*', a0: 6.0, alpha0Deg: 0, tc: 0.04, e: 0.7, sharpLE: false, share });
const wingEntry = (alpha0Deg, e, tc = 0.12, sharpLE = false) => ({ partId: '*', a0: 6.0, alpha0Deg, tc, e, sharpLE });

export const AERO = {
  /* tên lửa */
  rocket_water: mk({ cdRef: 0.45, reRef: 1e6, nose: 'round', lifting: [fins()], mach: { mdd: 0.85, kpeak: 2.0, kinf: 1.4 },
    source: 'CD tham chiếu 0.45 (diện tích chính diện) cho tên lửa nước đuôi cụt; ma sát, đuôi và cánh ổn định tính theo Hoerner.' }),
  rocket_sounding: mk({ cdRef: 0.32, reRef: 1e6, nose: 'round', lifting: [fins()], mach: { mdd: 0.85, kpeak: 2.3, kinf: 1.35 },
    source: 'CD 0.32 ở M thấp; đỉnh sóng xung kích quanh M 1.05 (hệ số 2.3), suy giảm về 1.35 khi M 3 (số liệu tên lửa thám không điển hình).' }),
  rocket_launcher: mk({ cdRef: 0.38, reRef: 1e6, nose: 'sharp', noseHalfDeg: 12, lifting: [fins()], mach: { mdd: 0.85, kpeak: 2.2, kinf: 1.4 },
    source: 'CD 0.38 cho tên lửa đẩy hai tầng có cánh đuôi; đường cong Mach theo số liệu tên lửa phóng điển hình.' }),
  capsule: mk({ cdRef: 1.2, reRef: 1e6, nose: 'blunt', sep: EDGE(-0.3), st: 0.2, wakeMinRe: 1e3, clAmp: 0.1, mach: BLUNT_MACH,
    source: 'CD 1.2 cho khoang tàu mũi cùn (Apollo/Soyuz ở góc tới 0 hướng mũi cùn đi trước, dải số liệu 1.0-1.7).' }),
  /* máy bay: diện tích tham chiếu là diện tích cánh */
  plane_airliner: mk({ Lref: 'chord', Aref: 'planform', cdRef: 0.022, reRef: 3e5, lifting: [wingEntry(-1.0, 0.85)], mach: { mdd: 0.8, kpeak: 2.0, kinf: 1.2 },
    source: 'CD0 0.022 theo diện tích cánh; lực nâng Helmbold, cản cảm ứng 1/(pi e AR), e 0.85 (Raymer, Anderson).' }),
  plane_fighter: mk({ Lref: 'chord', Aref: 'planform', cdRef: 0.018, reRef: 3e5, lifting: [wingEntry(0, 0.7, 0.05)], mach: { mdd: 0.9, kpeak: 2.2, kinf: 1.2 },
    source: 'CD0 0.018 theo diện tích cánh, cánh tam giác mỏng, mdd 0.9; lực nâng Helmbold (AR thấp), e 0.7.' }),
  plane_glider: mk({ Lref: 'chord', Aref: 'planform', cdRef: 0.012, reRef: 3e5, lifting: [wingEntry(-2.0, 0.95)], mach: { mdd: 0.7, kpeak: 2.0, kinf: 1.4 },
    source: 'CD0 0.012 theo diện tích cánh, cánh khum AR lớn, e 0.95 (tàu lượn hiệu suất cao).' }),
  plane_prop: mk({ Lref: 'chord', Aref: 'planform', cdRef: 0.03, reRef: 3e5, lifting: [wingEntry(-1.0, 0.8)], mach: { mdd: 0.65, kpeak: 2.0, kinf: 1.4 },
    source: 'CD0 0.03 theo diện tích cánh (máy bay cánh quạt nhỏ, càng cố định), e 0.8.' }),
  heli: mk({ cdRef: 0.45, reRef: 1e6, sep: ANG(100, 110, -0.25, -0.2), mach: { mdd: 0.6, kpeak: 2.0, kinf: 1.8 },
    source: 'CD 0.45 theo diện tích chính diện cho thân trực thăng (số liệu thân + cánh quạt đứng yên).' }),
  /* cánh 2D (spanning) */
  wing_0012: mk({ section: '0012', Lref: 'chord', Aref: 'planform', sep: ANG(160, 170, -0.1, -0.1, 5e5), lifting: [wingEntry(0, 1, 0.12)], mach: { mdd: 0.75, kpeak: 1.8, kinf: 1.0 },
    source: 'NACA 0012: bảng CL, CD 0-90 độ theo Re của Sheldahl & Klimas (SAND80-2114).' }),
  wing_2412: mk({ section: '2412', Lref: 'chord', Aref: 'planform', sep: ANG(160, 170, -0.1, -0.1, 5e5), lifting: [wingEntry(-2.1, 1, 0.12)], mach: { mdd: 0.75, kpeak: 1.8, kinf: 1.0 },
    source: 'NACA 2412: bảng Abbott & von Doenhoff (Re 3,1e6) đến thất tốc ~16 độ, nối sau thất tốc theo Sheldahl & Klimas.' }),
  wing_wedge: mk({ Lref: 'chord', Aref: 'planform', sep: ANG(160, 170, -0.1, -0.1, 5e5), nose: 'sharp', lifting: [wingEntry(0, 1, 0.05, true)], mach: { mdd: 0.9, kpeak: 1, kinf: 1 },
    source: 'Cánh nêm mỏng t/c 0.05 mép nhọn; siêu âm theo lý thuyết Ackeret (CL = 4 alpha / sqrt(M^2-1)).' }),
  /* xe đua */
  race_f1: mk({ cdRef: 0.9, reRef: 1.5e6, clRef: -3.0, sep: ANG(115, 125, -0.25, -0.2), mach: { mdd: 0.6, kpeak: 2.0, kinf: 1.8 },
    source: 'CD 0.9, CL -3.0 theo diện tích chính diện (xe đua bánh hở, Katz); lực ép thay đổi 0.04 mỗi độ.' }),
  race_proto: mk({ cdRef: 0.45, reRef: 1.5e6, clRef: -1.5, sep: ANG(115, 125, -0.25, -0.2), mach: { mdd: 0.6, kpeak: 2.0, kinf: 1.8 },
    source: 'CD 0.45, CL -1.5 theo diện tích chính diện (xe thể thao kiểu nguyên mẫu, Katz).' }),
  /* ô tô */
  car_sedan: mk({ cdRef: 0.29, reRef: 1.5e6, sep: ANG(115, 125, -0.25, -0.2), mach: { mdd: 0.6, kpeak: 2.0, kinf: 1.8 },
    source: 'CD 0.29 theo diện tích chính diện (sedan hiện đại, Hucho).' }),
  car_suv: mk({ cdRef: 0.38, reRef: 1.5e6, sep: ANG(115, 125, -0.25, -0.2), mach: { mdd: 0.6, kpeak: 2.0, kinf: 1.8 },
    source: 'CD 0.38 theo diện tích chính diện (SUV, Hucho).' }),
  /* xe tải */
  truck_box: mk({ cdRef: 0.75, reRef: 1.5e6, nose: 'blunt', sep: EDGE(-0.25), st: 0.12, wakeMinRe: 1e4, clAmp: 0.1, mach: BLUNT_MACH,
    source: 'CD 0.75 theo diện tích chính diện (xe tải thùng vuông, Hucho).' }),
  truck_fairing: mk({ cdRef: 0.6, reRef: 1.5e6, nose: 'round', sep: EDGE(-0.25), st: 0.1, wakeMinRe: 1e4, clAmp: 0.05, mach: BLUNT_MACH,
    source: 'CD 0.60 theo diện tích chính diện (xe tải có ốp gió giảm cản, Hucho).' }),
  /* hình khối cơ bản */
  sphere: mk({ kind: 'sphere', Lref: 'D', sep: ANG(82, 120, -0.4, -0.15, 3e5), st: 0.18, wakeMinRe: 280, clAmp: 0.06, mach: BLUNT_MACH,
    source: 'Hình cầu: tương quan Morrison (2013), phủ cả khủng hoảng lực cản; St 0.18.' }),
  cylinder: mk({ kind: 'cylinder', Lref: 'D', sep: ANG(80, 115, -1.2, -0.3, 3.5e5), st: 0.2, wakeMinRe: 47, clAmp: 0.5, clAmpSuper: 0.1, mach: BLUNT_MACH,
    source: 'Trụ 2D cắt dòng: bảng CD(Re) theo Schlichting/Roshko; St Roshko (1954).' }),
  plate: mk({ kind: 'plate', sep: EDGE(-0.45), st: 0.15, wakeMinRe: 100, clAmp: 0.25, mach: BLUNT_MACH,
    source: 'Tấm vuông AR 1: CN(góc) theo số liệu Hoerner; CD mặt chính diện 1.17.' }),
  rhombus: mk({ cdRef: 0.5, reRef: 7e5, nose: 'sharp', noseHalfDeg: 30, sep: EDGE(-0.35), st: 0.2, wakeMinRe: 1e3, clAmp: 0.1, mach: BLUNT_MACH,
    source: 'Khối thoi hai nón: CD 0.5 là ước lượng (không có số liệu công bố trực tiếp).' }),
  teardrop: mk({ cdRef: 0.05, reRef: 1e6, nose: 'round', sep: ANG(105, 160, -0.1, -0.1, 3e5), st: 0, mach: { mdd: 0.8, kpeak: 1.8, kinf: 1.2 },
    source: 'Giọt nước thon: CD ~0.05 tại Re 1e6 theo diện tích chính diện (Hoerner, hình dạng L/D 3.5).' })
};

/* ---------- bộ dựng ---------- */
const num = (x, d) => (Number.isFinite(x) ? x : d);
export function builderAero(builder, info) {
  builder = builder || {};
  const p = builder.p || {};
  info = info || {};
  const b = info.body || {};
  const D = num(p.diameter, num(b.D, 0.1));
  const noseLen = Math.max(num(p.noseLen, 0.3 * num(b.L, 1)), 1e-3);
  const half = Math.max(5, Math.min(90, Math.atan((D / 2) / noseLen) * 180 / Math.PI));
  const nose = builder.nose === 'cone' ? 'sharp' : builder.nose === 'flat' ? 'blunt' : 'round';
  const box = builder.body === 'box';
  const hasWing = builder.wing && builder.wing !== 'none';
  const lifting = [];
  if (builder.fins && builder.fins !== 'none') lifting.push(fins(builder.fins === 'cross' ? 0.5 : 0.67));
  if (hasWing) {
    const prof = p.profile || '0012';
    const e = builder.wing === 'delta' ? 0.7 : builder.wing === 'swept' ? 0.8 : 0.9;
    lifting.push(wingEntry(prof === '2412' ? -2.1 : 0, e, prof === 'plate' ? 0.02 : 0.12, prof === 'plate'));
  }
  const sep = box ? EDGE(-0.25) : ANG(105, 160, -0.1, -0.1, 3e5);
  return mk({
    Lref: hasWing ? 'chord' : 'L', Aref: hasWing ? 'planform' : 'frontal', sep, nose, noseHalfDeg: half,
    boattailDeg: builder.tail === 'blunt' ? 0 : num(p.boattailDeg, 0),
    st: box ? 0.2 : 0, wakeMinRe: 1e3, clAmp: box ? 0.1 : 0,
    mach: box ? { mdd: 0.6, kpeak: 2.2, kinf: 1.8 } : { mdd: 0.85, kpeak: 2.0, kinf: 1.5 },
    lifting, source: 'Mô hình ghép: ma sát + hệ số hình dạng, áp suất mũi/đáy (Hoerner), cánh Helmbold + cản cảm ứng, thân thon Allen.'
  });
}
