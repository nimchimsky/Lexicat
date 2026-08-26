// Consultes de lectura per a la pantalla de resultats, rànquings i perfil.
// is_word només es revela quan la resposta ja està registrada (§9).

import { unstable_cache } from "next/cache";
import { query } from "./db";
import { HttpError } from "./http";
import { loadBank } from "./bank";
import { displayItemScore, pAssignedToCorrect } from "../psychometrics/scoring";
import { SCORE_K, SCORING_EPSILON } from "../config";
import { getPlayerProfile, type PlayerProfile } from "./profile";

export interface ResultItemRow {
  position: number;
  stimulus: string;
  /** NULL només als timeouts del mode Killian (no és cap judici de confiança). */
  confidence: number | null;
  isWord: boolean;
  isCorrect: boolean;
  fiftyFifty: boolean;
  responseTimeMs: number | null;
  diecUrl: string;
  /** Punts Pompeu (regla ε/K) o punts Kilian emmagatzemats, segons el mode. */
  points: number;
  /** Només killian. */
  kind?: "answer" | "timeout";
  elapsedMs?: number | null;
}

export interface KilianGameSummary {
  score: number;
  bestStreak: number;
  maxMultiplier: number;
  nTimeouts: number;
  medianElapsedMs: number | null;
  fastest: { stimulus: string; elapsedMs: number } | null;
}

export interface GameResultsView {
  gameId: string;
  finishedAt: string | null;
  qualityFlag: string | null;
  mode: "pompeu" | "killian";
  summary: {
    nCorrect: number;
    totalItems: number;
    pctLexicon: number;
    pctLo: number;
    pctHi: number;
    percentile: number;
    dPrime: number;
    criterion: number;
    dPrimeCeiling: number;
    nFalseAlarms: number;
    nFiftyFifty: number;
    score: number;
    theta: number;
    seTheta: number;
  };
  /** §7.2: paraules reals marcades com a inexistents, per confiança de l'error desc. */
  discoveries: ResultItemRow[];
  /** §7.3: pseudoparaules acceptades. */
  falseAlarms: ResultItemRow[];
  /** §7.4: la resta, sense ordre especial. */
  rest: ResultItemRow[];
  referenceCorpusVersion: string;
  /** Només mode killian. */
  kilian?: KilianGameSummary;
}

export function diecUrl(form: string): string {
  return `https://dlc.iec.cat/results.asp?txtentrada=${encodeURIComponent(form)}`;
}

export async function getGameResultsView(gameId: string, playerId: string): Promise<GameResultsView> {
  const gameRes = await query<{
    player_id: string; status: string; finished_at: Date | null; quality_flag: string | null;
    reference_corpus_version: string; mode: "pompeu" | "killian";
  }>(
    `SELECT player_id, status, finished_at, quality_flag, reference_corpus_version, mode
     FROM games WHERE id = $1`,
    [gameId]
  );
  if (gameRes.rowCount === 0) throw new HttpError(404, "Partida no trobada");
  const g = gameRes.rows[0];
  if (g.player_id !== playerId) throw new HttpError(403, "Partida d'un altre jugador");
  if (g.status !== "completed") throw new HttpError(409, "La partida encara no s'ha acabat");

  const rowsRes = await query<{
    position: number; form: string; confidence: number | null; is_word: boolean;
    is_correct: boolean; fifty_fifty: boolean; response_time_ms: number | null;
    points: number | null; response_kind: string | null; elapsed_ms: number | null;
    b: number;
  }>(
    `SELECT gi.position, i.form, resp.confidence, resp.is_word, resp.is_correct,
            resp.fifty_fifty, resp.response_time_ms, resp.points, resp.response_kind,
            resp.elapsed_ms, i.b
     FROM responses resp
     JOIN game_items gi ON gi.game_id = resp.game_id AND gi.item_id = resp.item_id
     JOIN items i ON i.item_id = resp.item_id
     WHERE resp.game_id = $1
     ORDER BY gi.position`,
    [gameId]
  );

  if (g.mode === "killian") return kilianResultsView(g, gameId, rowsRes.rows);
  return pompeuResultsView(g, gameId, rowsRes.rows);
}

