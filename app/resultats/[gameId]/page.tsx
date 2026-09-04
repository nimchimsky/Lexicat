import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { currentPlayer } from "@/lib/server/auth";
import { getGameResultsView, type GameResultsView, type ResultItemRow } from "@/lib/server/views";
import { getMapaView } from "@/lib/server/mapa";
import { ensureGameResults, getOpenGame } from "@/lib/server/game";
import { HttpError } from "@/lib/server/http";
import { N_PSEUDO_ITEMS, N_WORD_ITEMS } from "@/lib/config";

export const dynamic = "force-dynamic";

function fmt(x: number, digits = 1): string {
  return x.toLocaleString("ca-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Barra de la seguretat amb què s'ha respost un ítem (mode Pompeu). */
function Conf({ pct, tone, points }: { pct: number; tone: string; points: number }) {
  return (
    <span className="conf">
      <span className="conf-bar" aria-hidden="true">
        <i style={{ width: `${Math.max(4, pct)}%`, ["--conf-tone" as string]: tone }} />
      </span>
      segur {pct}%
      <span className="pts">+{points}</span>
    </span>
  );
}

export default async function Resultats({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const player = await currentPlayer();
  if (!player) redirect("/entrar");

  let view;
  try {
    // Reparació a demanda: si el procés va morir entre tancar la partida i
    // escriure game_results, la primera visita omple el forat (idempotent).
    await ensureGameResults(gameId, player.id);
    view = await getGameResultsView(gameId, player.id);
  } catch (e) {
    if (e instanceof HttpError) {
      // Identificador invàlid, inexistent o d'un altre jugador → 404.
      if (e.status === 400 || e.status === 404 || e.status === 403) notFound();
      if (e.status === 409) {
        const open = await getOpenGame(player.id);
        redirect(open?.mode === "killian" ? "/killian" : open?.mode === "classic" ? "/classic" : "/joc");
      }
    }
    throw e; // error d'infraestructura: boundary d'error, mai un silenci
  }

  if (view.mode === "killian") return <KilianResults view={view} playerId={player.id} />;
  if (view.mode === "classic") return <ClassicResults view={view} playerId={player.id} />;
  return <PompeuResults view={view} playerId={player.id} />;
}

/* ============================================================
   Mode Pompeu (com sempre: estimació del lexicó i jerarquia §6.5)
   ============================================================ */

function PompeuResults({ view, playerId }: { view: GameResultsView; playerId: string }) {
  const s = view.summary;
  const nearCeiling = s.dPrime >= s.dPrimeCeiling - 0.25;

  return (
    <main>
      <p className="eyebrow">Partida acabada</p>
      <h1>Resultat</h1>

      {/* §7.1 · Resum: primer el que tothom vol saber (estimació, marge i
          percentil). La maquinària estadística viu dins «Com ho calculem». */}
      <section className="result-hero">
        <p className="mode-tag">La teva estimació del lexicó</p>
        <span className="big-number">{fmt(s.pctLexicon)}%</span>

        <div
          className="ic"
          style={
            {
              "--lo": `${s.pctLo}%`,
              "--w": `${Math.max(0, s.pctHi - s.pctLo)}%`,
              "--pt": `${s.pctLexicon}%`,
            } as React.CSSProperties
          }
        >
          <div className="ic-track" aria-hidden="true">
            <div className="ic-range" />
            <div className="ic-point" />
          </div>
          <div className="ic-scale" aria-hidden="true">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        <p className="interval">
          IC95 {fmt(s.pctLo)}% – {fmt(s.pctHi)}% · percentil {fmt(s.percentile, 0)}
        </p>
        <p className="small muted">
          Percentil entre els participants de l&apos;estudi de referència. És una
          estimació, no un fet: amb una sola partida l&apos;interval és ample i
          s&apos;estreny a mesura que acumules partides.
        </p>
      </section>

      {/* Mapa: fitxes pendents o progrés cap a la propera zona */}
      <MapaAfterGame playerId={playerId} />

      {/* §7.2 · Les descobertes */}
      <h2>Paraules que has dit que no existeixen</h2>
      {view.discoveries.length === 0 ? (
        <p className="muted">Cap: has reconegut totes les paraules reals.</p>
      ) : (
        <>
          <p className="muted small">
            Ordenades per la seguretat amb què t&apos;has equivocat. Toca per veure
            l&apos;entrada al DIEC.
          </p>
          <ul className="wordlist">
            {view.discoveries.map((d) => (
              <li key={d.position}>
                <a className="word" href={d.diecUrl} target="_blank" rel="noopener noreferrer">
                  {d.stimulus}
                </a>
                <Conf
                  pct={Math.round((1 - (d.confidence ?? 0)) * 100)}
                  tone="var(--bad)"
                  points={d.points}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* §7.3 · Falses alarmes */}
      <h2>Pseudoparaules que has acceptat</h2>
      {view.falseAlarms.length === 0 ? (
        <p className="muted">Cap: has rebutjat totes les pseudoparaules.</p>
      ) : (
        <ul className="wordlist">
          {view.falseAlarms.map((d) => (
            <li key={d.position}>
              <span className="word">{d.stimulus}</span>
              <Conf pct={Math.round((d.confidence ?? 0) * 100)} tone="var(--bad)" points={d.points} />
            </li>
          ))}
        </ul>
      )}

      {/* §7.4 · La resta, plegada, amb els punts de cada ítem */}
      <details className="fold">
        <summary>La resta ({view.rest.length} encerts)</summary>
        <ul className="wordlist">
          {view.rest.map((d) => (
            <li key={d.position}>
              {d.isWord ? (
                <a className="word" href={d.diecUrl} target="_blank" rel="noopener noreferrer">
                  {d.stimulus}
                </a>
              ) : (
                <span className="word">{d.stimulus}</span>
              )}
              <Conf
                pct={Math.round((d.isWord ? d.confidence ?? 0 : 1 - (d.confidence ?? 1)) * 100)}
                tone="var(--good)"
                points={d.points}
              />
            </li>
          ))}
        </ul>
      </details>

      {/* Detalls estadístics: d′, criteri, ε, calibratge i regles de puntuació */}
      <details className="fold">
        <summary>Com ho calculem</summary>
        <div className="statgrid">
          <div className="stat">
            <b>
              {s.nCorrect}/{s.totalItems}
            </b>
            <span>encerts</span>
          </div>
          <div className="stat">
            <b>{s.score.toLocaleString("ca-ES")}</b>
            <span>puntuació</span>
          </div>
          <div className="stat">
            <b>{fmt(s.dPrime, 2)}</b>
            <span>d′ sensibilitat{nearCeiling ? " · al sostre" : ""}</span>
          </div>
          <div className="stat">
            <b>{fmt(s.criterion, 2)}</b>
            <span>
              biaix {s.criterion > 0.15 ? "· conservador" : s.criterion < -0.15 ? "· permissiu" : ""}
            </span>
          </div>
        </div>

        {nearCeiling ? (
          <p className="small muted">
            El d′ màxim observable amb 66 paraules i 34 pseudoparaules és{" "}
            {fmt(s.dPrimeCeiling, 2)}: hi ets.
          </p>
        ) : null}

        <p className="small muted">
          Cada ítem val més com més difícil és (pes W = mapatge lineal de la b real
          a [1,3]); la regla premia declarar la confiança real. ε=0,02, K=10
          (sc-1). Les respostes d&apos;exactament 50% ({s.nFiftyFifty}) no entren al d′.
        </p>

        <p className="small muted">
          Conjunt de referència {view.referenceCorpusVersion} · calibratge i
          percentil versionats: mai comparem partides calculades amb regles diferents.
        </p>
      </details>

      {view.qualityFlag ? (
        <div className="notice">
          Aquesta partida té respostes massa ràpides i queda marcada: no entra
          als rànquings. Les dades es conserven.
        </div>
      ) : null}

      <div className="actions">
        <Link href="/joc" className="btn">
          Juga una altra
        </Link>
        <Link href="/ranquings" className="btn secondary">
          Veure rànquings
        </Link>
      </div>
    </main>
  );
}

/* ============================================================
   Mode Clàssic: decisió binària sense temps
   ============================================================ */

function ClassicResults({ view, playerId }: { view: GameResultsView; playerId: string }) {
  const s = view.summary;
  const all = [...view.rest, ...view.discoveries, ...view.falseAlarms].sort(
    (a, b) => a.position - b.position
  );
  const hits = view.rest.filter((r) => r.isWord).length;
  const correctRejections = view.rest.filter((r) => !r.isWord).length;

  return (
    <main>
      <p className="eyebrow">Mode Clàssic · partida acabada</p>
      <h1>{fmtScoreInt(s.score)} / 100</h1>
      <p className="lead">Puntuació equilibrada</p>

      <div className="statgrid">
        <div className="stat">
          <b>{hits}/{N_WORD_ITEMS}</b>
          <span>paraules detectades</span>
        </div>
        <div className="stat">
          <b>{s.nFalseAlarms}/{N_PSEUDO_ITEMS}</b>
          <span>falses alarmes</span>
        </div>
        <div className="stat">
          <b>{correctRejections}/{N_PSEUDO_ITEMS}</b>
          <span>pseudoparaules rebutjades</span>
        </div>
        <div className="stat">
          <b>{s.nCorrect}/{s.totalItems}</b>
          <span>encerts totals</span>
        </div>
      </div>

      <p className="small muted center-text kil-strip-caption">
        La puntuació és la mitjana del percentatge de paraules detectades i el
        percentatge de pseudoparaules rebutjades. El temps no hi intervé.
      </p>
      <div
        className="kil-strip"
        role="img"
        aria-label={`La partida en cent cel·les: ${s.nCorrect} encerts i ${s.totalItems - s.nCorrect} errors`}
      >
        {all.map((r) => <i key={r.position} className={r.isCorrect ? "ok" : "ko"} />)}
      </div>

      <MapaAfterGame playerId={playerId} />

      <h2>Paraules que no has reconegut</h2>
      {view.discoveries.length === 0 ? (
        <p className="muted">Cap: has reconegut totes les paraules reals.</p>
      ) : (
        <ul className="wordlist">
          {view.discoveries.map((d) => (
            <li key={d.position}>
              <a className="word" href={d.diecUrl} target="_blank" rel="noopener noreferrer">
                {d.stimulus}
              </a>
              <span className="pts">paraula</span>
            </li>
          ))}
        </ul>
      )}

      <h2>Pseudoparaules que has acceptat</h2>
      {view.falseAlarms.length === 0 ? (
        <p className="muted">Cap: has rebutjat totes les pseudoparaules.</p>
      ) : (
        <ul className="wordlist">
          {view.falseAlarms.map((d) => (
            <li key={d.position}>
              <span className="word">{d.stimulus}</span>
              <span className="pts">pseudoparaula</span>
            </li>
          ))}
        </ul>
      )}

      <details className="fold">
        <summary>La resta ({view.rest.length} encerts)</summary>
        <ul className="wordlist">
          {view.rest.map((d) => (
            <li key={d.position}>
              {d.isWord ? (
                <a className="word" href={d.diecUrl} target="_blank" rel="noopener noreferrer">
                  {d.stimulus}
                </a>
              ) : (
                <span className="word">{d.stimulus}</span>
              )}
              <span className="pts">correcte</span>
            </li>
          ))}
        </ul>
      </details>

      {view.qualityFlag ? (
        <div className="notice">
          Aquesta partida té moltes respostes anormalment ràpides i no entra
          al rànquing. La puntuació i les dades es conserven.
        </div>
      ) : null}

      <div className="actions">
        <Link href="/classic" className="btn">Juga una altra</Link>
        <Link href="/ranquings?mode=classic" className="btn secondary">Rànquing Clàssic</Link>
      </div>
    </main>
  );
}

/* ============================================================
   Mode Kilian: puntuació, ratxes i la partida en un cop d'ull
   ============================================================ */

function KilianResults({ view, playerId }: { view: GameResultsView; playerId: string }) {
  const k = view.kilian!;
  const s = view.summary;

  // Franja de la partida sencera en ordre: encert / error / tard.
  const all: ResultItemRow[] = [...view.rest, ...view.discoveries, ...view.falseAlarms].sort(
    (a, b) => a.position - b.position
  );

  return (
    <main>
      <p className="eyebrow">Mode Kilian · partida acabada</p>
      <h1>{fmtScoreInt(k.score)} punts</h1>

      <div className="statgrid">
        <div className="stat">
          <b>
            {s.nCorrect}/{s.totalItems}
          </b>
          <span>encerts</span>
        </div>
        <div className="stat">
          <b>{k.bestStreak}</b>
          <span>millor ratxa</span>
        </div>
        <div className="stat">
          <b>×{fmt(k.maxMultiplier)}</b>
          <span>multiplicador màxim</span>
        </div>
        <div className="stat">
          <b>{k.nTimeouts}</b>
          <span>fora de temps</span>
        </div>
      </div>

      <p className="small muted center-text kil-strip-caption">
        {k.medianElapsedMs != null
          ? `Temps per resposta (mediana): ${fmt(k.medianElapsedMs / 1000, 2)} s`
          : null}
        {k.fastest
          ? ` · el més ràpid: «${k.fastest.stimulus}» a ${fmt(k.fastest.elapsedMs / 1000, 2)} s`
          : null}
      </p>

      <div className="kil-strip" role="img" aria-label={`La partida en cent cel·les: ${s.nCorrect} encerts, ${view.falseAlarms.length + view.discoveries.length} errors i ${k.nTimeouts} fora de temps`}>
        {all.map((r) => (
          <i
            key={r.position}
            className={r.kind === "timeout" ? "late" : r.isCorrect ? "ok" : "ko"}
          />
        ))}
      </div>

      {/* El mapa compta igual que a Pompeu: paraules reals vistes */}
      <MapaAfterGame playerId={playerId} />

      <h2>Paraules que no has reconegut</h2>
      {view.discoveries.length === 0 ? (
        <p className="muted">Cap: has encertat totes les paraules reals.</p>
      ) : (
        <>
          <p className="muted small">
            Toca per veure l&apos;entrada al DIEC: aquí és on creix el teu lèxic.
          </p>
          <ul className="wordlist">
            {view.discoveries.map((d) => (
              <li key={d.position}>
                <a className="word" href={d.diecUrl} target="_blank" rel="noopener noreferrer">
                  {d.stimulus}
                </a>
                <span className="pts">{fmt((d.elapsedMs ?? 0) / 1000, 1)} s</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Pseudoparaules que t&apos;han colat</h2>
      {view.falseAlarms.length === 0 ? (
        <p className="muted">Cap: cap inventada ha passat el filtre.</p>
      ) : (
        <ul className="wordlist">
          {view.falseAlarms.map((d) => (
            <li key={d.position}>
              <span className="word">{d.stimulus}</span>
              <span className="pts">{fmt((d.elapsedMs ?? 0) / 1000, 1)} s</span>
            </li>
          ))}
        </ul>
      )}

      <details className="fold">
        <summary>La resta ({all.filter((r) => r.isCorrect).length} encerts)</summary>
        <ul className="wordlist">
          {view.rest.map((d) => (
            <li key={d.position}>
              {d.isWord ? (
                <a className="word" href={d.diecUrl} target="_blank" rel="noopener noreferrer">
                  {d.stimulus}
                </a>
              ) : (
                <span className="word">{d.stimulus}</span>
              )}
              {d.kind === "timeout" ? (
                <span className="pts">tard</span>
              ) : (
                <span className="pts">+{fmtScoreInt(d.points)}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="small muted">
          Cada encert val 100 punts menys els que es mengi la velocitat (80 per
          segon), multiplicats per la ratxa vigent (ki-1).
        </p>
      </details>

      {view.qualityFlag ? (
        <div className="notice">
          Aquesta partida té respostes massa ràpides i queda marcada: no entra
          al rànquing. Les dades es conserven.
        </div>
      ) : null}

      <div className="actions">
        <Link href="/killian" className="btn">
          Una altra ratxa
        </Link>
        <Link href="/ranquings?mode=kilian" className="btn secondary">
          Rànquing Kilian
        </Link>
      </div>
    </main>
  );
}

function fmtScoreInt(n: number): string {
  return Math.round(n).toLocaleString("ca-ES");
}

async function MapaAfterGame({ playerId }: { playerId: string }) {
  const mapa = await getMapaView(playerId);
  const zones = mapa.claimedIds.length;

  if (mapa.pending > 0) {
    return (
      <div className="notice mapa-notice">
        Has guanyat {mapa.pending === 1 ? "una zona nova" : `${mapa.pending} zones noves`} del mapa:{" "}
        <Link href="/mapa">tria el teu territori</Link>.
      </div>
    );
  }
  if (mapa.completed) {
    return (
      <p className="small muted">
        Mapa: <Link href="/mapa">{zones}/{mapa.zones} zones</Link> · Països Catalans complets.
      </p>
    );
  }
  return (
    <p className="small muted">
      Mapa: <Link href="/mapa">{zones}/{mapa.zones} zones</Link> ·{" "}
      {(mapa.wordsToNext ?? 0).toLocaleString("ca-ES")} paraules per la propera.
    </p>
  );
}
