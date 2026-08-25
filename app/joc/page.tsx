import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentPlayer } from "@/lib/server/auth";
import { getOpenGame } from "@/lib/server/game";
import GameClient from "@/components/GameClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mode Pompeu",
  robots: { index: false, follow: false },
};

export default async function Joc() {
  const player = await currentPlayer();
  if (!player) redirect("/entrar");
  const open = await getOpenGame(player.id);
  return <GameClient openGame={open ? {
    gameId: open.gameId,
    nextPosition: open.nextPosition,
    responseFormat: open.responseFormat,
    sliderSteps: open.sliderSteps,
  } : null} />;
}
