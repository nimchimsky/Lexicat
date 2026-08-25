// Model de resposta graduada (Samejima, adaptat) — el pas següent del
// estimador binari (REVISIO_MODE_POMPEU.md §3.1 i §3.3).
//
// Idea: la confiança declarada NO es binaritza al 50%. Es recodifica en
// direcció de CORRECCIÓ (per a una pseudoparaula, la confiança de rebutjar)
// i es tracta com una categoria ordinal d'una escala de C nivells.
// S'estimen conjuntament:
//   · θ — l'habilitat lèxica, i
//   · c — l'ús de l'escala de la persona (el llindar que separa «sí» de
//     «no», propi de cada jugador: és precisament el que fa que la
//     confiança sigui informativa).
//
//   P(categoria ≥ k | ítem i, persona j) = f( a_i·(θ − b_i) − c − τ_k )
//
// amb τ_k = logit(k/C) fixos i equiespaiats en espai logit. El prior de θ
// és el mateix del MAP binari (N(0, PRIOR_SD²)); el de c és N(0, σ_c²),
// feble, per identificar l'escala quan algú respon tot a la mateixa
// categoria.
//
// Mòdul PUR: sense DB ni React. Validació numèrica a tests/graded.test.ts
// i a scripts/simulate.ts. Activar-lo exigeix bumpar VERSIONS.calibration.

import { PRIOR_MEAN, PRIOR_SD } from "../config";
import type { AbilityEstimate, GraduatedResponse, ItemParams } from "./types";

/** Categories de la graella comuna: la confiança DIRECCIONAL (cap a la
 *  resposta correcta) s'assigna a un enter 0..GRID_CATEGORIES−1. Una graella
 *  única normalitza escales diferents (7 passos, 21 antics, botons) dins la
 *  mateixa finestra d'estimació. */
export const GRID_CATEGORIES = 11;

/** Dispersió del prior del criteri de persona. */
export const CRITERION_PRIOR_SD = 1.0;

const SIGMA_C = CRITERION_PRIOR_SD;
const NEWTON_ITERS = 60;
const EPS = 1e-12;

function logistic(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function logit(p: number): number {
  return Math.log(p / (1 - p));
}

/** Llindars fixos τ_1..τ_{C−1} en espai logit. */
const THRESHOLDS: number[] = Array.from(
  { length: GRID_CATEGORIES - 1 },
  (_, k) => logit((k + 1) / GRID_CATEGORIES)
);

/** Confiança en DIRECCIÓ de resposta correcta: per a paraules és la crua;
 *  per a pseudoparaules, el complementari (confiar que NO és paraula). */
function directionalConfidence(response: GraduatedResponse): number {
  return response.isWord ? response.confidence : 1 - response.confidence;
}

export function confidenceToCategory(confidence: number): number {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new RangeError(`confiança fora de [0,1]: ${confidence}`);
  }
  const g = Math.floor(confidence * GRID_CATEGORIES);
  return Math.min(Math.max(g, 0), GRID_CATEGORIES - 1);
}

interface GradedLogPosterior {
  value(theta: number, c: number): number;
  grad(theta: number, c: number): { dt: number; dc: number };
  hessian(theta: number, c: number): { tt: number; tc: number; cc: number };
}

/**
 * Log-posterior conjunta de (θ, c). La versemblança d'una categoria g:
 *   P(g) = F(τ_{g+1}) − F(τ_g), amb F(k) = P(cat < k) = f(τ_k − η)
 * i η = a·(θ − b) − c. (F(τ_0)=0, F(τ_C)=1.)
 */
function buildGradedLogPosterior(
  responses: GraduatedResponse[],
  itemsById: Map<number, ItemParams>
): GradedLogPosterior {
  const items = responses.map((r) => {
    const it = itemsById.get(r.itemId);
    if (!it) throw new Error(`Ítem ${r.itemId} sense paràmetres`);
    return it;
  });

  // Per cada resposta: límits inferior/superior en η (monòtons creixents amb
  // la categoria DIRECCIONAL: com més alta, més a prop de la resposta correcta).
  const lo = responses.map((r) => {
    const g = confidenceToCategory(directionalConfidence(r));
    return g === 0 ? -Infinity : THRESHOLDS[g - 1];
  });
  const hi = responses.map((r) => {
    const g = confidenceToCategory(directionalConfidence(r));
    return g === GRID_CATEGORIES - 1 ? Infinity : THRESHOLDS[g];
  });

  const priorTheta = (theta: number) => -((theta - PRIOR_MEAN) ** 2) / (2 * PRIOR_SD ** 2);
  const priorC = (c: number) => -(c * c) / (2 * SIGMA_C * SIGMA_C);

  function terms(theta: number, c: number) {
    // Retorna per resposta: logP i derivades respecte d'η.
    const out: Array<{ logp: number; dlogp: number; d2logp: number }> = [];
    for (let k = 0; k < responses.length; k++) {
      const it = items[k];
      const eta = it.a * (theta - it.b) - c;
      const hiInf = hi[k] === Infinity;
      const loNeg = lo[k] === -Infinity;
      // Cues logístiques amb escala LIKELIHOOD_SCALE: P(η ≥ lo) = f((η−lo)/s).
      const pUpper = hiInf ? 1 : 1 - scaledLogistic(lo[k] - eta);
      const pLower = loNeg ? 0 : 1 - scaledLogistic(hi[k] - eta);
      let p = pUpper - pLower;
      if (p < EPS) p = EPS;
      const logp = Math.log(p);

      // Derivades respecte d'η via les dues cues (regla de la cadena amb s).
      const densLo = loNeg ? 0 : scaledDensity(eta - lo[k]);
      const densHi = hiInf ? 0 : scaledDensity(eta - hi[k]);
      const dp = densLo - densHi; // d/dη
      const d2p =
        (loNeg ? 0 : scaledDensityPrime(eta - lo[k])) -
        (hiInf ? 0 : scaledDensityPrime(eta - hi[k]));

      out.push({
        logp,
        dlogp: dp / p,
        d2logp: d2p / p - (dp * dp) / (p * p),
      });
    }
    return out;
  }

  return {
    value(theta, c) {
      let s = priorTheta(theta) + priorC(c);
      for (const t of terms(theta, c)) s += t.logp;
      return s;
    },
    grad(theta, c) {
      let dt = -(theta - PRIOR_MEAN) / (PRIOR_SD ** 2);
      let dc = -c / (SIGMA_C * SIGMA_C);
      const ts = terms(theta, c);
      for (let k = 0; k < responses.length; k++) {
        const it = items[k];
        // ∂η/∂θ = a ; ∂η/∂c = −1
        dt += ts[k].dlogp * it.a;
        dc += ts[k].dlogp * -1;
      }
      return { dt, dc };
    },
    hessian(theta, c) {
      let tt = -1 / (PRIOR_SD ** 2);
      let cc = -1 / (SIGMA_C ** 2);
      let tc = 0;
      const ts = terms(theta, c);
      for (let k = 0; k < responses.length; k++) {
        const it = items[k];
        const t = ts[k];
        tt += t.d2logp * it.a * it.a;
        tc += t.d2logp * it.a * -1;
        cc += t.d2logp * 1;
      }
      return { tt, tc, cc };
    },
  };
}

