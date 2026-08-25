import { describe, expect, it } from "vitest";
import { MAPA_ZONES, MAPA_FAST_START_WORDS } from "@/lib/config";
import { nextZoneThreshold, zoneThresholds, zonesEarned } from "@/lib/mapa/thresholds";
import { REGIONS, REGION_IDS, isRegionId } from "@/lib/mapa/catalog";

const N_WORDS = 40777; // banc vigent (2026.08): paraules reals

describe("zoneThresholds", () => {
  const t = zoneThresholds(N_WORDS);

  it("genera un llindar per zona", () => {
    expect(t).toHaveLength(MAPA_ZONES);
  });

  it("és monòton estrictament creixent", () => {
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });

  it("inici ràpid: les tres primeres zones tenen el llindar fix decidit", () => {
    MAPA_FAST_START_WORDS.forEach((w, i) => expect(t[i]).toBe(w));
    expect(t[MAPA_ZONES - 1]).toBe(N_WORDS);
  });

  it("la primera zona cau en acabar la PRIMERA partida (66 paraules)", () => {
    const wordsPerGame = 66;
    expect(zonesEarned(wordsPerGame, t)).toBe(1);
    expect(zonesEarned(wordsPerGame - 1, t)).toBe(0);
  });

  it("tres recompenses ràpides dins de les primeres quatre partides", () => {
    const wordsPerGame = 66;
    expect(zonesEarned(4 * wordsPerGame, t)).toBeGreaterThanOrEqual(3);
  });

  it("després de l'inici ràpid torna al ritme científic (~1% del banc per zona)", () => {
    const tail = t.slice(MAPA_FAST_START_WORDS.length);
    const gaps = tail.slice(1).map((x, i) => x - tail[i]);
    const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    expect(meanGap).toBeGreaterThan(380); // ≈408 paraules
    expect(meanGap).toBeLessThan(440);
  });

  it("la divisió fixa NO tancaria el mapa: la interpolació sí", () => {
    // Amb divisió fixa l'últim llindar quedaria per sota del total.
    const perZone = Math.floor(N_WORDS / MAPA_ZONES); // 408
    expect(perZone * MAPA_ZONES).toBeLessThan(N_WORDS);
    expect(t[MAPA_ZONES - 1]).toBe(N_WORDS);
  });
});

describe("zoneThresholds · banc petit (fallback lineal)", () => {
  const N_SMALL = 500;
  const t = zoneThresholds(N_SMALL);

  it("manté 100 llindars estricte creixents amb l'últim a nWords", () => {
    expect(t).toHaveLength(MAPA_ZONES);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(t[MAPA_ZONES - 1]).toBe(N_SMALL);
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
