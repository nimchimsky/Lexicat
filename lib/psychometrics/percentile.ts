// Percentil de θ contra la distribució poblacional de l'estudi de referència
// (theta_distribution.csv, n = 483.548). Taula VERSIONADA, no constant al codi.

import { clamp } from "./math";

export interface ThetaBin {
  lo: number;
  hi: number;
  n: number;
}

export interface PopulationMeta {
  version: string;
  n: number;
}

/**
 * CDF discreta per bins uniformes en amplada. Interpolació lineal dins del bin;
 * el percentil és la fracció acumulada de la població PER SOTA de θ.
 */
export class PercentileTable {
  readonly bins: ThetaBin[];
  readonly meta: PopulationMeta;
  private readonly cumulativeBelow: number[]; // n acumulat abans del bin i

  constructor(bins: ThetaBin[], meta: PopulationMeta) {
    if (bins.length === 0) throw new Error("Taula de percentils buida");
    // Ordenats i sense solapament
    const sorted = [...bins].sort((x, y) => x.lo - y.lo);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].lo < sorted[i - 1].hi - 1e-9) {
        throw new Error("Bins de la població solapats o desordenats");
      }
    }
    this.bins = sorted;
    this.meta = meta;
    let acc = 0;
    this.cumulativeBelow = sorted.map((bin) => {
      const v = acc;
      acc += bin.n;
      return v;
    });
    const total = this.bins.reduce((s, b) => s + b.n, 0);
    if (Math.abs(total - meta.n) > 0.001 * meta.n) {
      throw new Error(`La suma dels bins (${total}) no quadra amb n=${meta.n}`);
    }
  }

  /** Percentil de θ ∈ (−∞, ∞), retallat a [0.01, 99.99] per presentació honesta. */
  percentileOf(theta: number): number {
    const first = this.bins[0];
    const last = this.bins[this.bins.length - 1];
    if (theta <= first.lo) return 0.01;
    if (theta >= last.hi) return 99.99;

    // Localitza el bin (amplada uniforme assumida per indexació directa, amb cerca si cal)
    let idx = -1;
    if (this.uniformWidth !== null) {
      const w = this.uniformWidth;
      idx = Math.min(this.bins.length - 1, Math.max(0, Math.floor((theta - first.lo) / w)));
      while (idx > 0 && theta < this.bins[idx].lo) idx--;
      while (idx < this.bins.length - 1 && theta >= this.bins[idx].hi) idx++;
    } else {
      idx = this.bins.findIndex((b) => theta >= b.lo && theta < b.hi);
      if (idx === -1) idx = this.bins.length - 1;
    }

    const bin = this.bins[idx];
    const frac = bin.n > 0 ? clamp((theta - bin.lo) / (bin.hi - bin.lo), 0, 1) : 0;
    const below = this.cumulativeBelow[idx];
    const pct = ((below + frac * bin.n) / this.meta.n) * 100;
    return clamp(pct, 0.01, 99.99);
  }

  private get uniformWidth(): number | null {
    const w = this.bins[0].hi - this.bins[0].lo;
    const uniform = this.bins.every((b) => Math.abs(b.hi - b.lo - w) < 1e-9);
    return uniform ? w : null;
  }
}
