import { describe, expect, it } from "vitest";
import {
  confidenceToCategory,
  estimateGradedAbility,
  GRID_CATEGORIES,
  LIKELIHOOD_SCALE,
} from "../lib/psychometrics/graded";
import { estimateAbility } from "../lib/psychometrics/irt";
import { buildBankFromCsvText, loadBankCsvText, type BankItem } from "../lib/bank/loadCsv";
import { selectGameItems, mulberry32 } from "../lib/game/selection";

const bank: BankItem[] = buildBankFromCsvText(loadBankCsvText()).items;
const itemsParams = bank.map((i) => ({ itemId: i.itemId, a: i.a, b: i.b, isWord: i.isWord }));

// Els mateixos llindars i escala que el model: per simular EXACTAMENT del
// generador que l'estimador assumeix.
const TAU: number[] = Array.from(
  { length: GRID_CATEGORIES - 1 },
  (_, k) => Math.log(((k + 1) / GRID_CATEGORIES) / (1 - (k + 1) / GRID_CATEGORIES))
);

/** Partida sintètica generada DEL MATEIX model graduat. La categoria es
 *  declara sobre la confiança DIRECCIONAL cap a la resposta correcta:
 *  P(cat ≥ k) = f((a·(θ−b) − c − τ_k)/s); després es torna al format crua
 *  (per a pseudoparaules, el complementari). */
function simulateGradedGame(theta: number, c: number, seed: number) {
  const rng = mulberry32(seed);
  const exposures = new Map<number, number>();
  const { ordered } = selectGameItems(bank, exposures, rng, 1);
  return ordered.map((it) => {
    const eta = it.a * (theta - it.b) - c;
    let cat = GRID_CATEGORIES - 1;
    const u = rng();
    while (
      cat > 0 &&
      u > 1 / (1 + Math.exp(-((eta - TAU[cat - 1]) / LIKELIHOOD_SCALE)))
    ) {
      cat--;
    }
    // Centre de la categoria: el mapeig confidenceToCategory la recupera exacta.
    const directional = (cat + 0.5) / GRID_CATEGORIES;
    return {
      itemId: it.itemId,
      confidence: it.isWord ? directional : 1 - directional,
      isWord: it.isWord,
    };
  });
}

describe("graella de categories", () => {
  it("mapeja [0,1] a enters 0..C−1 sense forats", () => {
    expect(confidenceToCategory(0)).toBe(0);
    expect(confidenceToCategory(1)).toBe(GRID_CATEGORIES - 1);
    expect(confidenceToCategory(0.5)).toBe(Math.floor(0.5 * GRID_CATEGORIES));
    for (let k = 0; k <= 20; k++) {
      const g = confidenceToCategory(k / 20);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(GRID_CATEGORIES - 1);
    }
  });
  it("rebutja confiances impossibles", () => {
    expect(() => confidenceToCategory(-0.1)).toThrow(RangeError);
    expect(() => confidenceToCategory(1.1)).toThrow(RangeError);
    expect(() => confidenceToCategory(NaN)).toThrow(RangeError);
  });
});

describe("estimació graduada MAP", () => {
  it("sense respostes torna el prior", () => {
    const est = estimateGradedAbility([], itemsParams);
    expect(est.theta).toBe(0);
    expect(est.se).toBeCloseTo(0.624, 3);
    expect(est.nResponses).toBe(0);
  });

  it("recupera θ per damunt/del davall del prior amb partides sintètiques", () => {
    const strong = estimateGradedAbility(simulateGradedGame(1.2, 0, 101), itemsParams);
    const weak = estimateGradedAbility(simulateGradedGame(-1.2, 0, 202), itemsParams);
    expect(strong.theta).toBeGreaterThan(0.5);
    expect(weak.theta).toBeLessThan(-0.5);
    expect(strong.se).toBeLessThan(0.624);
    expect(weak.se).toBeLessThan(0.624);
  });

  it("l'ús de l'escala (c) es separa de θ: dos jugadors equivalents amb escales diferents tenen θ semblant", () => {
    // Mateixa habilitat latenta; el conservador fa servir l'escala cap avall.
    const neutral = estimateGradedAbility(simulateGradedGame(0.6, 0, 303), itemsParams);
    const conservative = estimateGradedAbility(simulateGradedGame(0.6, 1.2, 304), itemsParams);
    // El criteri captura el desplaçament d'escala…
    expect(conservative.criterionShift).toBeGreaterThan(0.4);
    expect(neutral.criterionShift).toBeLessThan(conservative.criterionShift);
    // …i θ queda pràcticament intacte (una binarització crua s'enfonsaria).
    expect(Math.abs(neutral.theta - conservative.theta)).toBeLessThan(0.35);
  });

  it("ordenar jugadors pel graduat concorda amb l'ordre veritable", () => {
    const thetas = [-1, -0.4, 0.2, 0.9];
    const ests = thetas.map((t, i) => estimateGradedAbility(simulateGradedGame(t, 0, 400 + i), itemsParams));
    const sorted = [...ests].sort((a, b) => a.theta - b.theta).map((e) => e.theta);
    expect(sorted).toEqual(ests.map((e) => e.theta));
    for (let k = 1; k < ests.length; k++) {
      expect(ests[k].theta).toBeGreaterThan(ests[k - 1].theta);
    }
  });

  it("entra per la interfície estimateAbility amb model='graded_2pl_map'", () => {
    const responses = simulateGradedGame(0.5, 0, 505);
    const viaInterface = estimateAbility(responses, itemsParams, "graded_2pl_map");
    const direct = estimateGradedAbility(responses, itemsParams);
    expect(viaInterface.theta).toBe(direct.theta);
    expect(viaInterface.model).toBe("graded_2pl_map");
  });
});
