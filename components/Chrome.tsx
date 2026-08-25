"use client";

// Marc de l'aplicació: barra superior, columna de contingut i peu.
// A /joc tot això desapareix i la columna passa a mode «play»: alçada
// exacta de finestra i sense desplaçament, perquè la interfície de
// resposta caigui sempre al mateix lloc i els temps siguin comparables.

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/mapa", label: "Mapa" },
  { href: "/ranquings", label: "Rànquings" },
  { href: "/estudi_23691891.html", label: "Estudi" },
  { href: "/compte", label: "Compte" },
];

export default function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const play = pathname === "/joc" || pathname === "/killian";

  if (play) {
    return <div className="shell play">{children}</div>;
  }

  return (
    <>
      {/* Atall de teclat per sobre la navegació (WCAG 2.4.1); visible només
          quan rep el focus. */}
      <a href="#contingut" className="skip-link">
        Salta al contingut
      </a>
      <header className="topbar">
        <div className="topbar-in">
          <Link href="/" className="topbar-mark">
            <span className="senyera h" aria-hidden="true" />
            <span className="topbar-name">Lexicat</span>
          </Link>
          <nav className="topbar-nav" aria-label="Navegació principal">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={pathname === n.href ? "page" : undefined}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="shell" id="contingut">
        {children}
      </div>

      <footer className="footer">
        <span className="footer-mark">Lexicat · Lèxic català</span>
        <nav aria-label="Navegació del peu">
          <Link href="/privadesa">Protecció de dades</Link>
        </nav>
      </footer>
    </>
  );
}
