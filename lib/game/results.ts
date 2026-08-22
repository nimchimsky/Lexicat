// Càlcul del resultat complet d'una partida. MÒDUL PUR: el servidor el crida
// en acabar, la simulació el reutilitza. El client no calcula res.

import { INSTABILITY_SE } from "../config";
import { binarize, estimateAbility } from "../psychometrics/irt";
import type { GraduatedResponse, ItemParams } from "../psychometrics/types";
import { LexiconReference } from "../psychometrics/lexicon";
import { PercentileTable } from "../psychometrics/percentile";
import { computeSdt, DPRIME_CEILING_66_34 } from "../psychometrics/sdt";
import {
  displayItemScore,
  pAssignedToCorrect,
  itemWeight,
} from "../psychometrics/scoring";
import { SCORE_K, SCORING_EPSILON } from "../config";

export interface ScoredResponse extends GraduatedResponse {}

export interface ComputedGameResult {
  nResponses: number;
  theta: number;
  seTheta: number;
  seTotal: number;
  pctLexicon: number;
  pctLo: number;
  pctHi: number;
  percentile: number;
  dPrime: number;
  criterion: number;
  dPrimeCeiling: number;
  nCorrect: number;
  nHitsOnWords: number;
  nWords: number;
  nFalseAlarms: number;
  nPseudo: number;
  nFiftyFifty: number;
  score: number;
  /** Mètrica del rànquing 2 (0..1): encert ponderat per dificultat menys 0,5·FA corregida. */
  lexiconGameScore: number;
}

/**
 * Regla de desempat coherent amb tot el sistema: confiança exactament 50%
 * compta com a "no és paraula" per a l'encert cru i l'estimació de θ; queda
 * EXCLÒSIA del càlcul de H/FA (d′) i de la mètrica del rànquing 2.
 */
export function computeGameResult(
  responses: ScoredResponse[],
  itemsById: Map<number, ItemParams>,
  lexicon: LexiconReference,
  percentiles: PercentileTable,
  bankRange: { bMin: number; bMax: number }
): ComputedGameResult {
  if (responses.length === 0) throw new Error("Partida sense respostes");

  const est = estimateAbility(responses, [...itemsById.values()]);
  const seTotal = Math.sqrt(est.se * est.se + INSTABILITY_SE * INSTABILITY_SE);
  const { pct, lo, hi } = lexicon.pctWithInterval(est.theta, seTotal);

  const sdt = computeSdt(responses);
  const counts = rawCounts(responses);

  let nCorrect = 0;
  for (const r of responses) {
    if (binarize(r.confidence) === r.isWord) nCorrect++;
  }

  // Puntuació visible
  let score = 0;
  for (const r of responses) {
    const it = itemsById.get(r.itemId);
    if (!it) throw new Error(`Ítem ${r.itemId} sense paràmetres`);
    const p = pAssignedToCorrect(r.confidence, r.isWord);
    score += displayItemScore(p, it.b, bankRange.bMin, bankRange.bMax, SCORING_EPSILON, SCORE_K);
  }

  return {
    nResponses: responses.length,
    theta: est.theta,
    seTheta: est.se,
    seTotal,
    pctLexicon: pct,
    pctLo: lo,
    pctHi: hi,
    percentile: percentiles.percentileOf(est.theta),
    dPrime: sdt.dPrime,
    criterion: sdt.criterion,
    dPrimeCeiling: DPRIME_CEILING_66_34,
    nCorrect,
    nHitsOnWords: counts.hits,
    nWords: counts.nWords,
    nFalseAlarms: counts.falseAlarms,
    nPseudo: counts.nPseudo,
    nFiftyFifty: counts.nFiftyFifty,
    score,
    lexiconGameScore: lexiconGameScore(responses, itemsById, bankRange),
  };
}

/** Recompte directe (sense correcció) de falses alarmes i encerts en paraules. */
export function rawCounts(responses: ScoredResponse[]): {
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
  nWords: number;
  nPseudo: number;
  nFiftyFifty: number;
} {
  let hits = 0, misses = 0, falseAlarms = 0, correctRejections = 0;
  let nWords = 0, nPseudo = 0, nFiftyFifty = 0;
  for (const r of responses) {
    if (r.confidence === 0.5) {
      nFiftyFifty++;
      continue;
    }
    const saidWord = binarize(r.confidence);
    if (r.isWord) {
      nWords++;
      saidWord ? hits++ : misses++;
    } else {
      nPseudo++;
      saidWord ? falseAlarms++ : correctRejections++;
    }
  }
  return { hits, misses, falseAlarms, correctRejections, nWords, nPseudo, nFiftyFifty };
}

/**
 * Mètrica exacta del rànquing 2 (decisió documentada a DECISIONS.md):
 *   base    = Σ_{paraules acceptades} W_i / Σ_{paraules} W_i   (encert ponderat per dificultat)
 *   penal   = (FA + 0,5)/(n_pseudo + 1)                        (FA loglinealment corregida)
 *   mètrica = clamp(base − 0,5 · penal, 0, 1)
 * Les respostes de 50% exacte queden fora dels dos termes, com a d′.
 */
export function lexiconGameScore(
  responses: ScoredResponse[],
  itemsById: Map<number, ItemParams>,
  bankRange: { bMin: number; bMax: number }
): number {
  const counts = rawCounts(responses);
  let wTotal = 0;
  let wHits = 0;
  for (const r of responses) {
    if (!r.isWord || r.confidence === 0.5) continue;
    const it = itemsById.get(r.itemId);
    if (!it) throw new Error(`Ítem ${r.itemId} sense paràmetres`);
    const w = itemWeight(it.b, bankRange.bMin, bankRange.bMax);
    wTotal += w;
    if (binarize(r.confidence)) wHits += w;
  }
  const base = wTotal > 0 ? wHits / wTotal : 0;
  const penalty = (counts.falseAlarms + 0.5) / (counts.nPseudo + 1);
  return Math.min(1, Math.max(0, base - 0.5 * penalty));
}
