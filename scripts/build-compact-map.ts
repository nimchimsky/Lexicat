// Generador del MAPA COMPACTE dels Països Catalans a partir del paquet
// cartogràfic (scripts/mapa-src/svg-paths-100.json).
//
// La geografia real deixa el continent petit al mòbil i l'Alguer perdut a
// Sardenya. Aquest script produeix una SEGONA variant amb el mateix contracte
// DOM (100 <g class="lexic-region"> amb els mateixos id/data-*), però amb:
//
//   · el continent escalat per omplir el marc,
//   · les Illes Balears en un quadre-inset a sota a la dreta,
//   · l'Alguer i el Carxe en medallons etiquetats a sota a l'esquerra.
//
// Cap geometria es toca: només transforms afegits. Sortida determinista:
//   public/mapa/paisos-catalans-100.compact.svg
//
// Ús: npx tsx scripts/build-compact-map.ts

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface Shape {
  d: string;
  transform: string | null;
}
interface RegionPaths {
  id: string;
  name: string;
  territory: string;
  shapes: Shape[];
}
interface PathsFile {
  viewBox: [number, number, number, number];
  regions: RegionPaths[];
}

const SRC = path.join(__dirname, "mapa-src", "svg-paths-100.json");
const SRC_CATALOG = path.join(__dirname, "mapa-src", "regions-100.json");
const OUT = path.join(__dirname, "..", "public", "mapa", "paisos-catalans-100.compact.svg");

let KIND_BY_ID: Map<string, string> | null = null;

/** El «kind» real de cada unitat ve del catàleg (regions-100.json). */
function kindOf(id: string): string {
  if (!KIND_BY_ID) {
    const cat: { regions: { id: string; kind: string }[] } = JSON.parse(readFileSync(SRC_CATALOG, "utf8"));
    KIND_BY_ID = new Map(cat.regions.map((r) => [r.id, r.kind]));
  }
  return KIND_BY_ID.get(id) ?? "";
}

/** Regions que surten del continent i van a insets/medallons. */
const INSET_PREFIXES = ["illes-balears--", "alguer--", "carxe--"];
const isInset = (id: string) => INSET_PREFIXES.some((p) => id.startsWith(p));

// ---------------------------------------------------------------------------
// Path bbox aproximat. Els d del paquet usen M L H V C S Z (abs/rel). Per al
// layout n'hi ha prou amb els punts de control inclosos (lleu sobreestimació).
// ---------------------------------------------------------------------------

