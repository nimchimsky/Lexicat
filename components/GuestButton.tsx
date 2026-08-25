"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GuestButton({
  label = "Juga com a convidat",
  primary = false,
  href = "/joc",
}: {
  label?: string;
  primary?: boolean;
  href?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/game/guest", { method: "POST" });
      if (!res.ok) {
        // El 429 també és un error: el missatge del servidor («Massa convidats
        // des d'aquesta IP») s'ha de mostrar, mai navegar sense sessió.
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "No s'ha pogut crear la sessió de convidat");
      }
      router.push(href);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <button className={`btn${primary ? "" : " secondary"}`} disabled={busy} onClick={() => void start()}>
        {busy ? "Preparant…" : label}
      </button>
      {error ? (
        <p className="field-error" role="alert">
          {error} Pots tornar-ho provar o entrar amb correu.
        </p>
      ) : null}
    </>
  );
}
