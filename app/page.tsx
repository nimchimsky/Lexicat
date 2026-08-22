import Link from "next/link";
import { currentPlayer } from "@/lib/server/auth";
import { getPlayerSummary } from "@/lib/server/views";
import { SLIDER_STEPS } from "@/lib/config";
import GuestButton from "@/components/GuestButton";

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
        <GuestButton label="Juga ara, sense res més" />
        <Link href="/entrar" className="btn secondary" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
          Entra amb correu (per acumular entre dispositius)
        </Link>
        <p className="small muted">
          Pots jugar de convidat ja; si més tard entres amb correu, tot el que
          hagis jugat es conserva. El format actiu és l&apos;slider
          ({SLIDER_STEPS} passos).
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
