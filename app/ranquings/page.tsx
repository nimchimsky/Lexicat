import Link from "next/link";
import { getRankings, getKilianRankings } from "@/lib/server/views";

export const dynamic = "force-dynamic";

function fmt(x: number, digits = 1): string {
  return x.toLocaleString("ca-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtScore(n: number): string {
  return Math.round(n).toLocaleString("ca-ES");
}

export default async function Ranquings({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const kilian = mode === "kilian";

  let error: string | null = null;
  let boards: Awaited<ReturnType<typeof getRankings>> | null = null;
  let kilianBoard: Awaited<ReturnType<typeof getKilianRankings>> | null = null;
  try {
    if (kilian) kilianBoard = await getKilianRankings();
    else boards = await getRankings();
  } catch {
    error = "Els rànquings no són disponibles ara mateix (banc no ingestat?).";
  }

  return (
    <main>
      <p className="eyebrow">Classificacions</p>
      <h1>Rànquings</h1>

      {/* Modes separats mai barregats: no hi ha cap conversió entre punts Kilian
          i encerts Pompeu (decisió Roger 24/08/2026). */}
      <nav className="mode-tabs" aria-label="Mode del rànquing">
        <Link href="/ranquings" className={!kilian ? "active" : undefined} aria-current={!kilian ? "page" : undefined}>
          Pompeu
        </Link>
        <Link href="/ranquings?mode=kilian" className={kilian ? "active" : undefined} aria-current={kilian ? "page" : undefined}>
          Killian
        </Link>
      </nav>

      {error && <div className="notice">{error}</div>}

      {kilian ? (
        <>
          <p className="muted small">
            La millor partida de cada jugador, per punts. La puntuació premia la
            velocitat i les ratxes; una partida marcada com a massa ràpida no hi
            entra. Comptar per al mapa i el lèxic personal és idèntic als dos modes.
          </p>
          <section className="board-block">
            <h2>Millors partides · punts</h2>
            <Board
              unit="punts"
              rows={(kilianBoard ?? []).map((r) => ({
                nickname: r.nickname!,
                value: fmtScore(r.score),
                detail: `ratxa ${r.bestStreak} · ×${fmt(r.maxMultiplier)}`,
              }))}
            />
          </section>
        </>
      ) : (
        <>
          <p className="muted small">
            Els generals usen la mitjana de les últimes 5 partides completes vàlides
            (mai «la teva millor partida», que regala precisió a qui més insisteix).
            Amb menys de 5, es fan amb les que hi hagi i l&apos;interval surt més ample.
            Els dos primers ordenen gairebé igual (correlació ≈ 0,997): compten coses
            diferents — encerts crus vs encert ponderat per dificultat penalitzant
            falses alarmes — i per això conviuen.
          </p>

          <div className="boards">
            <section className="board-block">
              <h2>Millors partides · encerts</h2>
              <p className="muted small">Quantes de les 100 has encertat, sense cap correcció.</p>
              <Board
                unit="encerts"
                rows={(boards?.individualHits ?? []).map((r) => ({
                  nickname: r.nickname!,
                  value: String(Math.round(r.value)),
                  detail: "",
                }))}
              />
            </section>

            <section className="board-block">
              <h2>Millors partides · lexicó</h2>
              <p className="muted small">
                Encert ponderat per la dificultat real de cada paraula (les rares valen
                més), penalitzant les falses alarmes.
              </p>
              <Board
                unit="índex"
                rows={(boards?.individualLexicon ?? []).map((r) => ({
                  nickname: r.nickname!,
                  value: `${fmt(r.value * 100)}`,
                  detail: "",
                }))}
              />
            </section>

            <section className="board-block">
              <h2>Rànquing general · encerts</h2>
              <p className="muted small">Mitjana d&apos;encerts de les últimes 5 partides.</p>
              <Board
                unit="mitjana"
                rows={(boards?.generalHits ?? []).map((r) => ({
                  nickname: r.nickname!,
                  value: fmt(r.value, 0),
                  detail: r.detail ?? "",
                }))}
              />
            </section>

            <section className="board-block">
              <h2>Rànquing general · estimació del lexicó</h2>
              <p className="muted small">
                Estimació sobre totes les respostes de la finestra ajuntades; el
                percentatge ve amb el seu interval.
              </p>
              <Board
                unit="lexicó"
                rows={(boards?.generalLexicon ?? []).map((r) => ({
                  nickname: r.nickname!,
                  value: `${fmt(r.value)}%`,
                  detail: r.detail ?? "",
                }))}
              />
            </section>
          </div>
        </>
      )}
    </main>
  );
}

function Board({
  rows,
  unit,
}: {
  rows: { nickname: string; value: string; detail: string }[];
  unit: string;
}) {
  if (rows.length === 0) {
    return <p className="muted">Encara no hi ha prou partides vàlides.</p>;
  }
  const hasDetail = rows.some((r) => r.detail);
  return (
    <table className="board">
      <thead>
        <tr>
          <th className="rank">#</th>
          <th>Jugador</th>
          <th className="num">{unit}</th>
          {hasDetail ? <th className="num">interval</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.nickname}-${i}`} className={i < 3 ? "top" : undefined}>
            <td className="rank">{i + 1}</td>
            <td className="player">{r.nickname}</td>
            <td className="num value">{r.value}</td>
            {hasDetail ? <td className="num small muted">{r.detail}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
