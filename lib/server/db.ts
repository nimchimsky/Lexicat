// Pool Postgres compartit (resistent a l'HMR de Next).

import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __lexicatPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__lexicatPool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL no està definida");
    globalThis.__lexicatPool = new Pool({ connectionString: cs, max: 10 });
  }
  return globalThis.__lexicatPool;
}

export async function query<T extends import("pg").QueryResultRow = import("pg").QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<import("pg").QueryResult<T>> {
  return getPool().query(text, params as never);
}