function pathBBox(d: string): { minX: number; minY: number; maxX: number; maxY: number } {
  const tokens = d.match(/[MmLlHhVvCcSsZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) throw new Error("path sense tokens");
  let i = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let px = NaN; // segon punt de control anterior (per a S/s)
  let py = NaN;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const num = (): number => {
    const t = tokens[i++];
    if (t === undefined || /[A-Za-z]/.test(t)) throw new Error(`número esperat, trobat «${t}»`);
    return parseFloat(t);
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[A-Za-z]/.test(t)) {
      cmd = t;
      i++;
      if (cmd === "Z" || cmd === "z") {
        cx = sx;
        cy = sy;
        continue;
      }
    } else if (!cmd) throw new Error("coordenades sense comanda inicial");
    switch (cmd) {
      case "M":
      case "L": {
        cx = num();
        cy = num();
        add(cx, cy);
        if (cmd === "M") {
          sx = cx;
          sy = cy;
          cmd = "L"; // parells implícits després de M
        }
        break;
      }
      case "m":
      case "l": {
        cx += num();
        cy += num();
        add(cx, cy);
        if (cmd === "m") {
          sx = cx;
          sy = cy;
          cmd = "l";
        }
        break;
      }
      case "H":
        cx = num();
        add(cx, cy);
        break;
      case "h":
        cx += num();
        add(cx, cy);
        break;
      case "V":
        cy = num();
        add(cx, cy);
        break;
      case "v":
        cy += num();
        add(cx, cy);
        break;
      case "C": {
        const x1 = num();
        const y1 = num();
        const x2 = num();
        const y2 = num();
        cx = num();
        cy = num();
        add(x1, y1);
        add(x2, y2);
        add(cx, cy);
        px = x2;
        py = y2;
        break;
      }
      case "c": {
        const x1 = cx + num();
        const y1 = cy + num();
        const x2 = cx + num();
        const y2 = cy + num();
        cx += num();
        cy += num();
        add(x1, y1);
        add(x2, y2);
        add(cx, cy);
        px = x2;
        py = y2;
        break;
      }
      case "S": {
        const x1 = Number.isNaN(px) ? cx : 2 * cx - px;
        const y1 = Number.isNaN(py) ? cy : 2 * cy - py;
        const x2 = num();
        const y2 = num();
        cx = num();
        cy = num();
        add(x1, y1);
        add(x2, y2);
        add(cx, cy);
        px = x2;
        py = y2;
        break;
      }
      case "s": {
        const x1 = Number.isNaN(px) ? cx : 2 * cx - px;
        const y1 = Number.isNaN(py) ? cy : 2 * cy - py;
        const x2 = cx + num();
        const y2 = cy + num();
        cx += num();
        cy += num();
        add(x1, y1);
        add(x2, y2);
        add(cx, cy);
        px = x2;
        py = y2;
        break;
      }
      default:
        throw new Error(`comanda no suportada: ${cmd}`);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Col·locament en coordenades ja transformades pel transform font de cada path. */
type Matrix = [number, number, number, number, number, number]; // a b c d e f

function parseMatrix(s: string | null): Matrix {
  if (!s) return [1, 0, 0, 1, 0, 0];
  const m = s.match(/matrix\(([^)]+)\)/);
  if (!m) throw new Error(`transform no suportada: ${s}`);
  const v = m[1].trim().split(/[\s,]+/).map(Number);
  if (v.length !== 6 || v.some((n) => !Number.isFinite(n))) throw new Error(`matrix invàlida: ${s}`);
  return [v[0], v[1], v[2], v[3], v[4], v[5]];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function matrixAttr(m: Matrix): string {
  const r = (n: number) => Number(n.toFixed(3));
  return `matrix(${r(m[0])} ${r(m[1])} ${r(m[2])} ${r(m[3])} ${r(m[4])} ${r(m[5])})`;
}

// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Redueix la precisió dels números del path data (l'equivalent d'un passat
 * d'SVGO amb floatPrecision: 1). El viewBox és ~3121×5016: les coordenades
 * del paquet porten 3 decimals — mil vegades més fina que un píxel. Un
 * decimal manté el mapa visualment idèntic i treu més de la meitat del pes.
 */
function roundPathPrecision(d: string, digits = 1): string {
  return d.replace(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g, (num) => {
    const rounded = Number(num).toFixed(digits);
    // "10" queda "10"; "12.0" → "12"; "0.30" → "0.3"
    if (!rounded.includes(".")) return rounded;
    return rounded.replace(/0+$/, "").replace(/\.$/, "");
  });
}

interface Placement {
  region: RegionPaths;
  matrix: Matrix;
}

export function buildCompactSvg(): string {
  const file: PathsFile = JSON.parse(readFileSync(SRC, "utf8"));
  if (file.regions.length !== 100) throw new Error(`esperava 100 regions, hi ha ${file.regions.length}`);

  // 1) Bbox de cada regió en coordenades finals del mapa mare.
  const bbox = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (const r of file.regions) {
    let bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const s of r.shapes) {
      const p = pathBBox(s.d);
      const m = parseMatrix(s.transform);
      for (const [x, y] of [
        [p.minX, p.minY],
        [p.maxX, p.maxY],
      ] as const) {
        const [tx, ty] = apply(m, x, y);
        bb = {
          minX: Math.min(bb.minX, tx),
          minY: Math.min(bb.minY, ty),
          maxX: Math.max(bb.maxX, tx),
          maxY: Math.max(bb.maxY, ty),
        };
      }
    }
    if (!Number.isFinite(bb.minX)) throw new Error(`bbox buida: ${r.id}`);
    bbox.set(r.id, bb);
  }

  // 2) Continent: tot llevat dels insets.
  const mainland = file.regions.filter((r) => !isInset(r.id));
  const mlBb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of mainland) {
    const b = bbox.get(r.id)!;
    mlBb.minX = Math.min(mlBb.minX, b.minX);
    mlBb.minY = Math.min(mlBb.minY, b.minY);
    mlBb.maxX = Math.max(mlBb.maxX, b.maxX);
    mlBb.maxY = Math.max(mlBb.maxY, b.maxY);
  }

  const M = 70; // marge interior
  const MAIN_W = 2980; // amplada objectiu del continent
  const kMain = MAIN_W / (mlBb.maxX - mlBb.minX);
  const mainW = (mlBb.maxX - mlBb.minX) * kMain;
  const mainH = (mlBb.maxY - mlBb.minY) * kMain;

  // 3) Franja inferior: medallons (Alguer, Carxe) + quadre de les Illes.
  const STRIP_H = 780;
  const MED_R = 250; // radi dels medallons
  const medY = mainH + M + STRIP_H / 2;
  const alguerCx = M + MED_R + 40;
  const carxeCx = alguerCx + 2 * MED_R + 120;
  const balBoxX = carxeCx + MED_R + 140;
  const balBoxW = M + mainW - balBoxX;
  const balBoxY = mainH + M + 90;
  const balBoxH = STRIP_H - 160;

  const bal = file.regions.filter((r) => r.id.startsWith("illes-balears--"));
  const balBb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of bal) {
    const b = bbox.get(r.id)!;
    balBb.minX = Math.min(balBb.minX, b.minX);
    balBb.minY = Math.min(balBb.minY, b.minY);
    balBb.maxX = Math.max(balBb.maxX, b.maxX);
    balBb.maxY = Math.max(balBb.maxY, b.maxY);
  }
  const kBal = Math.min(balBoxW / (balBb.maxX - balBb.minX), balBoxH / (balBb.maxY - balBb.minY));

  const placements: Placement[] = [];
  for (const r of mainland) {
    placements.push({
      region: r,
      matrix: [kMain, 0, 0, kMain, M - mlBb.minX * kMain, M - mlBb.minY * kMain],
    });
  }
  // Illes: escala comuna, centrades al quadre.
  {
    const tx = balBoxX + (balBoxW - (balBb.maxX - balBb.minX) * kBal) / 2 - balBb.minX * kBal;
    const ty = balBoxY + (balBoxH - (balBb.maxY - balBb.minY) * kBal) / 2 - balBb.minY * kBal;
    for (const r of bal) placements.push({ region: r, matrix: [kBal, 0, 0, kBal, tx, ty] });
  }
  // Medallons: Alguer i Carxe centrats als seus cercles.
  for (const [prefix, ccx] of [
    ["alguer--", alguerCx],
    ["carxe--", carxeCx],
  ] as const) {
    const r = file.regions.find((x) => x.id.startsWith(prefix))!;
    const b = bbox.get(r.id)!;
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    const k = (MED_R * 1.35) / Math.max(bw, bh);
    placements.push({
      region: r,
      matrix: [k, 0, 0, k, ccx - (b.minX + bw / 2) * k, medY - (b.minY + bh / 2) * k],
    });
  }

  const W = mainW + 2 * M;
  const H = mainH + M + STRIP_H + M;

  // 4) Emissió.
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" role="img" aria-labelledby="map-title map-desc" preserveAspectRatio="xMidYMid meet">`
  );
  parts.push(
    `<title id="map-title">Mapa compacte dels Països Catalans — 100 àrees de lexic.cat</title>`
  );
  parts.push(
    `<desc id="map-desc">Variant compacta amb illes i enclavaments reubicats: cent unitats territorials independents amb identificadors estables.</desc>`
  );
  parts.push(`<defs><style>
.lexic-region { cursor: pointer; fill:#151515; fill-opacity:1; stroke:#777777; }
.lexic-region .region-shape {
  fill: inherit;
  fill-opacity: inherit;
  stroke: inherit;
  stroke-width: 3.4;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
  stroke-linecap: round;
  transition: fill .14s ease, fill-opacity .14s ease, stroke .14s ease;
}
.lexic-region:hover,
.lexic-region:focus { fill:#2b2b2b; stroke:#d0d0d0; outline:none; }
.lexic-region[data-complete="true"] { fill:#d9d9d9; stroke:#ffffff; }
.mapa-frame { fill:none; stroke:#3a3a3a; stroke-width:2.5; vector-effect:non-scaling-stroke; }
.mapa-medal { fill:none; stroke:#3a3a3a; stroke-width:2.5; vector-effect:non-scaling-stroke; }
.mapa-label { fill:#8f8f8f; font-family:system-ui,sans-serif; font-size:64px; letter-spacing:.14em; text-anchor:middle; }
</style></defs>`);

  // Quadres i medallons (decoratius).
  parts.push(`<g aria-hidden="true">`);
  parts.push(
    `<rect class="mapa-frame" x="${balBoxX.toFixed(1)}" y="${balBoxY.toFixed(1)}" width="${balBoxW.toFixed(1)}" height="${balBoxH.toFixed(1)}"/>`
  );
  parts.push(
    `<text class="mapa-label" x="${(balBoxX + balBoxW / 2).toFixed(1)}" y="${(balBoxY + balBoxH + 74).toFixed(1)}">ILLES BALEARS</text>`
  );
  for (const [ccx, label] of [
    [alguerCx, "L'ALGUER"],
    [carxeCx, "EL CARXE"],
  ] as const) {
    parts.push(`<circle class="mapa-medal" cx="${ccx.toFixed(1)}" cy="${medY.toFixed(1)}" r="${MED_R}"/>`);
    parts.push(`<text class="mapa-label" x="${ccx.toFixed(1)}" y="${(medY + MED_R + 74).toFixed(1)}">${label}</text>`);
  }
  parts.push(`</g>`);

  // Les 100 unitats, amb el mateix contracte que el mapa mestre.
  // El col·locament va al <g>; cada path CONSERVA el seu transform font
  // (Lluçanès, parròquies d'Andorra i Carxe en porten un) perquè les bboxes
  // del layout ja estan calculades en coordenades post-transform.
  for (const p of placements) {
    const r = p.region;
    parts.push(
      `<g id="${esc(r.id)}" class="lexic-region" data-region-id="${esc(r.id)}" data-name="${esc(r.name)}" data-territory="${esc(r.territory)}" data-kind="${esc(kindOf(r.id))}" tabindex="0" role="button" aria-label="${esc(r.name)}" transform="${matrixAttr(p.matrix)}"><title>${esc(r.name)}</title>` +
      r.shapes
        .map(
          (s) =>
            `<path class="region-shape" d="${roundPathPrecision(s.d)}"${s.transform ? ` transform="${esc(s.transform)}"` : ""}/>`
        )
        .join("") +
        `</g>`
    );
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}

function main(): void {
  const svg = buildCompactSvg();
  writeFileSync(OUT, svg, "utf8");
  const groups = (svg.match(/class="lexic-region"/g) ?? []).length;
  console.log(`Escrit ${OUT}`);
  console.log(`Grups lexic-region: ${groups}/100`);
  if (groups !== 100) throw new Error("el contracte de 100 unitats no es compleix");
}

main();
