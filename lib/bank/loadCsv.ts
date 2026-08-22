// Càrrega i preparació del banc d'ítems des del CSV d'origen (només lectura).
// Compartit per la ingesta, la simulació i els tests. Mai modifica el CSV.

import { readFileSync } from "node:fs";
import path from "node:path";

export interface BankItem {
  itemId: number;
  form: string;
  isWord: boolean;
  a: number; // irt2pl_discrimination
  b: number; // irt2pl_difficulty
  bRasch: number; // irt_difficulty_rasch (només per a l'exclusió documentada)
  medianRtMs: number | null;
  accuracyRaw: number | null;
  wordStratumId: number | null;
  pseudoStratumId: number | null;
}

/** Les 34 pseudoparaules contaminades (b_rasch > 1,0). Exclusió PER ID, no per regla.
 *  Font: REVISIO_MODE_POMPEU.md §5.1. La ingesta verifica que la llista i la regla quadren. */
export const CONTAMINATED_PSEUDO_IDS = [
  32307, 61822, 20673, 25169, 44895, 3881, 56362, 11888, 58094, 27889,
  25135, 10975, 55702, 30929, 60391, 63903, 16974, 24353, 25192, 12920,
  44568, 65677, 65401, 56417, 9518, 60354, 111, 20835, 11031, 43073,
  5569, 53392, 60135, 25193,
] as const;

/** Les 4 paraules sense entrada al DIEC (donarien enllaç mort). */
export const NO_DIEC_WORD_IDS = [7156, 18837, 60964, 70698] as const;

export const EXPECTED_WORDS = 40773;
export const EXPECTED_PSEUDOWORDS = 30209;

export const N_WORD_STRATA = 66;
export const N_PSEUDO_STRATA = 34;

/** Parser CSV minimalista RFC4180 (cometes, comes dins de cometes). Sense noves línies embeddades.
 *  Retorna TOTES les files, incloses les buides: el bloc de diccionari del CSV
 *  d'origen té exactament 50 línies abans de la capçalera i cal respectar-les. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function isEmptyRow(r: string[]): boolean {
  return r.length === 1 && r[0] === "";
}

function toNum(s: string | undefined): number {
  if (s === undefined || s === "") return NaN;
  return Number(s);
}

export interface LoadedBank {
  items: BankItem[];
  stats: {
    totalRows: number;
    excludedContaminated: number;
    excludedNoDiec: number;
    nWords: number;
    nPseudowords: number;
  };
}

/**
 * Llegeix el banc net: exclou les 34 contaminades i les 4 sense DIEC,
 * calcula els estrats de comptatge igual sobre la dificultat 2PL.
 */
