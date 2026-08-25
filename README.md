# Lexicat

Joc web de decisió lèxica en català: 100 estímuls (66 paraules reals + 34
pseudoparaules, una per estrat de dificultat), sense feedback durant la partida.
Al final: estimació del teu lexicó amb interval de confiança, percentil, d′,
puntuació pròpia, cada paraula descoberta enllaçada al DIEC i quatre rànquings.

**Stack:** Next.js (App Router) + TypeScript + Postgres. Mòbil primer. Català a
tota la interfície.

---

## Arrencada local

```bash
# 1) Postgres local sense Docker (binaris incrustats via npm; port 5433)
npm run db

# 2) Dependències + configuració
npm install
cp .env.example .env          # els valors per defecte ja encaixen amb `npm run db`

# 3) Esquema + banc d'ítems (migracions versionades + ingesta reproduïble)
npm run db:setup

# 4) Servidor de desenvolupament
npm run dev                   # http://localhost:3000
```

El servidor de Postgres el gestiona `scripts/dev-db.mjs` (paquet
`embedded-postgres`): baixa binaris oficials de PostgreSQL 17 per npm i els
executa com a procés local, amb les dades a `.pgdata/`. Ordres:

| ordre | què fa |
|---|---|
| `npm run db` | arrenca en segon pla i espera que escolti (idempotent) |
| `npm run db:stop` | aturada neta |
| `npm run db:status` | estat |
| `npm run db:reset` | atura i **esborra** `.pgdata` |

L'entrada té dos camins:

- **Convidat (sense res):** «Juga ara» crea sessió de convidat; pots jugar tot
  i sortir als rànquings. Si més tard entres amb correu, conserves tot
  l'historial.
- **Enllaç màgic:** correu a `/entrar`. El correu porta a la intersticial
  `/entrar/verificar`, on el botó fa el canvi de token per sessió (POST):
  cap preview del correu no pot cremar el token d'un sol ús. En
  desenvolupament (sense clau de correu) l'enllaç apareix a la pantalla i
  consola. A producció cal configurar `RESEND_API_KEY` i `MAIL_FROM` (un
  remitent verificat a Resend).

## Verificació

```bash
npm test                # tests unitaris del mòdul psicomètric, selecció i model graduat
npm run lint            # ESLint (next/core-web-vitals + typescript)
npm run simulate        # arnès de simulació: recuperació de θ, SE, lexicó, d′, correlació rànquings
npm run typecheck       # TypeScript estricte
DATABASE_URL=... npm run test:integration   # criteris d'acceptació amb DB real
npx tsx scripts/smoke.ts                    # prova de foc end-to-end (servidor dev en marxa)
npx tsx scripts/exposure-report.ts [playerId]   # monitor d'exposició d'ítems
```

La simulació comprova els criteris 4, 5, 7 i 8 del prompt: biaix de θ < 0,02,
SE ≈ 0,238 / 0,274 / 0,342 (MAP), % del lexicó ≈ 65,2 / 78,1 / 87,1 i sostre de
d′ ≤ 4,62. Si alguna xifra no surt, **no s'ajusta el codi fins que quadri**: es
para i s'escriu on falla.

## Arquitectura

```
db/migrations/           Esquema versionat des del primer commit (SQL pla)
scripts/
  migrate.ts             CLI de migracions
  ingest-item-bank.ts    Ingesta reproduïble del CSV (exclusions per item_id,
                         estratificació 66/34, congelació ref-1, percentils pob-1)
  simulate.ts            Arnès de simulació psicometrica
  build-compact-map.ts   Generador del SVG compacte (illes i enclavaments
                         reubicats) des de scripts/mapa-src/
  mapa-src/              Còpia versionada del paquet cartogràfic ../Mapa
lib/
  config.ts              TOTES les constants versionades (ε, K, versions, refredament…)
  psychometrics/         MÒDUL PUR: IRT MAP 2PL, lexicó, SDT, puntuació, percentils
  game/                  Selecció estratificada amb refredament + càlcul de resultats
  server/                DB pool, auth (enllaç mágic), partida, vistes i rànquings
  bank/                  Lectura del CSV d'origen i de la distribució de θ
  mapa/                  Catàleg de les 100 regions + llindars de zones (pur)
app/                     UI (App Router) + API routes
components/              Components client (joc, formularis, mapa)
public/mapa/             SVGs del mapa (mestre geogràfic + compacte generat)
tests/                   Unitaris (sense DB) + integració (criteris §14)
```

### Flux d'una partida

1. `POST /api/game/start` → selecció **al servidor**: un ítem per estrat
   (66 paraules + 34 pseudoparaules), refredament N=50 partides per jugador,
   barreja amb llavor desada (`game_seed`). La composició sencera s'escriu a
   `game_items` **abans** de servir res.
2. `GET /api/game/item` → l'estímul en minúscules i la posició. **Mai**
   `is_word`, mai `item_id` (algú podria creuar-lo amb el CSV públic).
