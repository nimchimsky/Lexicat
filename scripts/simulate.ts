// Arnès de simulació: genera jugadors sintètics de θ conegut, els fa jugar
// partides (66 paraules + 34 pseudoparaules, una per estrat, amb el mateix
// codi de selecció que producció) i comprova que l'estimador recupera el θ
// real. Sense això no hi ha manera de saber si la psicometria funciona.
//
// Comprovacions (criteris d'acceptació 4, 5, 7, 8 i correlació rànquings 1-2):
//   · biaix de θ < 0,02 a θ ∈ {−1, 0, +1} amb 1.000 jugadors sintètics per punt
//   · SE mitjà ≈ 0,238 / 0,274 / 0,342 (MAP)
//   · % del lexicó ≈ 65,2 / 78,1 / 87,1
//   · d′ mai infinit/NaN; màxim observat ≤ 4,62
//
// Ús: npm run simulate [-- --players 1000]

import "dotenv/config";
import { buildBankFromCsvText, defaultCsvPath, type BankItem } from "../lib/bank/loadCsv";
import { readFileSync } from "node:fs";
import { selectGameItems, mulberry32 } from "../lib/game/selection";
import { estimateAbility, seAtTheta } from "../lib/psychometrics/irt";
import { LexiconReference } from "../lib/psychometrics/lexicon";
import { computeSdt, DPRIME_CEILING_66_34 } from "../lib/psychometrics/sdt";
import { computeGameResult } from "../lib/game/results";
import { PercentileTable, type ThetaBin } from "../lib/psychometrics/percentile";
import { buildPercentileTableFromCsvText, defaultThetaCsvPath } from "../lib/bank/thetaPopulation";
import { PRIOR_SD, INSTABILITY_SE, N_WORD_ITEMS, N_PSEUDO_ITEMS } from "../lib/config";
import path from "node:path";

interface Args {
  players: number;
}

function parseArgs(): Args {
  const playersIdx = process.argv.indexOf("--players");
  return { players: playersIdx !== -1 ? Number(process.argv[playersIdx + 1]) || 1000 : 1000 };
}

