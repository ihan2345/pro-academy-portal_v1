# ProAcademy Eltern- und Trainingsportal

**KI-Systemkontext:** [Architektur, Datenmodell, Schnittstellen und geprüfter Betriebszustand](docs/ki/SYSTEMKONTEXT.md) · [maschinenlesbare Schema-Referenz](docs/ki/SCHEMA-REFERENZ.json). Stand 13.09.2026; enthält auch Funktionsgrenzen und Hinweise für sichere Weiterentwicklung.

**Benutzerhandbuch:** [PDF für Coaches und Admins](docs/ProAcademy-Benutzerhandbuch.pdf) · [durchsuchbare Textfassung](docs/BENUTZERHANDBUCH.md). Große Schrift, Schrittfolgen und Bildschirmbilder mit Beispieldaten.

**Externe Plattformen:** [Handbuchsammlung für Supabase, Stripe, Cloudflare, Proton, GitHub und Docker](docs/plattform-handbuecher/README.md) · [Übersicht als PDF](docs/plattform-handbuecher/00-Start-hier.pdf). Separate PDFs und Textfassungen; bei der Erstellung automatisch in den gewünschten Desktop-Ordner `Portal/Plattform-Handbuecher` kopiert.

**Produkte – lokale Erweiterung:** [Umsetzung, Start und Prüfbericht](docs/PRODUCT-MANAGEMENT-LOCAL.md). Separate Supabase-Testinstanz mit erfundenen Familien; Einstieg `http://127.0.0.1:3110/lokaler-test`. Stundenangaben, Tarifpflege, automatischer Stripe-Testabgleich und echte Testabläufe vorhanden. Weitere Zahlungs-Sonderfälle und Cloudflare-Paketierung stehen noch aus; kein Deployment.

**Zukünftige Funktionen:** [V2.0 – dauerhafte Checkliste für die nächste Version](V2.0.md). Dort sammeln wir vorgemerkte Optimierungen getrennt von der aktuellen Veröffentlichung.

**Deployment-Sperre (aktuelle Nutzeranweisung): Änderungen nur lokal umsetzen und prüfen. Kein Deployment ohne einen neuen ausdrücklichen Deploy-Befehl des Nutzers.**

**Veröffentlichungsvorgabe vom 10.09.2026:** Vorerst ausschließlich unter `https://proacademy-portal.proacademy-by-ak.workers.dev` veröffentlichen. `portal.proacademy-ak.com` bleibt für dieses Portal deaktiviert, bis der Nutzer ausdrücklich anders anweist. Keine Custom-Domain-Route und keinen DNS-Eintrag dafür anlegen. Build-URL, Supabase-Weiterleitungen und Stripe-Webhook auf die Worker-Adresse ausrichten.

Eigenständige Next.js-App für Eltern, Mitarbeiter und Admins. Neu aufgebaut, ohne Code oder Datenbank der Marketing-Website. **Unter der Cloudflare-Worker-Adresse bereitgestellt; Supabase-Anmeldung und Adminzugriff erfolgreich geprüft. Stripe-Webhook verbunden und Signaturprüfung getestet. 84 Familien mit 91 Kindern sind intern importiert. Nur der automatische Stripe-Abo-Abgleich ist aktiviert; Elternfreigabe, Versand und übrige Hintergrundverarbeitung bleiben gesperrt.** Siehe [aktuellen Einrichtungsstand](docs/LAUNCH-SETUP.md).

## Lokal öffnen

Voraussetzungen: Node.js 24 und npm. Der erste Start benötigt keine Cloud-Zugangsdaten.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Die Anwendung benötigt eine konfigurierte Supabase-Datenbank und eine echte Anmeldung. Ein Demo-Modus ist nicht enthalten. Der getrennte lokale Test mit den bestätigten Zuordnungen läuft unter http://127.0.0.1:3107/lokaler-test; Einrichtung und Neustart stehen in [scripts/local-family-test/README.md](scripts/local-family-test/README.md).

## Projektstruktur

