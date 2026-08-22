import { getRankings } from "@/lib/server/views";

export const dynamic = "force-dynamic";

function fmt(x: number, digits = 1): string {
  return x.toLocaleString("ca-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function Ranquings() {
  let boards;
  let error: string | null = null;
  try {
    boards = await getRankings();
  } catch {
    boards = null;
    error = "Els rànquings no són disponibles ara mateix (banc no ingestat?).";
  }

  return (
    <main>
      <h1>Rànquings</h1>

      <p className="muted small">
        Els generals usen la mitjana de les últimes 5 partides completes vàlides
        (mai «la teva millor partida», que regala precisió a qui més insisteix).
        Amb menys de 5, es fan amb les que hi hagi i l&apos;interval surt més ample.
        Els dos primers ordenen gairebé igual (correlació ≈ 0,997): compten coses
        diferents — encerts crus vs encert ponderat per dificultat penalitzant
        falses alarmes — i per això conviuen.
      </p>

      {error && <div className="notice">{error}</div>}

      <h2>Millors partides · encerts</h2>
      <p className="muted small">Quantes de les 100 has encertat, sense cap correcció.</p>
      <Board rows={(boards?.individualHits ?? []).map((r) => ({ nickname: r.nickname!, value: String(Math.round(r.value)), detail: "" }))} />

      <h2>Millors partides · lexicó</h2>
      <p className="muted small">
        Encert ponderat per la dificultat real de cada paraula (les rares valen
        més), penalitzant les falses alarmes.
      </p>
      <Board rows={(boards?.individualLexicon ?? []).map((r) => ({ nickname: r.nickname!, value: `${fmt(r.value * 100)}`, detail: "" }))} />

      <h2>Rànquing general · encerts</h2>
      <p className="muted small">Mitjana d&apos;encerts de les últimes 5 partides.</p>
      <Board rows={(boards?.generalHits ?? []).map((r) => ({
        nickname: r.nickname!,
        value: fmt(r.value, 0),
        detail: r.detail ?? "",
      }))} />

      <h2>Rànquing general · estimació del lexicó</h2>
      <p className="muted small">
        Estimació sobre totes les respostes de la finestra ajuntades; el
        percentatge ve amb el seu interval.
      </p>
      <Board
        rows={(boards?.generalLexicon ?? []).map((r) => ({
          nickname: r.nickname!,
          value: `${fmt(r.value)}%`,
          detail: r.detail ?? "",
        }))}
      />
    </main>
  );
}

function Board({ rows }: { rows: { nickname: string; value: string; detail: string }[] }) {
  if (rows.length === 0) {
    return <p className="muted">Encara no hi ha prou partides vàlides.</p>;
  }
  return (
    <table className="board">
      <thead>
        <tr>
          <th>#</th>
          <th>Jugador</th>
          <th style={{ textAlign: "right" }}>Valor</th>
          <th className="small muted"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.nickname}-${i}`}>
            <td>{i + 1}</td>
            <td>{r.nickname}</td>
            <td className="num">{r.value}</td>
            <td className="small muted num">{r.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
