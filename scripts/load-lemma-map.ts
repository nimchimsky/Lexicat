// Carrega el mapatge morfològic forma→lema a items.lemma_key.
//
// El CSV de calibratge no porta mapatge morfològic (vegeu DUBTES.md §1),
// així que la restricció de lema de la selecció és inert fins que aquest
// script no carregui el parell forma→lema (font URV o derivat d'una font
// morfològica catalana).
//
// Format d'entrada: CSV amb dues columnes `forma,lema` (capçalera opcional,
// separador coma o punt i coma, BOM tolerat). Les formes que no existeixin
// al banc vigent s'ignoren i es compten; cap fila no muta res més.
//
// Ús:
//   npx tsx scripts/load-lemma-map.ts cam/per/al/mapa.csv
//   (o LEMMA_MAP_CSV=cam npm run db:lemmas)

import "dotenv/config";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { VERSIONS } from "../lib/config";

function parseCsv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cols = line.split(/[;,]/).map((c) => c.trim().toLowerCase());
    if (cols.length < 2) continue;
    const [forma, lema] = cols;
    if (!forma || !lema) continue;
    if (forma === "forma" && lema === "lema") continue; // capçalera
    map.set(forma, lema);
  }
  return map;
}

export async function runLoadLemmaMap(csvPath: string): Promise<void> {
  const pairs = parseCsv(readFileSync(csvPath, "utf8"));
  console.log(`Mapatge llegit: ${pairs.size} parells forma→lema`);

  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL no definida");
  const client = new Client({ connectionString: cs });
  await client.connect();

  try {
    await client.query("BEGIN");

    // Només ítems del banc vigent. La comparació de forma és exacta i en
    // minúscules: el banc no té majúscules (§6.6 de la revisió).
    const bankForms = await client.query<{ item_id: number; form: string }>(
      `SELECT item_id, form FROM items WHERE bank_version = $1`,
      [VERSIONS.itemBank]
    );
    const byForm = new Map(bankForms.rows.map((r) => [r.form.toLowerCase(), r.item_id]));

    let matched = 0;
    let missing = 0;
    const updates: Array<[number, string]> = [];
    for (const [forma, lema] of pairs) {
      const itemId = byForm.get(forma);
      if (itemId === undefined) {
        missing++;
        continue;
      }
      matched++;
      updates.push([itemId, lema]);
    }

    const BATCH = 2000;
    for (let offset = 0; offset < updates.length; offset += BATCH) {
      const slice = updates.slice(offset, offset + BATCH);
      const params: unknown[] = [];
      const tuples = slice.map(([id], k) => {
        params.push(id);
        return `$${k + 1}`;
      });
      // Un sol passada per batch: lemma_key = CASE per id.
      const assignments = slice
        .map(([, lema], k) => {
          params.push(lema);
          return `WHEN $${k + 1}::int THEN $${slice.length + k + 1}::text`;
        })
        .join(" ");
      await client.query(
        `UPDATE items SET lemma_key = CASE item_id ${assignments} END
         WHERE item_id IN (${tuples.join(",")})`,
        params
      );
    }

    await client.query("COMMIT");

    const grouped = await client.query<{ n: string }>(
      `SELECT COUNT(DISTINCT lemma_key)::text AS n FROM items
       WHERE bank_version = $1 AND lemma_key IS NOT NULL`,
      [VERSIONS.itemBank]
    );
    console.log(`Assignats: ${matched} ítems · formes del CSV fora del banc: ${missing}`);
    console.log(`Lemes diferents al banc: ${grouped.rows[0].n}`);
    console.log(`La restricció de lema de la selecció ja és activa amb aquestes dades.`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

const arg = process.argv[2] ?? process.env.LEMMA_MAP_CSV;
if (arg) {
  runLoadLemmaMap(arg).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.error("Ús: npx tsx scripts/load-lemma-map.ts <mapa.csv>  (o LEMMA_MAP_CSV=<fitxer>)");
  process.exit(1);
}
