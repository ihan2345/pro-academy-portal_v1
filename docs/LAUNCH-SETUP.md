# Supabase für den Launch

## Aktuelle verbindliche Vorgabe zur Veröffentlichung (10.09.2026)

**Ab jetzt nur auf ausdrücklichen Deploy-Befehl veröffentlichen.** Ein allgemeines „weiter“ oder eine Änderungsanforderung autorisiert kein Deployment. Lokale Änderungen prüfen und ihren noch nicht veröffentlichten Status klar nennen.

Bis zu einer ausdrücklichen neuen Anweisung des Nutzers ausschließlich unter **https://proacademy-portal.proacademy-by-ak.workers.dev** bereitstellen. **portal.proacademy-ak.com darf für dieses Portal nicht aktiviert oder verbunden werden.** Diese Vorgabe ersetzt sämtliche früheren Custom-Domain-Pläne in der folgenden chronologischen Dokumentation.

Produktionskonfiguration: workers_dev=true, preview_urls=false, routes=[], APP_URL und NEXT_PUBLIC_APP_URL auf der Worker-Adresse. Supabase Site URL/Callback, Stripe-Webhook, Kundenportal-Rückleitung und E-Mail-Links müssen bei der Bereitstellung ebenfalls diese Worker-Adresse verwenden. Vor dem Build NEXT_PUBLIC_APP_URL entsprechend setzen; keine alten Build-Artefakte mit der offiziellen Portaladresse veröffentlichen.

Aktueller Stand: Portal unter der Worker-Adresse bereitgestellt; Hintergrunddienst, Supabase und Stripe auf diese Adresse eingestellt. Die offizielle Portal-Domain bleibt ohne Portal-Route und ohne neu angelegten DNS-Eintrag. JOBS_ENABLED bleibt false. Details zur erfolgreichen Bereitstellung am Ende dieses Dokuments.

Stand: 09.09.2026. Der Nutzer hat das Projekt `vgxaatawsbzgsmqiaepj` ausdrücklich für den späteren Launch bestimmt. Der Dashboard-Anzeigename lautet noch `proacademy-portal-test`; das ist keine Kennzeichnung als entbehrliche Testdatenbank.

## Eingerichtet und geprüft

- Projekt in Frankfurt; vor Einrichtung 0 Anwendungstabellen, 0 Auth-Benutzer und 0 Storage-Buckets.
- Migrationen `202609090001` bis `202609090004` gemeinsam in einer Transaktion über den SQL Editor ausgeführt. Original-SQL und Versionsnamen in `supabase_migrations.schema_migrations` protokolliert.
- 23 Anwendungstabellen, alle mit RLS; keine anonym ausführbaren Funktionen im Anwendungsschema; feste Funktions-Suchpfade.
- Privater Bucket `reports`.
- Drei Tarife (FirstTouch 4, GameChanger 8, Pro-Player 8), Berichtszeit 08:00 und Elternstornierung deaktiviert.
- Keine Beispielstandorte, Familien, Spieler, Termine, Stripe-IDs oder Versandaufträge eingefügt. `supabase/seed.sql` wurde auf diesem Projekt nicht ausgeführt.
- Bestehende Publishable-/Secret-API-Schlüssel ausschließlich lokal in `.env.local`, Dateirechte 0600 und durch Git ignoriert. Die bisherigen Variablennamen `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` akzeptieren auch diese neuen Schlüsseltypen.
- REST-Verbindung geprüft: Publishable ohne Benutzer liefert 0 Tarife, serverseitiger Secret-Schlüssel liefert 3 Tarife.
- Erstes Admin-Konto mit der ausdrücklich genannten eigenen Adresse angelegt. Keine Passwortvorgabe; Admin hat den per E-Mail erhaltenen Link verwendet. Echte Sitzung und Adminzugriff anschließend im Browser bestätigt.
- Auth Site URL `http://127.0.0.1:3000` und genau eine Callback-URL `http://127.0.0.1:3000/auth/callback` gespeichert. Später durch die festgelegte HTTPS-Portaladresse ergänzen/ersetzen.
- Lokale App mit `NEXT_PUBLIC_DEMO_MODE=false` gestartet: Login HTTP 200 ohne Demo-Link; `/admin` leitet unangemeldet auf `/login` um. Admin-API verweigert unangemeldeten Zugriff.
- Eigenes Supabase Auth SMTP mit Proton aktiviert; Details und SMTP-Prüfung siehe unten. Admin hat inzwischen eine Login-Mail angefordert und den erhaltenen Link verwendet.
- Lokale Verifikation nach der Migration: 53 Tests erfolgreich und TypeScript-Prüfung erfolgreich.

## Schutz vor Testdaten

`SUPABASE_ENVIRONMENT=production` kennzeichnet die Ziel-Datenbank unabhängig vom App-Betriebsmodus. `scripts/test-external.ts` benötigt ausdrücklich `SUPABASE_ENVIRONMENT=test` sowie die beiden bisherigen Freigabewerte. Die Ausführung wurde mit der Launch-Konfiguration geprüft und bricht vor Netzwerkzugriffen ab.

`APP_MODE=test`, Mail-Capture und die Einschränkung auf die eigene E-Mail-Adresse bleiben während der Einrichtung aktiv. Diese App-Schalter machen die Supabase-Datenbank nicht zu einem Testprojekt. Für automatisierte Tests mit synthetischen Familien ist ein separates entbehrliches Projekt notwendig.

## Vor Veröffentlichung noch erforderlich

1. Session-Erneuerung auf der späteren HTTPS-Domain prüfen; Admin-Login und Zugriff sind lokal bestätigt.
2. Zustellung der Portal-Benachrichtigungen und PDF-Anhänge an die eigene Adresse prüfen; SMTP-Anmeldung und Auth-Login-Mail sind bestätigt.
3. Endgültige Portal-Domain festlegen und genaue Auth-Redirects eintragen; lokale Rückleitungen vor Launch überprüfen.
4. Echte Standorte, Mitarbeiter und Stripe-Zuordnungen nach den folgenden Einrichtungsschritten ergänzen.
5. Stripe-, Jobrunner-, PDF-, RLS- und Cloudflare-Abnahme abschließen. Die Schema-Prüfungen ersetzen keinen vollständigen Ablauf mit echten JWTs.
6. Produktionsschalter und Versand erst nach abgeschlossener Abnahme und ausdrücklicher Veröffentlichung freigeben.

## Nächster Schritt: Proton

Der Nutzer hat `billing@proacademy-ak.com` als Absender für Login-Mails und Portal-Benachrichtigungen festgelegt. Die Adresse ist eine aktive Auswahl im SMTP-Dialog des Kontos `service@proacademy-ak.com`. Die Anmeldung dieses Benutzers war bereits vorhanden. Keine neuen Adressen oder Benutzerlizenzen erforderlich.

DNS am 09.09.2026 geprüft: SPF enthält `_spf.protonmail.ch`; alle drei Proton-DKIM-CNAMEs stimmen mit dem Dashboard überein; DMARC ist mit `p=quarantine` vorhanden. Keine DNS-Änderungen durchgeführt.

