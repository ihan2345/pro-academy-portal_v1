# Probetraining – lokale Umsetzung

Branch: `Probetraining`. Keine Produktionsmigration, kein Versand und kein Deployment durch diese Umsetzung. Der vorherige Arbeitsstand wurde separat in `19ed876` gesichert.

## Einstieg und Abläufe

- `/probetraining`: kostenlose Anfrage ohne Stripe, einmalig pro Familie für 1–3 Kinder. Elternname, E-Mail, normalisierte Telefonnummer sowie Kindername und Geburtsdatum werden gegen vorhandene Daten geprüft. Bei älteren Datensätzen ohne Datum wird das Geburtsjahr berücksichtigt. Namensgleichheit kann absichtlich zur manuellen Klärung führen. Die Meldung nennt `contact@proacademy-ak.com` und `+49 151 433 423 92` entsprechend der Academy-Website.
- Ein persönlicher Link in der Willkommensmail öffnet `/probetraining/willkommen`. Erst der ausdrückliche Klick bestätigt die E-Mail und setzt den geschützten Zugang. Reine HTTP-Linkvorschauen bestätigen keine Teilnahme oder Bewertung. Der Link gilt maximal 90 Tage, die Sitzung 30 Tage. Eltern sehen ausschließlich ihre Familie und freigegebenes Feedback.
- `/admin/probetraining` bzw. `/team/probetraining`: neue Anfragen, geplante Teilnehmer, offene Bewertungen und alle Anfragen. Telefonnummer, Daten der Kinder, Terminzuordnung, interne Notiz und Elternfeedback sind getrennt. Menübadges zählen neue Anfragen, überfällige manuelle Teilnahmebestätigungen und bestätigte Teilnahmen ohne freigegebene Bewertung. Auf Coach-/Adminstartseiten bündelt ein aufklappbarer Probetraining-Bereich diese Aufgaben mit Spieler, Aktion und aufklappbaren Informationen. Türkise Profilkarten (`#97E9E5`) zeigen Status und zuständigen Mitarbeiter.
- Nach telefonischer Absprache kann das Team ein Kind einer bestehenden Einheit zuordnen. Die Terminzuordnung ist bereits vor der E-Mail-Bestätigung möglich; Portalzugriff und weitere Mails benötigen weiterhin die Bestätigung. Das Kind liegt ausschließlich in `trial_players`; die Teilnahme verweist über `trial_player_id` darauf und hat keinen kostenpflichtigen Leistungszeitraum. Es wird kein Abo angelegt.
- Bestehende geplante Teilnehmer lassen sich im Kalendereditor und im Teilnahmedialog bis zur Bestätigung als Probetraining kennzeichnen. Falls das vollständige Geburtsdatum fehlt, kann es dort ergänzt werden. Vorhandene Eltern-/Spielerdatensätze werden wiederverwendet. Ein fehlender Elternkontakt muss zuerst ergänzt werden.
- Academy-Bewertungen können vorbereitet und ausschließlich nach manueller Teilnahmebestätigung freigegeben werden. Die automatische Teilnahmeverarbeitung überspringt Probetraining-Kinder. Interne Notizen werden niemals an Eltern gesendet. Academy- und Elternbewertung speichern jeweils Trainings-ID, Spieler-ID und Anfrage-ID. Eltern können einmal pro tatsächlichem Probetraining eine Bewertung abgeben; der Klick auf 1–5 im Portal speichert Bewertung und zuvor optional eingegebene Nachricht gemeinsam und öffnet die Dankeseite. Die Bewertungslinks in der E-Mail öffnen eine Seite, die bei sichtbarer Darstellung per POST speichert und unmittelbar zur Dankeseite weiterleitet. Reine GET-Aufrufe durch Linkvorschauen ändern keine Bewertung.
- Künftige offene Camps werden auf Anfrage- und Willkommensstartseite beworben, sofern das bestehende Camp-Modul freigeschaltet ist. Der Abo-Einstieg verlinkt auf die Academy-Angebote; bestehende Buchungs- und Stripe-Abläufe werden weiterverwendet.

## Profile, Elternlogin und Abo-Übernahme

Die E-Mail-Bestätigung verknüpft ein Elternkonto in Supabase Auth, erstellt eine echte lokale/produktive Auth-Sitzung im jeweiligen Zielsystem und verbindet bis zu drei Kinderprofile. Kinder erhalten eigene UUIDs, keinen eigenen Login. Die ursprünglichen Kinderangaben bleiben unverändert in `original_data`; aktuelle Angaben wie Name, Geburtstag, Team, Verein, Position, Größe und Entwicklungsziele sind im Probetraining-Bereich bearbeitbar.

Neue Probetraining-Kinder erscheinen weder in `players` noch in der normalen Spielerübersicht. `event_participants.player_id` bleibt für diese Teilnahmen leer; `trial_player_id` verweist auf das getrennte Profil. Bereits bestehende reguläre Kinder, deren einzelne Teilnahme manuell als Probetraining markiert wird, behalten selbstverständlich ihr reguläres Profil.

