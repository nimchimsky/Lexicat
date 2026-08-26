import { NextResponse } from "next/server";
import { createMagicToken } from "@/lib/server/auth";
import { sendMagicLink, MailServiceError } from "@/lib/server/mailer";
import { rateLimit, clientIp } from "@/lib/server/ratelimit";
import { HttpError } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * Origen per als enllaços del correu. La URL d'un correu és material de
 * seguretat (hi viu un token d'un sol ús): mai no es deriva del Host de la
 * petició, que un atacant pot suplantar darrere d'un proxy.
 *   · APP_BASE_URL mana sempre que estigui definida;
 *   · a Vercel l'origin de la petició és fiable (la plataforma controla el
 *     Host) i serveix de fallback;
 *   · self-hosted en producció sense APP_BASE_URL: es nega a enviar — la
 *     configuració que falta ha de ser sorollosa, no un enllaç enverinat.
 */
function baseUrl(req: Request): string | null {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL) return new URL(req.url).origin; // Vercel controla el Host
  if (process.env.NODE_ENV !== "production") return new URL(req.url).origin; // dev local
  return null; // producció self-hosted sense configurar: mai un enllaç enverinat
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!await rateLimit(`link:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Massa intents. Torna-ho a provar més tard." }, { status: 429 });
  }
  let email: unknown;
  try {
    ({ email } = await req.json());
  } catch {
    return NextResponse.json({ error: "Cos invàlid" }, { status: 400 });
  }
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ error: "Cal un correu vàlid" }, { status: 400 });
  }

  const origin = baseUrl(req);
  if (!origin) {
    console.error("[auth/request-link] APP_BASE_URL no configurada en producció self-hosted");
    return NextResponse.json(
      { error: "El servei de correu no està disponible ara mateix." },
      { status: 503 }
    );
  }

  try {
    const token = await createMagicToken(email, ip);
    // L'enllaç cau a una pàgina intermèdia amb botó (mai canvi d'estat per GET):
    // un preview del correu no pot cremar el token d'un sol ús.
    const url = `${origin}/entrar/verificar?token=${token}`;
    const sent = await sendMagicLink(email.trim().toLowerCase(), url);
    return NextResponse.json({ ok: true, devUrl: sent.devUrl ?? null });
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof MailServiceError) {
      console.error("[auth/request-link]", e.message);
      return NextResponse.json(
        { error: "El servei de correu no funciona ara mateix. Torna-ho a provar en una estona." },
        { status: 503 }
      );
    }
    console.error(e);
    return NextResponse.json({ error: "No s'ha pogut enviar l'enllaç" }, { status: 500 });
  }
}