- Lokale Absenderkonfiguration: `EMAIL_FROM=ProAcademy <billing@proacademy-ak.com>`, SMTP-Benutzer dieselbe Adresse, Host `smtp.protonmail.ch`, Port 587 mit STARTTLS.
- Proton-Token `ProAcademy Supabase Auth` für `billing@proacademy-ak.com` erzeugt und ausschließlich in Supabase als SMTP-Passwort gespeichert.
- Supabase SMTP-Konfiguration gespeichert und nach vollständigem Neuladen als aktiviert verifiziert. Host `smtp.protonmail.ch`, Port 587, Absendername `ProAcademy`, Benutzer und Absender `billing@proacademy-ak.com`; Mindestintervall 60 Sekunden.
- Separaten Token `ProAcademy Portal Jobs` für denselben Absender erzeugt und in der ignorierten `.env.local` (0600) als `PROTON_SMTP_TOKEN` hinterlegt. Auth-Token und Jobs-Token sind verschieden.
- Für beide Tokens mit Nodemailer `verify()` Anmeldung bei Proton und STARTTLS mit Zertifikatsprüfung erfolgreich getestet. Dabei keine E-Mail gesendet. Dies bestätigt noch keine Zustellung aus Supabase bzw. bis ins Empfängerpostfach.
- Mail-Capture des Jobrunners bleibt aktiv. Nächster Schritt: eigener Admin-Login über das Portal und Zustellung im eigenen Postfach prüfen.

Proton zeigte in der bestehenden Sitzung bei beiden Erstellungen keine erneute Passwortabfrage. Token-Dialoge nach sicherer Übernahme geschlossen; temporäre Datei des Auth-Tokens entfernt. Es wurden keine Kontopasswörter geändert, DNS-Einträge verändert oder Abonnements gekauft.

## Lokaler Login korrigiert

Das Formular wurde unter `localhost:3000` geöffnet, obwohl `APP_URL` und die Supabase-Rückleitung `127.0.0.1:3000` verwenden. Der strikte Origin-Schutz hat den Login-POST deshalb korrekt abgewiesen. Die Login-Seite leitet im Entwicklungsbetrieb den alternativen lokalen Host vor Anzeige des Formulars auf die konfigurierte Login-Adresse weiter. API-Origin-Prüfung und Produktionsrouting bleiben unverändert.

Mit echter HTTP-Anfrage und im Browser verifiziert: localhost → 307 mit absoluter 127.0.0.1-URL; dort Login HTTP 200 ohne Schleife. 60 lokale Tests und TypeScript-Prüfung erfolgreich. Kein Login-Link automatisch angefordert.

## Login-Rückleitung und Adminzugriff bestätigt

Der Nutzer erhielt den Login-Link und öffnete ihn im Codex-Browser. Der Code-Austausch war erfolgreich, jedoch normalisierte Next.js `request.url` im Callback auf `localhost`. Die Weiterleitung wechselte dadurch den Cookie-Host und zeigte erneut das Loginformular. Die gültige Sitzung auf `127.0.0.1` blieb erhalten; durch Aufrufen der korrekten Portaladresse konnte der echte Adminbereich ohne neuen Link geöffnet werden.

Auth-Callback und Einladungsroute bauen ihre Ziele jetzt aus dem konfigurierten `APP_URL` statt aus der eingehenden Request-URL. Ungültige Links und Einladungen zeigen ihre Fehlerursache auf der Loginseite. Rückleitungsziele werden nicht aus Benutzerparametern oder Forwarded-Host-Headern übernommen.

Verifikation: 67 lokale Tests und TypeScript erfolgreich; echte HTTP-Redirects führen zu absoluten URLs auf `127.0.0.1`; Fehlerhinweis im ausgelieferten HTML vorhanden. Der Adminbereich wurde mit der bestehenden echten Supabase-Sitzung im Browser geöffnet. Portal-Benachrichtigungen und PDF-Zustellung sind weiterhin nicht abgenommen.

## Nächster Einrichtungsschritt: Stripe

Der Nutzer ist im Live-Konto `acct_1RlAPDRoswKHkM76` (Pro Academy GmbH by Ayhan & Karaman) angemeldet. Bestehende Produkte und Preise wurden im Dashboard gelesen. Der eingeschränkte Stripe-Schlüssel und die eigene Portal-Konfigurations-ID sind inzwischen hinterlegt; das Webhook-Secret fehlt noch (siehe unten). Es wurden keine Stripe-Produkte, Abonnements oder Zahlungen verändert. Die acht bestätigten Preis-IDs wurden mit Migration 006 in Supabase zugeordnet.

### Tarifbestand, gelesen am 09.09.2026

Die Einheiten in dieser Tabelle sind Produktbeschreibungen aus Stripe, noch keine bestätigte Portal-Konfiguration. Aktive Abonnements sind die Anzeigen auf den jeweiligen Produktdetailseiten zum Prüfzeitpunkt.

| Produkt                               | Produkt-ID            | Preis-ID                         | Preis / Intervall | Einheiten laut Beschreibung                                                              | Aktive Abos |
| ------------------------------------- | --------------------- | -------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- | ----------- |
| FirstTouch - Pass                     | `prod_VBJ3B3FRb33COC` | `price_1UAwRNRoswKHkM76bLnkqr4C` | 120 € / Monat     | 4 / Monat                                                                                | 1           |
| GameChanger - Pass                    | `prod_VBJ14p6XQGg6zL` | `price_1UAwPGRoswKHkM76ovSApzO6` | 224 € / Monat     | bis zu 8 / Monat                                                                         | 0           |
| PRO Player - Pass                     | `prod_U0fn0kZdQnheTq` | `price_1UAq5PRoswKHkM76YMnEB9T0` | 300 € / Monat     | bis zu 12 / Monat                                                                        | 0           |
| PRO Player - Pass, archivierter Preis | `prod_U0fn0kZdQnheTq` | `price_1T2eSDRoswKHkM76Oew7Jnwi` | 175 € / Monat     | Historische Leistung nicht aus aktueller Produktbeschreibung ableiten                    | 0           |
| Academy Pass First Touch              | `prod_SgYmppSu71tfVw` | `price_1RlBeSRoswKHkM76gM8jmUB5` | 89 € / Monat      | 4 / Monat                                                                                | 76          |
| Academy Pass Game Changer             | `prod_Sga8O1DQzBJuc9` | `price_1RlCyQRoswKHkM76WMvJa0zd` | 152 € / Monat     | bis zu 8 / Monat                                                                         | 6           |
| Academy Pass PRO Player               | `prod_SgaB8jUmxCV1Je` | `price_1RlD1TRoswKHkM7689gRCjfq` | 175 € / Monat     | bis zu 10 / Monat                                                                        | 7           |
| Academy Pass PRO Player JAHRESABO     | `prod_T6R3VYVw1Z0szg` | `price_1SAEB2RoswKHkM76rG2O64pe` | 1.680 € / Jahr    | bis zu 10 / Monat                                                                        | 0           |
| Academy Pass NEXT LEVEL               | `prod_Twpcufp38wGNum` | `price_1SyvxMRoswKHkM761z5XJzFl` | 239 € / Monat     | bis zu 8 Trainingseinheiten und Angabe „4 Einheiten Athletiktraining“; Verhältnis klären | 2           |

### Verbindliche Tarifregeln und Umsetzung

Die letzte Nutzerkorrektur lautet **Bestand 4/8/10**, **Neukunden ab 01.09.2026 4/8/12**, **Jahresabo monatlich 10**, **NEXT LEVEL 8 Fußball + 4 Athletik**. Frühere Angaben zu 8 Pro-Player-Einheiten sind damit ersetzt.

Migrationen `202609090005` und `202609090006` wurden gemeinsam atomar auf `vgxaatawsbzgsmqiaepj` ausgeführt und mit Original-SQL in der Migrationshistorie gespeichert. Tarifgeneration und Zahlungsintervall sind je Preis definiert. Alte Tarife sind aktiv, aber nicht öffentlich; neue Abonnements auf alten Preisen ab dem Stichtag werden zur Prüfung markiert. Die Kontingentauswahl richtet sich nach Preis-ID, niemals allein nach dem aktuellen Datum.

