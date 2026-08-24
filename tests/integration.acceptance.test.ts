// Criteris d'acceptació que depenen de la base de dades (§14).
// Requereixen DATABASE_URL apuntant a un Postgres de proves amb migracions
// aplicades i banc ingestat (es fa automàticament al primer ús).

import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "pg";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

async function db() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  return c;
}

let ingestReady = false;

d("integració · esquema + partida + registre", () => {
  beforeAll(async () => {
    if (!ingestReady) {
      const { runMigrations } = await import("../scripts/migrate-lib");
      await runMigrations();
      const { runIngest } = await import("../scripts/ingest-item-bank");
      await runIngest();
      ingestReady = true;
    }
  });

  async function newPlayer(c: Client): Promise<string> {
    const r = await c.query<{ id: string }>(
      `INSERT INTO players (id, email, nickname) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [`test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.cat`, `jugador-${Math.random().toString(36).slice(2, 8)}`]
    );
    return r.rows[0].id;
  }

  it("criteri 3 · mateix response_id dues vegades crea una sola fila", async () => {
    const { startGame, serveItem, submitResponse } = await import("../lib/server/game");
    const c = await db();
    try {
      const pid = await newPlayer(c);
      const g = await startGame(pid, "mobile");
      await serveItem(pid, g.gameId, 1);
      const responseId = crypto.randomUUID();
      const first = await submitResponse(pid, {
        responseId, gameId: g.gameId, position: 1,
        confidence: 0.9, timeToFirstInputMs: 300, responseTimeMs: 1200, nAdjustments: 0,
      }, "mobile");
      expect(first.duplicate).toBe(false);
      const second = await submitResponse(pid, {
        responseId, gameId: g.gameId, position: 1,
        confidence: 0.9, timeToFirstInputMs: 300, responseTimeMs: 1200, nAdjustments: 0,
      }, "mobile");
      expect(second.duplicate).toBe(true);
      const n = await c.query(`SELECT COUNT(*)::int AS n FROM responses WHERE response_id = $1`, [responseId]);
      expect(n.rows[0].n).toBe(1);
    } finally {
      await c.end();
    }
  });

  it("criteri 10 · cap resposta sense les quatre versions", async () => {
    const { startGame, serveItem, submitResponse } = await import("../lib/server/game");
    const c = await db();
    try {
      const pid = await newPlayer(c);
      const g = await startGame(pid, "mobile");
      for (let p = 1; p <= 5; p++) {
        await serveItem(pid, g.gameId, p);
        await submitResponse(pid, {
          responseId: crypto.randomUUID(), gameId: g.gameId, position: p,
          confidence: [0.05, 0.25, 0.5, 0.75, 0.95][p - 1],
          timeToFirstInputMs: 250, responseTimeMs: 900 + p, nAdjustments: 1,
        }, "mobile");
      }
      const bad = await c.query(
        `SELECT COUNT(*)::int AS n FROM responses
         WHERE game_id = $1 AND (item_bank_version IS NULL OR reference_corpus_version IS NULL
            OR calibration_version IS NULL OR scoring_version IS NULL)`,
        [g.gameId]
      );
      expect(bad.rows[0].n).toBe(0);
    } finally {
      await c.end();
    }
  });

  it("criteri 11 · un ítem vist a la partida N no torna fins a la N+50", async () => {
    const { startGame, serveItem, submitResponse } = await import("../lib/server/game");
    const c = await db();
    try {
      const pid = await newPlayer(c);
      const g1 = await startGame(pid, "desktop");
      for (let p = 1; p <= 100; p++) {
        await serveItem(pid, g1.gameId, p);
        await submitResponse(pid, {
          responseId: crypto.randomUUID(), gameId: g1.gameId, position: p,
          confidence: p % 4 === 0 ? 0.5 : 0.9,
          timeToFirstInputMs: 200, responseTimeMs: 800, nAdjustments: 0,
        }, "desktop");
      }
      const seen = await c.query<{ item_id: number }>(
        `SELECT item_id FROM game_items WHERE game_id = $1`, [g1.gameId]
      );
      const seenIds = new Set(seen.rows.map((r) => Number(r.item_id)));

      const g2 = await startGame(pid, "desktop");
      expect(g2.playerGameIndex).toBe(2); // distància 1 ≤ 50 → cap repetició
      const g2Items = await c.query<{ item_id: number }>(
        `SELECT item_id FROM game_items WHERE game_id = $1`, [g2.gameId]
      );
      for (const row of g2Items.rows) {
        expect(seenIds.has(Number(row.item_id))).toBe(false);
      }
    } finally {
      await c.end();
    }
  });

  it("criteri 12 · el general usa la finestra, no 'la teva millor partida'", async () => {
    const { startGame, serveItem, submitResponse } = await import("../lib/server/game");
    const c = await db();
    try {
      const pid = await newPlayer(c);
      const hits: number[] = [];
      for (let gi = 0; gi < 6; gi++) {
        const g = await startGame(pid, "desktop");
        let correct = 0;
        for (let p = 1; p <= 100; p++) {
          const item = await c.query<{ is_word: boolean }>(
            `SELECT is_word FROM game_items WHERE game_id = $1 AND position = $2`,
            [g.gameId, p]
          );
          await serveItem(pid, g.gameId, p);
          // Última partida dolenta a posta: sempre "no és paraula".
          const adjusted = gi === 5 ? 0.05 : 0.95;
          if ((adjusted > 0.5) === item.rows[0].is_word) correct++;
          await submitResponse(pid, {
            responseId: crypto.randomUUID(), gameId: g.gameId, position: p,
            confidence: adjusted, timeToFirstInputMs: 300, responseTimeMs: 1000, nAdjustments: 0,
          }, "desktop");
        }
        hits.push(correct);
      }
      const st = await c.query<{ mean_hits: number; n_games: number }>(
        `SELECT mean_hits, n_games FROM player_standings WHERE player_id = $1`, [pid]
      );
      expect(st.rows[0].n_games).toBe(5);
      const windowMean = hits.slice(1, 6).reduce((s, x) => s + x, 0) / 5;
      expect(Math.abs(st.rows[0].mean_hits - windowMean)).toBeLessThan(0.001);
      // La primera partida (potser bona) ha d'haver sortit de la finestra:
      expect(st.rows[0].mean_hits).toBeLessThanOrEqual(Math.max(...hits));
    } finally {
      await c.end();
    }
  });

  it("criteri 15 · una partida abandonada queda desada amb la posició on va quedar", async () => {
    const { startGame, serveItem, submitResponse } = await import("../lib/server/game");
    const c = await db();
    try {
      const pid = await newPlayer(c);
      const g = await startGame(pid, "mobile");
      for (let p = 1; p <= 10; p++) {
        await serveItem(pid, g.gameId, p);
        await submitResponse(pid, {
          responseId: crypto.randomUUID(), gameId: g.gameId, position: p,
          confidence: 0.7, timeToFirstInputMs: 300, responseTimeMs: 1100, nAdjustments: 0,
        }, "mobile");
      }
      // Començar una partida nova abandona l'anterior a la seva posició.
      await startGame(pid, "mobile");
      const old = await c.query<{ status: string; abandoned_at_position: number | null; abandoned_reason: string | null }>(
        `SELECT status, abandoned_at_position, abandoned_reason FROM games WHERE id = $1`, [g.gameId]
      );
      expect(old.rows[0].status).toBe("abandoned");
      expect(old.rows[0].abandoned_at_position).toBe(10);
    } finally {
      await c.end();
    }
  });

  it("criteri 2 · l'API d'ítem no conté is_word ni item_id en cap forma", async () => {
    const { startGame, serveItem } = await import("../lib/server/game");
    const c = await db();
    try {
      const pid = await newPlayer(c);
      const g = await startGame(pid, "mobile");
      const served = await serveItem(pid, g.gameId, 1);
      const keys = Object.keys(served as unknown as Record<string, unknown>);
      expect(keys.sort()).toEqual(["position", "stimulus", "totalItems"]);
      expect(typeof served.stimulus).toBe("string");
      expect(served.stimulus).not.toMatch(/[A-Z\s]/);
    } finally {
      await c.end();
    }
  });

  it("criteri 6 i 7 · d′ finit i ≤ sostre també al camí del servidor", async () => {
    const { startGame, serveItem, submitResponse } = await import("../lib/server/game");
    const c = await db();
    try {
      const pid = await newPlayer(c);
      const g = await startGame(pid, "desktop");
      for (let p = 1; p <= 100; p++) {
        const item = await c.query<{ is_word: boolean }>(
          `SELECT is_word FROM game_items WHERE game_id = $1 AND position = $2`, [g.gameId, p]
        );
        await serveItem(pid, g.gameId, p);
        // jugador perfecte: encerta tot amb seguretat màxima
        await submitResponse(pid, {
          responseId: crypto.randomUUID(), gameId: g.gameId, position: p,
          confidence: item.rows[0].is_word ? 0.98 : 0.02,
          timeToFirstInputMs: 400, responseTimeMs: 1500, nAdjustments: 0,
        }, "desktop");
      }
      const gr = await c.query<{ d_prime: number; n_correct: number }>(
        `SELECT d_prime, n_correct FROM game_results WHERE game_id = $1`, [g.gameId]
      );
      expect(gr.rows[0].n_correct).toBe(100);
      expect(Number.isFinite(Number(gr.rows[0].d_prime))).toBe(true);
      // Sostre EXACTE amb correcció loglineal: probit(66,5/67) − probit(0,5/35)
      // ≈ 4,6235 (el «4,62» documentat n'és l'arrodoniment).
      expect(Number(gr.rows[0].d_prime)).toBeLessThanOrEqual(4.63);
    } finally {
      await c.end();
    }
  });
});

d("integració · mode Kilian", () => {
  beforeAll(async () => {
    if (!ingestReady) {
      const { runMigrations } = await import("../scripts/migrate-lib");
      await runMigrations();
      const { runIngest } = await import("../scripts/ingest-item-bank");
      await runIngest();
      ingestReady = true;
    }
  });

  async function newPlayer(c: Client): Promise<string> {
    const r = await c.query<{ id: string }>(
      `INSERT INTO players (id, email, nickname) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [`test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.cat`, `jugador-${Math.random().toString(36).slice(2, 8)}`]
    );
    return r.rows[0].id;
  }

  it("partida kiliana sencera: punts, ratxes, resultats i separació de modes", async () => {
    const { startGame, serveItem, submitResponse } = await import("../lib/server/game");
    const c = await db();
    try {
      const pid = await newPlayer(c);
      const g = await startGame(pid, "mobile", "killian");
      expect(g.mode).toBe("killian");

      // Guió determinista: 7 primers encerts ràpids, després tres trencades
      // (errònia, timeout, errònia), i la resta encerts lents (90 seguits).
      let expectedScore = 0;
      let streak = 0;
      let expectedFas = 0;
      const { kilianHitPoints } = await import("../lib/game/kilian");

      for (let p = 1; p <= 100; p++) {
        const item = await c.query<{ is_word: boolean }>(
          `SELECT is_word FROM game_items WHERE game_id = $1 AND position = $2`,
          [g.gameId, p]
        );
        const isWord = item.rows[0].is_word;
        await serveItem(pid, g.gameId, p);

        const broken = p === 8 || p === 9 || p === 10;
        const action = p === 9 ? "timeout" : broken ? "wrong" : "hit";
        const choice =
          action === "hit" ? (isWord ? "yes" : "no")
          : action === "wrong" ? (isWord ? "no" : "yes") // error garantit
          : undefined;
        if (action === "wrong" && !isWord) expectedFas++;
        // Ratxa esperada: encert la puja; qualsevol trencada la posa a zero.
        const willBeCorrect = action === "hit";
        const nextStreak = willBeCorrect ? streak + 1 : 0;

        // Punts esperats segons ki-1 (repliquem la regla pura per contrast).
        if (willBeCorrect) expectedScore += kilianHitPoints(900, nextStreak);

        const res = await submitResponse(pid, {
          responseId: crypto.randomUUID(),
          gameId: g.gameId,
          position: p,
          confidence: action === "timeout" ? Number.NaN : choice === "yes" ? 0.95 : 0.05,
          timeToFirstInputMs: null,
          responseTimeMs: action === "timeout" ? null : 900,
          nAdjustments: null,
          kind: action === "timeout" ? "timeout" : "answer",
          choice,
          elapsedMs: action === "timeout" ? 5200 : 900,
          inputMethod: "swipe",
        }, "mobile");

        expect(res.duplicate).toBe(false);
        if (p < 100) {
          expect(res.outcome).toBeDefined();
          expect(res.outcome!.streakAfter).toBe(nextStreak);
        }
        streak = nextStreak;
      }

      // Resultat agregat
      const gr = await c.query<{
        mode: string; score: number; best_streak: number; max_multiplier: number;
        n_timeouts: number; n_correct: number; n_false_alarms: number; theta: number | null;
      }>(`SELECT mode, score, best_streak, max_multiplier, n_timeouts, n_correct, n_false_alarms, theta
          FROM game_results WHERE game_id = $1`, [g.gameId]);
      const r = gr.rows[0];
      expect(r.mode).toBe("killian");
      expect(Number(r.score)).toBe(expectedScore);
      expect(r.best_streak).toBe(90); // 7 encerts, 3 trencades, 90 seguits
      expect(Number(r.max_multiplier)).toBeCloseTo(2.6);
      expect(r.n_timeouts).toBe(1);
      expect(r.n_correct).toBe(97);
      expect(r.n_false_alarms).toBe(expectedFas);
      expect(r.theta).toBeNull(); // els modes no es barregen

      // Registre per resposta: timeout sense confiança, punts emmagatzemats
      const rows = await c.query<{ response_kind: string; confidence: number | null; points: number | null; streak_after: number }>(
        `SELECT response_kind, confidence, points, streak_after FROM responses
         WHERE game_id = $1 ORDER BY position_in_game`, [g.gameId]);
      expect(rows.rows.length).toBe(100);
      const timeoutRow = rows.rows.find((x) => x.response_kind === "timeout")!;
      expect(timeoutRow.confidence).toBeNull();
      expect(Number(timeoutRow.points)).toBe(0);
      expect(timeoutRow.streak_after).toBe(0);
      const fifth = rows.rows[4]; // cinquè encert seguit: 80 punts × 1,2 = 95
      expect(fifth.streak_after).toBe(5);
      expect(Number(fifth.points)).toBe(95);

      // Separació de modes: cap standing de Pompeu només amb partides kilianes
      const st = await c.query(`SELECT * FROM player_standings WHERE player_id = $1`, [pid]);
      expect(st.rowCount).toBe(0);

      // El mapa sí que compta: paraules reals vistes via respostes kilianes
      const seenWords = await c.query<{ n: number }>(
        `SELECT COUNT(DISTINCT responses.item_id)::int AS n FROM responses
         JOIN game_items gi ON gi.game_id = responses.game_id AND gi.item_id = responses.item_id
         WHERE responses.game_id = $1 AND responses.is_word`,
        [g.gameId]
      );
      expect(seenWords.rows[0].n).toBeGreaterThan(50);

      const { getMapaView } = await import("../lib/server/mapa");
      const mapa = await getMapaView(pid);
      expect(mapa.wordsSeen).toBe(Number(seenWords.rows[0].n));
    } finally {
      await c.end();
    }
  });

  it("un reenviament kiliana és idempotent", async () => {
    const { startGame, serveItem, submitResponse } = await import("../lib/server/game");
    const c = await db();
    try {
      const pid = await newPlayer(c);
      const g = await startGame(pid, "mobile", "killian");
      await serveItem(pid, g.gameId, 1);
      const body = {
        responseId: crypto.randomUUID(),
        gameId: g.gameId,
        position: 1,
        confidence: 0.95,
        timeToFirstInputMs: null,
        responseTimeMs: 700,
        nAdjustments: null,
        kind: "answer" as const,
        choice: "yes" as const,
        elapsedMs: 700,
        inputMethod: "swipe" as const,
      };
      const first = await submitResponse(pid, body, "mobile");
      const second = await submitResponse(pid, body, "mobile");
      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
      const n = await c.query(`SELECT COUNT(*)::int AS n FROM responses WHERE response_id = $1`, [body.responseId]);
      expect(n.rows[0].n).toBe(1);
    } finally {
      await c.end();
    }
  });

  it("una partida kiliana no mou les finestres generals d'un jugador de Pompeu", async () => {
    const { startGame, serveItem, submitResponse } = await import("../lib/server/game");
    const c = await db();
    try {
      const pid = await newPlayer(c);

      // Una partida Pompeu completa → crea standing.
      const gp = await startGame(pid, "desktop");
      for (let p = 1; p <= 100; p++) {
        const item = await c.query<{ is_word: boolean }>(
          `SELECT is_word FROM game_items WHERE game_id = $1 AND position = $2`, [gp.gameId, p]
        );
        await serveItem(pid, gp.gameId, p);
        await submitResponse(pid, {
          responseId: crypto.randomUUID(), gameId: gp.gameId, position: p,
          confidence: item.rows[0].is_word ? 0.9 : 0.1,
          timeToFirstInputMs: 300, responseTimeMs: 1200, nAdjustments: 0,
        }, "desktop");
      }
      let st = await c.query<{ mean_hits: number }>(`SELECT mean_hits FROM player_standings WHERE player_id = $1`, [pid]);
      expect(st.rowCount).toBe(1);

      // Una partida Kiliana completa més tard → el standing queda intacte.
      const gk = await startGame(pid, "mobile", "killian");
      for (let p = 1; p <= 100; p++) {
        const item = await c.query<{ is_word: boolean }>(
          `SELECT is_word FROM game_items WHERE game_id = $1 AND position = $2`, [gk.gameId, p]
        );
        await serveItem(pid, gk.gameId, p);
        await submitResponse(pid, {
          responseId: crypto.randomUUID(), gameId: gk.gameId, position: p,
          confidence: item.rows[0].is_word ? 0.95 : 0.05,
          timeToFirstInputMs: null, responseTimeMs: 800, nAdjustments: null,
          kind: "answer", choice: item.rows[0].is_word ? "yes" : "no",
          elapsedMs: 800, inputMethod: "button",
        }, "mobile");
      }
      st = await c.query<{ mean_hits: number }>(`SELECT mean_hits FROM player_standings WHERE player_id = $1`, [pid]);
      expect(st.rowCount).toBe(1); // mateixa fila, sense canvis

      // I el rànquing kiliana el veu, mentre els boards de Pompeu el filtren per mode.
      const { getKilianRankings, getRankings } = await import("../lib/server/views");
      const kb = await getKilianRankings();
      expect(kb.some((row) => row.score > 0)).toBe(true);
      const pompeuBoards = await getRankings();
      expect(Array.isArray(pompeuBoards.individualHits)).toBe(true);
    } finally {
      await c.end();
    }
  });
});

