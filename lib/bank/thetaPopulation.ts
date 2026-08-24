// Càrrega de la distribució poblacional de θ (theta_distribution.csv) per al
// percentil versionat. Font: mode_pompeu_dades_20260822/data.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "./loadCsv";
import { PercentileTable, type ThetaBin } from "../psychometrics/percentile";

export const THETA_POPULATION_VERSION = "pob-1";

export function parseBinLabel(label: string): { lo: number; hi: number } {
  const m = label.match(/^\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/);
  if (!m) throw new Error(`Etiqueta de bin no reconeguda: ${label}`);
  return { lo: Number(m[1]), hi: Number(m[2]) };
}

export function buildPercentileTableFromCsvText(csvText: string): {
  table: PercentileTable;
  bins: ThetaBin[];
  n: number;
} {
  const rows = parseCsv(csvText);
  if (rows[0][0] !== "theta_bin" || rows[0][1] !== "n") {
    throw new Error("theta_distribution.csv: capçalera inesperada");
  }
  const bins: ThetaBin[] = [];
  let n = 0;
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const { lo, hi } = parseBinLabel(rows[i][0]);
    const cnt = Number(rows[i][1]);
    if (!Number.isFinite(cnt)) continue;
    bins.push({ lo, hi, n: cnt });
    n += cnt;
  }
  const table = new PercentileTable(bins, { version: THETA_POPULATION_VERSION, n });
  return { table, bins, n };
}

/** Ruta per defecte del CSV de distribució de θ. */
export function defaultThetaCsvPath(): string {
  return process.env.THETA_CSV ?? path.resolve(process.cwd(), "..", "mode_pompeu_dades_20260822", "data", "theta_distribution.csv");
}

export function loadThetaCsvText(csvPath = defaultThetaCsvPath()): string {
  return readFileSync(csvPath, "utf8");
}

