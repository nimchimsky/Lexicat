"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SLIDER_LIKERT_LABELS, SLIDER_STEPS } from "@/lib/config";

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

type PendingSubmission = {
  body: {
    responseId: string;
    gameId: string;
    position: number;
    confidence: number;
    timeToFirstInputMs: number | null;
    responseTimeMs: number;
    nAdjustments: number;
  };
  position: number;
};

/**
 * Pantalla de partida. Sense cap feedback per ítem: ni color, ni so, ni marcador.
 * Cada resposta porta un UUID generat al client (idempotència §8.5) i mesures
 * de temps per poder estudiar el cost real del format (§8.4).
 */
/** L'estímul SEMPRE en una sola línia; «l·l» s'envolta d'aire per llegir-se bé. */
function Stimulus({ text }: { text: string }) {
  const parts = text.split(/(l·l)/g);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p === "l·l" ? (
          <span key={i} className="gemil">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export default function GameClient({ openGame, buttonLabels }: GameClientProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [gameId, setGameId] = useState<string | null>(openGame?.gameId ?? null);
  const [format, setFormat] = useState<string>(openGame?.responseFormat ?? "buttons");
  const [item, setItem] = useState<ItemPayload | null>(null);
  // Passos de la partida EN CURS: una partida antiga represa manté la seva
  // escala desada (21) i no canvia a mig camí; les noves fan servir la vigent.
  const [steps, setSteps] = useState<number>(openGame?.sliderSteps ?? SLIDER_STEPS);
  const [sliderValue, setSliderValue] = useState<number>(() => Math.floor((openGame?.sliderSteps ?? SLIDER_STEPS) / 2));
  const mid = Math.floor(steps / 2);
  const [error, setError] = useState<string | null>(null);

  // Mesures de l'ítem en curs
  const shownAt = useRef<number>(0);
  const firstInputAt = useRef<number | null>(null);
  const adjustments = useRef<number>(0);
  const responseId = useRef<string>("");
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const submitLock = useRef<boolean>(false);
  const pendingSubmission = useRef<PendingSubmission | null>(null);

  const newResponseId = () => {
    responseId.current = crypto.randomUUID();
  };

  const loadItem = useCallback(async (gid: string, position: number, attempt = 0): Promise<void> => {
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
      // Centre neutre EXACTE: amb N passos els valors són 0..N−1.
      setSliderValue(mid);
      shownAt.current = performance.now();
      firstInputAt.current = null;
      adjustments.current = 0;
      submitLock.current = false;
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
  }, []);

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
    submitLock.current = false;
    try {
      const res = await fetch("/api/game/start", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "No s'ha pogut començar");
      }
      const data = await res.json();
      setGameId(data.gameId);
      setFormat(data.responseFormat ?? "buttons");
      if (data.sliderSteps) setSteps(data.sliderSteps);
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

  /**
   * El slider ES RESPO EN DEIXAR-LO ANAR: arrossegant o picant directament a la
   * posició (el botó de confirmar sobra i cal velocitat). Amb 7 passos els
   * índexs són 0..6 → confiança k/6; el centre cau exactament a 0,50, coherent
   * amb la regla de desempat del servidor. El bloqueig evita el doble
   * enviament pointerup+touchend d'alguns navegadors.
   */
  function commitSliderRelease() {
    if (submitLock.current || phase !== "playing" || !item) return;
    const el = sliderRef.current;
    if (!el) return;
    submitLock.current = true;
    registerFirstInput();
    void submit(Number(el.value) / (steps - 1));
  }

  async function submit(confidence: number) {
    if (!gameId || !item) return;
    setPhase("submitting");
    const now = performance.now();
    const body: PendingSubmission["body"] = {
      responseId: responseId.current,
      gameId,
      position: item.position,
      confidence,
      timeToFirstInputMs:
        firstInputAt.current !== null ? Math.round(firstInputAt.current - shownAt.current) : null,
      responseTimeMs: Math.round(now - shownAt.current),
      nAdjustments: adjustments.current,
    };
    pendingSubmission.current = { body, position: item.position };
    try {
      const res = await fetch("/api/game/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      pendingSubmission.current = null;
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

  async function retryPendingSubmission() {
    const pending = pendingSubmission.current;
    if (!pending) return;
    setPhase("submitting");
    try {
      const res = await fetch("/api/game/response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending.body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      pendingSubmission.current = null;
      if (data.finished) {
        router.push(`/resultats/${pending.body.gameId}`);
        return;
      }
      await loadItem(pending.body.gameId, pending.position + 1);
    } catch (e) {
      setError((e as Error).message);
      setPhase("retry");
    }
  }

  if (!gameId && phase === "loading") {
    return (
      <main className="game-intro">
        <p className="eyebrow">Mode Pompeu</p>
        <h1>Cent paraules. Cap pista.</h1>
        <p className="lead">
          De cada estímul només has de dir una cosa: si existeix en català. No
          sabràs si l&apos;encertes fins al final. Fes una pausa quan vulguis.
        </p>
        <ul className="rules">
          <li>
            <b>100</b> estímuls per partida
          </li>
          <li>
            <b>7</b> graus de seguretat, del «segur que no» al «segur que sí»
          </li>
          <li>
            <b>0</b> correccions durant el camí
          </li>
        </ul>
        <button className="btn" onClick={() => void startGame()}>
          Comença
        </button>
      </main>
    );
  }

  if (phase === "retry") {
    return (
      <main className="game-intro">
        <p className="eyebrow">Connexió</p>
        <h1>S&apos;ha perdut el fil.</h1>
        <p className="lead">{error}</p>
        <p className="muted small">
          La partida queda desada al servidor: es reprèn exactament on era.
        </p>
        <button
          className="btn"
          onClick={() => {
            setError(null);
            if (pendingSubmission.current) void retryPendingSubmission();
            else if (gameId && item) void loadItem(gameId, item.position);
            else void startGame();
          }}
        >
          Reintenta
        </button>
      </main>
    );
  }

  if (!item || phase === "loading") {
    return (
      <main className="game-intro center">
        <p className="loading muted" aria-live="polite">
          Carregant
          <span />
          <span />
          <span />
        </p>
      </main>
    );
  }

  const zone = sliderValue < mid ? "zone-no" : sliderValue === mid ? "zone-mid" : "zone-yes";
  const thumbColor =
    sliderValue < mid
      ? "var(--scale-no)"
      : sliderValue === mid
        ? "var(--scale-mid)"
        : "var(--scale-yes)";
  const pos = String(item.position).padStart(2, "0");
  const total = String(item.totalItems).padStart(3, "0");

  const readout =
    SLIDER_LIKERT_LABELS[sliderValue] ??
    `${Math.round((sliderValue / (steps - 1)) * 100)}%`;

  return (
    <main className="game">
      <div className="game-head">
        <div className="counter">
          <span className="counter-pos">
            {pos} <em>/ {total}</em>
          </span>
          <span className="counter-task">existeix?</span>
        </div>

        {/* Progrés: la senyera s'omple fins a l'ítem en curs; la retícula
            de sobre marca cada desena part del recorregut. */}
        <div
          className="ticks"
          role="progressbar"
          aria-label="Progrés de la partida"
          aria-valuemin={1}
          aria-valuemax={item.totalItems}
          aria-valuenow={item.position}
          aria-valuetext={`${item.position} de ${item.totalItems}`}
        >
          <div
            className="ticks-flag"
            aria-hidden="true"
            style={{ width: `${((item.position - 1) / item.totalItems) * 100}%` }}
          />
          <div className="ticks-grid" aria-hidden="true" />
        </div>
      </div>

      <div className="stimulus-wrap">
        <div className="stimulus">
          <Stimulus text={item.stimulus} />
        </div>
      </div>

      <div className="dock">
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
          <div className="scale">
            <div className={`scale-readout ${zone}`} aria-live="polite">
              {readout}
            </div>
            <div className="scale-track">
              <input
                ref={sliderRef}
                type="range"
                min={0}
                max={steps - 1}
                step={1}
                value={sliderValue}
                disabled={phase !== "playing"}
                style={{ "--thumb-color": thumbColor } as React.CSSProperties}
                onChange={(e) => {
                  adjustments.current += 1;
                  registerFirstInput();
                  setSliderValue(Number(e.target.value));
                }}
                onPointerDown={() => registerFirstInput()}
                onPointerUp={() => commitSliderRelease()}
                onTouchEnd={() => commitSliderRelease()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitSliderRelease();
                  } else {
                    registerFirstInput();
                  }
                }}
                aria-label="Seguretat que existeix (allibera per respondre)"
                aria-valuetext={readout}
              />
              <div className="scale-divs" aria-hidden="true">
                {Array.from({ length: steps }, (_, i) => (
                  <span key={i} />
                ))}
              </div>
            </div>
            <div className="scale-hints">
              <span>segur que NO és paraula</span>
              <span>no sé</span>
              <span>segur que SÍ és paraula</span>
            </div>
          </div>
        )}

        {error ? (
          <p className="small muted">{error} — es reintenta automàticament.</p>
        ) : null}
      </div>
    </main>
  );
}
