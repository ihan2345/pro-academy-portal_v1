# Camp – kontrollierter Release

Stand: 18.09.2026, Branch `Camp`.

Die Veröffentlichung auf `https://proacademy-portal.proacademy-by-ak.workers.dev`, Live-Zahlungen sowie die bestehenden Hintergrundfunktionen sind ausdrücklich freigegeben. Automatische Einladungen bleiben ausgeschaltet. Zunächst darf ausschließlich `contact@kaanayhan.de` eine manuelle Einladung und nach deren bestätigter Annahme künftige Elternbenachrichtigungen erhalten. Alte zurückgehaltene Nachrichten werden nicht nachträglich versandt. Die Empfängerliste in `system_settings.portal_delivery_release` ist eine gesonderte Freigabe; das Aktivieren des Workers erweitert sie nicht.

## Herbstcamp

- Camp-ID `872b70ea-83e2-4d3b-94cf-eda4163de393`, 20.–22.10.2026, jeweils 10–15 Uhr Europe/Berlin, TuS Rotthausen.
- 229 € Normalpreis, 206,10 € Frühbucherpreis bis einschließlich 25.09.2026, 23:59:59.999 Uhr deutscher Ortszeit.
- 80 reguläre Plätze plus unverändert gespeicherte 20 % Puffer = 96. Sechs bestehende bezahlte Teilnahmen bleiben erhalten.
- Das Herbstcamp verwendet Live-Angebote. Das separate Testcamp bleibt getrennt. Ein Checkout bucht ein Kind.
- Formular: `/camp/buchung/872b70ea-83e2-4d3b-94cf-eda4163de393`.
- Legacy FirstTouch 10 %, Legacy GameChanger 15 %, Legacy Pro einschließlich Jahresabo 20 %, NEXT LEVEL 15 %. Aktueller FirstTouch 0 %, GameChanger 10 %, Pro 15 %. Nur aktive, dem Kind zugeordnete Abos zählen; höchster passender Vorteil, keine Geschwisterlogik.

## Zahlungen und Verarbeitung

Die neuen Normal-/Frühbucherangebote und der bestehende Stripe-Frühbucherlink werden gemeinsam abgeglichen. Die Camp-ID bleibt gleich; Preise, Angebote und Payment Links besitzen eigene Stripe-IDs. Bestehende Zahlungen werden weder erneut belastet noch nachträglich rabattiert.

Der separate Camp-Verarbeitungsschritt ist in den vorhandenen Cloudflare-Container eingebunden und lässt sich mit `CAMP_PROCESSING_ENABLED` unabhängig abschalten. Der Zeitplan läuft alle fünf Minuten. `/api/camp/webhook` nimmt signierte Live-Ereignisse für bekannte Camp-Angebote an; der vollständige Abgleich holt auch ausgebliebene Webhooks nach. Lokale Anmeldung und lokale Testfreigaben sind im Produktionsbetrieb gesperrt.

Passende Portal-Formularbuchungen werden nach aktueller Stripe-Prüfung bestätigt, auch wenn der Browser nicht zurückkehrt. Direktbuchungen ohne eindeutige Kinderdaten erscheinen unter „Kinder zur Prüfung / Angaben ergänzen“. Familien werden nur bei bestätigter Zuordnung erstellt. Es wird keine Einladung automatisch freigegeben.

Bezahlte Buchungen mit fehlenden Angaben zählen bereits bei der Belegung. Zahlungs-IDs verhindern Doppelzählung; vollständig erstattete Zahlungen werden abgezogen. Teilrückzahlungen und Dispute bleiben zur Prüfung. Bei Vollbelegung schließt das Formular. Keine Reservierung: Bereits geöffnete Checkouts können weitere Zahlungen ermöglichen und müssen dann manuell geklärt werden.

## Bewusst manuell

- Alte Frühbucherlinks nach Fristende sowie externe Payment Links bei Vollbelegung in Stripe deaktivieren. Der Formularpreis wechselt automatisch, ein gespeicherter externer Link wird dadurch nicht deaktiviert.
- Eine automatische Kapazitäts-E-Mail ist noch nicht implementiert. Belegung und Prüfliste im Portal kontrollieren.
- Kopierbare Rabattcodes sind weitergebbar. Unberechtigte Rabatte werden bei der Zahlungsprüfung markiert; eine Zahlung kann dann schon erfolgt sein.
- Camp-Berichte sind im Portal verfügbar. Die Abschlussmail enthält einen bereits für Eltern freigegebenen Camp-Bericht, sofern vorhanden. Spätere Berichtänderungen lösen keine zusätzliche Mail aus.
- Portalzugang anfragen speichert einen Wunsch. Einladung erfolgt durch ausdrückliche manuelle Freigabe.

## Betrieb und Rücknahme

`supabase/release/001-onboarding-mail.sql` sichert Versand, manuelle Einladung und Annahme. `supabase/camp/006-occupancy.sql` berücksichtigt noch nicht zugeordnete Zahlungen. Beide wurden in Supabase angewendet. Sie starten selbst keine Prozesse und versenden nichts.

