import { NextResponse } from "next/server";
import { currentPlayer } from "@/lib/server/auth";
import { getRankings, getKilianRankings } from "@/lib/server/views";
import { apiErrorResponse } from "@/lib/server/apiError";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  try {
    // Amb sessió, les taules porten la fila «la teva posició» (isMe), igual
    // que la pàgina /ranquings. Sense sessió, els taulers públics.
    const player = await currentPlayer();
    if (mode === "kilian") {
      return NextResponse.json({ kilian: await getKilianRankings(player?.id ?? null) });
    }
    return NextResponse.json(await getRankings(player?.id ?? null));
  } catch (e) {
    return apiErrorResponse(e);
  }
}
