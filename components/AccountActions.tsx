"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AccountActions() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doLogout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  async function doDelete() {
    setBusy(true);
    await fetch("/api/me", { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <button className="btn secondary" disabled={busy} onClick={() => void doLogout()}>
        Tanca la sessió
      </button>

      {confirming ? (
        <div className="notice">
          <p>
            <b>Esborraràs el teu compte.</b> El correu i el sobrenom desapareixen
            del tot. Les respostes ja entrada al calibratge científic es
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
    </>
  );
}