Die ursprüngliche lokale v0-Sicherung bleibt unter `output/camp-v0` unverändert erhalten. **Mit echten Buchungen ist ein destruktives `reset=v0` gesperrt.** Für eine Rücknahme die Camp-Funktion, Live-Zahlungen und Camp-Verarbeitung deaktivieren bzw. vorherigen Code deployen; reale Teilnehmer- und Zahlungsdaten erhalten. Versand kann über `portal_delivery_release.enabled=false` separat gestoppt werden. Keine Schlüssel, Einladungslinks oder privaten Prüfdaten ins Repository aufnehmen.

## Abnahme

207 automatisierte Tests bestanden. TypeScript, Cloudflare-Produktionsbuild und Container-Bündelung geprüft. Der erste vollständige Live-Abgleich aller drei Camp-Angebote war fehlerfrei. Deployment- und SMTP-Ergebnisse stehen im folgenden Rollout-Protokoll. Eine echte neue Zahlung und die Annahme der Einladung erfolgen durch den Benutzer; sie werden nicht durch einen simulierten Erfolg ersetzt.

## Rollout abgeschlossen

- Code-Commit `0f6f1c9` auf `origin/Camp` gepusht.
- Portal-Version `0e902937-795c-4779-a86f-88b31221ee75` auf der freigegebenen workers.dev-Adresse veröffentlicht; keine eigene Domain eingerichtet.
- Worker-Version `b2988358-bf46-4547-80e2-50e959f142a8` samt neuem Container veröffentlicht, Zeitplan alle fünf Minuten. Vollständiger Lauf erfolgreich: drei Camp-Angebote abgeglichen, keine Verarbeitungsfehler.
- Produktionsprüfungen: Login/Formular erreichbar, öffentliche Camp-Daten enthalten 206,10 € und neun belegte Plätze; lokale Anmeldung 404, fremder Zugriff auf Prüfung 401, ungültige Buchung und falsche Webhook-Signatur abgewiesen. Supabase, Stripe, SMTP und PDF-Verarbeitung erfolgreich geprüft.
- Der neue Abgleich hat drei weitere bezahlte Direktbuchungen erfasst: sechs Kinder zugeordnet, drei Fälle zur Ergänzung/Zuordnung; neun Plätze insgesamt. Es wurden keine neuen Zahlungen durch die Release-Prüfung ausgelöst.
- Erste manuelle Einladung an `contact@kaanayhan.de` am 18.09.2026 um 18:00:52 UTC über Proton erfolgreich versendet, ein Zustellversuch. 84 weitere vorgemerkte Einladungen bleiben gesperrt. Die Annahme durch den Benutzer steht noch aus.
- Beim Rollout lief zunächst das bisherige Container-Abbild. Nach dessen Ablösung wurde ein weiterer vollständiger Lauf geprüft; dieser enthält den Camp-Verarbeitungsschritt. Kein zusätzlicher Einladungsversand.

## Camp-Mails (19.09.2026)

`supabase/camp/008-notifications.sql` ergänzt die Teilnahmeverwaltung und verwendet die bestehende Mailwarteschlange. Der Schalter `system_settings.camp_mail_release.enabled` erlaubt eine unabhängige Versandpause. `starts_after` verhindert rückwirkende Mails für frühere Camps. Die vorhandene Empfängerfreigabe und bestätigte Portalaktivierung bleiben zusätzlich erforderlich; automatische Einladungen bleiben deaktiviert.

- Zwei Erinnerungen pro bezahlter Buchung: sieben Kalendertage (Europe/Berlin) und 24 Stunden vor dem frühesten Campstart. Keine Erinnerungen pro einzelnem Camptag. Später bezahlte Buchungen erhalten keine nachgeholte Erinnerung.
- Teilnahme wird nach dem letzten Campende plus bestehender Pufferzeit automatisch bestätigt: zwölf aktive Stunden, 00–06 Uhr ausgenommen. Team und Admin können unter Mitglieder → Angaben „nicht teilgenommen“ oder „entschuldigt“ setzen; diese Buchungen erhalten keine positive Abschlussmail. Manuelles „teilgenommen“ ist erst nach Campende möglich.
- Eine Abschlussmail pro Buchung mit Terminen, Ort und gegebenenfalls freigegebenem Bericht. Kontaktbuttons führen zu WhatsApp und `mail@proacademy-ak.com`; Antworten gehen ebenfalls an diese Adresse.
- Zahlungsstatus, Zuordnung, Termine und Empfängerfreigabe werden unmittelbar vor dem Versand erneut geprüft. Wiederholte Worker-Läufe erzeugen keine doppelten Mails.
- Herbstcamp: Erinnerungen am 13.10. und 19.10.2026 jeweils 10 Uhr; Abschluss frühestens am 23.10.2026 um 09 Uhr (deutsche Ortszeit, nächster Fünf-Minuten-Lauf).

Migration angewendet; Portal `75145eca-215f-42e1-bfd2-b41f6e890c02` und Versanddienst `c18181c6-8187-4b9b-ad80-e8e981c87063` veröffentlicht. 19 gezielte Tests, beide TypeScript-Prüfungen und Produktionsbuild bestanden. Verbindungsprüfung für Supabase, Stripe, SMTP und PDF erfolgreich; keine Testmail versendet.
