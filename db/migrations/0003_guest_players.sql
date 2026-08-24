-- Mode convidat (decisió Roger 22/08/2026): es pot jugar sense cap correu.
-- El CHECK original exigia email si la fila no està esborrada; els convidats
-- tenen email NULL amb sessió pròpia en galeta, així que el retirem.

ALTER TABLE players DROP CONSTRAINT IF EXISTS players_email_present;

