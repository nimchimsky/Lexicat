import { describe, expect, it } from "vitest";
import { MAPA_ZONES } from "@/lib/config";
import { nextZoneThreshold, zoneThresholds, zonesEarned } from "@/lib/mapa/thresholds";
import { REGIONS, REGION_IDS, isRegionId } from "@/lib/mapa/catalog";

const N_WORDS = 40777; // banc vigent (2026.08): paraules reals

describe("zoneThresholds", () => {
  const t = zoneThresholds(N_WORDS);

  it("genera un llindar per zona", () => {
    expect(t).toHaveLength(MAPA_ZONES);
  });

  it("és monòton creixent", () => {
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });

  it("la primera zona cau a l'1% del banc i l'última a l'última paraula", () => {
    expect(t[0]).toBe(Math.round(N_WORDS / MAPA_ZONES)); // 408
    expect(t[MAPA_ZONES - 1]).toBe(N_WORDS);
  });

  it("la divisió fixa NO tancaria el mapa (motiu del round)", () => {
    const perZone = Math.floor(N_WORDS / MAPA_ZONES); // 408
    expect(perZone * MAPA_ZONES).toBeLessThan(N_WORDS);
    expect(t[MAPA_ZONES - 1]).toBe(perZone * (MAPA_ZONES - 1) + (N_WORDS - perZone * 99));
  });
});

describe("zonesEarned / nextZoneThreshold", () => {
  const t = zoneThresholds(N_WORDS);

  it("sense paraules no hi ha zones", () => {
    expect(zonesEarned(0, t)).toBe(0);
    expect(nextZoneThreshold(0, t)).toBe(t[0]);
  });

  it("el llindar exacte guanya la zona", () => {
    expect(zonesEarned(t[0], t)).toBe(1);
    expect(zonesEarned(t[0] - 1, t)).toBe(0);
  });

  it("amb tot el banc, les 100 zones i cap de propera", () => {
    expect(zonesEarned(N_WORDS, t)).toBe(MAPA_ZONES);
    expect(nextZoneThreshold(N_WORDS, t)).toBeNull();
    expect(zonesEarned(N_WORDS - 1, t)).toBe(MAPA_ZONES - 1);
  });

  it("el progrés avança a un ritme d'una zona per ~6-7 partides", () => {
    const wordsPerGame = 66;
    const at7Games = zonesEarned(7 * wordsPerGame, t);
    expect(at7Games).toBeGreaterThanOrEqual(1);
    expect(zonesEarned(6 * wordsPerGame, t)).toBeLessThanOrEqual(at7Games);
  });
});

describe("catàleg de regions", () => {
  it("té exactament 100 ids únics amb el format territori--slug", () => {
    expect(REGIONS).toHaveLength(100);
    expect(REGION_IDS.size).toBe(100);
    for (const r of REGIONS) {
      expect(r.id).toMatch(/^[a-z]+(-[a-z]+)*--[a-z0-9-]+$/);
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.territory.length).toBeGreaterThan(0);
      expect(r.kind.length).toBeGreaterThan(0);
    }
  });

  it("isRegionId només accepta ids del catàleg", () => {
    expect(isRegionId("catalunya--alt-camp")).toBe(true);
    expect(isRegionId("carxe--carxe")).toBe(true);
    expect(isRegionId("catalunya--no-existeix")).toBe(false);
    expect(isRegionId(42)).toBe(false);
    expect(isRegionId(null)).toBe(false);
  });
});

