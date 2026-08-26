import Link from "next/link";
import { currentPlayer } from "@/lib/server/auth";
import { getPlayerSummary } from "@/lib/server/views";
import { getMapaView } from "@/lib/server/mapa";
import MapaBackdrop from "@/components/MapaBackdrop";
import GuestButton from "@/components/GuestButton";

export const dynamic = "force-dynamic";

/** Dades estructurades per als cercadors (la portada és la peça indexable). */
function JsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Lexicat",
    url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://lexic.cat",
    applicationCategory: "GameApplication",
    inLanguage: "ca",
    description:
      "Mesura el teu lèxic en català: 100 estímuls, cap feedback, la teva estimació al final.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
  };
  return (
    <script
      type="application/ld+json"
      // Contingut constant del servidor: cap entrada d'usuari dins.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

function fmt(x: number, digits = 1): string {
  return x.toLocaleString("ca-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function Home() {
  const player = await currentPlayer();
  // En paral·lel, com a /mapa: dues consultes en sèrie només per estètica no.
  const [summary, mapa] = player
    ? await Promise.all([getPlayerSummary(player.id), getMapaView(player.id)])
    : [null, null];

  const mapaCta = mapa
    ? mapa.completed
      ? "El teu mapa · complet"
      : `El teu mapa · ${mapa.claimedIds.length}/${mapa.zones} zones${mapa.pending > 0 ? ` · ${mapa.pending} per col·locar` : ""}`
    : "El mapa del lèxic";

  return (
    <main className="home">
      <JsonLd />
      {/* El mapa viu darrere del contingut: decoratiu, sense res d'interacció.
          Només en pantalles amples (al mòbil no es percep i s'estalvia ~425 KB). */}
      <MapaBackdrop claimedIds={mapa?.claimedIds ?? []} />

      <header className="hero">
        <h1 className="wordmark">LEXICAT</h1>
        <span className="senyera wordmark-rule" aria-hidden="true" />
        <p className="subtitle">
          Descobreix quantes paraules catalanes coneixes. En 100 decisions
          obtindràs una estimació, el teu percentil i mots per descobrir.
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
          <p className="mode-tag">Estimació precisa</p>
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
          <p className="mode-tag">Contra rellotge</p>
          <p className="mode-name">Kilian</p>
          <p className="mode-desc">
            Cinc segons per paraula. Ratxes, multiplicadors i punts: el mateix
            lèxic, a tota velocitat.
          </p>
          {player ? (
            <Link href="/killian" className="btn">
              Juga
            </Link>
          ) : (
            <GuestButton primary label="Juga ara" href="/killian" />
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
