# V2: Veröffentlichungsstand

Stand 23.09.2026: Nach ausdrücklicher Freigabe des Nutzers wurde `V2.0` mit Merge-Commit `db96b27` nach `main` übernommen und gepusht. Hintergrunddienst und Portal sind veröffentlicht; anschließend wurde `004-v2-activate.sql` angewendet. Coach/Admin können Nachträge jetzt speichern. Die Migrationen 010/011 und Release-Ergänzungen 002/003 waren bereits gemeinsam eingerichtet und geprüft; 010/011 sind in der Migrationshistorie eingetragen.

Produktionsversionen:

- Portal: `454607ad-25f4-48f6-b9a5-928c32127db9`.
- Hintergrunddienst: `9ced5867-c869-4a33-aeac-f98cdfde3351`.
- Container-Image: `sha256:1a5bc622144eb86900fbb210d2f7ad427a0ee36c6d67970335b11a865c4eec91`.

Beide Worker bedienen 100 % des Verkehrs mit den neuen Versionen. Variablen und Secret-Bindings sind gegenüber dem Zustand vor dem Deployment unverändert. Automatische Einladungen bleiben aus; Empfängerfreigaben wurden nicht erweitert.

Die CLI-Anmeldung wurde separat abgeschlossen, ohne den laufenden Entwicklungsserver zu stoppen. Das Projekt heißt in Supabase weiterhin `proacademy-portal-test`; maßgeblich ist die unten genannte Projekt-ID, die das Portal bereits verwendet.

## Ziel und unveränderte Einstellungen

- Supabase: `vgxaatawsbzgsmqiaepj`.
- Portal: `proacademy-portal`, Wrangler-Umgebung `production`.
- Hintergrunddienst: `proacademy-jobs`.
- Bestehende Empfängerfreigaben, zurückgehaltene E-Mails, Camp-Schalter und Job-Schalter erhalten. Keine Testnachträge oder Testmails in der echten Datenbank erzeugen.

## Datenbankvorbereitung (bereits durchgeführt, nicht erneut anwenden)

1. Supabase-Verwaltungsanmeldung über `npx supabase login` herstellen. Der vorhandene Service-Schlüssel erlaubt Datenzugriff, ersetzt aber keinen SQL-Verwaltungszugang.
2. `node scripts/prepare-v2-release.mjs` erzeugt ausschließlich lokale Dateien unter `output/v2-release/`: `preflight.sql`, `stage.sql`, `manifest.json`.
3. Read-only-Bestand mit `npx supabase db query --linked --project-ref vgxaatawsbzgsmqiaepj --file output/v2-release/preflight.sql --output json` sichern. Ausgabe lokal mit Dateirechten 0600 speichern: Sie enthält Funktionen, Berechtigungen, Versandfreigaben und Bestandszahlen. Nicht ins Repository übernehmen. Dies ist eine Sicherung der betroffenen Definitionen, kein vollständiges Datenbankbackup.
4. Die aktuellen Definitionen von `capture_report`, `register_report_file` und `parent_delivery_allowed` mit der geplanten Änderung vergleichen. Bei Abweichungen zuerst integrieren. Existierende Migrationstabelle und Historie prüfen; keine alten oder Camp-Migrationen erneut anwenden.
5. Erst danach `stage.sql` auf genau diesem Projekt ausführen. Es enthält ausschließlich die V2-Migrationen 010/011 und Release-Ergänzungen 002/003 in **einer Transaktion**. Tabellen, Registry-Historie und Berichtsfunktionen werden eingerichtet. Nachträge bleiben durch entzogene Ausführungsrechte gesperrt, solange der alte Hintergrunddienst läuft.
6. Tabellen, Fremdschlüssel, RLS und Funktionsrechte prüfen. `authenticated` darf `save_training_backfill` zu diesem Zeitpunkt **nicht** ausführen. Bestehende Berichte und Familienzahlen sowie Versandfreigaben mit der Sicherung abgleichen. Neue Registry-Zeilen sind erwartet; Nachträge und zugehörige Versandaufträge müssen leer bleiben. Die lokale Vorschau kann das Formular schon anzeigen, Speichern ist bis zur Aktivierung gesperrt.

Durchgeführt: 101 historische Stripe-Kunden erfasst, alle bestehenden Verknüpfungen abgedeckt. Alle drei neuen Tabellen haben RLS; anonyme Lesezugriffe und direkte authentifizierte Schreibzugriffe sind gesperrt. Service-API-Abfragen erfolgreich. Bestandszahlen unverändert: 97 Spieler, 87 Elternkonten, 111 Leistungszeiträume, 25 Berichtsversionen mit 25 Dateien. Versandstatus unverändert: 123 zurückgehaltene und 13 bereits versandte Aufträge. Keine Nachträge, privaten Nachtragsnotizen oder neuen Nachtrags-E-Mail-Aufträge vorhanden. Versandfreigaben und Berechtigungen der bestehenden Berichtsfunktionen stimmen mit der Sicherung überein.

