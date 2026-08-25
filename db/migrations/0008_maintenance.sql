-- Manteniment i higiene:
--  · sessions.last_seen_at no es llegia ni s'actualitzava mai: fora.
--  · Índexs per a la poda programada de sessions i tokens caducats
--    (/api/cron/sweep), que abans corria al camí calent de cada visita.

ALTER TABLE sessions DROP COLUMN IF EXISTS last_seen_at;

CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS auth_tokens_expires_idx ON auth_tokens (expires_at);
