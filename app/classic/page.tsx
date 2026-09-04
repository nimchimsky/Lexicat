import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentPlayer } from "@/lib/server/auth";
import { getOpenGame } from "@/lib/server/game";
import ClassicClient, { type ClassicResume } from "@/components/ClassicClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mode Clàssic",
  robots: { index: false, follow: false },
};

export default async function Classic() {
  const player = await currentPlayer();
  if (!player) redirect("/entrar");

  const open = await getOpenGame(player.id);
  const resume: ClassicResume | null =
    open?.mode === "classic"
      ? { gameId: open.gameId, nextPosition: open.nextPosition }
      : null;

  return <ClassicClient resume={resume} />;
}
