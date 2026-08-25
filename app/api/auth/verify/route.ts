import { NextResponse } from "next/server";
import { redeemMagicToken } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * Canvi de token per sessió, SEMPRE per POST i des del botó de la pàgina
 * intermèdia /entrar/verificar. Cap canvi d'estat per GET: els previews
 * d'agendadors i bots que obren el correu no poden cremar el token.
 */
export async function POST(req: Request) {
  let token: unknown;
  try {
    ({ token } = await req.json());
  } catch {
    return NextResponse.json({ error: "Cos invàlid" }, { status: 400 });
  }
  if (typeof token !== "string" || !token) {
    return NextResponse.json(
      { error: "Enllaç invàlit o caducat", redirect: "/entrar?error=caducat" },
      { status: 400 }
    );
  }
  try {
    const { hasNickname } = await redeemMagicToken(token);
    return NextResponse.json({ ok: true, redirect: hasNickname ? "/" : "/benvingut" });
  } catch (e) {
    // Un error d'infraestructura NO és un enllaç caducat: mai el presentem
    // com a tal. Els HttpError (token consumit, compte esborrat) sí que
    // parlen amb veu pròpia.
    if (e instanceof HttpError) {
      const redirect = e.status === 409 ? "/entrar?error=token" : "/entrar?error=caducat";
      return NextResponse.json({ error: e.message, redirect }, { status: e.status });
    }
    console.error(e);
    return NextResponse.json(
      { error: "No s'ha pogut verificar l'enllaç ara mateix. Torna-ho a provar en una estona.", redirect: null },
      { status: 500 }
    );
  }
}
