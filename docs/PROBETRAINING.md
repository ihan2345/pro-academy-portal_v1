# Probetraining – lokale Umsetzung

Branch: `Probetraining`. Nach der isolierten lokalen Erprobung am 22.10.2026 auf ausdrücklichen Nutzerauftrag zur Veröffentlichung freigegeben. Der vorherige Arbeitsstand wurde separat in `19ed876` gesichert. Der Produktionsstand wird unten dokumentiert.

## Einstieg und Abläufe

- `/probetraining`: kostenlose Anfrage ohne Stripe, einmalig pro Familie für 1–3 Kinder. Die Sperre prüft pro vorhandenem Familien-/Kinderdatensatz zwei von drei Kriterien: vollständiger Elternname, vollständiger Kindername und Geburtsjahr. Eine vorhandene E-Mail wird demselben Elternkontakt zugeordnet; eine zweite öffentliche Anfrage derselben Familie wird abgelehnt. Eine Telefonnummer allein sperrt nicht. Die IP-Adresse wird nur als kurzlebiger, täglich wechselnder HMAC-Prüfwert zur Anfragebegrenzung verwendet. Geschwister einschließlich Zwillings-Grenzfällen kann das Team mit dokumentierter Begründung bis maximal drei Kinder ergänzen. Die Meldung nennt `contact@proacademy-ak.com` und `+49 151 433 423 92` entsprechend der Academy-Website.
- Ein persönlicher Link in der Willkommensmail öffnet `/probetraining/willkommen`. Erst der ausdrückliche Klick bestätigt die E-Mail und setzt eine echte Supabase-Elternsitzung. Loginlinks sind signiert, an Eltern- und Familien-ID gebunden, maximal 24 Stunden gültig und nur einmal verwendbar. Erneute Links lassen sich mit neutraler Rückmeldung anfordern oder vom Team senden; maximal eine Zugangsmail je zehn Minuten. Alte v1-Links werden nicht mehr akzeptiert. Reine HTTP-Linkvorschauen bestätigen keine Teilnahme oder Bewertung. Eltern sehen ausschließlich ihre Familie und freigegebenes Feedback.
- `/admin/probetraining` bzw. `/team/probetraining`: neue Anfragen, geplante Teilnehmer, offene Bewertungen und alle Anfragen. Telefonnummer, Daten der Kinder, Terminzuordnung, interne Notiz und Elternfeedback sind getrennt. Menübadges zählen neue Anfragen, überfällige manuelle Teilnahmebestätigungen und bestätigte Teilnahmen ohne freigegebene Bewertung. Auf Coach-/Adminstartseiten bündelt ein aufklappbarer Probetraining-Bereich diese Aufgaben mit Spieler, Aktion und aufklappbaren Informationen. Türkise Profilkarten (`#97E9E5`) zeigen Status, Ansprechpartner und separat den durchführenden Coach. Teilnahmeprüfung ist 24 Stunden nach Trainingsende, Feedbackfreigabe 48 Stunden nach manueller Bestätigung überfällig. Der Aufgabenbereich kennzeichnet Fristüberschreitungen. Feedbackmails zeigen ihren Versandstatus. „Kein Interesse · Anfrage beenden“ stoppt die Folge; erfolgreiche Teilnahme und Übernahme sind getrennte Zustände. Übernommene Kinder verschwinden aus aktiven Listen und Badges; „Übernommen · Verlauf“ bewahrt die Historie und verlinkt zum regulären Spielerprofil.
- Nach telefonischer Absprache kann das Team ein Kind einer bestehenden Einheit zuordnen. Die Terminzuordnung ist bereits vor der E-Mail-Bestätigung möglich; Portalzugriff und weitere Mails benötigen weiterhin die Bestätigung. Das Kind liegt ausschließlich in `trial_players`; die Teilnahme verweist über `trial_player_id` darauf und hat keinen kostenpflichtigen Leistungszeitraum. Es wird kein Abo angelegt.
- Bestehende geplante Teilnehmer lassen sich im Kalendereditor und im Teilnahmedialog bis zur Bestätigung als Probetraining kennzeichnen. Falls das vollständige Geburtsdatum fehlt, kann es dort ergänzt werden. Vorhandene Eltern-/Spielerdatensätze werden wiederverwendet. Ein fehlender Elternkontakt muss zuerst ergänzt werden.
- Academy-Bewertungen können vorbereitet und ausschließlich nach manueller Teilnahmebestätigung freigegeben werden. Die automatische Teilnahmeverarbeitung überspringt Probetraining-Kinder. Interne Notizen werden niemals an Eltern gesendet. Academy- und Elternbewertung speichern jeweils Trainings-ID, Spieler-ID und Anfrage-ID. Eltern können einmal pro Kind und tatsächlichem Probetraining Sterne abgeben. Die Datenbank hält Eltern-ID, Kinder-ID, Trainings-ID und Anfrage-ID fest und verhindert doppelte Bewertungen. Sterne bleiben unverändert; eine schriftliche Nachricht darf danach einmal ergänzt werden. Bewertungslinks besitzen eine eigene signierte Berechtigung und erzeugen keine Auth-Sitzung. Der sichtbare Aufruf speichert per POST und öffnet eine Dankeseite mit gespeicherten Sternen und optionalem Kommentarformular. Reine GET-Aufrufe ändern keine Bewertung. JavaScript ausführende Linkscanner sind bei diesem gewünschten Ein-Klick-Verfahren nicht vollständig von menschlichen Aufrufen unterscheidbar.
- Künftige offene Camps werden auf Anfrage- und Willkommensstartseite beworben, sofern das bestehende Camp-Modul freigeschaltet ist. Der Abo-Einstieg verlinkt auf die Academy-Angebote; bestehende Buchungs- und Stripe-Abläufe werden weiterverwendet.

