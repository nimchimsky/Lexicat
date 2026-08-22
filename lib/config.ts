// Configuració central del joc. Tot valor que afecti dades històriques
// entra a una de les quatre versions i no es pot canviar sense bumpar-la.

export const VERSIONS = {
  itemBank: "2026.08",
  referenceCorpus: "ref-1",
  calibration: "cal-1",
  scoring: "sc-1",
} as const;

// Prior N(0, 0.624²): distribució real de θ de la població de l'estudi.
export const PRIOR_MEAN = 0;
export const PRIOR_SD = 0.624;

// Límits d'acotament de l'estimació MAP.
export const THETA_BOUND = 6;
export const NEWTON_MAX_ITER = 50;

// Inestabilitat entre sessions (estudi previ, altre format de resposta).
// SE total = sqrt(SE mesura² + INSTABILITY_SE²)
export const INSTABILITY_SE = 0.278;

// -----------------------------------------------------------------------
// Puntuació (scoring_version)
// -----------------------------------------------------------------------

/** Sòl de la probabilitat abans del logaritme. Amb 0.02 la ràtio càstig/premi és 4,6:1. */
export const SCORING_EPSILON = 0.02;
/** Escala de la puntuació visible. */
export const SCORE_K = 10;

/**
 * Mapatge de la dificultat b de l'ítem al pes W ∈ [1, 3].
 * Els extrems [B_WEIGHT_MIN, B_WEIGHT_MAX] es fixen amb el rang real del banc
 * ingesting (item_bank_versions.b_min / b_max). Aquí hi ha els valors de
 * referència per si cal estimar sense banc carregat (tests, simulació usa els
 * reals).
 */
export const B_WEIGHT_FALLBACK = { min: -9.5, max: 3.75 } as const;

// -----------------------------------------------------------------------
// Format de resposta (commutables per configuració; mateix tipus de dada)
// -----------------------------------------------------------------------

export type ResponseFormat = "slider" | "buttons";

/** Format actiu del primer desplegament. Es commuta aquí i res més. */
export const ACTIVE_RESPONSE_FORMAT: ResponseFormat = "buttons";

/** Passos del slider si s'activa. */
export const SLIDER_STEPS = 21; // o 11

/**
 * Mapatge documentat dels cinc botons discrets a probabilitats.
 * Índex 0 = "segur que NO" … índex 4 = "segur que SÍ".
 */
export const BUTTON_CONFIDENCE = [0.05, 0.25, 0.5, 0.75, 0.95] as const;
export const BUTTON_LABELS = [
  "segur que NO",
  "crec que no",
  "no ho sé",
  "crec que sí",
  "segur que SÍ",
] as const;

/**
 * Regla de desempat determinista per a confiança exactament 0,50:
 * per a l'estimació de θ es compta com a resposta "no és paraula" (x_i = 0),
 * és a dir, x_i = 1 ⟺ confiança > 0,5. Per a d′ i criteri, les respostes de
 * exactament 0,5 s'exclouen del càlcul de H i FA i es compten a part.
 */
export const TIE_RULE = "exactly_half_counts_as_nonword" as const;

// -----------------------------------------------------------------------
// Partida
// -----------------------------------------------------------------------

export const N_WORD_ITEMS = 66;
export const N_PSEUDO_ITEMS = 34;
export const GAME_LENGTH = N_WORD_ITEMS + N_PSEUDO_ITEMS; // 100

/** Refredament: partides que han de passar per tornar a veure un ítem. */
export const COOLDOWN_GAMES = 50;

// -----------------------------------------------------------------------
// Qualitat i integritat
// -----------------------------------------------------------------------

/** RT mínim raonable; per davall es marca però no s'esborra. */
export const MIN_RT_MS = 200;
/** Fracció de respostes precipitades que marca la partida com a sospitosa. */
export const FAST_GUESS_GAME_RATIO = 0.2;

/** Una partida in_progress amb l'última activitat més vella que això s'abandona. */
export const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

/** Finestra dels rànquings generals. */
export const RANKING_WINDOW = 5;
