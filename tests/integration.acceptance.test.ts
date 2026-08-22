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
