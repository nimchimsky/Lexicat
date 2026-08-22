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
      <h1>El meu compte</h1>
      <p>
        Correu: <b>{player.email}</b>
      </p>
      <p>
        Sobrenom públic: <b>{player.nickname}</b>
      </p>
      <AccountActions />
    </main>
  );
}
