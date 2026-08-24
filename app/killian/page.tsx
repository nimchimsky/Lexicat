import { redirect } from "next/navigation";
import { currentPlayer } from "@/lib/server/auth";
import { getOpenGame, sweepAbandonedGames } from "@/lib/server/game";
import { query } from "@/lib/server/db";
import KilianClient, { type KilianResume } from "@/components/KilianClient";

export const dynamic = "force-dynamic";

export default async function Killian() {
  const player = await currentPlayer();
  if (!player) redirect("/entrar");
  await sweepAbandonedGames(player.id);

  const open = await getOpenGame(player.id);

  const played = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM games
     WHERE player_id = $1 AND mode = 'killian' AND status = 'completed'`,
    [player.id]
  );

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
      firstTime={Number(played.rows[0].n) === 0}
    />
  );
}

