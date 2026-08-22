"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ItemPayload {
  position: number;
  stimulus: string;
  totalItems: number;
}

export interface GameClientProps {
  openGame: { gameId: string; nextPosition: number; responseFormat: string; sliderSteps: number | null } | null;
  buttonLabels: readonly string[];
}

type Phase = "loading" | "playing" | "submitting" | "retry" | "done";

/**
 * Pantalla de partida. Sense cap feedback per ítem: ni color, ni so, ni marcador.
 * Cada resposta porta un UUID generat al client (idempotència §8.5) i mesures
 * de temps per poder estudiar el cost real del format (§8.4).
 */
export default function GameClient({ openGame, buttonLabels }: GameClientProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [gameId, setGameId] = useState<string | null>(openGame?.gameId ?? null);
  const [format, setFormat] = useState<string>(openGame?.responseFormat ?? "buttons");
  const [sliderSteps, setSliderSteps] = useState<number>(openGame?.sliderSteps ?? 21);
  const [item, setItem] = useState<ItemPayload | null>(null);
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mesures de l'ítem en curs
  const shownAt = useRef<number>(0);
  const firstInputAt = useRef<number | null>(null);
  const adjustments = useRef<number>(0);
  const responseId = useRef<string>("");

  const newResponseId = () => {
    responseId.current = crypto.randomUUID();
  };

  const loadItem = useCallback(
    async (gid: string, position: number, attempt = 0): Promise<void> => {
      try {
        const res = await fetch(`/api/game/item?gameId=${gid}&position=${position}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const data: ItemPayload = await res.json();
        setItem(data);
        setSliderValue(null);
        shownAt.current = performance.now();
        firstInputAt.current = null;
        adjustments.current = 0;
        newResponseId();
        setPhase("playing");
      } catch (e) {
        if (attempt < 4) {
          setTimeout(() => void loadItem(gid, position, attempt + 1), 800 * (attempt + 1));
        } else {
          setError((e as Error).message);
          setPhase("retry");
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!gameId) return; // sense partida: es mostra el botó de començar
    if (!item && phase === "loading") {
      void loadItem(gameId, openGame?.nextPosition ?? 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  async function startGame() {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch("/api/game/start", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "No s'ha pogut començar");
      }
      const data = await res.json();
      setGameId(data.gameId);
      setFormat(data.responseFormat ?? "buttons");
      setSliderSteps(data.sliderSteps ?? 21);
      await loadItem(data.gameId, 1);
    } catch (e) {
      setError((e as Error).message);
      setPhase("retry");
    }
  }

  function registerFirstInput() {
    if (firstInputAt.current === null) {
      firstInputAt.current = performance.now();
    }
  }

  async function submit(confidence: number) {
    if (!gameId || !item) return;
    setPhase("submitting");
    const now = performance.now();
    try {
      const res = await fetch("/api/game/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responseId: responseId.current,
          gameId,
          position: item.position,
          confidence,
          timeToFirstInputMs:
            firstInputAt.current !== null ? Math.round(firstInputAt.current - shownAt.current) : null,
          responseTimeMs: Math.round(now - shownAt.current),
          nAdjustments: adjustments.current,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.finished) {
        router.push(`/resultats/${gameId}`);
        return;
      }
      await loadItem(gameId, item.position + 1);
    } catch (e) {
      // Reenviament segur: mateix response_id, el servidor és idempotent.
      setError((e as Error).message);
      setPhase("retry");
    }
  }

  if (!gameId && phase === "loading") {
    return (
      <main>
        <h1>Mode Pompeu</h1>
        <p className="muted">
          Cent estímuls. Per a cadascun, digues com de segur estàs que existeix.
          No hi ha feedback fins al final. Pots fer una pausa i reprendre quan vulguis.
        </p>
        <button className="btn" onClick={() => void startGame()}>
          Comença
        </button>
      </main>
    );
  }

  if (phase === "retry") {
    return (
      <main>
        <div className="notice">S&apos;ha perdut la connexió: {error}</div>
        <button
          className="btn"
          onClick={() => {
            setError(null);
            if (gameId && item) void loadItem(gameId, item.position);
            else void startGame();
          }}
        >
          Torna-ho a provar
        </button>
      </main>
    );
  }

  if (!item || phase === "loading") {
    return (
      <main>
        <p className="muted">Carregant…</p>
      </main>
    );
  }

  const progress = ((item.position - 1) / item.totalItems) * 100;

  return (
    <main style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div className="counter">
        <span>
          {item.position} / {item.totalItems}
        </span>
        <span>existeix?</span>
      </div>
      <div className="progressbar">
        <div style={{ width: `${progress}%` }} />
      </div>

      <div className="stimulus-wrap">
        <div className="stimulus">{item.stimulus}</div>
      </div>

      {format === "buttons" ? (
        <div className="answers">
          {buttonLabels.map((label, idx) => {
            const confidences = [0.05, 0.25, 0.5, 0.75, 0.95];
            return (
              <button
                key={idx}
                className={idx === 2 ? "btn secondary" : "btn"}
                disabled={phase === "submitting"}
                onClick={() => {
                  registerFirstInput();
                  void submit(confidences[idx]);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="slider-row">
          <div className="slider-value">
            {sliderValue === null ? "—" : `${Math.round((sliderValue / sliderSteps) * 100)}%`}
          </div>
          <input
            type="range"
            min={0}
            max={sliderSteps}
            step={1}
            value={sliderValue ?? Math.round(sliderSteps / 2)}
            disabled={phase === "submitting"}
            onChange={(e) => {
              adjustments.current += 1;
              registerFirstInput();
              setSliderValue(Number(e.target.value));
            }}
            aria-label="Seguretat que existeix"
          />
          <div style={{ display: "flex", justifyContent: "space-between" }} className="small muted">
            <span>segur que no</span>
            <span>50%</span>
            <span>segur que sí</span>
          </div>
          <button
            className="btn"
            disabled={phase === "submitting" || sliderValue === null}
            onClick={() => {
              if (sliderValue === null) return;
              void submit(sliderValue / sliderSteps);
            }}
          >
            {sliderValue === null ? "Arrossega l'slider i confirma" : "Confirma"}
          </button>
        </div>
      )}

      {error ? <p className="small muted">{error} — es reintenta automàticament.</p> : null}
    </main>
  );
}
