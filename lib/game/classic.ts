// Regles del mode Clàssic. MÒDUL PUR: la puntuació no mira ni el temps,
// ni la dificultat de l'ítem, ni ratxes. Només els encerts en paraules i
// les falses alarmes, corregits per la proporció 66/34 de la partida.

import { N_PSEUDO_ITEMS, N_WORD_ITEMS } from "../config";

/**
 * Puntuació equilibrada 0..100:
 *   50 · (taxa d'encerts en paraules + taxa de rebuig de pseudoparaules)
 *
 * És la balanced accuracy del judici lèxic. El 66/34 no afavoreix respondre
 * sempre «paraula» o sempre «pseudoparaula»: l'atzar queda al voltant de 50,
 * una partida perfecta val 100 i la puntuació només depèn de hits i FA.
 */
export function classicScore(
  hits: number,
  falseAlarms: number,
  nWords = N_WORD_ITEMS,
  nPseudos = N_PSEUDO_ITEMS
): number {
  if (!Number.isInteger(nWords) || !Number.isInteger(nPseudos) || nWords <= 0 || nPseudos <= 0) {
    throw new Error("Composició de partida invàlida");
  }
  if (!Number.isInteger(hits) || hits < 0 || hits > nWords) {
    throw new Error("Nombre d'encerts en paraules fora de rang");
  }
  if (!Number.isInteger(falseAlarms) || falseAlarms < 0 || falseAlarms > nPseudos) {
    throw new Error("Nombre de falses alarmes fora de rang");
  }
  const hitRate = hits / nWords;
  const correctRejectionRate = 1 - falseAlarms / nPseudos;
  return Math.round(50 * (hitRate + correctRejectionRate));
}
