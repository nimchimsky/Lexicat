"use client";

// Mode Clàssic: decisió binària al propi ritme. Sense rellotge, feedback,
// ratxes ni dificultat en la puntuació; botons, fletxes o swipe horitzontal.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CLASSIC_PSEUDOWORD_CONFIDENCE,
  CLASSIC_WORD_CONFIDENCE,
  GAME_LENGTH,
} from "@/lib/config";
import { backoffDelay, isOffline, postJson, responseErrorMessage } from "@/lib/client/api";
import { LoadingScreen, ProgressTicks, Stimulus } from "@/components/game/Shared";
import { RetryScreen } from "@/components/game/RetryScreen";

export interface ClassicResume {
  gameId: string;
  nextPosition: number;
}

interface ItemPayload {
  position: number;
  stimulus: string;
  totalItems: number;
}

type Choice = "yes" | "no";
type InputMethod = "swipe" | "button" | "key";
type Phase = "intro" | "loading" | "playing" | "submitting" | "retry";

const SWIPE_THRESHOLD_PX = 48;

export default function ClassicClient({ resume }: { resume: ClassicResume | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(resume ? "loading" : "intro");
  const [gameId, setGameId] = useState<string | null>(resume?.gameId ?? null);
  const [item, setItem] = useState<ItemPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shownAt = useRef(0);
  const loadPosition = useRef(resume?.nextPosition ?? 1);
  const responseId = useRef("");
  const submitLock = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ id: 0, x: 0, y: 0, active: false });
  const pending = useRef<{
    body: Record<string, unknown>;
    nextPosition: number;
  } | null>(null);

  const presentItem = useCallback((next: ItemPayload) => {
    setItem(next);
    responseId.current = crypto.randomUUID();
    shownAt.current = performance.now();
    submitLock.current = false;
    const stage = stageRef.current;
    if (stage) {
      stage.style.setProperty("--drag-x", "0px");
      stage.classList.remove("drag-yes", "drag-no", "commit-yes", "commit-no");
    }
    setPhase("playing");
  }, []);

  const loadItem = useCallback(async (gid: string, position: number, attempt = 0): Promise<void> => {
    loadPosition.current = position;
    try {
      if (attempt > 0 && isOffline()) throw new Error("Sense connexió");
      const res = await fetch(`/api/game/item?gameId=${gid}&position=${position}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await responseErrorMessage(res));
      presentItem((await res.json()) as ItemPayload);
    } catch (e) {
      if (attempt < 4) {
        setTimeout(() => void loadItem(gid, position, attempt + 1), backoffDelay(attempt));
      } else {
        setError((e as Error).message);
        setPhase("retry");
      }
    }
  }, [presentItem]);

  useEffect(() => {
    if (resume && gameId && !item) void loadItem(gameId, resume.nextPosition);
    // Només reprèn l'estat rebut del servidor en el primer muntatge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startGame() {
    setPhase("loading");
    setError(null);
    submitLock.current = false;
    try {
      const data = await postJson<{ gameId: string }>("/api/game/start", { mode: "classic" });
      setGameId(data.gameId);
      await loadItem(data.gameId, 1);
    } catch (e) {
      setError((e as Error).message);
      setPhase("retry");
    }
  }

  async function handleResponse(data: { finished?: boolean }, gid: string, nextPosition: number) {
    pending.current = null;
    if (data.finished) {
      router.push(`/resultats/${gid}`);
      return;
    }
    await loadItem(gid, nextPosition);
  }

  async function respond(choice: Choice, method: InputMethod) {
    if (!gameId || !item || phase !== "playing" || submitLock.current) return;
    submitLock.current = true;
    setPhase("submitting");

    const elapsed = Math.round(performance.now() - shownAt.current);
    const body = {
      responseId: responseId.current,
      gameId,
      position: item.position,
      confidence: choice === "yes" ? CLASSIC_WORD_CONFIDENCE : CLASSIC_PSEUDOWORD_CONFIDENCE,
      timeToFirstInputMs: elapsed,
      responseTimeMs: elapsed,
      nAdjustments: 0,
      kind: "answer",
      choice,
      inputMethod: method,
    };
    pending.current = { body, nextPosition: item.position + 1 };
    try {
      const data = await postJson<{ finished?: boolean }>("/api/game/response", body);
      await handleResponse(data, gameId, item.position + 1);
    } catch (e) {
      setError((e as Error).message);
      setPhase("retry");
    }
  }

  async function retry() {
    setError(null);
    const p = pending.current;
    if (p && gameId) {
      setPhase("submitting");
      try {
        const data = await postJson<{ finished?: boolean }>("/api/game/response", p.body);
        await handleResponse(data, gameId, p.nextPosition);
      } catch (e) {
        setError((e as Error).message);
        setPhase("retry");
      }
      return;
    }
    if (gameId) await loadItem(gameId, loadPosition.current);
    else await startGame();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== "playing") return;
      const choice = e.key === "ArrowRight" ? "yes" : e.key === "ArrowLeft" ? "no" : null;
      if (!choice) return;
      e.preventDefault();
      void respond(choice, "key");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `phase` canvia entre ítems i manté el handler lligat a l'ítem vigent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== "playing") return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, active: true };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current.active || e.pointerId !== drag.current.id) return;
    const dx = e.clientX - drag.current.x;
    stageRef.current?.style.setProperty("--drag-x", `${Math.max(-70, Math.min(70, dx))}px`);
    stageRef.current?.classList.toggle("drag-yes", dx > SWIPE_THRESHOLD_PX * 0.6);
    stageRef.current?.classList.toggle("drag-no", -dx > SWIPE_THRESHOLD_PX * 0.6);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>, commit: boolean) {
    if (!drag.current.active || e.pointerId !== drag.current.id) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current.active = false;
    const stage = stageRef.current;
    stage?.classList.remove("drag-yes", "drag-no");
    if (!commit || Math.abs(dx) <= SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy) * 1.4) {
      stage?.style.setProperty("--drag-x", "0px");
      return;
    }
    const choice: Choice = dx > 0 ? "yes" : "no";
    if (stage) {
      stage.style.setProperty("--drag-x", choice === "yes" ? "44px" : "-44px");
      stage.classList.add(choice === "yes" ? "commit-yes" : "commit-no");
    }
    void respond(choice, "swipe");
  }

  if (phase === "intro") {
    return (
      <main className="game-intro classic-intro">
        <p className="eyebrow">Mode Clàssic</p>
        <h1>Paraula o pseudoparaula.</h1>
        <p className="lead">
          Cent estímuls i cap rellotge. Prem un botó o arrossega a la dreta si
          és una paraula i a l&apos;esquerra si és una pseudoparaula.
        </p>
        <ul className="rules">
          <li><b>{GAME_LENGTH}</b> estímuls, al teu ritme</li>
          <li><b>2</b> respostes possibles, sense graus de seguretat</li>
          <li><b>0</b> efecte del temps sobre la puntuació</li>
        </ul>
        <button className="btn" onClick={() => void startGame()}>Comença</button>
      </main>
    );
  }

  if (phase === "retry") {
    return (
      <RetryScreen
        error={error}
        resumeNote="Tot queda desat al servidor: reprendràs l'estímul pendent."
        onRetry={() => void retry()}
      />
    );
  }

  if (!item || phase === "loading") return <LoadingScreen />;

  const pos = String(item.position).padStart(2, "0");
  const total = String(item.totalItems).padStart(3, "0");

  return (
    <main className="game classic-game">
      <div className="game-head">
        <div className="counter">
          <span className="counter-pos">{pos} <em>/ {total}</em></span>
          <span className="counter-task">paraula?</span>
        </div>
        <ProgressTicks position={item.position} totalItems={item.totalItems} />
      </div>

      <div
        ref={stageRef}
        className="kil-stage classic-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, true)}
        onPointerCancel={(e) => endDrag(e, false)}
        role="group"
        aria-label="Arrossega a l'esquerra per pseudoparaula o a la dreta per paraula"
      >
        <span className="kil-hint kil-hint-no" aria-hidden="true">← pseudoparaula</span>
        <div className="stimulus-wrap kil-stage-card">
          <div className="stimulus"><Stimulus text={item.stimulus} /></div>
        </div>
        <span className="kil-hint kil-hint-yes" aria-hidden="true">paraula →</span>
      </div>

      <div className="dock kil-dock">
        <div className="kil-buttons">
          <button
            type="button"
            className="kil-btn no"
            disabled={phase !== "playing"}
            onClick={() => void respond("no", "button")}
          >
            <span aria-hidden="true">←</span> Pseudoparaula
          </button>
          <button
            type="button"
            className="kil-btn yes"
            disabled={phase !== "playing"}
            onClick={() => void respond("yes", "button")}
          >
            Paraula <span aria-hidden="true">→</span>
          </button>
        </div>
        <p className="classic-keys muted small">També pots fer swipe o usar les fletxes ← →</p>
      </div>
    </main>
  );
}
