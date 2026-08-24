-- Mode Kilian: partida arcade binària amb barra de temps i ratxes.
-- Mateix banc, mateixa selecció estratificada i mateixes respostes (el mapa,
-- el lèxic personal i el refredament deriven d'aquí); el que canvia és el
-- format de resposta (binari amb temps), la puntuació (ki-1) i els rànquings
-- (separats per mode). Els modes no es barregen mai en cap estimació.

-- ---------------------------------------------------------------------------
-- Partides: mode de joc i format binari
-- ---------------------------------------------------------------------------

ALTER TABLE games ADD COLUMN mode TEXT NOT NULL DEFAULT 'pompeu';
ALTER TABLE games ADD CONSTRAINT games_mode_check CHECK (mode IN ('pompeu','killian'));

ALTER TABLE games DROP CONSTRAINT games_response_format_check;
ALTER TABLE games ADD CONSTRAINT games_response_format_check
    CHECK (response_format IN ('slider','buttons','binary'));

-- ---------------------------------------------------------------------------
-- Respostes: judici binari, temps des de l'aparició i puntuació Kilian
-- ---------------------------------------------------------------------------

-- El timeout no és un judici de confiança: queda registrat amb confidence NULL.
ALTER TABLE responses ALTER COLUMN confidence DROP NOT NULL;

ALTER TABLE responses ADD COLUMN mode TEXT NOT NULL DEFAULT 'pompeu';
ALTER TABLE responses ADD COLUMN response_kind TEXT NOT NULL DEFAULT 'answer'
    CHECK (response_kind IN ('answer','timeout'));
-- Temps mesurat pel client des que l'estímul apareix fins a l'entrada (ms).
ALTER TABLE responses ADD COLUMN elapsed_ms INTEGER;
ALTER TABLE responses ADD COLUMN input_method TEXT
    CHECK (input_method IS NULL OR input_method IN ('swipe','button','key'));
-- Puntuació Kilian d'aquesta resposta (NULL als modes Pompeu) i estat de ratxa.
ALTER TABLE responses ADD COLUMN points INTEGER;
ALTER TABLE responses ADD COLUMN streak_after INTEGER;
ALTER TABLE responses ADD COLUMN multiplier NUMERIC(4,2);

CREATE INDEX IF NOT EXISTS responses_killian_idx ON responses (game_id) WHERE mode = 'killian';

-- ---------------------------------------------------------------------------
-- Resultats: columnes pròpies del mode Killian; les psicomètriques passen a
-- ser NULLables perquè una partida Kilian no s'estima amb θ ni amb d′.
-- ---------------------------------------------------------------------------

ALTER TABLE game_results ADD COLUMN mode TEXT NOT NULL DEFAULT 'pompeu';
ALTER TABLE game_results ALTER COLUMN theta DROP NOT NULL;
ALTER TABLE game_results ALTER COLUMN se_theta DROP NOT NULL;
ALTER TABLE game_results ALTER COLUMN se_total DROP NOT NULL;
ALTER TABLE game_results ALTER COLUMN pct_lexicon DROP NOT NULL;
ALTER TABLE game_results ALTER COLUMN pct_lo DROP NOT NULL;
ALTER TABLE game_results ALTER COLUMN pct_hi DROP NOT NULL;
ALTER TABLE game_results ALTER COLUMN percentile DROP NOT NULL;
ALTER TABLE game_results ALTER COLUMN d_prime DROP NOT NULL;
ALTER TABLE game_results ALTER COLUMN criterion DROP NOT NULL;
ALTER TABLE game_results ALTER COLUMN lexicon_game_score DROP NOT NULL;

ALTER TABLE game_results ADD COLUMN best_streak INTEGER;
ALTER TABLE game_results ADD COLUMN max_multiplier NUMERIC(4,2);
ALTER TABLE game_results ADD COLUMN n_timeouts INTEGER;

CREATE INDEX IF NOT EXISTS game_results_killian_idx
    ON game_results (score DESC) WHERE mode = 'killian';