Jährliche Zahlungen erzeugen monatliche Kontingente mit je 10 Einheiten. Grenzen werden vom ursprünglichen Stripe-Start in Europe/Berlin abgeleitet (inkl. Monatsende, Schaltjahr und Sommerzeit), bis exakt zum Stripe-Ende. Abo-Synchronisierung und Rechnungsnachimport verwenden dieselbe idempotente Funktion. Kündigung sperrt zukünftige Kontingente; vollständig zukünftige Jahresabo-Monate werden verworfen (`void`) und lösen keine späteren leeren Berichte aus. Historische Kontingente bleiben unveränderlich.

NEXT LEVEL: `included_units=12` enthält `athletics_units=4`, also 8 Fußball. Die Terminart `Athletiktraining` verbraucht ausschließlich das Athletikkontingent. Auswahl, Datenbankvalidierung, Stempelkarten, Übersichten, E-Mail-Text und PDFs berücksichtigen diese Trennung. Bestätigte Termine können ihre Trainingsart erst nach Teilnahme-Korrektur wechseln.

Prüfung nach Anwendung: 6 Migrationen, 8 Tarife, 0 Spieler, 0 importierte Abonnements, 0 Versandaufträge, 0 anonym ausführbare Funktionen. Alle acht Tarifzeilen sind mit echter Admin-Sitzung im Portal sichtbar. 79 lokale Tests und Next-Produktionsbuild erfolgreich; PDF-Vorschauen für 12 Einheiten und NEXT LEVEL auf allen Seiten visuell geprüft. Nur lokale PDF-Dateien mit fiktivem Namen erzeugt, keine E-Mails gesendet.

Ausführliche Regeln: [TARIFF-RULES.md](TARIFF-RULES.md).

Danach Kundenportal-Konfiguration und benötigte API-Berechtigungen festlegen sowie die endgültige HTTPS-Portaladresse für den Webhook bestimmen. Die bereits angelegte Launch-Datenbank darf keine synthetischen Stripe-Testfamilien erhalten. Live-Zahlungen, Änderungen bestehender Abonnements und eine öffentliche Bereitstellung sind weiterhin nicht freigegeben.

## Stripe-Kundenportal vorbereitet

Im vorhandenen Konto wurde die separate Konfiguration **ProAcademy Elternportal** (`bpc_1UDrgZRoswKHkM76cERxORbx`) erstellt. Die bestehende Standardkonfiguration `bpc_1RmFUhRoswKHkM76tYcX7RLE` wurde nicht verändert.

Nach Speichern, vollständigem Neuladen und erneuter Auswahl geprüft: Rechnungshistorie aktiv; Kundeninformationen ausschließlich Rechnungsadresse; Zahlungsmethodenänderung aktiv. In der neuen Konfiguration sind Abo-Kündigung, Tarif- und Mengenänderung deaktiviert. Der öffentliche No-Code-Link wurde nicht aktiviert. Die App erstellt Sitzungen für ihren bereits zugeordneten Stripe-Kunden und muss die eigene Konfigurations-ID nun ausdrücklich mitsenden; ein stiller Rückfall auf die Standardkonfiguration ist entfernt. ID lokal in `.env.local` (0600) gespeichert. Typecheck und alle 79 Tests erfolgreich.

Der eingeschränkte Schlüssel **ProAcademy Elternportal** wurde nach persönlicher Verifizierung durch den Nutzer erstellt und ohne Ausgabe des Geheimnisses in der ignorierten `.env.local` mit Dateirechten 0600 gespeichert. Ausgewählt und über den sichtbaren DOM-Zustand verifiziert: `Customers`, `Products`, `Invoices`, `Prices`, `Subscriptions` jeweils Lesen; `Customer Portal` Schreiben. Alle anderen Ressourcen stehen auf Keine. Bestehende Standard-/Vercel-Schlüssel wurden weder ausgelesen noch geändert.

Mit dem neuen Schlüssel erfolgreich rein lesend geprüft: bekannter Live-Preis (300 EUR) und Produkt zur Kontozuordnung, Kundenliste, Abonnementliste, Rechnungen, Rechnungspositionen und eigene Portal-Konfiguration. Portal-Funktionen auch per API bestätigt. Keine zusätzlichen Berechtigungen erforderlich.

Die Prüfung deckte einen echten Fehler im Admin-Import auf: `data.items.data.price.product` überschreitet Stripes maximale Expansionstiefe. Produktnamen werden jetzt separat mit einem pro Anfrage geteilten Promise-Cache geladen. Fünf lokale Regressionstests prüfen gültige Abfragen, Vorschauwerte, Cache-Grenzen, archivierte/gelöschte Produkte und Fehlerweitergabe. Typecheck und alle 84 Tests erfolgreich. Sanitisiertes API-Prüfprotokoll lokal unter `tmp/stripe/verification.json`. `APP_MODE=test`, Mail-Capture und externe Testdatensperre bleiben aktiv. Noch kein Kundenimport, keine echte Portal-Sitzung, kein Webhook, keine Veröffentlichung.

Portaladresse vom Nutzer bestätigt: **https://portal.proacademy-ak.com**. Siehe Hosting-Vorbereitung unten.

## Produktionsadresse und Cloudflare-Vorbereitung

Der Nutzer hat `portal.proacademy-ak.com` ausgewählt. DNS-Nameserver sind bereits Cloudflare; die Zone `proacademy-ak.com` ist aktiv im Konto `7300475f02c8b8793bb7e6250d0d4690` (Zone `b230ab9197207a679bfa9fae089cd4e8`). Der vorhandene Wrangler-OAuth-Zugang wurde lesend geprüft. Für die Portal-Subdomain wurden keine A-/CNAME-Antworten gefunden. Die vorhandenen anderen Worker wurden nicht verändert.

Separate Produktionskonfiguration in `wrangler.jsonc`: Worker `proacademy-portal`, Custom Domain `portal.proacademy-ak.com`, APP_URL und NEXT_PUBLIC_APP_URL auf HTTPS, Demo aus, keine workers.dev-/Preview-URLs. Eigene Stripe-Portal-Konfiguration gesetzt. Bis zur Versandabnahme bleiben Mail-Capture und Beschränkung auf die eigene Admin-E-Mail aktiv. Der lokale Entwicklungsbetrieb bleibt auf `127.0.0.1` und APP_MODE=test.

`workers/wrangler.toml` enthält die separate Produktionskonfiguration `proacademy-cron` mit dieser Portaladresse und zehnminütigem Zeitplan. Dies ist nur lokale Vorbereitung; kein Cron wurde aktiviert.

Erfolgreich geprüft: `NEXT_PUBLIC_APP_URL=https://portal.proacademy-ak.com npm run build:cloudflare -- --env production`; anschließend Wrangler-Dry-Run für Portal und Cron. Portal-Bundle ca. 3147 KiB gzip; das erforderliche Worker-Größenlimit ist vor Deployment im Hostingkonto zu prüfen. OpenNext warnt weiterhin vor experimenteller Unterstützung der Node-Middleware, daher echte HTTPS-Sitzungserneuerung nach Bereitstellung prüfen. Lokale Loginseite danach HTTP 200.

Noch offen vor öffentlicher Abnahme:

- Node-/Containerhost für den separaten Hintergrunddienst festlegen (Nutzer nach vorhandenem Hosting gefragt), bereitstellen und geschützten HTTPS-Endpunkt als JOB_RUNNER_URL setzen.
- Gemeinsamen CRON_SECRET erzeugen und benötigte Laufzeit-Secrets sicher ins Hosting übernehmen; `.env.local` nicht hochladen.
- Supabase Site URL auf `https://portal.proacademy-ak.com` setzen und `https://portal.proacademy-ak.com/auth/callback` erlauben, sobald die Adresse bereitsteht. Lokalen Zugriff bis zum Abschluss beibehalten.
- Signierten Stripe-Webhook an `https://portal.proacademy-ak.com/api/stripe/webhook` verbinden; Secret hinterlegen, Empfang und Hintergrundverarbeitung prüfen.
- HTTPS, echte Admin-Sitzung, Kundenportal, Kontingentsynchronisierung und eigene Zustellung/PDF abnehmen. Keine synthetischen Testfamilien in der Launch-Datenbank erzeugen.

