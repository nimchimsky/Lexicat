import Link from "next/link";
import { currentPlayer } from "@/lib/server/auth";
import { getPlayerSummary } from "@/lib/server/views";
import { ACTIVE_RESPONSE_FORMAT } from "@/lib/config";

export const dynamic = "force-dynamic";

function fmt(x: number, digits = 1): string {
  return x.toLocaleString("ca-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function Home() {
  const player = await currentPlayer();
  if (!player) {
    return (
      <main>
        <h1>Mode Pompeu</h1>
        <p>
          Cent estímuls. Cap feedback. Al final: la teva estimació de lèxic en
          català, amb interval i percentil, i cada paraula que has descobert,
          enllaçada al DIEC.
        </p>
        <p className="muted">
          Un ítem per nivell de dificultat (66 paraules i 34 pseudoparaules),
          sempre comparable entre jugadors. Uns 4 minuts.
        </p>
        <Link href="/entrar" className="btn" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
          Entra per jugar
        </Link>
        <p className="small muted">
          Necessitem un compte lleuger (només el correu) perquè el teu resultat
          s'acumuli entre partides i dispositius, l'interval s'estrenyi i puguis
          entrar als rànquings.
        </p>
        <p className="small muted">
          Format de resposta actiu: {ACTIVE_RESPONSE_FORMAT === "buttons" ? "5 botons" : "slider"}.
        </p>
      </main>
    );
  }

  const summary = await getPlayerSummary(player.id);
  return (
    <main>
      <h1>Hola, {player.nickname ?? player.email}</h1>
      {summary.standing ? (
        <div className="card">
          <p className="muted">La teva estimació acumulada ({summary.standing.nGames} de 5 partides a la finestra):</p>
          <div className="big-number">{fmt(summary.standing.pctLexicon)}%</div>
          <div className="interval">
            IC95: {fmt(summary.standing.pctLo)}% – {fmt(summary.standing.pctHi)}% · percentil {fmt(summary.standing.percentile, 0)}
          </div>
        </div>
      ) : (
        <p className="muted">Encara no tens cap partida acabada.</p>
      )}
      <p className="muted">
        Partides acabades: {summary.gamesCompleted} · començades: {summary.gamesStarted}
      </p>
      <Link href="/joc" className="btn" style={{ textAlign: "center", textDecoration: "none" }}>
        Juga
      </Link>
      <Link href="/ranquings" className="btn secondary" style={{ textAlign: "center", textDecoration: "none" }}>
        Rànquings
      </Link>
      <Link href="/compte" className="btn secondary" style={{ textAlign: "center", textDecoration: "none" }}>
        El meu compte
      </Link>
    </main>
  );
}
