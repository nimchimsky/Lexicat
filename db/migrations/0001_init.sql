-- Mode Pompeu · esquema inicial.
-- Identitat persistent, versionat quadruple i registre per resposta des del primer commit.

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Jugadors i identitat
-- ---------------------------------------------------------------------------

CREATE TABLE players (
    id          uuid PRIMARY KEY,
    email       citext UNIQUE,
    nickname    citext UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    prefs       jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- L'eliminació GDPR anonimitza la fila però conserva l'id:
    -- les respostes ja entrada al calibratge no es perden ni es deslligen.
    CONSTRAINT players_email_present CHECK (deleted_at IS NOT NULL OR email IS NOT NULL)
);

-- Tokens d'un sol ús de l'enllaç màgic (es desa només el hash).
CREATE TABLE auth_tokens (
    id          uuid PRIMARY KEY,
    email       citext NOT NULL,
    token_hash  bytea NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_ip  inet,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_email_idx ON auth_tokens (email, created_at DESC);

CREATE TABLE sessions (
    id          uuid PRIMARY KEY,
    player_id   uuid NOT NULL REFERENCES players(id),
    token_hash  bytea NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Banc d'ítems i població de referència
-- ---------------------------------------------------------------------------

CREATE TABLE item_bank_versions (
    version            text PRIMARY KEY,
    source_csv_sha256  text NOT NULL,
    ingested_at        timestamptz NOT NULL DEFAULT now(),
    n_words            integer NOT NULL,
    n_pseudowords      integer NOT NULL,
    n_word_strata      integer NOT NULL,
    n_pseudo_strata    integer NOT NULL,
    b_min              real NOT NULL,
    b_max              real NOT NULL
);

CREATE TABLE items (
    item_id              integer PRIMARY KEY,
    form                 text NOT NULL,
    is_word              boolean NOT NULL,
    a                    real NOT NULL,        -- irt2pl_discrimination
    b                    real NOT NULL,        -- irt2pl_difficulty
    b_rasch              real NOT NULL,        -- irt_difficulty_rasch
    median_rt_ms         integer,
    accuracy_raw         real,
    word_stratum_id      integer,              -- 1..66 si és paraula
    pseudo_stratum_id    integer,              -- 1..34 si és pseudoparaula
    bank_version         text NOT NULL REFERENCES item_bank_versions(version),
    in_reference_corpus  boolean NOT NULL,
    active               boolean NOT NULL DEFAULT true,
    UNIQUE (bank_version, form)
);
CREATE INDEX items_selection_idx ON items (bank_version, active, is_word, word_stratum_id) WHERE is_word;
CREATE INDEX items_selection_pseudo_idx ON items (bank_version, active, is_word, pseudo_stratum_id) WHERE NOT is_word;
CREATE INDEX items_refcorpus_idx ON items (bank_version, in_reference_corpus) WHERE in_reference_corpus;

-- Distribució de θ de la població de referència (per al percentil), versionada.
CREATE TABLE theta_population_versions (
    version     text PRIMARY KEY,
    source      text NOT NULL,
    n           bigint NOT NULL,
    bins        jsonb NOT NULL,   -- [{ "lo": -5.25, "hi": -5.0, "n": 3 }, ...]
    loaded_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Partides
-- ---------------------------------------------------------------------------

CREATE TABLE games (
    id                         uuid PRIMARY KEY,
    player_id                  uuid NOT NULL REFERENCES players(id),
    player_game_index          integer NOT NULL,   -- 1r, 2n… partida del jugador
    status                     text NOT NULL DEFAULT 'in_progress'
                               CHECK (status IN ('in_progress','completed','abandoned')),
    started_at                 timestamptz NOT NULL DEFAULT now(),
    finished_at                timestamptz,
    abandoned_at_position      integer,
    abandoned_reason           text CHECK (abandoned_reason IN ('nova_partida','inactivitat','usuari')),
    game_seed                  text NOT NULL,
    item_bank_version          text NOT NULL REFERENCES item_bank_versions(version),
    reference_corpus_version   text NOT NULL,
    calibration_version        text NOT NULL,
    scoring_version            text NOT NULL,
    response_format            text NOT NULL CHECK (response_format IN ('slider','buttons')),
    slider_steps               integer,
    device_class               text CHECK (device_class IN ('mobile','tablet','desktop')),
    relaxed_strata             jsonb NOT NULL DEFAULT '[]'::jsonb,
    quality_flag               text CHECK (quality_flag IN ('suspect_fast'))
);
CREATE INDEX games_player_idx ON games (player_id, started_at DESC);
CREATE INDEX games_in_progress_idx ON games (player_id) WHERE status = 'in_progress';

-- Composició sencera, escrita ABANS de servir el primer ítem.
CREATE TABLE game_items (
    game_id     uuid NOT NULL REFERENCES games(id),
    position    integer NOT NULL CHECK (position BETWEEN 1 AND 1000000),
    item_id     integer NOT NULL REFERENCES items(item_id),
    stratum_id  integer NOT NULL,
    is_word     boolean NOT NULL,
    PRIMARY KEY (game_id, position)
);
CREATE INDEX game_items_item_idx ON game_items (item_id);

-- ---------------------------------------------------------------------------
-- Respostes
-- ---------------------------------------------------------------------------

CREATE TABLE responses (
    response_id                uuid PRIMARY KEY,
    game_id                    uuid NOT NULL REFERENCES games(id),
    player_id                  uuid NOT NULL REFERENCES players(id),
    item_id                    integer NOT NULL REFERENCES items(item_id),
    position_in_game           integer NOT NULL,
    stratum_id                 integer NOT NULL,
    is_word                    boolean NOT NULL,
    confidence                 real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    response_format            text NOT NULL,
    slider_steps               integer,
    is_correct                 boolean NOT NULL,
    fifty_fifty                boolean NOT NULL,
    rt_below_threshold         boolean NOT NULL DEFAULT false,
    item_bank_version          text NOT NULL,
    reference_corpus_version   text NOT NULL,
    calibration_version        text NOT NULL,
    scoring_version            text NOT NULL,
    time_to_first_input_ms     integer,
    response_time_ms           integer,
    n_adjustments              integer,
    device_class               text,
    n_previous_games           integer NOT NULL,
    client_submitted_at        timestamptz,
    created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX responses_game_idx ON responses (game_id, position_in_game);
-- Idempotència: mai dues respostes per al mateix ítem dins la mateixa partida.
CREATE UNIQUE INDEX responses_game_item_uniq ON responses (game_id, item_id);

-- ---------------------------------------------------------------------------
-- Resultats i agregats
-- ---------------------------------------------------------------------------

CREATE TABLE game_results (
    game_id                   uuid PRIMARY KEY REFERENCES games(id),
    n_responses               integer NOT NULL,
    theta                     real NOT NULL,
    se_theta                  real NOT NULL,
    se_total                  real NOT NULL,
    pct_lexicon               real NOT NULL,
    pct_lo                    real NOT NULL,
    pct_hi                    real NOT NULL,
    percentile                real NOT NULL,
    d_prime                   real NOT NULL,
    criterion                 real NOT NULL,
    n_correct                 integer NOT NULL,
    n_false_alarms            integer NOT NULL,
    n_fifty_fifty             integer NOT NULL,
    score                     integer NOT NULL,
    lexicon_game_score        real NOT NULL,       -- mètrica del rànquing 2
    calibration_version       text NOT NULL,
    reference_corpus_version  text NOT NULL,
    scoring_version           text NOT NULL,
    computed_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX game_results_hits_idx ON game_results (n_correct DESC);
CREATE INDEX game_results_lexgame_idx ON game_results (lexicon_game_score DESC);

-- Finestra de rànquings generals (últimes N partides completes vàlides).
CREATE TABLE player_standings (
    player_id            uuid PRIMARY KEY REFERENCES players(id),
    window_size          integer NOT NULL,
    n_games              integer NOT NULL,
    mean_hits            real NOT NULL,
    theta_pooled         real NOT NULL,
    se_theta_pooled      real NOT NULL,
    se_total             real NOT NULL,
    pct_lexicon          real NOT NULL,
    pct_lo               real NOT NULL,
    pct_hi               real NOT NULL,
    percentile_pooled    real NOT NULL,
    mean_score           real NOT NULL,
    last_game_id         uuid NOT NULL REFERENCES games(id),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX standings_hits_idx ON player_standings (mean_hits DESC);
CREATE INDEX standings_pct_idx ON player_standings (pct_lexicon DESC);

-- Refredament d'ítems per jugador.
CREATE TABLE item_exposure (
    player_id       uuid NOT NULL REFERENCES players(id),
    item_id         integer NOT NULL REFERENCES items(item_id),
    last_game_id    uuid NOT NULL REFERENCES games(id),
    last_game_index integer NOT NULL,
    times_seen      integer NOT NULL DEFAULT 1,
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, item_id)
);

-- Registre d'operacions sensibles de selecció (estrats relaxats, etc.).
CREATE TABLE selection_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    game_id     uuid NOT NULL REFERENCES games(id),
    event       text NOT NULL,
    detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

