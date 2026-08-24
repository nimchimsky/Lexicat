import { NextResponse } from "next/server";
import { currentPlayer } from "@/lib/server/auth";
import { getMapaView } from "@/lib/server/mapa";

export const runtime = "nodejs";

/** Estat del mapa del jugador: progrés derivat + zones reclamades. */
export async function GET() {
  const player = await currentPlayer();
  if (!player) return NextResponse.json({ error: "Sessió requerida" }, { status: 401 });
  const view = await getMapaView(player.id);
  return NextResponse.json(view);
}
