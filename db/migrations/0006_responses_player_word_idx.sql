-- Rendiment: el recompte de paraules reals vistes (wordsSeenCount, lib/server/
-- mapa.ts) corre a portada, /mapa, resultats i /api/mapa en cada petició. Sense
-- aquest índex és un full-scan de TOTA la taula responses (tots els jugadors);
-- amb ell, un index-only scan acotat a les files del jugador.
CREATE INDEX IF NOT EXISTS responses_player_word_idx
    ON responses (player_id, item_id) WHERE is_word;
