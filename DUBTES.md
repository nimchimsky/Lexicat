# Dubtes oberts

Coses que aquesta implementació NO decideix sola. Si alguna es resol, cal
actualitzar `DECISIONS.md` i, si toca, bumpar la versió corresponent.

1. **Conjunt de referència ref-2: només lemes?** El 81,7% de les 40.773 formes
   són lemes; avui `cantar` i `cantaves` compten com a dues unitats i poden
   sortir a la mateixa partida. Implementat com a `ref-1` (totes les formes),
   tal com demana §12.8. Roger confirma que encara no està decidit. Quan es
   decideixi: crear `ref-2`, recalcular `in_reference_corpus`, bumpar
   `reference_corpus_version` i re-emitir els resultats que es vulguin comparar.

2. **Slider o botons?** Resolt provisionalment amb botons (RT de referència
   coneguts), però la decisió definitiva «es prendrà mesurant»: el registre
   guarda `response_format`, `time_to_first_input_ms`, `response_time_ms` i
   `n_adjustments` precisament per decidir-ho amb població pròpia. Els dos
   formats ja conviuen darrere d'una constant.

3. **Inestabilitat entre sessions (0,278 logits).** Ve d'un estudi amb un altre
   format de resposta sobre gent autoseleccionada que repetia visita. Quan hi
   hagi prou jugadors recurrents, tornar-la a mesurar amb població pròpia i
   actualitzar `INSTABILITY_SE` (bumpant `calibration_version` si mou
   intervals publicats).

4. **Percentil contra població no neutra.** La taula `pob-1` ve de l'estudi
   (mediana 53 anys, dos terços universitaris, edat↔θ r = 0,313). La interfície
   ho declara sempre. Caldrà substituir-la per una taula pròpia quan n'hi hagi.

5. **Llicències.** Llista de paraules de la URV; definicions de l'IEC (només
   s'enllaça); freqüències tipus VeLeCa CC BY-NC. Aquesta implementació no fa
   servir res més enllà del CSV de calibratge llegit com a origen. Si el projecte
   esdevé comercial o vol mostrar qualsevol text de definició: aturar-se i
   revisar abans.

6. **Rànquings 1 i 2 gairebé bessons (Spearman 0,997).** Mesurat a l'arnès.
   L'especificació ho anticipava (§4.5) i deia «digues-ho»: dit queda. Decisió
   pendent per al Roger: mantenir les dues llistes (narrativa diferent), fusionar-
   les, o redissenyar la mètrica del 2 sabent que cap ponderació monòtona en θ
   baixarà gaire la correlació.

7. **Contracció del MAP als extrems.** Amb el prior N(0, 0,624²) exigit, un
   jugador de θ real = ±1 surt amb θ̂ ≈ ±0,73–0,88 (contracció inherent, mesurada
   a l'arnès). El biaix <0,02 del criteri 4 es compleix a θ=0; als extrems el
   prior domina per disseny (és el que evita θ infinits). Si mai es vol menys
   contracció cal canviar el prior i bumpar `calibration_version`.

8. **Mailer de producció.** L'enllaç màgic té punt únic d'integració a
   `lib/server/mailer.ts`; falta triar proveïdor (SMTP propi vs API externa).
   En local funciona sense cap servei extern.