| Pfad                   | Inhalt                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `docs/ARCHITECTURE.md` | Vor Implementierung erstelltes Konzept: alle 13 geforderten Bereiche und Akzeptanzkriterien |
| `src/app`              | App Router, Login, Einladungen, Auth-Callback und API                                       |
| `src/components`       | Responsive Eltern-, Mitarbeiter- und Adminansichten                                         |
| `src/lib/domain.ts`    | Zeitzone, Pufferzeit, Stempelkarte, Statistiken und Leistungszeiträume                      |
| `src/lib/server`       | Supabase, Rollenprüfung, Stripe-Inbox/Sync und Berichte                                     |
| `src/lib/pdf.ts`       | Mehrseitige, versionierte Trainingsberichte                                                 |
| `src/lib/mail.ts`      | Provider-Schnittstelle, Capture und Proton STARTTLS                                         |
| `supabase/migrations`  | Vollständiges Datenmodell, RLS, transaktionale RPCs, Audit und Outbox                       |
| `supabase/seed.sql`    | Idempotenter Testkatalog ohne echte Familien oder Stripe-Preise                             |
| `workers`              | Separater Node-Jobrunner und Cloudflare-Cron-Worker                                         |
| `tests`                | Unit-, Postgres-/RLS-, Sicherheits-, PDF- und Browser-Tests                                 |
| `docs/ACCEPTANCE.md`   | Lokale Testnachweise und externe Testabnahme                                                |
| `docs/BRANDING.md`     | Herkunft der Markenreferenz und noch benötigte Original-Assets                              |
| `docs/OPERATIONS.md`   | Fehlerbehandlung, Wiederanlauf und Betrieb                                                  |

## Supabase-Testumgebung einrichten

**Aktueller Launch-Stand:** Das vom Nutzer ausgewählte Projekt ist als künftige Produktionsdatenbank eingerichtet. Details und noch offene Schritte stehen in [docs/LAUNCH-SETUP.md](docs/LAUNCH-SETUP.md). Die folgende Anleitung gilt für ein zusätzliches, separates Testprojekt. Auf dem Launch-Projekt keinen Test-Seed und keine Fixture-Tests ausführen.

1. Ein **neues, nicht produktives** Supabase-Projekt anlegen. Keine Marketing-Datenbank verwenden. Projektregion passend zu euren Anforderungen auswählen.
2. Project Settings → API: Projekt-URL und Anon-/Publishable-Schlüssel in `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` eintragen. Den Service Role Key nur serverseitig als `SUPABASE_SERVICE_ROLE_KEY` hinterlegen. Er gehört niemals in `NEXT_PUBLIC_*`.
3. Supabase CLI installieren und anmelden. `supabase link --project-ref <TEST_PROJECT_REF>` verbindet ausschließlich das ausgewählte Testprojekt. Vorher den Project Ref nochmals prüfen. Dann `supabase db push` ausführen. Alternativ jede SQL-Datei aus `supabase/migrations` in Dateinamenreihenfolge über den SQL Editor ausführen. Anschließend `supabase/seed.sql` ausführen.
4. Lokal mit Docker sind `supabase start` und `supabase db reset` möglich. **Reset löscht die lokale Datenbank; niemals unbesehen auf vorhandenen Daten ausführen.**
5. Auth → URL Configuration: Site URL auf `APP_URL` setzen. Redirect URLs explizit auf `http://127.0.0.1:3000/auth/callback` und später die exakte Testdomain mit `/auth/callback` beschränken. Keine freien Wildcards für Produktion.
6. Auth → Providers → Email aktivieren; E-Mail-Bestätigung aktivieren. Supabase-Ratelimits und Schutz gegen Missbrauch aktiv lassen. OTP/Magic-Link-Lebensdauer sinnvoll begrenzen, z. B. auf eine Stunde. Die Anwendung verwendet PKCE und `exchangeCodeForSession`.
7. Auth → SMTP: eigene Proton-SMTP-Daten eintragen. Die **Auth-E-Mails** werden von Supabase versendet und sind unabhängig vom App-Jobrunner. Im Testbetrieb werden Login-Anfragen serverseitig auf `EMAIL_TEST_RECIPIENT` begrenzt.
8. Auth → Users: zunächst euren eigenen bestätigten Admin-Testbenutzer anlegen. UUID kopieren und im SQL Editor folgendes mit der echten **Test-UUID** ausführen:

