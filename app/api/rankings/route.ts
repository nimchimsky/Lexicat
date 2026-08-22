import { NextResponse } from "next/server";
import { getRankings } from "@/lib/server/views";

export const runtime = "nodejs";

export async function GET() {
  try {
    const boards = await getRankings();
    return NextResponse.json(boards);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Rànquings no disponibles ara mateix" }, { status: 503 });
  }
}
