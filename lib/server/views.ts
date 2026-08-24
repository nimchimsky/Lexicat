// Consultes de lectura per a la pantalla de resultats, rànquings i perfil.
// is_word només es revela quan la resposta ja està registrada (§9).

import { query } from "./db";
import { HttpError } from "./http";
import { loadBank } from "./bank";
import { displayItemScore, pAssignedToCorrect } from "../psychometrics/scoring";
import { SCORE_K, SCORING_EPSILON } from "../config";

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
// ---------------------------------------------------------------------------

export interface RankingRow {
  nickname: string | null;
  value: number;
  detail?: string;
}

/** Fragment compartit d'eligibilitat de taulers. ÚNICA font: si canvien les
 *  regles de validesa (flags de qualitat, jugadors esborrats), canvien aquí
 *  per a totes les taules. recomputeStandings (lib/server/game.ts) aplica el
 *  mateix predicat sobre games — mantén-los alineats. */
const ELIGIBLE_GAME_SQL = `g.status = 'completed' AND g.quality_flag IS NULL`;

const BOARD_FILTER = `
  FROM games g
  JOIN players p ON p.id = g.player_id
  JOIN game_results gr ON gr.game_id = g.id
  WHERE ${ELIGIBLE_GAME_SQL} AND p.deleted_at IS NULL
    AND g.mode = 'pompeu'`;

export interface KilianRankingRow {
  nickname: string | null;
  score: number;
  bestStreak: number;
  maxMultiplier: number;
}

/**
 * Millor partida Kiliana per jugador, ordenada per punts (rànquings separats
 * per mode). El DISTINCT ON viu en una subconsulta SENSE límit i el top-N se
 * aplica després, ja ordenat per punts: limitar abans retallaria un subconjunt
 * arbitrari de jugadors (ordenats per UUID) i podria ometre els líders reals.
 */
export async function getKilianRankings(): Promise<KilianRankingRow[]> {
  const res = await query<{
    nickname: string | null; score: number; best_streak: number | null; max_multiplier: number | null;
  }>(
    `SELECT nickname, score, best_streak, max_multiplier
     FROM (
       SELECT DISTINCT ON (g.player_id)
              p.nickname, gr.score::int AS score,
              gr.best_streak::int AS best_streak,
              gr.max_multiplier::float AS max_multiplier
       FROM games g
       JOIN players p ON p.id = g.player_id
       JOIN game_results gr ON gr.game_id = g.id
       WHERE ${ELIGIBLE_GAME_SQL} AND p.deleted_at IS NULL AND g.mode = 'killian'
       ORDER BY g.player_id, gr.score DESC, g.finished_at ASC
     ) best
     ORDER BY score DESC
     LIMIT 50`,
  );
  return res.rows.map((r) => ({
    nickname: r.nickname,
    score: Number(r.score),
    bestStreak: r.best_streak ?? 0,
    maxMultiplier: r.max_multiplier ?? 1,
  }));
}

export async function getRankings() {
  const [bestHits, bestLex, generalHits, generalLex] = await Promise.all([
    query<{ nickname: string | null; value: number; game_id: string }>(
      `SELECT p.nickname, gr.n_correct::float AS value, g.id AS game_id ${BOARD_FILTER}
       ORDER BY gr.n_correct DESC, g.finished_at ASC LIMIT 50`
    ),
    query<{ nickname: string | null; value: number }>(
      `SELECT p.nickname, gr.lexicon_game_score::float AS value ${BOARD_FILTER}
       ORDER BY gr.lexicon_game_score DESC, g.finished_at ASC LIMIT 50`
    ),
    query<{ nickname: string | null; mean_hits: number; n_games: number }>(
      `SELECT p.nickname, ps.mean_hits::float AS mean_hits, ps.n_games
       FROM player_standings ps JOIN players p ON p.id = ps.player_id
       WHERE p.deleted_at IS NULL AND ps.n_games > 0
       ORDER BY ps.mean_hits DESC LIMIT 50`
    ),
    query<{ nickname: string | null; pct: number; lo: number; hi: number; n_games: number; percentile: number }>(
      `SELECT p.nickname, ps.pct_lexicon::float AS pct, ps.pct_lo::float AS lo,
              ps.pct_hi::float AS hi, ps.n_games, ps.percentile_pooled::float AS percentile
       FROM player_standings ps JOIN players p ON p.id = ps.player_id
       WHERE p.deleted_at IS NULL AND ps.n_games > 0
       ORDER BY ps.pct_lexicon DESC LIMIT 50`
    ),
  ]);

  return {
    individualHits: bestHits.rows.map((r) => ({
      nickname: r.nickname, value: r.value, detail: undefined,
    })),
    individualLexicon: bestLex.rows.map((r) => ({ nickname: r.nickname, value: r.value })),
    generalHits: generalHits.rows.map((r) => ({
      nickname: r.nickname, value: r.mean_hits, detail: `${r.n_games}/5 partides`,
    })),
    generalLexicon: generalLex.rows.map((r) => ({
      nickname: r.nickname, value: r.pct,
      detail: `${r.n_games}/5 · IC95 ${r.lo.toFixed(1)}–${r.hi.toFixed(1)}%`,
    })),
  };
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

