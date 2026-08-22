// Ingesta reproduïble del banc d'ítems des del CSV d'origen (només lectura).
//
//  · Exclou per item_id: les 34 pseudoparaules contaminades (b_rasch > 1,0,
//    llista documentada a REVISIO_MODE_POMPEU.md §5.1 — la llista es verifica
//    contra la regla) i les 4 paraules sense entrada al DIEC.
//  · Estratificació de comptatge igual sobre la dificultat 2PL: 66 estrats de
//    paraula, 34 de pseudoparaula (numeració separada).
//  · Congela el conjunt de referència (ref-1): totes les paraules del banc net.
//  · Carrega la distribució poblacional de θ (percentils versionats).
//
// Tot el que no sigui exactament el compte esperat atura la ingesta amb error.

import "dotenv/config";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import {
  buildBankFromCsvText,
  defaultCsvPath,
  N_WORD_STRATA,
  N_PSEUDO_STRATA,
} from "../lib/bank/loadCsv";
import {
  buildPercentileTableFromCsvText,
  defaultThetaCsvPath,
  THETA_POPULATION_VERSION,
} from "../lib/bank/thetaPopulation";
import { VERSIONS } from "../lib/config";

export async function runIngest(): Promise<void> {
  const csvPath = defaultCsvPath();
  console.log(`Llegint el banc des de ${csvPath}`);
  const csvText = readFileSync(csvPath, "utf8");
  const sha256 = crypto.createHash("sha256").update(csvText).digest("hex");

  const { items, stats } = buildBankFromCsvText(csvText);
  const words = items.filter((i) => i.isWord);
  const pseudos = items.filter((i) => !i.isWord);

  const bMin = Math.min(...items.map((i) => i.b));
  const bMax = Math.max(...items.map((i) => i.b));

  console.log(`Exclòs: ${stats.excludedContaminated} pseudoparaules contaminades (per item_id, verificades contra b_rasch > 1,0)`);
  console.log(`Exclòs: ${stats.excludedNoDiec} paraules sense entrada al DIEC`);
  console.log(`Banc net: ${words.length.toLocaleString("ca-ES")} paraules / ${pseudos.length.toLocaleString("ca-ES")} pseudoparaules`);

  // Comprovacions d'estratificació
  for (let s = 1; s <= N_WORD_STRATA; s++) {
    const n = words.filter((w) => w.wordStratumId === s).length;
    if (n < Math.floor(words.length / N_WORD_STRATA)) throw new Error(`Estrat de paraula ${s} massa petit (${n})`);
  }
  for (let s = 1; s <= N_PSEUDO_STRATA; s++) {
    const n = pseudos.filter((p) => p.pseudoStratumId === s).length;
    if (!n) throw new Error(`Estrat de pseudoparaula ${s} buit`);
  }

  // Distribució poblacional de θ
  const thetaText = readFileSync(defaultThetaCsvPath(), "utf8");
  const { bins, n: thetaN } = buildPercentileTableFromCsvText(thetaText);

  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL no definida");
  const client = new Client({ connectionString: cs });
  await client.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO item_bank_versions
         (version, source_csv_sha256, n_words, n_pseudowords, n_word_strata, n_pseudo_strata, b_min, b_max)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (version) DO UPDATE SET
         source_csv_sha256 = EXCLUDED.source_csv_sha256,
         n_words = EXCLUDED.n_words, n_pseudowords = EXCLUDED.n_pseudowords,
         n_word_strata = EXCLUDED.n_word_strata, n_pseudo_strata = EXCLUDED.n_pseudo_strata,
         b_min = EXCLUDED.b_min, b_max = EXCLUDED.b_max`,
      [VERSIONS.itemBank, sha256, words.length, pseudos.length, N_WORD_STRATA, N_PSEUDO_STRATA, bMin, bMax]
    );

    // Upsert complet: la ingesta és reproduïble i idempotent, també sobre una
    // base amb dades. (Un futur ref-2 farà servir una nova versió de banc;
    // el denominador de cada resultat sempre ve de la versió registrada a la
    // partida, mai del banc corrent.)
    const BATCH = 2000;
    for (let offset = 0; offset < items.length; offset += BATCH) {
      const slice = items.slice(offset, offset + BATCH);
      const params: unknown[] = [];
      const tuples = slice.map((it, k) => {
        const b = k * 13;
        params.push(
          it.itemId, it.form, it.isWord, it.a, it.b, it.bRasch,
          it.medianRtMs, it.accuracyRaw,
          it.wordStratumId, it.pseudoStratumId,
          VERSIONS.itemBank, it.isWord /* in_reference_corpus a ref-1 */, true
        );
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`;
      });
      await client.query(
        `INSERT INTO items (item_id, form, is_word, a, b, b_rasch, median_rt_ms, accuracy_raw,
             word_stratum_id, pseudo_stratum_id, bank_version, in_reference_corpus, active)
         VALUES ${tuples.join(",")}
         ON CONFLICT (item_id) DO UPDATE SET
           form = EXCLUDED.form, is_word = EXCLUDED.is_word,
           a = EXCLUDED.a, b = EXCLUDED.b, b_rasch = EXCLUDED.b_rasch,
           median_rt_ms = EXCLUDED.median_rt_ms, accuracy_raw = EXCLUDED.accuracy_raw,
           word_stratum_id = EXCLUDED.word_stratum_id,
           pseudo_stratum_id = EXCLUDED.pseudo_stratum_id,
           bank_version = EXCLUDED.bank_version,
           in_reference_corpus = EXCLUDED.in_reference_corpus,
           active = EXCLUDED.active`,
        params
      );
    }

    const check = await client.query<{ is_word: boolean; n: string }>(
      `SELECT is_word, COUNT(*) AS n FROM items WHERE bank_version = $1 GROUP BY is_word`,
      [VERSIONS.itemBank]
    );
    const gotWords = Number(check.rows.find((r) => r.is_word)?.n ?? 0);
    const gotPseudos = Number(check.rows.find((r) => !r.is_word)?.n ?? 0);
    if (gotWords !== words.length || gotPseudos !== pseudos.length) {
      throw new Error(`Recompte post-ingesta no quadra: ${gotWords}/${gotPseudos}`);
    }

    await client.query(
      `INSERT INTO theta_population_versions (version, source, n, bins)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (version) DO UPDATE SET source = EXCLUDED.source, n = EXCLUDED.n, bins = EXCLUDED.bins`,
      [
        THETA_POPULATION_VERSION,
        "mode_pompeu_dades_20260822/data/theta_distribution.csv",
        thetaN,
        JSON.stringify(bins),
      ]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }

  console.log(`Ingesta completa: versió de banc ${VERSIONS.itemBank}, referència ${VERSIONS.referenceCorpus} (${words.length.toLocaleString("ca-ES")} paraules), percentils ${THETA_POPULATION_VERSION} (n=${thetaN.toLocaleString("ca-ES")}).`);
  console.log(`Rang de b del banc: [${bMin.toFixed(3)}, ${bMax.toFixed(3)}] (per al mapatge de pes W).`);
}

const invokedDirectly =
  typeof require !== "undefined"
    ? require.main === module
    : process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (invokedDirectly) {
  runIngest().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
