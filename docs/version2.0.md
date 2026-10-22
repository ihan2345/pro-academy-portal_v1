# Version 2.0 — Umsetzung

Implementiert auf Branch `V2.0`, mit Zustimmung nach `main` übernommen und am 23.09.2026 veröffentlicht. Supabase-Erweiterungen, Hintergrunddienst und Portal sind eingerichtet und geprüft; Nachträge sind für Coach/Admin freigeschaltet. Bestehende Einladungs- und Empfängerfreigaben bleiben unverändert. Versionskennungen und Prüfungen stehen in [V2-RELEASE.md](V2-RELEASE.md).

Der dokumentierte Release ergänzte die bestehende Versandfreigabe um Nachtragsmails und trennte Schemaeinrichtung von der anschließenden Freischaltung nach dem App-/Worker-Deployment.

## Stripe-Zuordnung

- Alle Kunden werden über sämtliche Stripe-Listenseiten erfasst. Die Übersicht zeigt pro Bereich zunächst zehn und mit „10 weitere anzeigen“ jeweils zehn zusätzliche Kunden, bis der vollständige Bestand sichtbar ist.
- Nicht zugeordnete Kunden stehen im Vordergrund; bereits verknüpfte Kunden bleiben eingeklappt verfügbar. Maßgeblich sind echte `parent_stripe_customers`-Verknüpfungen, nicht E-Mail-Vorschläge.
- Name A–Z/Z–A, hinzugefügt auf-/absteigend, Suche und der Filter „letzte 14 Tage“ berücksichtigen den gesamten geladenen Bestand.
- `stripe_customer_registry.first_seen_at` speichert die erste nachweisbare Erfassung im Portal. Vorhandene Eltern-, Verknüpfungs-, Abonnement-, Leistungszeitraum- und Webhook-Daten liefern historische Zeitpunkte. Das Stripe-Erstellungsdatum wird dafür nicht verwendet. Für zuvor nicht protokollierte Kunden beginnt die Historie mit ihrer ersten Erfassung durch diese Version; frühere bloße Listenaufrufe lassen sich nicht rekonstruieren.
- Webhook-Eingang und neu angelegte Verknüpfungen/Abonnements erfassen weitere Kunden. „Kunden laden“ gleicht den vollständigen Stripe-Bestand ab. Ein fehlgeschlagener Abgleich wird als unvollständig gemeldet.
- Die lokale Registry bleibt auch für früher erfasste Kunden bestehen. Wurde ein Kunde in Stripe gelöscht, ist eine neue Zuordnung nicht möglich; die Detailabfrage meldet dies.

## Nachträge

- Coach/Admin klickt auf einen offenen Stempel. Ein Speichern ergibt genau eine absolvierte Einheit.
- Pflicht: Trainingsstunden und Elternnotiz. Beispiel: 1,5 Stunden ergeben einen Stempel und 90 Minuten. Erlaubt sind bis zu zwölf Stunden pro Einheit, wie bei der bestehenden Planung.
- Interne Notiz, Datum, Bezeichnung, Ort und Coach sind optional. Die Stempelreihe bestimmt Fußball oder Athletik; die weitere Trainingsart ist optional vorbelegt.
- `training_backfills` enthält die öffentlichen Daten. `training_backfill_private_notes` enthält getrennte, ausschließlich für das Team lesbare interne Notizen. Beide Tabellen sind gegen direkte Schreibzugriffe gesperrt; geschrieben wird über eine rollenbeschränkte Transaktion.
- Anfrageschlüssel verhindern doppelte Nachträge bei Wiederholungen. Abweichende Daten unter demselben Schlüssel werden abgelehnt. Der Leistungszeitraum wird gesperrt und der freie Platz erneut geprüft.
- Unbekannte Trainingsdaten werden als „Datum nicht angegeben“ angezeigt. Die Zeitstempel in der gemeinsamen Berichtprojektion dienen bei Nachträgen ausschließlich der Sortierung; Dauer und Trainingsdatum stammen aus den ausdrücklichen Nachtragsfeldern.
- Kalenderplanung und automatische Teilnahmebestätigung bleiben regulären Terminen vorbehalten. Zähler, Elternübersicht, Stempelkarte, PDFs und Fortschrittsangaben in regulären Trainingsmails berücksichtigen die zusätzliche Einheit und Zeit.
- Orangegelbes „OK“ und eine Legende kennzeichnen die Nachtragung. Elternnotizen stehen in der Stempelkarte und im PDF; interne Notizen sind nur in der Teamansicht aufklappbar.

## Berichte und Versand