Stripe-Aktivitäten und Abo-Zuordnungsprüfungen kennzeichnen mögliche Übernahmen anhand einer bestehenden Familienzuordnung oder exakt übereinstimmender E-Mail. Bei mehreren Kindern muss die Verwaltung die Auswahl prüfen. Erst die Bestätigung einer passenden aktiven Abo-Zuordnung übernimmt das Profil mit derselben ID und allen aktuellen Angaben nach `players`, verknüpft Eltern und Kontingent und markiert das Probetraining-Profil als übernommen. Die Übernahme und die bisherigen Tarif-/Abo-Prüfungen laufen in einer gemeinsamen Transaktion; scheitert eine Prüfung, entstehen keine halben Profile. Historisches Feedback bleibt zugeordnet.

## Mails

1. Willkommensmail nach Anfrage, Planungsmail nach Zuordnung und bei Terminänderungen.
2. Erinnerung innerhalb der letzten 24 Stunden vor dem Termin. Bei kurzfristiger Planung übernimmt die Planungsmail diese Information, ohne sofort eine zweite Erinnerungsmail zu senden.
3. Sobald Coach/Admin das Feedback erstmals freigibt: persönliches Coachfeedback und Einladung zur Elternbewertung. Keine 24-Stunden-Wartezeit. `feedback_at` hält diesen Startpunkt fest; spätere Textkorrekturen starten die Folge nicht neu.
4. Angebotsmails 7 und 14 Tage nach dieser ersten Feedbackfreigabe, nur mit optionaler Marketingeinwilligung und ohne aktives bzw. bereits beginnendes Abo. Die Teilnahmezeit ist dafür unerheblich. Die Feedbackmail muss vorher versendet worden sein. Ist die 7-Tage-Stufe bis Tag 14 verpasst, wird sie ausgelassen, damit nicht beide Angebote gleichzeitig nachgeholt werden. Elternbewertungen mit 1–2 Punkten stoppen die Angebotsfolge zugunsten persönlicher Klärung.

Vor dem Versand werden Teilnahme, Freigabe, Empfänger, Einwilligung und Abo erneut geprüft. Korrigierte Teilnahme und geschlossene Anfragen stoppen passende Folgemails. Reguläre Trainingsmails werden für Probeteilnahmen nicht zusätzlich versendet. Mailaufträge verwenden eindeutige Schlüssel gegen Doppelplanung. Reines Trainingsfeedback bleibt auch nach einem Aboabschluss verfügbar; weitere Angebotsmails entfallen.

Das Formular verlangt die Zustimmung zu organisatorischen Termin-/Feedbackmails und die Kenntnisnahme der Datenschutzhinweise. Zusätzliche Angebotsmails sind separat optional und im Willkommensportal abbestellbar. Einwilligungsversion und Zeitpunkt werden gespeichert.

## Bereits eingerichtete Testumgebung

Die bisherige isolierte Testumgebung wurde aktualisiert. Einstieg: `http://127.0.0.1:3107/lokaler-test/probetraining`. Dort stehen Kontowechsel, lokaler Mailausgang und Zeitsimulation bereit. Startanleitung und Testschritte: [lokale Probetraining-Vorschau](../scripts/local-trials/README.md).

## Lokale Freischaltung

Nur mit einer isolierten lokalen Datenbank und lokalen Zugangsdaten arbeiten, nicht mit einer produktiven `.env.local`:

1. Bestehendes Basisschema einschließlich Camp-/Elternprofildaten und Release `016-calendar-backfills.sql` bereitstellen.
2. `supabase/release/017-trial-training.sql` und anschließend `018-trial-profiles-feedback.sql` einmalig anwenden. Für die Abo-Übernahme werden zusätzlich die bestehenden Paketwechsel-Releases 011, 014 und 015 vorausgesetzt. Die Migration legt den Schalter zunächst ausgeschaltet an.
3. In dieser lokalen Datenbank aktivieren:

   ```sql
   update public.system_settings
   set value = '{"enabled":true}'
   where key = 'trial_training_release';
   ```

4. Für lokale Web-App und lokalen Jobrunner `TRIAL_TRAINING_ENABLED=true`, `MAIL_PROVIDER=capture` und eine lokale `APP_URL` setzen. App mit `npm run dev` und Jobrunner mit `npm run jobs` starten.

Ohne beide Freischaltungen bleibt der Ablauf deaktiviert. Bei einer späteren Veröffentlichung benötigen Web-App und Jobrunner denselben Schalter und dieselbe Datenbankmigration. Diese Veröffentlichung ist nicht Bestandteil der lokalen Umsetzung.

## Gezielte Prüfung

- `npx vitest run tests/trials-database.test.ts tests/trials-api.test.ts tests/trials-mail.test.ts tests/training-notifications.test.ts tests/training-mail-worker.test.ts`
- `node scripts/test-trials-ui.mjs`: echte React-Komponenten mit isolierten API-Antworten, Desktop und Smartphone. Bilder unter `output/trials-review/`.
- `node scripts/test-calendar-ui.mjs`: bestehender Kalender auf mehreren Bildschirmgrößen.
- `npm run build`, `npm run build:jobs`, `npm run typecheck:jobs`.

Die Datenbanktests verwenden ausschließlich PGlite im Speicher. Browserprüfungen blockieren externe Netzwerkaufrufe. Kein Test verschickt echte Mails oder verändert produktive Datensätze.
