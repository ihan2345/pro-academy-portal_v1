# Rechtliche Seiten und Footer

Am 02.11.2026 aus den öffentlich erreichbaren Seiten von `https://proacademy-ak.com` übernommen und auf ausdrücklichen Nutzerauftrag veröffentlicht. Diese Änderungen werden mit diesem Release auf `main` committet und gepusht.

## Inhalt und Verlinkung

- `/impressum`: öffentlich ohne Anmeldung; Unternehmensname, Vertretung durch Kaan Ayhan, Kenan Karaman und Muhsin Ayhan, Firmensitz, Handelsregister HRB 18998, Umsatzsteuer-ID DE454511553, Kontakt und Angaben zur Aufsichtsbehörde entsprechend dem Original-Impressum.
- `/kontakt`: öffentlich ohne Anmeldung; E-Mail, Telefon, WhatsApp sowie Firmensitz und separat gekennzeichneter Trainingsstandort aus der Hauptseite. Keine neue Kontaktformular- oder Versandlogik.
- `/datenschutz`, `/agb` und `/gs-tb`: HTTP-307-Weiterleitung auf die jeweils gleichnamige Originalseite unter `https://proacademy-ak.com`, damit keine zweite, abweichende Fassung dieser Texte entsteht.
- Gemeinsame Firmen- und Linkdaten: `src/lib/site/company.ts`. Der vollständige Footer enthält Kontaktdaten, Rechtslinks, Verweis zur Hauptseite und deren Instagram-, Facebook-, YouTube- und TikTok-Ziele. Die kompakte Variante enthält Firmenname, Copyright und Rechtslinks.
- Vollständiger Footer im öffentlichen Shop, öffentlichen Camp-Rahmen und auf den neuen Informationsseiten; kompakte Variante im Portal, Login und Geschenk-/Bestellstatus. Bestehende Shopabschluss-Texte und Probetraining-Angebotslink bleiben erhalten.

Quellen: Hauptseiten-Footer und FAQ unter `https://proacademy-ak.com/`, Impressum unter `https://proacademy-ak.com/impressum` sowie die verlinkten Originalseiten. Die Inhalte wurden übernommen, nicht rechtlich neu formuliert oder hinsichtlich ihrer Vollständigkeit für das Portal geprüft. Cookie-Einstellungen der Hauptseite werden nicht als funktionsloser Portal-Schalter dupliziert.

## Prüfung

TypeScript erfolgreich. Impressum und Kontakt anonym HTTP 200; die drei Weiterleitungen HTTP 307 mit exaktem Originalziel. Alle vier Original-Rechtsseiten liefern HTTP 200. Browserprüfung von Impressum-Navigation sowie Footer/Impressum bei 1280px und 390px ohne horizontalen Überlauf. Die lokale Docker-Datenbank war ausgeschaltet; die Shopdarstellung wurde daher in einer datenbankfreien, ausschließlich lokalen Vergleichsseite mit dem originalen Footer-Markup und denselben Shop-Stilen abgenommen. Keine Kauf-, Zahlungs-, Berechtigungs- oder Datenbanklogik geändert.

Private Nachweise und Bilder: `output/legal-footer-review/`. Lokale Ansichten auf Port 3115: `/impressum`, `/kontakt`, `/footer-vorschau`. Die Vorschauseite liegt ausschließlich im ignorierten lokalen Projekt und wird nicht veröffentlicht.

## Veröffentlichung am 02.11.2026

Portal-Version `e6aa8877-a12a-4b3d-926d-90c057950642` erhält 100 % Traffic. Frische Dependencies aus dem Lockfile und isolierter Produktionsbuild inklusive TypeScript erfolgreich; sämtliche 336 Laufzeit- und Konfigurationsdateien entsprechen dem geprüften Workspace. Produktive Abnahme: Impressum und Kontakt HTTP 200, Datenschutz/AGB/Gewinnspielbedingungen HTTP 307 mit exakt den Originalzielen. Öffentlicher Shop liefert den vollständigen Footer mit allen Rechtslinks. Die ausgelieferten Footer-, Produkt- und Stripe-Verwaltungsdateien stimmen anhand SHA-256 mit dem Build überein; Produktkatalog, Preise, Geschenkwerte, Premium-/Empfehlungseffekte, Jobs-Runner und Cloudflare-Bindings sind unverändert. Bestehender anonymer Admin-API-Zugriffsschutz bleibt erhalten. Keine Migration oder Änderung an Produktdaten erforderlich. Lokale Vorschauseiten sind produktiv nicht erreichbar.

Build-, Veröffentlichungs- und Prüfbelege: `output/legal-footer-release/`.