## Profile, Elternlogin und Abo-Übernahme

Die E-Mail-Bestätigung verknüpft ein Elternkonto in Supabase Auth, erstellt eine echte lokale/produktive Auth-Sitzung im jeweiligen Zielsystem und verbindet bis zu drei Kinderprofile. Kinder erhalten eigene UUIDs, keinen eigenen Login. Die Hauptrolle bleibt `parent`; der serverseitige Kundenstatus unterscheidet `trial`, `mixed`, `subscriber` und bestehende Konten ohne Trialbezug. Probefamilien nutzen dieselben Camp-, Konto- und Historienansichten wie andere Eltern ohne Abo. Zusätzlich erscheint ein eigener Menüpunkt „Probetraining“, solange mindestens ein noch nicht übernommenes Kind innerhalb der 180-Tage-Frist vorhanden ist. Campteilnahme allein gilt nicht als Abonnement; Abo-Kontingente und Abo-Rabatte werden weiterhin ausschließlich aus echten Zuordnungen berechnet. Die bisherige pAi-Sperre für reine Probefamilien bleibt bestehen. Gemischte Familien behalten ihren regulären Zugang. Die ursprünglichen Kinderangaben bleiben unverändert in `original_data`; aktuelle Angaben wie Name, Geburtstag, Team, Verein, Position, Größe und Entwicklungsziele sind im Probetraining-Bereich bearbeitbar.

Neue Probetraining-Kinder liegen zunächst ausschließlich in `trial_players`. Ohne Abo erscheinen sie nicht in der regulären, auf Abonnenten beschränkten Spielerprofilübersicht. `event_participants.player_id` bleibt für diese Teilnahmen leer; `trial_player_id` verweist auf das getrennte Profil. Bereits bestehende reguläre Kinder, deren einzelne Teilnahme manuell als Probetraining markiert wird, behalten selbstverständlich ihr reguläres Profil.

