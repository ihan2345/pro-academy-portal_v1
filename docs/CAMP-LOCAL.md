# Camps – lokaler Betrieb mit Supabase und Stripe-Testmodus

Stand: 18.09.2026. Branch `Camp`. Keine Veröffentlichung.

## Start und Einstieg

`npm run camp:dev`

- Einstieg: http://127.0.0.1:3108/camp/lokal
- Camp-Verwaltung und Elternansicht: http://127.0.0.1:3108/camps
- Formular: `/camp/buchung/<Camp-UUID>`
- Vorhandene, in `.env.local` freigegebene Testkonten können sich ohne E-Mail anmelden. Es werden keine Auth-Konten angelegt. Die Anmeldung verwendet echte Supabase-Sitzungen und deren bestehenden Datenzugriff.
- Camp-Zugang benötigt Entwicklungsmodus, explizite lokale Aktivierung und Loopback-Host. Der Server bindet ausschließlich 127.0.0.1. Kein Tunnel, Deployment oder neuer Worker.
- `.env.camp.local` enthält den vorhandenen Stripe-Testschlüssel. Keine Schlüssel in Git, Dokumentation oder Ausgaben kopieren.

## Bedienung

1. Als Admin oder Coach anmelden und „Camp erstellen“ wählen.
2. Einen aktiven Standort aus der bestehenden Tabelle `locations` auswählen; Name und Adresse werden serverseitig geprüft und als Camp-Ort übernommen. Tage, Altersbereich, Plätze und optional Frühbucherfrist eingeben; Zeiten gelten in Europe/Berlin.
3. Mit Preis werden auf ausdrücklichen Klick echte Stripe-Testprodukte, Preise, Codes und Payment Links angelegt. Ohne Preis bleibt ein Camp als Entwurf möglich. Einzahlungen in echtem Geld sind gesperrt.
4. Frühbucher und Normalangebot erhalten eigene Plan- und Preis-IDs, aber dieselbe Camp-ID. Ein Formularlink bleibt dauerhaft gleich.
5. Der Admin kann an bestehenden Abo-Tarifen ausschließlich den neuen Camp-Vorteil 10/15/20 % pflegen. Die vom Betreiber bestätigte Tarifzuordnung ist hinterlegt; siehe CAMP-RELEASE.md. Bei mehreren aktiven Abos desselben Kindes gilt der höchste Vorteil. Probeabos zählen nicht.
6. Je Checkout wird ein Kind gebucht. Vorab wird ein unbestätigter Entwurf gespeichert, ohne Platzreservierung. Erst verifizierte Stripe-Testzahlung bestätigt den Platz und gegebenenfalls die neue Eltern-Kind-Zuordnung.
7. Ein vorhandenes Elternkonto wählt ausschließlich seine zugeordneten Kinder. Ein unerkannter Gast mit bereits bekannter Kontaktadresse wird zur Anmeldung/Academy verwiesen, nicht automatisch mit einer bestehenden Familie verschmolzen.
8. Der Button „Mein Rabatt: x %“ kopiert den echten Stripe-Code. Der Kunde setzt ihn im Checkout ein. Dieser Code bleibt technisch weitergebbar.
9. Nach Rückkehr vom Checkout wird der Zahlungsstatus einmal im aktuellen Buchungsablauf geprüft. Bei geschlossenem Fenster: als Team „Zahlungen jetzt prüfen“. Keine periodische Verarbeitung und kein aktivierter Camp-Webhook.
10. „Portalzugang anfragen“ speichert nur den Wunsch in der Buchung. Keine E-Mail, kein Einladungsjob, kein Auth-Konto. Echte Camp-Neukunden können deshalb vor Versandfreigabe noch keinen neuen Portalzugang aktivieren.
11. Berichte lassen sich manuell am Teilnehmer speichern und im lokalen Elternportal anzeigen. Bestehende Abo-Berichte und Stempelkarten werden nicht wiederverwendet oder verändert.

## Grenzen dieser lokalen Fassung

