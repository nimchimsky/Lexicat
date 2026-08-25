import { NextResponse } from "next/server";
import { requirePlayer } from "@/lib/server/auth";
import { serveItem } from "@/lib/server/game";
import { apiErrorResponse } from "@/lib/server/apiError";
import { GAME_LENGTH } from "@/lib/config";

export const runtime = "nodejs";

// La resposta MAI conté is_word ni item_id (§9): només l'estímul en minúscules.
export async function GET(req: Request) {
  try {
    const player = await requirePlayer();
    const url = new URL(req.url);
    const gameId = url.searchParams.get("gameId");
    const position = Number(url.searchParams.get("position"));
    if (!gameId || !Number.isInteger(position) || position < 1 || position > GAME_LENGTH) {
      return NextResponse.json({ error: "Paràmetres invàlids" }, { status: 400 });
    }
    const item = await serveItem(player.id, gameId, position);
    return NextResponse.json(item, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
