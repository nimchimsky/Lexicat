import Link from "next/link";

export default function NotFound() {
  return (
    <main className="game-intro">
      <p className="eyebrow">404</p>
      <h1>Aquí no hi res.</h1>
      <p className="lead">
        La pàgina que busques no existeix — o és d&apos;un altre jugador.
      </p>
      <div className="actions">
        <Link href="/" className="btn">
          Portada
        </Link>
        <Link href="/joc" className="btn secondary">
          Juga
        </Link>
      </div>
    </main>
  );
}