function baseRows(
  rows: Array<{
    position: number; form: string; confidence: number | null; is_word: boolean;
    is_correct: boolean; fifty_fifty: boolean; response_time_ms: number | null;
    points: number | null; response_kind: string | null; elapsed_ms: number | null;
    b: number;
  }>
): ResultItemRow[] {
  return rows.map((it) => ({
    position: it.position,
    stimulus: it.form,
    confidence: it.confidence,
    isWord: it.is_word,
    isCorrect: it.is_correct,
    fiftyFifty: it.fifty_fifty,
    responseTimeMs: it.response_time_ms,
    diecUrl: diecUrl(it.form),
    points: it.points ?? 0,
    kind: (it.response_kind as "answer" | "timeout" | null) ?? undefined,
    elapsedMs: it.elapsed_ms,
  }));
}

async function pompeuResultsView(
  g: { finished_at: Date | null; quality_flag: string | null; reference_corpus_version: string },
  gameId: string,
  rawRows: Array<{
    position: number; form: string; confidence: number | null; is_word: boolean;
    is_correct: boolean; fifty_fifty: boolean; response_time_ms: number | null;
    points: number | null; response_kind: string | null; elapsed_ms: number | null;
    b: number;
  }>
): Promise<GameResultsView> {
  const resRes = await query<{
    theta: number; se_theta: number; pct_lexicon: number; pct_lo: number; pct_hi: number;
    percentile: number; d_prime: number; criterion: number; n_correct: number;
    n_false_alarms: number; n_fifty_fifty: number; score: number; n_responses: number;
  }>(
    `SELECT theta, se_theta, se_total, pct_lexicon, pct_lo, pct_hi, percentile,
            d_prime, criterion, n_correct, n_false_alarms, n_fifty_fifty, score, n_responses
     FROM game_results WHERE game_id = $1`,
    [gameId]
  );
  if (resRes.rowCount === 0) throw new HttpError(409, "Resultats no calculats");
  const r = resRes.rows[0];

  const { range } = await loadBank();
  // Pompeu recalcula sempre els punts amb la regla ε/K (mai confia en la
  // columna emmagatzemada, que és de Kilian); Kilian fa servir els seus.
  const rows: ResultItemRow[] = rawRows.map((it) => ({
    position: it.position,
    stimulus: it.form,
    confidence: it.confidence,
    isWord: it.is_word,
    isCorrect: it.is_correct,
    fiftyFifty: it.fifty_fifty,
    responseTimeMs: it.response_time_ms,
    diecUrl: diecUrl(it.form),
    points: displayItemScore(
      pAssignedToCorrect(it.confidence ?? 0.5, it.is_word),
      it.b,
      range.bMin,
      range.bMax,
      SCORING_EPSILON,
      SCORE_K
    ),
  }));

  // Descobertes: paraules reals dites "no", ordenades per confiança de l'error descendent.
  const discoveries = rows
    .filter((x) => x.isWord && !x.isCorrect)
    .sort((a, b) => (a.confidence ?? 0.5) - (b.confidence ?? 0.5) || a.position - b.position);
  const falseAlarms = rows.filter((x) => !x.isWord && !x.isCorrect);
  const rest = rows.filter((x) => x.isCorrect);

  return {
    gameId,
    finishedAt: g.finished_at ? new Date(g.finished_at).toISOString() : null,
    qualityFlag: g.quality_flag,
    mode: "pompeu",
    summary: {
      nCorrect: r.n_correct,
      totalItems: r.n_responses,
      pctLexicon: r.pct_lexicon,
      pctLo: r.pct_lo,
      pctHi: r.pct_hi,
      percentile: r.percentile,
      dPrime: r.d_prime,
      criterion: r.criterion,
      dPrimeCeiling: 4.62,
      nFalseAlarms: r.n_false_alarms,
      nFiftyFifty: r.n_fifty_fifty,
      score: r.score,
      theta: r.theta,
      seTheta: r.se_theta,
    },
    discoveries,
    falseAlarms,
    rest,
    referenceCorpusVersion: g.reference_corpus_version,
  };
}

