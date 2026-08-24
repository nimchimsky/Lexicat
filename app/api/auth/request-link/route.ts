import { NextResponse } from "next/server";
import { createMagicToken } from "@/lib/server/auth";
import { sendMagicLink } from "@/lib/server/mailer";
import { rateLimit, clientIp } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`link:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Massa intents. Torna-ho a provar més tard." }, { status: 429 });
  }
  let email: string;
  try {
    ({ email } = await req.json());
  } catch {
    return NextResponse.json({ error: "Cos invàlid" }, { status: 400 });
  }
  try {
    const token = await createMagicToken(email, ip);
    const origin = new URL(req.url).origin;
    const url = `${origin}/api/auth/verify?token=${token}`;
    const sent = await sendMagicLink(email.trim().toLowerCase(), url);
    return NextResponse.json({ ok: true, devUrl: sent.devUrl ?? null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