Die privaten Nachweise liegen unter `output/v2-release/`: `live-preflight.json`, `restore-functions.sql`, `stage-reviewed.sql`, `live-after.json`, `verification.json` und `api-verification.json`. `stage-reviewed.sql` prüft vor Änderungen zusätzlich, dass die gesicherten Live-Funktionsdefinitionen inzwischen nicht verändert wurden. Eine pauschale Anwendung aller Migrationen ist weiterhin ungeeignet: Die historische Migrationstabelle enthält die zuvor separat eingespielten Migrationen 008/009 und die Camp-Skripte nicht.

Die lokale API erklärt die temporär entzogene Ausführungsberechtigung für Nachträge inzwischen auf Deutsch, statt die PostgreSQL-Fehlermeldung anzuzeigen. Die Schreibsperre wird durch die Korrektur nicht aufgehoben.

`002-v2-backfill-mail.sql` erweitert nur die vorhandene Liste erlaubter Nachrichtentypen. Bestehende Camp- und Einladungskontrollen, bestätigte Elternanmeldung, Empfängerfreigabe und Kontosperre bleiben erhalten. Bei einer unerwarteten Live-Funktionsdefinition bricht die SQL-Ergänzung ab. Sie gibt keine zurückgehaltenen Nachrichten frei.

## Durchgeführte Veröffentlichung nach ausdrücklicher Freigabe

1. Den geprüften Stand sichern und beide Produktionspakete bauen.
2. Den V2-Hintergrunddienst veröffentlichen; dessen Zustand prüfen. Er muss die neuen Nachtragsnachrichten und Berichtsdaten verstehen, bevor Schreiben freigeschaltet wird.
3. Das V2-Portal in Wrangler-Umgebung `production` veröffentlichen; Anmeldung, Übersicht und bestehende Stempelkarten prüfen.
4. `supabase/release/004-v2-activate.sql` ausführen. Damit dürfen Coach/Admin die neue Speicherroutine verwenden. Die Routine selbst prüft Teamrolle und Kapazität weiterhin.
5. Read-only-Abschlusskontrolle und dokumentierter Versionsstand. Einen realen Nachtrag nur mit fachlich richtigen Angaben und entsprechendem Nutzerauftrag anlegen.

Ergebnis: Der neue Runner bestätigt Supabase-, Stripe- und SMTP-Verbindung sowie PDF-Erzeugung mit HTTP 200. Das Portal liefert die Login-Seite und alle zwölf dort referenzierten statischen Dateien erfolgreich aus; geschützte Seiten leiten ohne Sitzung zur Anmeldung um, geschützte APIs antworten mit HTTP 401. Die Live-Build-ID entspricht dem geprüften Produktionspaket. Die Supabase-Abschlusskontrolle bestätigt die freigeschaltete Speicherroutine für angemeldete Nutzer mit weiterhin interner Teamprüfung; anonyme Ausführung und direkte Schreibzugriffe bleiben gesperrt.

Gegenüber dem unmittelbar vor dem Deployment gesicherten Stand sind Kunden-/Berichtszahlen und Versandstatus unverändert: 124 zurückgehaltene und 13 bereits versandte Aufträge, keine Nachträge und keine Nachtrags-E-Mail-Aufträge. Es wurden keine realen Testnachträge oder Testmails angelegt. Der inzwischen regulär gewachsene Stripe-Bestand umfasst 102 Registry-Kunden. Authentifizierte fachliche Abläufe wurden in der isolierten Testsuite geprüft; der Live-Smoke-Test hat keine Trainingsdaten geschrieben.

Private Release-Nachweise: `output/v2-release/cloudflare-before.json`, `cloudflare-after.json`, `runner-verify.json`, `portal-smoke.json`, `pre-deploy-database.json`, `post-deploy-database.json`, `post-deploy-verification.json` und `manifest.json`.

## Rücknahme

Bei Problemen zuerst die Ausführung von `save_training_backfill` für `authenticated` wieder entziehen. Neue Tabellen und vorhandene Nachträge erhalten. Sobald echte Nachträge existieren, alten Worker-Code nicht unbesehen wieder aktivieren: ältere Versionen können Nachtragsdaten in PDFs und E-Mails nicht korrekt verarbeiten. Betroffene Definitionen aus der Sicherung nur nach Prüfung der inzwischen entstandenen Daten wiederherstellen. Kein Datenbankreset, kein Löschen von Berichtsversionen.

