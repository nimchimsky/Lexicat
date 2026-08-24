"use client";

// Pantalla /mapa: el teu territori, el progrés cap a la propera zona i el
// selector de reclam. La fitxa es gasta en dos passos (tocar + confirmar)
// perquè al mòbil un toc accidental no hauria de decidir res de permanent.

import { useMemo, useState } from "react";
import Link from "next/link";
import MapaCatala, { type MapaVariant } from "./MapaCatala";
import { REGIONS, regionInfo } from "@/lib/mapa/catalog";
import type { MapaView } from "@/lib/server/mapa";

const WORDS_PER_GAME = 66; // paraules reals per partida

export default function MapaClient({ view }: { view: MapaView }) {
  const [variant, setVariant] = useState<MapaVariant>("compacte");
  const [claimed, setClaimed] = useState<string[]>(view.claimedIds);
  const [pending, setPending] = useState(view.pending);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const claimedSet = useMemo(() => new Set(claimed), [claimed]);
  const availableIds = useMemo(
    () => (pending > 0 ? REGIONS.map((r) => r.id).filter((id) => !claimedSet.has(id)) : []),
    [pending, claimedSet]
  );

  const info = regionInfo(selected ?? hovered ?? "");
  const infoRegion = info ? REGIONS.find((r) => r.id === info.id) ?? null : null;
  const selectedClaimable = selected !== null && availableIds.includes(selected);

  async function claim() {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mapa/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ regionId: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const name = regionInfo(selected)?.name ?? selected;
      setClaimed((c) => [...c, selected]);
      setPending((p) => Math.max(0, p - 1));
      setFlash(`Zona reclamada: ${name}`);
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pctToNext =
    view.nextThreshold === null
      ? 100
      : Math.min(100, (view.wordsSeen / view.nextThreshold) * 100);

  return (
    <>
      <div className="mapa-head">
        <div className="mapa-counters">
          <span className="mapa-zones">
            <b>{claimed.length}</b>/{view.zones} zones
          </span>
          <span className="muted">
            {view.wordsSeen.toLocaleString("ca-ES")} paraules vistes de{" "}
            {view.wordsTotal.toLocaleString("ca-ES")}
          </span>
        </div>
        <div className="mapa-toggle" role="group" aria-label="Variant del mapa">
          <button className={variant === "compacte" ? "on" : ""} onClick={() => setVariant("compacte")}>
            Compacte
          </button>
          <button className={variant === "geografic" ? "on" : ""} onClick={() => setVariant("geografic")}>
            Geogràfic
          </button>
        </div>
      </div>

      {view.completed ? (
        <div className="notice">
          <b>Països Catalans complets.</b> Has respost tot el lèxic i el mapa és teu.
        </div>
      ) : pending > 0 ? (
        <div className="notice mapa-pending">
          Tens <b>{pending}</b> {pending === 1 ? "zona per col·locar" : "zones per col·locar"}: toca una
          regió fosca del mapa i confirma.
        </div>
      ) : (
        <p className="muted small">
          Propera zona en {view.wordsToNext?.toLocaleString("ca-ES")} paraules (aprox.{" "}
          {Math.ceil((view.wordsToNext ?? 0) / WORDS_PER_GAME)} partides).
        </p>
      )}

      <div className="mapa-progress" aria-hidden="true">
        <i style={{ width: `${pctToNext}%` }} />
      </div>

      {flash ? (
        <p className="mapa-flash" role="status">
          {flash}
        </p>
      ) : null}
      {error ? (
        <p className="mapa-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mapa-stage">
        <MapaCatala
          variant={variant}
          claimedIds={claimed}
          availableIds={availableIds}
          selectedId={selected}
          onPick={setSelected}
          onHover={setHovered}
        />
      </div>

      <div className="mapa-legend" aria-hidden="true">
        <span>
          <i className="is-claimed" /> teva
        </span>
        {availableIds.length > 0 ? (
          <span>
            <i className="is-free" /> per triar
          </span>
        ) : null}
        <span>
          <i /> encara no
        </span>
      </div>

      <div className="mapa-info" aria-live="polite">
        {infoRegion ? (
          <>
            <b>{infoRegion.name}</b>
            <span className="muted">
              {infoRegion.territory} · {infoRegion.kind}
              {claimedSet.has(infoRegion.id) ? " · teva" : ""}
            </span>
            {selectedClaimable ? (
              <button className="btn" onClick={() => void claim()} disabled={busy}>
                {busy ? "Reclamant…" : `Reclama ${infoRegion.name}`}
              </button>
            ) : null}
          </>
        ) : (
          <span className="muted">
            Passa per damunt d&apos;una regió per veure&apos;n el nom{pending > 0 ? "; toca-la per triar-la" : ""}.
          </span>
        )}
      </div>

      <p className="small muted mapa-how">
        Cada ~1% del lèxic (≈408 paraules reals vistes, uns 6–7 partides) desbloqueja una zona del
        mapa. Tu tries quin territori pintes: quan hàgis respost tot el lèxic, els Països Catalans
        sencers seran teus.
      </p>

      <div className="actions">
        <Link href="/joc" className="btn">
          Torna al joc
        </Link>
      </div>
    </>
  );
}
