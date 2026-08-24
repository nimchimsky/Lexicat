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
  GAME_LENGTH,
  type GameMode,
  KILIAN_BAR_MS,
  KILIAN_GRACE_MS,
  KILIAN_YES_CONFIDENCE,
  KILIAN_NO_CONFIDENCE,
} from "../config";
import {
  kilianMultiplier,
  kilianHitPoints,
  type KillianKind,
} from "../game/kilian";

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
  responseFormat: string;
  sliderSteps: number | null;
  mode: GameMode;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) throw new HttpError(400, `${field} invàlid`);
}

function finiteNonNegative(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) throw new HttpError(400, `${field} fora de rang`);
  return Math.round(value);
}

export async function startGame(
  playerId: string,
  deviceClass: string | null,
  mode: GameMode = "pompeu"
): Promise<StartedGame> {
  const bank = await loadBank();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    // Lock the player row as well as existing games. Without this, two
    // concurrent clicks can both observe no open game and create two games.
    const player = await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
    if (player.rowCount === 0) throw new HttpError(404, "Jugador no trobat");

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
    const responseFormat = mode === "killian" ? "binary" : ACTIVE_RESPONSE_FORMAT;
    await client.query(
      `INSERT INTO games (id, player_id, player_game_index, game_seed,
                          item_bank_version, reference_corpus_version, calibration_version,
                          scoring_version, response_format, slider_steps, device_class, relaxed_strata, mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        gameId,
        playerId,
        playerGameIndex,
        seedHex,
        VERSIONS.itemBank,
        VERSIONS.referenceCorpus,
        VERSIONS.calibration,
        mode === "killian" ? VERSIONS.kilianScoring : VERSIONS.scoring,
        responseFormat,
        responseFormat === "slider" ? SLIDER_STEPS : null,
        deviceClass,
        JSON.stringify({ cooldown: selection.relaxedStrata, lemma: selection.lemmaRelaxedStrata }),
        mode,
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

    if (selection.relaxedStrata.length > 0 || selection.lemmaRelaxedStrata.length > 0) {
      await client.query(
        `INSERT INTO selection_log (game_id, event, detail)
         VALUES ($1, 'relaxations', $2)`,
        [gameId, JSON.stringify({ cooldown: selection.relaxedStrata, lemma: selection.lemmaRelaxedStrata })]
      );
    }

    await client.query("COMMIT");
    return {
      gameId,
      playerGameIndex,
      responseFormat,
      sliderSteps: responseFormat === "slider" ? SLIDER_STEPS : null,
      mode,
    };
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
  mode: GameMode;
  /** Només killian: punts acumulats i ratxa vigent, per reprenre la partida. */
  scoreSoFar?: number;
  streakNow?: number;
}

export async function getOpenGame(playerId: string): Promise<GameState | null> {
  const res = await query<{
    id: string;
    response_format: string;
    slider_steps: number | null;
    mode: GameMode;
    answered: string;
  }>(
    `SELECT g.id, g.response_format, g.slider_steps, g.mode,
            (SELECT COUNT(*) FROM responses r WHERE r.game_id = g.id) AS answered
     FROM games g
     WHERE g.player_id = $1 AND g.status = 'in_progress'
     ORDER BY g.started_at DESC LIMIT 1`,
    [playerId]
  );
  if (res.rowCount === 0) return null;
  const g = res.rows[0];
  const state: GameState = {
    gameId: g.id,
    nextPosition: Number(g.answered) + 1,
    totalItems: GAME_LENGTH,
    responseFormat: g.response_format,
    sliderSteps: g.slider_steps,
    mode: g.mode,
  };
  if (g.mode === "killian") {
    const k = await query<{ score_so_far: string; streak_now: number | null }>(
      `SELECT COALESCE(SUM(points), 0)::int AS score_so_far,
              (SELECT streak_after FROM responses WHERE game_id = $1
               ORDER BY position_in_game DESC LIMIT 1) AS streak_now
       FROM responses
       WHERE game_id = $1`,
      [g.id]
    );
    state.scoreSoFar = Number(k.rows[0].score_so_far);
    state.streakNow = k.rows[0].streak_now ?? 0;
  }
  return state;
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
  assertUuid(gameId, "gameId");
  const g = await query<{
    status: string; player_id: string; player_game_index: number; mode: GameMode; answered: string;
  }>(
    `SELECT g.status, g.player_id, g.player_game_index, g.mode,
            (SELECT COUNT(*) FROM responses r WHERE r.game_id = g.id) AS answered
     FROM games g WHERE g.id = $1`,
    [gameId]
  );
  if (g.rowCount === 0) throw new HttpError(404, "Partida no trobada");
  if (g.rows[0].player_id !== playerId) throw new HttpError(403, "Partida d'un altre jugador");
  if (g.rows[0].status !== "in_progress") throw new HttpError(409, "La partida no està en curs");

  const nextPosition = Number(g.rows[0].answered) + 1;
  // Kilian prefetches exactly one item during the feedback window. Pompeu has
  // no prefetch. In both modes, arbitrary reads of the future composition are
  // rejected while allowing safe retries of already served positions.
  const maxPosition = nextPosition + (g.rows[0].mode === "killian" ? 1 : 0);
  if (!Number.isInteger(position) || position < 1 || position > maxPosition) {
    throw new HttpError(409, `Posició fora de la finestra de joc: esperada ${nextPosition}`);
  }

  const item = await query<{ form: string }>(
    `SELECT i.form
     FROM game_items gi JOIN items i ON i.item_id = gi.item_id
     WHERE gi.game_id = $1 AND gi.position = $2`,
    [gameId, position]
  );
  if (item.rowCount === 0) throw new HttpError(404, "Posició no trobada");

  // L'exposició es registra quan es serveix: és el que sosté el refredament.
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
         last_seen_at = CASE
           WHEN item_exposure.last_game_id = EXCLUDED.last_game_id THEN item_exposure.last_seen_at
           ELSE now()
         END,
         times_seen = CASE
           WHEN item_exposure.last_game_id = EXCLUDED.last_game_id THEN item_exposure.times_seen
           ELSE item_exposure.times_seen + 1
         END`,
    [playerId, itemIdRow.rows[0].item_id, gameId, g.rows[0].player_game_index]
  );

  return { position, stimulus: item.rows[0].form, totalItems: 100 };
}

