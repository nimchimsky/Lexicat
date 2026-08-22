// Lògica de partida al servidor. Tot el que el client no ha de saber mai
// (is_word, item_id abans de respondre, càlcul d'encert) passa aquí.

import crypto from "node:crypto";
import { query, getPool } from "./db";
import { loadBank } from "./bank";
import { selectGameItems, mulberry32, type ExposureMap } from "../game/selection";
import { computeGameResult } from "../game/results";
import type { ComputedGameResult } from "../game/results";
import type { GraduatedResponse, ItemParams } from "../psychometrics/types";
import { estimateAbility } from "../psychometrics/irt";
import { HttpError } from "./http";
import {
  VERSIONS,
  ACTIVE_RESPONSE_FORMAT,
  SLIDER_STEPS,
  COOLDOWN_GAMES,
  MIN_RT_MS,
  FAST_GUESS_GAME_RATIO,
  RANKING_WINDOW,
  ABANDON_AFTER_MS,
  INSTABILITY_SE,
} from "../config";

/** Marca com a abandonades (inactivitat) les partides in_progress molt velles. */
export async function sweepAbandonedGames(playerId?: string): Promise<void> {
  await query(
    `UPDATE games g
     SET status = 'abandoned', finished_at = now(), abandoned_reason = 'inactivitat',
         abandoned_at_position = COALESCE((SELECT MAX(position_in_game) FROM responses r WHERE r.game_id = g.id), 0)
     WHERE g.status = 'in_progress' AND g.started_at < now() - make_interval(secs => $1)
       AND ($2::uuid IS NULL OR g.player_id = $2)`,
    [ABANDON_AFTER_MS / 1000, playerId ?? null]
  );
}

export interface StartedGame {
  gameId: string;
  playerGameIndex: number;
}

export async function startGame(
  playerId: string,
  deviceClass: string | null
): Promise<StartedGame> {
  const bank = await loadBank();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    // Qualsevol partida anterior en curs queda abandonada en començar una de nova.
    const open = await client.query<{ id: string }>(
      `SELECT id FROM games WHERE player_id = $1 AND status = 'in_progress' FOR UPDATE`,
      [playerId]
    );
    for (const row of open.rows) {
      await client.query(
        `UPDATE games
         SET status = 'abandoned', finished_at = now(), abandoned_reason = 'usuari',
             abandoned_at_position = COALESCE((SELECT MAX(position_in_game) FROM responses r WHERE r.game_id = $1), 0)
         WHERE id = $1`,
        [row.id]
      );
    }

    const idxRes = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM games WHERE player_id = $1`,
      [playerId]
    );
    const playerGameIndex = Number(idxRes.rows[0].n) + 1;

    const expRes = await client.query<{ item_id: number; last_game_index: number }>(
      `SELECT item_id, last_game_index FROM item_exposure WHERE player_id = $1`,
      [playerId]
    );
    const exposures: ExposureMap = new Map(
      expRes.rows.map((r) => [r.item_id, r.last_game_index])
    );

    const seedHex = crypto.randomBytes(16).toString("hex");
    const rng = mulberry32(parseInt(seedHex.slice(0, 8), 16));

    const selectable = bank.items.filter((i) => i.active);
    const selection = selectGameItems(selectable, exposures, rng, playerGameIndex, COOLDOWN_GAMES);

    const gameId = crypto.randomUUID();
    await client.query(
      `INSERT INTO games (id, player_id, player_game_index, game_seed,
                          item_bank_version, reference_corpus_version, calibration_version,
                          scoring_version, response_format, slider_steps, device_class, relaxed_strata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        gameId,
        playerId,
        playerGameIndex,
        seedHex,
        VERSIONS.itemBank,
        VERSIONS.referenceCorpus,
        VERSIONS.calibration,
        VERSIONS.scoring,
        ACTIVE_RESPONSE_FORMAT,
        ACTIVE_RESPONSE_FORMAT === "slider" ? SLIDER_STEPS : null,
        deviceClass,
        JSON.stringify(selection.relaxedStrata),
      ]
    );

    // Composició sencera ABANS de servir el primer ítem (§8.3).
    const values: unknown[] = [gameId];
    const tuples = selection.ordered.map((it, i) => {
      const b = i * 3;
      values.push(it.itemId, it.isWord ? it.wordStratumId : it.pseudoStratumId, it.isWord);
      return `($1, ${i + 1}, $${b + 2}, $${b + 3}, $${b + 4})`;
    });
    await client.query(
      `INSERT INTO game_items (game_id, position, item_id, stratum_id, is_word)
       VALUES ${tuples.join(",")}`,
      values
    );

    if (selection.relaxedStrata.length > 0) {
      await client.query(
        `INSERT INTO selection_log (game_id, event, detail) VALUES ($1, 'relaxed_cooldown', $2)`,
        [gameId, JSON.stringify({ strata: selection.relaxedStrata })]
      );
    }

    await client.query("COMMIT");
    return { gameId, playerGameIndex };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export interface GameState {
  gameId: string;
  nextPosition: number;
  totalItems: number;
  responseFormat: string;
  sliderSteps: number | null;
}

