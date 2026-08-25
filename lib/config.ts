// Configuració central del joc. Tot valor que afecti dades històriques
// entra a una de les quatre versions i no es pot canviar sense bumpar-la.

export const VERSIONS = {
  itemBank: "2026.08",
  referenceCorpus: "ref-1",
  calibration: "cal-1",
  scoring: "sc-1",
  /** Puntuació del mode Kilian, independent de la sc-1 de Pompeu. */
  kilianScoring: "ki-1",
} as const;

// -----------------------------------------------------------------------
// Modes de joc
// -----------------------------------------------------------------------

export type GameMode = "pompeu" | "killian";

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

/** Format actiu del desplegament: l'slider és LA mecànica del joc (decisió Roger). */
export const ACTIVE_RESPONSE_FORMAT: ResponseFormat = "slider";

/**
 * Passos de l'escala de seguretat. 7 = Líkert de 7 punts (decisió Roger
 * 2026-08-23): el centre val exactament 0,5 → cinquanta-cinc, coherent amb
 * TIE_RULE. Les partides velles desades amb 21 passos continuen sent vàlides:
 * el client les renderitza amb l'slider continu de tota la vida.
 */
export const SLIDER_STEPS = 7;

/** Etiquetes del Líkert d'índex 0 («segur que NO») … índex 6 («segur que SÍ»). */
export const SLIDER_LIKERT_LABELS = [
  "segur que no",
  "gairebé segur que no",
  "probable que no",
  "incert",
  "probable que sí",
  "gairebé segur que sí",
  "segur que sí",
] as const;

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
// Mode Kilian (kilian_scoring_version ki-1)
// -----------------------------------------------------------------------

/** Durada de la barra de temps d'un estímul. */
export const KILIAN_BAR_MS = 5000;
/** Marge del servidor per damunt de la barra abans de considerar-ho tard. */
export const KILIAN_GRACE_MS = 300;
/** Punts base màxims per estímul (contesten a l'instant). */
export const KILIAN_POINTS_MAX = 100;
/**
 * Feedback entre ítems. Més curt quan encertes (manté el ritme) i més llarg
 * quan falles, que és quan cal llegir què ha passat.
 */
export const KILIAN_FEEDBACK_HIT_MS = 420;
export const KILIAN_FEEDBACK_MISS_MS = 700;
/** Confiança amb què entra al model graduat cada judici binari. */
export const KILIAN_YES_CONFIDENCE = 0.95;
export const KILIAN_NO_CONFIDENCE = 0.05;
/** Sostre del multiplicador (inabastable amb 100 ítems, però fixa el límit). */
export const KILIAN_MULTIPLIER_CAP = 3;

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

// -----------------------------------------------------------------------
// Mapa dels Països Catalans (metaprogrés de zones)
// -----------------------------------------------------------------------

/**
 * Una zona per cada 1% del banc de paraules reals (decisió Roger 23/08/2026):
 * 40.777 paraules → 100 zones → ~408 paraules i ~6-7 partides per zona. El
 * recompte és de paraules reals úniques VISTES (encertades o no); les
 * pseudoparaules no compten. Els llindars exactes els calcula
 * lib/mapa/thresholds.ts a partir del n_words del banc vigent.
 */
export const MAPA_ZONES = 100;

/**
 * Inici ràpid de la progressió (revisió UX 25/08/2026): la primera zona cau
 * en acabar la PRIMERA partida (66 paraules reals vistes), amb dues
 * recompenses més aviat; a partir de la quarta el ritme torna al científic
 * d'1% del banc per zona. Sense això, la primera fitxa tardava 6-7 partides:
 * massa tard per generar retenció.
 */
export const MAPA_FAST_START_WORDS = [66, 150, 250] as const;