## Prüfungen

Ergebnis am 23.09.2026: 270 Tests einschließlich der verständlichen Freigabesperre erfolgreich. Beide Typprüfungen, Cloudflare-Produktionsbuild und vollständiges Runner-Bundle erfolgreich. Das entfernte V2-Schema wurde mit `supabase/release/v2-verify.sql`, Vergleich der Sicherung und Service-/Anon-REST-Abfragen geprüft. Keine Testnachträge gegen echte Kundendaten angelegt.

- Typprüfung für Portal und Cloudflare-Hintergrunddienst.
- Gesamte Testsuite einschließlich SQL mit produktionsnaher Reihenfolge: Basis → Onboarding → Camp → V2. Die Tests prüfen weiter bestehende Camp-Nachrichten und zusätzlich Nachtragsversand, Empfängersperren, bestätigte Konten, zurückgehaltene Nachrichten sowie die temporäre Schreibsperre.
- Cloudflare-Produktionsbuild in isolierter Arbeitskopie unter `output/v2-release/app`; die lokale Dev-Instanz bleibt erhalten.
- Bestehende isolierte UI- und PDF-Prüfungen sind in `docs/version2.0.md` beschrieben. Kein Testversand an echte Empfänger.

## 28.09.2026: Stripe-Reihenfolge als Standard

Die Kontoauswahl übernimmt nach „Kunden laden“ die Reihenfolge aller Stripe-API-Seiten. Sie entspricht der geprüften Stripe-Kundenansicht: zuletzt bei Stripe erstellte Konten zuerst. Bei identischen Erstellungszeiten bleibt die Stripe-Reihenfolge erhalten. Innerhalb der Bereiche „Noch nicht zugeordnet“ und „Bereits zugeordnet“ gilt dieselbe Sortierung; historische Einträge, die Stripe nicht mehr liefert, bleiben am Ende sichtbar.

Die Buttons „Stripe-Reihenfolge“, „Im Portal hinzugefügt“ und „Name A–Z/Z–A“ wechseln die Sortierung. Erneutes Klicken auf Portal-Erfassung oder Name kehrt die Richtung um. Zehner-Schritte, Suche und der Filter auf die erste Portal-Erfassung der letzten 14 Tage bleiben erhalten. Stripe-Erstellungsdatum und Portal-Erfassung werden getrennt angezeigt. Die vorhandene Erfassungszeit in Supabase wird nicht überschrieben; keine Migration erforderlich.

283 Tests, TypeScript, Formatprüfung und isolierte UI-Prüfungen auf Desktop, Tablet sowie zwei Smartphone-Größen erfolgreich. Nur lesender Abgleich mit Stripe; keine Zuordnungen, Einladungen oder Versandfreigaben geändert. Am 28.09.2026 ohne Commit/Push auf ausdrücklichen Wunsch deployt (Portal-Version `f5e9502b-7494-47d9-8fe1-82a1eae2fd94`); der Quellstand wird mit dem Release vom 02.10.2026 eingecheckt.


## 02.10.2026: Aktive Abos und Camp-Prüfung für Coaches

„Aktive Abos“ ist ein zuschaltbarer Filter auf Kunden mit mindestens einem Stripe-Abo im Status `active`. Alle Abo-Seiten werden gelesen; lokale Zuordnungen sind keine Voraussetzung. Suche, Sortierung, Gruppierung und Zehner-Schritte bleiben erhalten. Ein zum Laufzeitende gekündigtes, noch aktives Abo zählt weiterhin. Fehler beim Lesen werden angezeigt statt als fehlende Abos behandelt.

Coaches erhalten denselben bestehenden Camp-Prüf- und Importablauf wie Admins, einschließlich neuer Familien. Die dafür nötige Berechtigungsänderung `supabase/camp/010-team-import.sql` ist angewendet; Details in `CAMP-RELEASE.md`. Kunden-, Zahlungs- und Maildaten werden beim Release nicht verändert. Der Hintergrunddienst und Versandfreigaben bleiben unverändert.

Validierung: 299 Tests, Typprüfung, isolierte Stripe-Oberflächenprüfungen auf vier Bildschirmgrößen sowie Camp-Abläufe für Admin/Coach/Eltern auf Desktop und Smartphone erfolgreich. Produktionsbuild einmalig erfolgreich erstellt; keine Wiederholung der bereits bestandenen Tests für das Deployment. Lokale Dateien mit dem Zusatz „ 2“ sind unter `output/release-20261002/duplicate-backup` gesichert und nicht Teil des Releases. Release-Nachweise liegen unter `output/release-20261002`.
