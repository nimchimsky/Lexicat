import { NextResponse } from "next/server";
import { redeemMagicToken } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.redirect(new URL("/entrar?error=token", req.url));
  try {
    const { hasNickname } = await redeemMagicToken(token);
    return NextResponse.redirect(new URL(hasNickname ? "/" : "/benvingut", req.url));
  } catch {
    return NextResponse.redirect(new URL("/entrar?error=caducat", req.url));
  }
}
