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
    // El mode el decideix la partida al servidor; Pompeu exigeix confiança i
    // Kilian un judici binari amb temps.
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
        // Camps del mode Kilian (el servidor ignora els que no toquen al seu mode)
        kind: body.kind === "timeout" ? "timeout" : body.kind === "answer" ? "answer" : undefined,
        choice: body.choice === "yes" ? "yes" : body.choice === "no" ? "no" : undefined,
        elapsedMs: body.elapsedMs == null ? null : Number(body.elapsedMs),
        inputMethod:
          body.inputMethod === "swipe" || body.inputMethod === "button" || body.inputMethod === "key"
            ? body.inputMethod
            : null,
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

