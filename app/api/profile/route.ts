import { NextResponse } from "next/server";
import { requirePlayer } from "@/lib/server/auth";
import { getPlayerProfile, updatePlayerProfile } from "@/lib/server/profile";
import { apiErrorResponse, invalidBody } from "@/lib/server/apiError";

export const runtime = "nodejs";

export async function GET() {
  try {
    const player = await requirePlayer();
    return NextResponse.json({ profile: await getPlayerProfile(player.id) });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function PUT(req: Request) {
  try {
    const player = await requirePlayer();
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return invalidBody("Cos invàlid");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return invalidBody("Perfil invàlid");
    }
    const profile = await updatePlayerProfile(player.id, body as Record<string, unknown>);
    return NextResponse.json({ ok: true, profile });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