Noch kein Worker-Deployment, DNS-Wechsel oder öffentlicher Launch erfolgt.

Hosting-Rückfrage: Nutzer fragt, ob mit Hintergrunddienst ein Cloudflare Worker gemeint ist. Erläutert: vorhandener Node-Runner ist separates Laufzeitmodell; Cloudflare Containers wird als mögliche Lösung im selben Konto geprüft, noch nicht eingerichtet. Laut offizieller Container-Dokumentation Workers Paid erforderlich (ab 5 USD/Monat plus ggf. Verbrauch). Abfrage der Konto-Abonnements mit vorhandenem OAuth liefert 403, daher Tarif noch nicht verifiziert. Cloudflare-Dashboard-Tab offen auf Login; keine erneute CLI-Anmeldung nötig für die bereits erfolgreichen technischen Zugriffe.

Cloudflare-Dashboard nach Nutzeranmeldung geprüft: Sitzung gehört zu `ayh.kaan@icloud.com`, einzig auswählbares Konto `a3b0ca8bcec7daf5e319a56b15263483`. Dies ist nicht das per Wrangler verifizierte Domain-Konto `7300475f02c8b8793bb7e6250d0d4690` (`proacademy.by.ak@gmail.com`). Nutzer muss für die Tarifprüfung im Dashboard zum Domain-Konto wechseln. Benutzermenü mit Log out geöffnet; keine Abmeldung, kein Kauf und keine Ressourcenänderung durchgeführt. Beide Einrichtungstabs für Fortsetzung behalten.

Nach erneutem Kontowechsel korrektes Dashboard-Konto `proacademy.by.ak@gmail.com` / `7300475f02c8b8793bb7e6250d0d4690` bestätigt. In Billing → Abonnements ist **Workers Free aktiv**; der separate **Pro Plan für proacademy-ak.com** schließt Workers Paid nicht ein. Tarifübersicht bestätigt **Workers Paid 5 USD/Monat plus Nutzung**, Containers nur im kostenpflichtigen Tarif. Keine Buchung vorgenommen. Damit ist das bisher offene Worker-Tariflimit geklärt: vor Deployment des ca. 3147-KiB-gzip-Bundles und vor Container-Betrieb Upgrade erforderlich (oder erneute technische Umplanung). Nutzer um Freigabe der laufenden Kosten bitten. Cloudflare-Tab steht auf der Tarifübersicht.

## Workers Paid aktiviert

Nach ausdrücklicher Zustimmung des Nutzers ("ja" auf die Frage nach Aktivierung für 5 USD/Monat plus gegebenenfalls Nutzung) Workers Paid im Konto `7300475f02c8b8793bb7e6250d0d4690` gebucht. Im Checkout ausschließlich den Workers Paid Plan gewählt und die erforderlichen Vertrags-/monatlichen Nutzungsabrechnungsbedingungen bestätigt; vorhandene Zahlungsmethode verwendet. Cloudflare-Bestätigungsseite meldet **Kauf abgeschlossen**, **Abonnement aktiv**, **5 USD/Monat**, Grundgebühr heute berechnet und zusätzliche Nutzung monatlich. Aktivierung erfolgreich, nicht nur vorbereitet. Anschließend zur Workers-Übersicht zurückgekehrt. Das zuvor festgestellte Workers-Free-Hindernis ist damit aufgehoben.

Nächster technischer Schritt: den vorhandenen Node-Hintergrunddienst für Cloudflare Containers vorbereiten und prüfen (einschließlich Proton-STARTTLS, Secrets, nur einer gleichzeitigen Verarbeitung, Laufzeitbegrenzung und sicherem Schlafmodus). Container wurde noch nicht erstellt; Portal noch nicht veröffentlicht, Domain noch nicht verbunden, Webhook noch offen.

## Container-Hintergrunddienst vorbereitet und lokal geprüft

`workers/cloudflare` enthält Gateway, Container-Klasse, eigene TypeScript-Konfiguration und Wrangler-Konfiguration. Eine feste Instanz `proacademy-jobs` / Containerklasse `ProAcademyRunner`, Typ basic, maximal eine Instanz. Authentifizierung erfolgt vor Start, nur POST /run und /verify sind erreichbar. Unbekannte und unberechtigte Aufrufe erzeugen keinen Container. JOBS_ENABLED=false verhindert manuelle und zeitgesteuerte Verarbeitung. Beim Ende eines Aufrufs stoppt der Container; währenddessen bleibt seine Sperre erhalten. Ein 30-Sekunden-Idle-Timer schützt vor unbeabsichtigtem Dauerbetrieb, laufende Arbeit hat maximal fünf Minuten einschließlich Start. Der Node-Runner hat zusätzlich eine harte Vier-Minuten-Grenze und unterstützt SIGTERM.

Runner-HTTP-Code ist separat testbar. /verify prüft Supabase lesend, Stripe lesend, Proton verify() mit STARTTLS und Zertifikatsprüfung sowie einen synthetischen PDF-Bericht ausschließlich im Speicher. Keine Jobs werden dabei beansprucht, keine E-Mails gesendet, keine Datenbankzeilen geschrieben. /health enthält ausschließlich Bereitschaft, Aktivierungs- und Sperrstatus und ist nur intern im Container direkt verfügbar; das öffentliche Gateway gibt dafür 404 zurück.

Das mehrstufige Dockerfile baut den Runner ohne tsx zur Laufzeit, kopiert gezielt Quellcode und kein .env, läuft als node und stellt ein beschreibbares Capture-Verzeichnis bereit. Dienst-Datenbankzugriff wurde von Next.js-Cookies getrennt: dadurch startet der kompilierte Runner ohne den zuvor gefundenen next/headers-ESM-Auflösungsfehler. Ein fehlerhafter leerer optionaler Paket-Lockeintrag für eine nicht installierte Plattform wurde bei der Abhängigkeitsinstallation repariert. npm meldet keine bekannten Schwachstellen.

Der vorhandene/neu erzeugte CRON_SECRET ist lokal in der ignorierten .env.local mit 0600 gespeichert; Wert nie ausgegeben. Keine Cloudflare-Secrets hochgeladen. Der separate alte Produktions-Cron ist deaktiviert, da der neue Gateway den Zeitplan übernimmt. Das Portal hat die vorgesehene JOB_RUNNER_URL und wartet bis zu fünf Minuten auf Kaltstart plus Lauf, die lokale APP_URL bleibt unverändert.

Erfolgreiche Prüfung: beide Typechecks, 92 Tests (acht neue echte HTTP-/Gateway-Fälle), Runner-Build, Gateway-Wrangler-Dry-Run mit --containers-rollout=none. Kompilierter Runner lokal mit vorübergehendem APP_MODE=production und JOBS_ENABLED=false gestartet: /run HTTP 503; /verify bestätigt Supabase, Stripe, SMTP und PDF erfolgreich. Nach dem Test beendet. Sanitisiertes Ergebnis tmp/runner-verification.json. APP_MODE in .env.local bleibt test.

**Noch offen:** Docker ist auf dem Mac nicht installiert (weder Docker-CLI noch alternative Engine oder Homebrew gefunden). Vollständiger Wrangler-Dry-Run stoppt deshalb beim Image-Build. Ohne Container-Build sind Linux-Image und Proton-Verbindung aus Cloudflare noch nicht abgenommen. Kein Container und kein öffentlicher Portal-Worker bereitgestellt; kein Elternversand aktiviert. Nächster Schritt: Docker Desktop für Apple Silicon installieren/starten, Image bauen und testen, danach geschützten Hintergrunddienst mit deaktivierten Jobs bereitstellen und /verify aus Cloudflare ausführen.