```sql
insert into public.profiles(id, full_name, role)
values ('<ADMIN_AUTH_UUID>', 'Test Admin', 'admin');
```

9. Für den ersten Trainer einen eigenen Auth-Testbenutzer anlegen. Dann:

```sql
insert into public.profiles(id, full_name, role)
values ('<STAFF_AUTH_UUID>', 'Test Trainer', 'staff');
insert into public.staff_profiles(id, display_name)
values ('<STAFF_AUTH_UUID>', 'Test Trainer');
```

10. Storage: Die Migration erstellt den Bucket `reports` mit `public=false`. Dies in der Oberfläche kontrollieren. Keine öffentlichen Downloads oder zusätzlichen Upload-Policies hinzufügen. Nur zugeordnete Eltern und Admins lesen; Staff erhält keinen PDF-Zugriff.
11. Den Next-Server neu starten und Admin über `/login` mit der eigenen Testadresse anmelden. Neue Eltern erhalten ihre Profile erst durch eine erfolgreich geprüfte Einladung.
12. Spieler, Standorte und weitere Trainer im Adminbereich pflegen. Weitere Profile müssen zuerst in Supabase Auth angelegt sein. Rollenänderungen sind admin-only; eine Selbständerung der Adminrolle ist gesperrt.

## Stripe-Testkonto verbinden

1. Im Stripe Dashboard **Testmodus** aktivieren. Getrennte Testpreise für die Tarifvarianten verwenden: Bestand 4/8/10, Neu 4/8/12, Pro-Jahresabo 10 pro Monat, NEXT LEVEL 8 Fußball + 4 Athletik. Migration 006 enthält die bestätigten Live-Preiszuordnungen des Launch-Projekts; in einer separaten Testdatenbank diese durch eigene Testpreis-IDs ersetzen. Niemals Fixture-Tests im Launch-Projekt ausführen.
2. Den Test-Secret-Key (`sk_test_…`) und optional Publishable Key hinterlegen. Der Server lehnt Livekeys ab, solange `APP_MODE` nicht ausdrücklich `production` ist.
3. `/admin/produkte`: die tatsächlichen `price_…`-IDs den Tarifen zuordnen. Ein Preis ist eindeutig. Anspruch und Produktname werden in begonnenen Leistungszeiträumen festgeschrieben; spätere Preisänderungen überschreiben diese nicht.
4. Billing → Customer Portal konfigurieren. Rechnungen, Rechnungsadresse und Zahlungsmethode freigeben. Eine Test-Portal-Konfiguration in `STRIPE_PORTAL_CONFIGURATION_ID` eintragen.
5. Webhook Endpoint: `https://<TESTDOMAIN>/api/stripe/webhook`. Folgende Typen auswählen: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `customer.updated`.
6. Endpoint Signing Secret als `STRIPE_WEBHOOK_SECRET` hinterlegen. Der Rohbody wird vor jeder Verarbeitung signaturgeprüft. Die Route speichert bestätigte Events in einer Inbox; der Jobrunner synchronisiert sie. Die API-Version ist durch den Stripe-SDK-Lockfile festgehalten (SDK 18, Basil-Datenmodell mit Item-Perioden); den Endpoint passend konfigurieren und vor Versionswechsel testen.
7. Für lokale Tests kann Stripe CLI weiterleiten:

```sh
stripe listen --forward-to 127.0.0.1:3000/api/stripe/webhook
```

Den von diesem CLI-Aufruf ausgegebenen Test-Webhook-Secret verwenden. Keine Testevents ohne Jobrunner als fertig synchronisiert betrachten.