- Bestehende Portal-Schreibaktionen sind im Camp-Testserver gesperrt, damit keine bestehenden Trainings-, Abo- oder Versandprozesse ausgelöst werden. Die bereits veröffentlichte Anwendung wird nicht geändert.
- Der lokale Launcher sperrt SMTP, normale Login-Mails, Cron-/Webhook-Verarbeitung und den Job-Runner. Vorhandene externe Zeitpläne werden weder aktiviert noch umkonfiguriert.
- Frühbucherwahl geschieht beim Formularaufruf/Weiterleiten. Ein alter Stripe-Link bleibt bis zur manuellen Deaktivierung nutzbar. Bereits gestartete Zahlungen können später eintreffen.
- Kapazität umfasst reguläre Plätze plus abgerundeten 10%-Puffer (einstellbar). Bei Erreichen schließt das Academy-Formular. Gleichzeitige oder externe Zahlungen werden gegebenenfalls als bezahlt, aber klärungsbedürftig gespeichert. Es gibt keine automatische Kapazitäts-Mail.
- Stripe-Test-Checkout kann abhängig vom Standort eine Währungswahl zeigen. Für die bereitgestellte Prüfung EUR wählen; die Buchungsprüfung akzeptiert das hinterlegte EUR-Angebot.
- Vollständige Erstattungen werden bei einer manuellen erneuten Zahlungsprüfung erkannt. Die Anmeldung wird dadurch nicht automatisch wieder geöffnet.
- Coaches dürfen Camps und Berichte verwalten; Tarifvorteile bleiben Admins vorbehalten.

## Rückbau: reset=v0

Im Chat `reset=v0` anfordern oder im Projektverzeichnis ausführen:

```sh
npm run reset=v0
```

Nur prüfen, ohne Änderungen:

```sh
npm run camp:reset -- --dry-run
```

Der Rückbau:

1. Prüft das Datei-Manifest auf spätere Änderungen und den richtigen Branch/das richtige Supabase-Projekt.
2. Beendet den aufgezeichneten lokalen Camp-Server, sofern Prozess und Arbeitsverzeichnis übereinstimmen.
3. Deaktiviert nur registrierte Stripe-Testlinks, Preise, Rabattcodes und Produkte; entfernt die ausschließlich dafür erzeugten Testkunden/Coupons.
4. Entfernt die Camp-Tabellen, Camp-Funktionen, zusätzlichen Spalten und Camp-Planzeilen über eine eingeschränkte Supabase-Rückbaufunktion.
5. Entfernt nur die in `camp_owned_rows` erfassten neuen Familien-/Zuordnungsdaten. Neue Verwendungen in bestehenden Prozessen führen durch Fremdschlüssel zu einem sicheren Abbruch. Aktivierte neue Auth-Zugänge werden nicht automatisch gelöscht.
6. Stellt nur Camp-veränderte Dateien aus `output/camp-v0` wieder her, einschließlich des damaligen uncommitteten Stands. Andere Änderungen werden nicht mit `git reset` überschrieben.

Nicht löschbare Stripe-Testzahlungshistorie und vorhandene Audit-Einträge bleiben nachvollziehbar erhalten. Die private v0-Sicherung bleibt ebenfalls erhalten. `reset=v0` ist keine Erstattung und kein Zurücksetzen der gesamten Supabase-Datenbank. Sobald Live-Camps oder eine Live-Zahlungsfreigabe vorhanden sind, sperrt der Rückbau vor externen Änderungen. Dann wird die Funktion deaktiviert und ein gesonderter Rückbau geplant; echte Zahlungs- und Teilnehmerdaten werden nicht gelöscht. Externe Teilaktionen können bei einem Netzwerkfehler bereits erfolgt sein; ein erneuter Lauf ist vorgesehen.

## Datenbankinstallation

Explizit angewendet auf `vgxaatawsbzgsmqiaepj`:

- `supabase/camp/001-up.sql`
- `supabase/camp/002-offer-transaction.sql`
- `supabase/camp/003-release-preparation.sql`
- `supabase/camp/004-import-review.sql`

Die Dateien liegen absichtlich außerhalb der automatischen Bestandsmigrationen. Alle Camp-Tabellen haben RLS; `anon` und `authenticated` erhalten keinen direkten Tabellenzugriff. Die lokale Anwendung prüft Rolle, Familie und Buchung und nutzt danach ausschließlich serverseitig den Service-Zugang. Es gibt keine allgemeine SQL-Ausführungsfunktion.

## Darstellung

Die Camp-Oberfläche verwendet reguläre Beschriftungen ohne Entwicklungsbanner oder Verbindungsanzeigen. „In Vorbereitung“ und „Anmeldung offen“ sind fachliche Camp-Status; unbestätigte Buchungen heißen „Zahlung ausstehend“. Die lokalen Schutzschalter bleiben unverändert aktiv. Vorhandene Testdatensätze behalten ihre Kennzeichnung, damit sie nicht mit echten Veranstaltungen und Zahlungen verwechselt werden.

## Release-Vorbereitung

