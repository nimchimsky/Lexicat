import { NextResponse } from "next/server";
import { requirePlayer, setNickname, currentPlayer, deleteAccount } from "@/lib/server/auth";
import { getPlayerSummary } from "@/lib/server/views";

export const runtime = "nodejs";

export async function GET() {
  const player = await currentPlayer();
  if (!player) return NextResponse.json({ player: null }, { status: 200 });
  const summary = await getPlayerSummary(player.id);
  return NextResponse.json({
    player: { email: player.email, nickname: player.nickname },
    ...summary,
  });
}

export async function POST(req: Request) {
  let player;
  try {
    player = await requirePlayer();
  } catch {
    return NextResponse.json({ error: "Sessió requerida" }, { status: 401 });
  }
  try {
    const { nickname } = await req.json();
    await setNickname(player.id, String(nickname ?? ""));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE() {
  let player;
  try {
    player = await requirePlayer();
  } catch {
    return NextResponse.json({ error: "Sessió requerida" }, { status: 401 });
  }
  await deleteAccount(player.id);
  return NextResponse.json({ ok: true });
}