## Docker-Prüfung und erste Bereitstellung des Hintergrunddienstes

Docker Desktop läuft (Engine 29.7.2). CLI und Credential-Helper liegen unter `/Applications/Docker.app/Contents/Resources/bin`; dieser Pfad muss für lokale Docker-/Wrangler-Befehle im PATH sein. Linux-amd64-Image `proacademy-jobs:local` erfolgreich gebaut, ca. 206 MB, Benutzer node. Derselbe Image-Manifest-Digest wurde von Wrangler gebaut: `sha256:48bf0b94b2431f08a7f0b3ea67aae567f14ab03c7960405e6b225fb42a418975`.

Lokaler echter Container-Test mit 1 GiB RAM und 0,25 CPU erfolgreich: /verify HTTP 200 mit Supabase, Stripe, SMTP und PDF jeweils true. Ohne Authentifizierung HTTP 401, /run bei JOBS_ENABLED=false HTTP 503. Testcontainer nach Prüfung entfernt. Ergebnis ohne Geheimnisse in tmp/container-verification.json. Kein Versand und keine Datenbankänderungen.

Erster Wrangler-Deploy hat den Worker proacademy-jobs hochgeladen, ist aber beim Image-Push an einem Registry-HTTP-Timeout gescheitert. Da Worker- und Container-Upload nicht atomar sind, ist dies noch keine abgeschlossene Bereitstellung. Derselbe Image-Tag wird gezielt erneut hochgeladen; noch keine Jobs aktiviert.

Docker-Push und BuildKit-Push liefen wiederholt in Registry-Timeouts. Daraufhin standardkonforme OCI-Übertragung in Teilen vorbereitet, ausschließlich in dieselbe private Cloudflare-Registry, mit kurzlebigen Registry-Zugangsdaten im Prozessspeicher und SHA-256-Prüfung aller Artefakte. Unnötige Laufzeit-Abhängigkeiten aus dem Docker-Image entfernt: der Node-Runner wird jetzt einschließlich seiner JS-Abhängigkeiten als CommonJS-Datei gebündelt (ca. 2,6 MB); kein npm-/Next.js-Abhängigkeitsbaum im finalen Image. Imagegröße sinkt von ca. 206 auf 59 MB. Auch das optimierte Linux-amd64-Image hat sämtliche Container-Verifikationen bestanden (Supabase, Stripe, SMTP, PDF; 401 ohne Auth; 503 für deaktivierte Jobs). Neuer maßgeblicher Manifest-Digest: `sha256:8baf6b25893daa87c92585d14c81f8701775ecb50000ffa1348cbf3e0dc8fcbe`. Die großen unbenötigten Laufzeit-Abhängigkeiten des ersten Images werden nicht weiter übertragen. Cloudflare-Hintergrunddienst noch nicht vollständig bereitgestellt, solange der Basis-Layer-Upload läuft.

## Hintergrunddienst in Cloudflare bereitgestellt und geprüft

Abnahme am 10.09.2026 (Europe/Istanbul; Prüfzeit 09.09.2026 21:02 UTC): Der Upload ist vollständig abgeschlossen. Remote-Manifest und alle Layer des optimierten Images wurden anhand ihrer SHA-256-Digests geprüft. Der anschließende Wrangler-Deploy erkannte das vorhandene Image und schloss erfolgreich ab.

- Worker: `proacademy-jobs`, Version `3849b62a-9fe6-4ee1-8c09-0d08df60cc66`
- Geschützter Endpunkt: `https://proacademy-jobs.proacademy-by-ak.workers.dev`
- Container-Anwendung: `proacademy-jobs-proacademyrunner`, ID `a0321cca-eea2-4b9f-aca0-bcebbebee733`, basic, maximal eine Instanz
- Image-Digest: `sha256:8baf6b25893daa87c92585d14c81f8701775ecb50000ffa1348cbf3e0dc8fcbe`
- Fünf Laufzeit-Secrets sicher über stdin hinterlegt: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, PROTON_SMTP_TOKEN, CRON_SECRET. Keine Werte ausgegeben und keine .env-Datei hochgeladen.

Echte Cloudflare-Prüfung erfolgreich: /verify ohne Authentifizierung HTTP 401; authentifiziertes /run HTTP 503 wegen JOBS_ENABLED=false; authentifiziertes /verify HTTP 200 mit Supabase, Stripe, Proton-STARTTLS und PDF-Erstellung jeweils true. Sanitisiertes Prüfprotokoll: `tmp/cloud-runner-verification.json`. Dabei wurden keine E-Mails gesendet, keine Jobs beansprucht und keine fachlichen Datenbankzeilen geschrieben. Nach abgeschlossener Prüfung meldet `wrangler containers instances` die feste Instanz als inactive; der Container läuft nicht dauerhaft. Auch im Dashboard erscheint proacademy-jobs als neu bereitgestellter Worker.

Der zehnminütige Zeitplan ist installiert, führt bei JOBS_ENABLED=false jedoch keine Verarbeitung aus und startet keinen Container. MAIL_PROVIDER=capture und EMAIL_TEST_MODE=true bleiben gesetzt. Vor späterer Aktivierung echter Aufträge muss der Versand bewusst auf Proton umgestellt und abgenommen werden; Capture darf keine echten Versandaufträge als erledigt markieren.

Nächster Launch-Schritt: den Portal-Worker mit HTTPS und Laufzeit-Secrets unter portal.proacademy-ak.com bereitstellen, Supabase-Redirects anpassen und den signierten Stripe-Webhook verbinden. Danach echte Admin-Anmeldung, Kundenportal und ausdrücklich freigegebene eigene E-Mail-/PDF-Zustellung abnehmen. Das öffentliche Elternportal ist noch nicht veröffentlicht; keine Kunden importiert und kein Elternversand aktiviert.

## Portal unter Worker-Adresse veröffentlicht (10.09.2026)

Nach ausdrücklicher Umstellung durch den Nutzer ausschließlich **https://proacademy-portal.proacademy-by-ak.workers.dev** verwendet. Produktionsbuild einschließlich Admin-Menüpunkt Trainingsplanung erfolgreich. Wrangler-Dry-Run erfolgreich; 21 öffentliche Assets auf enthaltene Dienstgeheimnisse geprüft, null Treffer. Deploy abgeschlossen, Basisversion `dc31d46d-b37b-40fd-ad7f-6532076e794f`; nach Ergänzung des Webhook-Secrets aktive Version `b76711d1-67dc-417f-b8b3-148c30ed6beb` (100 %).

Sechs Secrets im Portal-Worker: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, CRON_SECRET, STRIPE_WEBHOOK_SECRET. Über stdin übertragen, Werte nie ausgegeben. Webhook-Geheimnis zusätzlich in ignorierter .env.local mit 0600 gespeichert. Einmalige lokale Konfigurationsübergabe danach beendet und Zwischenablage geleert. Keine .env-Datei als Artefakt hochgeladen.

Supabase Site URL auf Worker-HTTPS-Adresse gesetzt und nach vollständigem Neuladen bestätigt. Exakte erlaubte Redirects: Worker `/auth/callback` sowie weiterhin `http://127.0.0.1:3000/auth/callback`. Keine Wildcard und keine offizielle Portal-Domain hinzugefügt. Echte Anmeldung durch Nutzer im Cloud-Browser erfolgreich: eingeloggte Übersicht, Adminbereich, Trainingsplanung, geöffnetes Terminformular und Sitzung nach Seitenneuladen geprüft. Es wurde kein Training gespeichert. Erneuerung einer tatsächlich abgelaufenen Sitzung bleibt als späterer Langzeittest offen.

