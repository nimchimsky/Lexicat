export const metadata = { title: "Protecció de dades · Lexicat" };

export default function Privadesa() {
  return (
    <main>
      <p className="eyebrow">Legal</p>
      <h1>Protecció de dades</h1>

      <h2>Què desem i per què</h2>
      <ul>
        <li>
          <b>Correu electrònic:</b> perquè puguis tornar a entrar amb el mateix
          compte des de qualsevol dispositiu. És l&apos;única dada identificativa.
        </li>
        <li>
          <b>Sobrenom públic:</b> el que tries tu; apareix als rànquings.
        </li>
        <li>
          <b>Respostes al joc:</b> estímul, confiança declarada, temps de
          resposta, posició dins la partida, format utilitzat, classe de
          dispositiu i quantes partides duies. Són la matèria del calibratge
          psicomètric del joc i no serveixen per identificar-te.
        </li>
        <li>
          <b>Resultats estimats:</b> habilitat, percentatge del lexicó,
          percentil, d′ i puntuació de cada partida.
        </li>
      </ul>

      <h2>Base legal</h2>
      <p>
        El tractament es fa amb el teu <b>consentiment</b> (art. 6.1.a GDPR): el
        dones en crear el compte, i el pots retirar esborrant el compte quan
        vulguis. La finalitat és exclusivament el funcionament del joc, els teus
        resultats acumulats i la recerca lèxica agregada i anònima.
      </p>

      <h2>Quant de temps</h2>
      <p>
        Les respostes es conserven indefinidament com a registre científic
        agregat: sense elles no es pot recalibrar el joc ni mantenir-lo just.
        Les dades identificatives (correu) duren mentre tinguis el compte.
      </p>

      <h2>Com s&apos;esborra</h2>
      <p>
        A «El meu compte» tens el botó d&apos;esborrar. Quan l&apos;uses: el correu
        desapareix de la base de dades, el sobrenom passa a un identificador opac
        i les sessions i tokens es destrueixen. <b>Les respostes ja entrada al
        calibratge es conserven però completament deslligades de cap persona
        identificable</b>: formen part de paràmetres estadístics agregats (la
        dificultat i la discriminació dels ítems) que ja no poden atribuir-se a
        ningú. Si demanes l&apos;esborrament abans que les teves respostes entrin
        en cap càlcul agregat, s&apos;eliminen totes.
      </p>

      <h2>Rànquings i comparacions</h2>
      <p>
        Els rànquings mostren només sobrenom i resultat. Qualsevol comparació
        futura per grups (edat, formació…) només es mostrarà amb cel·les d&apos;al
        menys <b>n ≥ 500 persones</b>, el mateix llindar de k-anonimat de
        l&apos;informe de referència.
      </p>

      <h2>Llicències del contingut</h2>
      <p>
        El banc d&apos;ítems prové de l&apos;estudi de lèxic en català de la URV. Els
        enllaços apunten al DIEC de l&apos;IEC: només s&apos;enllaça, mai es mostra el
        text de les definicions, que té llicència pròpia de l&apos;IEC. El joc no
        fa servir variables de freqüència amb condicions restrictives més enllà
        del CSV de calibratge.
      </p>
    </main>
  );
}
