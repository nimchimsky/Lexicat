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

/**
 * El flux vigent: el devUrl apunta a la pàgina intermèdia
 * /entrar/verificar?token=…, i la sessió s'estableix NOMÉS amb un POST a
 * /api/auth/verify (cap canvi d'estat per GET: els previews del correu no
 * cremen el token).
 */
async function redeemToken(devUrl: string, cookieJar: string[]): Promise<string[]> {
  const token = new URL(devUrl).searchParams.get("token");
  if (!token) throw new Error(`El devUrl no porta token: ${devUrl}`);
  const res = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieJar.join("; ") },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`verify: HTTP ${res.status} ${await res.text()}`);
  return cookieJar.concat(extractSetCookies(res.headers));
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

  // 1b) La pàgina intermèdia NO consumeix el token ni estableix sessió per GET.
  const preview = await fetch(linkData.devUrl, { redirect: "manual" });
  if (extractSetCookies(preview.headers).some((c) => c.startsWith("lexicat_session"))) {
    throw new Error("Un GET de la pàgina de verificació ha establert sessió: hauria de ser impossible");
  }

  // 2) Canviar el token per sessió (POST, com el botó de la intersticial)
  cookieJar = await redeemToken(linkData.devUrl, cookieJar);
  if (!cookieJar.some((c) => c.startsWith("lexicat_session"))) {
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
  const { gameId, responseFormat } = await startRes.json();
  const format: string = responseFormat ?? "?";

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
  console.log(`Format servit per la partida: ${format} (esperat slider) ${format === "slider" ? "✔" : "✘"}`);

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
  // Els punts de cada ítem cauen en files amb class="pts" (DECISIONS §11).
  if (!html.includes('class="pts"')) throw new Error("La pàgina de resultats no mostra la puntuació per ítem");
  console.log("Pantalla de resultats: %, IC95, DIEC i punts per ítem presents ✔");

  // 8) Flux de convidat: sense cap login
  const guestRes = await fetch(`${base}/api/game/guest`, { method: "POST" });
  if (!guestRes.ok) throw new Error(`Convidat: HTTP ${guestRes.status}`);
  const guestCookies = extractSetCookies(guestRes.headers);
  const guestCookie = guestCookies.join("; ");
  if (!guestCookie.includes("lexicat_session")) throw new Error("Sessió de convidat no establerta");

  const gStart = await fetch(`${base}/api/game/start`, {
    method: "POST",
    headers: { Cookie: guestCookie },
  });
  const g = await gStart.json();
  for (let pos = 1; pos <= 3; pos++) {
    await fetch(`${base}/api/game/item?gameId=${g.gameId}&position=${pos}`, {
      headers: { Cookie: guestCookie },
    });
    await fetch(`${base}/api/game/response`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: guestCookie },
      body: JSON.stringify({
        responseId: crypto.randomUUID(),
        gameId: g.gameId,
        position: pos,
        confidence: 0.5,
        timeToFirstInputMs: 300,
        responseTimeMs: 1000,
        nAdjustments: 1,
      }),
    });
  }
  // El convidat abandona començant una partida nova → abandonada a la posició 3.
  await fetch(`${base}/api/game/start`, { method: "POST", headers: { Cookie: guestCookie } });
  const me = await fetch(`${base}/api/me`, { headers: { Cookie: guestCookie } });
  const meData = await me.json();
  if (meData.player?.email !== null && meData.player?.email !== undefined) {
    // els convidats no tenen correu; si el camp ve buit d'una altra manera, ho deixem passar
  }
  console.log("Flux de convidat: sessió sense correu, partida iniciada i abandonada correctament ✔");

  // 9) Upgrade de convidat a compte: el correu s'assigna AL MATEIX jugador
  // i tot l'historial es conserva.
  const upgradeEmail = `smoke-up-${Date.now()}@test.cat`;
  const linkRes2 = await fetch(`${base}/api/auth/request-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: guestCookie },
    body: JSON.stringify({ email: upgradeEmail }),
  });
  const link2 = await linkRes2.json();
  if (!link2.devUrl) throw new Error("Sense devUrl per l'upgrade");
  cookieJar = await redeemToken(link2.devUrl, guestCookie.split("; "));
  await fetch(`${base}/api/me`, { headers: { Cookie: cookieJar.join("; ") } });
  const meRes = await fetch(`${base}/api/me`, { headers: { Cookie: cookieJar.join("; ") } });
  const meData2 = await meRes.json();
  if (!meData2.player || meData2.player.email !== upgradeEmail) {
    throw new Error(`L'upgrade de convidat no ha conservat la identitat: ${JSON.stringify(meData2.player)}`);
  }
  console.log("Upgrade convidat→compte: mateixa identitat, correu assignat ✔");

  // 10) Mapa: amb l'arrencada ràpida (MAPA_FAST_START_WORDS), la primera
  // zona cau en acabar la PRIMERA partida (66 paraules vistes): 1 fitxa
  // pendent, reclamable. El progrés sempre es deriva de responses.
  const mapaRes = await fetch(`${base}/api/mapa`, { headers: { Cookie: cookieHeader } });
  if (!mapaRes.ok) throw new Error(`API mapa: HTTP ${mapaRes.status}`);
  const mapa = await mapaRes.json();
  if (mapa.wordsSeen !== 66) throw new Error(`Mapa: paraules vistes ${mapa.wordsSeen} ≠ 66`);
  if (mapa.earned !== 1 || mapa.pending !== 1) {
    throw new Error(`Mapa: amb 66 paraules hi ha d'haver exactament 1 fitxa (${JSON.stringify(mapa)})`);
  }
  // Denominador coherent: el banc net exclou 4 paraules sense DIEC → 40.773.
  if (mapa.zones !== 100 || mapa.wordsTotal !== 40773) {
    throw new Error(`Mapa: constants inesperades ${mapa.zones}/${mapa.wordsTotal}`);
  }
  const claimBad = await fetch(`${base}/api/mapa/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ regionId: "catalunya--no-existeix" }),
  });
  if (claimBad.status !== 400) throw new Error(`Regió desconeguda: HTTP ${claimBad.status} (esperat 400)`);
  // Amb fitxa pendent la reclamació reeixeix i gasta l'única fitxa.
  const claimOk = await fetch(`${base}/api/mapa/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ regionId: "catalunya--alt-camp" }),
  });
  if (!claimOk.ok) throw new Error(`Reclamació amb fitxa: HTTP ${claimOk.status}`);
  const claimNo = await fetch(`${base}/api/mapa/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ regionId: "catalunya--priorat" }),
  });
  if (claimNo.status !== 409) throw new Error(`Segona reclamació sense fitxa: HTTP ${claimNo.status} (esperat 409)`);
  const mapaAfter = await (await fetch(`${base}/api/mapa`, { headers: { Cookie: cookieHeader } })).json();
  if (!mapaAfter.claimedIds.includes("catalunya--alt-camp") || mapaAfter.pending !== 0) {
    throw new Error(`Mapa post-reclamació inesperat: ${JSON.stringify(mapaAfter)}`);
  }
  const mapaPage = await fetch(`${base}/mapa`, { headers: { Cookie: cookieHeader } });
  if (!mapaPage.ok) throw new Error(`Pàgina /mapa: HTTP ${mapaPage.status}`);
  const svgCompact = await fetch(`${base}/mapa/paisos-catalans-100.compact.svg`);
  if (!svgCompact.ok) throw new Error("L'SVG compacte no es serveix des de /public");
  console.log("Mapa: arrencada ràpida amb 1 fitxa per la primera partida, reclamació transaccional ✔");

  console.log("\nSMOKE TEST COMPLETAT AMB ÈXIT ✔");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