Neun HTTP-Prüfungen erfolgreich: Login 200, Admin und Trainingsplanung unangemeldet zur Anmeldung umgeleitet, Admin-API 401, Webhook ohne Signatur 400, Cron ohne Auth 401, fremder Login-Origin 403, korrekter Worker-Origin akzeptiert bis zur E-Mail-Validierung (400 bei absichtlich ungültiger Adresse), Callback bleibt auf Worker-Origin. Protokoll `tmp/cloud-portal-verification.json`.

Stripe-Ziel **ProAcademy Elternportal**, ID `we_1UDsqURoswKHkM76SFRgCdUX`, aktiv unter Worker `/api/stripe/webhook`. Snapshot-API-Version `2025-06-30.basil`, eigenes Konto, genau fünf Ereignisse: customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.paid, invoice.payment_failed. Bestehende Ereignisziele und Abos unverändert. Echte Cloud-Signaturprüfung erfolgreich: signierter unbekannter technischer Ereignistyp HTTP 200 und ignored=true; manipulierte Nutzlast mit gleicher Signatur HTTP 400. Dieser Test schreibt keine Ereigniszeile. Kein echtes Stripe-Geschäftsereignis manuell erzeugt oder wiederholt; erste tatsächliche Stripe-Zustellung und anschließende Verarbeitung stehen noch zur Abnahme aus. Protokoll `tmp/cloud-webhook-verification.json`.

Hintergrund-Gateway mit aktualisierter APP_URL bereitgestellt, Version `688265a9-91c7-4641-8786-44f4fd2e8b0c`; unverändertes geprüftes Container-Image weiterverwendet (kein Container-Rollout). JOBS_ENABLED=false, EMAIL_TEST_MODE=true, MAIL_PROVIDER=capture bleiben erhalten. Nach den Prüfungen jeweils null Spieler, Abos, Trainings, Webhook-Ereigniszeilen und Versandaufträge in Supabase. Keine Kundenübernahme, keine Jobs ausgeführt, kein Elternversand.

Domain-Schutz: production.routes=[], workers_dev=true, preview_urls=false. DNS-Abfragen für portal.proacademy-ak.com liefern weiterhin keine A-/CNAME-Antwort. Die offizielle Domain darf erst nach ausdrücklicher neuer Anweisung verbunden werden.

Nächste fachliche Schritte: Bestandskunden-Vorschau und Zuordnungen prüfen, echte Standorte/Trainer ergänzen, freigegebene Kunden übernehmen, eigene E-Mail-/PDF-Zustellung abnehmen, Abschlussprüfung und erst danach automatische Verarbeitung/Elternversand gezielt freigeben. Der Worker-Link ist bereits erreichbar; dies ist noch keine Freigabe für den vollständigen Elternbetrieb.

## Zurückgestellte Einführung und Originallogo (10.09.2026)

Neue verbindliche Nutzeranweisung: Kunden-Zuordnung, Import sowie Standorte und Trainer erst ganz am Ende zum ausdrücklich freigegebenen Start angehen. Bis dahin nur Technik, Darstellung und Prüfungen ohne Elternkontakt. Kein Versand und keine vorzeitige Einladung.

Nutzerdatei logo_neon.png unverändert nach public/brand/logo-neon.png übernommen (1168 × 1390, transparentes PNG; bytegleiches Original). Die bisherigen typografischen Logo-Platzhalter in Login/Seitenmenü und Berichtsvorschauen durch das Bild ersetzt; Seitenverhältnis bleibt erhalten. Auf der weißen Login-Karte liegt das Neonlogo auf einer dunklen Fläche. Favicon und App-Icons aus derselben Quelle abgeleitet, separate Maskable-Datei mit Sicherheitsabstand. scripts/prepare-brand.mjs erzeugt diese Formate und das eingebettete PDF-Asset reproduzierbar.

PDF-Berichte enthalten das Logo auf jeder Seite, direkt im Bundle eingebettet und deshalb ohne externen Bildabruf im Container verfügbar. Benachrichtigungs-Vorlage verwendet das Bild vom jeweiligen Portal-Origin. Typecheck und alle 92 Tests erfolgreich; echte PDF-Vorschau nach PNG gerendert und visuell geprüft (tmp/pdfs/logo-preview.pdf/.png). Login, mobiles Seitenmenü und App-Icon ebenfalls visuell geprüft. Keine E-Mail versendet und keine fachlichen Datenbankeinträge angelegt.

Hintergrunddienst mit Logo-Version bereitgestellt: Worker d352d747-6f0f-4431-93e4-1240dd736257; Container-Manifest sha256:9ccdaa965190f5933240ff1cd73e130dccd4f784f129deb9a23bdf15d12fc6c1. /verify aus Cloudflare bestätigt Supabase, Stripe, SMTP und PDF; /run weiterhin 503 wegen deaktivierter Verarbeitung.

Portal-Logo-Version erfolgreich veröffentlicht: c2bbef67-e2ea-41a7-bbcb-43a36f4dfe5d. Logo-Endpunkt HTTP 200 und bytegleich mit Original; Login-HTML bindet das neue Logo und PNG-Favicon ein. Offenen Cloud-Tab aktualisiert und Logo sichtbar. Supabase Magic-Link-Vorlage um einen dunklen Logo-Kopf ergänzt; vorhandenen Betreff, Text und insbesondere {{ .ConfirmationURL }} unverändert erhalten. Keine Testmail ausgelöst. Offizielle Domain, Elternversand und Job-Aktivierung bleiben unverändert deaktiviert.

## Einklappbare Navigation

Logo und Seitenmenü erhalten einen Ein-/Ausklappschalter mit Panel-Symbol. Auf dem Desktop bleibt eingeklappt eine 76-Pixel-Leiste mit kleinem Originallogo und beschrifteten Navigationssymbolen (Tooltip und zugänglicher Name). Auswahl unter proacademy-sidebar-collapsed lokal im Browser gespeichert, keine Nutzerdaten. Mobile Navigation bleibt ein ausblendbares Menü mit Menü-Symbol, Schließen-Kreuz, Hintergrundfläche zum Schließen und Escape-Unterstützung. Verdeckte mobile Links sind nicht mehr per Tastatur erreichbar.

Lokal im Browser erfolgreich geprüft: Desktop ein-/ausklappen, kompakte Darstellung ohne Überlagerungen, Persistenz nach Neuladen, mobiles Öffnen/Schließen per Escape. Ansichtsgrößen nach Prüfung zurückgesetzt. Typecheck und Produktionsbuild erfolgreich. Portal-Version 78581525-4e69-43fa-ad7d-f912c7756f84 erfolgreich auf der Worker-Adresse veröffentlicht. Offenen Cloud-Adminbereich neu geladen und Ein-/Ausklappschalter in der echten Sitzung geprüft; Menü für die Übergabe eingeklappt. Keine fachlichen Daten, E-Mails, Jobs, Hosting-Domains oder Zugänge geändert.

## Rollentrennung – nur lokal umgesetzt (10.09.2026)

Die Wechsel-Links zwischen Eltern-, Mitarbeiter- und Adminportal wurden entfernt. Navigation, Logo-Ziel und „Mein Konto“ richten sich nach der angemeldeten Rolle. Direkte Aufrufe eines fremden Portalbereichs werden vor den Datenabfragen zur eigenen Startseite umgeleitet. Die Admin-Verwaltung von Eltern und Mitarbeitern sowie die Admin-Trainingsplanung bleiben verfügbar.

Typecheck und alle 114 Tests erfolgreich, einschließlich 22 Prüfungen der Rollen-Navigation und Weiterleitungen. In der echten lokalen Admin-Sitzung bestätigt: Trainingsplanung mit Admin-Menü, eigene Kontoseite ohne Elternnavigation, Weiterleitung von /team und / nach /admin. Lokalen Entwicklungsserver wieder gestartet und Browser abschließend auf /admin/trainingsplanung zurückgestellt. Keine Daten geändert und keine E-Mails versendet.

