import { company } from "@/lib/site/company";
export const metadata = { title: "Kontakt · ProAcademy" };
export default function KontaktPage() {
  return (
    <>
      <p className="pa-legal-eyebrow">Dein Draht zur Academy</p>
      <h1>Kontakt</h1>
      <p className="pa-legal-intro">
        Fragen zu Training, Camps oder deinem Shopkauf? Melde dich bei unserem
        Team.
      </p>
      <div className="pa-legal-panels">
        <section>
          <h2>E-Mail</h2>
          <a className="pa-contact-value" href={`mailto:${company.email}`}>
            {company.email}
          </a>
        </section>
        <section>
          <h2>Telefon &amp; WhatsApp</h2>
          <a className="pa-contact-value" href={company.phoneHref}>
            {company.phone}
          </a>
          <p>
            <a
              className="pa-contact-action"
              href={company.whatsapp}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp öffnen ↗
            </a>
          </p>
        </section>
        <section>
          <h2>Firmensitz</h2>
          <address>
            {company.name}
            <br />
            {company.street}
            <br />
            {company.city}
          </address>
        </section>
        <section>
          <h2>Trainingsstandort</h2>
          <address>
            Sportzentrum Schürenkamp
            <br />
            Grenzstraße 1<br />
            45881 Gelsenkirchen
          </address>
          <p>
            Bitte kläre den aktuellen Trainingsort und Termin vor deinem ersten
            Besuch mit unserem Team.
          </p>
        </section>
      </div>
    </>
  );
}
