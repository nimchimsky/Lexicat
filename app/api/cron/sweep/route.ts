import { NextResponse } from "next/server";
import { sweepAbandonedGames } from "@/lib/server/game";
import { purgeExpiredAuthArtifacts } from "@/lib/server/auth";
import { purgeExpiredRateLimitBuckets } from "@/lib/server/ratelimit";
import { apiErrorResponse } from "@/lib/server/apiError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manteniment programat (Vercel Cron, vegeu vercel.json): abandona les
 * partides in_progress velles i poda sessions/tokens caducats.
 *
 * Protegit per CRON_SECRET (Vercel l'envia com a Bearer). FALLA TANCAT: en
 * producció, sense secret configurat, la ruta respon 401 en lloc d'executar
 * escriptures per a qualsevol — la configuració que falta ha de ser sorollosa,
 * mai una porta oberta. En desenvolupament queda oberta per comoditat.
 */
async function run(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";
  if (!secret && isProd) {
    console.error("[cron/sweep] CRON_SECRET no configurada: manteniment bloquejat");
    return NextResponse.json({ error: "No autoritzat" }, { status: 401 });
  }
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "No autoritzat" }, { status: 401 });
    }
  }
  try {
    await sweepAbandonedGames();
    await purgeExpiredAuthArtifacts();
    await purgeExpiredRateLimitBuckets();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiErrorResponse(e);
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
