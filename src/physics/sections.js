// P1 - Số liệu mặt cắt cánh 2D theo bảng, góc tới 0-90 độ (đối xứng lẻ cho góc âm với mặt cắt đối xứng).
// NACA 0012: Sheldahl & Klimas, SAND80-2114 (1981), phụ thuộc Re. Phần >= 30 độ không phụ thuộc Re.
// NACA 2412: Abbott & von Doenhoff, "Theory of Wing Sections" (Re 3,1e6, mặt nhẵn) đến thất tốc,
//   sau đó nối liên tục vào nhánh góc lớn của Sheldahl & Klimas (mọi mặt cắt mỏng tiến về tấm phẳng).
// LƯU Ý: các điểm bảng được nhập lại từ tài liệu, cần đối chiếu bản in trước khi dùng cho mục đích ngoài giảng dạy.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export const HIGH = {   // alpha >= 30 deg (Sheldahl & Klimas, mọi Re)
  a: [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90],
  cl: [0.855, 0.98, 1.035, 1.05, 1.02, 0.955, 0.875, 0.76, 0.63, 0.5, 0.365, 0.23, 0.09],
  cd: [0.57, 0.745, 0.92, 1.075, 1.215, 1.345, 1.47, 1.575, 1.665, 1.735, 1.78, 1.8, 1.8],
};
const A12 = [0, 2, 4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 25];
export const NACA0012 = {
  a: A12,
  re: [1.6e5, 7e5, 2e6],
  cl: [
    [0, 0.22, 0.44, 0.66, 0.80, 0.87, 0.86, 0.80, 0.70, 0.60, 0.52, 0.48, 0.47, 0.48, 0.52, 0.58, 0.67],
    [0, 0.22, 0.44, 0.66, 0.85, 0.98, 1.02, 1.04, 1.03, 0.98, 0.88, 0.75, 0.65, 0.60, 0.60, 0.64, 0.72],
    [0, 0.22, 0.44, 0.66, 0.87, 1.06, 1.13, 1.19, 1.22, 1.23, 1.20, 1.10, 0.95, 0.80, 0.66, 0.66, 0.73],
  ],
  cd: [
    [0.0103, 0.0108, 0.0124, 0.0152, 0.0198, 0.028, 0.045, 0.085, 0.13, 0.16, 0.185, 0.205, 0.225, 0.245, 0.285, 0.33, 0.405],
    [0.0070, 0.0073, 0.0081, 0.0095, 0.0119, 0.0155, 0.018, 0.0215, 0.027, 0.045, 0.08, 0.13, 0.17, 0.20, 0.26, 0.31, 0.40],
    [0.0064, 0.0066, 0.0073, 0.0085, 0.0101, 0.0125, 0.014, 0.0158, 0.0185, 0.0225, 0.031, 0.055, 0.10, 0.16, 0.25, 0.31, 0.40],
  ],
};
export const NACA2412 = {   // Re 3,1e6; >= 18 độ là phần nối sau thất tốc
  reRef: 3.1e6,
  a: [-8, -4, 0, 4, 8, 12, 14, 16, 18, 20, 25],
  cl: [-0.62, -0.21, 0.22, 0.65, 1.07, 1.44, 1.56, 1.60, 1.42, 1.18, 0.95],
  cd: [0.0105, 0.0080, 0.0065, 0.0072, 0.0120, 0.0175, 0.0215, 0.032, 0.09, 0.17, 0.33],
};

function lin(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  const n = xs.length;
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 1; while (xs[i] < x) i++;
  return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
}
function highAt(a, out) { out.cl = lin(HIGH.a, HIGH.cl, a); out.cd = lin(HIGH.a, HIGH.cd, a); }
const tmp = { cl: 0, cd: 0 };

// -> {cl, cd, stallDeg} cho góc tới alphaDeg (độ) và số Reynolds theo dây cung. out được dùng lại nếu truyền vào.
export function naca0012(alphaDeg, Re, out) {
  out = out || { cl: 0, cd: 0, stallDeg: 12 };
  const sg = alphaDeg < 0 ? -1 : 1, a = Math.min(Math.abs(alphaDeg), 90), T = NACA0012;
  const lr = Math.log(clamp(Re, T.re[0], T.re[2]));
  let k = lr <= Math.log(T.re[1]) ? 0 : 1;
  const t = (lr - Math.log(T.re[k])) / (Math.log(T.re[k + 1]) - Math.log(T.re[k]));
  out.stallDeg = 10.5 + 1.5 * k + (k ? 2 : 1.5) * t;        // góc CL cực đại: 10,5 / 12 / 14 độ
  if (a >= 30) highAt(a, out);
  else {
    const g = (arr) => {
      if (a <= 25) return lin(T.a, arr[k], a) * (1 - t) + lin(T.a, arr[k + 1], a) * t;
      const e = arr[k][16] * (1 - t) + arr[k + 1][16] * t, h = arr === T.cl ? HIGH.cl[0] : HIGH.cd[0];
      return e + (h - e) * (a - 25) / 5;
    };
    out.cl = g(T.cl); out.cd = g(T.cd);
  }
  out.cl *= sg;
  return out;
}
export function naca2412(alphaDeg, Re, out) {
  out = out || { cl: 0, cd: 0, stallDeg: 16 };
  const T = NACA2412; out.stallDeg = 16;
  if (alphaDeg < -8) {                                     // góc âm lớn: như mặt cắt đối xứng lệch 2,1 độ
    naca0012(alphaDeg + 2.1, Re, out); out.stallDeg = 16; return out;
  }
  const a = Math.min(alphaDeg, 90);
  if (a >= 30) { highAt(a, out); out.cl += 0.045 * (90 - a) / 60; return out; }
  let cl, cd;
  if (a <= 25) { cl = lin(T.a, T.cl, a); cd = lin(T.a, T.cd, a); }
  else { highAt(30, tmp); cl = T.cl[10] + (tmp.cl + 0.045 - T.cl[10]) * (a - 25) / 5; cd = T.cd[10] + (tmp.cd - T.cd[10]) * (a - 25) / 5; }
  // Re thấp hơn số liệu gốc: CL cực đại giảm khoảng 12 % mỗi bậc 10 của Re, cản ma sát tăng theo Re^-0,15
  const lg = Math.log10(clamp(T.reRef / Math.max(Re, 1), 1, 100));
  const s = 1 - 0.12 * lg;
  cl *= 1 - (1 - s) * sstep((a - 6) / 8) * (1 - sstep((a - 20) / 10));
  cd *= 1 + (Math.pow(10, 0.15 * lg) - 1) * (1 - sstep((a - 12) / 6));
  out.cl = cl; out.cd = cd;
  return out;
}
export const SECTIONS = { '0012': naca0012, '2412': naca2412 };
