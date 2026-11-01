import { company } from "@/lib/site/company";
export const metadata = { title: "Impressum · ProAcademy" };
export default function ImpressumPage() {
  return (
    <>
      <p className="pa-legal-eyebrow">Rechtliche Angaben</p>
      <h1>Impressum</h1>
      <div className="pa-legal-panels">
        <section>
          <h2>Name des Unternehmens</h2>
          <p>{company.name}</p>
        </section>
        <section>
          <h2>Vertreten durch</h2>
          <p>{company.representatives}</p>
        </section>
        <section>
          <h2>Eingetragener Firmensitz</h2>
          <address>
            {company.street}
            <br />
            {company.city}
          </address>
        </section>
        <section>
          <h2>Handelsregister</h2>
          <p>{company.register}</p>
        </section>
        <section>
          <h2>Umsatzsteuer-Identifikationsnummer</h2>
          <p>{company.vatId}</p>
        </section>
        <section>
          <h2>Kontaktinformationen</h2>
          <p>
            <a href={company.phoneHref}>{company.phone}</a>
            <br />
            <a href={`mailto:${company.email}`}>{company.email}</a>
          </p>
        </section>
        <section>
          <h2>Aufsichtsbehörde</h2>
          <address>
            Landesanstalt für Medien NRW
            <br />
            Zollhof 2<br />
            40221 Düsseldorf
          </address>
          <p>
            Telefon: <a href="tel:+49211770070">+49 211 77 007-0</a>
            <br />
            Telefax: +49 211 72 71 70
            <br />
            <a href="mailto:info@medienanstalt-nrw.de">
              info@medienanstalt-nrw.de
            </a>
          </p>
        </section>
      </div>
      <p className="pa-legal-source">
        Angaben wie auf{" "}
        <a
          href={`${company.website}/impressum`}
          target="_blank"
          rel="noreferrer"
        >
          proacademy-ak.com/impressum ↗
        </a>
        .
      </p>
    </>
  );
}