async function kilianResultsView(
  g: { finished_at: Date | null; quality_flag: string | null; reference_corpus_version: string },
  gameId: string,
  rawRows: Array<{
    position: number; form: string; confidence: number | null; is_word: boolean;
    is_correct: boolean; fifty_fifty: boolean; response_time_ms: number | null;
    points: number | null; response_kind: string | null; elapsed_ms: number | null;
    b: number;
  }>
): Promise<GameResultsView> {
  const resRes = await query<{
    n_responses: number; n_correct: number; n_false_alarms: number; score: number;
    best_streak: number | null; max_multiplier: number | null; n_timeouts: number | null;
  }>(
    `SELECT n_responses, n_correct, n_false_alarms, score,
            best_streak, max_multiplier::float AS max_multiplier, n_timeouts
     FROM game_results WHERE game_id = $1`,
    [gameId]
  );
  if (resRes.rowCount === 0) throw new HttpError(409, "Resultats no calculats");
  const r = resRes.rows[0];

  const rows = baseRows(rawRows);
  const discoveries = rows
    .filter((x) => x.isWord && !x.isCorrect && x.kind !== "timeout")
    .sort((a, b) => (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0) || a.position - b.position);
  const falseAlarms = rows.filter((x) => !x.isWord && !x.isCorrect && x.kind !== "timeout");
  const timeouts = rows.filter((x) => x.kind === "timeout");
  const hits = rows.filter((x) => x.isCorrect);

  const elapsedList = hits
    .map((x) => x.elapsedMs ?? 0)
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  const medianElapsed =
    elapsedList.length > 0
      ? elapsedList[Math.floor((elapsedList.length - 1) / 2)]
      : null;
  let fastest: KilianGameSummary["fastest"] = null;
  for (const x of hits) {
    if (x.elapsedMs != null && x.kind !== "timeout" && (!fastest || x.elapsedMs < fastest.elapsedMs)) {
      fastest = { stimulus: x.stimulus, elapsedMs: x.elapsedMs };
    }
  }

  return {
    gameId,
    finishedAt: g.finished_at ? new Date(g.finished_at).toISOString() : null,
    qualityFlag: g.quality_flag,
    mode: "killian",
    summary: {
      nCorrect: r.n_correct,
      totalItems: r.n_responses,
      pctLexicon: 0,
      pctLo: 0,
      pctHi: 0,
      percentile: 0,
      dPrime: 0,
      criterion: 0,
      dPrimeCeiling: 0,
      nFalseAlarms: r.n_false_alarms,
      nFiftyFifty: 0,
      score: r.score,
      theta: 0,
      seTheta: 0,
    },
    discoveries,
    falseAlarms,
    rest: [...hits, ...timeouts].sort((a, b) => a.position - b.position),
    referenceCorpusVersion: g.reference_corpus_version,
    kilian: {
      score: r.score,
      bestStreak: r.best_streak ?? 0,
      maxMultiplier: r.max_multiplier ?? 1,
      nTimeouts: r.n_timeouts ?? 0,
      medianElapsedMs: medianElapsed,
      fastest,
    },
  };
}

// ---------------------------------------------------------------------------
// Rànquings
//
// Disseny de la revisió UX (25/08/2026): cada tauler mostra el TOP 10 amb UN
// jugador per classificació (millor registre de cadascú) i, si el jugador que
// consulta no hi surt, la seva fila «La teva posició» a part. Les altres
// classificacions queden dins «Més rànquings» a la UI.
// ---------------------------------------------------------------------------

/** Mida dels taulers visibles per defecte. */
export const RANKING_TOP_N = 10;

export interface RankingRow {
  /** Posició real dins la classificació sencera (no la del top retallat). */
  rank: number;
  nickname: string | null;
  value: number;
  detail?: string;
  isMe?: boolean;
}

/** Fragment compartit d'eligibilitat de taulers. ÚNICA font: si canvien les
 *  regles de validesa (flags de qualitat, jugadors esborrats), canvien aquí
 *  per a totes les taules. recomputeStandings (lib/server/game.ts) aplica el
 *  mateix predicat sobre games — mantén-los alineats. */
const ELIGIBLE_GAME_SQL = `g.status = 'completed' AND g.quality_flag IS NULL`;

// ---------------------------------------------------------------------------
// Caché dels taulers públics. El top N no depèn de qui consulta: es pot
// servir de caché compartida (60 s) i la fila «la teva posició» es resol
// a part, sense caché, només quan el jugador no surt al top.
// ---------------------------------------------------------------------------

const RANKINGS_REVALIDATE_S = 60;
/** Clau de versió: bumpa-la per invalidar tots els taulers en un deploy. */
const RANKINGS_CACHE_VERSION = "v2";

/**
 * Caché de tauler públic. Fora de l'entorn Next (tests d'integració, scripts)
 * `unstable_cache` pot no estar disponible: la caché és una optimització, mai
 * un requisit — cau al directe.
 */
