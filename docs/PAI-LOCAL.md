# pAi V3 – lokaler Umsetzungsstand

Branch: `pAi`. Commit, Push und Veröffentlichung des versteckten Zugangs sind vom Nutzer freigegeben. Der vom Nutzer ausdrücklich für Produktion bereitgestellte Schlüssel ist als Cloudflare-Secret eingerichtet.

## Bestätigte Regeln

- Eltern: höchster aktiver, eindeutig zugeordneter Abofaktor pro Konto.
- Ohne aktives Abo oder bei unbekannter Tarifzuordnung: 10 Fragen pro Berliner Kalendermonat.
- Aktive zugeordnete Tarife: bestehendes Familienabzeichen × Faktor, aufgerundet. Basis 3/5/7/10/12; Faktoren 50/70/100/100 Prozent.
- Coaches: academyweiter Lesezugriff, standardmäßig 10 Fragen täglich; Admins 15.
- Startbudget: 5 USD pro Monat. Chattext: 30 Tage. Admin kann beide Werte ändern.
- Keine fachlichen KI-Schreibaktionen. Admin-Konfiguration und persönliche Präferenz sind reguläre autorisierte Portalaktionen.

## Bausteine

- `/pai`: Chat für angemeldete Rollen ausschließlich über den direkten Link; kein Maskottchen und kein Navigationseintrag. Persönliche Einstellung auf `/pai`.
- `/admin/pai`: Nutzung, Kosten, Standards, Suche, Nutzerdetails und Ausnahmen.
- `/api/pai/[...action]`: Session-/Origin-geschützte APIs, kein direkter Browserzugriff auf OpenAI.
- `src/lib/pai/domain.ts`: zentrale Formel, validierte Konfiguration und Berliner Zeitfenster.
- `src/lib/server/pai`: schmale Datenprojektionen, bestehende Mitgliedschaftsfunktionen, autorisierte Lesewerkzeuge und Modelladapter.
- `supabase/migrations/202610170001_pai.sql`: additive Tabellen, RLS/Grants, atomare Reservierung und Audit.
- `supabase/release/013-pai-retention.sql`: ausschließlich pAi-Textbereinigung, alle zehn Minuten über pg_cron.

Ein Kontingentwechsel erzeugt keinen neuen Zähler: alle erfolgreichen Anfragen im jeweils geltenden Zeitfenster bleiben angerechnet. Ausnahmen werden einschließlich Ablaufdatum innerhalb der Reservierungstransaktion erneut gelesen. Temporäre technische Fehler geben Fragen frei; entstandene Kosten werden weitergeführt. Bei unklarem Providerstatus bleibt eine konservative Kostenreserve bestehen. Die Verwaltung zeigt Kosten als Schätzung, einschließlich der Reserven.

Modell: `gpt-5.4-mini` oder dessen freigegebener Snapshot. Preisbasis 17.10.2026: 0,75 USD/Mio. Input, 4,50 USD/Mio. Output. Gecachter Input wird konservativ zum normalen Inputpreis geschätzt. Maximal vier Modellrunden; pro Runde 40.000 Request-Bytes und 1.200 Ausgabetokens. Reserve 0,20 USD pro Frage. Die Token-/Preisgrenzen müssen vor Freigabe weiterer Modelle neu validiert werden.

Für Folgefragen werden höchstens drei eigene Nutzerfragen der letzten Stunde als Kontext verwendet; alte Werkzeugantworten und Assistentenfakten werden nicht wiederverwendet. Fachliche Daten werden erneut mit aktuellen Rechten gelesen. Jeder Provideraufruf nutzt `store: false`. Das ist keine Zusicherung von Zero Data Retention beim Anbieter.

## Lokale Vorschau

Die isolierte Kopie liegt unter `output/pai/app`, URL `http://127.0.0.1:3117/lokaler-test`.
Sie nutzt die bestehende Docker-Testdatenbank auf `127.0.0.1:55321`. Das öffentliche Datenbankschema wurde vor der pAi-Migration in `output/pai/public-before-pai.sql` gesichert. Keine Produktivdatenbank wurde verändert.

Drei zusätzliche synthetische Testkonten: `pAi Test Monatskonto`, `pAi Test Abokonto`, `pAi Test Coach`. Der Anmeldehelfer existiert ausschließlich in der ignorierten Vorschaukopie. Der Testschlüssel liegt nur in deren `.env.local` mit Dateimodus 0600. Keine Geheimnisse in versionierten Dateien.

Start aus `output/pai/app`:

```sh
NODE_OPTIONS=--require=./network-guard.cjs ./node_modules/.bin/next dev --hostname 127.0.0.1 --port 3117
```

