-- Mapa dels Països Catalans (decisió Roger 23/08/2026): a mesura que el
-- jugador respon paraules reals noves acumula zones (1 per cada ~1% del banc)
-- que pot reclamar a qualsevol regió fosca del mapa. El progrés no es desa:
-- es deriva de responses (paraules reals úniques) i les zones reclamades
-- viuen aquí. Sense fila = regió fosca.

CREATE TABLE IF NOT EXISTS player_regions (
    player_id  uuid        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    region_id  text        NOT NULL,  -- id del catàleg (territori--slug), ex. catalunya--alt-camp
    claimed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, region_id)
);
CREATE INDEX IF NOT EXISTS player_regions_recent_idx ON player_regions (claimed_at DESC);
