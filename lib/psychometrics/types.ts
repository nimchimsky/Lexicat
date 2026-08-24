// Tipus compartits del mòdul psicomètric. Sense dependències de DB ni de React.

export interface ItemParams {
  itemId: number;
  /** Discriminació 2PL. */
  a: number;
  /** Dificultat 2PL. */
  b: number;
  isWord: boolean;
}

/** Resposta binaritzable: només cal la confiança declarada i la naturalesa de l'ítem. */
export interface GraduatedResponse {
  itemId: number;
  /** Probabilitat declarada que l'estímul és una paraula real, a [0,1]. */
  confidence: number;
  isWord: boolean;
}

export type EstimationModel =
  | "binary_2pl_map" // l'únic implementat; el graduat entrarà com a "graded_2pl_..." quan hi hagi calibratge
  | (string & {});

export interface AbilityEstimate {
  theta: number;
  se: number;
  model: EstimationModel;
  nResponses: number;
}