Stripe-Aktivitäten und Abo-Zuordnungsprüfungen kennzeichnen mögliche Übernahmen anhand einer bestehenden Familienzuordnung oder exakt übereinstimmender E-Mail. Bei mehreren Kindern muss die Verwaltung die Auswahl prüfen. Erst die Bestätigung einer passenden aktiven Abo-Zuordnung übernimmt das Profil mit derselben ID und allen aktuellen Angaben nach `players`, verknüpft Eltern und Kontingent und markiert das Probetraining-Profil als übernommen. Die Übernahme und die bisherigen Tarif-/Abo-Prüfungen laufen in einer gemeinsamen Transaktion; scheitert eine Prüfung, entstehen keine halben Profile. Historisches Feedback bleibt zugeordnet. Bei anderem Zahlerkontakt können Admins ein anderes vorhandenes Probetraining-Kind mit ausdrücklicher Begründung wählen; widersprüchliche bestehende Familienverknüpfungen bleiben gesperrt. Wird das Abo vor der E-Mail-Bestätigung übernommen, werden reguläre Benachrichtigungen nach späterer Bestätigung freigegeben. Ein bereits vereinbarter, noch zukünftiger kostenloser Termin bleibt kostenlos; seine organisatorischen Nachrichten werden neutral als Training formuliert und nicht als Probetraining-Werbung.

## Camps mit derselben Kinderidentität

Release `020-trial-camp-access.sql` ergänzt den bestehenden Campablauf. Die öffentliche Campbuchung und die manuellen Zahlungsprüfungen bieten eigene Probetraining-Kinder zur Auswahl an. Eltern bleiben mit demselben Supabase-Auth-Konto angemeldet. Offene Camps, eigene Buchungen und freigegebene historische Campberichte stehen ohne Abo zur Verfügung.

Das bisherige Campmodul benötigt eine `players`-Referenz. Deshalb verknüpft eine konkrete Campbuchung das bereits vorhandene Kind mit **derselben UUID** in `players` und `parent_players`; `trial_players.camp_player_id` dokumentiert diese Verbindung. Es entsteht keine zweite Kinderidentität. `converted_at` bleibt leer, die Probetraining-Aufgaben und -Fristen laufen weiter. Gemeinsame aktuelle Profilangaben werden in beiden Ansichten synchronisiert; `original_data` bleibt unverändert. Eine spätere bestätigte Abo-Zuordnung übernimmt genau diese ID und bewahrt Campbuchungen sowie Feedback. Bestehende Zahlungs-, Alters-, Kapazitäts- und Rabattprüfungen gelten weiter; fehlgeschlagene Prüfungen rollen die Identitätsverknüpfung mit zurück.

Nach spätestens 180 Tagen ab Familienanfrage wird der Probetraining-Teil bereinigt. Eine bestehende Campbuchung und der dafür erforderliche Eltern-/Kinderzugang bleiben samt Camphistorie erhalten. Nach Übernahme verschwindet das betreffende Kind aus der Eltern-Probetrainingansicht. Bei noch offenen Geschwistern bleibt der Menüpunkt für diese Kinder bestehen. Es gibt keine automatische Zugangssperre allein wegen Campende. Ein bloß begonnener, unbezahlter Camp-Checkout verlängert die Aufbewahrung nicht; ungenutzte Camp-Verknüpfungen werden bei der Trial-Bereinigung mit entfernt.

## Mails

1. Willkommensmail nach Anfrage, Planungsmail nach Zuordnung und bei Terminänderungen. Absage, entschuldigte Teilnahme und Nichterscheinen bekommen unterschiedliche Texte.
2. Erinnerung innerhalb der letzten 24 Stunden vor dem Termin. Bei kurzfristiger Planung übernimmt die Planungsmail diese Information, ohne sofort eine zweite Erinnerungsmail zu senden.
3. Sobald Coach/Admin das Feedback erstmals freigibt: persönliches Coachfeedback und Einladung zur Elternbewertung. Keine 24-Stunden-Wartezeit. `feedback_at` hält diesen Startpunkt fest; spätere Textkorrekturen starten die Folge nicht neu.
4. Angebotsmails 7 und 14 Tage nach dieser ersten Feedbackfreigabe, nur mit optionaler Marketingeinwilligung und ohne aktives bzw. bereits beginnendes Abo. Die Teilnahmezeit ist dafür unerheblich. Die Feedbackmail muss vorher versendet worden sein. Angebotsmails werden einmal je Familie statt einmal je Kind eingeplant. Zwischen tatsächlich versendeten Feedback-/Angebotsstufen liegen mindestens 48 Stunden. Ein passendes beginnendes oder bestehendes Familienabo stoppt die Angebotsfolge für die ganze Familie. Ist die 7-Tage-Stufe bis Tag 14 verpasst, wird sie ausgelassen, damit nicht beide Angebote gleichzeitig nachgeholt werden. Elternbewertungen mit 1–2 Punkten stoppen die Angebotsfolge zugunsten persönlicher Klärung.