async function withBoardCache<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const cached = unstable_cache(
      fn,
      ["ranquings", RANKINGS_CACHE_VERSION, name],
      { revalidate: RANKINGS_REVALIDATE_S }
    );
    return await cached();
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[views] caché de rànquings no disponible (${name}):`, e);
    }
    return fn();
  }
}

interface BoardRowInternal {
  player_id: string;
  nickname: string | null;
  value: number;
}

/**
 * Files del tauler de millors partides Pompeu (UNA fila per jugador, el seu
 * millor registre) ordenades sobre TOTA la població. Desempat determinista:
 * mateix valor guanya qui el va assolir ABANS (finished_at ASC) i, com a
 * últim recurs, player_id — sense això les posicions ballen entre peticions.
 * El DISTINCT ON viu en una subconsulta SENSE límit i el top-N s'aplica
 * després, ja ordenat: limitar abans retallaria un subconjunt arbitrari de
 * jugadors (ordenats per UUID) i podria ometre els líders reals.
 */
async function bestGameBoardRows(column: "n_correct" | "lexicon_game_score"): Promise<BoardRowInternal[]> {
  const res = await query<BoardRowInternal>(
    `SELECT b.player_id, p.nickname, b.value::float AS value
     FROM (
       SELECT DISTINCT ON (g.player_id)
              g.player_id,
              gr.${column} AS value,
              g.finished_at,
              g.id AS game_id
       FROM games g
       JOIN players p ON p.id = g.player_id
       JOIN game_results gr ON gr.game_id = g.id
       WHERE ${ELIGIBLE_GAME_SQL} AND p.deleted_at IS NULL AND g.mode = 'pompeu'
       ORDER BY g.player_id, gr.${column} DESC, g.finished_at ASC, g.id ASC
     ) b
     JOIN players p ON p.id = b.player_id
     ORDER BY b.value DESC, b.finished_at ASC, b.player_id ASC
     LIMIT ${RANKING_TOP_N}`
  );
  return res.rows;
}

/** Fila «la teva posició» del tauler de millors partides, amb el rang comptat
 *  sobre tota la població i els MATEIXOS desempats que el tauler visible. */
async function bestGameSelfRow(
  playerId: string,
  column: "n_correct" | "lexicon_game_score"
): Promise<(BoardRowInternal & { rank: number }) | null> {
  const res = await query<{ player_id: string; nickname: string | null; value: number; rank: number }>(
    `WITH best AS (
       SELECT DISTINCT ON (g.player_id)
              g.player_id, gr.${column} AS value, g.finished_at, g.id AS game_id
       FROM games g
       JOIN players p ON p.id = g.player_id
       JOIN game_results gr ON gr.game_id = g.id
       WHERE ${ELIGIBLE_GAME_SQL} AND p.deleted_at IS NULL AND g.mode = 'pompeu'
       ORDER BY g.player_id, gr.${column} DESC, g.finished_at ASC, g.id ASC
     )
     SELECT m.player_id, p.nickname, m.value::float AS value,
            (SELECT COUNT(*) + 1 FROM best o
             WHERE o.value > m.value
                OR (o.value = m.value
                    AND (o.finished_at, o.player_id) < (m.finished_at, m.player_id))
            )::int AS rank
     FROM best m
     JOIN players p ON p.id = m.player_id
     WHERE m.player_id = $1`,
    [playerId]
  );
  return res.rows[0] ?? null;
}

export interface KilianRankingRow {
  /** Posició real dins la classificació sencera. */
  rank: number;
  nickname: string | null;
  score: number;
  bestStreak: number;
  maxMultiplier: number;
  isMe?: boolean;
}

interface KilianBoardRowInternal {
  player_id: string;
  nickname: string | null;
  score: number;
  best_streak: number | null;
  max_multiplier: number | null;
}

/** Files públiques del tauler Kilian: millor partida per jugador, per punts. */
async function kilianBoardRows(): Promise<KilianBoardRowInternal[]> {
  const res = await query<KilianBoardRowInternal>(
    `SELECT best.player_id, p.nickname, best.score::int AS score,
            best.best_streak::int AS best_streak,
            best.max_multiplier::float AS max_multiplier
     FROM (
       SELECT DISTINCT ON (g.player_id)
              g.player_id, gr.score, gr.best_streak, gr.max_multiplier,
              g.finished_at, g.id AS game_id
       FROM games g
       JOIN players p ON p.id = g.player_id
       JOIN game_results gr ON gr.game_id = g.id
       WHERE ${ELIGIBLE_GAME_SQL} AND p.deleted_at IS NULL AND g.mode = 'killian'
       ORDER BY g.player_id, gr.score DESC, g.finished_at ASC, g.id ASC
     ) best
     JOIN players p ON p.id = best.player_id
     ORDER BY best.score DESC, best.finished_at ASC, best.player_id ASC
     LIMIT ${RANKING_TOP_N}`
  );
  return res.rows;
}

/** Fila «la teva posició» Kilian, mateixos desempats que el tauler. */
async function kilianSelfRow(
  playerId: string
): Promise<(KilianBoardRowInternal & { rank: number }) | null> {
  const res = await query<{
    player_id: string; nickname: string | null; score: number;
    best_streak: number | null; max_multiplier: number | null; rank: number;
  }>(
    `WITH best AS (
       SELECT DISTINCT ON (g.player_id)
              g.player_id, gr.score, gr.best_streak, gr.max_multiplier,
              g.finished_at, g.id AS game_id
       FROM games g
       JOIN players p ON p.id = g.player_id
       JOIN game_results gr ON gr.game_id = g.id
       WHERE ${ELIGIBLE_GAME_SQL} AND p.deleted_at IS NULL AND g.mode = 'killian'
       ORDER BY g.player_id, gr.score DESC, g.finished_at ASC, g.id ASC
     )
     SELECT m.player_id, p.nickname, m.score::int AS score,
            m.best_streak::int AS best_streak,
            m.max_multiplier::float AS max_multiplier,
            (SELECT COUNT(*) + 1 FROM best o
             WHERE o.score > m.score
                OR (o.score = m.score
                    AND (o.finished_at, o.player_id) < (m.finished_at, m.player_id))
            )::int AS rank
     FROM best m
     JOIN players p ON p.id = m.player_id
     WHERE m.player_id = $1`,
    [playerId]
  );
  return res.rows[0] ?? null;
}

/**
 * Millor partida Kiliana per jugador, ordenada per punts (rànquings separats
 * per mode), amb el mateix contracte top-N + «la teva posició». El tauler
 * públic ve de caché; la fila pròpia, si cal, es resol a part.
 */
export async function getKilianRankings(
  playerId?: string | null
): Promise<KilianRankingRow[]> {
  const rows = await withBoardCache("killian", kilianBoardRows);
  const mapped: KilianRankingRow[] = rows.map((r, i) => ({
    rank: i + 1,
    nickname: r.nickname,
    score: Number(r.score),
    bestStreak: r.best_streak ?? 0,
    maxMultiplier: r.max_multiplier ?? 1,
    isMe: playerId != null && r.player_id === playerId,
  }));
  if (playerId && !mapped.some((r) => r.isMe)) {
    const mine = await kilianSelfRow(playerId);
    if (mine) {
      mapped.push({
        rank: Number(mine.rank),
        nickname: mine.nickname,
        score: Number(mine.score),
        bestStreak: mine.best_streak ?? 0,
        maxMultiplier: mine.max_multiplier ?? 1,
        isMe: true,
      });
    }
  }
  return mapped;
}

interface StandingRowInternal extends BoardRowInternal {
  n_games: number;
  lo: number;
  hi: number;
}

/** Tauler general (player_standings): una fila per jugador de naixement. */
async function standingBoardRows(column: "mean_hits" | "pct_lexicon"): Promise<StandingRowInternal[]> {
  const res = await query<StandingRowInternal>(
    `SELECT ps.player_id, p.nickname,
            ps.${column}::float AS value,
            ps.pct_lo::float AS lo, ps.pct_hi::float AS hi,
            ps.n_games
     FROM player_standings ps
     JOIN players p ON p.id = ps.player_id
     WHERE p.deleted_at IS NULL AND ps.n_games > 0
     ORDER BY ps.${column} DESC, ps.player_id ASC
     LIMIT ${RANKING_TOP_N}`
  );
  return res.rows;
}

/** Fila «la teva posició» del tauler general, mateixos desempats. */
async function standingSelfRow(
  playerId: string,
  column: "mean_hits" | "pct_lexicon"
): Promise<(StandingRowInternal & { rank: number }) | null> {
  const res = await query<{
    player_id: string; nickname: string | null; value: number;
    lo: number; hi: number; n_games: number; rank: number;
  }>(
    `SELECT m.player_id, p.nickname,
            m.${column}::float AS value,
            m.pct_lo::float AS lo, m.pct_hi::float AS hi, m.n_games,
            (SELECT COUNT(*) + 1
             FROM player_standings o
             JOIN players op ON op.id = o.player_id
             WHERE op.deleted_at IS NULL AND o.n_games > 0
               AND (o.${column} > m.${column}
                    OR (o.${column} = m.${column} AND o.player_id < m.player_id))
            )::int AS rank
     FROM player_standings m
     JOIN players p ON p.id = m.player_id
     WHERE m.player_id = $1 AND m.n_games > 0`,
    [playerId]
  );
  return res.rows[0] ?? null;
}

export async function getRankings(playerId?: string | null) {
  // Dubte 6 tancat (25/08/2026): «millor partida · lexicó» fora (correlacionava
  // 0,997 amb «encerts»: eren dos taulers per a una sola cosa). El lexicó
  // ponderat queda NOMÉS al rànquing general, on diferenciar té sentit.
  const [rawHits, rawGeneralHits, rawGeneralPct] = await Promise.all([
    withBoardCache("best-hits", () => bestGameBoardRows("n_correct")),
    withBoardCache("general-hits", () => standingBoardRows("mean_hits")),
    withBoardCache("general-pct", () => standingBoardRows("pct_lexicon")),
  ]);

  const hitsDetail = (r: StandingRowInternal) => `${r.n_games}/5 partides`;
  const pctDetail = (r: StandingRowInternal) =>
    `${r.n_games}/5 · IC95 ${Number(r.lo).toFixed(1)}–${Number(r.hi).toFixed(1)}%`;

  const toRows = (
    rows: BoardRowInternal[],
    detailOf?: (r: StandingRowInternal) => string
  ): RankingRow[] =>
    rows.map((r, i) => ({
      rank: i + 1,
      nickname: r.nickname,
      value: Number(r.value),
      detail: detailOf?.(r as StandingRowInternal),
      isMe: playerId != null && r.player_id === playerId,
    }));

  const individualHits = toRows(rawHits);
  const generalHits = toRows(rawGeneralHits, hitsDetail);
  const generalLexiconRows = toRows(rawGeneralPct, pctDetail);

  // «La teva posició»: si el jugador no surt al top N, es resol a part
  // (sense caché, amb els mateixos desempats que el tauler visible).
  if (playerId) {
    if (!individualHits.some((r) => r.isMe)) {
      const mine = await bestGameSelfRow(playerId, "n_correct");
      if (mine) {
        individualHits.push({
          rank: Number(mine.rank),
          nickname: mine.nickname,
          value: Number(mine.value),
          isMe: true,
        });
      }
    }
    if (!generalHits.some((r) => r.isMe)) {
      const mine = await standingSelfRow(playerId, "mean_hits");
      if (mine) {
        generalHits.push({
          rank: Number(mine.rank),
          nickname: mine.nickname,
          value: Number(mine.value),
          detail: hitsDetail(mine),
          isMe: true,
        });
      }
    }
    if (!generalLexiconRows.some((r) => r.isMe)) {
      const mine = await standingSelfRow(playerId, "pct_lexicon");
      if (mine) {
        generalLexiconRows.push({
          rank: Number(mine.rank),
          nickname: mine.nickname,
          value: Number(mine.value),
          detail: pctDetail(mine),
          isMe: true,
        });
      }
    }
  }

  return { individualHits, generalHits, generalLexicon: generalLexiconRows };
}

/** Hi ha alguna partida completada d'aquest mode? (per al tutorial de Kilian) */
export async function hasCompletedGames(playerId: string, mode: "pompeu" | "killian" = "killian"): Promise<boolean> {
  const res = await query<{ n: string }>(
    `SELECT 1 AS n FROM games
     WHERE player_id = $1 AND mode = $2 AND status = 'completed'
     LIMIT 1`,
    [playerId, mode]
  );
  return res.rowCount !== 0;
}

export async function getPlayerSummary(playerId: string) {
  const counts = await query<{ total: string; completed: string }>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'completed') AS completed
     FROM games WHERE player_id = $1`,
    [playerId]
  );
  const standing = await query<{
    mean_hits: number; pct_lexicon: number; pct_lo: number; pct_hi: number;
    n_games: number; percentile_pooled: number;
  }>(
    `SELECT mean_hits, pct_lexicon, pct_lo, pct_hi, n_games, percentile_pooled
     FROM player_standings WHERE player_id = $1`,
    [playerId]
  );
  return {
    gamesStarted: Number(counts.rows[0].total),
    gamesCompleted: Number(counts.rows[0].completed),
    standing: standing.rows[0]
      ? {
          meanHits: standing.rows[0].mean_hits,
          pctLexicon: standing.rows[0].pct_lexicon,
          pctLo: standing.rows[0].pct_lo,
          pctHi: standing.rows[0].pct_hi,
          nGames: standing.rows[0].n_games,
          percentile: standing.rows[0].percentile_pooled,
        }
      : null,
  };
}

