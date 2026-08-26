import { NextResponse } from "next/server";
import { currentPlayer } from "@/lib/server/auth";
import { getOpenGame } from "@/lib/server/game";
import { apiErrorResponse } from "@/lib/server/apiError";
import { rateLimit, clientIp } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!await rateLimit(`state:${clientIp(req)}`, 600, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Massa peticions" }, { status: 429 });
  }
  try {
    const player = await currentPlayer();
    if (!player) return NextResponse.json({ error: "Sessió requerida" }, { status: 401 });
    // La poda de partides abandonades és feina del sweep programat
    // (/api/cron/sweep), no del camí calent de lectura.
    const state = await getOpenGame(player.id);
    return NextResponse.json({ openGame: state });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
