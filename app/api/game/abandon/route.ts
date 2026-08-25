import { NextResponse } from "next/server";
import { requirePlayer } from "@/lib/server/auth";
import { explicitAbandon, isUuid } from "@/lib/server/game";
import { apiErrorResponse, invalidBody } from "@/lib/server/apiError";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const player = await requirePlayer();
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return invalidBody();
    }
    const gameId = (body as { gameId?: unknown }).gameId;
    if (typeof gameId !== "string" || !isUuid(gameId)) {
      return invalidBody("gameId invàlid");
    }
    await explicitAbandon(player.id, gameId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