**Nicht deployt.** Die veröffentlichte Portal-Version bleibt 78581525-4e69-43fa-ad7d-f912c7756f84. Veröffentlichung dieser und weiterer Änderungen ausschließlich nach einem neuen ausdrücklichen Deploy-Befehl.

## Freigegebene Veröffentlichung und Vorbereitung des Livetests (10.09.2026)

Der Nutzer hat Commit/Push zuerst nach `start`, danach nach `main` und das Deployment ausdrücklich freigegeben. Beide bisherigen Git-Historien wurden ohne Force-Push zusammengeführt; die vollständige Projekt-README ersetzt dabei die einzige Überschrift aus dem ursprünglichen `main`. Veröffentlichter Anwendungsstand: `6a97dd9`.

TypeScript-Prüfung im Produktionsbuild, alle 114 Tests und OpenNext-Cloudflare-Build erfolgreich. Zuvor doppelte generierte Next-Typdateien aus dem lokalen Build-Cache entfernt. Öffentliche Assets auf bekannte Dienstgeheimnisse geprüft: keine Treffer. Portal erfolgreich auf der bestehenden Worker-Adresse veröffentlicht, Version `d2782a3e-965d-40a0-9c0a-c25a3fc348cd`. Keine Änderungen am Hintergrunddienst oder seinen Versand- und Jobsperren.

Nach Veröffentlichung geprüft: Login und Logo HTTP 200, geschützte Trainingsplanung unangemeldet HTTP 307, Admin-API ohne Anmeldung HTTP 401. Bestehende echte Cloud-Admin-Sitzung öffnet Trainingsplanung mit eigenem Menü; `/team` leitet zu `/admin` um. Offizielle Domain weiterhin ohne A-/CNAME-Eintrag. Lokale Vorschau neu gestartet und geöffnet.

Beim anschließenden erneuten Aufruf der Cloud-Trainingsplanung erschien die Anmeldung. Die Ursache ist noch nicht belegt; die Erneuerung einer länger bestehenden Sitzung bleibt ein offener Abnahmepunkt. Der Cloud-Tab bleibt auf der Anmeldeseite geöffnet; keine Login-Mail automatisch angefordert.

Der Nutzer erlaubt nun ausdrücklich markierte Testdatensätze im bestehenden Supabase-Projekt für einen echten Test mit anschließender gezielter Bereinigung. Dies ersetzt für diesen abgegrenzten Test die frühere Vorgabe, fiktive Daten ausschließlich in einem separaten Testprojekt anzulegen. Das bestehende Skript `test:external` bleibt ausschließlich für ein entbehrliches Testprojekt bestimmt und darf hierfür nicht unverändert ausgeführt werden.

Vorprüfung des Livetests: jeweils null Spieler, Eltern, Mitarbeiterprofile, Standorte, Abos, Trainings und Benachrichtigungsaufträge. Hintergrund-Endpunkt `/run` weiterhin HTTP 503. In diesem Veröffentlichungsschritt noch keine Testdaten angelegt und keine E-Mails gesendet.

Livetest-Vorgaben: eindeutig markierter Testspieler, Testtrainer und Teststandort; alle erzeugten IDs für spätere gezielte Bereinigung festhalten. Ausschließlich eigene Empfängeradresse `ayh.kaan@icloud.com`; bestehende Adminrolle erhalten. Einzelne Testaufträge gezielt verarbeiten, keine globale Warteschlange oder automatischen Jobs freigeben, keine echten Stripe-Kunden oder Zahlungen verändern. Planung, Teilnahmebestätigung, Kontingent und PDF aus einem abgeschlossenen Beispielzeitraum prüfen. Eine zusätzliche Elternanmeldung benötigt eine zweite eigene Adresse. Bereinigung erst nach Prüfung der Ergebnisse; technische Audit-Einträge und zugestellte Mails bleiben nachvollziehbar erhalten. Künftige Deployments benötigen weiterhin einen ausdrücklichen Deploy-Befehl.

## Eltern-Testanmeldung auf Cloudflare veröffentlicht (10.09.2026)

Nach erneutem ausdrücklichem Deploy-Befehl den validierten Anwendungsstand `bbb56e7` auf `start` und `main` gepusht und auf der Worker-Adresse veröffentlicht. Aktive Portal-Version: `ab4ebb1b-0fc0-4b6c-a8e8-27d78277e528`. `AUTH_TEST_EMAILS=ayh.kaan@googlemail.com` ergänzt die bestehende Adminanmeldung; `EMAIL_TEST_RECIPIENT=ayh.kaan@icloud.com` und die Versand-/Jobsperren bleiben unverändert. Typprüfung, 118 Tests und Cloudflare-Build erfolgreich; vorhandenes geprüftes Bundle verwendet. Nach Deployment neue Anmeldesperre anhand einer nicht freigegebenen Adresse geprüft (vor SMTP abgewiesen), Login HTTP 200, Hintergrund `/run` HTTP 503.

Die inzwischen ausgeführten echten Supabase-, Cloudflare-API-, PDF- und SMTP-Prüfungen einschließlich bestätigtem Postfacheingang stehen in [LIVE-TEST-CHECKLISTE.md](LIVE-TEST-CHECKLISTE.md). Muhsin Ayhan hat ein Coachprofil bei unveränderter Adminrolle; Sportzentrum Schürenkamp ist eingerichtet. Die Beispielfamilie nutzt Googlemail. Ihre bereits versendete Einladung ist gültig und noch nicht angenommen; persönliche Elternanmeldung und Sitzungserneuerung stehen zur Abnahme aus. Kind, 16 Trainings und Bericht sind erhalten. Testdaten nicht entfernt, keine offizielle Domain aktiviert, kein globaler Hintergrundlauf freigegeben.

## Stempelkarten für Admin und Coach veröffentlicht (10.09.2026)

Nach ausdrücklichem Commit-, Push- und Deployment-Befehl Anwendungsstand `a90aa4a` auf `start` und `main` gesichert. Enthalten sind Stempelkartenansichten für Admin und Coach, aktueller PDF-Export und gezielte Versandaufträge an zugeordnete Eltern sowie die dauerhafte V2.0-Checkliste.

- Portal: `c9643df4-0562-4463-8116-35d385f5ffdc`, ausschließlich auf der bisherigen Worker-Adresse.
- Hintergrunddienst: `5dbe03b2-5242-4ca0-960b-e7c6049c43da`.
- Neues Container-Image: `sha256:b49a13c82872331d7b15dedaf9794a8fc390f1a87c43dbbabf9c2835fa06a625`.
- Validierung: 132 Tests, Desktop-/Handy-Abnahme, PDF-Sichtprüfung, Typprüfung, Cloudflare-Build und Jobrunner-Build erfolgreich. Vorhandenes geprüftes Portal-Bundle verwendet.
- Cloud-Prüfung des neuen Containers: Supabase, Stripe, SMTP und PDF erfolgreich, ohne Versand oder Datenbankänderungen. `/run` liefert weiterhin HTTP 503.
- Portal-Smokecheck: Login HTTP 200, neue Admin-/Coachseiten leiten ohne Sitzung zur Anmeldung, neuer PDF-Endpunkt ohne Sitzung HTTP 401.

`JOBS_ENABLED=false`, `MAIL_PROVIDER=capture`, `EMAIL_TEST_MODE=true` und der allgemeine Testempfänger iCloud bleiben erhalten. Die Coach- und Elternadressen bleiben für Login-Mails freigegeben. Die offizielle Domain bleibt deaktiviert. Persönliche Abnahme der neuen Stempelkartenansichten und ein separat freigegebener tatsächlicher Stempelkartenversand stehen noch aus.

