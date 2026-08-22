// Enviament de l'enllaç màgic. Tres modes:
//
//  1. RESEND_API_KEY definit → envia via API HTTP de Resend (gratuït fins a
//     3.000 correus/mes; recomanat per al deploy a Vercel, on l'SMTP cru
//     sovint està bloquejat).
//  2. Sense cap configuració → mode dev: l'enllaç s'imprimeix per consola i
//     es retorna a la resposta HTTP per poder provar-ho sense servidor de
//     correu.
//  3. Altres proveïdors (SMTP propi, SES…) → punt únic d'extensió aquí baix.

export interface SentLink {
  delivered: boolean;
  devUrl?: string;
}

export async function sendMagicLink(email: string, url: string): Promise<SentLink> {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const from = process.env.MAIL_FROM ?? "Mode Pompeu <onboarding@resend.dev>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "El teu enllaç per entrar al Mode Pompeu",
        text: `Hola!\n\nEntra amb aquest enllaç (caduca en 15 minuts):\n${url}\n\nSi no has demanat tu aquest enllaç, ignora'l.`,
        html: `<p>Hola!</p><p><a href="${url}">Entra al Mode Pompeu</a> (caduca en 15 minuts).</p><p>Si no has demanat tu aquest enllaç, ignora'l.</p>`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend ha fallat (${res.status}): ${body.slice(0, 200)}`);
    }
    return { delivered: true };
  }

  const isProd = process.env.NODE_ENV === "production";
  console.log(`\n[mode-pompeu] Enllaç màgic per a ${email}:\n${url}\n`);
  return { delivered: false, devUrl: isProd ? undefined : url };
}
