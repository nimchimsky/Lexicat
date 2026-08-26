import { NextResponse } from "next/server";
import { currentPlayer } from "@/lib/server/auth";
import { claimRegion } from "@/lib/server/mapa";
import { apiErrorResponse } from "@/lib/server/apiError";
import { rateLimit, clientIp } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

/** Reclama una zona del mapa gastant una fitxa pendent. */
export async function POST(req: Request) {
  if (!await rateLimit(`claim:${clientIp(req)}`, 60, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Massa peticions" }, { status: 429 });
  }
  try {
    const player = await currentPlayer();
    if (!player) return NextResponse.json({ error: "Sessió requerida" }, { status: 401 });

    let regionId: unknown;
    try {
      ({ regionId } = await req.json());
    } catch {
      return NextResponse.json({ error: "Cos JSON invàlid" }, { status: 400 });
    }
    if (typeof regionId !== "string") {
      return NextResponse.json({ error: "Cal regionId" }, { status: 400 });
    }

    const r = await claimRegion(player.id, regionId);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return apiErrorResponse(e);
  }
}