## Lokal vorbereitet: Wertung von Absagen (10.09.2026)

Noch nicht in Supabase angewendet und nicht veröffentlicht. Nutzerregel: Absagen/Stornos und Nichterscheinen zählen als angerechnete Einheiten mit rotem OK; nur tatsächliche Teilnahme erhöht die Trainingsminuten. Entschuldigungen verbrauchen keine Einheit und stehen mit öffentlichen Termindaten in Portal, Stempelkarte und neuen PDFs. Migration `202609100007_charged_absences.sql` trennt Kinderentfernungen aus der Terminplanung von echten Absagen; bestehende Entschuldigungen bleiben bei einer Gesamtabsage bestehen und können auch nachträglich eingetragen werden. Neue Berichte kennzeichnen die Wertungsregel; vorhandene Berichts- und Mail-Snapshots bleiben unverändert.

Verifikation: 133 Tests, Typecheck, Runner-Build und Runner-Typecheck erfolgreich; zwei Desktop-/Mobil-E2E für Admin/Coach-Stempelkarten erfolgreich. Sechs zusätzliche Browseransichten mit isolierten Beispieldaten auf rotes OK, unveränderte tatsächliche Minuten, Entschuldigungsdetails und fehlenden horizontalen Überlauf geprüft. Neue PDF-Stempelkarte und Trainingsbericht visuell geprüft. Keine echten Kundendaten verändert, kein Versand oder Deployment.

## Interne Eltern-Kind-Listen und Entfernung der Demo (12.09.2026)

Der Nutzer hat die Veröffentlichung der richtigen Listen ausdrücklich für die interne Nutzung bestätigt. Portal-Version `588cdefa-c2b7-4870-ba8b-299a37655daf` und Hintergrunddienst `3dbec021-0dd0-4741-b074-3d54dfa3f615` sind auf den bisherigen Worker-Adressen veröffentlicht. Der Demo-Modus wurde aus der Anwendung entfernt; Tests verwenden getrennte Fixtures. Details stehen in [ELTERN-KIND-UEBERNAHME.md](ELTERN-KIND-UEBERNAHME.md).

Migration `202609120009_family_accounts.sql` angewendet. 84 Familien, 91 Kinder und 91 Abo-Zuordnungen nach erneutem lesenden Stripe-Abgleich importiert; frühere Datensätze erhalten. Menzur mit einem Paket, Sevgi als ein gemeinsames Elternkonto. Keine Auth-Benutzer oder Eltern-Auth-Verknüpfungen erzeugt. 84 Einladungsvormerkungen sind `held`, ohne Links oder Token; keine E-Mail verschickt.

157 Tests, 14 Desktop-/Mobil-Browserprüfungen, TypeScript, Runner- und Cloudflare-Build erfolgreich. Online-Datenbankrollen geprüft: Admin/Mitarbeiter sehen die 91 importierten Kinder, Eltern sehen keines davon; anonyme Zugriffe liefern keine Kinder. Login 200, geschützte Verwaltung 307, Admin-API 401 ohne Sitzung. Keine bestehende Cloud-Admin-Sitzung im Browser; kein neuer Anmeldelink angefordert.

Nach Veröffentlichung `JOBS_ENABLED=false`, `ACCEPTANCE_TEST_ENABLED=false`, `MAIL_PROVIDER=capture`, `EMAIL_TEST_MODE=true` erneut direkt geprüft. Keine Freigabe für automatische Hintergrundläufe, Elternzugänge, Mailversand oder die offizielle Domain.

## 12.09.2026 – ausschließlich automatischer Abo-Abgleich

Auf ausdrücklichen Nutzerauftrag ausschließlich den Stripe-Abgleich aktiviert. Gateway und Container trennen den eingeschränkten Modus technisch von allen anderen Phasen: `STRIPE_SYNC_ONLY=true`, während `JOBS_ENABLED=false`, `ACCEPTANCE_TEST_ENABLED=false`, `MAIL_PROVIDER=capture` und `EMAIL_TEST_MODE=true` bestehen bleiben. Auch direkte Mailverarbeitung und der begrenzte Versandtest werden in diesem Modus abgewiesen. Die bestehenden zehnminütigen Cron-Trigger bleiben der einzige Zeitgeber. Kein Portal-Deployment, keine neue Domain und keine RLS- oder Auth-Änderung.

Hintergrunddienst-Version `cbcc7502-d800-4a53-a17d-e552b6ec43db`, Container-Digest `sha256:0f977cf14a1a594aa8ea71357ea3fdcf4b65ad3371e0823f58004bd45924593a`. Der erste Aufruf traf während des Versionswechsels noch auf den alten, vollständig gesperrten Runner (503). Nach dem Wechsel erfolgreicher authentifizierter Lauf: `{"ok":true,"mode":"stripe-only","stripe":20}`; danach alle 22 gespeicherten Stripe-Ereignisse verarbeitet, keines mehr wartend. Lisa/Lenny Janz: neuer Zeitraum 12.09.–12.10.2026 mit vier Einheiten zusätzlich zum erhaltenen August/September-Zeitraum.

164 automatisierte Tests, beide Typprüfungen, Runner- und Container-Build erfolgreich. Schutzprüfungen: anonymer Runnerzugriff 401, begrenzter Versandtest 503, öffentliche Admin-API 401, anonyme Supabase-Abfragen für Kinder und Leistungszeiträume ohne Datensätze. Vor-/Nachvergleich bestätigt unveränderte Eltern-Auth-Verknüpfungen, Familienzuordnungen, Profile, Kinder, Einladungen, sämtliche Versandaufträge und Zustellprotokolle, Berichte und Teilnahmen. Alle 84 Einladungsvormerkungen weiterhin `held`; keine Mail versendet. Nachweise liegen privat unter `output/stripe-only/`.

Eine separate, saubere Kopie des Branches unter `/tmp/pabyak-stripe-only-20260912` wurde für Tests und Deployment verwendet, weil iCloud Teile des ursprünglichen Git-Verzeichnisses ausgelagert hatte. Vorhandene lokale Dateien wurden vor Rückübernahme gegen den unveränderten Commit geprüft. Sämtliche Code- und Dokumentationsänderungen liegen auch im ursprünglichen Arbeitsverzeichnis.

## Kalender und Teamabsagen: freigegebener Release

Stand 23.09.2026: Zweimonatskalender, rote unten einsortierte Stornos, zeitabhängige Bestätigungshinweise und kostenlose Teamabsagen sind lokal vorbereitet. Der Nutzer hat Commit/Push nach V2.0 und main sowie das Deployment ohne E-Mail-Versand ausdrücklich freigegeben.

1. Nur die neue Migration `202609230012_team_cancellations.sql` nach 010/011 prüfen und gezielt anwenden; kein pauschales `db push` wegen separat verwalteter Migrationen.
2. App und Jobs-Runner gemeinsam aktualisieren. Die Migration verändert weder Einladungsfreigaben noch Empfängerlisten und erzeugt keine Versandjobs. Bestehende betroffene Berichte erhalten eine neue Version mit unterdrücktem Versand.
3. Danach Stempelkarte und Berichtszähler für eine bereits bestehende Teamabsage lesend abgleichen. Keine echten Kunden-Testabsagen und keine Testmails.

Lokale Prüfungen: 281 erfolgreiche Vitest-Tests einschließlich isolierter PostgreSQL-Migrationen, `scripts/test-calendar-ui.mjs` mit simulierten API-Antworten, TypeScript und Produktionsbuild. Eine lokal richtige Stempelanzeige allein beweist noch nicht, dass die entfernte Datenbank bereits die neue Nachtragskapazität verwendet.