export async function getOpenGame(playerId: string): Promise<GameState | null> {
  const res = await query<{
    id: string;
    response_format: string;
    slider_steps: number | null;
    answered: string;
  }>(
    `SELECT g.id, g.response_format, g.slider_steps,
            (SELECT COUNT(*) FROM responses r WHERE r.game_id = g.id) AS answered
     FROM games g
     WHERE g.player_id = $1 AND g.status = 'in_progress'
     ORDER BY g.started_at DESC LIMIT 1`,
    [playerId]
  );
  if (res.rowCount === 0) return null;
  const g = res.rows[0];
  return {
    gameId: g.id,
    nextPosition: Number(g.answered) + 1,
    totalItems: 100,
    responseFormat: g.response_format,
    sliderSteps: g.slider_steps,
  };
}

/**
 * Serveix l'estímul de la posició demanada. MAI conté is_word ni item_id:
 * només la forma en minúscules i la posició.
 */
export async function serveItem(
  playerId: string,
  gameId: string,
  position: number
): Promise<{ position: number; stimulus: string; totalItems: number }> {
  const g = await query<{ status: string; player_id: string }>(
    `SELECT status, player_id FROM games WHERE id = $1`,
    [gameId]
  );
  if (g.rowCount === 0) throw new HttpError(404, "Partida no trobada");
  if (g.rows[0].player_id !== playerId) throw new HttpError(403, "Partida d'un altre jugador");
  if (g.rows[0].status !== "in_progress") throw new HttpError(409, "La partida no està en curs");

  const item = await query<{ form: string }>(
    `SELECT i.form
     FROM game_items gi JOIN items i ON i.item_id = gi.item_id
     WHERE gi.game_id = $1 AND gi.position = $2`,
    [gameId, position]
  );
  if (item.rowCount === 0) throw new HttpError(404, "Posició no trobada");

  // L'exposició es registra quan es serveix: és el que sosté el refredament.
  const idx = await query<{ player_game_index: number }>(
    `SELECT player_game_index FROM games WHERE id = $1`,
    [gameId]
  );
  const itemIdRow = await query<{ item_id: number }>(
    `SELECT item_id FROM game_items WHERE game_id = $1 AND position = $2`,
    [gameId, position]
  );
  await query(
    `INSERT INTO item_exposure (player_id, item_id, last_game_id, last_game_index, times_seen)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (player_id, item_id) DO UPDATE
     SET last_game_id = EXCLUDED.last_game_id,
         last_game_index = EXCLUDED.last_game_index,
         last_seen_at = now(),
         times_seen = item_exposure.times_seen + 1`,
    [playerId, itemIdRow.rows[0].item_id, gameId, idx.rows[0].player_game_index]
  );

  return { position, stimulus: item.rows[0].form, totalItems: 100 };
}

export interface SubmittedResponse {
  duplicate: boolean;
  finished: boolean;
}

