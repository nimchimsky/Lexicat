// Utilitats de xarxa compartides pels dos clients de joc i els formularis.
// El contracte és sempre el mateix: el servidor és idempotent per resposta
// (mateix response_id → mateix resultat), així reenviar és segur.

/** navigator.onLine amb guard de SSR. */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Extreu el missatge d'error d'una resposta sense petar mai: un 502 HTML del
 * proxy no és JSON i res.json() llançaria un SyntaxError en anglès.
 */
export async function responseErrorMessage(res: Response): Promise<string> {
  const fallback = `HTTP ${res.status}`;
  try {
    const data = (await res.json()) as { error?: unknown };
    return typeof data?.error === "string" && data.error ? data.error : fallback;
  } catch {
    return fallback;
  }
}

/** Retard d'un reintento amb jitter: evita que tots els clients repeteixin alhora. */
export function backoffDelay(attempt: number, baseMs = 800): number {
  const linear = baseMs * (attempt + 1);
  const jitter = Math.random() * baseMs * 0.5;
  return Math.round(linear + jitter);
}

/** POST JSON amb el tractament d'errors uniforme (missatge del servidor o HTTP n). */
export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
  if (!res.ok) {
    throw new Error(await responseErrorMessage(res));
  }
  return (await res.json()) as T;
}
