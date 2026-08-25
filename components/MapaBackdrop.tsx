"use client";

// Fons decoratiu de la portada: el mapa compacte pesa ~425 KB i al mòbil
// pràcticament no es percep, així que només es carrega en pantalles amples.
// I encara: en pantalles amples es carrega EN RATLLE (requestIdleCallback),
// perquè és purament decoratiu i mai ha de competir amb el contingut real.
// El CSS també l'amaga per sota del tall, per si canvia l'orientació.

import { useEffect, useState } from "react";
import MapaCatala from "./MapaCatala";

const WIDE_QUERY = "(min-width: 900px)";

export default function MapaBackdrop({ claimedIds }: { claimedIds?: string[] }) {
  const [wide, setWide] = useState(false);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!wide || idle) return;
    // Tipat lax: requestIdleCallback no és a tots els motors.
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const w = window as IdleWindow;
    let handle = 0;
    const fallback = window.setTimeout(() => setIdle(true), 1500);
    if (w.requestIdleCallback) {
      handle = w.requestIdleCallback(() => setIdle(true), { timeout: 2500 });
    }
    return () => {
      window.clearTimeout(fallback);
      if (handle && w.cancelIdleCallback) w.cancelIdleCallback(handle);
    };
  }, [wide, idle]);

  if (!wide || !idle) return null;
  return (
    <div className="mapa-bg" aria-hidden="true">
      <MapaCatala variant="compacte" claimedIds={claimedIds ?? []} interactive={false} />
    </div>
  );
}
