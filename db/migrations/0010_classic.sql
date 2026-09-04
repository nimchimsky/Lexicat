-- Mode Clàssic: 100 judicis binaris, sense rellotge ni feedback per ítem.
-- Reutilitza response_format='binary'; la puntuació cl-1 només depèn dels
-- encerts en paraules i de les falses alarmes.

ALTER TABLE games DROP CONSTRAINT games_mode_check;
ALTER TABLE games ADD CONSTRAINT games_mode_check
    CHECK (mode IN ('pompeu','killian','classic'));

CREATE INDEX IF NOT EXISTS games_ranking_classic_idx
    ON games (player_id, mode, status)
    WHERE status = 'completed' AND quality_flag IS NULL;

CREATE INDEX IF NOT EXISTS game_results_classic_idx
    ON game_results (score DESC) WHERE mode = 'classic';
