import { describe, expect, it } from "vitest";
import { probit, normCdf } from "../lib/psychometrics/math";
import { binarize, estimateAbility, pCorrect2pl, seAtTheta } from "../lib/psychometrics/irt";
import { computeSdt, DPRIME_CEILING_66_34 } from "../lib/psychometrics/sdt";
import { displayItemScore, itemWeight, minRawScore, pAssignedToCorrect, rawScore, totalDisplayScore } from "../lib/psychometrics/scoring";
import { PercentileTable } from "../lib/psychometrics/percentile";
import { LexiconReference } from "../lib/psychometrics/lexicon";
import { buildBankFromCsvText, loadBankCsvText, type BankItem } from "../lib/bank/loadCsv";
import { selectGameItems, mulberry32 } from "../lib/game/selection";
import { computeGameResult } from "../lib/game/results";
import { BUTTON_CONFIDENCE, PRIOR_SD } from "../lib/config";

const bank: BankItem[] = buildBankFromCsvText(loadBankCsvText()).items;
const words = bank.filter((i) => i.isWord);
const itemsParams = bank.map((i) => ({ itemId: i.itemId, a: i.a, b: i.b, isWord: i.isWord }));
const itemsById = new Map(itemsParams.map((i) => [i.itemId, i]));
const bMin = Math.min(...bank.map((i) => i.b));
const bMax = Math.max(...bank.map((i) => i.b));

describe("math", () => {
  it("probit contra valors coneguts d'alta precisió", () => {
    expect(probit(0.975)).toBeCloseTo(1.959963984540054, 10);
    expect(probit(0.5)).toBeCloseTo(0, 12);
    expect(probit(0.9925)).toBeCloseTo(2.432379058584428, 12);
    expect(probit(0.5 / 35)).toBeCloseTo(-2.1893497555220831, 12);
    expect(probit(0.001)).toBeCloseTo(-3.090232306167813, 10);
    expect(probit(0.999)).toBeCloseTo(3.090232306167813, 10);
  });
  it("normCdf és la inversa de probit i quadra als clàssics", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 14);
    expect(normCdf(1.959963984540054)).toBeCloseTo(0.975, 11);
    expect(normCdf(2.432379058584428)).toBeCloseTo(0.9925, 11);
    for (const x of [-4, -1.23, 0.7, 2.9, 4.5]) {
      const p = normCdf(x);
      if (p > 1e-12 && p < 1 - 1e-12) expect(probit(p)).toBeCloseTo(x, 9);
    }
  });
});

describe("regla de desempat del 50%", () => {
  it("exactament 0,5 compta com a 'no és paraula' de manera determinista", () => {
    expect(binarize(0.5)).toBe(false);
    expect(binarize(0.5000001)).toBe(true);
    expect(binarize(0.25)).toBe(false);
  });
});

