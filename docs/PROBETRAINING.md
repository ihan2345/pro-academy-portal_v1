# Probetraining – lokale Umsetzung

Branch: `Probetraining`. Keine Produktionsmigration, kein Versand und kein Deployment durch diese Umsetzung. Der vorherige Arbeitsstand wurde separat in `19ed876` gesichert.

## Einstieg und Abläufe

- `/probetraining`: kostenlose Anfrage ohne Stripe, einmalig pro Familie für 1–3 Kinder. Elternname, E-Mail, normalisierte Telefonnummer sowie Kindername und Geburtsdatum werden gegen vorhandene Daten geprüft. Bei älteren Datensätzen ohne Datum wird das Geburtsjahr berücksichtigt. Namensgleichheit kann absichtlich zur manuellen Klärung führen. Die Meldung nennt `contact@proacademy-ak.com` und `+49 151 433 423 92` entsprechend der Academy-Website.
- Ein persönlicher Link in der Willkommensmail öffnet `/probetraining/willkommen`. Erst der ausdrückliche Klick bestätigt die E-Mail und setzt den geschützten Zugang. Linkscanner bestätigen keine Teilnahme oder Bewertung. Der Link gilt maximal 90 Tage, die Sitzung 30 Tage. Eltern sehen ausschließlich ihre Familie und freigegebenes Feedback.
- `/admin/probetraining` bzw. `/team/probetraining`: neue Anfragen, offene Bewertungen und alle Anfragen. Telefonnummer, Daten der Kinder, Terminzuordnung, interne Notiz und Elternfeedback sind getrennt. Menübadges zählen neue Anfragen und bestätigte Teilnahmen ohne freigegebene Bewertung.
- Nach telefonischer Absprache kann das Team ein Kind einer bestehenden Einheit zuordnen. Die Eltern bestätigen zuvor ihre E-Mail. Die Teilnahme hat dieselbe Spieler-ID wie das spätere reguläre Profil, aber keinen kostenpflichtigen Leistungszeitraum. Es wird kein Abo angelegt.
- Bestehende geplante Teilnehmer lassen sich im Kalendereditor und im Teilnahmedialog bis zur Bestätigung als Probetraining kennzeichnen. Falls das vollständige Geburtsdatum fehlt, kann es dort ergänzt werden. Vorhandene Eltern-/Spielerdatensätze werden wiederverwendet. Ein fehlender Elternkontakt muss zuerst ergänzt werden.
- Academy-Bewertungen können vorbereitet und nach automatischer oder manueller Teilnahmebestätigung freigegeben werden. Interne Notizen werden niemals an Eltern gesendet. Academy- und Elternbewertung speichern jeweils Trainings-ID, Spieler-ID und Anfrage-ID. Eltern können einmal pro tatsächlichem Probetraining eine Bewertung abgeben; der Klick auf 1–5 speichert sie, eine Nachricht lässt sich vorher optional ergänzen.
- Künftige offene Camps werden auf Anfrage- und Willkommensstartseite beworben, sofern das bestehende Camp-Modul freigeschaltet ist. Der Abo-Einstieg verlinkt auf die Academy-Angebote; bestehende Buchungs- und Stripe-Abläufe werden weiterverwendet.

## Mails

1. Willkommensmail nach Anfrage, Planungsmail nach Zuordnung und bei Terminänderungen.
2. Erinnerung innerhalb der letzten 24 Stunden vor dem Termin. Bei kurzfristiger Planung übernimmt die Planungsmail diese Information, ohne sofort eine zweite Erinnerungsmail zu senden.
3. Frühestens 24 Stunden nach bestätigter Teilnahme: freigegebenes Coachfeedback und Einladung zur Elternbewertung. Fehlt die Bewertung des Teams, wartet diese Mail.
4. Angebotsmails frühestens nach 7 und 14 Tagen, nur mit optionaler Marketingeinwilligung und ohne aktives bzw. bereits beginnendes Abo. Bei verspätetem Coachfeedback bleiben mindestens sechs Tage zwischen Feedbackmail und erster Angebotsmail sowie sieben Tage bis zur zweiten. Elternbewertungen mit 1–2 Punkten stoppen die Angebotsfolge zugunsten persönlicher Klärung.

Vor dem Versand werden Teilnahme, Freigabe, Empfänger, Einwilligung und Abo erneut geprüft. Korrigierte Teilnahme und geschlossene Anfragen stoppen passende Folgemails. Reguläre Trainingsmails werden für Probeteilnahmen nicht zusätzlich versendet. Mailaufträge verwenden eindeutige Schlüssel gegen Doppelplanung. Reines Trainingsfeedback bleibt auch nach einem Aboabschluss verfügbar; weitere Angebotsmails entfallen.

Das Formular verlangt die Zustimmung zu organisatorischen Termin-/Feedbackmails und die Kenntnisnahme der Datenschutzhinweise. Zusätzliche Angebotsmails sind separat optional und im Willkommensportal abbestellbar. Einwilligungsversion und Zeitpunkt werden gespeichert.

## Lokale Freischaltung

Nur mit einer isolierten lokalen Datenbank und lokalen Zugangsdaten arbeiten, nicht mit einer produktiven `.env.local`:

1. Bestehendes Basisschema einschließlich Camp-/Elternprofildaten und Release `016-calendar-backfills.sql` bereitstellen.
2. `supabase/release/017-trial-training.sql` einmalig anwenden. Die Migration legt den Schalter zunächst ausgeschaltet an.
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