export interface ProfileModeStats {
  mode: "pompeu" | "killian";
  gamesStarted: number;
  gamesCompleted: number;
  meanHits: number | null;
  bestHits: number | null;
  meanScore: number | null;
  bestScore: number | null;
  bestStreak: number | null;
  pctLexicon: number | null;
  pctLo: number | null;
  pctHi: number | null;
  percentile: number | null;
}

export interface ProfileRecentGame {
  gameId: string;
  mode: "pompeu" | "killian";
  status: "in_progress" | "completed" | "abandoned";
  startedAt: string;
  finishedAt: string | null;
  nCorrect: number | null;
  score: number | null;
  bestStreak: number | null;
}

export interface ProfileSeenItem {
  itemId: number;
  form: string;
  isWord: boolean;
  timesSeen: number;
  lastSeenAt: string;
}

export interface ProfileView {
  profile: PlayerProfile;
  stats: ProfileModeStats[];
  seenCounts: { words: number; pseudowords: number };
  seenItems: ProfileSeenItem[];
  seenKind: "word" | "pseudo";
  seenPage: number;
  seenPageCount: number;
  recentGames: ProfileRecentGame[];
}

/** Vista privada del perfil: les exposicions inclouen també ítems servits
 * abans d'arribar a registrar una resposta. */