8. `/admin/stripe`: Testkunden laden, aktive/weitere Abonnements sowie Produkt, Preis, Item-ID und Vorschläge prüfen. Kind bei Bedarf zunächst unter `/admin/spieler` anlegen. Bestehende Eltern-ID auswählen/eintragen oder neues Elternkonto mit bestätigter Kontaktadresse anlegen. Kundennummer, Abonnement und Item müssen zusammengehören. Jede Zuordnung explizit bestätigen. Ein bereits mit einem anderen Kind verbundenes Item wird nicht still neu zugeordnet.
9. Der Import synchronisiert vorhandene bezahlte Rechnungszeiträume, verbindet das Kind und erzeugt eine einmalige Einladung. Die Einladung ist sieben Tage gültig; eine Neuausstellung invalidiert ältere ungenutzte Einladungen. Auf derselben Browserinstanz zuerst Einladung öffnen und anschließend den Magic Link öffnen (PKCE).
10. Mehrere Kinder pro Elternkonto, mehrere ausdrücklich zugeordnete Eltern pro Kind und mehrere Abonnements pro Kunde sind im Datenmodell möglich. Ein Stripe-Item mit quantity > 1 wird im MVP nicht automatisch in mehrere Kinder aufgeteilt; je Kind ein Item verwenden.
11. Unterschiedliche Kontakt-/Rechnungs-E-Mails bleiben getrennt. Stripe-E-Mail-Änderungen ändern ausschließlich die Rechnungs-E-Mail und erteilen niemals Anmelderechte.
12. Test- und spätere Live-Keys, Webhook-Secrets, Produkte, Preise, Customer-IDs und Portal-Konfigurationen strikt getrennt halten.

## Proton einrichten und Testversand durchführen

1. Eine berechtigte Proton-Business-Absenderadresse auswählen. In Proton Settings → IMAP/SMTP bzw. SMTP Submission einen **SMTP-Token** für diese Adresse erzeugen. Nicht das normale Kontopasswort verwenden.
2. `PROTON_SMTP_HOST=smtp.protonmail.ch`, `PROTON_SMTP_PORT=587`, Benutzer, Token und `EMAIL_FROM` konfigurieren. Der Provider erzwingt STARTTLS und prüft das TLS-Zertifikat.
3. SPF, DKIM und DMARC für die eigene Domain anhand der Proton-DNS-Vorgaben einrichten und verifizieren.
4. Zunächst `MAIL_PROVIDER=capture`, `EMAIL_TEST_MODE=true` verwenden. Das bedeutet keinen Netzwerkversand. Der App-Jobrunner protokolliert die Aufträge; Capture-Nachrichten werden lokal unter `output/mail` gespeichert.
5. Anschließend ausschließlich für eigene Testnachrichten `MAIL_PROVIDER=proton` und `EMAIL_TEST_RECIPIENT=<EURE_TESTADRESSE>` setzen. Der Provider überschreibt **sämtliche** Empfänger mit dieser Adresse. Bei fehlender Testadresse wird nicht gesendet. Im Modus `APP_MODE=test` ist `EMAIL_TEST_MODE=false` gesperrt.
6. Ein Testtraining zuordnen, Jobrunner auslösen, Planungsmail in eigenem Postfach und `notification_deliveries` prüfen. Eine zulässige vergangene Testteilnahme bestätigen und die Teilnahme-E-Mail prüfen. Einen abgeschlossenen Testzyklus verarbeiten und PDF-Anhang prüfen.
7. Die Supabase-Auth-SMTP-Konfiguration ist zusätzlich erforderlich. Capture des App-Jobrunners erfasst keine Supabase-Magic-Link-Mails.

## Hintergrundjobs

```sh
# Einmalig ein starkes Secret erzeugen; Ausgabe nur in eigener Secret-Verwaltung speichern.
openssl rand -hex 32
# Wert als CRON_SECRET in der lokalen Testkonfiguration eintragen.
npm run jobs
```

Der Node-Prozess lauscht auf Port 3001. Verarbeitung ist nur mit `JOBS_ENABLED=true` aktiv; standardmäßig bleibt sie gesperrt. `POST /verify` prüft nach derselben Authentifizierung Supabase, Stripe, Proton-STARTTLS und PDF-Erzeugung ohne Versand oder Datenbankänderungen. `/run` akzeptiert nur POST mit `Authorization: Bearer <CRON_SECRET>`. Für die App ist `JOB_RUNNER_URL` zu setzen. Für Cloudflare Containers übernimmt `workers/cloudflare/wrangler.jsonc` den zehnminütigen Zeitplan direkt. Der alte Produktions-Cron in `workers/wrangler.toml` bleibt deaktiviert. Manuelle Portal-Aufrufe über `/api/cron` verwenden weiterhin den authentifizierten Runner-Endpunkt.

