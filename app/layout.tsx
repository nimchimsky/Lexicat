import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mode Pompeu · Lèxic.cat",
  description:
    "Mesura el teu lèxic en català: 100 estímuls, cap feedback, la teva estimació al final.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#1c1b22",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ca">
      <body>
        <div className="shell">{children}</div>
        <footer className="footer">
          <a href="/privadesa">Protecció de dades</a> ·{" "}
          <a href="/ranquings">Rànquings</a>
        </footer>
      </body>
    </html>
  );
}
