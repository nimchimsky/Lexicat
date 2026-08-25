"use client";

import { useEffect, useState } from "react";
import { isOffline } from "@/lib/client/api";

/**
 * Pantalla «S'ha perdut el fil» compartida. Distingeix no-connexió d'error
 * de servidor (el missatge del servidor ja ve informat) i recorda que la
 * partida es reprèn exactament on era.
 */
export function RetryScreen({
  error,
  onRetry,
  resumeNote = "La partida queda desada al servidor: es reprèn exactament on era.",
}: {
  error: string | null;
  onRetry: () => void;
  resumeNote?: string;
}) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(isOffline());
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <main className="game-intro">
      <p className="eyebrow">Connexió</p>
      <h1>S&apos;ha perdut el fil.</h1>
      <p className="lead">{error ?? "Alguna cosa ha fallat."}</p>
      {offline ? (
        <p className="muted small" role="status">
          Sembla que no hi ha connexió a internet. Quan torni, toca Reintenta.
        </p>
      ) : null}
      <p className="muted small">{resumeNote}</p>
      <button className="btn" onClick={onRetry}>
        Reintenta
      </button>
    </main>
  );
}