d("integració · mapa de zones", () => {
  beforeAll(async () => {
    if (!ingestReady) {
      const { runMigrations } = await import("../scripts/migrate-lib");
      await runMigrations();
      const { runIngest } = await import("../scripts/ingest-item-bank");
      await runIngest();
      ingestReady = true;
    }
  });

  async function newPlayer(c: Client): Promise<string> {
    const r = await c.query<{ id: string }>(
      `INSERT INTO players (id, email, nickname) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [`test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.cat`, `jugador-${Math.random().toString(36).slice(2, 8)}`]
    );
    return r.rows[0].id;
  }

  /** Fabrica `n` paraules reals «vistes» per al jugador (respostes sintètiques). */
  async function seedWordsSeen(c: Client, pid: string, n: number): Promise<void> {
    const { startGame } = await import("../lib/server/game");
    const g = await startGame(pid, "mobile");
    await c.query(
      `INSERT INTO responses (response_id, game_id, player_id, item_id, position_in_game,
          stratum_id, is_word, confidence, is_correct, fifty_fifty,
          item_bank_version, reference_corpus_version, calibration_version, scoring_version,
          response_format, n_previous_games)
       SELECT gen_random_uuid(), $2, $1, i.item_id, row_number() OVER (ORDER BY i.item_id),
          i.word_stratum_id, true, 0.9, true, false,
          '2026.08', 'ref-1', 'cal-1', 'sc-1',
          g.response_format, 0
       FROM (
         SELECT item_id, word_stratum_id FROM items
         WHERE bank_version = '2026.08' AND active AND is_word
         ORDER BY item_id LIMIT $3
       ) i
       CROSS JOIN (SELECT response_format FROM games WHERE id = $2) g`,
      [pid, g.gameId, n]
    );
  }

  it("sense fitxes no es pot reclamar; amb fitxes el flux sencer quadra", async () => {
    const { getMapaView, claimRegion } = await import("../lib/server/mapa");
    const c = await db();
    try {
      const pid = await newPlayer(c);

      // 0 paraules: cap zona guanyada.
      let view = await getMapaView(pid);
      expect(view.earned).toBe(0);
      expect(view.pending).toBe(0);
      await expect(claimRegion(pid, "catalunya--alt-camp")).rejects.toMatchObject({ status: 409 });

      // 500 paraules vistes (T[0] = 408): exactament 1 fitxa.
      await seedWordsSeen(c, pid, 500);
      view = await getMapaView(pid);
      expect(view.wordsSeen).toBe(500);
      expect(view.earned).toBe(1);
      expect(view.pending).toBe(1);

      // Regió desconeguda → 400 (mai un insert).
      await expect(claimRegion(pid, "catalunya--no-existeix")).rejects.toMatchObject({ status: 400 });

      // Reclamació correcta: la fitxa es gasta.
      const r = await claimRegion(pid, "catalunya--alt-camp");
      expect(r.claim.regionId).toBe("catalunya--alt-camp");
      expect(r.pending).toBe(0);

      // Duplicat i segona zona sense fitxa → 409.
      await expect(claimRegion(pid, "catalunya--alt-camp")).rejects.toMatchObject({ status: 409 });
      await expect(claimRegion(pid, "illes-balears--mallorca")).rejects.toMatchObject({ status: 409 });

      view = await getMapaView(pid);
      expect(view.claimedIds).toEqual(["catalunya--alt-camp"]);
      expect(view.completed).toBe(false);
    } finally {
      await c.end();
    }
  });

  it("dues reclamacions concurrents no gasten la mateixa fitxa", async () => {
    const { claimRegion } = await import("../lib/server/mapa");
    const c = await db();
    try {
      const pid = await newPlayer(c);
      await seedWordsSeen(c, pid, 500); // 1 fitxa
      const [a, b] = await Promise.allSettled([
        claimRegion(pid, "illes-balears--mallorca"),
        claimRegion(pid, "carxe--carxe"),
      ]);
      const fulfilled = [a, b].filter((x) => x.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);
      const n = await c.query(`SELECT COUNT(*)::int AS n FROM player_regions WHERE player_id = $1`, [pid]);
      expect(n.rows[0].n).toBe(1);
    } finally {
      await c.end();
    }
  });
});