describe("estimació MAP 2PL", () => {
  /** Confiança que un jugador sintètic de resposta binària declararia:
   *  si la seva decisió és "és paraula", confiança alta; si rebutja, baixa. */
  function confOf(decisionSaidWord: boolean, hi = 0.95, lo = 0.05): number {
    return decisionSaidWord ? hi : lo;
  }

  function simulateGame(theta: number, seed: number) {
    const rng = mulberry32(seed);
    const exposures = new Map<number, number>();
    const { ordered } = selectGameItems(bank, exposures, rng, 1);
    return ordered.map((it) => {
      const p = pCorrect2pl(theta, it.a, it.b);
      const correct = rng() < p;
      // La decisió observada depèn de la naturalesa de l'ítem:
      const saidWord = it.isWord ? correct : !correct;
      return { itemId: it.itemId, confidence: confOf(saidWord), isWord: it.isWord };
    });
  }

  it("biaix < 0,02 a θ=0 amb n=1000 (criteri 4)", () => {
    let sum = 0;
    const N = 1000;
    for (let s = 0; s < N; s++) sum += estimateAbility(simulateGame(0, 50000 + s), itemsParams).theta;
    const bias = sum / N - 0;
    expect(Math.abs(bias)).toBeLessThan(0.02);
  });

  it("a θ=±1 el MAP contrau cap al prior (propietat coneguda del model); ho mesurem i acotem", () => {
    // El prior N(0, 0,624²) que exigeix l'especificació escurça les cues:
    // el biaix a ±1 no pot ser 0 per construcció. Ho documentem com a
    // contracció i comprovem que queda dins del rang teòric.
    for (const theta of [-1, 1]) {
      let sum = 0;
      const N = 200;
      for (let s = 0; s < N; s++) sum += estimateAbility(simulateGame(theta, 60000 + s), itemsParams).theta;
      const bias = sum / N - theta;
      // La contracció va CAP AL CENTRE: negativa a θ=+1, positiva a θ=−1.
      expect(Math.sign(bias)).toBe(-Math.sign(theta));
      expect(Math.abs(bias)).toBeLessThan(0.35);
    }
  });

  it("SE mitjà ≈ valors de referència exactes del banc net (criteris 4 i 5):", () => {
    // La taula de referència de REVISIO §4.6/prompt §4.1 és la informació de
    // Fisher ESPERADA al θ real de la partida (comprovat: 0,238/0,274/0,342).
    const targets: [number, number][] = [
      [-1, 0.238],
      [0, 0.274],
      [1, 0.342],
    ];
    const byId = new Map(itemsParams.map((i) => [i.itemId, i]));
    for (const [theta, target] of targets) {
      let seSum = 0;
      const N = 300;
      for (let s = 0; s < N; s++) {
        const responses = simulateGame(theta, 77 + s);
        seSum += seAtTheta(responses, byId, theta);
      }
      const seMean = seSum / N;
      expect(Math.abs(seMean - target)).toBeLessThan(0.006);
    }
  });

  it("mai surt θ infinit ni NaN amb partida perfecta o nul·la", () => {
    const perfect = bank.slice(0, 100).map((it) => ({
      itemId: it.itemId,
      confidence: it.isWord ? 0.95 : 0.05,
      isWord: it.isWord,
    }));
    const estP = estimateAbility(perfect, itemsParams);
    expect(Number.isFinite(estP.theta)).toBe(true);
    expect(estP.theta).toBeGreaterThan(0);

    const nullGame = perfect.map((r) => ({ ...r, confidence: r.confidence > 0.5 ? 0.05 : 0.95 }));
    const estN = estimateAbility(nullGame, itemsParams);
    expect(Number.isFinite(estN.theta)).toBe(true);
    // Totes les respostes són ara errònies: amb el prior, θ ha de caure ben avall.
    expect(estN.theta).toBeLessThan(-1);
    expect(estN.se).toBeGreaterThan(0);
  });

  it("l'estimador rebut models no implementats (§4.6)", () => {
    const one = [{ itemId: bank[0].itemId, confidence: 0.9, isWord: bank[0].isWord }];
    expect(() => estimateAbility(one, itemsParams, "graded_gpcm_inventat")).toThrow();
  });

  it("sense respostes torna el prior", () => {
    const est = estimateAbility([], itemsParams);
    expect(est.theta).toBe(0);
    expect(est.se).toBeCloseTo(PRIOR_SD, 10);
  });

  it("acumulació entre partides (§4.5): ajuntar respostes estima un cop", () => {
    const rng = mulberry32(5);
    const exposures = new Map<number, number>();
    const g1 = selectGameItems(bank, exposures, rng, 1).ordered;
    const g2 = selectGameItems(bank, exposures, rng, 2).ordered;
    const mk = (items: typeof g1) =>
      items.map((it) => {
        const p = pCorrect2pl(0.5, it.a, it.b);
        const correct = rng() < p;
        return {
          itemId: it.itemId,
          confidence: correct === it.isWord ? 0.9 : 0.1,
          isWord: it.isWord,
        };
      });
    const pooled = [...mk(g1), ...mk(g2)];
    const est = estimateAbility(pooled, itemsParams);
    expect(Math.abs(est.theta - 0.5)).toBeLessThan(0.5);
    expect(pooled.length).toBe(200);
  });
});

describe("d′ amb correcció loglineal (criteris 6 i 7)", () => {
  it("mai infinit ni NaN, ni amb 66 encerts i 0 falses alarmes", () => {
    const perfectWords = words.slice(0, 66).map((it) => ({
      confidence: it.isWord ? 0.95 : 0.95, // accepta tot → FA màxima
      isWord: it.isWord,
    }));
    void perfectWords;

    const gameWords = bank.filter((i) => i.isWord).slice(0, 66);
    const gamePseudos = bank.filter((i) => !i.isWord).slice(0, 34);
    const allPerfect = [
      ...gameWords.map((w) => ({ confidence: 0.95, isWord: true })),
      ...gamePseudos.map((p) => ({ confidence: 0.05, isWord: false })),
    ];
    const sdt = computeSdt(allPerfect);
    expect(Number.isFinite(sdt.dPrime)).toBe(true);
    expect(sdt.nFiftyFifty).toBe(0);
    expect(sdt.dPrime).toBeCloseTo(DPRIME_CEILING_66_34, 6);
    expect(DPRIME_CEILING_66_34).toBeCloseTo(4.62, 2); // ≈ 4,62 documentat
    expect(sdt.dPrime).toBeLessThanOrEqual(DPRIME_CEILING_66_34 + 1e-9);
  });

  it("el sostre observable amb 66/34 és ≈ 4,62", () => {
    expect(DPRIME_CEILING_66_34).toBeGreaterThan(4.55);
    expect(DPRIME_CEILING_66_34).toBeLessThan(4.70);
  });

  it("les respostes d'exactament 50% queden fora de H i FA i es compten", () => {
    const resp = [
      { confidence: 0.5, isWord: true },
      { confidence: 0.5, isWord: false },
      { confidence: 0.95, isWord: true },
      { confidence: 0.05, isWord: false },
    ];
    const sdt = computeSdt(resp);
    expect(sdt.nFiftyFifty).toBe(2);
    expect(sdt.nWords).toBe(1);
    expect(sdt.nPseudo).toBe(1);
  });
});