Öffentlicher Betrieb ist separat vorbereitet und standardmäßig ausgeschaltet. Die lokale Anmeldung ist ausschließlich im Entwicklungsmodus erreichbar. Konfiguration, Abnahme und offene Live-Schritte stehen in [CAMP-RELEASE.md](CAMP-RELEASE.md).

## Lokaler Stripe-Abgleich · Schritt 1

Mit `CAMP_LOCAL_REVIEW_ENABLED=true` in der privaten `.env.camp.local` startet `npm run camp:dev` einen getrennten Leseprozess. Er prüft alle fünf Minuten ausschließlich die in `scripts/camp/stripe-review-links.json` hinterlegten Live-Paylinks. Aktuell ist das der bestehende Herbstcamp-Frühbucherlink. Unter dem Camp erscheint für Admins und Coaches „Stripe-Buchungen zur Übernahme“. Diese Prüfliste verändert weder Mitglieder noch Supabase, Stripe-Objekte oder Belegung. Geburtstage und endgültige Zuordnung folgen im nächsten Schritt.

Beim Stoppen des Camp-Servers oder bei `reset=v0` wird auch dieser Prozess beendet. Zum Deaktivieren den Schalter auf `false` setzen und den lokalen Camp-Server neu starten. Private Prüfsicherungen bleiben bei einem Reset erhalten. Für einen Einzellauf: `CAMP_LOCAL_REVIEW_ENABLED=true CAMP_SIDE_EFFECTS_BLOCKED=true CAMP_DEPLOYMENT_ENABLED=false NODE_ENV=development node --env-file=.env.local scripts/camp/stripe-review.mjs --once`. Parallele Läufe werden abgewiesen. Ein ausgeschalteter Rechner kann keine Zahlungen abgleichen; der nächste Lauf liest den vollständigen Stand erneut. E-Mail-Versand und bestehende Portaljobs bleiben gesperrt.

## Bestandsbuchungen und Admin-Prüfung

Am 18.09.2026 wurden die fünf vom Betreiber bestätigten Kinder mit vollständigen Geburtsdaten über den neuen Admin-Ablauf übernommen. Die Buchungen tragen `booking_origin=stripe_import`, behalten echte Stripe-Zahlungs-/Session-IDs und Beträge und verwenden keine Test-Angebots-ID. Eltern und Kinder wurden wiederverwendet; ihre Camp-Geburtsdaten und Kleidergrößen sind gespeichert. Oskar bleibt mit Jahrgangshinweis und ungeklärter Identität ohne erfundenes Datum in `camp_review_drafts`.

Neben „Mitglieder“ öffnet für Admins „Kinder zur Prüfung / Angaben ergänzen“ den Prüfbereich. Angaben können zunächst unvollständig gespeichert werden. „Zum Camp hinzufügen“ verlangt ein vollständiges Datum, eine vorhandene Eltern-Kind-Zuordnung und eine erneut bestätigte Stripe-Zahlung. Zahlung und Kind werden gegen doppelte Übernahme abgesichert; Buchung und Camp-Angaben werden atomar gespeichert. Namen können für die Camp-Buchung korrigiert werden, ohne den bestehenden Spielernamen pauschal zu überschreiben.

Die private Sicherung vor Übernahme liegt unter `output/camp-v0/before-live-import.private.json`; der ursprüngliche Spielerstand ist außerdem in der Zahlungsdokumentation gespeichert. Weil jetzt echte Bestandsbuchungen enthalten sind, sperren sowohl das Reset-Skript als auch die Datenbankfunktion den pauschalen `reset=v0`. Ein gezielter Rückbau muss diese echten Zuordnungen und Angaben separat sichern beziehungsweise wiederherstellen. Es werden keine Stripe-Zahlungen gelöscht oder erstattet.

### Serververarbeitung vorbereitet (18.09.2026)

`005-server-processing.sql` ist angewendet; die neuen Tabellen sind leer, geschützt und ohne Trigger für Jobs oder Versand. Der lokale Launcher hält `CAMP_PROCESSING_ENABLED` und `CAMP_REVIEW_ENABLED` ausdrücklich aus. Die bestehende lokale Stripe-Dateiprüfung bleibt erhalten. Admins können im Import nun eine neue Familie ausdrücklich anlegen; bestehende Kontakt-E-Mails müssen stattdessen zugeordnet werden. Eine Übernahme prüft die echte Zahlung erneut und erzeugt keine Einladung. Der ursprüngliche Rücksetzstand wurde nicht neu gesichert oder ersetzt; der Schutz für reale Importe bleibt bestehen. Details zur späteren Aktivierung stehen in `CAMP-RELEASE.md`.
