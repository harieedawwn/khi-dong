// P1 - Khí quyển: ISA 0-20 km hoặc chế độ tuỳ chỉnh (T, p). Hàm thuần, SI.
export const R_AIR = 287.05;
export const GAMMA = 1.4;
export const G0 = 9.80665;
const T_SL = 288.15, P_SL = 101325, LAPSE = 0.0065, H_TROP = 11000;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function isa(h) {
  h = clamp(Number.isFinite(h) ? h : 0, 0, 20000);
  const expo = G0 / (LAPSE * R_AIR);
  if (h <= H_TROP) {
    const T = T_SL - LAPSE * h;
    return { T, p: P_SL * Math.pow(T / T_SL, expo) };
  }
  const T = T_SL - LAPSE * H_TROP;
  const p11 = P_SL * Math.pow(T / T_SL, expo);
  return { T, p: p11 * Math.exp(-G0 * (h - H_TROP) / (R_AIR * T)) };
}

export function air(env) {
  env = env || {};
  let T, p;
  if (env.mode === 'custom') {
    T = clamp(Number.isFinite(+env.T) ? +env.T : T_SL, 150, 600);
    p = clamp(Number.isFinite(+env.p) ? +env.p : P_SL, 100, 5e6);
  } else ({ T, p } = isa(+env.h));
  const rho = p / (R_AIR * T);
  const mu = 1.458e-6 * Math.pow(T, 1.5) / (T + 110.4);
  return { T, p, rho, mu, nu: mu / rho, a: Math.sqrt(GAMMA * R_AIR * T) };
}