Der Netzwerkfilter erlaubt lokale Dienste und ausschließlich den OpenAI-Responses-Endpunkt. Stripe/SMTP sind blockiert. Alte reale Abohistorien des vorhandenen lokalen Snapshots können deshalb nicht nachgeladen werden; für die pAi-Abnahme die synthetischen Konten verwenden. Unvollständige Abzeichenhistorie wird nicht erfunden. Beim monatlichen Grundkontingent ist ein unbekanntes Abzeichen kein Ausschlussgrund.

Die Vorschau ist eine Kopie: spätere Quelländerungen müssen bewusst übernommen werden. `output/pai/prepare.mjs` erzeugt die Kopie neu und ersetzt ihre Umgebungsdatei; einen bestehenden Testschlüssel dabei separat erhalten. Private Dateien und Screenshots unter `output/pai` nicht veröffentlichen.

## Prüfung

Gezielte Vitest-/PGlite-Prüfungen: Limitmatrix, Rundung, DST, Monatslimit, Präferenz, Rollen/Origin, Idempotenz, Fehlerrefund, Budget, Override/Ablauf, Retention, Produktion/Test-Trennung und vorhandene Profil-/Datenbankregeln.

Browser-/API-Prüfung auf der echten lokalen Supabase-Instanz: Desktop/Mobil, Dialog/Escape, Eltern- und Coachkontingente, deaktivierter Einstieg ohne Modellaufruf, Adminausnahme/Widerruf, gleichzeitige PostgreSQL-Reservierungen. Echter OpenAI-Verbindungstest und Werkzeugaufruf ausschließlich mit synthetischen Testfragen erfolgreich.

Screenshots und Prüfprotokolle liegen in `output/pai`. Die OpenAI-Kosten dieser Tests bleiben im lokalen Nutzungsjournal nachvollziehbar. Next-Produktionsbuild lokal geprüft; dies veröffentlicht nichts.

## Aufbewahrung und Rücknahme

Abgelaufene Inhalte werden nicht mehr über die API ausgeliefert. Der lokale Cronjob `pai-retention` entfernt abgelaufene Fragen und Antworten spätestens beim nächsten Zehnminutenlauf. „Verlauf löschen“ löscht eigene Chattexte sofort, ohne Kontingente/Kosten zurückzusetzen. Nutzungs-/Kostenmetadaten bleiben erhalten; eine organisatorische Löschfrist für diese Metadaten ist vor Produktion festzulegen.

- Sofort pausieren: Adminschalter oder `PAI_ENABLED=false` in der betreffenden Laufzeit.
- Lokale Vorschau stoppen: ihren Next-Prozess beenden.
- Lokalen Bereinigungsjob stoppen: `select cron.unschedule('pai-retention');` ausschließlich in der lokalen Testdatenbank.
- Vollständiger Datenbankrückbau: pAi-Tabellen und -Funktionen nach Sicherung gezielt entfernen. Keine bestehende Familien-/Trainingsdatenbank zurücksetzen. Der Schemasnapshot ist eine Sicherung, kein automatisch auszuführender Restore.
- Veröffentlichungen erfolgen auf Branch `pAi`; Datenbankänderungen separat berücksichtigen.

## Produktionssperre

**STOPP: Vor Veröffentlichung den neuen offiziellen pAi-Produktions-API-Schlüssel hinterlegen und bestätigen!**

Eine Implementierungsfreigabe ist keine Deployfreigabe. Vor Produktion sind separat zu bestätigen:

1. Eigenes OpenAI-Projekt/Produktions-Secret und bestätigter Modellzugriff.
2. `PAI_PRODUCTION_API_KEY`, `PAI_PRODUCTION_CONFIRMED=true`, `PAI_ENABLED=true` nur in der freigegebenen Umgebung; niemals Testschlüssel als Rückfall.
3. Gültiges Budget, Preisprüfung, Datenverarbeitung/Datenschutzhinweise und Aufbewahrungsentscheidung auch für Nutzungsmetadaten.
4. Geprüfte Zielinstanz und additive Migration; funktionierender Retention-Cronjob.
5. Aktuelle RLS-/Familienzuordnungen und vollständige autoritative Mitgliedschaftshistorie.
6. Cloudflare-Runtime-/Verbindungsabnahme und ausdrücklicher Deployauftrag.

Keine freien SQL-, Shell-, Web- oder fachlichen Schreibwerkzeuge sind registriert. Spätere Admin-Schreibaktionen benötigen einen eigenen geprüften Bestätigungsablauf.

## Kontext und Chatdarstellung (18.10.2026)

