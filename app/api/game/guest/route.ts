import { NextResponse } from "next/server";
import { createGuestSession } from "@/lib/server/auth";
import { rateLimit, clientIp } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

// Convidats: jugar cal cap compte. Límit de creació de sessions per IP per
// evitar inundar la taula players; un convidat existent reutilitza la sessió.
export async function POST(req: Request) {
  if (!await rateLimit(`guest:${clientIp(req)}`, 30, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Massa convidats des d'aquesta IP" }, { status: 429 });
  }
  try {
    await createGuestSession();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "No s'ha pogut crear la sessió de convidat" }, { status: 500 });
  }
}