Die Reihenfolge umfasst Stripe-Inbox, Teilnahmebestätigung, Berichte, Outbox und Einladungsbereinigung. Eine fehlgeschlagene Phase wird protokolliert; unabhängige Phasen laufen weiter. Jobs holen alte fällige Datensätze nach. Atomare Postgres-Claims verhindern doppelte Verarbeitung. **SMTP garantiert kein transaktionales Exactly-once:** Unklare Ergebnisse nach Verbindungsabbruch werden unter `uncertain` angehalten und müssen vor Wiederholung geprüft werden.

Eine PDF-Erzeugung wartet nicht auf die Teilnahme-Pufferregel. Standardversandzeit ist 08:00 Uhr Europe/Berlin, änderbar über Admin-Systemeinstellung `report_send_time`. Niemals vor tatsächlichem Zyklusende. Berichte spiegeln den tatsächlichen Erzeugungszeitpunkt wider; nach einem Ausfall wird nachgeholt.

## Cloudflare vorbereiten (nicht automatisch veröffentlichen)

```sh
npm run build:cloudflare
npm run preview:cloudflare
```

OpenNext erstellt `.open-next/worker.js` und `.open-next/assets`. Die Anwendung verwendet Cloudflare Workers mit `nodejs_compat`. Der separate Cron-Worker steht in `workers/wrangler.toml`. Next.js 16 Node-Proxy wird von der installierten OpenNext-Version noch als experimentell bezeichnet; deshalb ist die Session-Erneuerung auf der echten Testdomain ein Pflichtpunkt der externen Abnahme.

Erst nach ausdrücklicher Bereitstellungsfreigabe:

1. Ein separates Test-Worker-Projekt einrichten; `wrangler.jsonc` auf Testnamen prüfen. Production und Preview getrennt benennen und betreiben.
2. Alle benötigten Server-Secrets über Cloudflare Secret Store bzw. `wrangler secret put <NAME>` hinterlegen. Public Supabase-Werte bereits **beim Build** konfigurieren. `.env.local` niemals hochladen.
3. Den Node-Jobrunner aus `workers/Dockerfile` auf einem privaten Node-/Containerhost bereitstellen. Das Image enthält keine `.env`-Dateien. Secrets zur Laufzeit injizieren; TLS und Zugriffsbeschränkung vor `/run` einrichten. **Proton SMTP läuft hier und nicht direkt in Cloudflare/Sites.**
4. `JOB_RUNNER_URL` auf den HTTPS-Endpunkt des Runners setzen. Den Cron-Worker mit passendem `APP_URL` und demselben starken `CRON_SECRET` konfigurieren. Cron: alle zehn Minuten.
5. Den Test-Worker mit OpenNext/Wrangler deployen. Keine Domain oder produktive Umgebung vor Freigabe verbinden.
6. Test-Subdomain über Cloudflare DNS/Custom Domains verbinden. HTTPS prüfen, `APP_URL`, Auth-Redirects und Stripe-Webhook-URL passend aktualisieren.
7. Alle externen Akzeptanztests in `docs/ACCEPTANCE.md` durchführen. Erst nach erfolgreicher Testabnahme separat über Livebetrieb entscheiden.

