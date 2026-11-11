// P1 - Số liệu mặt cắt cánh 2D theo bảng, góc tới 0-90 độ (đối xứng lẻ cho góc âm với mặt cắt đối xứng).
// NACA 0012: Sheldahl & Klimas, SAND80-2114 (1981), phụ thuộc Re. Phần >= 30 độ không phụ thuộc Re.
// NACA 2412: Abbott & von Doenhoff, "Theory of Wing Sections" (Re 3,1e6, mặt nhẵn) đến thất tốc,
//   sau đó nối liên tục vào nhánh góc lớn của Sheldahl & Klimas (mọi mặt cắt mỏng tiến về tấm phẳng).
// ĐÃ ĐỐI CHIẾU với bản in (phiên nâng cấp dòng chảy):
//   NACA 0012: Sheldahl & Klimas, SAND80-2114, Table 2 (Re 160000, 700000, 2000000 và phần góc lớn). Số liệu của bảng đó
//   là mô hình Eppler: thất tốc rất gấp (Re 1,6e5: CL tụt từ 0,85 xuống 0,13 giữa 9 và 10 độ; cd ở 10 độ in là 0,0188).
//   NACA 2412: đọc từ đồ thị NACA Report 824 (Abbott, von Doenhoff, Stivers 1945), trang 136, Re 3,1e6 vòng tròn, sai số đọc
//   khoảng +-0,04 cho CL và +-0,001 cho cd; không có bảng số in cho mặt cắt này. CL(0) = 0,22, alpha_L0 = -2 độ, CLmax 1,66 tại 16 độ.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export const HIGH = {   // alpha >= 30 deg (Sheldahl & Klimas, mọi Re)
  a: [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90],
  cl: [0.915, 1.02, 1.075, 1.085, 1.04, 0.965, 0.875, 0.765, 0.65, 0.515, 0.37, 0.22, 0.07],
  cd: [0.57, 0.745, 0.92, 1.075, 1.215, 1.345, 1.47, 1.575, 1.665, 1.735, 1.78, 1.8, 1.8],
};
const A12 = [0, 2, 4, 6, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 25];
export const NACA0012 = {
  a: A12,
  re: [1.6e5, 7e5, 2e6],
  cl: [   // Table 2 của Sheldahl & Klimas, theo Re 1,6e5 / 7e5 / 2e6
    [0, 0.22, 0.44, 0.66, 0.8274, 0.1325, 0.1095, 0.1533, 0.2030, 0.2546, 0.3082, 0.3620, 0.4200, 0.4768, 0.5870, 0.6956, 0.8572],
    [0, 0.22, 0.44, 0.66, 0.88, 1.0343, 1.0749, 1.0390, 0.8737, 0.6284, 0.4907, 0.4696, 0.5175, 0.5584, 0.6474, 0.7446, 0.8984],
    [0, 0.22, 0.44, 0.66, 0.88, 1.0727, 1.1539, 1.2072, 1.2169, 1.1614, 1.0478, 0.9221, 0.7826, 0.7163, 0.7269, 0.7981, 0.9352],
  ],
  cd: [
    [0.0103, 0.0108, 0.0124, 0.0152, 0.0185, 0.0188, 0.0760, 0.1340, 0.1520, 0.1710, 0.1900, 0.2100, 0.2310, 0.2520, 0.2970, 0.3440, 0.4200],
    [0.0067, 0.0070, 0.0083, 0.0108, 0.0128, 0.0159, 0.0175, 0.0195, 0.0216, 0.0236, 0.1170, 0.2100, 0.2300, 0.2520, 0.2970, 0.3440, 0.4200],
    [0.0064, 0.0066, 0.0073, 0.0090, 0.0105, 0.0128, 0.0140, 0.0155, 0.0172, 0.0191, 0.0213, 0.0237, 0.1380, 0.2520, 0.2970, 0.3440, 0.4200],
  ],
};
export const NACA2412 = {   // Re 3,1e6; >= 18 độ là phần nối sau thất tốc
  reRef: 3.1e6,
  a: [-8, -4, 0, 4, 8, 12, 14, 16, 18, 20, 25],
  cl: [-0.62, -0.21, 0.22, 0.62, 1.02, 1.37, 1.52, 1.64, 1.38, 1.15, 0.95],
  cd: [0.0085, 0.0063, 0.0061, 0.0071, 0.0104, 0.0150, 0.0215, 0.032, 0.09, 0.17, 0.33],
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
  out.stallDeg = 9 + 2 * (k + t);                           // góc CL cực đại theo bảng: 9 / 11 / 13 độ (Re 1,6e5 / 7e5 / 2e6)
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
