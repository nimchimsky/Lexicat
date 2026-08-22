import { NextResponse } from "next/server";
import { requirePlayer } from "@/lib/server/auth";
import { explicitAbandon } from "@/lib/server/game";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let player;
  try {
    player = await requirePlayer();
  } catch {
    return NextResponse.json({ error: "Sessió requerida" }, { status: 401 });
  }
  try {
    const { gameId } = await req.json();
    await explicitAbandon(player.id, String(gameId));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Cos invàlid" }, { status: 400 });
  }
}