export async function getProfileView(
  playerId: string,
  seenKind: "word" | "pseudo" = "word",
  seenPage = 1,
): Promise<ProfileView> {
  const pageSize = 80;
  const page = Math.max(1, Math.floor(seenPage));
  const [profile, statsRes, countsRes, seenItemsRes, seenTotalRes, recentRes] = await Promise.all([
    getPlayerProfile(playerId),
    query<{
      mode: "pompeu" | "killian";
      games_started: string;
      games_completed: string;
      mean_hits: number | null;
      best_hits: number | null;
      mean_score: number | null;
      best_score: number | null;
      best_streak: number | null;
      pct_lexicon: number | null;
      pct_lo: number | null;
      pct_hi: number | null;
      percentile: number | null;
    }>(
      `SELECT g.mode,
              COUNT(*)::int AS games_started,
              COUNT(*) FILTER (WHERE g.status = 'completed')::int AS games_completed,
              AVG(gr.n_correct) FILTER (WHERE g.status = 'completed' AND g.mode = 'pompeu')::float AS mean_hits,
              MAX(gr.n_correct) FILTER (WHERE g.status = 'completed' AND g.mode = 'pompeu')::int AS best_hits,
              AVG(gr.score) FILTER (WHERE g.status = 'completed')::float AS mean_score,
              MAX(gr.score) FILTER (WHERE g.status = 'completed')::int AS best_score,
              MAX(gr.best_streak) FILTER (WHERE g.status = 'completed' AND g.mode = 'killian')::int AS best_streak,
              MAX(ps.pct_lexicon)::float AS pct_lexicon,
              MAX(ps.pct_lo)::float AS pct_lo,
              MAX(ps.pct_hi)::float AS pct_hi,
              MAX(ps.percentile_pooled)::float AS percentile
       FROM games g
       LEFT JOIN game_results gr ON gr.game_id = g.id
       LEFT JOIN player_standings ps ON ps.player_id = g.player_id AND g.mode = 'pompeu'
       WHERE g.player_id = $1
       GROUP BY g.mode
       ORDER BY g.mode`,
      [playerId],
    ),
    query<{ words: string; pseudowords: string }>(
      `SELECT COUNT(*) FILTER (WHERE i.is_word)::int AS words,
              COUNT(*) FILTER (WHERE NOT i.is_word)::int AS pseudowords
       FROM item_exposure e JOIN items i ON i.item_id = e.item_id
       WHERE e.player_id = $1`,
      [playerId],
    ),
    query<{ item_id: number; form: string; is_word: boolean; times_seen: number; last_seen_at: Date }>(
      `SELECT e.item_id, i.form, i.is_word, e.times_seen, e.last_seen_at
       FROM item_exposure e JOIN items i ON i.item_id = e.item_id
       WHERE e.player_id = $1 AND i.is_word = $2
       ORDER BY lower(i.form), e.item_id
       LIMIT $3 OFFSET $4`,
      [playerId, seenKind === "word", pageSize, (page - 1) * pageSize],
    ),
    query<{ n: string }>(
      `SELECT COUNT(*) AS n
       FROM item_exposure e JOIN items i ON i.item_id = e.item_id
       WHERE e.player_id = $1 AND i.is_word = $2`,
      [playerId, seenKind === "word"],
    ),
    query<{
      id: string;
      mode: "pompeu" | "killian";
      status: "in_progress" | "completed" | "abandoned";
      started_at: Date;
      finished_at: Date | null;
      n_correct: number | null;
      score: number | null;
      best_streak: number | null;
    }>(
      `SELECT g.id, g.mode, g.status, g.started_at, g.finished_at,
              gr.n_correct, gr.score, gr.best_streak
       FROM games g
       LEFT JOIN game_results gr ON gr.game_id = g.id
       WHERE g.player_id = $1
       ORDER BY g.started_at DESC
       LIMIT 12`,
      [playerId],
    ),
  ]);

  const totalSeen = Number(seenTotalRes.rows[0]?.n ?? 0);
  return {
    profile,
    stats: statsRes.rows.map((r) => ({
      mode: r.mode,
      gamesStarted: Number(r.games_started),
      gamesCompleted: Number(r.games_completed),
      meanHits: r.mean_hits === null ? null : Number(r.mean_hits),
      bestHits: r.best_hits === null ? null : Number(r.best_hits),
      meanScore: r.mean_score === null ? null : Number(r.mean_score),
      bestScore: r.best_score === null ? null : Number(r.best_score),
      bestStreak: r.best_streak === null ? null : Number(r.best_streak),
      pctLexicon: r.pct_lexicon === null ? null : Number(r.pct_lexicon),
      pctLo: r.pct_lo === null ? null : Number(r.pct_lo),
      pctHi: r.pct_hi === null ? null : Number(r.pct_hi),
      percentile: r.percentile === null ? null : Number(r.percentile),
    })),
    seenCounts: {
      words: Number(countsRes.rows[0]?.words ?? 0),
      pseudowords: Number(countsRes.rows[0]?.pseudowords ?? 0),
    },
    seenItems: seenItemsRes.rows.map((r) => ({
      itemId: Number(r.item_id),
      form: r.form,
      isWord: r.is_word,
      timesSeen: Number(r.times_seen),
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
    })),
    seenKind,
    seenPage: page,
    seenPageCount: Math.max(1, Math.ceil(totalSeen / pageSize)),
    recentGames: recentRes.rows.map((r) => ({
      gameId: r.id,
      mode: r.mode,
      status: r.status,
      startedAt: new Date(r.started_at).toISOString(),
      finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
      nCorrect: r.n_correct === null ? null : Number(r.n_correct),
      score: r.score === null ? null : Number(r.score),
      bestStreak: r.best_streak === null ? null : Number(r.best_streak),
    })),
  };
}

