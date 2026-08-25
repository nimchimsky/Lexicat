import { NextResponse } from "next/server";
import { getFunnel } from "@/lib/server/views";
import { apiErrorResponse } from "@/lib/server/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Embut agregat de retenció (iniciat → primer ítem → completat), derivat
 * SEMPRE de taules que ja existeixen: no es registra res nou per mesurar-lo.
 * Protegit per ADMIN_TOKEN (capçalera `x-admin-token`): és dada interna de
 * producte, no pública. Sense ADMIN_TOKEN configurat, 404 (no revela res).
 */
export async function GET(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return new NextResponse(null, { status: 404 });
  if ((req.headers.get("x-admin-token") ?? "") !== token) {
    return NextResponse.json({ error: "No autoritzat" }, { status: 401 });
  }
  try {
    const hours = Number(new URL(req.url).searchParams.get("hours") ?? "");
    const funnel = await getFunnel(Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 366) : 24 * 30);
    return NextResponse.json(funnel);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