export interface SubmittedResponse {
  duplicate: boolean;
  finished: boolean;
  /** Només killian: resultat de l'ítem acabat de puntuar, per al feedback.
   *  `itemWasWord` es revela UN COP registrada la resposta (§9). */
  outcome?: {
    isCorrect: boolean;
    kind: KillianKind;
    points: number;
    streakAfter: number;
    multiplier: number;
    scoreSoFar: number;
    itemWasWord: boolean;
  };
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
    // --- Només killian ---
    kind?: "answer" | "timeout";
    choice?: "yes" | "no";
    elapsedMs?: number | null;
    inputMethod?: "swipe" | "button" | "key" | null;
  },
  deviceClass: string | null
): Promise<SubmittedResponse> {
  assertUuid(input.responseId, "response_id");
  assertUuid(input.gameId, "gameId");
  if (!Number.isInteger(input.position) || input.position < 1) {
    throw new HttpError(400, "position invàlid");
  }
  const timeToFirstInputMs = finiteNonNegative(input.timeToFirstInputMs, "Temps fins a primera entrada");
  const responseTimeMs = finiteNonNegative(input.responseTimeMs, "Temps de resposta");
  const nAdjustments = finiteNonNegative(input.nAdjustments, "Nombre d'ajustos");

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
      scoring_version: string;
      mode: GameMode;
    }>(`SELECT id, player_id, status, player_game_index, response_format, slider_steps,
               device_class, scoring_version, mode
        FROM games WHERE id = $1 FOR UPDATE`, [input.gameId]);
    if (g.rowCount === 0) throw new HttpError(404, "Partida no trobada");
    const game = g.rows[0];
    if (game.player_id !== playerId) throw new HttpError(403, "Partida d'un altre jugador");

    // Idempotència (§8.5): un reenviament del MATEIX response_id surt exitós
    // sense crear cap fila nova, encara que la partida hagi avançat.
    const dupe = await client.query<{ game_id: string }>(
      `SELECT game_id FROM responses WHERE response_id = $1`,
      [input.responseId]
    );
    if (dupe.rowCount !== 0) {
      if (dupe.rows[0].game_id !== input.gameId) {
        throw new HttpError(409, "response_id ja utilitzat");
      }
      await client.query("COMMIT");
      return { duplicate: true, finished: game.status === "completed" };
    }
    if (game.status !== "in_progress") throw new HttpError(409, "La partida ja s'ha tancat");
    const isKillian = game.mode === "killian";

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

    let confidence: number | null = null;
    let responseKind: KillianKind = "answer";
    let elapsedMs: number | null = null;
    let points: number | null = null;
    let streakAfter: number | null = null;
    let multiplier: number | null = null;

    if (isKillian) {
      responseKind = input.kind === "timeout" ? "timeout" : "answer";
      if (responseKind === "answer" && input.choice !== "yes" && input.choice !== "no") {
        throw new HttpError(400, "Falta el judici sí/no");
      }
      const rawElapsed = Math.round(Number(input.elapsedMs ?? 0));
      if (!Number.isFinite(rawElapsed) || rawElapsed < 0) {
        throw new HttpError(400, "Temps de resposta fora de rang");
      }
      // El servidor retalla SEMPRE al seu rang (barra + marge de gràcia) i mai
      // rebuja per llarg: un timeout automàtic després d'una pestanya amagada
      // ha de registrar-se com un timeout normal, no petar amb un 400.
      elapsedMs = Math.min(rawElapsed, KILIAN_BAR_MS + KILIAN_GRACE_MS);

      const saidYes = input.choice === "yes";
      const isCorrect = responseKind === "answer" && saidYes === giRow.is_word;

      // Ratxa vigent abans d'aquesta resposta: l'últim streak_after persistit
      // ÉS l'única font de veritat. Un encert massa ràpid (<200 ms) es desa amb
      // ratxa 0 i així no pot ressuscitar mai al recompte següent.
      const prior = await client.query<{ streak_after: number | null }>(
        `SELECT streak_after FROM responses
         WHERE game_id = $1 ORDER BY position_in_game DESC LIMIT 1`,
        [input.gameId]
      );
      const prevStreak = prior.rows[0]?.streak_after ?? 0;

      streakAfter = isCorrect ? prevStreak + 1 : 0;
      multiplier = isCorrect ? kilianMultiplier(streakAfter) : null;

      // Anti-espam: sota el llindar de RT no hi ha punts ni ratxa (es marca,
      // no s'esborra; ≥20% marca tota la partida com a suspect_fast).
      const tooFast = elapsedMs < MIN_RT_MS;
      if (tooFast) streakAfter = 0;
      points = isCorrect && !tooFast ? kilianHitPoints(elapsedMs!, streakAfter) : 0;

      confidence =
        responseKind === "answer"
          ? saidYes ? KILIAN_YES_CONFIDENCE : KILIAN_NO_CONFIDENCE
          : null; // un timeout no és cap judici de confiança

      multiplier = isCorrect && !tooFast ? multiplier : null;
    } else {
      if (!(input.confidence >= 0 && input.confidence <= 1)) {
        throw new HttpError(400, "confiança fora de [0,1]");
      }
      confidence = input.confidence;
    }

    // Desempat coherent amb tot el sistema (pompeu): confiança exactament
    // 0,5 → "no". A killian el judici ja és binari i no hi passa mai.
    const isCorrectStored =
      isKillian
        ? responseKind === "answer" && (input.choice === "yes") === giRow.is_word
        : (confidence as number) > 0.5 === giRow.is_word;

    // Idempotència (§8.5): mateix response_id → una sola fila; el constraint
    // únic (game_id, item_id) impedeix dues respostes per al mateix ítem.
    const ins = await client.query(
      `INSERT INTO responses (response_id, game_id, player_id, item_id, position_in_game,
           stratum_id, is_word, confidence, response_format, slider_steps, is_correct, fifty_fifty,
           rt_below_threshold, item_bank_version, reference_corpus_version, calibration_version,
           scoring_version, time_to_first_input_ms, response_time_ms, n_adjustments,
           device_class, n_previous_games, mode, response_kind, elapsed_ms, input_method,
           points, streak_after, multiplier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
               $23,$24,$25,$26,$27,$28,$29)
       ON CONFLICT (response_id) DO NOTHING`,
      [
        input.responseId,
        input.gameId,
        playerId,
        giRow.item_id,
        input.position,
        giRow.stratum_id,
        giRow.is_word,
        confidence,
        game.response_format,
        game.slider_steps,
        isCorrectStored,
        !isKillian && confidence === 0.5,
        responseTimeMs !== null && responseTimeMs < MIN_RT_MS,
        VERSIONS.itemBank,
        VERSIONS.referenceCorpus,
        VERSIONS.calibration,
        game.scoring_version,
        isKillian ? null : timeToFirstInputMs,
        isKillian ? elapsedMs : responseTimeMs,
        isKillian ? null : nAdjustments,
        deviceClass ?? game.device_class,
        game.player_game_index - 1,
        game.mode,
        responseKind,
        elapsedMs,
        input.inputMethod ?? null,
        points,
        streakAfter,
        multiplier,
      ]
    );

    let duplicate = ins.rowCount === 0;
    if (duplicate) {
      // A concurrent request can win the response_id race after the initial
      // lookup. Never treat a token that belongs to another game as a valid
      // retry.
      const conflict = await client.query<{ game_id: string }>(
        `SELECT game_id FROM responses WHERE response_id = $1`,
        [input.responseId]
      );
      if (conflict.rowCount === 0 || conflict.rows[0].game_id !== input.gameId) {
        throw new HttpError(409, "response_id ja utilitzat");
      }
    }

    const totalRes = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM responses WHERE game_id = $1`,
      [input.gameId]
    );
    const total = Number(totalRes.rows[0].n);
    let finished = false;
    let outcome: SubmittedResponse["outcome"] | undefined;
    if (!duplicate) {
      if (isKillian) {
        const soFar = await client.query<{ score_so_far: string }>(
          `SELECT COALESCE(SUM(points), 0)::int AS score_so_far FROM responses WHERE game_id = $1`,
          [input.gameId]
        );
        outcome = {
          isCorrect: isCorrectStored,
          kind: responseKind,
          points: points ?? 0,
          streakAfter: streakAfter ?? 0,
          multiplier: multiplier ?? 1,
          scoreSoFar: Number(soFar.rows[0].score_so_far),
          itemWasWord: giRow.is_word,
        };
      }
      if (total === GAME_LENGTH) {
        finished = true;
        if (isKillian) await finishKillianGameTx(client, input.gameId);
        else await finishGameTx(client, input.gameId);
      }
    }

    await client.query("COMMIT");
    return { duplicate, finished, outcome };
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

/**
 * Tancament d'una partida Kilian: sense θ ni d′ (els modes no es barregen),
 * només agregats de puntuació. Els rànquings generals de Pompeu no es toquen.
 */
async function finishKillianGameTx(client: import("pg").PoolClient, gameId: string): Promise<void> {
  // Qualitat de resposta: la mateixa regla «marca, no esborris».
  const fast = await client.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM responses WHERE game_id = $1 AND rt_below_threshold`,
    [gameId]
  );
  const fastRatio = Number(fast.rows[0].n) / GAME_LENGTH;
  if (fastRatio >= FAST_GUESS_GAME_RATIO) {
    await client.query(`UPDATE games SET quality_flag = 'suspect_fast' WHERE id = $1`, [gameId]);
  }

  const agg = await client.query<{
    n: number;
    score: number;
    best_streak: number;
    max_mult: number | null;
    n_correct: number;
    n_fa: number;
    n_timeouts: number;
  }>(
    `SELECT COUNT(*)::int AS n,
            COALESCE(SUM(points), 0)::int AS score,
            COALESCE(MAX(streak_after), 0)::int AS best_streak,
            MAX(multiplier)::float AS max_mult,
            COUNT(*) FILTER (WHERE is_correct)::int AS n_correct,
            COUNT(*) FILTER (WHERE NOT is_word AND NOT is_correct AND response_kind = 'answer')::int AS n_fa,
            COUNT(*) FILTER (WHERE response_kind = 'timeout')::int AS n_timeouts
     FROM responses WHERE game_id = $1`,
    [gameId]
  );
  const a = agg.rows[0];

  const verRes = await client.query<{ scoring_version: string; reference_corpus_version: string; calibration_version: string }>(
    `SELECT scoring_version, reference_corpus_version, calibration_version FROM games WHERE id = $1`,
    [gameId]
  );

  await client.query(
    `UPDATE games SET status = 'completed', finished_at = now() WHERE id = $1`,
    [gameId]
  );
  await client.query(
    `INSERT INTO game_results (game_id, n_responses, theta, se_theta, se_total, pct_lexicon,
        pct_lo, pct_hi, percentile, d_prime, criterion, n_correct, n_false_alarms,
        n_fifty_fifty, score, lexicon_game_score, calibration_version, reference_corpus_version,
        scoring_version, mode, best_streak, max_multiplier, n_timeouts)
     VALUES ($1,$2,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$3,$4,0,$5,NULL,$6,$7,$8,'killian',$9,$10,$11)
     ON CONFLICT (game_id) DO NOTHING`,
    [
      gameId, a.n, a.n_correct, a.n_fa, a.score,
      verRes.rows[0].calibration_version, verRes.rows[0].reference_corpus_version,
      verRes.rows[0].scoring_version, a.best_streak, a.max_mult ?? 1, a.n_timeouts,
    ]
  );
  // Cap recomputeStandings: el mode Kilian no entra mai a les taules de Pompeu.
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

/** Recàlcul de la finestra dels rànquings generals (últimes N completes vàlides).
 *  Només modes Pompeu: una partida Kilian mai mou l'estimació del lexicó. */
async function recomputeStandings(client: import("pg").PoolClient, playerId: string): Promise<void> {
  const gamesRes = await client.query<{ id: string; n_correct: number; score: number }>(
    `SELECT g.id, gr.n_correct, gr.score
     FROM games g JOIN game_results gr ON gr.game_id = g.id
     WHERE g.player_id = $1 AND g.status = 'completed' AND g.quality_flag IS NULL
       AND g.mode = 'pompeu'
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
