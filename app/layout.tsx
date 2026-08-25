import type { Metadata, Viewport } from "next";
import { Inter, Anton } from "next/font/google";
import Chrome from "@/components/Chrome";
import "./globals.css";

// Només les dues famílies que fa servir el tema vigent (tensio). Fraunces i
// JetBrains Mono servien només a temes morts: fora, que pesen al primer load.
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton", display: "swap" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lexic.cat";
const TITLE = "Lexicat · Lèxic català";
const DESCRIPTION =
  "Mesura el teu lèxic en català: 100 estímuls, cap feedback, la teva estimació al final.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · Lexicat",
  },
  description: DESCRIPTION,
  applicationName: "Lexicat",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
  },
  openGraph: {
    type: "website",
    locale: "ca_ES",
    url: SITE_URL,
    siteName: "Lexicat",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Sense maximumScale: el pinyó de zoom és un requisit d'accessibilitat (WCAG 1.4.4).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0907",
};

// Tema definitiu: Alta tensió (E). Cap script de client no toca <html> abans
// de la hidratació: la flashada i el mismatch d'hidratació queden impossibles.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ca"
      data-theme="tensio"
      className={`${sans.variable} ${anton.variable}`}
    >
      <body>
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
