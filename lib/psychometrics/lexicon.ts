// Percentatge del lexicó sobre el CONJUNT DE REFERÈNCIA congelat.
// V(θ) = Σ P_i(θ) per a totes les paraules de referència (40.773 a ref-1).
// L'interval es mapa directe: V és monòtona creixent en θ.

export interface ReferenceBankMeta {
  nWords: number;
  version: string;
}

/**
 * Banc de referència en typed arrays per calcular V(θ) ràpid
 * (40k+ evaluacions logístiques per crida).
 */
export class LexiconReference {
  readonly a: Float64Array;
  readonly b: Float64Array;
  readonly nWords: number;
  readonly version: string;

  constructor(items: { a: number; b: number }[], meta: ReferenceBankMeta) {
    if (items.length !== meta.nWords) {
      throw new Error(
        `El banc de referència té ${items.length} ítems però el denominador diu ${meta.nWords}`
      );
    }
    this.a = Float64Array.from(items.map((i) => i.a));
    this.b = Float64Array.from(items.map((i) => i.b));
    this.nWords = meta.nWords;
    this.version = meta.version;
  }

  /** V(θ): nombre esperat de paraules del conjunt de referència que la persona coneixeria. */
  v(theta: number): number {
    const { a, b } = this;
    const len = a.length;
    let s = 0;
    for (let i = 0; i < len; i++) s += 1 / (1 + Math.exp(-(a[i] * (theta - b[i]))));
    return s;
  }

  /** Percentatge del lexicó puntual i extrems de l'IC95 mapant θ ± 1,96·SE_total. */
  pctWithInterval(theta: number, seTotal: number): { pct: number; lo: number; hi: number } {
    const z = 1.959963984540054;
    return {
      pct: (100 * this.v(theta)) / this.nWords,
      lo: (100 * this.v(theta - z * seTotal)) / this.nWords,
      hi: (100 * this.v(theta + z * seTotal)) / this.nWords,
    };
  }
}

