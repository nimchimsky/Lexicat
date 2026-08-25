import { NextResponse } from "next/server";
import { currentPlayer } from "@/lib/server/auth";
import { getMapaView } from "@/lib/server/mapa";
import { apiErrorResponse } from "@/lib/server/apiError";
import { rateLimit, clientIp } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

/** Estat del mapa del jugador: progrés derivat + zones reclamades. */
export async function GET(req: Request) {
  if (!rateLimit(`mapa:${clientIp(req)}`, 120, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Massa peticions" }, { status: 429 });
  }
  try {
    const player = await currentPlayer();
    if (!player) return NextResponse.json({ error: "Sessió requerida" }, { status: 401 });
    const view = await getMapaView(player.id);
    return NextResponse.json(view);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
