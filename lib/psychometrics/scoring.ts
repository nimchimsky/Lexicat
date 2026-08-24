// Puntuació del Mode Pompeu.
//
// Dues capes que no s'han de barrejar:
//  1. La regla pròpia (logarítmica sobre la probabilitat assignada a la resposta
//     correcta, ponderada pel pes de l'ítem), que governa per dins i manté la
//     propietat "dir la veritat sobre la teva confiança surt a compte".
//  2. El número visible, desplaçat i escalat per no mostrar mai negatius:
//     display_i = round(K · W_i · (S_i − S_min)); W_i > 0 conserva l'ordre i el
//     mínim continua sent zero.
//
// ε i K entren a scoring_version: canviar-los canvia totes les puntuacions
// històriques.

import { SCORING_EPSILON, SCORE_K } from "../config";
import { clamp } from "./math";

/** S_i abans d'escala: 1 + log₂(clamp(p_correcta, ε, 1−ε)). */
export function rawScore(pCorrect: number, epsilon = SCORING_EPSILON): number {
  if (!(pCorrect >= 0 && pCorrect <= 1)) throw new RangeError(`p fora de [0,1]: ${pCorrect}`);
  const pAdj = clamp(pCorrect, epsilon, 1 - epsilon);
  return 1 + Math.log2(pAdj);
}

/** Punt mínim possible de la regla, amb ε: 1 + log₂(ε) ≈ −4,644 amb ε=0,02. */
export function minRawScore(epsilon = SCORING_EPSILON): number {
  return 1 + Math.log2(epsilon);
}

/**
 * Pes W_i: estrictament positiu, funció NOMÉS de la dificultat b de l'ítem
 * servit, mai de la resposta. Mapatge lineal de b a [1, 3] sobre el rang real
 * del banc (fixat a la ingesta i versionat).
 */
export function itemWeight(b: number, bMin: number, bMax: number): number {
  if (!(bMax > bMin)) throw new Error(`Rang de b invàlid: [${bMin}, ${bMax}]`);
  const t = clamp((b - bMin) / (bMax - bMin), 0, 1);
  return 1 + 2 * t;
}

/** Punts visibles d'un ítem: round(K · W_i · (S_i − S_min)) ≥ 0 sempre. */
export function displayItemScore(
  pCorrect: number,
  b: number,
  bMin: number,
  bMax: number,
  epsilon = SCORING_EPSILON,
  K = SCORE_K
): number {
  const s = rawScore(pCorrect, epsilon);
  const w = itemWeight(b, bMin, bMax);
  return Math.round(K * w * (s - minRawScore(epsilon)));
}

/** Puntuació total visible de la partida: suma dels punts per ítem. */
export function totalDisplayScore(
  items: { pCorrect: number; b: number }[],
  bMin: number,
  bMax: number,
  epsilon = SCORING_EPSILON,
  K = SCORE_K
): number {
  let total = 0;
  for (const it of items) {
    total += displayItemScore(it.pCorrect, it.b, bMin, bMax, epsilon, K);
  }
  return total;
}

/** Probabilitat que el jugador va assignar a la resposta correcta. */
export function pAssignedToCorrect(confidence: number, isWord: boolean): number {
  return isWord ? confidence : 1 - confidence;
}

