import VerifyForm from "@/components/VerifyForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Entra · Lexicat" };

/** Intersticial de l'enllaç màgic: el token es canvia per sessió només per POST. */
export default async function Verificar({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <VerifyForm token={token ?? null} />;
}