// ---------------------------------------------------------------------------
// Embut de retenció (mètrica agregada, sense cap dada per persona)
//
// Tot es deriva de taules que ja existeixen: mai es registra res nou per
// mesurar l'embut (privadesa per disseny). Serveix per saber quantes
// partides s'arrenquen, quants jugadors arriben al primer ítem i quants
// acaben — el mínim per detectar una pèrdua grossa al principi del flux.
// ---------------------------------------------------------------------------

export interface Funnel {
  windowHours: number;
  gamesStarted: number;
  gamesWithFirstResponse: number;
  gamesCompleted: number;
}

export async function getFunnel(windowHours = 24 * 30): Promise<Funnel> {
  const res = await query<{
    started: string;
    with_first: string;
    completed: string;
  }>(
    `SELECT
       COUNT(*)::text AS started,
       COUNT(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM responses r WHERE r.game_id = g.id)
       )::text AS with_first,
       COUNT(*) FILTER (WHERE g.status = 'completed')::text AS completed
     FROM games g
     WHERE g.started_at > now() - make_interval(hours => $1)`,
    [windowHours]
  );
  const r = res.rows[0];
  return {
    windowHours,
    gamesStarted: Number(r.started),
    gamesWithFirstResponse: Number(r.with_first),
    gamesCompleted: Number(r.completed),
  };
}
