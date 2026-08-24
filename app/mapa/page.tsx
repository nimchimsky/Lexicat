import Link from "next/link";
import { currentPlayer } from "@/lib/server/auth";
import { getMapaView } from "@/lib/server/mapa";
import { getPlayerSummary } from "@/lib/server/views";
import MapaCatala from "@/components/MapaCatala";
import MapaClient from "@/components/MapaClient";
import GuestButton from "@/components/GuestButton";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "El teu mapa — Lexicat",
};

export default async function MapaPage() {
  const player = await currentPlayer();

  if (!player) {
    // Sense sessió: el mapa en negre com a aparador i l'entrada al joc.
    return (
      <main>
        <p className="eyebrow">Metaprogrés</p>
        <h1>El mapa del lèxic</h1>
        <p className="lead">
          Cent zones, una per cada 1% del lèxic català. Cada paraula que respons
          omple el teu mapa dels Països Catalans: tu tries quin territori pintes.
        </p>
        <div className="mapa-stage">
          <MapaCatala variant="compacte" interactive={false} />
        </div>
        <div className="actions">
          <GuestButton primary label="Juga ara" />
          <Link href="/entrar" className="btn secondary">
            Entra amb correu
          </Link>
        </div>
      </main>
    );
  }

  const [view, summary] = await Promise.all([getMapaView(player.id), getPlayerSummary(player.id)]);

  return (
    <main>
      <p className="eyebrow">Metaprogrés</p>
      <h1>El teu mapa</h1>
      {summary?.standing ? (
        <p className="muted small">
          Lexicó estimat {summary.standing.pctLexicon.toFixed(1)}% ·{" "}
          {summary.standing.nGames}/5 partides a la finestra
        </p>
      ) : null}
      <MapaClient view={view} />
    </main>
  );
}