export async function submitResponse(
  playerId: string,
  input: {
    responseId: string;
    gameId: string;
    position: number;
    confidence: number;
    timeToFirstInputMs: number | null;
    responseTimeMs: number | null;
    nAdjustments: number | null;
  },
  deviceClass: string | null
): Promise<SubmittedResponse> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.responseId)) {
    throw new HttpError(400, "response_id invàlid");
  }
  if (!(input.confidence >= 0 && input.confidence <= 1)) {
    throw new HttpError(400, "confiança fora de [0,1]");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const g = await client.query<{
      id: string;
      player_id: string;
      status: string;
      player_game_index: number;
      response_format: string;
      slider_steps: number | null;
      device_class: string | null;
    }>(`SELECT id, player_id, status, player_game_index, response_format, slider_steps, device_class
        FROM games WHERE id = $1 FOR UPDATE`, [input.gameId]);
    if (g.rowCount === 0) throw new HttpError(404, "Partida no trobada");
    const game = g.rows[0];
    if (game.player_id !== playerId) throw new HttpError(403, "Partida d'un altre jugador");
    if (game.status !== "in_progress") throw new HttpError(409, "La partida ja s'ha tancat");

    // Idempotència (§8.5): un reenviament del MATEIX response_id surt exitós
    // sense crear cap fila nova, encara que la partida hagi avançat.
    const dupe = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM responses WHERE response_id = $1 AND game_id = $2`,
      [input.responseId, input.gameId]
    );
    if (Number(dupe.rows[0].n) > 0) {
      await client.query("COMMIT");
      return { duplicate: true, finished: false };
    }

    // Validació estricta d'ordre: la posició ha de ser exactament la següent.
    const countRes = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM responses WHERE game_id = $1`,
      [input.gameId]
    );
    const expected = Number(countRes.rows[0].n) + 1;
    if (input.position !== expected) {
      throw new HttpError(409, `Posició fora d'ordre: esperada ${expected}, rebuda ${input.position}`);
    }

    const gi = await client.query<{ item_id: number; is_word: boolean; stratum_id: number }>(
      `SELECT item_id, is_word, stratum_id FROM game_items WHERE game_id = $1 AND position = $2`,
      [input.gameId, input.position]
    );
    if (gi.rowCount === 0) throw new HttpError(404, "Ítem no servit en aquesta posició");
    const giRow = gi.rows[0];

    // Desempat coherent amb tot el sistema: confiança exactament 0,5 → "no".
    const isCorrect = (input.confidence > 0.5) === giRow.is_word;

    // Idempotència (§8.5): mateix response_id → una sola fila; el constraint
    // únic (game_id, item_id) impedeix dues respostes per al mateix ítem.
    const ins = await client.query(
      `INSERT INTO responses (response_id, game_id, player_id, item_id, position_in_game,
           stratum_id, is_word, confidence, response_format, slider_steps, is_correct, fifty_fifty,
           rt_below_threshold, item_bank_version, reference_corpus_version, calibration_version,
           scoring_version, time_to_first_input_ms, response_time_ms, n_adjustments,
           device_class, n_previous_games)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (response_id) DO NOTHING`,
      [
        input.responseId,
        input.gameId,
        playerId,
        giRow.item_id,
        input.position,
        giRow.stratum_id,
        giRow.is_word,
        input.confidence,
        game.response_format,
        game.slider_steps,
        isCorrect,
        input.confidence === 0.5,
        input.responseTimeMs !== null && input.responseTimeMs < MIN_RT_MS,
        VERSIONS.itemBank,
        VERSIONS.referenceCorpus,
        VERSIONS.calibration,
        VERSIONS.scoring,
        input.timeToFirstInputMs,
        input.responseTimeMs,
        input.nAdjustments,
        deviceClass ?? game.device_class,
        game.player_game_index - 1,
      ]
    );

    const duplicate = ins.rowCount === 0;

    const totalRes = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM responses WHERE game_id = $1`,
      [input.gameId]
    );
    const total = Number(totalRes.rows[0].n);
    let finished = false;
    if (total === 100 && !duplicate) {
      await finishGameTx(client, input.gameId);
      finished = true;
    }

    await client.query("COMMIT");
    return { duplicate, finished };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function finishGameTx(client: import("pg").PoolClient, gameId: string): Promise<void> {
  // Qualitat de resposta (§9): marca, no esborris.
  const fast = await client.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM responses WHERE game_id = $1 AND rt_below_threshold`,
    [gameId]
  );
  const fastRatio = Number(fast.rows[0].n) / 100;
  if (fastRatio >= FAST_GUESS_GAME_RATIO) {
    await client.query(`UPDATE games SET quality_flag = 'suspect_fast' WHERE id = $1`, [gameId]);
  }

  const result = await computeResultForGame(gameId, (sql, params) => client.query(sql, params as never));

  await client.query(
    `UPDATE games SET status = 'completed', finished_at = now() WHERE id = $1`,
    [gameId]
  );
  await client.query(
    `INSERT INTO game_results (game_id, n_responses, theta, se_theta, se_total, pct_lexicon,
        pct_lo, pct_hi, percentile, d_prime, criterion, n_correct, n_false_alarms,
        n_fifty_fifty, score, lexicon_game_score, calibration_version, reference_corpus_version, scoring_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (game_id) DO NOTHING`,
    [
      gameId, result.nResponses, result.theta, result.seTheta, result.seTotal,
      result.pctLexicon, result.pctLo, result.pctHi, result.percentile,
      result.dPrime, result.criterion, result.nCorrect, result.nFalseAlarms,
      result.nFiftyFifty, result.score, result.lexiconGameScore,
      VERSIONS.calibration, VERSIONS.referenceCorpus, VERSIONS.scoring,
    ]
  );
  const pidRes = await client.query<{ player_id: string }>(
    `SELECT player_id FROM games WHERE id = $1`, [gameId]
  );
  await recomputeStandings(client, pidRes.rows[0].player_id);
}

type Querier = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;

