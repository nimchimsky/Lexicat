"use client";

// Injector del SVG del mapa (una còpia per variant, servida des de /public)
// amb pintat d'estats per regió i events per delegació. Segueix el contracte
// del paquet cartogràfic: es manipula sempre el <g class="lexic-region">,
// mai paths individuals (el Carxe en té tres).
//
// Per quí no <object>: injectant inline el CSS del document pot sobreescriure
// els colors per defecte i els estats (claimed/available/selected) sense
// cap API de missatgeria. L'SVG es descarrega una vegada i el navegador
// el cacheja; cap geometria no entra al bundle JS.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type MapaVariant = "compacte" | "geografic";

const FILES: Record<MapaVariant, string> = {
  compacte: "/mapa/paisos-catalans-100.compact.svg",
  geografic: "/mapa/paisos-catalans-100.svg",
};

export interface MapaCatalaProps {
  variant?: MapaVariant;
  /** Regions ja reclamades: queden enceses. */
  claimedIds?: string[];
  /** Regions que es poden triar ara (hi ha fitxa pendent). */
  availableIds?: string[];
  /** Regió seleccionada al picker (si n'hi ha). */
  selectedId?: string | null;
  /** false = decoratiu: sense focus ni rols de botó (per a portada/miniatures). */
  interactive?: boolean;
  onPick?: (regionId: string) => void;
  onHover?: (regionId: string | null) => void;
}

type Status = "loading" | "ready" | "error";

interface Tip {
  name: string;
  territory: string;
  x: number;
  y: number;
}

export default function MapaCatala({
  variant = "compacte",
  claimedIds = [],
  availableIds = [],
  selectedId = null,
  interactive = true,
  onPick,
  onHover,
}: MapaCatalaProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const [tip, setTip] = useState<Tip | null>(null);
  const lastHover = useRef<string | null>(null);
  // Identificador únic per instància: els SVG porten id="map-title"/"map-desc"
  // fixos i dues instàncies a la mateixa pàgina no poden xocar.
  const uid = useMemo(() => `m${Math.random().toString(36).slice(2, 8)}`, []);

  // Càrrega + injecta l'SVG de la variant.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let alive = true;
    setStatus("loading");
    fetch(FILES[variant], { cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!alive || !boxRef.current) return;
        boxRef.current.innerHTML = text
          .replace(/id="map-title"/g, `id="${uid}-title"`)
          .replace(/id="map-desc"/g, `id="${uid}-desc"`)
          .replace(/aria-labelledby="map-title map-desc"/g, `aria-labelledby="${uid}-title ${uid}-desc"`);
        if (!interactive) {
          for (const g of boxRef.current.querySelectorAll("g.lexic-region")) {
            g.removeAttribute("tabindex");
            g.removeAttribute("role");
          }
        }
        setStatus("ready");
      })
      .catch(() => {
        if (alive) setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [variant, interactive, uid, attempt]);

  // Pintat d'estats (després de cada injecta o canvi de l'estat del jugador).
  useEffect(() => {
    const box = boxRef.current;
    if (!box || status !== "ready") return;
    const claimed = new Set(claimedIds);
    const available = new Set(availableIds);
    for (const g of box.querySelectorAll<SVGGElement>("g.lexic-region")) {
      const id = g.getAttribute("data-region-id");
      if (!id) continue;
      if (selectedId && id === selectedId) g.setAttribute("data-state", "selected");
      else if (claimed.has(id)) g.setAttribute("data-state", "claimed");
      else if (available.has(id)) g.setAttribute("data-state", "available");
      else g.removeAttribute("data-state");
      g.setAttribute("aria-pressed", claimed.has(id) ? "true" : "false");
    }
  }, [status, claimedIds, availableIds, selectedId, variant]);

  const regionFrom = useCallback(
    (t: EventTarget | null): string | null => {
      if (!interactive || !(t instanceof Element)) return null;
      const g = t.closest("g.lexic-region[data-region-id]");
      return g ? g.getAttribute("data-region-id") : null;
    },
    [interactive]
  );

  /** Coordenades del cursor dins del contenidor, esgarrapades a les vores. */
  const tipAt = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - r.left, 80), Math.max(r.width - 80, 80));
    return { x, y: Math.max(clientY - r.top, 0) };
  }, []);

  const showTipFor = useCallback(
    (t: EventTarget | null, clientX?: number, clientY?: number) => {
      if (!(t instanceof Element)) return;
      const g = t.closest("g.lexic-region[data-region-id]");
      if (!g) return;
      const pos =
        clientX !== undefined && clientY !== undefined
          ? tipAt(clientX, clientY)
          : (() => {
              const wrap = wrapRef.current;
              if (!wrap) return null;
              const r = g.getBoundingClientRect();
              const w = wrap.getBoundingClientRect();
              return {
                x: Math.min(Math.max(r.left + r.width / 2 - w.left, 80), Math.max(w.width - 80, 80)),
                y: Math.max(r.top - w.top, 0),
              };
            })();
      if (!pos) return;
      setTip({
        name: g.getAttribute("data-name") ?? g.getAttribute("data-region-id") ?? "",
        territory: g.getAttribute("data-territory") ?? "",
        ...pos,
      });
    },
    [tipAt]
  );

  return (
    <div
      ref={wrapRef}
      className={`mapa-svg${interactive ? "" : " mapa-static"}`}
      aria-hidden={interactive ? undefined : "true"}
    >
      {status === "loading" ? (
        <div className="loading" role="status">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {status === "error" ? (
        <p className="muted">
          No s&apos;ha pogut carregar el mapa.{" "}
          <button className="mapa-retry" onClick={() => setAttempt((n) => n + 1)}>
            Torna-hi
          </button>
        </p>
      ) : null}
      <div
        ref={boxRef}
        className="mapa-inject"
        onClick={(e) => {
          const id = regionFrom(e.target);
          if (id && availableIds.includes(id)) onPick?.(id);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          const id = regionFrom(e.target);
          if (id && availableIds.includes(id)) {
            e.preventDefault();
            onPick?.(id);
          }
        }}
        onMouseOver={(e) => {
          const id = regionFrom(e.target);
          if (id && id !== lastHover.current) {
            lastHover.current = id;
            onHover?.(id);
          }
          if (id) showTipFor(e.target, e.clientX, e.clientY);
        }}
        onMouseMove={(e) => {
          if (lastHover.current) showTipFor(e.target, e.clientX, e.clientY);
        }}
        onMouseOut={(e) => {
          if (regionFrom(e.target) && !regionFrom(e.relatedTarget)) {
            lastHover.current = null;
            setTip(null);
            onHover?.(null);
          }
        }}
        onFocusCapture={(e) => {
          const id = regionFrom(e.target);
          if (id && id !== lastHover.current) {
            lastHover.current = id;
            onHover?.(id);
          }
          if (id) showTipFor(e.target);
        }}
        onBlurCapture={(e) => {
          if (regionFrom(e.target) && !regionFrom(e.relatedTarget)) {
            lastHover.current = null;
            setTip(null);
            onHover?.(null);
          }
        }}
      />
      {tip ? (
        <div className="mapa-tip" style={{ left: tip.x, top: tip.y }} aria-hidden="true">
          {tip.name} ({tip.territory})
        </div>
      ) : null}
    </div>
  );
}
