# ProAcademy – Architektur vor Implementierungsbeginn

Stand: 09.09.2026. Eigenständige Neuentwicklung, keinerlei Website-Code übernommen. Ausschließlich Testsysteme. Keine Veröffentlichung oder Nachrichten an echte Eltern ohne Freigabe.

## 1. Architektur

Next.js App Router, React, TypeScript strict und Tailwind. Server Components prüfen Supabase-Sessions, Route Handler validieren Eingaben mit Zod. Supabase Postgres mit RLS ist die Datenquelle; privilegierte Transaktionen laufen über eng begrenzte RPCs. Supabase Auth übernimmt Magic Links; Storage speichert private, versionierte PDFs. Stripe wird ausschließlich serverseitig angesprochen. OpenNext erzeugt einen Cloudflare Worker. Ein separater Node-Jobrunner übernimmt Proton SMTP (STARTTLS) und Jobs; Cloudflare Cron löst HTTPS-Jobs aus. Kein SMTP aus dem Browser oder aus einem Sites-Worker. Die Anwendung setzt konfigurierte Konten und eine echte Anmeldung voraus; ein Demo-Modus ist nicht enthalten.

## 2. Datenmodell

UUID-Primärschlüssel, timestamptz in UTC, created_at/updated_at, FKs, RLS und Indizes. profiles gehört 1:1 zu auth.users, parents optional 1:1 zu profiles und zu einem Stripe-Kunden; parent_players bildet m:n-Eltern/Kind-Beziehungen ab. staff_profiles verweist auf profiles. plans enthält eindeutige Stripe-Preise und feste Einheiten. subscriptions speichert Stripe-Abonnement und Kunde; subscription_players bildet eine explizite Zuordnung zu Spielern ab. entitlement_periods speichert pro Spieler/Abonnement/Stripe-Item/Start einen unveränderlichen historischen Produkt-, Preis- und Anspruchssnapshot. training_events hat Standort, Trainer, UTC-Start/-Ende und Bestätigungsfrist. event_participants ist eindeutig pro Termin/Spieler und hat einen passenden Leistungszeitraum. Interne Notizen stehen separat in event_private_notes. parent_invitations speichert ausschließlich Token-Hashes, bestätigte Zieladresse, Eltern-ID, Ablauf und Verbrauch. notification_jobs/deliveries bilden Outbox und Versandhistorie. report_snapshots/files/deliveries trennen Inhalt, private Datei und Versand. audit_log ist append-only. stripe_webhook_events ist eine idempotente Inbox. system_settings ist admin-only. Zusätzliche job_runs protokollieren Ausfälle.

## 3. Rollen und Rechte

Parent: ausschließlich eigene Zuordnungen lesen, eigene Stripe-Portalsession und private Berichte anfordern. Keine Termin-/Teilnahme-Mutation. Staff: Termine/Teilnehmer/Standorte/Trainer lesen, Termine und Ausnahmen über validierte Transaktionen verwalten; keine Rollen, Stripe-Zuordnungen, Systemkonfiguration oder Berichte. Admin: alle Verwaltungsfunktionen. Rollen stammen aus einer geschützten Tabelle, niemals aus vom Nutzer editierbaren Metadaten. Jede Route und jede RLS-Regel prüft Rechte unabhängig von der Navigation. Service Role wird nur im geschützten Jobrunner und Webhook/Importprozess eingesetzt.

## 4. Seiten

/ (Elternübersicht), /termine (geplant/vergangen + Details), /stempelkarte, /berichte, /konto, /login, /auth/callback, /einladung. /team (Tag/Woche, Editor, Ausnahmen). /admin (Übersicht), /admin/spieler, /admin/eltern, /admin/mitarbeiter, /admin/standorte, /admin/produkte, /admin/stripe, /admin/einladungen, /admin/protokolle, /admin/einstellungen. Gemeinsame responsive Navigation; mobile kompakte Navigation. Der lokale Test verwendet eine getrennte Datenbank und echte Anmeldung.

## 5. Stripe und Supabase

Webhook-Rohbody vor JSON-Verarbeitung signaturprüfen; Live-Ereignisse im Testbetrieb ablehnen. Stripe-Event-ID einmalig in Inbox speichern. Asynchron aktuellsten Zustand abrufen, Inbox nach Erfolg markieren. Kunden-E-Mail ist nur Importvorschlag. Admin bestätigt Eltern/Kinder-Zuordnung; Einladung ist an Eltern-ID + Stripe-Kunde gebunden. Token als kryptografische Zufallsbytes, nur SHA-256 in DB. Nach Magic-Link-Login müssen verifizierte E-Mail, Ablauf und Token passen; atomarer Verbrauch bindet auth_user_id -> parent_id -> stripe_customer_id. Keine spätere Autorisierung anhand Stripe-E-Mail. Mehrere Stripe-Items/Abos und Eltern pro Kind möglich; Abonnement-Item muss vor Anspruchserzeugung explizit Kind zugeordnet sein. Zeiten aus Stripe-Item current_period_start/end, niemals +30 Tage; halboffene Intervalle [start,end). Ein begonnenes Intervall wird bei Tarifwechsel nicht überschrieben; Fälle werden zur manuellen Prüfung markiert.

