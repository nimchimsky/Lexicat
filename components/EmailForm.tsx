"use client";

import { useState } from "react";

export default function EmailForm() {
  const [email, setEmail] = useState("");
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [sentNoDev, setSentNoDev] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      if (data.devUrl) setDevUrl(data.devUrl);
      else setSentNoDev(true);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (devUrl) {
    return (
      <div className="card">
        <p>
          <b>Mode desenvolupament</b> (sense SMTP configurat): l&apos;enllaç
          màgic és directe:
        </p>
        <a href={devUrl}>Entrar amb l&apos;enllaç</a>
        <p className="small muted">
          També queda registrat a la consola del servidor. En producció, amb
          SMTP configurat, només s&apos;envia per correu.
        </p>
      </div>
    );
  }
  if (sentNoDev) {
    return (
      <div className="card">
        <p>Revisa el teu correu: t&apos;hi hem enviat l&apos;enllaç per entrar.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <input
        type="email"
        required
        inputMode="email"
        autoComplete="email"
        placeholder="el-teu@correu.cat"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {err && <p style={{ color: "var(--bad)" }}>{err}</p>}
      <button className="btn" disabled={busy} type="submit">
        {busy ? "Enviant…" : "Envia'm l'enllaç"}
      </button>
    </form>
  );
}