export function buildBankFromCsvText(csvText: string): LoadedBank {
  const rows = parseCsv(csvText);
  // El diccionari ocupa les primeres files fins a la capçalera que comença amb item_id,item_key,...
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 100); i++) {
    if (rows[i][0] === "item_id" && rows[i][1] === "item_key") {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error("Capçalera del banc no trobada al CSV");
  if (headerIdx !== 50) {
    throw new Error(
      `El CSV hauria de tenir exactament 50 línies de diccionari abans de la capçalera; n'hi ha ${headerIdx}`
    );
  }
  const header = rows[headerIdx];
  const col = new Map(header.map((h, i) => [h, i]));
  const need = ["item_id", "item", "is_word", "irt2pl_difficulty", "irt2pl_discrimination", "irt_difficulty_rasch", "median_rt_ms", "accuracy_raw"];
  for (const c of need) {
    if (!col.has(c)) throw new Error(`Columna esperada absent al CSV: ${c}`);
  }
  const idx = (name: string): number => col.get(name)!;

  const contaminated = new Set<number>(CONTAMINATED_PSEUDO_IDS);
  const noDiec = new Set<number>(NO_DIEC_WORD_IDS);

  const items: BankItem[] = [];
  const contaminatedFound: number[] = [];
  let excludedContaminated = 0;
  let excludedNoDiec = 0;
  const seenIds = new Set<number>();
  const seenForms = new Set<string>();

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isEmptyRow(row)) continue;
    const itemId = toNum(row[idx("item_id")]);
    if (Number.isNaN(itemId)) continue;
    if (seenIds.has(itemId)) throw new Error(`item_id duplicat al CSV: ${itemId}`);
    seenIds.add(itemId);

    const form = row[idx("item")];
    if (seenForms.has(form)) throw new Error(`forma duplicada al CSV: ${form}`);
    seenForms.add(form);
    if (/[A-ZÀ-ÖØ-Þ\s'·\-]/.test(form.replace(/l·l/g, "ll"))) {
      // El banc no pot tenir majúscules, espais, apòstrofs ni guionets. El punt volat només dins l·l.
      throw new Error(`Forma amb caràcters inesperats: "${form}"`);
    }

    const isWord = row[idx("is_word")] === "TRUE";
    const bRasch = toNum(row[idx("irt_difficulty_rasch")]);

    if (contaminated.has(itemId)) {
      if (isWord) throw new Error(`L'ítem contaminat ${itemId} és paraula al CSV?`);
      contaminatedFound.push(itemId);
      if (!(bRasch > 1.0)) {
        throw new Error(`L'ítem contaminat ${itemId} té b_rasch=${bRasch} ≤ 1,0: la llista i la regla no quadren`);
      }
      excludedContaminated++;
      continue;
    }
    if (noDiec.has(itemId)) {
      if (!isWord) throw new Error(`L'ítem sense DIEC ${itemId} no és paraula al CSV?`);
      excludedNoDiec++;
      continue;
    }

    items.push({
      itemId,
      form,
      isWord,
      a: toNum(row[idx("irt2pl_discrimination")]),
      b: toNum(row[idx("irt2pl_difficulty")]),
      bRasch,
      medianRtMs: Number.isFinite(toNum(row[idx("median_rt_ms")])) ? Math.round(toNum(row[idx("median_rt_ms")])) : null,
      accuracyRaw: Number.isFinite(toNum(row[idx("accuracy_raw")])) ? toNum(row[idx("accuracy_raw")]) : null,
      wordStratumId: null,
      pseudoStratumId: null,
    });
  }

  if (contaminatedFound.length !== CONTAMINATED_PSEUDO_IDS.length) {
    const missing = [...contaminated].filter((id) => !contaminatedFound.includes(id));
    throw new Error(`Falten al CSV ítems contaminats esperats: ${missing.join(", ")}`);
  }

  // Verificació creuada de la regla: cap pseudoparaula restant amb b_rasch > 1,0.
  const leftoverContaminated = items.filter((it) => !it.isWord && it.bRasch > 1.0);
  if (leftoverContaminated.length !== 0) {
    throw new Error(
      `Queden ${leftoverContaminated.length} pseudoparaules amb b_rasch > 1,0 fora de la llista documentada`
    );
  }

  assignStrata(items);

  const words = items.filter((i) => i.isWord);
  const pseudos = items.filter((i) => !i.isWord);
  if (words.length !== EXPECTED_WORDS) {
    throw new Error(`Paraules esperades ${EXPECTED_WORDS}, obtingudes ${words.length}`);
  }
  if (pseudos.length !== EXPECTED_PSEUDOWORDS) {
    throw new Error(`Pseudoparaules esperades ${EXPECTED_PSEUDOWORDS}, obtingudes ${pseudos.length}`);
  }

  return {
    items,
    stats: {
      totalRows: seenIds.size,
      excludedContaminated,
      excludedNoDiec,
      nWords: words.length,
      nPseudowords: pseudos.length,
    },
  };
}

/**
 * Estratificació de comptatge igual sobre la dificultat 2PL ascendent
 * (desempat estable per item_id). Numeració separada paraula/pseudoparaula.
 */
export function assignStrata(items: BankItem[]): void {
  const words = items.filter((i) => i.isWord).sort((x, y) => x.b - y.b || x.itemId - y.itemId);
  const pseudos = items.filter((i) => !i.isWord).sort((x, y) => x.b - y.b || x.itemId - y.itemId);
  splitIntoStrata(words, N_WORD_STRATA, (it, s) => (it.wordStratumId = s));
  splitIntoStrata(pseudos, N_PSEUDO_STRATA, (it, s) => (it.pseudoStratumId = s));
}

function splitIntoStrata(sorted: BankItem[], nStrata: number, set: (it: BankItem, s: number) => void): void {
  const base = Math.floor(sorted.length / nStrata);
  const remainder = sorted.length % nStrata;
  let cursor = 0;
  for (let s = 1; s <= nStrata; s++) {
    const size = base + (s <= remainder ? 1 : 0); // els primers `remainder` estrats tenen una més
    for (let k = 0; k < size; k++) {
      set(sorted[cursor++], s);
    }
  }
  if (cursor !== sorted.length) throw new Error("Estratificació no cobreix tot el conjunt");
}

/** Ruta per defecte del CSV d'origen (germà del projecte). */
export function defaultCsvPath(): string {
  return process.env.ITEM_BANK_CSV ?? path.resolve(process.cwd(), "..", "stimulus_response_measures_23691891.csv");
}

export function loadBankCsvText(csvPath = defaultCsvPath()): string {
  return readFileSync(csvPath, "utf8");
}
