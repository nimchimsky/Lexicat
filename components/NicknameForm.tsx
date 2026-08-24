"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NicknameForm({
  initialNickname = "",
  redirectTo = "/joc",
  labelText = "Sobrenom públic",
  submitLabel = "Comença a jugar",
}: {
  initialNickname?: string;
  redirectTo?: string;
  labelText?: string;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState(initialNickname);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      router.push(redirectTo);
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="nickname-input">{labelText}</label>
      <input
        id="nickname-input"
        type="text"
        required
        minLength={3}
        maxLength={24}
        autoComplete="off"
        placeholder="p. ex. pompeu"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
      />
      {err && <p style={{ color: "var(--bad)" }}>{err}</p>}
      <button className="btn" disabled={busy} type="submit">
        {busy ? "Guardant…" : submitLabel}
      </button>
    </form>
  );
}