## Tests und Qualität

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm run build:cloudflare
npm audit
```

Die Datenbanktests führen alle Migrationen in PGlite (echter Postgres in WASM) mit einem minimalen Supabase-Auth-/Storage-Testschema aus. Sie prüfen echte RLS-Policies und RPC-Transaktionen unter verschiedenen Rollen. Sie ersetzen keine echte Supabase-/GoTrue-/Storage-/Stripe-/SMTP-Testumgebung. Browser-E2E prüfen echte lokale Anmeldung, Datenbankspeicherung, Zugriffsrechte, PDF-Export und gesperrte externe Aktionen. Vorher muss die getrennte lokale Testumgebung laufen.

## Fachliche Entscheidungen

- UTC-Speicherung, sämtliche fachlichen Grenzen in Europe/Berlin, Sommer-/Winterzeit berücksichtigt.
- Zeiträume sind halboffen: `[current_period_start, current_period_end)`. Ende in der Anzeige = letzte Millisekunde vor dem neuen Zeitraum, niemals pauschal +30 Tage.
- Ende 12:00 → Folgetag 06:00 entspricht ausdrücklich dem vorgegebenen Mitternachtsbeispiel. Die SQL-Funktion berechnet den verbindlichen Zeitpunkt; TypeScript wird gegen dieselben Testfälle geprüft.
- Neue Wertungsregel (lokal vorbereitet, Migration 007 noch nicht live): `attended_auto`, `attended_manual`, `cancelled` und `absent` verbrauchen eine Einheit. Absagen/Nichterscheinen erhalten ein rotes OK. Nur tatsächliche Teilnahme zählt zur Trainingszeit. `excused` verbraucht nichts und erscheint mit öffentlichen Termindaten als Notiz. Geplante Termine bleiben offen.
- Elternstornierung bleibt auf UI, API und DB-Ebene gesperrt. Das Flag ist dokumentiert, aktiviert im MVP aber keine Mutation, auch wenn es versehentlich auf true gesetzt wird.
- Terminstornierung löscht keine Termine. Korrekturen benötigen einen Grund. Änderungen an der Zeit bereits bestätigter Termine erfordern zunächst die Korrektur der Teilnahmen, damit historische Minuten nicht unbemerkt verändert werden.
- Berichte und Versandhistorien sind unveränderlich. Neuversand und neue Version sind getrennte Vorgänge.

## Verbleibende Voraussetzungen und MVP-Grenzen

- Es wurden keine externen Konten verbunden und keine echten E-Mails versandt. Externe End-to-End-Abnahme, DNS, TLS und Zugangsdaten müssen noch eingerichtet werden.
- Offizielle Logo-/Schriftdateien fehlen. Aktuelle Wortmarke, PA-App-Icon und Systemschrift sind ausdrücklich dokumentierte Platzhalter.
- Der Bildschirm für Stammdaten ist bewusst einfach: bestehende Auth-UUID für Mitarbeiter, getrenntes Anlegen von Kindern vor Stripe-Zuordnung. Kein umfangreicher CRM-Importassistent, keine Serienplanung und kein Drag-and-drop.
- Je Spieler/Abonnement/Item wird ein Leistungszeitraum erfasst. Quantity-Mengen, rückdatierte Spezialverträge und überlappende Tarifwechsel erfordern manuelle Prüfung. `needs_review` markiert widersprüchliche Stripe-Änderungen; historische Ansprüche bleiben erhalten.
- Listen laden begrenzte Datensatzmengen. Für große Organisationen sind weitergehende serverseitige Suche und Pagination vorgesehen. Der produktive Lasttest gehört zur Abnahme.
- Unklare SMTP-Zustellungen werden vor automatischer Wiederholung gestoppt. Eine manuelle Prüfung ist notwendig; SMTP kann technisch keine absolute Exactly-once-Garantie liefern.
- PWA: installierbar mit Manifest/Icons, aber kein personenbezogener Offline-Speicher. Ohne Netzwerk erscheint ein Hinweis.
- WhatsApp öffnet einen vorausgefüllten Text. Der Nutzer versendet ihn selbst.

## Version 2

Serientermine und Ferienplanung; detaillierte Trainerbewertungen; komfortabler Import mit Mengen-/Tarifwechsel-Assistent; transparente Berichtskorrektur-Benachrichtigungen; Kapazitätswarnungen; Berichtssuche und vollständige Paginierung; optional streng serverseitig freigeschaltete Elternabsagen mit neuen Regeln und Tests; lokalisierte Oberfläche; optionales MFA für Admins; Monitoring/Alarmierung und Datenschutz-Lösch-/Aufbewahrungsprozesse nach abgestimmter Organisationsrichtlinie.

## Hintergrunddienst in Cloudflare Containers

Der vorbereitete Dienst besteht aus einem Worker-Gateway und einem einzigen Node-Container (`basic`, höchstens eine Instanz). Workers Paid ist im ProAcademy-Konto aktiviert. Der Container wird nur nach erfolgreicher Authentifizierung gestartet. Automatische Läufe sind mit `JOBS_ENABLED=false` gesperrt; die reine Verbindungsprüfung ist bereits verfügbar. Nach einem Lauf stoppt der Container, ein 30-Sekunden-Inaktivitätstimer dient als Rückfallebene und verlängert laufende Arbeit höchstens bis zur Gesamtgrenze. Der Node-Prozess beendet einen hängenden Auftrag nach vier Minuten; Datenbank-Leases und die Quarantäne unklarer SMTP-Zustellungen bleiben maßgeblich für Wiederaufnahme.

Lokale Vorbereitung:

```sh
npm run build:jobs
npm run typecheck:jobs
npm test
# Docker muss gestartet sein. Der Kontext ist das Projektverzeichnis.
docker build --platform linux/amd64 -f workers/Dockerfile -t proacademy-jobs:local .
npx wrangler deploy --config workers/cloudflare/wrangler.jsonc --dry-run
```

Das finale Image enthält den vollständig gebündelten Node-Runner (CommonJS) ohne npm-/Next.js-Abhängigkeitsbaum. Es erhält keine `.env`-Dateien und läuft als Benutzer `node`. Die notwendigen Laufzeitwerte werden über Worker-Secrets übergeben: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `PROTON_SMTP_TOKEN`, `CRON_SECRET`. Die übrigen Werte stehen in der Gateway-Konfiguration. Der Token muss mit dem Portal-`CRON_SECRET` übereinstimmen. Keine Geheimnisse in Image, Git oder Befehlsargumente schreiben.

Erst nach Bereitstellung und erfolgreicher Container-Verbindungsprüfung: den geschützten Endpunkt `https://proacademy-jobs.proacademy-by-ak.workers.dev` als `JOB_RUNNER_URL` verwenden, Jobabläufe abnehmen und Verarbeitung explizit aktivieren. Mail-Capture nicht auf echten wartenden Versandaufträgen laufen lassen: es markiert sie als verarbeitet, ohne eine E-Mail zuzustellen. Die Versandabnahme erfolgt mit `MAIL_PROVIDER=proton` und `EMAIL_TEST_MODE=true` an den eigenen bestätigten Empfänger. Der allgemeine Elternversand bleibt bis zur Freigabe gesperrt.

