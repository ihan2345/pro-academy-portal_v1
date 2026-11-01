import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="pa-legal-page">
      <header className="pa-legal-header">
        <Link className="pa-footer-brand" href="/produkte">
          PRO<span>ACADEMY</span>
          <small>BY AYHAN &amp; KARAMAN</small>
        </Link>
        <Link className="pa-legal-back" href="/produkte">
          Zurück zum Shop ↗
        </Link>
      </header>
      <main className="pa-legal-content">{children}</main>
      <SiteFooter />
    </div>
  );
}
