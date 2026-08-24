// Mapa dels Països Catalans: progrés derivat de les respostes i reclamacions
// de zones. El progrés NO es desa mai: es deriva de `responses` (paraules
// reals úniques vistes) i de `player_regions` (zones ja col·locades).

import { query, getPool } from "./db";
import { HttpError } from "./http";
import { VERSIONS, MAPA_ZONES } from "../config";
import { isRegionId } from "../mapa/catalog";
import { zoneThresholds, zonesEarned, nextZoneThreshold } from "../mapa/thresholds";

export interface MapaClaim {
  regionId: string;
  claimedAt: string;
}

export interface MapaView {
  zones: number;
  wordsTotal: number;
  wordsSeen: number;
  earned: number;
  claimedIds: string[];
  pending: number;
  nextThreshold: number | null;
  wordsToNext: number | null;
  completed: boolean;
}

/** Paraules reals del banc vigent (denominador dels llindars). */
async function bankWordCount(client?: Pick<import("pg").PoolClient, "query">): Promise<number> {
  const q = client ? client.query.bind(client) : query;
  const r = await q<{ n_words: number }>(
    `SELECT n_words FROM item_bank_versions WHERE version = $1`,
    [VERSIONS.itemBank]
  );
  if (r.rowCount === 0) throw new HttpError(500, "El banc d'ítems no està carregat");
  return r.rows[0].n_words;
}

async function wordsSeenCount(playerId: string, client?: Pick<import("pg").PoolClient, "query">): Promise<number> {
  const q = client ? client.query.bind(client) : query;
  const r = await q<{ n: number }>(
    // El progrés és compartit: les paraules reals vistes als dos modes
    // desbloquegen zones del mateix mapa.
    `SELECT COUNT(DISTINCT item_id)::int AS n
     FROM responses
     WHERE player_id = $1
       AND is_word
       AND mode IN ('pompeu', 'killian')`,
    [playerId]
  );
  return Number(r.rows[0].n);
}

export async function getMapaView(playerId: string): Promise<MapaView> {
  const [wordsTotal, wordsSeen, claims] = await Promise.all([
    bankWordCount(),
    wordsSeenCount(playerId),
    query<{ region_id: string }>(
      `SELECT region_id FROM player_regions WHERE player_id = $1 ORDER BY claimed_at, region_id`,
      [playerId]
    ),
  ]);

  const thresholds = zoneThresholds(wordsTotal);
  const earned = zonesEarned(wordsSeen, thresholds);
  const claimedIds = claims.rows.map((c) => c.region_id);
  const next = nextZoneThreshold(wordsSeen, thresholds);

  return {
    zones: MAPA_ZONES,
    wordsTotal,
    wordsSeen,
    earned,
    claimedIds,
    pending: earned - claimedIds.length,
    nextThreshold: next,
    wordsToNext: next === null ? 0 : next - wordsSeen,
    completed: claimedIds.length >= MAPA_ZONES,
  };
}

/**
 * Reclama una regió gastant la fitxa pendent més antiga. Transaccional amb
 * bloqueig del jugador: dues reclamacions concurrents no poden gastar la
 * mateixa fitxa ni superar les zones guanyades.
 */
export async function claimRegion(
  playerId: string,
  regionId: string
): Promise<{ claim: MapaClaim; pending: number; earned: number }> {
  if (!isRegionId(regionId)) throw new HttpError(400, "Regió desconeguda");

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM players WHERE id = $1 FOR UPDATE`, [playerId]);

    const [wordsTotal, wordsSeen, claims] = await Promise.all([
      bankWordCount(client),
      wordsSeenCount(playerId, client),
      client.query<{ region_id: string }>(
        `SELECT region_id FROM player_regions WHERE player_id = $1`,
        [playerId]
      ),
    ]);

    const earned = zonesEarned(wordsSeen, zoneThresholds(wordsTotal));
    if ((claims.rowCount ?? 0) >= earned) {
      throw new HttpError(409, "Encara no tens cap zona per col·locar: juga per guanyar-ne una");
    }

    const ins = await client.query<{ claimed_at: Date }>(
      `INSERT INTO player_regions (player_id, region_id)
       VALUES ($1, $2)
       ON CONFLICT (player_id, region_id) DO NOTHING
       RETURNING claimed_at`,
      [playerId, regionId]
    );
    if (ins.rowCount === 0) throw new HttpError(409, "Aquesta zona ja és teva");

    await client.query("COMMIT");
    return {
      claim: { regionId, claimedAt: new Date(ins.rows[0].claimed_at).toISOString() },
      pending: earned - (claims.rowCount ?? 0) - 1,
      earned,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
