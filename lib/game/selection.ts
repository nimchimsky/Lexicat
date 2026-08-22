// Selecció d'ítems per a una partida. MÒDUL PUR (servidor i simulació el
// comparteixen): un ítem per estrat, refredament per jugador, ordre barrejat
// amb llavor desada.

import { N_WORD_ITEMS, N_PSEUDO_ITEMS, COOLDOWN_GAMES } from "../config";

export interface SelectableItem {
  itemId: number;
  isWord: boolean;
  /** Estrats de comptatge igual calculats a la ingesta (numeració separada). */
  wordStratumId: number | null;
  pseudoStratumId: number | null;
}

/** Mapa itemId → índex de la darrera partida del jugador on el va veure. */
export type ExposureMap = Map<number, number>;

export interface SelectionResult<T extends SelectableItem> {
  /** 100 ítems en l'ordre de servei. */
  ordered: T[];
  /** Estrats on s'ha hagut de relaxar el refredament. */
  relaxedStrata: number[];
}

/**
 * RNG determinista amb llavor (mulberry32). La partida guarda la llavor i la
 * composició sencera ABANS de servir el primer ítem.
 */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromHex(hex: string): number {
  return parseInt(hex.slice(0, 8), 16) >>> 0;
}

function pickRandom<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Selecció estratificada:
 *  · 66 paraules (un per estrat 1..66) + 34 pseudoparaules (un per estrat 1..34).
 *  · Dins de cada estrat, tria a l'atzar entre els ELEGIBLES: els que el jugador
 *    no ha vist en les darreres COOLDOWN_GAMES partides.
 *  · Si un estrat es queda sense elegibles, es relaxa NOMÉS per aquell estrat
 *    triant entre els menys recentment vists, i es registra.
 */
export function selectGameItems<T extends SelectableItem>(
  bank: T[],
  exposures: ExposureMap,
  rng: () => number,
  currentGameIndex: number,
  cooldownGames = COOLDOWN_GAMES
): SelectionResult<T> {
  const words = bank.filter((i) => i.isWord);
  const pseudos = bank.filter((i) => !i.isWord);

  const chosenWords = pickPerStratum(words, "wordStratumId", N_WORD_ITEMS, exposures, rng, currentGameIndex, cooldownGames);
  const chosenPseudos = pickPerStratum(pseudos, "pseudoStratumId", N_PSEUDO_ITEMS, exposures, rng, currentGameIndex, cooldownGames);

  const combined = [...chosenWords.picked, ...chosenPseudos.picked];
  const relaxedStrata = [...chosenWords.relaxed, ...chosenPseudos.relaxed];

  // Comprovació dura de composició: mai sortir una partida mal formada.
  const ids = new Set(combined.map((i) => i.itemId));
  if (ids.size !== combined.length) throw new Error("Ítem repetit dins de la partida");
  if (chosenWords.picked.length !== N_WORD_ITEMS || chosenPseudos.picked.length !== N_PSEUDO_ITEMS) {
    throw new Error("Composició 66/34 no assolible amb el banc actual");
  }

  const ordered = fisherYates(combined, rng);
  return { ordered, relaxedStrata };
}

function pickPerStratum<T extends SelectableItem>(
  items: T[],
  stratumKey: "wordStratumId" | "pseudoStratumId",
  nStrata: number,
  exposures: ExposureMap,
  rng: () => number,
  currentGameIndex: number,
  cooldownGames: number
): { picked: T[]; relaxed: number[] } {
  const byStratum = new Map<number, T[]>();
  for (const it of items) {
    const s = it[stratumKey];
    if (s === null || s === undefined) continue;
    const list = byStratum.get(s);
    if (list) list.push(it);
    else byStratum.set(s, [it]);
  }

  const picked: T[] = [];
  const relaxed: number[] = [];
  for (let s = 1; s <= nStrata; s++) {
    const pool = byStratum.get(s);
    if (!pool || pool.length === 0) throw new Error(`L'estrat ${s} és buit al banc`);
    const eligible = pool.filter((it) => {
      const last = exposures.get(it.itemId);
      return last === undefined || currentGameIndex - last > cooldownGames;
    });
    if (eligible.length > 0) {
      picked.push(pickRandom(eligible, rng));
    } else {
      // Relaxació només per aquest estrat: el menys recentment vist.
      relaxed.push(s);
      let best: T | undefined;
      let bestLast = Infinity;
      for (const it of pool) {
        const last = exposures.get(it.itemId) ?? -Infinity;
        if (last < bestLast) {
          bestLast = last;
          best = it;
        }
      }
      picked.push(best!);
    }
  }
  return { picked, relaxed };
}

export function fisherYates<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
