import { redirect } from "next/navigation";
import { currentPlayer } from "@/lib/server/auth";
import EmailForm from "@/components/EmailForm";

export const dynamic = "force-dynamic";

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const player = await currentPlayer();
  if (player) redirect("/joc");
  const { error } = await searchParams;
  return (
    <main>
      <h1>Entra</h1>
      <p className="muted">
        Només el correu. T&apos;hi enviem un enllaç màgic: sense contrasenya.
      </p>
      {error ? (
        <div className="notice">
          {error === "token" || error === "caducat"
            ? "L'enllaç no és vàlid o ha caducat. Demana'n un de nou."
            : "Hi ha hagut un problema."}
        </div>
      ) : null}
      <EmailForm />
    </main>
  );
}
