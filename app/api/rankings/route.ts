import { NextResponse } from "next/server";
import { getRankings, getKilianRankings } from "@/lib/server/views";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  try {
    if (mode === "kilian") {
      return NextResponse.json({ kilian: await getKilianRankings() });
    }
    return NextResponse.json(await getRankings());
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Rànquings no disponibles ara mateix" }, { status: 503 });
  }
}