export async function computeResultForGame(
  gameId: string,
  q: Querier
): Promise<ComputedGameResult> {
  const rowsRes = await q(
    `SELECT r.item_id, r.confidence, r.is_word,
            i.a, i.b
     FROM responses r JOIN items i ON i.item_id = r.item_id
     WHERE r.game_id = $1 ORDER BY r.position_in_game`,
    [gameId]
  );
  const bank = await loadBank();
  const responses: GraduatedResponse[] = rowsRes.rows.map((r) => ({
    itemId: r.item_id,
    confidence: r.confidence,
    isWord: r.is_word,
  }));
  const itemsById = new Map<number, ItemParams>();
  for (const r of rowsRes.rows) {
    itemsById.set(r.item_id, { itemId: r.item_id, a: r.a, b: r.b, isWord: r.is_word });
  }

  return computeGameResult(responses, itemsById, bank.lexicon, bank.percentiles, bank.range);
}

function estimatePooled(responses: GraduatedResponse[], items: Map<number, ItemParams>) {
  return estimateAbility(responses, [...items.values()]);
}

/** Recàlcul de la finestra dels rànquings generals (últimes N completes vàlides). */
async function recomputeStandings(client: import("pg").PoolClient, playerId: string): Promise<void> {
  const gamesRes = await client.query<{ id: string; n_correct: number; score: number }>(
    `SELECT g.id, gr.n_correct, gr.score
     FROM games g JOIN game_results gr ON gr.game_id = g.id
     WHERE g.player_id = $1 AND g.status = 'completed' AND g.quality_flag IS NULL
     ORDER BY g.finished_at DESC LIMIT $2`,
    [playerId, RANKING_WINDOW]
  );
  if (gamesRes.rowCount === 0) return;
  const gameIds = gamesRes.rows.map((r) => r.id);

  const respRes = await client.query<{
    item_id: number; confidence: number; is_word: boolean; a: number; b: number;
  }>(
    `SELECT r.item_id, r.confidence, r.is_word, i.a, i.b
     FROM responses r JOIN items i ON i.item_id = r.item_id
     WHERE r.game_id = ANY($1::uuid[])`,
    [gameIds]
  );
  const bank = await loadBank();
  const responses: GraduatedResponse[] = respRes.rows.map((r) => ({
    itemId: r.item_id,
    confidence: r.confidence,
    isWord: r.is_word,
  }));
  const itemsById = new Map<number, ItemParams>();
  for (const r of respRes.rows) {
    itemsById.set(r.item_id, { itemId: r.item_id, a: r.a, b: r.b, isWord: r.is_word });
  }

  // §4.5: NO es fa la mitjana de les θ. Totes les respostes de la finestra
  // entren en una sola versemblança i s'estima un cop.
  const est = estimatePooled(responses, itemsById);
  const seTotal = Math.sqrt(est.se ** 2 + INSTABILITY_SE * INSTABILITY_SE);
  const { pct, lo, hi } = bank.lexicon.pctWithInterval(est.theta, seTotal);
  const pctile = bank.percentiles.percentileOf(est.theta);

  const meanHits = gamesRes.rows.reduce((s, r) => s + Number(r.n_correct), 0) / gamesRes.rows.length;
  const meanScore = gamesRes.rows.reduce((s, r) => s + Number(r.score), 0) / gamesRes.rows.length;

  await client.query(
    `INSERT INTO player_standings (player_id, window_size, n_games, mean_hits, theta_pooled,
        se_theta_pooled, se_total, pct_lexicon, pct_lo, pct_hi, percentile_pooled, mean_score, last_game_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (player_id) DO UPDATE SET
        window_size = EXCLUDED.window_size, n_games = EXCLUDED.n_games,
        mean_hits = EXCLUDED.mean_hits, theta_pooled = EXCLUDED.theta_pooled,
        se_theta_pooled = EXCLUDED.se_theta_pooled, se_total = EXCLUDED.se_total,
        pct_lexicon = EXCLUDED.pct_lexicon, pct_lo = EXCLUDED.pct_lo, pct_hi = EXCLUDED.pct_hi,
        percentile_pooled = EXCLUDED.percentile_pooled, mean_score = EXCLUDED.mean_score,
        last_game_id = EXCLUDED.last_game_id, updated_at = now()`,
    [
      playerId, RANKING_WINDOW, gamesRes.rows.length, meanHits,
      est.theta, est.se, seTotal, pct, lo, hi, pctile, meanScore, gameIds[0],
    ]
  );
}

export async function explicitAbandon(playerId: string, gameId: string): Promise<void> {
  await query(
    `UPDATE games
     SET status='abandoned', finished_at=now(), abandoned_reason='usuari',
         abandoned_at_position = COALESCE((SELECT MAX(position_in_game) FROM responses r WHERE r.game_id = $1), 0)
     WHERE id = $1 AND player_id = $2 AND status = 'in_progress'`,
    [gameId, playerId]
  );
}
