// Catàleg de les 100 unitats del mapa (còpia versionada de
// scripts/mapa-src/regions-100.json, que al seu temps vé del paquet
// cartogràfic Mapa/). El script build-compact-map.ts valida que les dues
// còpies no divergeixin.

import catalogJson from "./regions-100.json";

export interface RegionInfo {
  id: string;
  name: string;
  territory: string;
  kind: string;
}

const raw = catalogJson as {
  count: number;
  regions: { id: string; name: string; territory: string; kind: string }[];
};

if (raw.count !== raw.regions.length || raw.count !== 100) {
  throw new Error("El catàleg de regions ha de tenir exactament 100 unitats");
}

export const REGIONS: RegionInfo[] = raw.regions.map((r) => ({
  id: r.id,
  name: r.name,
  territory: r.territory,
  kind: r.kind,
}));

export const REGION_IDS: ReadonlySet<string> = new Set(REGIONS.map((r) => r.id));

export function isRegionId(id: unknown): id is string {
  return typeof id === "string" && REGION_IDS.has(id);
}

export function regionInfo(id: string): RegionInfo | null {
  return REGIONS.find((r) => r.id === id) ?? null;
}
