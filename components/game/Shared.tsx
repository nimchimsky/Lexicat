// Components de partida compartits pels modes Pompeu i Kilian.
// El contracte visual és sagrat: la caixa de l'estímul mai es transforma ni
// s'anima, i el comandament cau sempre al mateix lloc (les mesures de RT
// depenen d'això).

/** L'estímul SEMPRE en una sola línia; «l·l» s'envolta d'aire per llegir-se bé.
 *  Les formes llargues (≥10 caràcters) encoixen una mica per no desbordar un
 *  mòbil estret: el banc arriba a 12. */
export function Stimulus({ text }: { text: string }) {
  const parts = text.split(/(l·l)/g);
  return (
    <span className={`stimulus-text${text.length >= 10 ? " long" : ""}`}>
      {parts.length === 1
        ? text
        : parts.map((p, i) =>
            p === "l·l" ? (
              <span key={i} className="gemil">
                {p}
              </span>
            ) : (
              <span key={i}>{p}</span>
            )
          )}
    </span>
  );
}

export function LoadingScreen() {
  return (
    <main className="game-intro center">
      <p className="loading muted" aria-live="polite">
        Carregant
        <span />
        <span />
        <span />
      </p>
    </main>
  );
}

export function ProgressTicks({ position, totalItems }: { position: number; totalItems: number }) {
  return (
    <div
      className="ticks"
      role="progressbar"
      aria-label="Progrés de la partida"
      aria-valuemin={1}
      aria-valuemax={totalItems}
      aria-valuenow={position}
      aria-valuetext={`${position} de ${totalItems}`}
    >
      <div
        className="ticks-flag"
        aria-hidden="true"
        style={{ width: `${((position - 1) / totalItems) * 100}%` }}
      />
      <div className="ticks-grid" aria-hidden="true" />
    </div>
  );
}
