import { NextResponse } from "next/server";
import { requirePlayer } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/http";
import { submitResponse } from "@/lib/server/game";
import { deviceClassFromUserAgent } from "@/lib/server/device";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let player;
  try {
    player = await requirePlayer();
  } catch {
    return NextResponse.json({ error: "Sessió requerida" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const result = await submitResponse(
      player.id,
      {
        responseId: String(body.responseId ?? ""),
        gameId: String(body.gameId ?? ""),
        position: Number(body.position),
        confidence: Number(body.confidence),
        timeToFirstInputMs: body.timeToFirstInputMs == null ? null : Math.round(Number(body.timeToFirstInputMs)),
        responseTimeMs: body.responseTimeMs == null ? null : Math.round(Number(body.responseTimeMs)),
        nAdjustments: body.nAdjustments == null ? null : Math.round(Number(body.nAdjustments)),
      },
      deviceClassFromUserAgent(req.headers.get("user-agent"))
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof SyntaxError) return NextResponse.json({ error: "JSON invàlid" }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Error intern" }, { status: 500 });
  }
}
