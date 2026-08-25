"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Pàgina intermèdia de l'enllaç màgic. El token NO es consumeix en obrir-la:
 * només quan la persona toca el botó (POST). Així un preview del correu o
 * un escàner d'antivirus no cremen el token d'un sol ús abans que arribi
 * la persona a qui li pertany.
 */
export default function VerifyForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fired = useRef(false);

  async function verify() {
    if (!token || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Sense redirect (error d'infraestructura): ens quedem aquí amb l'avís.
        throw new Error(data.error ?? "L'enllaç no és vàlid o ha caducat.");
      }
      if (data.redirect) {
        router.push(data.redirect);
        router.refresh();
      } else {
        setErr("No s'ha pogut verificar l'enllaç ara mateix. Torna-ho a provar en una estona.");
        setBusy(false);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  // Sense token no hi ha res a fer: cap error per GET, simplement torna.
  useEffect(() => {
    if (!token && !fired.current) {
      fired.current = true;
      router.replace("/entrar?error=caducat");
    }
  }, [token, router]);

  if (!token) return null;

  return (
    <main>
      <p className="eyebrow">Compte</p>
      <h1>Entra</h1>
      <p className="lead">
        Toca el botó per confirmar que ets tu i entrar amb aquest correu.
        L&apos;enllaç caduca als 15 minuts i només serveix un cop.
      </p>
      <button className="btn" disabled={busy} onClick={() => void verify()}>
        {busy ? "Entrant…" : "Entra al Lexicat"}
      </button>
      {err ? (
        <div className="notice" role="alert">
          {err} Demana&apos;n un de nou des de{" "}
          <a href="/entrar">la pantalla d&apos;entrada</a>.
        </div>
      ) : null}
    </main>
  );
}
