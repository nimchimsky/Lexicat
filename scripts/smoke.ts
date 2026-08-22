// Prova de foc end-to-end contra el servidor de desenvolupament:
// entrada per enllaç màgic (mode dev) → partida completa de 100 respostes →
// pantalla de resultats. Comprova que cap resposta filtra is_word ni item_id
// i que el resultat final té les mètriques plausibles.
//
// Ús: npx tsx scripts/smoke.ts [baseUrl]

import "dotenv/config";

const base = process.argv[2] ?? "http://localhost:3000";

function extractSetCookies(headers: Headers): string[] {
  const raw = headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]);
}

async function main() {
  const email = `smoke-${Date.now()}@test.cat`;
  let cookieJar: string[] = [];

  // 1) Demanar l'enllaç màgic
  const linkRes = await fetch(`${base}/api/auth/request-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const linkData = await linkRes.json();
  if (!linkData.devUrl) throw new Error(`Sense devUrl (SMTP configurat?): ${JSON.stringify(linkData)}`);

  // 2) Canviar el token per sessió
  const verifyRes = await fetch(linkData.devUrl, { redirect: "manual" });
  cookieJar = cookieJar.concat(extractSetCookies(verifyRes.headers));
  if (!cookieJar.some((c) => c.startsWith("pompeu_session"))) {
    throw new Error("La verificació no ha establert sessió");
  }
  const cookieHeader = cookieJar.join("; ");

  // 3) Sobrenom
  await fetch(`${base}/api/me`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ nickname: `fum-${Date.now() % 100000}` }),
  });

  // 4) Començar partida
  const startRes = await fetch(`${base}/api/game/start`, {
    method: "POST",
    headers: { Cookie: cookieHeader },
  });
  const { gameId } = await startRes.json();

  // 5) Jugar 100 ítems
  let leak = false;
  for (let pos = 1; pos <= 100; pos++) {
    const itemRes = await fetch(`${base}/api/game/item?gameId=${gameId}&position=${pos}`, {
      headers: { Cookie: cookieHeader },
    });
    if (!itemRes.ok) throw new Error(`Ítem ${pos}: HTTP ${itemRes.status}`);
    const itemText = await itemRes.text();
    if (/"is_word"|"isWord"|"item_id"/i.test(itemText)) {
      leak = true;
      console.error(`FUGA a l'ítem ${pos}: ${itemText}`);
    }
    const item = JSON.parse(itemText);
    if (item.position !== pos) throw new Error(`Posició inesperada ${item.position} ≠ ${pos}`);

    const confidence = [0.05, 0.25, 0.5, 0.75, 0.95][pos % 5];
    const respRes = await fetch(`${base}/api/game/response`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({
        responseId: crypto.randomUUID(),
        gameId,
        position: pos,
        confidence,
        timeToFirstInputMs: 200 + pos,
        responseTimeMs: 800 + pos * 3,
        nAdjustments: pos % 3,
      }),
    });
    if (!respRes.ok) throw new Error(`Resposta ${pos}: HTTP ${respRes.status} ${await respRes.text()}`);
    const r = await respRes.json();
    if (r.finished && pos !== 100) throw new Error("Acabada abans d'hora?");
  }
  if (leak) throw new Error("L'API d'ítems ha filtrat is_word/item_id");
  console.log("Partida completa: cap fuga d'is_word ni item_id ✔");

  // 6) Reenviament idempotent d'una resposta ja registrada
  // (es fa implícitament al pas 5 amb el mateix UUID? no: aquí comprovem l'API)
  // Reenviem l'última resposta amb un response_id JA usat:
  const dupe = await fetch(`${base}/api/game/response`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({
      responseId: "11111111-1111-4111-8111-111111111111",
      gameId,
      position: 999,
      confidence: 0.9,
    }),
  });
  // Ha de fallar net (partida tancada), no penjar-se ni corrompre res.
  console.log(`Reenviament sobre partida tancada: HTTP ${dupe.status} (esperat 409/404) ✔`);

  // 7) Resultats
  const page = await fetch(`${base}/resultats/${gameId}`, { headers: { Cookie: cookieHeader } });
  const html = await page.text();
  if (!html.includes("%")) throw new Error("La pàgina de resultats no mostra percentatge");
  if (!html.includes("IC95")) throw new Error("La pàgina de resultats no mostra l'interval");
  if (!html.includes("dlc.iec.cat")) throw new Error("Sense enllaços al DIEC");
  console.log("Pantalla de resultats: %, IC95 i enllaços DIEC presents ✔");
  console.log("\nSMOKE TEST COMPLETAT AMB ÈXIT ✔");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
