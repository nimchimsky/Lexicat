# Mode Pompeu — Lèxic.cat

Joc web de decisió lèxica en català: 100 estímuls (66 paraules reals + 34
pseudoparaules, una per estrat de dificultat), sense feedback durant la partida.
Al final: estimació del teu lexicó amb interval de confiança, percentil, d′,
puntuació pròpia, cada paraula descoberta enllaçada al DIEC i quatre rànquings.

**Stack:** Next.js (App Router) + TypeScript + Postgres. Mòbil primer. Català a
tota la interfície.

---

## Arrencada local

```bash
# 1) Postgres (docker compose inclòs; port 5433)
docker compose up -d

# 2) Dependències + configuració
npm install
cp .env.example .env          # els valors per defecte ja encaixen amb el compose

# 3) Esquema + banc d'ítems (migracions versionades + ingesta reproduïble)
npm run db:setup

# 4) Servidor de desenvolupament
npm run dev                   # http://localhost:3000
```

L'entrada és per **enllaç màgic**: escriu el correu a `/entrar` i, en
desenvolupament (sense SMTP), l'enllaç apareix a la pantalla i a la consola del
servidor. En producció cal definir `SMTP_URL` i connectar el transport a
`lib/server/mailer.ts` (punt únic d'integració).

## Verificació

```bash
npm test                # tests unitaris del mòdul psicomètric i de selecció
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
lib/
  config.ts              TOTES les constants versionades (ε, K, versions, refredament…)
  psychometrics/         MÒDUL PUR: IRT MAP 2PL, lexicó, SDT, puntuació, percentils
  game/                  Selecció estratificada amb refredament + càlcul de resultats
  server/                DB pool, auth (enllaç mágic), partida, vistes i rànquings
  bank/                  Lectura del CSV d'origen i de la distribució de θ
app/                     UI (App Router) + API routes
components/              Components client (joc, formularis)
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

## Desplegament

- Node 20+ i Postgres 15+ (qualsevol proveïdor gestionat serveix).
- Variables: `DATABASE_URL`, `AUTH_SECRET`; opcionalment `SMTP_URL`/`MAIL_FROM`
  i `ITEM_BANK_CSV`/`THETA_CSV` si l'origen no és el germà del projecte.
- `npm run build && npm run start` després de `npm run db:setup`.
- Les migracions són idempotents i es poden executar a cada desplegament.

## Documents relacionats

- `DECISIONS.md` — les 8 decisions exigides, amb motius.
- `DUBTES.md` — allò que aquesta implementació no decideix sola.
- `../REVISIO_MODE_POMPEU.md` — especificació vigent (v2).
