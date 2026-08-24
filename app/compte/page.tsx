import Link from "next/link";
import { redirect } from "next/navigation";
import { currentPlayer } from "@/lib/server/auth";
import { getProfileView, type ProfileModeStats, type ProfileRecentGame } from "@/lib/server/views";
import AccountActions from "@/components/AccountActions";
import NicknameForm from "@/components/NicknameForm";
import ProfileForm from "@/components/ProfileForm";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("ca-ES", { dateStyle: "medium" });

function number(value: number | null, digits = 0): string {
  if (value === null) return "—";
  return value.toLocaleString("ca-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function date(value: string): string {
  return dateFormatter.format(new Date(value));
}

function modeStats(view: ProfileModeStats[], mode: ProfileModeStats["mode"]): ProfileModeStats {
  return view.find((item) => item.mode === mode) ?? {
    mode,
    gamesStarted: 0,
    gamesCompleted: 0,
    meanHits: null,
    bestHits: null,
    meanScore: null,
    bestScore: null,
    bestStreak: null,
    pctLexicon: null,
    pctLo: null,
    pctHi: null,
    percentile: null,
  };
}

function gameStatus(game: ProfileRecentGame): string {
  if (game.status === "completed") return "Acabada";
  if (game.status === "abandoned") return "Abandonada";
  return "En curs";
}

function gameResult(game: ProfileRecentGame): string {
  if (game.status !== "completed") return "—";
  if (game.mode === "pompeu") return `${number(game.nCorrect)}/100 · ${number(game.score)} punts`;
  return `${number(game.score)} punts · ratxa ${number(game.bestStreak)}`;
}

export default async function Compte({
  searchParams,
}: {
  searchParams: Promise<{ vistos?: string; pagina?: string }>;
}) {
  const player = await currentPlayer();
  if (!player) redirect("/entrar");

  const { vistos, pagina } = await searchParams;
  const seenKind = vistos === "pseudoparaules" ? "pseudo" : "word";
  const parsedPage = Number.parseInt(pagina ?? "1", 10);
  const view = await getProfileView(player.id, seenKind, Number.isFinite(parsedPage) ? parsedPage : 1);
  const pompeu = modeStats(view.stats, "pompeu");
  const killian = modeStats(view.stats, "killian");

  const listHref = (kind: "paraules" | "pseudoparaules", page = 1) =>
    `/compte?vistos=${kind}${page > 1 ? `&pagina=${page}` : ""}`;

  return (
    <main>
      <p className="eyebrow">Perfil</p>
      <h1>El meu perfil</h1>
      <p className="lead">
        Aquí tens el teu progrés, el teu lèxic descobert i les dades que vulguis
        compartir amb l’estudi. El perfil és opcional.
      </p>

      <section className="card">
        <h2>Nom als rànquings</h2>
        <p className="muted small">
          Aquest sobrenom és públic. El correu i la resta del perfil no apareixen
          als rànquings.
        </p>
        <NicknameForm
          initialNickname={player.nickname ?? ""}
          redirectTo="/compte"
          labelText="Sobrenom públic"
          submitLabel="Desa el sobrenom"
        />
      </section>

      <section>
        <h2>Estadístiques acumulades</h2>
        <div className="profile-mode-grid">
          <article className="card profile-mode-card">
            <p className="eyebrow">Mode</p>
            <h3>Pompeu</h3>
            <div className="statgrid">
              <div className="stat"><b>{pompeu.gamesCompleted}</b><span>partides acabades</span></div>
              <div className="stat"><b>{number(pompeu.meanHits, 1)}</b><span>mitjana d’encerts</span></div>
              <div className="stat"><b>{number(pompeu.bestHits)}</b><span>millor partida</span></div>
              <div className="stat"><b>{number(pompeu.meanScore)}</b><span>mitjana de punts</span></div>
            </div>
            {pompeu.pctLexicon !== null && (
              <p className="profile-standing">
                Estimació del lexicó: <b>{number(pompeu.pctLexicon, 1)}%</b>
                {pompeu.pctLo !== null && pompeu.pctHi !== null ? ` · IC95 ${number(pompeu.pctLo, 1)}–${number(pompeu.pctHi, 1)}%` : ""}
                {pompeu.percentile !== null ? ` · percentil ${number(pompeu.percentile, 0)}` : ""}
              </p>
            )}
            <p className="muted small">Iniciades: {pompeu.gamesStarted}. La mitjana inclou les partides acabades.</p>
          </article>

          <article className="card profile-mode-card">
            <p className="eyebrow">Mode</p>
            <h3>Killian</h3>
            <div className="statgrid">
              <div className="stat"><b>{killian.gamesCompleted}</b><span>partides acabades</span></div>
              <div className="stat"><b>{number(killian.meanScore)}</b><span>mitjana de punts</span></div>
              <div className="stat"><b>{number(killian.bestScore)}</b><span>millor partida</span></div>
              <div className="stat"><b>{number(killian.bestStreak)}</b><span>millor ratxa</span></div>
            </div>
            <p className="muted small">Iniciades: {killian.gamesStarted}. Els rànquings dels modes són independents.</p>
          </article>
        </div>
      </section>

      <section className="card">
        <h2>Últimes partides</h2>
        {view.recentGames.length === 0 ? (
          <p className="muted">Encara no has jugat cap partida.</p>
        ) : (
          <div className="table-scroll">
            <table className="board profile-games">
              <thead>
                <tr><th>Data</th><th>Mode</th><th>Estat</th><th className="num">Resultat</th></tr>
              </thead>
              <tbody>
                {view.recentGames.map((game) => (
                  <tr key={game.gameId}>
                    <td>{game.status === "completed" ? <Link href={`/resultats/${game.gameId}`}>{date(game.startedAt)}</Link> : date(game.startedAt)}</td>
                    <td>{game.mode === "pompeu" ? "Pompeu" : "Killian"}</td>
                    <td>{gameStatus(game)}</td>
                    <td className="num value">{gameResult(game)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Ítems vistos</h2>
        <p className="muted small">
          Paraules vistes: <b>{view.seenCounts.words.toLocaleString("ca-ES")}</b> ·
          pseudoparaules vistes: <b>{view.seenCounts.pseudowords.toLocaleString("ca-ES")}</b>.
          Inclou els ítems que han aparegut encara que no hagis acabat la partida.
        </p>
        <nav className="profile-tabs" aria-label="Tipus d’ítem vist">
          <Link href={listHref("paraules")} className={seenKind === "word" ? "active" : undefined}>Paraules</Link>
          <Link href={listHref("pseudoparaules")} className={seenKind === "pseudo" ? "active" : undefined}>Pseudoparaules</Link>
        </nav>
        {view.seenItems.length === 0 ? (
          <p className="muted">Encara no n’has vist cap.</p>
        ) : (
          <ul className="wordlist profile-wordlist">
            {view.seenItems.map((item) => (
              <li key={item.itemId}>
                {item.isWord ? <a className="word" href={`https://dlc.iec.cat/results.asp?txtentrada=${encodeURIComponent(item.form)}`} target="_blank" rel="noreferrer">{item.form}</a> : <span className="word">{item.form}</span>}
                <span className="muted small">{item.timesSeen === 1 ? "1 vegada" : `${item.timesSeen} vegades`}</span>
              </li>
            ))}
          </ul>
        )}
        {view.seenPageCount > 1 && (
          <nav className="pagination" aria-label="Paginació d’ítems vistos">
            {view.seenPage > 1 ? <Link className="btn small secondary" href={listHref(seenKind === "word" ? "paraules" : "pseudoparaules", view.seenPage - 1)}>Anterior</Link> : <span />}
            <span className="muted small">Pàgina {view.seenPage} de {view.seenPageCount}</span>
            {view.seenPage < view.seenPageCount ? <Link className="btn small secondary" href={listHref(seenKind === "word" ? "paraules" : "pseudoparaules", view.seenPage + 1)}>Següent</Link> : <span />}
          </nav>
        )}
      </section>

      <section className="card">
        <h2>Sobre tu</h2>
        <p className="muted small">
          Aquestes dades poden ajudar a estudiar com varia el joc entre perfils,
          però són opcionals i no modifiquen la puntuació.
        </p>
        <ProfileForm initialProfile={view.profile} />
      </section>

      <section className="card">
        <h2>Compte</h2>
        <dl className="deflist">
          <div><dt>Correu</dt><dd>{player.email || "Convidat"}</dd></div>
          <div><dt>Identitat pública</dt><dd>{player.nickname ?? "—"}</dd></div>
        </dl>
        <AccountActions />
      </section>
    </main>
  );
}
