import { NextResponse } from "next/server";
import { requirePlayer } from "@/lib/server/auth";
import { submitResponse } from "@/lib/server/game";
import { deviceClassFromUserAgent } from "@/lib/server/device";
import { apiErrorResponse, invalidBody } from "@/lib/server/apiError";
import { rateLimit, clientIp } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // 100 respostes per partida i marge de sobra: cap humà no arriba mai.
  if (!await rateLimit(`resp:${clientIp(req)}`, 3000, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Massa peticions" }, { status: 429 });
  }
  try {
    const player = await requirePlayer();
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return invalidBody("JSON invàlid");
    }
    if (!body || typeof body !== "object") return invalidBody();

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
    return apiErrorResponse(e);
  }
}
