// Estimació d'habilitat θ amb 2PL i MAP. Mòdul pur.
//
// La interfície estimateAbility(responses, itemParams, model) és el punt
// d'extensió de models. Hi ha dos implementats:
//   · "binary_2pl_map"   — el vigent (cal-1): binaritza al 50% amb TIE_RULE.
//   · "graded_2pl_map"   — resposta graduada amb criteri de persona (§3.1):
//     entra quan hi hagi calibratge propi, bumpant calibration_version i
//     re-puntuant el passat; la interfície no canvia.

import { PRIOR_MEAN, PRIOR_SD, THETA_BOUND, NEWTON_MAX_ITER, TIE_RULE } from "../config";
import { clamp, logistic } from "./math";
import { estimateGradedAbility } from "./graded";
import type { AbilityEstimate, GraduatedResponse, ItemParams } from "./types";

/** P_i(θ) del 2PL. */
export function pCorrect2pl(theta: number, a: number, b: number): number {
  return logistic(a * (theta - b));
}

/**
 * Binarització determinista de la resposta graduada.
 * Regla de desempat (config.TIE_RULE): confiança exactament 0,5 compta com
 * "no és paraula". Coherent a tot el codi.
 */
export function binarize(confidence: number): boolean {
  if (confidence < 0 || confidence > 1 || Number.isNaN(confidence)) {
    throw new RangeError(`confiança fora de [0,1]: ${confidence}`);
  }
  return confidence > 0.5;
}

interface LogPosterior {
  ll(theta: number): number;
  dll(theta: number): number;
}

/**
 * Indicador de CORRECCIÓ de la resposta (§4.1):
 *   paraula real    → correcte = va dir "paraula"      (x = 1)
 *   pseudoparaula   → correcte = va dir "no paraula"   (x = 0)
 * La confiança declarada és P("és paraula"); la conversió depèn de is_word.
 */
export function correctnessOf(response: GraduatedResponse): number {
  return binarize(response.confidence) === response.isWord ? 1 : 0;
}

function buildLogPosterior(
  responses: GraduatedResponse[],
  byItem: Map<number, ItemParams>
): LogPosterior {
  // Precalculem x_i (correcció binària) i els paràmetres per ítem.
  const xs = responses.map((r) => correctnessOf(r));
  const its = responses.map((r) => paramOf(byItem, r.itemId));
  return {
    ll(theta) {
      let s = -((theta - PRIOR_MEAN) ** 2) / (2 * PRIOR_SD * PRIOR_SD);
      for (let k = 0; k < responses.length; k++) {
        const p = pCorrect2pl(theta, its[k].a, its[k].b);
        const x = xs[k];
        s += x === 1 ? Math.log(p) : Math.log1p(-p);
      }
      return s;
    },
    dll(theta) {
      // d/dθ Σ[x log P + (1−x)log(1−P)] = Σ a(x − P); menys la derivada del prior.
      let s = -(theta - PRIOR_MEAN) / (PRIOR_SD * PRIOR_SD);
      for (let k = 0; k < responses.length; k++) {
        s += its[k].a * (xs[k] - pCorrect2pl(theta, its[k].a, its[k].b));
      }
      return s;
    },
  };
}

function paramOf(byItem: Map<number, ItemParams>, id: number): ItemParams {
  const it = byItem.get(id);
  if (!it) throw new Error(`Ítem ${id} sense paràmetres`);
  return it;
}

/** SE de mesura de θ donat un conjunt de respostes i un valor de θ:
 * 1/sqrt(Σ a²·P·(1−P) + 1/σ_prior²). */
export function seAtTheta(
  responses: GraduatedResponse[],
  itemParamsById: Map<number, ItemParams>,
  theta: number
): number {
  let info = 1 / (PRIOR_SD * PRIOR_SD);
  for (const r of responses) {
    const it = paramOf(itemParamsById, r.itemId);
    const p = pCorrect2pl(theta, it.a, it.b);
    info += it.a * it.a * p * (1 - p);
  }
  return 1 / Math.sqrt(info);
}

/**
 * Estimació MAP de θ per Newton-Raphson acotat a [−THETA_BOUND, +THETA_BOUND],
 * amb fallback a bisecció si no convergeix en NEWTON_MAX_ITER iteracions.
 */
export function estimateAbility(
  responses: GraduatedResponse[],
  itemParams: ItemParams[],
  model: EstimationModelLike = "binary_2pl_map"
): AbilityEstimate {
  if (model === "graded_2pl_map") {
    return estimateGradedAbility(responses, itemParams, model);
  }
  if (model !== "binary_2pl_map") {
    throw new Error(
      `Model d'estimació desconegut: "${model}". El model graduat s'afegirà quan hi hagi calibratge propi.`
    );
  }
  if (responses.length === 0) {
    // Sense respostes, l'estimació és el prior.
    return { theta: PRIOR_MEAN, se: PRIOR_SD, model, nResponses: 0 };
  }

  const byItem = new Map<number, ItemParams>(itemParams.map((it) => [it.itemId, it]));
  for (const r of responses) {
    if (!byItem.has(r.itemId)) throw new Error(`Ítem ${r.itemId} sense paràmetres`);
  }

  const lp = buildLogPosterior(responses, byItem);

  let theta = 0; // arrencada al prior
  let converged = false;
  for (let iter = 0; iter < NEWTON_MAX_ITER; iter++) {
    const g = lp.dll(theta);
    if (Math.abs(g) < 1e-10) {
      converged = true;
      break;
    }
    const step = -g / hessianApprox(responses, byItem, theta);
    let next = clamp(theta + step, -THETA_BOUND, THETA_BOUND);
    // Si el pas surt de la conca, escurcem (line search simple).
    let tries = 0;
    while (!Number.isFinite(lp.ll(next)) && tries < 20) {
      next = clamp(theta + (next - theta) / 2, -THETA_BOUND, THETA_BOUND);
      tries++;
    }
    if (Math.abs(next - theta) < 1e-9) {
      theta = next;
      converged = Math.abs(lp.dll(theta)) < 1e-4; // clavat al límit no és convergència
      break;
    }
    theta = next;
  }
  if (!converged) theta = bisectMax(lp);

  const se = seAtTheta(responses, byItem, theta);
  return { theta, se, model, nResponses: responses.length };
}

function hessianApprox(
  responses: GraduatedResponse[],
  byItem: Map<number, ItemParams>,
  theta: number
): number {
  // −d²/dθ² de la log-posterior = informació de Fisher + precisió del prior.
  let info = 1 / (PRIOR_SD * PRIOR_SD);
  for (const r of responses) {
    const it = paramOf(byItem, r.itemId);
    const p = pCorrect2pl(theta, it.a, it.b);
    info += it.a * it.a * p * (1 - p);
  }
  return info;
}

/** Bisecció sobre la derivada (la log-posterior MAP és unimodal). */
function bisectMax(lp: LogPosterior): number {
  let lo = -THETA_BOUND;
  let hi = THETA_BOUND;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (lp.dll(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

type EstimationModelLike = string;

export { TIE_RULE, clamp };
