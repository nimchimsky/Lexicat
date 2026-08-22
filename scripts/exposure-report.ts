// Monitor d'exposició d'ítems (§8.2 i §9): quant queda de fons lliure per
// jugador i globalment amb el refredament actiu.
//
// Ús: npx tsx scripts/exposure-report.ts [playerId]

import "dotenv/config";
import { Client } from "pg";

async function main() {
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL no definida");
  const c = new Client({ connectionString: cs });
  await c.connect();

  const bank = await c.query<{ is_word: boolean; n: string }>(
    `SELECT is_word, COUNT(*)::text AS n FROM items WHERE active GROUP BY is_word`
  );
  const words = Number(bank.rows.find((r) => r.is_word)?.n ?? 0);
  const pseudos = Number(bank.rows.find((r) => !r.is_word)?.n ?? 0);

  console.log(`Fons actiu: ${words.toLocaleString("ca-ES")} paraules / ${pseudos.toLocaleString("ca-ES")} pseudoparaules`);
  console.log(`Partides sense repetir cap ítem (global): ~${Math.floor(words / 66)} paraula · ~${Math.floor(pseudos / 34)} pseudo`);

  const playerId = process.argv[2];
  if (playerId) {
    const exp = await c.query<{ times_seen: string; items_seen: string }>(
      `SELECT SUM(times_seen)::text AS times_seen, COUNT(*)::text AS items_seen
       FROM item_exposure WHERE player_id = $1`,
      [playerId]
    );
    const games = await c.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM games WHERE player_id = $1`,
      [playerId]
    );
    console.log(`\nJugador ${playerId}:`);
    console.log(`  partides iniciades: ${games.rows[0].n}`);
    console.log(`  ítems vists (únics): ${exp.rows[0].items_seen}`);
    console.log(`  exposicions totals: ${exp.rows[0].times_seen}`);
  }

  const relaxed = await c.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM selection_log WHERE event = 'relaxed_cooldown'`
  );
  console.log(`\nRelaxacions de refredament registrades: ${relaxed.rows[0].n}`);

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