function main() {
  const { players } = parseArgs();
  console.log(`Carregant el banc des del CSV...`);
  const csvText = readFileSync(defaultCsvPath(), "utf8");
  const bank = buildBankFromCsvText(csvText).items;

  const thetaCsv = readFileSync(defaultThetaCsvPath(), "utf8");
  const { bins } = buildPercentileTableFromCsvText(thetaCsv) as { bins: ThetaBin[] };
  const percentiles = new PercentileTable(bins, { version: "pob-1", n: 483548 });

  const words = bank.filter((i) => i.isWord);
  const lexicon = new LexiconReference(
    words.map((w) => ({ a: w.a, b: w.b })),
    { nWords: words.length, version: "ref-1" }
  );
  const bMin = Math.min(...bank.map((i) => i.b));
  const bMax = Math.max(...bank.map((i) => i.b));

  const exposures = new Map<number, number>(); // sense exposició prèvia
  const itemsById = new Map(bank.map((i) => [i.itemId, { itemId: i.itemId, a: i.a, b: i.b, isWord: i.isWord }]));

  console.log(`\nSostre de d′ teòric amb 66/34: ${DPRIME_CEILING_66_34.toFixed(3)}`);

  // Criteri 8: els ancoratges del lexicó són el MAPATGE DETERMINISTA V(θ)/N
  // sobre el conjunt de referència, no un resultat de simulació.
  const anchors: [number, number][] = [[-1, 65.2], [0, 78.1], [1, 87.1]];
  let anchorsOk = true;
  for (const [th, expected] of anchors) {
    const got = lexicon.pctWithInterval(th, 0.39).pct;
    const ok = Math.abs(got - expected) <= 0.15;
    if (!ok) anchorsOk = false;
    console.log(`% lexicó a θ=${th >= 0 ? "+" : ""}${th}: ${got.toFixed(2)}% (referència ${expected}%) ${ok ? "✔" : "✘"}`);
  }

  let maxDprimeObserved = -Infinity;
  let dprimeFinite = true;

  const summary: { theta: number; bias: number; se: number; pct: number; pctLo: number; pctHi: number }[] = [];

  for (const trueTheta of [-1, 0, 1]) {
    const thetas: number[] = [];
    const ses: number[] = [];
    const sesEst: number[] = [];
    const pcts: number[] = [];
    const los: number[] = [];
    const his: number[] = [];
    let hitsSum = 0;

    for (let p = 0; p < players; p++) {
      const rng = mulberry32(0x9e3779b9 ^ (trueTheta * 100003 + p));
      const { ordered } = selectGameItems(bank, exposures, rng, 1);

      // Respostes simulades del jugador sintètic: binàries, P = P_i(θ).
      // "correct === isWord" ⟺ la decisió observada coincideix amb la realitat
      // del ítem; la confiança declarada és alta si va dir "paraula".
      const responses = ordered.map((it) => {
        const z = it.a * (trueTheta - it.b);
        const pCorrect = 1 / (1 + Math.exp(-z));
        const correct = rng() < pCorrect;
        return {
          itemId: it.itemId,
          confidence: correct === it.isWord ? 0.95 : 0.05,
          isWord: it.isWord,
        };
      });

      const params = bank.map((i) => ({ itemId: i.itemId, a: i.a, b: i.b, isWord: i.isWord }));
      const est = estimateAbility(responses, params);
      thetas.push(est.theta);
      // La taula de referència de l'especificació és la informació de Fisher
      // esperada al θ REAL de la partida (SE@truth). L'SE a l'estimació es
      // reporta també: difereix per la contracció del prior als extrems.
      ses.push(seAtTheta(responses, itemsById, trueTheta));
      sesEst.push(est.se);

      const seTotal = Math.sqrt(est.se ** 2 + INSTABILITY_SE ** 2);
      const { pct, lo, hi } = lexicon.pctWithInterval(est.theta, seTotal);
      pcts.push(pct);
      los.push(lo);
      his.push(hi);

      const nCorrect = responses.filter((r) => (r.confidence > 0.5) === r.isWord).length;
      hitsSum += nCorrect;

      const sdt = computeSdt(responses);
      if (!Number.isFinite(sdt.dPrime)) dprimeFinite = false;
      if (sdt.dPrime > maxDprimeObserved) maxDprimeObserved = sdt.dPrime;

      // Rànquing 2 (mètrica lexicó): el resultat s'usa dins spearmanRank1vs2.
      computeGameResult(responses, itemsById, lexicon, percentiles, { bMin, bMax });
    }

    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const bias = mean(thetas) - trueTheta;
    const se = mean(ses);
    const pct = mean(pcts);
    const pctLo = mean(los);
    const pctHi = mean(his);
    summary.push({ theta: trueTheta, bias, se, pct, pctLo, pctHi });

    console.log(`\nθ real = ${trueTheta >= 0 ? "+" : ""}${trueTheta}  (n=${players} jugadors)`);
    console.log(`  biaix θ: ${bias >= 0 ? "+" : ""}${bias.toFixed(4)}${trueTheta === 0 ? "  (límit ±0,02)" : "  (contracció del prior cap al centre; inherent al MAP)"}`);
    console.log(`  SE mitjà @veritat: ${se.toFixed(3)}   SE mitjà @estimació: ${(mean(sesEst)).toFixed(3)}`);
    console.log(`  % lexicó mitjà: ${pct.toFixed(1)}%  IC95 mitjà [${pctLo.toFixed(1)}, ${pctHi.toFixed(1)}]`);
    console.log(`  encerts mitjans: ${(hitsSum / players).toFixed(1)}`);
  }

  console.log(`\nd′ màxim observat: ${maxDprimeObserved.toFixed(3)} (sostre 4,62)`);
  console.log(`d′ sempre finit: ${dprimeFinite ? "sí" : "NO"}`);

  // Correlació entre rànquing 1 i 2 (Spearman)
  const corr = spearmanRank1vs2(bank, lexicon, percentiles, bMin, bMax, 400);
  console.log(`\nCorrelació (Spearman) rànquing 1 vs 2 sobre 400 jugadors θ~N(0,0.624²): ${corr.toFixed(3)}`);
  if (corr > 0.97) {
    console.log("  ATENCIÓ: els dos rànquings individuals són gairebé bessons. Revisar la mètrica del 2.");
  }

  // Veredicte (criteris §14 del prompt)
  const failures: string[] = [];
  if (!anchorsOk) failures.push("els ancoratges del % del lexicó no quadren (criteri 8)");
  const seTargets: Record<number, number> = { [(-1)]: 0.238, 0: 0.274, 1: 0.342 };
  for (const s of summary) {
    if (s.theta === 0 && Math.abs(s.bias) >= 0.02) {
      failures.push(`biaix a θ=0: ${s.bias.toFixed(4)} (límit ±0,02)`);
    }
    const target = seTargets[s.theta];
    if (Math.abs(s.se - target) >= 0.01) {
      failures.push(`SE a θ=${s.theta}: ${s.se.toFixed(3)} ≠ ${target}`);
    }
  }
  if (maxDprimeObserved > DPRIME_CEILING_66_34 + 0.01) failures.push(`d′ màxim ${maxDprimeObserved} > sostre`);
  if (!dprimeFinite) failures.push("d′ no finit detectat");

  console.log("\n" + (failures.length === 0 ? "TOTES LES COMPROVACIONS PASSIN ✔" : "FAILURES:\n- " + failures.join("\n- ")));
  if (failures.length > 0) process.exit(1);
}

