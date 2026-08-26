// Limitador de taxa amb buckets a la base de dades: amb N lambdes actives de
// Vercel un comptador EN MEMÒRIA per procés és N vegades el límit declarat
// (inflar la taula players des d'una IP és trivial si el límit real és 30·N).
// Un upsert atòmic per petició: una sola fila per bucket, cap lectura prèvia.
// La poda dels caducats és feina del sweep (/api/cron/sweep).
//
// El client IP es pren de capçaleres només de confiança del proxy: x-real-ip
// (Vercel/nginx el posen net), i si no l'ÚLTIM salt de x-forwarded-for (el
// més proper al servidor). Mai el primer valor, que és el que envia el client
// i es pot suplantar per rotar identitats.

import { query } from "./db";

/**
 * true = la petició passa dins el límit. Un bucket caducat reinicia el compte.
 * Si la taula encara no existeix (migració pendent), FALLA TANCAT: false.
 */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  try {
    const res = await query<{ allowed: boolean }>(
      `INSERT INTO rate_limit_buckets (bucket_key, count, reset_at)
       VALUES ($1, 1, now() + make_interval(secs => $2))
       ON CONFLICT (bucket_key) DO UPDATE SET
         count = CASE
           WHEN rate_limit_buckets.reset_at < now() THEN 1
           ELSE rate_limit_buckets.count + 1
         END,
         reset_at = CASE
           WHEN rate_limit_buckets.reset_at < now()
           THEN now() + make_interval(secs => $2)
           ELSE rate_limit_buckets.reset_at
         END
       RETURNING count <= $3::int AS allowed`,
      [key, Math.ceil(windowMs / 1000), max]
    );
    return res.rows[0]?.allowed === true;
  } catch (e) {
    console.error("[ratelimit] bucket no disponible: bloquejat", e);
    return false;
  }
}

/** Poda els buckets caducats (feina del sweep programat). */
export async function purgeExpiredRateLimitBuckets(): Promise<void> {
  await query(`DELETE FROM rate_limit_buckets WHERE reset_at < now()`);
}

export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  // Sense capçaleres de proxy no hi ha manera de distingir clients: tot cau al
  // mateix bucket "local". Vercel SEMPRE les envia; en un desplegament sense
  // proxy davant, els usuaris es limitarien els uns als altres — posa-hi proxy.
  return "local";
}
