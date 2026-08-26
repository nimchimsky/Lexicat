-- Passada d'integritat, rendiment i operació:
--   · game_items.served_at: quan es va servir cada posició. Permet al
--     servidor acotar el temps declarat pel client (el client només pot
--     haver vist l'estímul després de servir-se).
--   · games.relaxed_strata: el codi hi escriu un objecte {cooldown, lemma};
--     el default '[]' era d'una altra època i mai no s'usa.
--   · Índexs parcials amb el predicat d'elegibilitat dels taulers
--     (DISTINCT ON per jugador a cada petició de rànquings).
--   · rate_limit_buckets: el limitador de taxa passa de memòria per procés
--     a una taula compartida (amb N lambdes de Vercel el límit en memòria
--     és N vegades el declarat).

ALTER TABLE game_items ADD COLUMN IF NOT EXISTS served_at timestamptz;

ALTER TABLE games ALTER COLUMN relaxed_strata SET DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS games_ranking_pompeu_idx
    ON games (player_id, mode, status)
    WHERE status = 'completed' AND quality_flag IS NULL;
CREATE INDEX IF NOT EXISTS games_ranking_killian_idx
    ON games (player_id, mode, status)
    WHERE status = 'completed' AND quality_flag IS NULL;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key text        PRIMARY KEY,
    count      integer     NOT NULL,
    reset_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_reset_idx ON rate_limit_buckets (reset_at);