- Bei abgeschlossenen Zeiträumen entsteht in derselben Datenbanktransaktion eine neue unveränderliche Berichtsversion. Die vorhandene Hintergrundverarbeitung erzeugt die PDF-Datei. Alte Versionen werden nicht überschrieben.
- Bei laufenden Zeiträumen wird die Live-Stempelkarte aktualisiert; der Monatsbericht entsteht regulär nach Abschluss.
- Der Mailhaken ist standardmäßig aus. Eingeschaltet erzeugt er pro aktiv zugeordnetem Elternkonto genau eine Nachtragsnachricht mit Elternnotiz, Trainingsdauer, Zeitraum und WhatsApp-/Portal-Kontakt. Die Empfängerzuordnung wird vor dem Versand erneut geprüft.
- Neue Berichtsversionen aus Nachträgen lösen keine zusätzliche automatische Berichtsmail aus. Reguläre Berichtserstellung und bewusster erneuter Versand behalten ihr bisheriges Verhalten.
- Bestehende Testempfänger, Elternkontosperren und Worker-Schalter bleiben wirksam. Insbesondere werden `JOBS_ENABLED` und `STRIPE_SYNC_ONLY` durch dieses Update nicht verändert. Ohne laufende Berichtsverarbeitung bleiben neue PDFs vorgemerkt.

## Datenbank und Freischaltung

Die Migrationen `202609230010_training_backfills.sql` und `202609230011_stripe_customer_registry.sql` sind additive Voraussetzungen für diese Anwendungsversion und auf dem konfigurierten Projekt angewendet. Der genaue Stand und die erfolgte Aktivierung stehen in [V2-RELEASE.md](V2-RELEASE.md). Für noch nicht migrierte Umgebungen lädt das Portal die bisherigen Daten ohne Nachträge. Stempelkarten und Exporte bleiben verfügbar, Nachtragsaktionen sind mit einem Hinweis gesperrt; die neue Stripe-Übersicht meldet die fehlende Freischaltung, bevor sie Stripe synchronisiert. Während einer vorbereiteten, noch nicht aktivierten Version wird die fehlende Ausführungsberechtigung für Nachträge verständlich erklärt. Andere Berechtigungs- oder Verbindungsfehler werden nicht als leere Daten behandelt. Die bisherigen Tabellen und normalen Trainingsabläufe bleiben nutzbar.

## Lokale Prüfung

- `npm run typecheck`
- `npm test`: bestehende Tests plus PGlite-Datenbanktests mit sämtlichen Migrationen, Datenschutz, Berechtigungen, Wiederholungen, Berichtshistorie und Mailsteuerung.
- `npm run build`
- `node scripts/test-v2-ui.mjs`: isolierte Desktop-/Mobilprüfung mit echten UI-Komponenten und simulierten API-Antworten; keine externen Dienste. Prüft 10/20/Rest-Paginierung, Suche, Sortierung, Einklappen, Datumsfilter, Formular und Nachtragsstempel.
- Die bestehende Supabase-E2E-Suite benötigt die separat gestartete isolierte Testumgebung. Ihr Stripe-Test wurde an die neue Übersicht angepasst.
- PDF-Muster und Browserbilder liegen unter `output/pdf/` und `output/v2-review/`. Diese Ausgabeordner werden nicht versioniert.

## Kalendernachträge — veröffentlicht am 21.10.2026

Auf ausdrücklichen Nutzerauftrag veröffentlicht: Bei neuen bereits beendeten Terminen und neu hinzugefügten beziehungsweise wieder aufgenommenen Spielern in vergangenen Terminen ist der tatsächliche Teilnahmestatus Pflicht. Teilnahme zählt als Einheit plus Zeit, Fehlzeit/Teilnahmeabsage als Einheit ohne Zeit, Entschuldigung ohne Einheit. Bestehende Teilnehmer und zukünftige Planung behalten ihren Ablauf; Teamabsagen bleiben unverändert kostenfrei.

Für betroffene abgeschlossene Leistungszeiträume entsteht atomar eine neue Berichtsversion ohne zusätzliche Berichtsmail. Die optionale Nachtragsmail ist standardmäßig aus und geht nur an die betroffenen Familien; gewöhnliche Planungs-/Teilnahmemails werden für diese Nachträge unterdrückt. Bestehende Empfängerfreigaben und E-Mail-Einstellungen bleiben wirksam. Wiederholte identische Anfragen erzeugen keine doppelten Termine, Berichtsversionen oder Nachrichten.

Veröffentlichung: Zuerst den passenden Jobs-Runner bereitstellen; anschließend `supabase/release/016-calendar-backfills.sql` nach den bestehenden Kalender-/Versanderweiterungen anwenden und die passende App bereitstellen. Der bisherige Stempelkarten-Nachtrag bleibt erhalten. Keine historischen Daten werden durch das Release umgeschrieben.

Live-Abnahme: Portal `e47b5eba-e5e4-40ca-b38c-cc6cac186a25` und Jobs `a090a144-96ec-4fd1-9186-2dffb78759a7` bedienen jeweils 100 % des Verkehrs. SQL 016 gezielt angewendet; Rollenrechte und RLS geprüft. Laufzeitbindungen und Versandfreigaben unverändert. Kalenderdatei online bytegleich mit dem Produktionsbuild, Login und Zugriffsschutz erfolgreich geprüft. Runner-Verbindungsprüfung für Supabase, Stripe, SMTP und PDF erfolgreich. Keine Testnachträge oder Testmails angelegt; bestehende Termine, Teilnahmen, Nachträge und Berichte unverändert. Private Nachweise: `output/calendar-backfill-release/`.
