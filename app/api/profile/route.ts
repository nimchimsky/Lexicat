import { NextResponse } from "next/server";
import { requirePlayer } from "@/lib/server/auth";
import { getPlayerProfile, updatePlayerProfile } from "@/lib/server/profile";

export const runtime = "nodejs";

export async function GET() {
  try {
    const player = await requirePlayer();
    return NextResponse.json({ profile: await getPlayerProfile(player.id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
}

export async function PUT(req: Request) {
  try {
    const player = await requirePlayer();
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Perfil invàlid" }, { status: 400 });
    }
    const profile = await updatePlayerProfile(player.id, body as Record<string, unknown>);
    return NextResponse.json({ ok: true, profile });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
