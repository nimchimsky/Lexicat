// Llindars de zones del mapa: matemàtica pura, sense DB ni React (testeig).
//
// Progressió en dos trams (revisió UX 25/08/2026):
//  · Inici ràpid: les tres primeres zones tenen llindar fix (una partida,
//    ~2 i ~4 partides) perquè la primera recompensa arribi el mateix dia.
//  · Ritme científic: de la quarta zona end, una zona per cada 1% del banc,
//    repartida uniformement entre l'últim llindar ràpid i nWords. Els
//    llindars són round(...) interpolats i NO múltiples d'una divisió fixa:
//    amb 408 fixes l'última zona cauria a 40.392 i la 100a no s'assoliria
//    mai (40.777/408 = 99,94). Amb interpolació, la zona 100 cau EXACTAMENT
//    a l'última paraula del banc.

import { MAPA_ZONES, MAPA_FAST_START_WORDS } from "../config";

const LAST_FAST = MAPA_FAST_START_WORDS[MAPA_FAST_START_WORDS.length - 1];

/**
 * Llindar de paraules reals vistes que desbloqueja la zona i-èssima
 * (índex 0 = zona 1). Monòton estrictament creixent; l'últim és exactament
 * nWords.
 */
export function zoneThresholds(nWords: number): number[] {
  if (!Number.isInteger(nWords) || nWords < MAPA_ZONES) {
    throw new Error(`nWords ha de ser un enter ≥ ${MAPA_ZONES}`);
  }
  // Banc massa petit per a l'inici ràpid (no és el cas real): ritme lineal
  // clàssic, que garanteix 100 llindars estricte creixents.
  if (nWords < LAST_FAST + MAPA_ZONES) {
    const t: number[] = [];
    for (let i = 1; i <= MAPA_ZONES; i++) {
      t.push(Math.min(nWords, Math.round((i * nWords) / MAPA_ZONES)));
    }
    return t;
  }

  const fast: number[] = Array.from(MAPA_FAST_START_WORDS);
  const tailZones = MAPA_ZONES - fast.length;
  const span = nWords - LAST_FAST;
  for (let i = 1; i <= tailZones; i++) {
    fast.push(Math.min(nWords, LAST_FAST + Math.round((i * span) / tailZones)));
  }
  return fast;
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