Vor dem Versand werden Teilnahme, Freigabe, Empfänger, Einwilligung und Abo erneut geprüft. Korrigierte Teilnahme und geschlossene Anfragen stoppen passende Folgemails. Reguläre Trainingsmails werden für Probeteilnahmen nicht zusätzlich versendet. Mailaufträge verwenden eindeutige Schlüssel gegen Doppelplanung. Nach bestätigter Spielerübernahme werden ausstehende Probetraining-Mails des Kindes gestoppt; Feedback bleibt im Portal verfügbar. Noch nicht übernommene Geschwister erhalten weiterhin ihre organisatorischen Nachrichten. Es gibt keine zusätzliche automatische Eltern-Teilnahmemail.

Das Formular verlangt die Zustimmung zu organisatorischen Termin-/Feedbackmails und die Kenntnisnahme der Datenschutzhinweise. Zusätzliche Angebotsmails sind separat optional und im Willkommensportal abbestellbar. Einwilligungsversion (`trial-v2`) und Zeitpunkt werden gespeichert. Ohne freiwilligen Haken oder ohne bestätigte E-Mail gibt es keine Angebotsmails.

## Aufbewahrung

Der Hintergrundlauf bereinigt nicht übernommene Kinder spätestens bei der ersten Ausführung nach Ablauf von 180 Tagen ab Familienanfrage. Zugehörige Feedbacks, Teilnahmeverweise, direkte Mailjobs/-zustellungen und Auditkopien werden entfernt. Ursprüngliche Formular-Snapshots werden von gelöschten Geschwisterdaten bereinigt. Ein ausschließlich dafür neu angelegtes Elternkonto wird anonymisiert und gesperrt; Auth-Identitäten und Sitzungen werden entfernt. Gemeinsame reguläre/Stripe-/Camp-Konten und übernommene Kinder bleiben erhalten. Eine dauerhafte personenbezogene Wiederholungssperre ist nach Bereinigung nicht möglich. Die Ausführung und Fehlermeldungen des Hintergrunddienstes müssen im Betrieb überwacht werden; externe Mailpostfächer und Sicherungsfristen benötigen eine eigene Aufbewahrungsregel.

## Bereits eingerichtete Testumgebung

Die bisherige isolierte Testumgebung wurde aktualisiert. Einstieg: `http://127.0.0.1:3107/lokaler-test/probetraining`. Dort stehen Kontowechsel, lokaler Mailausgang und Zeitsimulation bereit. Startanleitung und Testschritte: [lokale Probetraining-Vorschau](../scripts/local-trials/README.md).

## Lokale Freischaltung

Nur mit einer isolierten lokalen Datenbank und lokalen Zugangsdaten arbeiten, nicht mit einer produktiven `.env.local`:

1. Bestehendes Basisschema einschließlich Camp-/Elternprofildaten und Release `016-calendar-backfills.sql` bereitstellen.
2. `supabase/release/017-trial-training.sql` und anschließend `018-trial-profiles-feedback.sql`, `019-trial-release-rules.sql`, `020-trial-camp-access.sql` und `021-trial-platform-switch.sql` einmalig anwenden. Für 020 werden die Camp-Migrationen bis einschließlich 013 vorausgesetzt. Für die Abo-Übernahme werden zusätzlich die bestehenden Paketwechsel-Releases 011, 014 und 015 vorausgesetzt. Die Migration legt den Schalter zunächst ausgeschaltet an.
3. In dieser lokalen Datenbank aktivieren:

   ```sql
   update public.platform_features
   set enabled = true
   where key = 'trial_training';
   ```

