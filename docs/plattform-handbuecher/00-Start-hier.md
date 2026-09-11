# ProAcademy | Start hier: die Plattformen

Stand: 10.09.2026.

[PDF öffnen](00-Start-hier.pdf)

## 1. Welcher Dienst macht was?

**FÜR ALLE**

Diese Sammlung erklärt die Technik hinter dem Portal in einfacher Sprache. Für die tägliche Trainingsplanung bleibt das separate Benutzerhandbuch der Webapp zuständig.

| Dienst | Aufgabe bei ProAcademy |
| --- | --- |
| Supabase | Anmeldung, Rollen, Kinder, Termine und gespeicherte PDFs. |
| Stripe | Kunden, Abos, Rechnungen und Zahlungsstatus. |
| Cloudflare | Stellt das Portal und den Hintergrunddienst online bereit. |
| Proton Mail | Versendet Login-Mails und freigegebene Portal-Mails. |
| GitHub / Git | Speichert den Programmcode mit Änderungshistorie. |
| Docker | Verpackt den Hintergrunddienst für den Cloudbetrieb. |

> **Für Mitarbeiter:** Du musst diese Dienste nicht selbst einrichten. Ein Coach-Zugang im Portal erteilt keinen Zugang zu deren Verwaltungsoberflächen.

## 2. So hängen die Abläufe zusammen

**FÜR ALLE**

1. **Anmelden:** Das Portal startet die Anmeldung. Supabase prüft den Zugang und verschickt die Login-Mail über Proton. Danach bestimmt die gespeicherte Portalrolle den erlaubten Bereich.

2. **Training speichern:** Das Portal schreibt Termin und Teilnahme nach Supabase. Ein passender Mailauftrag kann dabei in der Warteschlange entstehen.

3. **Aufträge bearbeiten:** Der Hintergrunddienst bei Cloudflare verarbeitet freigegebene Aufgaben. Er erstellt Berichte, speichert PDFs in Supabase und übergibt E-Mails an Proton.

4. **Abo abgleichen:** Stripe meldet Änderungen an das Portal. Die Nachricht wird zunächst gespeichert und später vom Hintergrunddienst verarbeitet.

### Verbindlicher Stand: 10.09.2026

Die Supabase-Datenbank und das Stripe-Konto sind echte Produktionssysteme. Automatische Jobs bleiben gesperrt; Portal-Mails stehen auf Erfassung statt allgemeinem Versand. Freigegebene Login-Testadressen werden separat behandelt.

> Es gilt ausschließlich [die Worker-Adresse](https://proacademy-portal.proacademy-by-ak.workers.dev). **portal.proacademy-ak.com bleibt inaktiv.** Veröffentlichen nur auf einen ausdrücklichen Deploy-Befehl.

- [ ] Bei einem Fehler: Uhrzeit, betroffene Seite, Aktion und Fehlermeldung notieren. Anmeldelinks, Tokens und Passwörter nicht weitergeben.

Lies zuerst die Seiten 1 und 2 des passenden Handbuchs. Die Befehle auf den späteren Seiten sind für die zuständige technische Administration bestimmt.