## 6. Hintergrundjobs

Ein authentifizierter Aufruf mindestens alle 10 Minuten verarbeitet Stripe-Inbox, automatische Bestätigung, abgeschlossene Zyklen, PDFs, Outbox und abgelaufene Einladungen. Atomare claim-RPCs mit SKIP LOCKED/Lease schützen konkurrierende Prozesse; Wiederanlauf verarbeitet alle fälligen Einträge, nicht nur das letzte Zeitfenster. Unique Keys verhindern doppelte Teilnahme-/Planungs-/Berichtsaufträge. Postgres-Transaktionen bündeln Ereignisänderung, Outbox und Audit. Jobs führen Fehlerprotokolle und begrenzten exponentiellen Backoff; definitive Fehler gehen in failed. SMTP ist nicht transaktional: ein Verbindungsabbruch nach DATA kann unklaren Versand bedeuten. Solche Aufträge werden als uncertain quarantänisiert und nur nach manueller Klärung erneut freigegeben; kein falsches Exactly-once-Versprechen.

## 7. E-Mails

Provider-Schnittstelle mit Capture-Provider für lokale Tests und Proton-SMTP-Provider auf Node. Planungsmail sofort in Outbox, unabhängig vom Puffer. Teilnahme nur nach attended_auto/manual. Korrekturen behalten die alte Historie und erzeugen optional separate Nachrichten. Jede Elternzuordnung erhält einen eigenen, eindeutigen Auftrag. Testmodus überschreibt sämtliche Empfänger mit einer konfigurierten Testadresse; ohne diese wird nur lokal erfasst. Magic-Link-Mails werden separat über Supabase SMTP eingerichtet. Keine externen E-Mails während Entwicklung.

## 8. PDF

Zyklusbericht am lokalen Enddatum zur konfigurierten Zeit (Standard 08:00 Europe/Berlin), nie vor period_end. Keine Warteabhängigkeit zu Teilnahmefristen. Noch planned und bereits vergangen = Prüfung ausstehend. Unveränderlicher JSON-Snapshot + PDF-Version + privater Storage-Pfad. Berichtserzeugung, Upload und Auftrag wiederholbar; eindeutige initiale Version. Nachträgliche Korrektur erzeugt bewusst neue Version. Downloads nur nach RLS-Prüfung via kurzlebigem signed URL bzw. authentifiziertem Download. PDF enthält Marke/Platzhalter, Kind, Produkt, Zeitraum, Stempel, Minuten, Termine, Status, Erstellungszeitpunkt, WhatsApp-Link.

## 9. Sicherheit

RLS auf allen App-Tabellen; explizite Policies, keine pauschalen authenticated-Schreibrechte. Authenticated RPCs bestimmen Rolle selbst, SECURITY DEFINER mit festem search_path und minimalen Grants. Server-Routen prüfen Session, Rolle, Origin bei Mutationen und Zod-Schemas. Keine Secrets im Client. Cron-Bearer-Secret, konstante Zeit beim Vergleich, Webhook-Signatur, sensible Antworten no-store, private Storage-Buckets, kein personenbezogenes Offline-Caching. Einladungstoken kurzlebig und einmalig. CSP, Frame-Schutz, Referrer Policy. Keine Elternstornoroute im MVP; selbst mit Flag true bleibt diese unimplementiert und gesperrt. Stripe-Livekeys und echter SMTP-Versand werden zusätzlich durch Testkonfiguration gesperrt.

## 10. Tests

Unit: Pufferzeit inklusive 00:00/06:00, deutscher Sommer-/Winterzeit und expliziter Mitternachtskonvention, Stripe-Perioden, Tarife, Stempel und Minuten. Integration: reale Postgres-Semantik in PGlite mit auth/storage-Testschema für Migrationen, Transaktionen, Jobs und RLS. Sicherheit: fremdes Kind/Datei, Staff/Admin, direkte Elternmutation, manipulierte Webhooks. Browser-E2E: Kindwechsel, Zugriffsrechte, echte Speicherung ohne Geburtsjahr, PDF und mobile Ansicht gegen die lokale Datenbank; externe Auth/Stripe/SMTP-End-to-End separat gegen eingerichtete Testkonten. Tests ohne externe Konten dürfen keinen erfolgreichen Cloud-Test behaupten.

