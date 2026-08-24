import { NextResponse } from "next/server";
import { requirePlayer } from "@/lib/server/auth";
import { startGame } from "@/lib/server/game";
import { deviceClassFromUserAgent } from "@/lib/server/device";
import type { GameMode } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let player;
  try {
    player = await requirePlayer();
  } catch {
    return NextResponse.json({ error: "Sessió requerida" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const mode: GameMode = body?.mode === "killian" ? "killian" : "pompeu";
    const game = await startGame(
      player.id,
      deviceClassFromUserAgent(req.headers.get("user-agent")),
      mode
    );
    return NextResponse.json(game);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "No s'ha pogut crear la partida" }, { status: 500 });
  }
}

