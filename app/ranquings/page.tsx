import Link from "next/link";
import type { Metadata } from "next";
import { currentPlayer } from "@/lib/server/auth";
import { getRankings, getKilianRankings, RANKING_TOP_N, type RankingRow } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rànquings",
};

function fmt(x: number, digits = 1): string {
  return x.toLocaleString("ca-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtScore(n: number): string {
  return Math.round(n).toLocaleString("ca-ES");
}

interface BoardRow {
  rank: number;
  nickname: string | null;
  valueText: string;
  detail?: string;
  isMe?: boolean;
}

function nick(r: BoardRow): string {
  return r.nickname ?? "anònim";
}

/** Tauler compacte: top N amb la teva fila destacada; si quedes fora del top,
 *  «La teva posició» queda fixada damunt de la taula. */
function Board({ rows, unit }: { rows: BoardRow[]; unit: string }) {
  if (rows.length === 0) {
    return <p className="muted">Encara no hi ha prou partides vàlides.</p>;
  }
  const mine = rows.find((r) => r.isMe);
  const visible = rows.filter((r) => r.rank <= RANKING_TOP_N);
  return (
    <>
      {mine && mine.rank > RANKING_TOP_N ? (
        <p className="board-me" role="status">
          La teva posició: <b>#{mine.rank}</b> · {nick(mine)} · <b>{mine.valueText}</b> {unit}
          {mine.detail ? <span className="muted"> · {mine.detail}</span> : null}
        </p>
      ) : null}
      <table className="board">
        <caption className="visually-hidden">Classificació per {unit}</caption>
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Jugador</th>
            <th className="num">{unit}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr
              key={r.rank}
              className={`${r.rank <= 3 ? "top " : ""}${r.isMe ? "me" : ""}`.trim() || undefined}
            >
              <td className="rank">{r.rank}</td>
              <td className="player">{nick(r)}</td>
              <td className="num value">{r.valueText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Una sola mètrica principal; la resta de classificacions, plegades. */
function toBoardRows(rows: RankingRow[], format: (v: number) => string): BoardRow[] {
  return rows.map((r) => ({
    rank: r.rank,
    nickname: r.nickname,
    valueText: format(r.value),
    detail: r.detail,
    isMe: r.isMe,
  }));
}

export default async function Ranquings({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const kilian = mode === "kilian";
  const player = await currentPlayer();

  let error: string | null = null;
  let boards: Awaited<ReturnType<typeof getRankings>> | null = null;
  let kilianBoard: Awaited<ReturnType<typeof getKilianRankings>> | null = null;
  try {
    if (kilian) kilianBoard = await getKilianRankings(player?.id ?? null);
    else boards = await getRankings(player?.id ?? null);
  } catch {
    error = "Els rànquings no són disponibles ara mateix (banc no ingestat?).";
  }

  // Tauler principal: una sola mètrica a la vista; les altres, dins «Més rànquings».
  const mainBoard = boards?.generalLexicon ?? [];
  const moreBoards: { title: string; note: string; unit: string; rows: RankingRow[]; int?: boolean }[] =
    boards
      ? [
          {
            title: "Millors partides · encerts",
            note: "Quantes de les 100 has encertat, sense cap correcció.",
            unit: "encerts",
            rows: boards.individualHits,
            int: true,
          },
          {
            title: "Rànquing general · mitjana d'encerts",
            note: "Mitjana de les últimes 5 partides completes vàlides.",
            unit: "mitjana",
            rows: boards.generalHits,
          },
        ]
      : [];

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
          Kilian
        </Link>
      </nav>

      {error && <div className="notice">{error}</div>}

      {kilian ? (
        <>
          <p className="muted small">
            La millor partida de cada jugador, per punts: la puntuació premia la
            velocitat i les ratxes. Una partida marcada com a massa ràpida no hi entra.
          </p>
          <section className="board-block">
            <h2>Top {RANKING_TOP_N} · punts</h2>
            <Board
              unit="punts"
              rows={(kilianBoard ?? []).map((r) => ({
                rank: r.rank,
                nickname: r.nickname,
                valueText: fmtScore(r.score),
                detail: r.isMe || r.rank <= RANKING_TOP_N ? `ratxa ${r.bestStreak} · ×${fmt(r.maxMultiplier)}` : undefined,
                isMe: r.isMe,
              }))}
            />
          </section>
        </>
      ) : (
        <>
          <section className="board-block">
            <h2>Top {RANKING_TOP_N} · estimació del lexicó</h2>
            <Board unit="% del lèxic" rows={toBoardRows(mainBoard, (v) => fmt(v))} />
          </section>

          <details className="fold">
            <summary>Més rànquings</summary>
            {moreBoards.map((b) => (
              <section className="board-block" key={b.title}>
                <h3>{b.title}</h3>
                <p className="muted small">{b.note}</p>
                <Board unit={b.unit} rows={toBoardRows(b.rows, (v) => (b.int ? String(Math.round(v)) : fmt(v)))} />
              </section>
            ))}
            <p className="small muted">
              Els generals usen les últimes 5 partides completes vàlides (mai «la teva
              millor partida», que regala precisió a qui més insisteix). La millor
              partida per encerts i el lexicó ponderat ordenaven gairebé igual
              (correlació ≈ 0,997): dos taulers per a una sola cosa, i el lexicó
              ja hi és al general, on diferenciar té sentit.
            </p>
          </details>
        </>
      )}
    </main>
  );
}