### Puffer-Grenzfall

Die Vorgabe 12:00 -> 06:00 am Folgetag priorisiert die genannten Beispiele: Wenn 12 aktive Stunden exakt um 00:00 voll sind, normalisiert die Funktion auf 06:00. Alle anderen Berechnungen zählen reale Stunden im lokalen aktiven Fenster. Zeitzone ist explizit, Standard Europe/Berlin.

## 11. Umgebungsvariablen

Vollständig in .env.example: APP_URL, NEXT_PUBLIC_APP_URL, APP_MODE, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PORTAL_CONFIGURATION_ID, PROTON_SMTP_HOST/PORT/USER/TOKEN, EMAIL_FROM, EMAIL_TEST_MODE, EMAIL_TEST_RECIPIENT, MAIL_PROVIDER, WHATSAPP_NUMBER, PARENT_CANCELLATION_ENABLED, REPORT_SEND_TIME, CRON_SECRET, JOB_RUNNER_URL/PORT, DATABASE_URL. Test und Produktion getrennt.

## 12. Manuelle Einrichtung

Supabase-Testprojekt + Migration + Seed; Auth Redirects/Proton SMTP, Testbenutzer/ersten Admin anlegen. Stripe-Testprodukte/Preise zuordnen, Portal und Webhooks registrieren, Kunden über Import explizit zuordnen. Proton-Token für eigene Absenderadresse, DNS SPF/DKIM/DMARC, Testempfänger. Cloudflare OpenNext-Worker + separater privater Node-Jobrunner + Cron + Secrets + Domain; keine Veröffentlichung im aktuellen Auftrag. Offizielles Logo/Schriftlizenz prüfen und ergänzen, falls nicht verfügbar. Detaillierte Checkliste folgt in README.

## 13. Entwicklungsphasen und Akzeptanz

1. Konzept: alle 13 Abschnitte vor Produktcode dokumentiert.
2. Fundament: installierbares Next-Projekt, strict typecheck, Supabase-Migration + RLS, getestete Fachfunktionen.
3. Portale: responsive Elternübersicht mit Kindwechsel, Stempeln/Terminen/Berichten; Mitarbeiterplanung und Ausnahmen; Admin-Verwaltung. Ausschließlich angemeldeter Datenbankbetrieb.
4. Integrationen: Magic Link/Einladung, Stripe Inbox/Sync/Portal, Outbox/SMTP, PDF/Storage, Jobs und Audit implementiert. Fehlende externe Konfiguration wird klar angezeigt.
5. Abnahme lokal: Build, Unit/DB/Sicherheits- und verfügbare Browsertests erfolgreich; PDFs visuell geprüft; Anleitungen und ehrliche Testmatrix vorhanden.
6. Externe Testabnahme (nach Einrichtung): Stripe CLI + nicht produktives Supabase + eigener SMTP-Testempfänger + Worker-Preview. Freigabe bleibt Voraussetzung für Livebetrieb.

## Implementierungsabgleich

Die SQL-Funktion ist die verbindliche Quelle für Bestätigungsfristen; TypeScript wird mit 27 SQL-Gegenproben verglichen. Mehrere bestätigte Eltern dürfen denselben Stripe-Kunden teilen; ein zusammengesetzter Index verhindert doppelte Kontaktzuordnungen. Nicht versandte/unklare Mail-Aufträge bleiben prüfbar, bereits versandte Einladungs-URLs werden aus der Outbox entfernt. Tabellenzuordnungen können durch Admins bewusst aufgehoben werden, mit unveränderlichem Audit-Eintrag. Datenbanktests laufen vollständig lokal; ein zusätzliches Skript für echte Supabase-Auth-/REST-/Storage-Verträge ist vorbereitet.

## Aktualisierung: Tarifgenerationen (09.09.2026)

Die spätere Launch-Vorbereitung und endgültige Nutzerkorrektur erweitern das ursprüngliche Modell: Bestandskunden 4/8/10, Neukunden ab 01.09.2026 4/8/12, Jahresabo 10 pro Monat und NEXT LEVEL 8 Fußball + 4 Athletik. `plans` enthält je Preis eine Variante; Namen sind absichtlich nicht eindeutig. Monatsabos verwenden unveränderte Stripe-Perioden, jährliche Zahlungen erhalten zwölf am Originalstart verankerte Monatskontingente. Kontingent-Snapshots speichern Gesamt- und Athletikeinheiten getrennt. Einzelheiten und Abnahme siehe [TARIFF-RULES.md](TARIFF-RULES.md) und [LAUNCH-SETUP.md](LAUNCH-SETUP.md). Supabase ist inzwischen ausdrücklich das zukünftige Produktionsprojekt; lokale Fixture-Tests laufen ausschließlich in PGlite.
