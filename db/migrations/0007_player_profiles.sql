-- Perfil opcional del jugador. No s'utilitza per puntuar ni per ordenar
-- rànquings; només és visible per al mateix jugador.

CREATE TABLE player_profiles (
    player_id         uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    age               smallint CHECK (age IS NULL OR age BETWEEN 1 AND 120),
    gender            text CHECK (gender IS NULL OR gender IN (
        'dona', 'home', 'no_binari', 'altre', 'prefereixo_no_dir_ho'
    )),
    birth_place       text,
    residence_place   text,
    education_level   text CHECK (education_level IS NULL OR education_level IN (
        'sense_estudis', 'primaris', 'secundaris', 'fp', 'universitaris',
        'postgrau', 'prefereixo_no_dir_ho'
    )),
    languages_count   smallint CHECK (languages_count IS NULL OR languages_count BETWEEN 1 AND 100),
    native_catalan    boolean,
    updated_at        timestamptz NOT NULL DEFAULT now()
);
