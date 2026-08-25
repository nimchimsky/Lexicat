// Limitador de taxa en memòria per als endpoints públics i d'autenticació.
// Suficient per al risc real (spam de magic links, martelleig de partida);
// en producció amb diverses instàncies, moure'l a Redis o similar.
//
// El client IP es pren de capçaleres només de confiança del proxy: x-real-ip
// (Vercel/nginx el posen net), i si no l'ÚLTIM salt de x-forwarded-for (el
// més proper al servidor). Mai el primer valor, que és el que envia el
// client i es pot suplantar per rotar identitats.

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Màxim de claus vives: memòria acotada per davall d'un atac d'IP rotatives. */
const MAX_BUCKETS = 10_000;
/** La poda completa corre com a màxim un cop per minut (mai al camí calent). */
const SWEEP_INTERVAL_MS = 60_000;

let lastSweepAt = 0;

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();

  // Poda amortitzada: com a molt un cop per minut, mai dins el camí calent.
  if (buckets.size >= MAX_BUCKETS && now - lastSweepAt >= SWEEP_INTERVAL_MS) {
    lastSweepAt = now;
    for (const [k, b] of buckets) {
      if (b.resetAt < now) buckets.delete(k);
    }
  }
  // Evicció O(1) en inserir si tot i així és ple (Map conserva l'ordre
  // d'inserció: la primera clau és la més vella). Substituir una entrada
  // antiga és preferible a créixer sense límit; mai no esborrem en bloc.
  if (buckets.size >= MAX_BUCKETS && !buckets.has(key)) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }

  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "local";
}
