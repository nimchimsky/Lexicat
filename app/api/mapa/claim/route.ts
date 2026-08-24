import { NextResponse } from "next/server";
import { currentPlayer } from "@/lib/server/auth";
import { claimRegion } from "@/lib/server/mapa";
import { HttpError } from "@/lib/server/http";

export const runtime = "nodejs";

/** Reclama una zona del mapa gastant una fitxa pendent. */
export async function POST(req: Request) {
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

  try {
    const r = await claimRegion(player.id, regionId);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "No s'ha pogut reclamar la zona" }, { status: 500 });
  }
}
