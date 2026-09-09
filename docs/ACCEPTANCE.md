# Abnahme und manuelle Einrichtungscheckliste

## Automatisierte lokale Abnahme

Der genaue Abschlussstand und die ausgeführten Befehle stehen am Ende dieser Datei. Externe Abhängigkeiten werden nicht als getestet ausgegeben, wenn keine Zugangsdaten vorhanden sind.

- Unit: alle vorgegebenen Puffer-Endzeiten, Nachtpause, deutscher DST-Beginn/-Ende, explizite Zeitzone, Mitternacht, Stripe-Intervall, Anspruch, Minuten, geplante vs. absolvierte Stempel.
- Datenbank: alle Migrationen; RLS auf allen Tabellen; zwei fremde Eltern und mehrere eigene Kinder; Staff/Admin-Abgrenzung; Termin mit mehreren Kindern; atomare Planungsmail; Eindeutigkeit; Ausnahme; automatische Nachholung; nachträgliche Korrektur; PDF-Snapshots, private Storage-Objekte; Neuversand; historische Ansprüche; Outbox-/Stripe-Leases; Einmal-Einladung; Terminstornierung; SQL-/TypeScript-Puffervergleich.
- API-Sicherheit: Stripe-Rohbody-Signatur einschließlich Manipulation, Livekey-Sperre, Origin-Prüfung, Cron-Authentifizierung, deaktivierte Elternstornierung, Testempfänger und HTML-Escaping.
- PDF: echtes Dokument erzeugen und wieder einlesen, mehrseitige Ausgabe; Beispiel-PDF rendern und visuell prüfen.
- Browser: Desktop und Mobile – Kindwechsel, Stempel, Termin-Dialog und WhatsApp, neue Planung, Ausnahme, Elternsicht, PDF-Download, Konfigurationshinweise, Adminformular, gesperrte API-Aufrufe.

## Noch auszuführende externe Testabnahme

Die inzwischen durchgeführte Einrichtung des künftigen Launch-Projekts ist separat in [LAUNCH-SETUP.md](LAUNCH-SETUP.md) dokumentiert. Die folgenden Tests mit fiktiven Familien bleiben einem getrennten Testprojekt vorbehalten.

Diese Schritte benötigen eingerichtete eigene Testkonten. Sie wurden **nicht** gegen externe Dienste ausgeführt.

| Prüfschritt                                           | Erwartetes Ergebnis                                                                  | Status |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| Neues Supabase-Testprojekt migrieren                  | Tabellen, RPCs, Rollen und privater Bucket vorhanden                                 | Offen  |
| Zwei echte Auth-Testeltern über Einladung anmelden    | E-Mail bestätigt; Token genau einmal verbraucht; dauerhafte UUID-Zuordnung           | Offen  |
| Fremdes Kind mit realem JWT über REST/Storage abrufen | Leeres Ergebnis/403, kein PDF-Signed-URL                                             | Offen  |
| Zwei Kinder und zwei Eltern explizit verbinden        | Korrekte Kindwechsel und separate Empfänger                                          | Offen  |
| Staff erzeugt Termin für beide Testkinder             | Atomare Zuweisung und je Elternteil Planungsmail                                     | Offen  |
| Staff entschuldigt ein Kind vor Frist                 | Nur das andere Kind wird nach Ablauf bestätigt                                       | Offen  |
| Cron zweimal und nach simulierter Pause ausführen     | Kein Doppelzählen, keine doppelten Versandaufträge                                   | Offen  |
| Proton-Testempfänger prüfen                           | Planungsmail sofort, Teilnahme erst nach Statuswechsel, keine echten Elternempfänger | Offen  |
| Stripe-CLI-Webhook erneut zustellen                   | Eine Inbox-Zeile; kein doppelter Zeitraum                                            | Offen  |
| Stripe-Testuhr in neuen Abrechnungszyklus bewegen     | Historischer Zeitraum unverändert; neuer Zeitraum anhand Stripe-Items                | Offen  |
| Zyklusabschluss 08:00 Berlin bei offener Teilnahme    | Bericht versandt, Status „Prüfung ausstehend“, keine vorzeitige Bestätigung          | Offen  |
| PDF korrigieren und neu versionieren                  | Alte Datei unverändert, neue Version separat                                         | Offen  |
| Cloudflare-Testdomain und Node-Runner                 | Session-Refresh, SMTP-TLS, Cron, Signed URLs und PWA funktionieren                   | Offen  |
| Last-/Ausfalltest mit tatsächlicher Datenmenge        | Alle fälligen Aufträge nachgeholt; Fehler sichtbar                                   | Offen  |

