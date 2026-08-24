// Regles del mode Kilian (ki-1): corba de punts, multiplicador, ratxes i
// agregació. Tot és pur: no toca base de dades.

import { describe, expect, it } from "vitest";
import {
  currentStreak,
  computeKillianResult,
  kilianBasePoints,
  kilianHitPoints,
  kilianMultiplier,
} from "../lib/game/kilian";
import { KILIAN_BAR_MS, KILIAN_MULTIPLIER_CAP } from "../lib/config";

describe("punts base: la barra ÉS la puntuació", () => {
  it("100 a l'instant, 80 al segon (regla del Roger), 0 en expirar", () => {
    expect(kilianBasePoints(0)).toBe(100);
    expect(kilianBasePoints(500)).toBe(90);
    expect(kilianBasePoints(1000)).toBe(80);
    expect(kilianBasePoints(2500)).toBe(50);
    expect(kilianBasePoints(KILIAN_BAR_MS)).toBe(0);
    expect(kilianBasePoints(9000)).toBe(0); // per sobre de la barra mai negatiu
  });

  it("arrodoneix a múltiples de 5 per llegir-se de cop", () => {
    for (const ms of [123, 456, 789, 1011, 2345]) {
      expect(kilianBasePoints(ms) % 5).toBe(0);
    }
  });
});

describe("multiplicador per graons amb creixement lent a partir de 25", () => {
  it("grapons aprovats: ×1 fins a 4, ×1,2 a 5… ×1,8 a 20–24, ×2 a 25", () => {
    expect(kilianMultiplier(1)).toBe(1);
    expect(kilianMultiplier(4)).toBe(1);
    expect(kilianMultiplier(5)).toBeCloseTo(1.2);
    expect(kilianMultiplier(9)).toBeCloseTo(1.2);
    expect(kilianMultiplier(10)).toBeCloseTo(1.4);
    expect(kilianMultiplier(14)).toBeCloseTo(1.4);
    expect(kilianMultiplier(15)).toBeCloseTo(1.6);
    expect(kilianMultiplier(19)).toBeCloseTo(1.6);
    expect(kilianMultiplier(20)).toBeCloseTo(1.8);
    expect(kilianMultiplier(24)).toBeCloseTo(1.8);
    expect(kilianMultiplier(25)).toBeCloseTo(2);
    expect(kilianMultiplier(34)).toBeCloseTo(2);
  });

  it("a partir de 25 puja +0,1 cada 10 encerts i arriba a ×2,7 amb ratxa perfecta", () => {
    expect(kilianMultiplier(35)).toBeCloseTo(2.1);
    expect(kilianMultiplier(44)).toBeCloseTo(2.1);
    expect(kilianMultiplier(45)).toBeCloseTo(2.2);
    expect(kilianMultiplier(65)).toBeCloseTo(2.4);
    expect(kilianMultiplier(95)).toBeCloseTo(2.7);
    expect(kilianMultiplier(100)).toBeCloseTo(2.7);
  });

  it("el sostre ×3 és inabastable dins una partida però fixa el límit", () => {
    expect(kilianMultiplier(125)).toBe(KILIAN_MULTIPLIER_CAP);
    for (let s = 0; s <= 100; s++) {
      expect(kilianMultiplier(s)).toBeLessThanOrEqual(KILIAN_MULTIPLIER_CAP);
      expect(kilianMultiplier(s)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("ratxa", () => {
  it("compta encerts consecutius i un timeout trenca com un error", () => {
    const ok = { isCorrect: true, kind: "answer" as const };
    expect(currentStreak([ok, ok, ok])).toBe(3);
    expect(currentStreak([ok, ok, { isCorrect: false, kind: "answer" }, ok])).toBe(1);
    expect(currentStreak([ok, ok, { isCorrect: true, kind: "timeout" }])).toBe(0);
    expect(currentStreak([])).toBe(0);
  });
});

describe("punts totals d'un encert", () => {
  it("base × multiplicador, arrodonit a 5", () => {
    // instantani amb ratxa de 10 → 100 × 1,4 = 140
    expect(kilianHitPoints(0, 10)).toBe(140);
    // 1 s amb ratxa de 7 → 80 × 1,2 = 96 → arrodonit a 95
    expect(kilianHitPoints(1000, 7)).toBe(95);
    // sense ratxa mai passa de la base
    expect(kilianHitPoints(2000, 3)).toBe(60);
  });
});

describe("agregació d'una partida sencera", () => {
  function row(isCorrect: boolean, kind: "answer" | "timeout" = "answer") {
    return { isCorrect, kind };
  }

  it("compta FA, omissions i timeouts per separat; els errors no puntuen", () => {
    const rows = [
      { ...row(true), isWord: true, points: 100 },
      { ...row(true), isWord: false, points: 90 },
      { ...row(false), isWord: false }, // falsa alarma
      { ...row(false), isWord: true }, // omissió
      { ...row(false, "timeout"), isWord: true },
      { ...row(true), isWord: true, points: 110 },
    ];
    const r = computeKillianResult(rows as Parameters<typeof computeKillianResult>[0]);
    expect(r.nResponses).toBe(6);
    expect(r.nCorrect).toBe(3);
    expect(r.nFalseAlarms).toBe(1);
    expect(r.nMisses).toBe(1);
    expect(r.nTimeouts).toBe(1);
    expect(r.score).toBe(300);
  });

  it("la millor ratxa i el multiplicador màxim surten del recorregut", () => {
    const rows = [];
    for (let i = 0; i < 12; i++) rows.push({ ...row(true), isWord: true, points: 100 });
    rows.push(row(false));
    for (let i = 0; i < 3; i++) rows.push({ ...row(true), isWord: true, points: 50 });
    const r = computeKillianResult(rows as Parameters<typeof computeKillianResult>[0]);
    expect(r.bestStreak).toBe(12);
    expect(r.maxMultiplier).toBeCloseTo(1.4);
  });

  it("un encert massa ràpid compta com a encert però no construeix ratxa ni punts", () => {
    const rows = [
      { ...row(true), isWord: true, points: 100 },
      { ...row(true), isWord: true, tooFast: true }, // encert <200 ms
      { ...row(true), isWord: true, points: 80 },
    ];
    const r = computeKillianResult(rows as Parameters<typeof computeKillianResult>[0]);
    expect(r.nCorrect).toBe(3); // el judici era correcte als tres
    expect(r.score).toBe(180); // el massa ràpid no puntua
    expect(r.bestStreak).toBe(1); // i no pot ressuscitar mai la ratxa
    expect(r.maxMultiplier).toBeCloseTo(1);
  });

  it("una partida perfecta instantània fa ~21.000 punts (sostre teòric ki-1)", () => {
    let score = 0;
    const rows = [];
    for (let s = 1; s <= 100; s++) {
      const pts = kilianHitPoints(0, s);
      score += pts;
      rows.push({ ...row(true), isWord: true, points: pts });
    }
    const r = computeKillianResult(rows as Parameters<typeof computeKillianResult>[0]);
    expect(r.score).toBe(score);
    expect(score).toBeGreaterThan(20000);
    expect(score).toBeLessThan(22500);
    expect(r.maxMultiplier).toBeCloseTo(2.7);
  });
});
