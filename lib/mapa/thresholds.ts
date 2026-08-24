// Llindars de zones del mapa: matemàtica pura, sense DB ni React (testeig).
//
// El banc vigent té 40.777 paraules reals. Una zona per cada 1% del banc.
// Els llindars es calculen com a round(i · N / 100) i no com a multiples de
// floor(N/100): amb divisió fixa (408) l'última zona cauria a 40.392 i la
// 100a no s'assoliria mai (40.777/408 = 99,94). Amb round, la zona 100 cau
// EXACTAMENT a l'última paraula del banc.

import { MAPA_ZONES } from "../config";

/**
 * Llindar de paraules reals vistes que desbloqueja la zona i-èssima
 * (índex 0 = zona 1). Monòton creixent; l'últim és exactament nWords.
 */
export function zoneThresholds(nWords: number): number[] {
  if (!Number.isInteger(nWords) || nWords < MAPA_ZONES) {
    throw new Error(`nWords ha de ser un enter ≥ ${MAPA_ZONES}`);
  }
  const t: number[] = [];
  for (let i = 1; i <= MAPA_ZONES; i++) {
    t.push(Math.min(nWords, Math.round((i * nWords) / MAPA_ZONES)));
  }
  return t;
}

/** Zones guanyades amb `wordsSeen` paraules reals úniques vistes. */
export function zonesEarned(wordsSeen: number, thresholds: number[]): number {
  let n = 0;
  for (const t of thresholds) {
    if (wordsSeen < t) break;
    n++;
  }
  return n;
}

/** Llindar de la propera zona encara no assolida, o null si ja és totes. */
export function nextZoneThreshold(wordsSeen: number, thresholds: number[]): number | null {
  for (const t of thresholds) {
    if (t > wordsSeen) return t;
  }
  return null;
}
