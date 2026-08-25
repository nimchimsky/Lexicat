import { NextResponse } from "next/server";
import { requirePlayer } from "@/lib/server/auth";
import { startGame } from "@/lib/server/game";
import { deviceClassFromUserAgent } from "@/lib/server/device";
import { apiErrorResponse } from "@/lib/server/apiError";
import { rateLimit, clientIp } from "@/lib/server/ratelimit";
import type { GameMode } from "@/lib/config";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Crear partida és carregant (selecció sencera en transacció): limitat per
  // IP per damunt del ritme de qualsevol jugador humà.
  if (!rateLimit(`start:${clientIp(req)}`, 60, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Massa partides. Descansa un moment." }, { status: 429 });
  }
  try {
    const player = await requirePlayer();
    const body = await req.json().catch(() => ({}));
    const mode: GameMode = body?.mode === "killian" ? "killian" : "pompeu";
    const game = await startGame(
      player.id,
      deviceClassFromUserAgent(req.headers.get("user-agent")),
      mode
    );
    return NextResponse.json(game);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