- Eltern können Einheiten, Trainings und Camps ohne Spielernamen abfragen. Ein leerer Spielerbezug wird serverseitig in alle über die Sitzung sichtbaren eigenen Kinder aufgelöst; Ergebnisse bleiben pro Kind getrennt. Fehlende Daten werden nicht als null Verbrauch interpretiert.
- Trainer/Admins bekommen bei allgemeinen Trainingsfragen academyweit jeweils bis zu sechs vergangene und kommende, nicht abgesagte Termine. Konkrete Spieler werden über die bestehende autorisierte Suche aufgelöst. Adminstatistiken bleiben Admins vorbehalten.
- Die geprüfte Rolle wird ausdrücklich als Modellkontext gesetzt. Die letzten drei Gesprächsbeiträge dienen nur zur Bezugsklärung; frühere Testanweisungen gelten nicht für neue Fragen. Fakten werden erneut abgefragt.
- Das Maskottchen öffnet auch auf `/pai` ein Dialogfenster. Beide Ansichten synchronisieren den Verlauf im selben Browserfenster nach Senden/Löschen. Kompakte Kontingentanzeige, stärkerer Kontrast, scrollbarer Verlauf, Enter zum Senden und Umschalt+Enter für Zeilenumbrüche.
- Für den lokalen Test wurde zusätzlich die vorhandene Migration `202609230010_training_backfills.sql` angewendet, da die Testdatenbank diese Tabelle noch nicht enthielt. Vorherige Sicherung: `output/pai/public-before-context-update.sql`. Keine Produktionsmigration.

## Erweiterte Leseberichte

`get_portal_report` unterstützt Anwesenheit/Fehlzeiten einschließlich datierter Nachträge, aktive Abo-Spieler (dedupliziert), monatliche Spielerneuanlagen/Trainings sowie Kalenderstunden nach Trainer und Standort. Ohne Zeitraum gilt der laufende Monat, maximal zwei Jahre pro Anfrage. Elternberichte nutzen die bestehende Sitzungs-RLS; Trainer-/Standortvergleiche sind nur für Staff/Admin. Aboverknüpfungen werden erst nach Ermittlung der erlaubten Spieler gelesen. Alle Summen benötigen vollständige paginierte Abfragen (maximal 10.000 Datensätze); angezeigte Ranglisten sind auf 30 Zeilen begrenzt und als Auszug markiert.

`get_subscription_endings` ist für alle drei Rollen vorhanden, mit entsprechender Spielerbegrenzung. Es liest ausdrückliche Kündigungen aus Stripe; ein Leistungszeitraumende wird nicht als Kündigung interpretiert. Standard: nächste 30 Tage.

`get_billing_report` erlaubt Admins Auswertungen der verknüpften Portal-Zahlungskonten und Eltern ausschließlich ihre eigenen Konten. Coaches bekommen gemäß bestehender Portalberechtigung keine Finanzdaten. Ein mehrdeutig mehreren Familien zugeordnetes Stripe-Konto wird für Eltern abgewiesen. Unterstützt werden Zahlungseingänge (erfolgreich eingezogene Beträge minus inzwischen erfasste Erstattungen, getrennt je Währung) und offene Rechnungen. Das ist keine steuerliche Umsatzrechnung. Providerzugriffe sind ausschließlich lesend und begrenzt; keine Änderungen oder Benachrichtigungen.

Live-Stripe-Berichte werden in der isolierten lokalen pAi-Umgebung bewusst nicht abgerufen. Die Antwort benennt diese Datenlücke. Produktiv greifen die Funktionen auf die bestehende Stripe-Anbindung zurück; Produktionszugriffe wurden hier nicht ausgeführt. Logiktests verwenden synthetische Zahlungs-/Kündigungsdaten.

Standortkapazitäten sind im Trainingsmodell nicht hinterlegt: Vergleich nach Trainingsstunden möglich, prozentuale Auslastung nicht. Trainerstunden sind geplante Dauer vergangener, nicht abgesagter Kalendertermine, keine bestätigten Arbeitszeiten. Entwicklung basiert auf gespeicherten Spielerneuanlagen, nicht auf rekonstruierten historischen Mitgliederbeständen. Undatierte Nachträge werden als Einschränkung einer zeitbezogenen Anwesenheitsstatistik kenntlich gemacht.

## Versteckter Zugang

Maskottchen, pAi-Navigation, Admin-Menüeintrag und Kontoseiten-Einstellung sind entfernt. `/pai` bleibt authentifiziert direkt erreichbar und ist mit `noindex` versehen. Admins finden die Verwaltung nur innerhalb der pAi-Seite. Das Verstecken ist keine zusätzliche Berechtigungsgrenze. Ohne Produktions-Secret liefert die veröffentlichte Seite keine KI-Antworten.