## Stempelkarten für das Team

Admin und Coach haben eigene Stempelkartenansichten unter `/admin/stempelkarten` beziehungsweise `/team/stempelkarten`. Dort lassen sich Kinder suchen, Leistungszeiträume auswählen und aktuelle Karten als PDF exportieren. Der PDF-Export erstellt keinen Monatsbericht und verändert keine vorhandenen Berichtsversionen.

Der gezielte Mailversand erlaubt ausschließlich zugeordnete, nicht archivierte Elternkontakte. Er legt einen Auftrag vom Typ `stamp_card` mit dem Datenstand zum Anforderungszeitpunkt und dem auslösenden Mitarbeiter an. Wiederholungen derselben Anfrage werden dedupliziert; der Hintergrunddienst prüft die Empfängerzuordnung vor der Verarbeitung erneut und verwendet die bestehende Testempfängerbegrenzung. Bei deaktiviertem Hintergrunddienst bleibt der Auftrag ausstehend. Für diese Funktion müssen bei einer ausdrücklich freigegebenen Veröffentlichung sowohl Portal als auch Jobrunner aktualisiert werden.

Produktverwaltung: [Veröffentlichung, Shop-Schalter und Stripe-Einrichtung](docs/PRODUCT-MANAGEMENT-RELEASE.md). Der Shop startet deaktiviert; neue Produktzahlungen bleiben bis zur Einrichtung eines entsprechend berechtigten Live-Schlüssels gesperrt.
