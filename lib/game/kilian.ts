// Regles del mode Kilian. MÒDUL PUR: el servidor el fa servir per puntuar i
// la simulació i els tests el reutilitzen. El client només mostra el resultat
// que li torna el servidor (mai calcula punts ell).

import { KILIAN_BAR_MS, KILIAN_POINTS_MAX, KILIAN_MULTIPLIER_CAP } from "../config";

export type KillianKind = "answer" | "timeout";
export type KillianChoice = "yes" | "no";

/**
 * El multiplicador depèn de la ratxa EN CURSA (incloent l'encert que es
 * puntua). Graons cada 5 fins a ×2 a 25; a partir d'aquí creix més lent,
 * un graó de +0,1 per cada 10 encerts més, amb sostre ×3 (inabastable en
 * una partida de 100, però fixa el límit del sistema).
 *
 *   1–4 → ×1 · 5–9 → ×1,2 · 10–14 → ×1,4 · 15–19 → ×1,6 · 20–24 → ×1,8
 *   25–34 → ×2,0 · 35–44 → ×2,1 · … · 95+ → ×2,7
 */
export function kilianMultiplier(streak: number): number {
  if (streak < 5) return 1;
  if (streak < 10) return 1.2;
  if (streak < 15) return 1.4;
  if (streak < 20) return 1.6;
  if (streak < 25) return 1.8;
  const grown = 2 + 0.1 * Math.floor((streak - 25) / 10);
  return Math.min(KILIAN_MULTIPLIER_CAP, grown);
}

/**
 * Punts base: la barra ÉS la puntuació. Lineal de 100 a 0 en 5 s (80 punts
 * al segon), arrodonit a múltiples de 5 per llegir-se de cop.
 */
export function kilianBasePoints(elapsedMs: number): number {
  const t = Math.min(Math.max(elapsedMs, 0), KILIAN_BAR_MS);
  const raw = KILIAN_POINTS_MAX * (1 - t / KILIAN_BAR_MS);
  return Math.max(0, Math.round(raw / 5) * 5);
}

/** Punts totals d'un encert: base per la velocitat × multiplicador de ratxa. */
export function kilianHitPoints(elapsedMs: number, streakAfter: number): number {
  const raw = kilianBasePoints(elapsedMs) * kilianMultiplier(streakAfter);
  return Math.round(raw / 5) * 5;
}

/** Una fila mínima per recórrer ratxes (del servidor o de la simulació). */
export interface KillianRow {
  isCorrect: boolean;
  kind: KillianKind;
}

/**
 * Ratxa vigent ABANS de la posició següent: quants encerts consecutius
 * ("answer" correctes) tanquen la seqüència. Un timeout trenca com un error.
 */
export function currentStreak(rows: KillianRow[]): number {
  let s = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].kind === "answer" && rows[i].isCorrect) s++;
    else break;
  }
  return s;
}

/** Fila completa amb la informació d'ítem i puntuació ja aplicada. */
export interface KillianScoredRow extends KillianRow {
  isWord?: boolean;
  points?: number | null;
  /** Encert per sota del llindar de RT: compta com a encert jutjat però NO
   *  puntua ni construeix ratxa (mateixa semàntica que el servidor). */
  tooFast?: boolean;
}

/** Resultat agregat d'una partida Kiliana completa (100 respostes). */
export interface ComputedKillianResult {
  nResponses: number;
  nCorrect: number;
  nFalseAlarms: number;
  nTimeouts: number;
  nMisses: number;
  score: number;
  bestStreak: number;
  maxMultiplier: number;
}

/**
 * Agregació determinista des de les files ordenades per posició. Els errors
 * pesen exactament igual entre ells (cap asimetria de falsa alarma: decisió
 * Roger 24/08/2026); el banc 66/34 és el que protegeix del conservadorisme.
 * El timeout no és un judici: puntua zero i trenca la ratxa com un error.
 */
export function computeKillianResult(rows: KillianScoredRow[]): ComputedKillianResult {
  let nCorrect = 0, nFalseAlarms = 0, nTimeouts = 0, nMisses = 0, score = 0;
  let bestStreak = 0, maxMultiplier = 1, streak = 0;
  for (const r of rows) {
    if (r.kind === "timeout") {
      nTimeouts++;
      streak = 0;
      continue;
    }
    if (!r.isCorrect) {
      if (r.isWord === true) nMisses++;
      else if (r.isWord === false) nFalseAlarms++;
      streak = 0;
      continue;
    }
    // Encert jutjat: compta sempre (el judici era correcte), però només
    // construeix ratxa i punts si no ha estat massa ràpid.
    nCorrect++;
    if (r.tooFast) {
      streak = 0;
      continue;
    }
    score += r.points ?? 0;
    streak++;
    if (streak > bestStreak) bestStreak = streak;
    maxMultiplier = Math.max(maxMultiplier, kilianMultiplier(streak));
  }
  return {
    nResponses: rows.length,
    nCorrect,
    nFalseAlarms,
    nTimeouts,
    nMisses,
    score,
    bestStreak,
    maxMultiplier,
  };
}

