-- Grup de lema per aplicar la regla "un lema i cap de les seves formes
-- flexionades a la mateixa partida" (decisió del Roger, 22/08/2026).
--
-- El CSV de calibratge NO porta cap columna de lema, així que la ingesta la
-- deixa NULL (cap restricció activa) fins que tinguem el mapatge morfològic.
-- El mecanisme de selecció ja el respecta quan els valors existeixen.

ALTER TABLE items ADD COLUMN IF NOT EXISTS lemma_key text;
CREATE INDEX IF NOT EXISTS items_lemma_idx ON items (bank_version, lemma_key) WHERE lemma_key IS NOT NULL;

