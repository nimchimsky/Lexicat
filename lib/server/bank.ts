// Banc carregat de la base de dades, amb caché per procés.
// El client mai rep is_word; aquí és on viuen les dades sensibles.

import { query } from "./db";
import { LexiconReference } from "../psychometrics/lexicon";
import { PercentileTable, type ThetaBin } from "../psychometrics/percentile";
import type { ItemParams } from "../psychometrics/types";
import { VERSIONS, PRIOR_SD, INSTABILITY_SE } from "../config";

export interface BankRange {
  bMin: number;
  bMax: number;
}

interface CachedBank {
  items: (ItemParams & {
    form: string;
    wordStratumId: number | null;
    pseudoStratumId: number | null;
    active: boolean;
  })[];
  lexicon: LexiconReference;
  percentiles: PercentileTable;
  range: BankRange;
  loadedAt: number;
}

let cache: CachedBank | undefined;

/** Invalida la caché (tests / post-ingesta). */
export function invalidateBankCache(): void {
  cache = undefined;
}

export async function loadBank(): Promise<CachedBank> {
  if (cache && Date.now() - cache.loadedAt < 60_000) return cache;

  const itemsRes = await query<{
    item_id: number;
    form: string;
    is_word: boolean;
    a: number;
    b: number;
    word_stratum_id: number | null;
    pseudo_stratum_id: number | null;
    active: boolean;
    in_reference_corpus: boolean;
  }>(
    `SELECT item_id, form, is_word, a, b, word_stratum_id, pseudo_stratum_id, active, in_reference_corpus
     FROM items WHERE bank_version = $1`,
    [VERSIONS.itemBank]
  );

  const bankVer = await query<{ b_min: number; b_max: number; n_words: number }>(
    `SELECT b_min, b_max, n_words FROM item_bank_versions WHERE version = $1`,
    [VERSIONS.itemBank]
  );
  if (bankVer.rowCount === 0) {
    throw new Error(
      `El banc ${VERSIONS.itemBank} no està ingestat. Executa npm run db:ingest.`
    );
  }

  const popRes = await query<{ bins: ThetaBin[]; n: string; version: string }>(
    `SELECT bins, n, version FROM theta_population_versions ORDER BY loaded_at DESC LIMIT 1`
  );
  if (popRes.rowCount === 0) throw new Error("Distribució poblacional de θ no carregada");
  const pop = popRes.rows[0];

  const activeItems = itemsRes.rows.map((r) => ({
    itemId: r.item_id,
    form: r.form,
    isWord: r.is_word,
    a: r.a,
    b: r.b,
    wordStratumId: r.word_stratum_id,
    pseudoStratumId: r.pseudo_stratum_id,
    active: r.active,
    inReferenceCorpus: r.in_reference_corpus,
  }));

  const refItems = itemsRes.rows
    .filter((r) => r.is_word && r.in_reference_corpus)
    .map((r) => ({ a: r.a, b: r.b }));

  const metaN = Number(bankVer.rows[0].n_words);
  const lexicon = new LexiconReference(refItems, {
    nWords: metaN,
    version: VERSIONS.referenceCorpus,
  });

  // Sanity: el prior i la inestabilitat venen de la població d'estudi.
  if (!(PRIOR_SD > 0) || !(INSTABILITY_SE > 0)) throw new Error("Config de priors invàlida");

  cache = {
    items: activeItems,
    lexicon,
    percentiles: new PercentileTable(pop.bins, { version: pop.version, n: Number(pop.n) }),
    range: { bMin: bankVer.rows[0].b_min, bMax: bankVer.rows[0].b_max },
    loadedAt: Date.now(),
  };
  return cache;
}
