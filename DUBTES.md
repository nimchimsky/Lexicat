# Dubtes oberts

Actualitzat amb les respostes del Roger del 22/08/2026. El que queda tancat hi
surt com a **RESOLT**, amb l'acció feta al costat.

---

## RESOLT · 9. El mapa dels Països Catalans com a metaprogrés (23/08/2026)

**Proposta del Roger:** amb el paquet cartogràfic de `../Mapa` (100 unitats,
just les que calen), a mesura que respones paraules guanyes zones que tries
lliurement, fins tenir tots els Països Catalans pintats. També integrar-ho a
la portada i fer una variant amb les illes i enclavaments reubicats.

**Decisions del Roger (23/08/2026):**

1. **Compta:** paraules reals úniques VISTES (encertades o no). Les
   pseudoparaules no compten. Amb el banc net (40.773 paraules reals: el CSV
   en té 40.777 i la ingesta en exclou 4 sense DIEC) surt 1 zona per cada
   ~408 paraules ≈ 6-7 partides, i la zona 100 cau exactament a l'última
   paraula del banc.
2. **Preu:** pla. Totes les zones valen una fitxa; l'estratègia (illa gran vs
   moltes de petites) en surt sola.
3. **On es reclama:** CTA a la pantalla de resultats quan hi ha fitxa pendent,
   i sempre a `/mapa` (selector en dos passos: tocar + confirmar).
4. **Portada:** variant COMPACTE (illes en quadre-inset, Alguer i Carxe en
   medallons), generada per `scripts/build-compact-map.ts`; el mapa
   geogràfic mestre queda a `/mapa` amb commutador.

**Fet:** migració 0004 (`player_regions`), `lib/mapa/` (llindars + catàleg),
`lib/server/mapa.ts` (vista derivada de `responses` + reclam transaccional
amb bloqueig de jugador), `GET /api/mapa`, `POST /api/mapa/claim`,
components `MapaCatala`/`MapaClient`, pàgina `/mapa`, bloc de mapa a
resultats i portada, tests unitaris d'llindars i d'integració (flux sencer +
concurrença). El progrés no es desa mai: es deriva de `responses`; només es
desen les zones ja col·locades.

## RESOLT · 1. Lemes i formes (era: «ref-2 només lemes?»)

**Decisió del Roger:** `cantar` i `cantaves` NO han de sortir mai a la mateixa
partida.

**Fet:** la selecció ara porta la restricció de grup de lema
(`items.lemma_key`, migració 0002): dos ítems que comparteixin `lemma_key` no
poden conviure a cap partida; si un estrat es quedés sense alternativa, cedeix
el lema (mai el refredament) i ho registra a `selection_log`.

