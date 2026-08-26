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

**21 passos** (`SLIDER_STEPS`): valors enters **0..20**, confiança = k/20 —
resolució del 5%, centre exacte al 50% (el rang 0..N amb divisor N produïa un
centre fals del «52%», corregit). *(Actualització 22/08: el slider és ara el
format actiu per defecte; vegeu §9.)*

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

**Interacció (decisió Roger 22/08, revisió d'UX): sense botó de confirmar.**
La resposta s'emetrà quan s'allibera l'slider: arrossegant o picant directament
a la posició desitjada. Cobert amb `pointerup` (+ `touchend` de reserva, amb
bloqueig anti-doble enviament, i `Enter` per a teclat). L'agulla comença al 50%
i els camps de temps mesuren exactament igual que abans.

## 10. Mode convidat sense login (decisió Roger 22/08/2026)

«Juga ara» crea un jugador sense correu amb sessió en galeta de 180 dies (`SESSION_TTL_MS`): pot jugar,
veure resultats i sortir als rànquings amb sobrenom `convidat-*`. L'identitat
persistente es manté: si el convidat entra després amb correu, l'enllaç màgic
s'assigna al MATEIX jugador i conserva tot l'historial. Correu gratuït triat:
Resend via API HTTP (`RESEND_API_KEY`), sense dependències noves.

## 11. Puntuació visible per ítem

Els punts Pompeu de cada resposta (mateixa regla ε/K/W versionada) es mostren a
la pantalla de resultats, fila a fila, amb una línia que explica la regla.
Dins la partida res canvia: cap marcador en moviment (§3).

## 12. Sistema visual: la senyera surt del text (24/08/2026)

El tema definitiu continua sent E «alta tensió» (negre càlid, groc volt,
vermell de senyera, Anton als titulars). El que canvia és **com** hi és la
senyera. Fins ara la marca `LÈXIC.CAT` i el percentatge gran del resultat
duien les franges retallades DINS de les lletres (`background-clip: text`).
Amb nou franges dins d'una caixa d'Anton les astes queden tallades i tant la
marca com la xifra deixen de llegir-se: és decoració guanyant a la lectura,
just al revés del que convé a la peça que ha d'identificar el joc i a la que
n'és el resultat.

**Ara:** lletres plenes de groc amb el desplaçament vermell de la impressió a
dos colors (la parella cromàtica hi és, la lletra es llegeix), i la senyera com
a **element gràfic** propi: `--flag`, un sol degradat de nou franges en
percentatge que surt sencer i correcte a qualsevol mida. Es fa servir al filet
sota la marca, al quadradet de la barra superior, a la barra de progrés de la
partida, a la del mapa i —la que més hi guanya— a la **banda de l'IC95** dels
resultats, on el rang de l'interval ÉS la senyera i l'estimació puntual hi cau
com una agulla blanca.

**Altres decisions del mateix pas, totes de forma i cap de mecànica:**

- **Barra superior i peu permanents** (`components/Chrome.tsx`) amb els enllaços
  que ja existien escampats. A `/joc` desapareixen tots dos.
- **La partida és una pantalla, no un document**: `.shell.play` fa exactament
  `100dvh` sense desplaçament, i el joc és una graella de tres franges fixes
  —capçalera, platina, comandament—. Així la interfície de resposta cau
  SEMPRE al mateix píxel entre ítems, que és el que demanen les mesures de RT.
- **L'escala de seguretat es veu com el que és**: set posicions discretes
  dibuixades amb sis talls sobre la pista del semàfor, i el polze pintat del
  color de la zona (abans era un forat negre amb vora de color). Els tres
  retolats van en graella de tres columnes i ja no es trepitgen.
- **La platina de l'estímul** és un plafó amb vora i una lluïssor central
  fixa. És idèntica a cada ítem i no s'anima MAI: l'estímul apareix sempre
  sobre el mateix fons (§ regles sagrades).
- **Anton només porta el pes 400.** Qualsevol `font-weight: 700` el sintetitza
  el navegador i empasta la lletra; es desactiva a tot arreu on manem la font
  de titular.

## 13. Mode Kilian (24/08/2026)

Mode arcade binari amb rellotge, decisions del Roger del mateix dia.

- **Mateixa cria, mateix pool:** la selecció és exactament la de Pompeu
  (66/34 estratificats, refredament compartit per jugador entre modes,
  restricció de lema). Les respostes van a la MATEIXA taula `responses`
  amb `mode='killian'`, i per això el mapa i el lèxic personal compten
  igual juguis al mode que juguis. Els modes no es barregen mai en cap
  estimació: sense θ ni d′ kilianes, i `recomputeStandings` filtra
  explícitament `mode='pompeu'`.
- **Barra = puntuació:** lineal de 100 a 0 en 5 s (`KILIAN_BAR_MS`),
  arrodonida a múltiples de 5. Constant tota la partida (res d'escurçada).
  El servidor retalla al seu rang; sota 200 ms no hi ha punts ni ratxa
  (`rt_below_threshold`, ≥20% marca `suspect_fast` igual que a Pompeu).
- **Multiplicador ki-1:** graons cada 5 encerts (×1,2 a 5 … ×1,8 a 20),
  ×2 a 25, i a partir d'aquí +0,1 per cada 10 més: ×2,7 amb ratxa perfecta
  de 100. Sostre ×3 documentat, inabastable en una partida. Una partida
  perfecta instantània fa ~21.120 punts (sostre teòric). Un timeout trencarà
  la ratxa sempre: si no, esperar al límit seria l'estratègia dominant.
- **Cap asimetria de falses alarmes** (decisió Roger): FA i omissió valen
  el mateix error. El banc 66/34 ja protegeix del conservadorisme extrem
  (dir sempre «no» només cobra 34 de 100 ítems) i l'asimetria mouria el
  criteri de tota la població trencant la comparabilitat amb el calibratge.
- **Timeout:** no és un judici → `confidence` NULL (columna ara nullable),
  `response_kind='timeout'`, zero punts, ratxa a zero, fora de H/FA.
  Els judicis binaris entren al model graduat com a extrems (0,95/0,05):
  és el lexical decision clàssic de l'estudi.
- **Rànquings separats per mode:** pestanya Kilian amb la millor partida
  per punts; les taules de Pompeu filtren `mode='pompeu'`.
- **Miniaprenentatge només la primera partida de cada mode:** 3 exemples
  declarats al client (mai ítems del banc), amb el gest de swipe.
- **Feedback fora de l'escenari** (decisió Roger): el resultat cau a una
  ranura fixa del comandament, mai sobre la paraula. Encert 420 ms,
  error 700 ms (temps just per llegir què ha passat).
- **Integritat:** el servidor recalcula encert, punts i ratxa a cada
  resposta (el client només mostra); `elapsed_ms` el mesura el client i el
  servidor el retalla. La latència de xarxa queda dins el marge de gràcia
  (+300 ms); la detecció dura d'anomalies de ritme queda diferida fins tenir
  població pròpia.

### Esmenes de la revisió (24/08/2026, post-codi)

- **Font única de ratxa:** `submitResponse` llegeix l'últim `streak_after`
  persistit (mai un recompte sobre `is_correct`), així un encert <200 ms —que
  es desa amb ratxa 0— no pot ressuscitar mai; scoring, represa i agregats
  queden alineats per construcció.
- **`elapsed_ms` sempre retallat:** fora de rang només si és negatiu o no
  numèric; per damunt de barra+gràcia es retalla (un timeout automàtic amb la
  pestanya amagada registra un timeout normal, mai un 400).
- **Duplicats al client:** `duplicate:true` sincronitza amb `/api/game/state`,
  avança d'ítem o tanca a resultats — mai un blocatge al retry.
- **Rànquing Kilian:** el `DISTINCT ON` viu en una subconsulta sense límit i
  el top-50 se aplica ja ordenat per punts.
- **Índex 0006** (`responses(player_id,item_id) WHERE is_word`) per al
  recompte de paraules vistes; pols del mapa acotat a 3 iteracions.

### Ajustos d'UX (25/08/2026, decisió Roger)

- **El feedback entra a l'escenari** (revoca la decisió «fora de l'escenari»
  del 24/08): el resultat cau gran i centrat, just sota les paraules, per
  llegir-se d'un cop d'ull sense baixar la vista cap als botons. La caixa de
  l'estímul no es transforma ni s'anima: el pop és del propi feedback.
- **Confirmació immediata del swipe:** en soltar el gest la targeta queda
  decantada cap al costat triat (vora encesa + tic sonor/hàptic) mentre el
  servidor puntuà; l'espera de xarxa ja no es percep com una resposta perduda.
- **Botó de pausa a Kilian:** només amb la barra corrent; tapa tota la
  pantalla (l'estímul no es pot estudiar en pausa), congela la barra i
  l'`elapsed_ms` de l'ítem es desplaça el temps pausat — en continuar, els
  punts que toquen són els de la fracció de barra visible restant.
- **Botó «Juga» de Kilian groc** com el de Pompeu: mateixa crida a l'acció
  als dos modes de la portada.

## 14. Passada d'integritat, robustesa i UX (25/08/2026)

Revisió sistemàtica del projecte (bug fixes, seguretat, accessibilitat,
rendiment i producte). El que canvia decisions de fons:

- **El resultat Pompeu es calcula FORA de la transacció** de la darrera
  resposta: el MAP + lexicó + finestra poden trigar i mai han de tenir la
  partida bloquejada. La partida es tanca dins (status + flag de qualitat),
  i `finalizePompeuGame` corre després del COMMIT; si el procés mor a mig
  camí, `ensureGameResults` repara el forat a demanda des de /resultats.
  Idempotent per construcció (`ON CONFLICT DO NOTHING`). Kilian tanca igual
  que sempre (SQL agregat, barat).
- **Manteniment programat:** la poda de partides abandonades surt del camí
  calent (cada visita a /joc) i passa al cron `/api/cron/sweep`
  (`vercel.json`, horària; `CRON_SECRET` com a Bearer), que també poda
  sessions/tokens caducats (migració 0008: fora `sessions.last_seen_at`,
  índexs d'expiració).
- **L'enllaç màgic no canvia estat per GET:** el correu porta a
  `/entrar/verificar`, on el botó fa POST a `/api/auth/verify`. Un preview
  del correu no pot cremar el token. A més, `redeemMagicToken`,
  `createGuestSession` i `deleteAccount` són transaccionals: o passen del
  tot o no passen.
- **Rate limiting ampliat** (`start`, `response`, `state`, `mapa/claim`) amb
  poda de buckets i IP presa de capçaleres només de confiança (`x-real-ip`,
  o l'ÚLTIM salt de `x-forwarded-for`; mai el primer, suplantables).
- **Errors API uniformes** (`lib/server/apiError.ts`): els HttpError porten
  el seu missatge; qualsevol altra cosa es registra i respon genèric — cap
  missatge tècnic no arriba al client.
- **Guarda de reproduïbilitat a la ingesta:** re-ingestir un CSV diferent
  sota el mateix `itemBank` avorta (cal bumpar versió o forçar amb
  `ALLOW_ITEM_BANK_OVERWRITE=1`): les versions congelades no es reescriuen
  en silenci.
- **Model graduat dormant:** `lib/psychometrics/graded.ts` implementa
  `graded_2pl_map` (Samejima adaptat, criteri de persona c estimat amb θ;
  confiança recodificada en direcció de correcció, graella única de 11
  categories). Darrere de la interfície `estimateAbility`; activar-lo
  exigirà bumpar `calibration_version`. Validat amb recuperació sobre
  generació pròpia a `tests/graded.test.ts`.
- **Embut agregat sense tracking nou:** `/api/metrics/funnel` deriva
  iniciat → primer ítem → completat de les taules que ja existeixen
  (`ADMIN_TOKEN`; sense token, 404).
- **Client:** components compartits Pompeu/Kilian (estímul, progrés,
  carregant, pantalla de reintento amb detecció offline), auto-pausa de
  Kilian en amagar la pestanya (la barra mesura temps de paret), compte
  enrere anunciat a lectors de pantalla, diàleg de pausa modal de debò,
  constants centralitzades (cap literal de confiances ni «100»/«66»/«7»
  repetit).
- **PWA i descobriment:** manifest, icona, metadata OG/Twitter amb template,
  robots i sitemap, JSON-LD a la portada; `error.tsx` / `not-found.tsx` /
  `loading.tsx` en català.
- **Pes:** fora Fraunces i JetBrains Mono (temes morts) i ~450 línies de CSS
  mort; backdrop del mapa en idle; tooltip del mapa per refs (mai un
  re-render per píxel); estímuls llargs (fins a 12 caràcters) encoixinats.
- **ESLint adoptat** (`eslint-config-next`, pla): `npm run lint`.

### 14.1 · Correccions de la revisió posterior (25/08/2026)

La revisió sistemàtica del canvi va trobar punts que s'han corregit alhora:

- **Cron diari i falla tancada:** el manteniment passa a `0 3 * * *` (el
  horari trencava el deploy del pla gratuït de Vercel) i `/api/cron/sweep`
  respon 401 en producció si falta `CRON_SECRET` — la configuració que falta
  ha de ser sorollosa, mai una porta oberta.
- **Finalització atòmica i exclusiva:** `finalizePompeuGame` corre sota lock
  advisory per partida (`pg_advisory_xact_lock`) dins UNA transacció que hi
  escriu resultats I finestra plegats; si alguna peça falta (procés mort a
  mig camí), `ensureGameResults` reparen exactament la que falta. Mai doble
  càlcul, mai standings oblidats.
- **Standings mai sobre un compte esborrat:** l'upsert de
  `player_standings` és condicional a `players.deleted_at IS NULL`, tanmateix
  en INSERT com en UPDATE: cap carrera amb l'eliminació GDPR no ressuscita
  dades derivades d'una identitat anonimitzada.
- **URL del correu màgic:** mai derivada del Host de la petició en
  producció self-hosted (enverinable); `APP_BASE_URL` mana, a Vercel l'origin
  és fiable, i sense cap de les dues en producció es nega a enviar.
- **Rate limit amortitzat:** la poda completa corre com a molt un cop per
  minut i l'evicció en inserir és O(1); fora el `clear()` en bloc que
  resetejava límits a tothom.
- **401 només per sessió:** les rutes ja no atrapen errors de DB com a «Sessió
  requerida»: tot surt pel mapa central (`apiErrorResponse`) i un error
  d'infraestructura arriba com a 500 genèric.
- **Kilian, un sol camí de resposta:** `handleResponseData` únic per a
  enviament normal i reintento (la còpia del reintento havia perdut el
  prefetch) i tots els fetch passen pel tractament d'errors compartit.
- **CSP report-only** i `X-Robots-Tag: noindex` als previews de Vercel.

## 15. Segona passada d'integritat, rendiment i operació (26/08/2026)

Revisió completa del codi existent. El que canvia decisions anteriors:

- **La pausa de Kilian deixa de regalar temps** (supera el comportament de
  §14): tapar l'estímul no tapa la memòria — pensar durant la pausa i respondre
  amb la barra gairebé plena era un forat de puntuació. Ara el temps pausat
  compta: en reprendre, la barra torna retallada el que ha durat la pausa (i
  si s'ha esgotat, timeout). La pausa automàtica per pestanya amagada segueix
  la mateixa regla.
- **Els temps els acota el servidor:** `game_items.served_at` (migració 0009)
  marca quan es serveix cada posició; a `submitResponse`, l'elapsed de Kilian i
  el RT de Pompeu queden acotats pel temps de paret del servidor (sostre físic
  + sòl amb tolerància `SERVE_OVERHEAD_MS` per a xarxa/render/prefetch). Un
  client modificat ja no pot declarar temps impossibles; sense `served_at`
  (partides velles) només es retalla al rang de la barra com abans.
- **Rate limit compartit entre instàncies:** buckets a la taula
  `rate_limit_buckets` (upsert atòmic); el comptador en memòria per procés feia
  el límit real N vegades el declarat amb N lambdes. Falla tancat si la taula
  no hi és; la poda és del sweep.
- **Rànquings sense empats ballants:** desempat determinista a totes les
  taules (mateix valor → guanya qui el va assolir abans → `player_id`), també
  a la fila «la teva posició». I el top N públic ve de caché (`unstable_cache`,
  60 s): les pàgines són force-dynamic però la consulta pesada no corre a cada
  petició.
- **Dubte 6 aplicat:** fora «Millors partides · lexicó» (correlació 0,997 amb
  «encerts»): dos taulers per a una sola cosa. El lexicó ponderat queda només
  al rànquing general.
- **Esborrament coherent amb /privadesa:** `deleteAccount` també esborra
  `player_regions` i `item_exposure` (dades derivades d'una identitat que es
  pseudonimitza), i el text legal descriu exactament què es conserva
  (respostes en cru, lligades a un identificador opac) i què no — sense
  prometre cap esborrament condicional que el codi no fa.
- **Caché del banc infinita:** el banc és immutable per versió; el TTL d'1 minut
  pagava la consulta sencera (~71k files) innecessàriament a cada cold start.
- **Abandonaments distingibles:** començar partida nova escriu
  `abandoned_reason = 'nova_partida'`; marxar explícitament continua sent
  `'usuari'`.
- **Mapa compacte més prim:** passada de precisió flotant (1 decimal) al
  generador — 425 KB → ~357 KB raw, ~155 KB → ~119 KB gzip, visualment
  idèntic sobre un viewBox de 3121×5016.
- **Caché dels SVG del mapa:** `:path+` (mai `:path*`, que també capturava la
  PÀGINA /mapa amb caché immutable d'un any) i `max-age` curt: els noms de
  fitxer no porten hash.
- **CI:** workflow de GitHub Actions (typecheck + lint + test) a cada push/PR;
  `npm test` inclou `tests/profile.test.ts`, que quedava fora.
- **Accessibilitat:** la paraula estimul s'anuncia per regió viva als dos modes.
- **Docs alineats amb el codi:** galeta de sessió de 180 dies (no «d'1 any»),
  fora `AUTH_SECRET` (cap línia de codi la fa servir), `INSTABILITY_SE = 0,278`
  marcat com a provisional (estudi previ, altre format, retest immediat).
