import { redirect } from "next/navigation";
import Link from "next/link";
import { currentPlayer } from "@/lib/server/auth";
import { getGameResultsView } from "@/lib/server/views";

export const dynamic = "force-dynamic";

function fmt(x: number, digits = 1): string {
  return x.toLocaleString("ca-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function Resultats({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const player = await currentPlayer();
  if (!player) redirect("/entrar");

  let view;
  try {
    view = await getGameResultsView(gameId, player.id);
  } catch {
    redirect("/joc");
  }

  const s = view.summary;
  const nearCeiling = s.dPrime >= s.dPrimeCeiling - 0.25;

  return (
    <main>
      <h1>Resultat</h1>

      {/* §7.1 · Resum */}
      <div className="card">
        <p className="muted">La teva estimació del lexicó</p>
        <div className="big-number">{fmt(s.pctLexicon)}%</div>
        <div className="interval">
          IC95: {fmt(s.pctLo)}% – {fmt(s.pctHi)}%
        </div>
        <div className="interval">
          Percentil {fmt(s.percentile, 0)} entre els participants de l&apos;estudi
          de referència (mediana 53 anys; dos terços amb estudis universitaris).
        </div>
        <p className="small muted">
          És una estimació, no un fet: amb una sola partida l&apos;interval és
          ample i s&apos;estreny a mesura que acumules partides.
        </p>
      </div>

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
          <span>d′ (sensibilitat){nearCeiling ? " · al sostre" : ""}</span>
        </div>
        <div className="stat">
          <b>{fmt(s.criterion, 2)}</b>
          <span>
            biaix {s.criterion > 0.15 ? "(conservador)" : s.criterion < -0.15 ? "(permissiu)" : ""}
          </span>
        </div>
      </div>

      {nearCeiling ? (
        <p className="small muted">
          El d′ màxim observable amb 66 paraules i 34 pseudoparaules és{" "}
          {fmt(s.dPrimeCeiling, 2)}: hi ets.
        </p>
      ) : null}

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
                <a href={d.diecUrl} target="_blank" rel="noopener noreferrer">
                  {d.stimulus}
                </a>
                <span className="conf">segur {Math.round((1 - d.confidence) * 100)}% · {d.points} punts</span>
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
              <span style={{ fontSize: 17, fontWeight: 600 }}>{d.stimulus}</span>
              <span className="conf">segur {Math.round(d.confidence * 100)}% · {d.points} punts</span>
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
                <a href={d.diecUrl} target="_blank" rel="noopener noreferrer">
                  {d.stimulus}
                </a>
              ) : (
                <span style={{ fontSize: 17 }}>{d.stimulus}</span>
              )}
              <span className="conf">
                {d.isWord ? "paraula" : "pseudo"} · +{d.points} punts
              </span>
            </li>
          ))}
        </ul>
        <p className="small muted">
          Cada ítem val més com més difícil és (pes W = mapatge lineal de la b
          real a [1,3]); la regla premia declarar la confiança real. ε=0,02, K=10
          (sc-1).
        </p>
      </details>

      {view.qualityFlag ? (
        <div className="notice">
          Aquesta partida té respostes massa ràpides i queda marcada: no entra
          als rànquings. Les dades es conserven.
        </div>
      ) : null}

      <p className="small muted">
        Conjunt de referència {view.referenceCorpusVersion} · les respostes
        d&apos;exactament 50% ({s.nFiftyFifty}) no entren al d′.
      </p>

      <Link href="/joc" className="btn" style={{ textAlign: "center", textDecoration: "none" }}>
        Juga una altra
      </Link>
      <Link href="/ranquings" className="btn secondary" style={{ textAlign: "center", textDecoration: "none" }}>
        Veure rànquings
      </Link>
    </main>
  );
}
