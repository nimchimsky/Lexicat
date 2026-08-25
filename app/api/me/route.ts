import { NextResponse } from "next/server";
import { requirePlayer, setNickname, currentPlayer, deleteAccount } from "@/lib/server/auth";
import { getPlayerSummary } from "@/lib/server/views";
import { apiErrorResponse, invalidBody } from "@/lib/server/apiError";

export const runtime = "nodejs";

// El 401 de sessió ve d'un HttpError llançat per requirePlayer/currentPlayer
// i surt pel mateix mapa central: una caiguda de DB no es presenta mai com a
// «sessió requerida».

export async function GET() {
  try {
    const player = await currentPlayer();
    if (!player) return NextResponse.json({ player: null }, { status: 200 });
    const summary = await getPlayerSummary(player.id);
    return NextResponse.json({
      player: { email: player.email, nickname: player.nickname },
      ...summary,
    });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const player = await requirePlayer();
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return invalidBody("Cos invàlid");
    }
    const nickname = (body as { nickname?: unknown }).nickname;
    if (typeof nickname !== "string") return invalidBody("Cal un sobrenom");
    await setNickname(player.id, nickname);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function DELETE() {
  try {
    const player = await requirePlayer();
    await deleteAccount(player.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
