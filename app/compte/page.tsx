import { redirect } from "next/navigation";
import { currentPlayer, logout } from "@/lib/server/auth";
import AccountActions from "@/components/AccountActions";

export const dynamic = "force-dynamic";

export default async function Compte() {
  const player = await currentPlayer();
  if (!player) redirect("/entrar");
  void logout;
  return (
    <main>
      <p className="eyebrow">Compte</p>
      <h1>El meu compte</h1>

      <dl className="deflist">
        <div>
          <dt>Correu</dt>
          <dd>{player.email || "—"}</dd>
        </div>
        <div>
          <dt>Sobrenom públic</dt>
          <dd>{player.nickname ?? "—"}</dd>
        </div>
      </dl>

      <AccountActions />
    </main>
  );
}
