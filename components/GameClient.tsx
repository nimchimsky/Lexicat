"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SLIDER_LIKERT_LABELS,
  SLIDER_STEPS,
  BUTTON_LABELS,
  BUTTON_CONFIDENCE,
  GAME_LENGTH,
} from "@/lib/config";
import { backoffDelay, isOffline, postJson, responseErrorMessage } from "@/lib/client/api";
import { Stimulus, LoadingScreen, ProgressTicks } from "@/components/game/Shared";
import { RetryScreen } from "@/components/game/RetryScreen";

interface ItemPayload {
  position: number;
  stimulus: string;
  totalItems: number;
}

export interface GameClientProps {
  openGame: { gameId: string; nextPosition: number; responseFormat: string; sliderSteps: number | null } | null;
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
export default function GameClient({ openGame }: GameClientProps) {
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
      if (attempt > 0 && isOffline()) throw new Error("Sense connexió");
      const res = await fetch(`/api/game/item?gameId=${gid}&position=${position}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await responseErrorMessage(res));
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
        setTimeout(() => void loadItem(gid, position, attempt + 1), backoffDelay(attempt));
      } else {
        setError((e as Error).message);
        setPhase("retry");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const data = await postJson<{
        gameId: string;
        responseFormat?: string;
        sliderSteps?: number;
      }>("/api/game/start", {});
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
   * posició (el botó de confirmar sobra i cal velocitat). Amb N passos els
   * índexs són 0..N−1 → confiança k/(N−1); el centre cau exactament a 0,50,
   * coherent amb la regla de desempat del servidor. El bloqueig evita el doble
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

  async function postResponse(body: PendingSubmission["body"]): Promise<{ finished: boolean }> {
    return postJson<{ finished: boolean }>("/api/game/response", body);
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
      const data = await postResponse(body);
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
      const data = await postResponse(pending.body);
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
            <b>{GAME_LENGTH}</b> estímuls per partida
          </li>
          <li>
            <b>{SLIDER_STEPS}</b> graus de seguretat, del «segur que no» al «segur que sí»
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
      <RetryScreen
        error={error}
        onRetry={() => {
          setError(null);
          if (pendingSubmission.current) void retryPendingSubmission();
          else if (gameId && item) void loadItem(gameId, item.position);
          else void startGame();
        }}
      />
    );
  }

  if (!item || phase === "loading") {
    return <LoadingScreen />;
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
    steps === SLIDER_LIKERT_LABELS.length
      ? (SLIDER_LIKERT_LABELS[sliderValue] ?? `${Math.round((sliderValue / (steps - 1)) * 100)}%`)
      : `${Math.round((sliderValue / (steps - 1)) * 100)}%`;

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
        <ProgressTicks position={item.position} totalItems={item.totalItems} />
      </div>

      <div className="stimulus-wrap">
        <div className="stimulus">
          <Stimulus text={item.stimulus} />
        </div>
      </div>

      <div className="dock">
        {format === "buttons" ? (
          <div className="answers">
            {BUTTON_LABELS.map((label, idx) => (
              <button
                key={label}
                className={idx === 2 ? "btn secondary" : "btn"}
                disabled={phase === "submitting"}
                onClick={() => {
                  registerFirstInput();
                  void submit(BUTTON_CONFIDENCE[idx]);
                }}
              >
                {label}
              </button>
            ))}
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
