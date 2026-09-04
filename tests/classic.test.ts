import { describe, expect, it } from "vitest";
import { classicScore } from "../lib/game/classic";

describe("mode Clàssic · puntuació cl-1", () => {
  it("dona 100 a una partida perfecta i 0 a una completament invertida", () => {
    expect(classicScore(66, 0)).toBe(100);
    expect(classicScore(0, 34)).toBe(0);
  });

  it("equilibra paraules i pseudoparaules malgrat la composició 66/34", () => {
    expect(classicScore(33, 17)).toBe(50);
    expect(classicScore(66, 34)).toBe(50);
    expect(classicScore(0, 0)).toBe(50);
  });

  it("només millora amb més encerts o menys falses alarmes", () => {
    // La sortida és un enter: un sol ítem pot quedar al mateix arrodoniment,
    // però dos canvis sempre fan visible la millora en aquesta composició.
    expect(classicScore(42, 8)).toBeGreaterThan(classicScore(40, 8));
    expect(classicScore(40, 6)).toBeGreaterThan(classicScore(40, 8));
  });

  it("rebutja recomptes impossibles", () => {
    expect(() => classicScore(67, 0)).toThrow();
    expect(() => classicScore(20, -1)).toThrow();
    expect(() => classicScore(0, 0, 0, 34)).toThrow();
    expect(() => classicScore(0, 0, 66, 34.5)).toThrow();
  });
});