## Veröffentlichung am 18.10.2026

Auf ausdrücklichen Nutzerauftrag wurde Branch `pAi` committed, mit den aktuellen Änderungen aus `main` zusammengeführt und gepusht. Der Zugang ist ausschließlich direkt unter `https://portal.proacademy-ak.com/pai` sichtbar und verlangt Anmeldung. Maskottchen, Navigationseinträge und die pAi-Kontoeinstellung außerhalb dieser Seite sind entfernt.

Die additive Migration `202610170001_pai.sql` und der Retention-Job wurden auf dem bestehenden Projekt `vgxaatawsbzgsmqiaepj` eingerichtet. Bestandszahlen blieben bei Anwendung unverändert: 126 Spieler, 113 Eltern, 219 Leistungszeiträume. Der initiale Budgetwert beträgt 5 USD monatlich, Chattexte werden 30 Tage aufbewahrt.

Der Nutzer hat den zuvor temporär verwendeten Schlüssel in dieser Veröffentlichung ausdrücklich auch für Produktion bereitgestellt. Er wurde ausschließlich als `PAI_PRODUCTION_API_KEY` im Cloudflare-Worker hinterlegt, nicht ins Repository oder Browser-Bundle übernommen. Die Produktionsschalter sind aktiv; bestehende Variablen und Secret-Bindings wurden erhalten.

Aktive Portal-Version nach Secret-Einrichtung: `e1958df3-2baa-43e0-8e55-8bfca20fd713` (100 % Traffic). 794 Tests erfolgreich; separater Build aus dem Lockfile einschließlich TypeScript/OpenNext erfolgreich. Verborgene Einstiegspunkte und direkter Zugriff wurden lokal für drei Rollen geprüft. Online bestätigt: Login-Weiterleitung, API-Authentifizierung, Origin-Schutz, fehlende lokale Loginroute und bytegleiche Auslieferung des Chat-Bundles. OpenAI-Modellzugriff mit dem bereitgestellten Schlüssel bestätigt; kein authentifizierter Chat mit produktiven Familiendaten als Test ausgeführt. Private Nachweise unter `output/pai-release/`.

### Cloudflare-Korrektur nach erster Nutzung

Der erste authentifizierte Produktionsversuch zeigte eine Laufzeitabweichung, die im Node-Test nicht auftrat: Cloudflare lehnt `fetch(..., { redirect: "error" })` ab. Der OpenAI-Aufruf verwendet nun `manual`; Weiterleitungen werden nicht verfolgt und bleiben erfolglose Antworten. Ein echter Responses-Aufruf in der lokalen Cloudflare-/workerd-Laufzeit lieferte danach HTTP 200 und die Testantwort „bereit“ (ohne personenbezogene Daten). Die nur für Eltern verfügbare persönliche Aktivierung wird auf `/pai` nur für Eltern gerendert.

58 pAi-Tests, Rollen-UI-Prüfung und Cloudflare-Produktionsbuild erfolgreich. Drei nachweislich vor dem Provideraufruf gescheiterte Produktionsanfragen hatten keine Tokenkosten und keine angerechneten Fragen; ihre zusammen 0,60 USD Unsicherheitsreserve wurde freigegeben. Funktionscommit: `abaf0f0`.

Korrigierte Produktionsversion: `793251c3-b2f7-499b-b05a-f59599ea6b5d`, 100 % Traffic. Online-Zugriffsschutz, Secret-Bindings und Bundle-Abgleich erneut erfolgreich.

### Teilnehmerlisten für Trainings-Folgefragen

Trainingsübersichten liefern jetzt interne Eventreferenzen. Das neue lesende Werkzeug `get_training_participants` lädt ausgewählte Termine und deren Teilnehmer mit Anwesenheitsstatus. Admin/Staff nutzen die bestehenden Academyrechte; Eltern sehen auch bei gemeinsamen Gruppenterminen ausschließlich ihre eigenen aktiven Kinder. Sitzungs-RLS wird durch einen expliziten Filter auf die sichtbaren Kinder ergänzt. Nicht sichtbare Termine werden vor dem Teilnehmerabruf abgewiesen; entfernte Teilnehmer ausgeschlossen, Einplanung und Anwesenheit getrennt ausgewiesen. Vollständige Statuszählung, sichtbare Namensliste maximal 60 je Termin mit Auszugshinweis.

61 pAi-Tests, Typecheck und Cloudflarebuild erfolgreich. Ein echter Modelltest mit ausschließlich synthetischen Daten löste „Wer hat daran teilgenommen?“ selbstständig über `get_training_history` und `get_training_participants` auf und unterschied Anwesenheit von bloßer Einplanung. Keine Migration nötig.
