// d′ i criteri de resposta (SDT clàssic) amb correcció loglineal SEMPRE.
//
// Les respostes d'exactament 50% s'EXCLouen del càlcul de H i FA i es compten
// a part (nFiftyFifty). Amb 66 paraules i 34 pseudoparaules, el sostre
// observable de d′ és ≈ 4,62 (documentat a la pantalla de resultats).

import { probit } from "./math";
import { binarize } from "./irt";

export interface SdtConfidenceResponse {
  confidence: number;
  isWord: boolean;
}

export interface SdtResult {
  dPrime: number;
  criterion: number;
  hitRate: number; // corregit
  falseAlarmRate: number; // corregit
  nWords: number;
  nPseudo: number;
  nFiftyFifty: number;
}

/**
 * Correcció loglineal sempre, no només quan hi ha un zero:
 *   H  = (encerts_en_paraules + 0,5)/(n_paraules + 1)
 *   FA = (falses_alarmes + 0,5)/(n_pseudo + 1)
 * on els denominadors EXCLouen les respostes de 50% exacte.
 */
export function computeSdt(responses: SdtConfidenceResponse[]): SdtResult {
  let hits = 0;
  let falseAlarms = 0;
  let nWords = 0;
  let nPseudo = 0;
  let nFiftyFifty = 0;

  for (const r of responses) {
    if (r.confidence === 0.5) {
      nFiftyFifty++;
      continue; // fora de H i FA
    }
    const saidWord = binarize(r.confidence);
    if (r.isWord) {
      nWords++;
      if (saidWord) hits++;
    } else {
      nPseudo++;
      if (saidWord) falseAlarms++;
    }
  }

  const h = (hits + 0.5) / (nWords + 1);
  const fa = (falseAlarms + 0.5) / (nPseudo + 1);
  const zH = probit(h);
  const zFa = probit(fa);

  return {
    dPrime: zH - zFa,
    criterion: -0.5 * (zH + zFa),
    hitRate: h,
    falseAlarmRate: fa,
    nWords,
    nPseudo,
    nFiftyFifty,
  };
}

/** Sostre teòric de d′ amb 66/34 i correcció loglineal ≈ 4,62. */
export const DPRIME_CEILING_66_34 = (() => {
  const hMax = (66 + 0.5) / (66 + 1);
  const faMin = (0 + 0.5) / (34 + 1);
  return probit(hMax) - probit(faMin);
})();
