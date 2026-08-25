// Resposta d'error uniforme per als endpoints API. Els HttpError porten
// missatges pensats per a la persona; qualsevol altra cosa és un error
// intern que es registra i es reporta genèric — el missatge tècnic mai
// arriba al client (allà no serveix de res i pot filtrar detalls).

import { NextResponse } from "next/server";
import { HttpError } from "./http";

export function apiErrorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  console.error(e);
  return NextResponse.json({ error: "Error intern" }, { status: 500 });
}

export function invalidBody(message = "Cos invàlid"): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}
