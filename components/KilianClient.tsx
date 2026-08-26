"use client";

// Mode Kilian: judici binari contra rellotge. La barra ÉS la puntuació
// (100 punts que baixen linealment en 5 s); la ratxa multiplica a partir
// del cinquè encert consecutiu i qualsevol error o timeout la trenca.
// El servidor és l'única font de veritat: aquí només es mostra el que torna.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  KILIAN_BAR_MS,
  KILIAN_FEEDBACK_HIT_MS,
  KILIAN_FEEDBACK_MISS_MS,
  KILIAN_YES_CONFIDENCE,
  KILIAN_NO_CONFIDENCE,
} from "@/lib/config";
import { postJson, responseErrorMessage } from "@/lib/client/api";
import { Stimulus, LoadingScreen, ProgressTicks } from "@/components/game/Shared";
import { RetryScreen } from "@/components/game/RetryScreen";

export interface KilianResume {
  gameId: string;
  nextPosition: number;
  scoreSoFar: number;
  streakNow: number;
}

export interface KilianClientProps {
  resume: KilianResume | null;
  firstTime: boolean;
}

interface ItemPayload {
  position: number;
  stimulus: string;
  totalItems: number;
}

interface KilianOutcome {
  isCorrect: boolean;
  kind: "answer" | "timeout";
  points: number;
  streakAfter: number;
  multiplier: number;
  scoreSoFar: number;
  itemWasWord: boolean;
}

type Phase = "intro" | "practice" | "loading" | "playing" | "paused" | "feedback" | "retry";

/** El miniaprenentatge només té exemples declarats com a tals: cap dada del banc. */
const PRACTICE: { text: string; isWord: boolean }[] = [
  { text: "cadira", isWord: true },
  { text: "brivol", isWord: false },
  { text: "atzavara", isWord: true },
];

const SWIPE_THRESHOLD_PX = 48;
/** Fracció de barra per sota de la qual la barra entra en mode urgent. */
const BAR_URGENCY_FRACTION = 0.24;
/** Segons restants que s'anuncien als lectors de pantalla. */
const ANNOUNCE_SECONDS = 3;

function fmtScore(n: number): string {
  return n.toLocaleString("ca-ES");
}

