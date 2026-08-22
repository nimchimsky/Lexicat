// Enviament de l'enllaç màgic. En desenvolupament (sense SMTP_URL) l'enllaç
// s'imprimeix per consola i es retorna a la resposta HTTP per poder provar-ho
// sense servidor de correu. A producció cal SMTP_URL o un proveïdor extern:
// punt únic d'integració documentat al README.

export interface SentLink {
  delivered: boolean;
  devUrl?: string;
}

export async function sendMagicLink(email: string, url: string): Promise<SentLink> {
  const smtp = process.env.SMTP_URL;
  const isProd = process.env.NODE_ENV === "production";
  if (!smtp) {
    // Mode dev: consola + resposta HTTP.
    console.log(`\n[mode-pompeu] Enllaç màgic per a ${email}:\n${url}\n`);
    return { delivered: false, devUrl: isProd ? undefined : url };
  }
  // Punt d'extensió: connectar aquí el proveïdor de correu (nodemailer, SES,
  // Resend…). Sense SMTP configurat no s'envia res en producció.
  throw new Error(
    "SMTP_URL definit però cap transport de correu configurat. Connecta el teu proveïdor a lib/server/mailer.ts."
  );
}