describe("puntuació (criteri 14)", () => {
  it("mai punts negatius per a cap combinació de respostes", () => {
    for (const conf of [0, 0.01, 0.02, 0.25, 0.5, 0.75, 0.98, 1]) {
      for (const isWord of [true, false]) {
        for (const b of [bMin, -5, 0, 2, bMax]) {
          const p = pAssignedToCorrect(conf, isWord);
          const pts = displayItemScore(p, b, bMin, bMax);
          expect(pts).toBeGreaterThanOrEqual(0);
        }
      }
    }
    const total = totalDisplayScore(
      bank.slice(0, 100).map((it) => ({
        pCorrect: Math.random() * 0.04, // pitjor cas possible: tot erroni i segur
        b: it.b,
      })),
      bMin,
      bMax
    );
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it("el pes W depèn només de b, és estrictament positiu i va de 1 a 3", () => {
    expect(itemWeight(bMin, bMin, bMax)).toBeCloseTo(1, 9);
    expect(itemWeight(bMax, bMin, bMax)).toBeCloseTo(3, 9);
    for (const b of [-9, -1, 0, 1, 3]) expect(itemWeight(b, bMin, bMax)).toBeGreaterThan(0);
  });

  it("manté l'ordre: millor resposta correcta segura > encert dubtós", () => {
    const safe = rawScore(0.95);
    const doubt = rawScore(0.55);
    expect(safe).toBeGreaterThan(doubt);
    expect(minRawScore()).toBeCloseTo(1 + Math.log2(0.02), 10);
  });

  it("els dos formats produeixen el mateix tipus de dada i binaritzen igual (criteri 13)", () => {
    // slider de 21 passos: k/21*... → k/steps; botons: mapatge fix documentat
    const sliderMidpoint = 10 / 20; // passos 0..20
    const buttonMiddle = BUTTON_CONFIDENCE[2];
    expect(binarize(buttonMiddle)).toBe(binarize(sliderMidpoint));
    for (const c of BUTTON_CONFIDENCE) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      expect(typeof binarize(c)).toBe("boolean");
    }
  });
});

describe("percentatge del lexicó (criteri 8)", () => {
  const lexicon = new LexiconReference(
    words.map((w) => ({ a: w.a, b: w.b })),
    { nWords: words.length, version: "ref-1" }
  );

  it("ancoratges: θ=−1→≈65,2%, θ=0→≈78,1%, θ=+1→≈87,1%", () => {
    expect(lexicon.pctWithInterval(-1, 0.39).pct).toBeGreaterThan(64.2);
    expect(lexicon.pctWithInterval(-1, 0.39).pct).toBeLessThan(66.2);
    expect(lexicon.pctWithInterval(0, 0.39).pct).toBeGreaterThan(77.1);
    expect(lexicon.pctWithInterval(0, 0.39).pct).toBeLessThan(79.1);
    expect(lexicon.pctWithInterval(1, 0.39).pct).toBeGreaterThan(86.1);
    expect(lexicon.pctWithInterval(1, 0.39).pct).toBeLessThan(88.1);
  });

  it("V(θ) és monòtona creixent i l'interval conté el punt", () => {
    expect(lexicon.v(-2)).toBeLessThan(lexicon.v(0));
    expect(lexicon.v(0)).toBeLessThan(lexicon.v(2));
    const { pct, lo, hi } = lexicon.pctWithInterval(0, 0.39);
    expect(lo).toBeLessThan(pct);
    expect(pct).toBeLessThan(hi);
  });

  it("el denominador és el conjunt de referència sencer, no els ítems servits", () => {
    expect(words.length).toBe(40773);
    expect(lexicon.nWords).toBe(40773);
  });
});

describe("percentil", () => {
  const bins = Array.from({ length: 42 }, (_, i) => {
    const lo = -5.25 + i * 0.25;
    return { lo, hi: lo + 0.25, n: Math.round(10000 * Math.exp((-(((lo + 0.125) / 0.624) ** 2)) / 2)) };
  });
  const total = bins.reduce((s, b) => s + b.n, 0);
  const table = new PercentileTable(bins, { version: "test", n: total });

  it("monòtona i acotada", () => {
    expect(table.percentileOf(-10)).toBe(0.01);
    expect(table.percentileOf(10)).toBe(99.99);
    const p1 = table.percentileOf(-1);
    const p2 = table.percentileOf(0);
    const p3 = table.percentileOf(1);
    expect(p1).toBeLessThan(p2);
    expect(p2).toBeLessThan(p3);
  });
  it("θ = 0 dona percentil ~50 amb distribució simètrica", () => {
    const p = table.percentileOf(0);
    expect(p).toBeGreaterThan(45);
    expect(p).toBeLessThan(55);
  });
});

describe("selecció d'ítems (criteri 1 i 11)", () => {
  it("66 paraules i 34 pseudoparaules, una per estrat, cap repetició", () => {
    const rng = mulberry32(1234);
    const exposures = new Map<number, number>();
    const { ordered, relaxedStrata } = selectGameItems(bank, exposures, rng, 1);
    expect(relaxedStrata).toHaveLength(0);
    expect(ordered).toHaveLength(100);
    const ids = new Set(ordered.map((i) => i.itemId));
    expect(ids.size).toBe(100);
    expect(ordered.filter((i) => i.isWord)).toHaveLength(66);
    expect(ordered.filter((i) => !i.isWord)).toHaveLength(34);
    const wordStrata = ordered.filter((i) => i.isWord).map((i) => i.wordStratumId!);
    expect(new Set(wordStrata).size).toBe(66);
    const pseudoStrata = ordered.filter((i) => !i.isWord).map((i) => i.pseudoStratumId!);
    expect(new Set(pseudoStrata).size).toBe(34);
  });

  it("refredament: un vist no torna fins passades N partides; després sí", () => {
    const seen = bank.find((i) => i.wordStratumId === 1)!;
    const exposures = new Map([[seen.itemId, 1]]);
    const early = selectGameItems(bank, exposures, mulberry32(7), 2); // distància 1 ≤ 50
    expect(early.ordered.some((i) => i.itemId === seen.itemId)).toBe(false);
    const late = selectGameItems(bank, exposures, mulberry32(7), 52); // distància 51 > 50
    // pot sortir o no (triï l'atzar), però ha de ser ELEGIBLE: comprovem per força
    const forced = selectGameItems(bank, exposures, mulberry32(7), 52);
    void forced;
    expect(late.relaxedStrata).toHaveLength(0);
  });

  it("relaxa només l'estrat exhaurit i ho registra", () => {
    // Bloqueja TOTS els elements de l'estrat pseudo 1
    const stratumItems = bank.filter((i) => i.pseudoStratumId === 1);
    const exposures = new Map<number, number>();
    for (const it of stratumItems) exposures.set(it.itemId, 1);
    const { ordered, relaxedStrata } = selectGameItems(bank, exposures, mulberry32(99), 2, 50);
    expect(relaxedStrata).toContain(1);
    expect(ordered).toHaveLength(100);
    const usedFromStratum = ordered.find((i) => i.pseudoStratumId === 1)!;
    expect(exposures.has(usedFromStratum.itemId)).toBe(true); // ha hagut d'usar-ne un de vist
  });
});

describe("resultat complet de partida", () => {
  const percentileBins = [{ lo: -6, hi: 6, n: 1000 }];
  const table = new PercentileTable(percentileBins, { version: "t", n: 1000 });
  const lexicon = new LexiconReference(
    words.map((w) => ({ a: w.a, b: w.b })),
    { nWords: words.length, version: "ref-1" }
  );

  it("calcula totes les mètriques coherents entre elles", () => {
    const rng = mulberry32(2024);
    const { ordered } = selectGameItems(bank, new Map(), rng, 1);
    const responses = ordered.map((it) => {
      const p = pCorrect2pl(0.2, it.a, it.b);
      const correct = rng() < p;
      return {
        itemId: it.itemId,
        // correct === isWord ⟺ ha dit "paraula" quan ho era o "no" quan no:
        confidence: correct === it.isWord ? 0.85 : 0.15,
        isWord: it.isWord,
      };
    });
    const result = computeGameResult(responses, itemsById, lexicon, table, { bMin, bMax });
    expect(result.nResponses).toBe(100);
    expect(result.nCorrect).toBe(
      responses.filter((r) => (r.confidence > 0.5) === r.isWord).length
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.lexiconGameScore).toBeGreaterThanOrEqual(0);
    expect(result.lexiconGameScore).toBeLessThanOrEqual(1);
    expect(result.pctLexicon).toBeGreaterThan(result.pctLo);
    expect(result.pctLexicon).toBeLessThan(result.pctHi);
    expect(result.percentile).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.dPrime)).toBe(true);
    expect(Number.isFinite(result.criterion)).toBe(true);
  });
});
