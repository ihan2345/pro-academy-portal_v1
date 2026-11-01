import { company, legalLinks, socialLinks } from "@/lib/site/company";

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer
      className={`pa-site-footer${compact ? " pa-site-footer-compact" : ""}`}
    >
      {!compact && (
        <div className="pa-footer-grid">
          <div className="pa-footer-intro">
            <a
              className="pa-footer-brand"
              href={company.website}
              target="_blank"
              rel="noreferrer"
            >
              PRO<span>ACADEMY</span>
              <small>BY AYHAN &amp; KARAMAN</small>
            </a>
            <p>
              Fußball mit Struktur. Persönliche Entwicklung. Gemeinsam den
              nächsten Schritt gehen.
            </p>
            <nav
              className="pa-footer-social"
              aria-label="ProAcademy auf Social Media"
            >
              {socialLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
          <div>
            <h2>Kontakt</h2>
            <address>
              <span>{company.name}</span>
              <span>{company.street}</span>
              <span>{company.city}</span>
              <a href={company.phoneHref}>{company.phone}</a>
              <a href={`mailto:${company.email}`}>{company.email}</a>
            </address>
          </div>
          <nav aria-label="Rechtliches und Kontakt">
            <h2>Gut zu wissen</h2>
            {legalLinks.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
            <a href={company.website} target="_blank" rel="noreferrer">
              Zur ProAcademy Website ↗
            </a>
          </nav>
        </div>
      )}
      <div className="pa-footer-bottom">
        <span>
          © {new Date().getUTCFullYear()} {company.name}
        </span>
        {compact && (
          <nav aria-label="Rechtliches und Kontakt">
            {legalLinks.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        )}
        {!compact && <span>Built. Not Born.</span>}
      </div>
    </footer>
  );
}