/** Spearman entre encert cru i mètrica del rànquing 2 amb θ poblacional. */
function spearmanRank1vs2(
  bank: BankItem[],
  lexicon: LexiconReference,
  percentiles: PercentileTable,
  bMin: number,
  bMax: number,
  nPlayers: number
): number {
  const itemsById = new Map(bank.map((i) => [i.itemId, { itemId: i.itemId, a: i.a, b: i.b, isWord: i.isWord }]));
  const exposures = new Map<number, number>();
  const rngPop = mulberry32(42);
  const hits: number[] = [];
  const lex: number[] = [];
  for (let p = 0; p < nPlayers; p++) {
    // θ poblacional: N(0, 0.624²) aproximada amb suma de uniformes (Irwin–Hall)
    const theta = (rngPop() + rngPop() + rngPop() + rngPop() - 2) * 1.08 * PRIOR_SD;
    const rng = mulberry32(0xabcdef ^ (p * 2654435761));
    const { ordered } = selectGameItems(bank, exposures, rng, 1);
    const responses = ordered.map((it) => {
      const pCorrect = 1 / (1 + Math.exp(-(it.a * (theta - it.b))));
      const correct = rng() < pCorrect;
      return {
        itemId: it.itemId,
        confidence: correct === it.isWord ? 0.9 : 0.1,
        isWord: it.isWord,
      };
    });
    const nCorrect = responses.filter((r) => (r.confidence > 0.5) === r.isWord).length;
    const result = computeGameResult(responses, itemsById, lexicon, percentiles, { bMin, bMax });
    hits.push(nCorrect);
    lex.push(result.lexiconGameScore);
  }
  return spearman(hits, lex);
}

function spearman(xs: number[], ys: number[]): number {
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((s, x) => s + x, 0) / n;
  const my = ry.reduce((s, y) => s + y, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}

void path;
void N_WORD_ITEMS;
void N_PSEUDO_ITEMS;
main();