**Pendent (únic punt realment obert d'aquest tema):** el CSV de calibratge NO
porta mapatge morfològic, així que avui tots els ítems tenen `lemma_key` NULL i
la restricció és inerta. **La via de càrrega ja és a punt:** el parell
forma→lema (URV, o derivat d'una font morfològica catalana) es carrega amb
`npx tsx scripts/load-lemma-map.ts` (`npm run db:lemmas` o `LEMMA_MAP_CSV=…`);
el script ignora formes fora del banc, no toca res més i informa dels lemes
distints carregats. Fins tenir les dades, `cantar`/`cantaves` poden coincidir
per atzar com abans.

## RESOLT · 2. Slider i puntuació

**Decisió del Roger:** l'slider és LA mecànica del joc.

**Fet:** els dos formats sempre van ser implementats darrere d'una constant
(l'especificació ho exigia: «els dos, commutables»); el botons hi era per
defecte per comparar amb les RT de l'estudi. Ara `ACTIVE_RESPONSE_FORMAT =
"slider"` (21 passos) i el botons continua disponible commutant una línia.

La puntuació ε/K també hi era des del primer commit (regla logarítmica amb
ε=0,02, pes W per dificultat real b→[1,3], K=10, sense negatius, versionada
sc-1). Ara a més es VE: cada fila de resultats mostra els punts de l'ítem i la
secció «la resta» explica la regla. Res de marcador en joc: §3 ho prohibeix.

## RESOLT · 3. Inestabilitat entre sessions

**Decisió del Roger:** sí, que s'anidi actualitzant.

**Fet/pla:** `INSTABILITY_SE` és un paràmetre únic documentat. Quan hi hagi
jugadors recurrents propis, es reestimarà amb les seves partides i s'actualitzarà
bumpant `calibration_version`.

## RESOLT · 4. Població del percentil

**Decisió del Roger:** les dades noves aniran servint poc a poc per a la
referència.

**Fet/pla:** la taula de percentils ja és versionada
(`theta_population_versions`); el pla és regenerar-la periòdicament amb la θ
estimada dels jugadors propis com a nova versió (`pob-2`, `pob-3`…), barrejant
amb l'estudi fins que la pròpia domini. La UI sempre declara contra qui es
compara.

## RESOLT parcialment · 5. Definicions i diccionaris gratuïts

**Decisió del Roger:** mai text de definició amb drets; es podran afegir
diccionaris gratuïts (Apertium, potser).

**Fet:** només enllaç DIEC (cap text). **Aparcat:** explorar Apertium/altres
fonts lliures per afegir-hi una segona referència enllaçada o contingut lliure;
cal verificar-ne la llicència exacta ABANS de mostrar qualsevol text.

## RESOLT · 6. Què són els rànquings 1 i 2 (tancat el 25/08/2026)

Eren les dues taules de «millor partida»:

- **Millors partides · encerts**: quantes de les 100 has encertat. És el
  rànquing més defensable: amb els estrats, totes les partides són equivalents.
- **Millors partides · lexicó**: el mateix encert però on cada paraula val
  segons la seva dificultat (les rares valen més) i acceptar pseudoparaules
  resta. Vol distingir qui sap paraules difícils de qui encerta fàcils.

El problema mesurat: correlacionen 0,997 — ordenen pràcticament idèntic: són
un de sol. **Decisió aplicada** (la recomanació ja escrita): queda només
«encerts» com a taula de millor partida, i el «lexicó» es reservar per al
rànquing general (on ja hi és, amb interval), que és on té sentit diferenciar.
El tauler «Millors partides · lexicó» ha sortit de /ranquings i de l'API.

## TANCAT · 7. Contracció del MAP

El prior N(0, 0,624²) fa que habilitats extremes surtin una mica tirades cap
al centre (θ=+1 → ≈+0,72). És el preu conegut i desitjat del MAP: evita θ
infinits amb partides perfectes. Implementació mantida per criteri delegat.

## RESOLT · 8. Login, correu i deploy

**Decisió del Roger:** gratuït i sense login quan sigui possible; deploy a
GitHub + Vercel + Neon; **convidats han de poder jugar**.

**Fet:**

- **Mode convidat:** botó «Juga ara» crea sessió de convidat (sense correu,
  sense res). Pot jugar, veure resultats i sortir als rànquings. Si més tard
  entra amb correu, l'enllaç màgic fa *upgrade* del MATEIX jugador: conserva
  tot l'historial (identitat persistent intacta).
- **Correu gratuït recomanat: Resend** (API HTTP, 3.000 correus/mes gratis,
  funciona a Vercel serverless on l'SMTP cru sol estar bloquejat). Configuració:
  `RESEND_API_KEY` + opcionalment `MAIL_FROM`. Sense la clau, en dev l'enllaç
  apareix per consola/pantalla.

### Notes de deploy (Vercel + Neon)

0. **L'ordre és obligatori: migracions ABANS del codi nou.** El codi que sap
   de `games.mode` (0005) o `player_regions` (0004) falla amb 500 a tots els
   endpoints de joc (i a la portada loguejada) si la migració encara no hi és.
   L'ordre invers és segur: el codi vell omiteix les columnes noves i els
   defaults cobreixen. A Vercel: executa `npm run db:migrate` apuntant a Neon
   abans de promocionar el desplegament.

1. Neon: crear projecte → copiar la cadena `DATABASE_URL` (pooler).
2. Vercel: importar repo GitHub; env vars `DATABASE_URL`,
   `RESEND_API_KEY` (opcional), `MAIL_FROM`.
3. Migracions + ingesta: executar-los una vegada apuntant `DATABASE_URL` a Neon
   (`npm run db:setup` en local amb la cadena de Neon). El CSV d'origen ha de
   ser accessible (`ITEM_BANK_CSV` si cal).
4. Les migracions són idempotents i es poden repetir a cada deploy.
