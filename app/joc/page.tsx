import { redirect } from "next/navigation";
import Link from "next/link";
import { currentPlayer } from "@/lib/server/auth";
import { getOpenGame, sweepAbandonedGames } from "@/lib/server/game";
import { BUTTON_LABELS } from "@/lib/config";
import GameClient from "@/components/GameClient";

export const dynamic = "force-dynamic";

export default async function Joc() {
  const player = await currentPlayer();
  if (!player) redirect("/entrar");
  await sweepAbandonedGames(player.id);
  const open = await getOpenGame(player.id);
  return (
    <GameClient
      openGame={
        open
          ? {
              gameId: open.gameId,
              nextPosition: open.nextPosition,
              responseFormat: open.responseFormat,
              sliderSteps: open.sliderSteps,
            }
          : null
      }
      buttonLabels={BUTTON_LABELS}
    />
  );
}

