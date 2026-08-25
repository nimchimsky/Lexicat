import type { Metadata, Viewport } from "next";
import { Fraunces, JetBrains_Mono, Inter, Anton } from "next/font/google";
import Chrome from "@/components/Chrome";
import "./globals.css";

const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton", display: "swap" });

export const metadata: Metadata = {
  title: "Lexicat · Lèxic català",
  description:
    "Mesura el teu lèxic en català: 100 estímuls, cap feedback, la teva estimació al final.",
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
      className={`${serif.variable} ${mono.variable} ${sans.variable} ${anton.variable}`}
    >
      <body>
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
