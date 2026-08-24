import { NextResponse } from "next/server";
import { requirePlayer } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/http";
import { serveItem } from "@/lib/server/game";

export const runtime = "nodejs";

// La resposta MAI conté is_word ni item_id (§9): només l'estímul en minúscules.
export async function GET(req: Request) {
  let player;
  try {
    player = await requirePlayer();
  } catch {
    return NextResponse.json({ error: "Sessió requerida" }, { status: 401 });
  }
  const url = new URL(req.url);
  const gameId = url.searchParams.get("gameId");
  const position = Number(url.searchParams.get("position"));
  if (!gameId || !Number.isInteger(position) || position < 1 || position > 100) {
    return NextResponse.json({ error: "Paràmetres invàlids" }, { status: 400 });
  }
  try {
    const item = await serveItem(player.id, gameId, position);
    return NextResponse.json(item, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

