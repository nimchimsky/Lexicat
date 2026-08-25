"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { responseErrorMessage } from "@/lib/client/api";

export default function AccountActions() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doLogout() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error(await responseErrorMessage(res));
      router.push("/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me", { method: "DELETE" });
      if (!res.ok) throw new Error(await responseErrorMessage(res));
      router.push("/");
      router.refresh();
    } catch (e) {
      // Sense això, una caiguda de xarxa deixaria els dos botons morts per
      // sempre: el compte NO s'ha esborrat i la persona ho ha de saber.
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn secondary" disabled={busy} onClick={() => void doLogout()}>
        Tanca la sessió
      </button>

      {confirming ? (
        <div className="notice">
          <p>
            <b>Esborraràs el teu compte.</b> El correu, el sobrenom i el perfil
            opcional desapareixen del tot. Les respostes ja entrada al calibratge científic es
            conserven, però completament deslligades de tu. No es pot desfer.
          </p>
          <button className="btn danger" disabled={busy} onClick={() => void doDelete()}>
            Sí, esborra-ho tot
          </button>
          <button className="btn secondary" onClick={() => setConfirming(false)}>
            Deixa&apos;t estar
          </button>
        </div>
      ) : (
        <button className="btn danger" disabled={busy} onClick={() => setConfirming(true)}>
          Esborra el meu compte
        </button>
      )}

      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