3. `POST /api/game/response` → confiança a [0,1] amb `response_id` generat al
   client (`ON CONFLICT DO NOTHING`: idempotència). El servidor valida ordre
   estricta, calcula l'encert, marca RT<200 ms i les quatre versions. Amb la
   resposta 100, tanca la partida, calcula resultats i recalcula la finestra
   dels rànquings generals (θ estimat sobre TOTES les respostes de les últimes
   5 partides ajuntades, no mitjana de θ).
4. Pantalla `/resultats/[gameId]`: resum amb interval sempre visible,
   descobertes ordenades per seguretat de l'error (enllaç al DIEC), falses
   alarmes i resta plegada.

### El mapa dels Països Catalans (metaprogrés de zones)

Cada ~1% del banc de paraules reals vistes (≈408 paraules, 6-7 partides) guanya
una fitxa per reclamar una de les 100 zones del mapa. El progrés es deriva de
`responses` (`COUNT(DISTINCT item_id) WHERE is_word`), no es desa mai; només
viuen a la DB les zones col·locades (`player_regions`, migració 0004). Els
llindars exactes (`lib/mapa/thresholds.ts`) fan caure la zona 100 a l'última
paraula del banc vigent. Reclamar és transaccional amb bloqueig de jugador:
mai no es gasten dues fitxes de més.

- **`/mapa`**: el teu mapa, progrés cap a la propera zona i selector
  (toca + confirma). Commutador compacte/geogràfic.
- **Resultats**: CTA quan tens fitxa pendent; portada: mini-mapa enllaçat.
- **SVG**: `public/mapa/paisos-catalans-100.svg` (mestre geogràfic, del paquet
  `../Mapa`) i `paisos-catalans-100.compact.svg` (generat amb
  `npx tsx scripts/build-compact-map.ts`: continent aplegat, Illes en
  quadre-inset, Alguer i Carxe en medallons). Mateix contracte DOM de 100
  `<g class="lexic-region">` amb ids estables a les dues variants; l'estat es
  pinta amb `data-state` i CSS, sense guardar cap SVG per jugador.

### Com afegir un model d'estimació nou

L'estimador viu darrere d'una interfície commutable:

```ts
estimateAbility(responses, itemParams, model)
// model actual: "binary_2pl_map"
```

Quan hi hagi prou dades graduades calibrades:

1. Implementa el model nou (p. ex. `graded_2pl_map`) dins `lib/psychometrics/`,
   amb tests propis i validació a `scripts/simulate.ts`.
2. Bumpa `VERSIONS.calibration` a `lib/config.ts`.
3. Re-puntua el passat recorrent `responses` (tenen tots quatre versions) i
   regenera `game_results` / `player_standings` marcant la versió nova.
   Cap altra cosa cal tocar: la interfície no canvia.

### Versions independents (`lib/config.ts`)

| versió | canvia quan |
|---|---|
| `itemBank` (2026.08) | entren o surten ítems |
| `referenceCorpus` (ref-1) | canvia el denominador del % |
| `calibration` (cal-1) | recalibratge d'a/b o model nou |
| `scoring` (sc-1) | canvien ε, K o els pesos |

Totes quatre es desaven a cada partida i a cada resposta.

### Integritat (§9)

- Ítems i composició sempre del servidor; validació estricta d'ordre i
  d'unicitat (constraint únic `(game_id, item_id)`).
- Refredament sostingut per `item_exposure`; relaxacions registrades.
- Qualitat: RT<200 ms es marca; ≥20% marca la partida `suspect_fast`, que surt
  dels rànquings però es conserva. Abandonament definitiu a `DECISIONS.md`.
- Manteniment programat (`vercel.json` → `/api/cron/sweep`, protegit amb
  `CRON_SECRET`): abandona partides velles i poda sessions/tokens caducats.
- El resultat d'una partida Pompeu es calcula FORA de la transacció de la
  darrera resposta (mai amb el joc bloquejat); si el procés mor a mig camí,
  la primera visita a /resultats repara el forat (`ensureGameResults`).

## Desplegament (Vercel + Neon)

1. **Neon:** projecte nou → cadena de connexió (pooler) com a `DATABASE_URL`.
2. **Esquema + banc:** en local, amb la cadena de Neon:
   `DATABASE_URL=... npm run db:setup` (migracions idempotents + ingesta; el CSV
   d'origen ha de ser accessible via `ITEM_BANK_CSV`).
3. **Vercel:** importar el repo de GitHub; env vars `DATABASE_URL`,
   `AUTH_SECRET`, `RESEND_API_KEY` i `MAIL_FROM`.
4. Builds següents no toquen l'esquema; si hi ha migració nova,
   `npm run db:migrate` contra Neon abans del deploy.

Variables completes a `.env.example`. Les rutes API són `runtime = "nodejs"`
(pg no corre al runtime Edge).

## Documents relacionats

- `DECISIONS.md` — les 8 decisions exigides, amb motius.
- `DUBTES.md` — allò que aquesta implementació no decideix sola.
- `../REVISIO_MODE_POMPEU.md` — especificació vigent (v2).
