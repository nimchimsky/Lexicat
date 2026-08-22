import { NextResponse } from "next/server";
import { currentPlayer } from "@/lib/server/auth";
import { getOpenGame, sweepAbandonedGames } from "@/lib/server/game";

export const runtime = "nodejs";

export async function GET() {
  const player = await currentPlayer();
  if (!player) return NextResponse.json({ error: "Sessió requerida" }, { status: 401 });
  await sweepAbandonedGames(player.id);
  const state = await getOpenGame(player.id);
  return NextResponse.json({ openGame: state });
}