## Einrichtung abhaken

- [ ] Nicht produktives Supabase-Projekt und getrennte Secrets
- [ ] Migrationen und Seed ausgeführt
- [ ] Magic-Link-Redirects und Supabase Auth SMTP konfiguriert
- [ ] Eigener Admin und Trainer angelegt
- [ ] `reports` Bucket privat und RLS kontrolliert
- [ ] Offizielles Logo und lizenzierte Schrift bereitgestellt
- [ ] Drei Stripe-Testpreise zugeordnet
- [ ] Stripe-Testportal und sieben Webhook-Ereignistypen konfiguriert
- [ ] Bestandskunden einzeln bestätigt und zugeordnet
- [ ] Proton-Token, Absender, SPF/DKIM/DMARC geprüft
- [ ] Nur eigene Testadresse als Versandempfänger aktiviert
- [ ] Node-Jobrunner und starkes Cron-Secret eingerichtet
- [ ] Cloudflare-Testprojekt, Secrets, Cron und HTTPS-Subdomain eingerichtet
- [ ] Externe Tests vollständig erfolgreich dokumentiert
- [ ] Ausdrückliche Freigabe für eine spätere Live-Schaltung erhalten

**Keine dieser Freigaben wird durch einen lokalen grünen Testlauf ersetzt.**

## Ausführbarer externer Supabase-Vertragstest

`scripts/test-external.ts` ist mit `npm run test:external` ausführbar, nachdem das **entbehrliche, separat migrierte** Testprojekt konfiguriert und `SUPABASE_ENVIRONMENT=test`, `APP_MODE=test` sowie `EXTERNAL_TESTS_CONFIRM=DISPOSABLE_SUPABASE_TEST_PROJECT` gesetzt wurden. Der Ablauf erzeugt echte Supabase-Testbenutzer, prüft Magic-Link-Tokens ohne SMTP, einmalige Einladungen, echte JWT/RLS-Zugriffe, Gruppenplanung, Ausnahmen, automatische Bestätigung, private Storage-Downloads und Capture-Mails. Er verwendet synthetische historische Stripe-Referenzen und verschickt keine E-Mails. Testdaten bleiben zur Audit-Prüfung bestehen. Der Lauf ist nicht Teil der lokalen grünen Tests und wurde ohne externe Zugangsdaten nicht ausgeführt. Echte Stripe-Zykluswechsel und Proton-Zustellung bleiben separate Pflichtpunkte oben.

## Lokal ausgeführter Abschlussstand · 09.09.2026

| Prüfung                                                         | Ergebnis                                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| TypeScript Strict / `npm run typecheck`                         | Erfolgreich                                                                         |
| Vitest / `npm test`                                             | 53 Tests erfolgreich, einschließlich aller Migrationen unter Postgres/PGlite        |
| Playwright / `npm run test:e2e`                                 | 10 Tests erfolgreich: 5 Abläufe jeweils Desktop und Mobile                          |
| Next.js Produktionsbuild                                        | Erfolgreich                                                                         |
| OpenNext Cloudflare-Build                                       | Erfolgreich; Node-Proxy als experimentell gekennzeichnet                            |
| Lokale echte Worker-Runtime (Wrangler/workerd)                  | Dashboard HTTP 200, PDF-Download HTTP 200                                           |
| PDF-Rendering und visuelle Kontrolle                            | Einseitiger Beispielbericht ohne Überlappungen; Link und Mehrseitenfunktion geprüft |
| npm Dependency Audit                                            | 0 bekannte Sicherheitslücken                                                        |
| Supabase/Stripe/Proton extern, DNS, Cloudflare-Veröffentlichung | Nicht durchgeführt; Zugangsdaten und Freigabe fehlen                                |

Die lokale Vorschau ist eine isolierte Demo. Erfolgreicher Build und Tests bestätigen keine Produktionsreife oder externe Zustellung. Original-Logo und lizenzierte Originalschrift bleiben offene Markenassets.