/**
 * Escala del soroll de la categoria. La calibració b del banc ve de la
 * decisió binària (creuament del 50%): perquè el model graduat extregui de
 * la categoria una informació comparable a la binària, el soroll assumit de
 * la categoria no pot ser l'unitari — un valor gran dilueix la versemblança
 * i el prior domina (θ atenuat). 0,35 reprodueix la informació efectiva del
 * binari validat; si es recalibra amb població pròpia, revisar-ho.
 */
export const LIKELIHOOD_SCALE = 0.35;

const S = LIKELIHOOD_SCALE;

function scaledLogistic(x: number): number {
  return logistic(x / S);
}
/** Densitat logística amb escala S, ja dividida per S (densitat real). */
function scaledDensity(x: number): number {
  const e = Math.exp(-Math.abs(x / S));
  return e / (S * (1 + e) ** 2);
}
/** Derivada de scaledDensity respecte d'x. */
function scaledDensityPrime(x: number): number {
  const z = x / S;
  const e = Math.exp(-Math.abs(z));
  const f = e / (1 + e) ** 2; // densitat estàndard
  return (f * (1 - 2 * f)) / (S * S);
}

export interface GradedEstimate extends AbilityEstimate {
  /** Ús de l'escala de la persona (positiu = llindar alt, conservador). */
  criterionShift: number;
  seCriterionShift: number;
}

/**
 * Estimació MAP conjunta de (θ, c) per ascens de Newton sobre les DUES
 * dimensions, amb fallback de gradient simple si la Hessiana no és definida
 * negativa (pot passar amb categories degenerades).
 */
export function estimateGradedAbility(
  responses: GraduatedResponse[],
  itemParams: ItemParams[],
  model: "graded_2pl_map" = "graded_2pl_map"
): GradedEstimate {
  if (responses.length === 0) {
    return { theta: PRIOR_MEAN, se: PRIOR_SD, model, nResponses: 0, criterionShift: 0, seCriterionShift: SIGMA_C };
  }
  const itemsById = new Map(itemParams.map((it) => [it.itemId, it]));
  for (const r of responses) {
    if (!itemsById.has(r.itemId)) throw new Error(`Ítem ${r.itemId} sense paràmetres`);
  }

  const lp = buildGradedLogPosterior(responses, itemsById);

  let theta = PRIOR_MEAN;
  let c = 0;
  for (let iter = 0; iter < NEWTON_ITERS; iter++) {
    const g = lp.grad(theta, c);
    const H = lp.hessian(theta, c);
    const det = H.tt * H.cc - H.tc * H.tc;
    let stepT: number;
    let stepC: number;
    if (det < 0 || H.tt >= 0) {
      // Degenerada: gradient simple diagonal amb marge.
      stepT = g.dt / Math.max(-H.tt, 1e-6);
      stepC = g.dc / Math.max(-H.cc, 1e-6);
    } else {
      // Pas de Newton 2×2 (H negativa definida → resol H·d = −∇).
      stepT = (-g.dt * H.cc - g.dc * -H.tc) / det;
      stepC = (-g.dc * H.tt - g.dt * -H.tc) / det;
    }
    // Amortiment si el pas és salvatge.
    stepT = clampAbs(stepT, 1);
    stepC = clampAbs(stepC, 1);
    theta = clampAbs(theta + stepT, 6);
    c = clampAbs(c + stepC, 6);
    if (Math.abs(g.dt) < 1e-9 && Math.abs(g.dc) < 1e-9) break;
    if (Math.abs(stepT) < 1e-10 && Math.abs(stepC) < 1e-10) break;
  }

  // SE per la inversa de la informació (−H al mode).
  const H = lp.hessian(theta, c);
  const det = H.tt * H.cc - H.tc * H.tc;
  let seTheta = PRIOR_SD;
  let seC = SIGMA_C;
  if (det > 0 && H.tt < 0) {
    seTheta = Math.sqrt((-H.cc) / det);
    seC = Math.sqrt((-H.tt) / det);
  }

  return { theta, se: seTheta, model, nResponses: responses.length, criterionShift: c, seCriterionShift: seC };
}

function clampAbs(x: number, bound: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(Math.max(x, -bound), bound);
}
