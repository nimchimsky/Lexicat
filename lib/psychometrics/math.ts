// Funcions matemàtiques bàsiques, sense dependències.
// La precisió de probit/normCdf està assegurada per tests contra valors coneguts.

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function logistic(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

const LN_SQRT_PI = 0.5 * Math.log(Math.PI);
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

/** Sèrie de Taylor de erf(x), x ≥ 0, |x| petit-mig. */
function erfSeries(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 200; n++) {
    term *= (-x2) / n;
    const add = term / (2 * n + 1);
    sum += add;
    if (Math.abs(add) <= 1e-17 * Math.abs(sum)) break;
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}

/** Q(1/2, y) per fracció contínua (Numerical Recipes gcf), y ≥ ~1.5. */
function qHalfContinuedFraction(y: number): number {
  const FPMIN = 1e-300;
  let b = y + 1 - 0.5;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 1000; i++) {
    const an = -i * (i - 0.5);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-y + 0.5 * Math.log(y) - LN_SQRT_PI) * h;
}

/** Sèrie per a P(1/2, y) (Numerical Recipes gser), y petita-mig. */
function pHalfSeries(y: number): number {
  let ap = 0.5;
  let sum = 1 / 0.5;
  let del = sum;
  for (let n = 1; n <= 2000; n++) {
    ap += 1;
    del *= y / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-18) break;
  }
  return sum * Math.exp(-y + 0.5 * Math.log(y) - LN_SQRT_PI);
}

/**
 * erfc(x) amb precisió doble a tota la recta real.
 * erf(x) = P(1/2, x²)  ⟺  erfc(x) = Q(1/2, x²) per x ≥ 0.
 * La sèrie és estable fins a y = x² ≈ 6 (cancel·lació irrellevant); la
 * fracció contínua només convergeix ràpid a partir d'allà. El punt de tall
 * CLÀSSIC de NR (a+1) deixa la zona x ∈ [1, 2] en mal estat i cal evitar-lo.
 */
export function erfc(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`erfc fora de domini: ${x}`);
  const ax = Math.abs(x);
  const y = ax * ax;
  const v = y < 6 ? 1 - pHalfSeries(y) : qHalfContinuedFraction(y);
  return x >= 0 ? v : 2 - v;
}

/** Φ(x), CDF de la normal estàndard. */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

/** PDF de la normal estàndard. */
export function normPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp((-x * x) / 2);
}

/**
 * Quantil de la normal estàndard: probit(p), 0 < p < 1.
 * Aproximació d'Acklam + refinament de Newton fins a precisió màquina.
 */
export function probit(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`probit fora de domini: ${p}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;

  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  // Refinament: dues passes de Newton-Halley arriben a precisió màquina.
  for (let i = 0; i < 3; i++) {
    const err = normCdf(x) - p;
    const u = err / normPdf(x);
    x -= u / (1 + (x * u) / 2);
    if (Math.abs(u) < 1e-15) break;
  }
  return x;
}

