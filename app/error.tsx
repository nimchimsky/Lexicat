"use client";

import Link from "next/link";

// Boundary d'error global. Qualsevol excepció no capturada cau aquí, dins
// el sistema visual del joc i en català — mai a la pantalla anglesa per
// defecte de Next.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="game-intro">
      <p className="eyebrow">Error</p>
      <h1>Alguna cosa s&apos;ha esgarrat.</h1>
      <p className="lead">
        No és cosa teva: ha fallat el servidor o la connexió. Les partides
        queden desades i es reprèn on eren.
      </p>
      {error.digest ? (
        <p className="muted small">Referència tècnica: {error.digest}</p>
      ) : null}
      <div className="actions">
        <button className="btn" onClick={reset}>
          Torna-ho a provar
        </button>
        <Link className="btn secondary" href="/">
          Portada
        </Link>
      </div>
    </main>
  );
}