4. Für lokale Web-App und lokalen Jobrunner `TRIAL_TRAINING_ENABLED=true`, `MAIL_PROVIDER=capture` und eine lokale `APP_URL` setzen. App mit `npm run dev` und Jobrunner mit `npm run jobs` starten.

Ohne Installationsvariable und aktivierten Datenbankschalter bleibt der Ablauf deaktiviert. Web-App und Jobrunner benötigen denselben Schalter und dieselbe Datenbankmigration.

## Gezielte Prüfung

- `npx vitest run tests/trials-database.test.ts tests/trials-api.test.ts tests/trials-mail.test.ts tests/training-notifications.test.ts tests/training-mail-worker.test.ts`
- `node scripts/test-trials-ui.mjs`: echte React-Komponenten mit isolierten API-Antworten, Desktop und Smartphone. Bilder unter `output/trials-review/`.
- `node scripts/test-calendar-ui.mjs`: bestehender Kalender auf mehreren Bildschirmgrößen.
- `npm run build`, `npm run build:jobs`, `npm run typecheck:jobs`.

Die Datenbanktests verwenden ausschließlich PGlite im Speicher. Browserprüfungen blockieren externe Netzwerkaufrufe. Kein Test verschickt echte Mails oder verändert produktive Datensätze.

## Veröffentlichungsverfahren

Datenbankbestand und Funktionsvoraussetzungen vorab prüfen und sichern. Web-App und Jobrunner mit derselben Unterstützung bereitstellen, während die Freigabe noch aus bleibt; 017, 018, 019, 020, 021 in Reihenfolge anwenden und danach den zentralen Schalter kontrolliert aktivieren. Ausschließlich isoliert ohne produktive `.env.local` bauen. Lokale Kontowechsel, Zeitreise und Mail-Capture gehören nicht in die produktive Anwendung. Ein Feature-Rückzug darf bestehende Trial-Teilnahmen nicht unlesbar machen; keine Datenbankmigration rückwärts löschen. Datenschutztexte, Sicherungsfristen, echte Mailzustellung und ein kontrollierter Produktionsdurchlauf sind vor breiter Freigabe separat zu prüfen.

## Zentraler Super-Admin-Schalter

`/admin/funktionen` zeigt **Probetraining** neben pAi und dem Maskottchen. Nur der bereits berechtigte Admin mit `manage_features` kann den Schalter bedienen; Rollen, zusätzliche Rechte, pAi-Zustand und Camp-Konfiguration ändern sich nicht. Änderungen verwenden dieselbe Datenbankroutine, Paralleländerungsprüfung und Protokollierung wie pAi.

`platform_features.key = 'trial_training'` ist die verbindliche Freigabe. Die frühere lokale Einstellung `system_settings.trial_training_release` wird nicht mehr gelesen. Die Installationsvariable `TRIAL_TRAINING_ENABLED=true` bleibt in Web-App und Runner bestehen; sie ersetzt keinen aktivierten Datenbankschalter. Der Server liest die Freigabe ohne dauerhaften Cache und sperrt bei Datenbankfehlern.

Deaktivieren sperrt neue Anfragen, Probetraining-Seiten, entsprechende Teamaktionen und den Probetraining-Mailversand. Gespeicherte Familien, manuell zu bestätigende Teilnahmen, vorhandene Campzugänge und die Identitätsprüfung bei einer bezahlten Abo-Übernahme bleiben erhalten. Die 180-Tage-Bereinigung läuft weiter. Eine bestehende Probefamilie erhält durch das Ausschalten insbesondere keinen pAi-Zugang. Erneutes Aktivieren setzt die fachlichen Prüfungen fort; bereits erledigte Nachrichten werden nicht doppelt angelegt.

Die Familienstatus-Karte im Elternprofil wird erst bei belegter Abo-Historie angezeigt. Probetraining und reine Campbuchungen begründen keinen Bronze-Fortschritt.
