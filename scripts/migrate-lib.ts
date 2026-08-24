// Llibreria de migracions (compartida entre el CLI i els tests d'integració).

import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

export async function runMigrations(): Promise<string[]> {
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL no definida (mira .env.example)");
  const client = new Client({ connectionString: cs });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const dir = path.resolve(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      const already = await client.query(`SELECT 1 FROM schema_migrations WHERE version = $1`, [file]);
      if ((already.rowCount ?? 0) > 0) continue;
      const sql = readFileSync(path.join(dir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migració ${file} ha fallat: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

