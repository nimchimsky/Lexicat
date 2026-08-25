import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentPlayer } from "@/lib/server/auth";
import { getOpenGame } from "@/lib/server/game";
import { hasCompletedGames } from "@/lib/server/views";
import KilianClient, { type KilianResume } from "@/components/KilianClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mode Kilian",
  robots: { index: false, follow: false },
};

export default async function Killian() {
  const player = await currentPlayer();
  if (!player) redirect("/entrar");

  const open = await getOpenGame(player.id);

  // Primera vegada al mode: decideix si cal el miniaprenentatge del gest.
  const firstTime = !(await hasCompletedGames(player.id));

  const resume: KilianResume | null =
    open && open.mode === "killian"
      ? {
          gameId: open.gameId,
          nextPosition: open.nextPosition,
          scoreSoFar: open.scoreSoFar ?? 0,
          streakNow: open.streakNow ?? 0,
        }
      : null;

  return (
    <KilianClient
      resume={resume}
      firstTime={firstTime}
    />
  );
}
