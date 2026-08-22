import { redirect } from "next/navigation";
import { currentPlayer } from "@/lib/server/auth";
import NicknameForm from "@/components/NicknameForm";

export const dynamic = "force-dynamic";

export default async function Benvingut({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const player = await currentPlayer();
  if (!player) redirect("/entrar");
  if (player.nickname) redirect("/joc");
  const { error } = await searchParams;
  return (
    <main>
      <h1>Escull el teu sobrenom</h1>
      <p className="muted">
        És com apareixeràs als rànquings. Pots posar el que vulguis; el teu
        correu queda privat.
      </p>
      {error && <div className="notice">{decodeURIComponent(error)}</div>}
      <NicknameForm />
    </main>
  );
}
