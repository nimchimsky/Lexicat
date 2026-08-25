"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { responseErrorMessage } from "@/lib/client/api";

export default function NicknameForm({
  initialNickname = "",
  redirectTo = "/",
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
      if (!res.ok) throw new Error(await responseErrorMessage(res));
      router.push(redirectTo);
      router.refresh();
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="nickname-input">
        {labelText} <span className="muted small">({nickname.length}/24)</span>
      </label>
      <input
        id="nickname-input"
        type="text"
        required
        minLength={3}
        maxLength={24}
        autoComplete="nickname"
        placeholder="p. ex. pompeu"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        aria-invalid={err ? true : undefined}
        aria-describedby={err ? "nickname-error" : undefined}
      />
      {err && (
        <p className="field-error" role="alert" id="nickname-error">
          {err}
        </p>
      )}
      <button className="btn" disabled={busy} type="submit">
        {busy ? "Guardant…" : submitLabel}
      </button>
    </form>
  );
}
