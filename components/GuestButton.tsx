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

  async function start() {
    setBusy(true);
    try {
      const res = await fetch("/api/game/guest", { method: "POST" });
      if (!res.ok && res.status !== 429) throw new Error("Error");
    } catch {
      // Si falla la creació, la destinació redirigirà a entrar: cap carreró sense sortida.
    }
    router.push(href);
    router.refresh();
  }

  return (
    <button className={`btn${primary ? "" : " secondary"}`} disabled={busy} onClick={() => void start()}>
      {busy ? "Preparant…" : label}
    </button>
  );
}