export default function KilianClient({ resume, firstTime }: KilianClientProps) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>(resume ? "loading" : "intro");
  const [gameId, setGameId] = useState<string | null>(resume?.gameId ?? null);
  const [item, setItem] = useState<ItemPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Estat visible de la partida (el que mana arriba sempre del servidor)
  const [score, setScore] = useState(resume?.scoreSoFar ?? 0);
  const [streak, setStreak] = useState(resume?.streakNow ?? 0);
  const [multiplier, setMultiplier] = useState(1);
  const [outcome, setOutcome] = useState<KilianOutcome | null>(null);

  const [practiceIndex, setPracticeIndex] = useState(0);
  const shownAt = useRef(0);
  const responseId = useRef("");
  const submitLock = useRef(false);
  const rafRef = useRef<number>(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barFillRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const barAnnounceRef = useRef<HTMLSpanElement | null>(null);
  const pausedDialogRef = useRef<HTMLDivElement | null>(null);
  const lastAnnouncedSecond = useRef<number>(Number.MAX_SAFE_INTEGER);
  /** Fracció de barra restant: permet aturar-la i reprenre-la (pausa). */
  const barRemain = useRef(1);
  const pauseStartedAt = useRef(0);
  const cache = useRef(new Map<number, ItemPayload>());
  const pending = useRef<{
    body: Record<string, unknown>;
    nextPosition: number;
  } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; active: boolean }>({
    id: 0, x: 0, y: 0, active: false,
  });

  // null = preferència encara no llegida del localStorage: evita que l'etiqueta
  // parpellegi «so on» → «so off» en muntar.
  const [muted, setMuted] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setMuted(localStorage.getItem("kilian-mute") === "1");
    } catch {}
  }, []);
  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem("kilian-mute", next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  // ------------------------------------------------------------------ so
  const audioCtx = useRef<AudioContext | null>(null);
  const beep = useCallback(
    (freq: number, durMs: number, type: OscillatorType = "sine", gain = 0.06) => {
      if (muted) return;
      try {
        audioCtx.current ??= new AudioContext();
        const ctx = audioCtx.current;
        if (ctx.state === "suspended") void ctx.resume();
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(gain, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durMs / 1000);
        osc.connect(g).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + durMs / 1000);
      } catch {}
    },
    [muted]
  );

  function haptic(pattern: number | number[]) {
    try {
      navigator.vibrate?.(pattern);
    } catch {}
  }

  // ------------------------------------------------------------------ temporitzador
  const stopBar = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  /**
   * La barra corre amb rAF des del moment exacte en què l'estímul apareix.
   * `remainFraction` permet reprenre-la després d'una pausa exactament on era.
   * Els segons restants finals s'anuncien a una regió viva apart: la barra
   * visual és aria-hidden i sense això el rellotge seria invisible per a un
   * lector de pantalla.
   */
  const runBar = useCallback(
    (onExpire: () => void, remainFraction = 1) => {
      stopBar();
      lastAnnouncedSecond.current = Number.MAX_SAFE_INTEGER;
      if (barAnnounceRef.current) barAnnounceRef.current.textContent = "";
      const fraction = Math.max(0, Math.min(1, remainFraction));
      const duration = KILIAN_BAR_MS * fraction;
      const start = performance.now();
      if (duration <= 0) {
        onExpire();
        return;
      }
      const tick = () => {
        const elapsed = performance.now() - start;
        const remain = Math.max(0, fraction * (1 - elapsed / duration));
        barRemain.current = remain;
        if (barFillRef.current) {
          barFillRef.current.style.transform = `scaleX(${remain})`;
          barFillRef.current.classList.toggle("urgent", remain < BAR_URGENCY_FRACTION);
        }
        // Anunci del compte enrere final (només canvis de segon sencers).
        const secondsLeft = Math.ceil((remain * KILIAN_BAR_MS) / 1000);
        if (secondsLeft <= ANNOUNCE_SECONDS && secondsLeft < lastAnnouncedSecond.current) {
          lastAnnouncedSecond.current = secondsLeft;
          if (barAnnounceRef.current) {
            barAnnounceRef.current.textContent =
              secondsLeft <= 0 ? "temps esgotat" : `${secondsLeft}`;
          }
        }
        if (remain <= 0) {
          rafRef.current = 0;
          onExpire();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [stopBar]
  );

  // ------------------------------------------------------------------ càrrega d'ítems
  const fetchItem = useCallback(async (gid: string, position: number): Promise<ItemPayload> => {
    const cached = cache.current.get(position);
    if (cached) return cached;
    const res = await fetch(`/api/game/item?gameId=${gid}&position=${position}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(await responseErrorMessage(res));
    }
    const data: ItemPayload = await res.json();
    cache.current.set(position, data);
    return data;
  }, []);

  const prefetchNext = useCallback(
    (gid: string, position: number) => {
      void fetchItem(gid, position).catch(() => {});
    },
    [fetchItem]
  );

  const presentItem = useCallback(
    (next: ItemPayload) => {
      setItem(next);
      setOutcome(null);
      shownAt.current = performance.now();
      submitLock.current = false;
      responseId.current = crypto.randomUUID();
      // Neteja la decantació del gest registrat (swipe) de l'ítem anterior.
      const stage = stageRef.current;
      if (stage) {
        stage.style.setProperty("--drag-x", "0px");
        stage.classList.remove("commit-yes", "commit-no");
      }
      if (barFillRef.current) {
        barFillRef.current.style.transform = "scaleX(1)";
        barFillRef.current.classList.remove("urgent");
      }
      barRemain.current = 1;
      setPhase("playing");
      // L'expiració envia un timeout (choice null): mateix camí que un gest.
      runBar(() => respondRef.current(null));
    },
    [runBar]
  );

  const advanceTo = useCallback(
    async (position: number) => {
      if (!gameId) return;
      try {
        const next = await fetchItem(gameId, position);
        presentItem(next);
        prefetchNext(gameId, position + 1);
      } catch (e) {
        setError((e as Error).message);
        setPhase("retry");
      }
    },
    [gameId, fetchItem, presentItem, prefetchNext]
  );

  // ------------------------------------------------------------------ enviament

  /** Què torna el servidor en registrar una resposta (el camp outcome només
   *  ve al mode Kilian). */
  interface ResponseData {
    duplicate?: boolean;
    finished?: boolean;
    outcome?: KilianOutcome;
  }

  /**
   * ÚNICA via de tractament d'una resposta registrada, per a l'enviament
   * normal i per al reintento: duplicate → sincronitza i avança; finished →
   * a resultats; altrament feedback + prefetch + avanç. Abans hi havia dues
   * còpies que ja havien divergit (la del reintento perdria el prefetch).
   */
  function handleResponseData(data: ResponseData, nextPosition: number) {
    if (!gameId) return;
    pending.current = null;
    if (data.duplicate) {
      // La resposta ja era registrada (el primer enviament va commitar però
      // la resposta es va perdre): sincronitza amb el servidor i avança.
      void recoverDuplicate();
      return;
    }
    if (data.finished) {
      router.push(`/resultats/${gameId}`);
      return;
    }
    const oc: KilianOutcome | undefined = data.outcome;
    if (!oc) throw new Error("Resposta sense resultat");
    applyOutcome(oc);
    // El prefetch aprofita la finestra de feedback.
    prefetchNext(gameId, nextPosition);
    advanceTimer.current = setTimeout(() => {
      void advanceTo(nextPosition);
    }, oc.isCorrect ? KILIAN_FEEDBACK_HIT_MS : KILIAN_FEEDBACK_MISS_MS);
  }
  // Referència sempre fresca: send està memoitzat, però cap camí d'invocació
  // (respondRef, retry) no ha de veure una versió vella del tractament.
  const responseDataRef = useRef<(data: ResponseData, nextPosition: number) => void>(() => {});
  responseDataRef.current = handleResponseData;

  const send = useCallback(
    async (choice: "yes" | "no" | null, method: "swipe" | "button" | "key" | null) => {
      if (!gameId || !item || submitLock.current) return;
      submitLock.current = true;
      stopBar();
      setOutcome(null);
      setPhase("feedback");

      const elapsed = Math.round(performance.now() - shownAt.current);
      const kind = choice === null ? "timeout" : "answer";
      const body = {
        responseId: responseId.current,
        gameId,
        position: item.position,
        confidence: choice === "yes" ? KILIAN_YES_CONFIDENCE : choice === "no" ? KILIAN_NO_CONFIDENCE : 0.5,
        timeToFirstInputMs: null,
        responseTimeMs: choice === null ? null : elapsed,
        nAdjustments: null,
        kind,
        choice: choice ?? undefined,
        elapsedMs: elapsed,
        inputMethod: method,
      };
      pending.current = { body, nextPosition: item.position + 1 };

      try {
        const data = await postJson<ResponseData>("/api/game/response", body);
        responseDataRef.current(data, item.position + 1);
      } catch (e) {
        setError((e as Error).message);
        setPhase("retry");
      }
    },
    [gameId, item, stopBar]
  );

  /**
   * Un duplicate significa que el servidor ja té aquesta resposta: consulta
   * l'estat, sincronitza marcador i ratxa, i avança — o tanca la partida si
   * ja no n'hi ha cap d'oberta. Mai un carreró sense sortida al retry.
   */
  async function recoverDuplicate() {
    try {
      const res = await fetch("/api/game/state", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const og = data?.openGame;
      if (!og || og.gameId !== gameId) {
        router.push(`/resultats/${gameId}`);
        return;
      }
      setScore(og.scoreSoFar ?? 0);
      setStreak(og.streakNow ?? 0);
      await advanceTo(og.nextPosition);
    } catch {
      router.push(`/resultats/${gameId}`);
    }
  }

  function applyOutcome(oc: KilianOutcome) {
    setScore(oc.scoreSoFar);
    setStreak(oc.streakAfter);
    setMultiplier(oc.streakAfter > 0 ? oc.multiplier : 1);
    setOutcome(oc);
    if (oc.isCorrect) {
      beep(Math.min(420 + oc.streakAfter * 14, 900), 110, "triangle");
      haptic(12);
    } else if (oc.kind === "timeout") {
      beep(96, 320, "sawtooth", 0.05);
      haptic([60, 40, 60]);
    } else {
      beep(140, 220, "square", 0.05);
      haptic([30, 40, 30]);
    }
  }

  // Referència estable perquè el temporitzador sempre cridi la darrera versió.
  // L'expiració de la barra crida amb choice null: és un timeout, no un gest.
  const respondRef = useRef<(c: "yes" | "no" | null, m?: "swipe" | "button" | "key") => void>(
    () => {}
  );
  respondRef.current = (choice, method) => {
    if (submitLock.current || phase !== "playing") return;
    void send(choice, method ?? null);
  };

  // ------------------------------------------------------------------ pausa
  // La pausa tapa l'estímul, però NO regala temps: en reprendre, la barra
  // torna retallada el temps que ha durat la pausa (i si s'ha esgotat, és un
  // timeout). L'elapsed de l'ítem inclou la pausa — coherent amb served_at,
  // que el servidor fa servir per acotar els temps declarats. Tapar l'estímul
  // no tapa la memòria: pensar-ho durant la pausa costa els punts de l'ítem.
  function pauseGame() {
    if (phase !== "playing") return;
    stopBar();
    pauseStartedAt.current = performance.now();
    setPhase("paused");
  }

  function resumeGame() {
    if (phase !== "paused" || !gameId || !item) return;
    const pausedMs = performance.now() - pauseStartedAt.current;
    const remain = barRemain.current - pausedMs / KILIAN_BAR_MS;
    setPhase("playing");
    if (remain <= 0) {
      barRemain.current = 0;
      // Esgotada durant la pausa: timeout normal. Es crida send directament:
      // respondRef comprova el phase del render (encara «paused» aquí).
      void send(null, null);
      return;
    }
    runBar(() => respondRef.current(null), remain);
  }

  // ------------------------------------------------------------------ partida nova
  async function startGame() {
    setPhase("loading");
    setError(null);
    try {
      const data = await postJson<{ gameId: string }>("/api/game/start", { mode: "killian" });
      setGameId(data.gameId);
      setScore(0);
      setStreak(0);
      setMultiplier(1);
      cache.current.clear();
      const first = await fetchItem(data.gameId, 1);
      presentItem(first);
      prefetchNext(data.gameId, 2);
    } catch (e) {
      setError((e as Error).message);
      setPhase("retry");
    }
  }

  useEffect(() => {
    if (resume && phase === "loading" && gameId && !item) {
      void advanceTo(resume.nextPosition);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ teclat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== "playing" && phase !== "practice") return;
      const dir = e.key === "ArrowRight" ? "yes" : e.key === "ArrowLeft" ? "no" : null;
      if (!dir) return;
      e.preventDefault(); // les fletxes responen sempre: mai scroll lateral
      if (phase === "practice") practiceRespondRef.current(dir);
      else respondRef.current(dir, "key");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  // ------------------------------------------------------------------ pestanya amagada
  // La barra mesura temps de paret: amb la pestanya en segon pla el rAF
  // s'atura però el rellotge no. Pausa automàtica en amagar-se, amb la MATEIXA
  // regla que la pausa manual: el temps amagat compta — en tornar, o queda
  // barra o és un timeout. Amagar la pestanya no és una pausa infinita.
  useEffect(() => {
    if (phase !== "playing") return;
    const onVisibility = () => {
      if (document.hidden) pauseGame();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ------------------------------------------------------------------ diàleg de pausa
  // Modal de debò: focus atrapat dins el diàleg, Escape continua i el focus
  // torna on era en tancar-lo.
  useEffect(() => {
    if (phase !== "paused") return;
    const dialog = pausedDialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = (): HTMLElement[] =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])")
          )
        : [];
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resumeGame();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ------------------------------------------------------------------ neteja
  useEffect(() => {
    return () => {
      stopBar();
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, [stopBar]);

  // ------------------------------------------------------------------ swipe
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (phase !== "playing" && phase !== "practice") return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, active: true };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current.active || e.pointerId !== drag.current.id) return;
    const dx = e.clientX - drag.current.x;
    stageRef.current?.style.setProperty("--drag-x", `${Math.max(-70, Math.min(70, dx))}px`);
    stageRef.current?.classList.toggle("drag-yes", dx > SWIPE_THRESHOLD_PX * 0.6);
    stageRef.current?.classList.toggle("drag-no", -dx > SWIPE_THRESHOLD_PX * 0.6);
  }
  function endDrag(e: React.PointerEvent<HTMLDivElement>, committed: boolean) {
    if (!drag.current.active || e.pointerId !== drag.current.id) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current.active = false;
    const stage = stageRef.current;
    if (stage) {
      stage.style.setProperty("--drag-x", "0px");
      stage.classList.remove("drag-yes", "drag-no");
    }
    if (!committed) return;
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const dir = dx > 0 ? "yes" : "no";
      if (phase === "practice") {
        practiceRespond(dir);
        return;
      }
      // Si la barra ha expirat mig gest (timeout ja enviat) o hi ha un enviament
      // en curs, el servidor no acceptarà res: cap confirmació enganyosa.
      if (submitLock.current || phase !== "playing") return;
      // Confirmació immediata del gest: la targeta queda decantada cap al
      // costat triat (vora encesa) amb un tic, mentre el servidor puntuà.
      // Sense això, l'espera de xarxa es percep com una resposta perduda.
      const stage = stageRef.current;
      if (stage) {
        stage.style.setProperty("--drag-x", dir === "yes" ? "44px" : "-44px");
        stage.classList.add(dir === "yes" ? "commit-yes" : "commit-no");
      }
      beep(dir === "yes" ? 520 : 360, 60, "sine", 0.05);
      haptic(10);
      respondRef.current(dir, "swipe");
    }
  }

  // ==================================================================
  // Pantalles
  // ==================================================================

  function beginPractice() {
    setPracticeIndex(0);
    setPhase("practice");
  }

  function practiceRespond(choice: "yes" | "no") {
    const ex = PRACTICE[practiceIndex];
    if (choice === (ex.isWord ? "yes" : "no")) {
      beep(560, 110, "triangle");
      haptic(12);
      if (practiceIndex + 1 >= PRACTICE.length) {
        void startGame();
      } else {
        setPracticeIndex((index) => index + 1);
      }
    } else {
      beep(140, 220, "square", 0.05);
      haptic([30, 40, 30]);
    }
  }
  const practiceRespondRef = useRef<(c: "yes" | "no") => void>(() => {});
  practiceRespondRef.current = practiceRespond;

  if (phase === "intro") {
    return (
      <main className="game-intro kil-intro">
        <p className="eyebrow">Mode Kilian</p>
        <h1>Cinc segons. Sí o no.</h1>
        <p className="lead">
          Cada estímul té una barra de temps: els punts baixen amb ella.
          Arrossegada a la dreta per dir que sí, a l&apos;esquerra per dir que no.
        </p>
        <ul className="rules">
          <li>
            <b>100</b> punts per estímul, que s&apos;esvaeixen en 5 segons
          </li>
          <li>
            <b>×1,2</b> a partir de 5 encerts seguits, fins a ×2 i més enllà
          </li>
          <li>
            <b>0</b> pietat: un error o arribar tard trencarà la ratxa
          </li>
        </ul>
        <div className="actions">
          <button className="btn" onClick={() => (firstTime ? beginPractice() : void startGame())}>
            {firstTime ? "Aprèn el gest" : "Comença"}
          </button>
          {!firstTime ? (
            <button className="btn ghost" onClick={beginPractice}>
              Repassa el gest
            </button>
          ) : null}
        </div>
        {error ? <p className="small muted">{error}</p> : null}
      </main>
    );
  }

  if (phase === "retry") {
    return (
      <RetryScreen
        error={error}
        resumeNote="Tot queda desat al servidor: es reprèn exactament on era."
        onRetry={() => {
          setError(null);
          const p = pending.current;
          if (p) {
            // Reenviament segur: mateix response_id, servidor idempotent.
            setPhase("feedback");
            postJson<ResponseData>("/api/game/response", p.body)
              .then((data) => {
                responseDataRef.current(data, p.nextPosition);
              })
              .catch((err) => {
                setError((err as Error).message);
                setPhase("retry");
              });
          } else if (gameId && item) {
            void advanceTo(item.position);
          } else {
            void startGame();
          }
        }}
      />
    );
  }

  if (!item && phase !== "practice") {
    return <LoadingScreen />;
  }

  const practicing = phase === "practice";
  const current: ItemPayload | null = practicing
    ? { position: practiceIndex + 1, stimulus: PRACTICE[practiceIndex].text, totalItems: 3 }
    : item;
  if (!current) return null;
  const pos = String(current.position).padStart(2, "0");
  const total = String(current.totalItems).padStart(3, "0");

  return (
    <main className={`game kil-game${practicing ? " kil-practice" : ""}`}>
      <div className="game-head">
        <div className="counter">
          <span className="counter-pos">
            {pos} <em>/ {total}</em>
          </span>
          <span className="kil-score" aria-live="off">
            {fmtScore(score)}
          </span>
          <span className="kil-streak" data-hot={streak >= 5}>
            <span className="kil-flame" aria-hidden="true" />
            {streak}
            {multiplier > 1 ? <em className="kil-mult">×{multiplier.toLocaleString("ca-ES")}</em> : null}
          </span>
          <button
            type="button"
            className="kil-mute kil-pause"
            onClick={pauseGame}
            disabled={phase !== "playing"}
            aria-label="Pausa la partida"
          >
            pausa
          </button>
          <button
            type="button"
            className="kil-mute"
            onClick={toggleMute}
            aria-label={muted ? "Activa el so" : "Silencia"}
          >
            {muted === null ? "so" : muted ? "so off" : "so on"}
          </button>
        </div>

        <ProgressTicks position={current.position} totalItems={current.totalItems} />
      </div>

      {/* Escenari: l'estímul, la seva barra i el feedback gran i centrat
          just sota les paraules (decisió Roger 25/08/2026). */}
      <div
        ref={stageRef}
        className="kil-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, true)}
        onPointerCancel={(e) => endDrag(e, false)}
      >
        <span className="kil-hint kil-hint-no" aria-hidden="true">
          ← no
        </span>
        <div className="stimulus-wrap kil-stage-card">
          <div className="stimulus">
            <Stimulus text={current.stimulus} />
          </div>
        </div>
        <span className="kil-hint kil-hint-yes" aria-hidden="true">
          sí →
        </span>
        <div className="kil-timer" aria-hidden="true">
          <div ref={barFillRef} className="kil-bar-fill" />
        </div>
        {/* Compte enrere per a lectors de pantalla: la barra visual és
            decorativa (aria-hidden); aquesta regió viva és l'única font de
            temps. Només parla els últims segons, sense martellejar. */}
        <span ref={barAnnounceRef} role="status" aria-live="polite" className="visually-hidden" />
        {/* Feedback gran, al mig de l'escenari: es llegueix d'un cop d'ull
            sense baixar la vista cap als botons. */}
        <div
          className={`kil-feedback${outcome ? ` show ${outcome.isCorrect ? "ok" : outcome.kind === "timeout" ? "late" : "ko"}` : ""}`}
          aria-live="polite"
        >
          {outcome ? (
            outcome.isCorrect ? (
              <>
                <b>+{fmtScore(outcome.points)}</b>
                {outcome.multiplier > 1 ? <i>×{outcome.multiplier.toLocaleString("ca-ES")}</i> : null}
                {outcome.streakAfter % 5 === 0 && outcome.streakAfter > 0 ? (
                  <u>ratxa de {outcome.streakAfter}!</u>
                ) : null}
              </>
            ) : outcome.kind === "timeout" ? (
              <b>massa tard</b>
            ) : (
              <b>{outcome.itemWasWord ? "era una paraula!" : "no existeix!"}</b>
            )
          ) : null}
        </div>
        {practicing ? (
          <p className="kil-practice-tip">
            Exemple {current.position} de 3 ·{" "}
            {PRACTICE[current.position - 1].isWord
              ? "existeix: llisca a la dreta"
              : "inventada: llisca a l'esquerra"}
          </p>
        ) : null}
      </div>

      <div className="dock kil-dock">
        <div className="kil-buttons">
          <button
            className="kil-btn no"
            disabled={!practicing && phase !== "playing"}
            onClick={() => (practicing ? practiceRespond("no") : respondRef.current("no", "button"))}
          >
            <span aria-hidden="true">✗</span> no
          </button>
          <button
            className="kil-btn yes"
            disabled={!practicing && phase !== "playing"}
            onClick={() => (practicing ? practiceRespond("yes") : respondRef.current("yes", "button"))}
          >
            sí <span aria-hidden="true">✓</span>
          </button>
        </div>
        {practicing ? (
          <p className="small muted center-text">
            Els exemples no puntuen ni compten: quan acabin, comença la partida de debò.
          </p>
        ) : null}
      </div>

      {/* Pausa: cobreix tota la pantalla (l'estímul queda tapat) però el
          temps corre: la barra torna retallada el que ha durat la pausa. */}
      {phase === "paused" ? (
        <div
          ref={pausedDialogRef}
          className="kil-paused"
          role="dialog"
          aria-modal="true"
          aria-label="Partida en pausa"
        >
          <p className="eyebrow">Pausa</p>
          <h2>La partida espera.</h2>
          <p className="muted small">
            Estímul tapat. El rellotge no perdona: en continuar, la barra torna
            retallada el temps que ha durat la pausa.
          </p>
          <button className="btn" onClick={resumeGame}>
            Continua
          </button>
        </div>
      ) : null}
    </main>
  );
}
