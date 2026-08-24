import Link from "next/link";
import { currentPlayer } from "@/lib/server/auth";
import { getPlayerSummary } from "@/lib/server/views";
import { getMapaView } from "@/lib/server/mapa";
import MapaCatala from "@/components/MapaCatala";
import GuestButton from "@/components/GuestButton";

export const dynamic = "force-dynamic";

function fmt(x: number, digits = 1): string {
  return x.toLocaleString("ca-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function Home() {
  const player = await currentPlayer();
  const summary = player ? await getPlayerSummary(player.id) : null;
  const mapa = player ? await getMapaView(player.id) : null;

  const mapaCta = mapa
    ? mapa.completed
      ? "El teu mapa · complet"
      : `El teu mapa · ${mapa.claimedIds.length}/${mapa.zones} zones${mapa.pending > 0 ? ` · ${mapa.pending} per col·locar` : ""}`
    : "El mapa del lèxic";

  return (
    <main className="home">
      {/* El mapa viu darrere del contingut: decoratiu, sense res d'interacció */}
      <div className="mapa-bg" aria-hidden="true">
        <MapaCatala variant="compacte" claimedIds={mapa?.claimedIds ?? []} interactive={false} />
      </div>

      <header className="hero">
        <h1 className="wordmark">LEXICAT</h1>
        <span className="senyera wordmark-rule" aria-hidden="true" />
        <p className="subtitle">
          Quantes paraules coneixes? Millora l&apos;estimació amb cada partida.
        </p>
      </header>

      {player && summary?.standing ? (
        <div className="home-stats">
          <span className="big-number">{fmt(summary.standing.pctLexicon)}%</span>
          <span className="muted small">
            del lèxic català
            <br />
            IC95 {fmt(summary.standing.pctLo)}%–{fmt(summary.standing.pctHi)}% ·{" "}
            {summary.standing.nGames}/5 partides
          </span>
        </div>
      ) : null}

      <div className="mode-grid">
        <section className="mode-card">
          <span className="mode-num" aria-hidden="true">
            01
          </span>
          <p className="mode-tag">Mode</p>
          <p className="mode-name">Pompeu</p>
          <p className="mode-desc">
            Cent estímuls, set graus de seguretat. Demostra el teu vocabulari al
            teu ritme.
          </p>
          {player ? (
            <Link href="/joc" className="btn">
              Juga
            </Link>
          ) : (
            <GuestButton primary label="Juga ara" />
          )}
        </section>

        <section className="mode-card">
          <span className="mode-num" aria-hidden="true">
            02
          </span>
          <p className="mode-tag">Mode</p>
          <p className="mode-name">Kilian</p>
          <p className="mode-desc">
            Cinc segons per paraula. Ratxes, multiplicadors i punts: el mateix
            lèxic, a tota velocitat.
          </p>
          {player ? (
            <Link href="/killian" className="btn secondary">
              Juga
            </Link>
          ) : (
            <GuestButton primary={false} label="Juga ara" href="/killian" />
          )}
        </section>
      </div>

      <div className="actions">
        <Link href="/mapa" className="btn secondary">
          {mapaCta}
        </Link>
        {!player ? (
          <Link href="/entrar" className="btn secondary">
            Entra amb correu
          </Link>
        ) : (
          <Link href="/ranquings" className="btn secondary">
            Rànquings
          </Link>
        )}
      </div>
    </main>
  );
}
