# Decisions preses i documentades

Cada entrada té el motiu. Els números de referència venen de `REVISIO_MODE_POMPEU.md`
i del prompt d'implementació.

## 1. Valors de ε i K, i mapatge de b → W_i

- **ε = 0,02** (`SCORING_EPSILON`, `lib/config.ts`). Amb ε = 0,02 la ràtio
  càstig/premi és 4,6:1; amb 0,01 puja a 5,7:1 i cent ítems fan una partida
  frustrant. 0,02 és el punt on l'error segur encara dol, però un sol error no
  s'emporta cinc encerts.
- **K = 10** (`SCORE_K`). La puntuació per ítem va de 0 a ~56 punts i una
  partida bona ronda els 3.000–4.000: xifres grans, llegibles i amb marge per
  millorar sense decimals.
- **W_i = 1 + 2·clamp((b − b_min)/(b_max − b_min), 0, 1)**, mapatge lineal de la
  `b` REAL de l'ítem servit a [1, 3]. Els extrems b_min/b_max surten del banc
  ingesting (`item_bank_versions.b_min/b_max`), no de constants al codi, i
  queden fixats per la versió del banc. Mai depèn de la resposta.
- **La puntuació visible aplica K al producte ponderat i desplaçat**:
  `display_i = round(K · W_i · (S_i − S_min))`. Com que W > 0 és una
  transformació afí positiva, l'ordre i la propietat incentiu de la regla es
  mantenen i el mínim és exactament zero (criteri 14).

## 2. Regla de desempat per a les respostes de 50%

- **Per a l'estimació de θ i per a l'encert cru**: confiança exactament 0,5
  compta com a resposta «no és paraula» (`binarize`: x_i = 1 ⟺ confiança > 0,5).
  Determinista, coherent a servidor i client, i documentada a `lib/config.ts`
  (`TIE_RULE`). És conservadora: no prem acceptar sense decantar-se.
- **Per a d′/criteri i per a la mètrica del rànquing 2**: les respostes de
  exactament 50% **s'exclouen** dels denominadors de H i FA i es compten a part
  (`n_fifty_fifty`), com marca §4.4.

## 3. Mapatge dels cinc botons discrets

`segur que NO = 0,05 · crec que no = 0,25 · no ho sé = 0,5 · crec que sí =
0,75 · segur que SÍ = 0,95` (`BUTTON_CONFIDENCE`).

Simètrics respecte del 0,5, amb separació suficient perquè cada categoria
produeixi una puntuació diferent, i sense extrems 0/1 (que la regla logarítmica
hauria de retallar sempre). El mateix tipus de dada que el slider: una
probabilitat a [0,1].

## 4. Nombre de passos del slider

**21 passos** (`SLIDER_STEPS`) — resolució de 5%: suficient per distingir
nivells de confiança reals sense fer tediosa la resposta en pantalla tàctil,
i divisible en els mateixos punts simèctrics que els botons (k/21 ≈ categories).
*(Actualització 22/08: el slider és ara el format actiu per defecte; vegeu §9.)*

## 5. Mètrica exacta del rànquing 2 i correlació amb l'1

```
base    = Σ_{paraules acceptades} W_i / Σ_{paraules} W_i      (encert ponderat per dificultat)
penal   = (FA + 0,5) / (n_pseudo + 1)                          (FA corregida loglinealment)
mètrica = clamp(base − 0,5 · penal, 0, 1)
```

- Pondera per la dificultat real (les paraules rares valen més), penalitza les
  falses alarmes (el jugador permissiu no pot pujar-hi), i queda acotada [0,1].
- Les respostes de 50% exacte queden fora dels dos termes, igual que a d′.
- **Correlació mesurada amb l'1 (Spearman, `npm run simulate`, 400 jugadors
  sintètics θ~N(0, 0,624²)): 0,997.** Com avisava REVISIO §4.5, són dues llistes
  gairebé bessones: totes dues són funcions monòtones del mateix θ i cap
  ponderació raonable ho desfer. Es mantenen les dues tal com demana
  l'especificació (encert cru és el més defensable; el de lexicó dona una
  narrativa), però queda dit: si algun dia cal triar, el candidat a desaparèixer
  és el 2. Vegeu `DUBTES.md`.

## 6. Llindar de temps mínim i definició de partida abandonada

- **RT < 200 ms** marca la resposta (`rt_below_threshold`); referència: a
  l'estudi només el 0,137% del conjunt hi era sense cap filtre. Es marca, no
  s'esborra.
- **≥ 20% de respostes sota el llindar** marca la partida `quality_flag =
  'suspect_fast'`: surt dels quatre rànquings i de la finestra general, però es
  conserva tota (§9: «marca, no esborris»).
- **Abandonada =** partida `in_progress` quan (a) el jugador comença una de
  nova (`abandoned_reason='usuari'`, posició = última responduda), o (b) porta
  més de **24 h** sense activitat (`inactivitat`, sweep mandró a cada accés de
  joc). L'estudi no en va registrar cap, així que la definició és conservadora
  i explícita, i la posició on va quedar sempre es desa (criteri 15).

## 7. Refredament entre partides

**Confirmades les 50 partides** (`COOLDOWN_GAMES`). Motiu: una pseudoparaula ben
rebutjada torna a rebutjar-se el 97,3% dels cops i 211 ms més ràpid; no hi ha
dades d'oblidament més enllà d'11 dies, així que conservador. Amb fons de
30.209 pseudoparaules / 34 per partida, cap estrat no s'hauria d'exhaurir mai;
si passa, la relaxació és només per aquell estrat i queda registrada a
`games.relaxed_strata` i a `selection_log`.

## 8. Conjunt de referència: lemes o formes

Implementat **com és avui: totes les formes flexionades, versió `ref-1`,
denominador 40.773 paraules**, amb el camí obert a `ref-2`: la versió viu a
`games.reference_corpus_version` i al flag `items.in_reference_corpus`; un futur
ref-2 (només lemes) és una nova versió amb el flag recalculat, mai una mutació
silenciosa del denominador.

**Actualització (decisió Roger 22/08/2026):** un lema i les seves formes no
poden sortir mai a la MATEIXA partida (`items.lemma_key` + restricció de
selecció; migració 0002). El denominador continua sent ref-1 de formes; el
mapatge forma→lema és l'únic pendent real (vegeu DUBTES.md).

## 9. Slider actiu per defecte (decisió Roger 22/08/2026)

`ACTIVE_RESPONSE_FORMAT = "slider"` amb 21 passos. Els cinc botons continuen
implementats darrere la mateixa constant (l'especificació exigeix els dos
formats commutables per decidir «mesurant»); el registre per resposta conserva
`response_format`, `time_to_first_input_ms`, `response_time_ms` i
`n_adjustments`, que són exactament el que cal per comparar formats amb
població pròpia.

## 10. Mode convidat sense login (decisió Roger 22/08/2026)

«Juga ara» crea un jugador sense correu amb sessió en galeta d'1 any: pot jugar,
veure resultats i sortir als rànquings amb sobrenom `convidat-*`. L'identitat
persistente es manté: si el convidat entra després amb correu, l'enllaç màgic
s'assigna al MATEIX jugador i conserva tot l'historial. Correu gratuït triat:
Resend via API HTTP (`RESEND_API_KEY`), sense dependències noves.

## 11. Puntuació visible per ítem

Els punts Pompeu de cada resposta (mateixa regla ε/K/W versionada) es mostren a
la pantalla de resultats, fila a fila, amb una línia que explica la regla.
Dins la partida res canvia: cap marcador en moviment (§3).
