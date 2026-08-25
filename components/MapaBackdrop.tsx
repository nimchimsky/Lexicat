"use client";

// Fons decoratiu de la portada: el mapa compacte pesa ~425 KB i al mòbil
// pràcticament no es percep, així que només es carrega en pantalles amples.
// El CSS també l'amaga per sota del tall, per si canvia l'orientació.

import { useEffect, useState } from "react";
import MapaCatala from "./MapaCatala";

const WIDE_QUERY = "(min-width: 900px)";

export default function MapaBackdrop({ claimedIds }: { claimedIds?: string[] }) {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (!wide) return null;
  return (
    <div className="mapa-bg" aria-hidden="true">
      <MapaCatala variant="compacte" claimedIds={claimedIds ?? []} interactive={false} />
    </div>
  );
}
