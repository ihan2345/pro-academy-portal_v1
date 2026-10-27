# Gastkäufe und Rabattcodes – Veröffentlichung vorbereitet

Stand: 27.10.2026. Branch `codex/shop-gastkauf`, mit `origin/main` bis `c297575` zusammengeführt. Enthalten sind damit auch die zuletzt veröffentlichten Stripe-Meldungsfilter und Admin-Entscheidungen (`543206a`) sowie die vorherigen Stripe-Konflikt-/Zahlungskorrekturen. Es gab keine Textkonflikte; die bestehende SQL-Nummer 030 war jedoch bereits produktiv belegt. Die Gastkauf-Migration wurde deshalb ohne Änderung ihres SQL-Inhalts auf 031 verschoben. Der Release-Abgleich prüft auch den unveränderten Quelltext der vorhandenen Migration 030. Die Veröffentlichung, die Anwendung von Migration 031 und die Aktivierung des neuen Mailversands warten auf ausdrückliche Freigabe.

## Verhalten

Neukunden wählen ein Angebot und geben Elternname, E-Mail, optional Telefon sowie Name und Geburtsdatum des Kindes an. Campangebote fragen zusätzlich ihre erforderlichen Campdaten ab. Vorherige Anmeldung oder E-Mail-Bestätigung ist nicht erforderlich. Ein optionaler Rabattcode steht direkt im Bestellformular. Die verbindlichen Beträge und bei Abos die Rabattdauer zeigt Stripe vor dem Abschluss an.

Die vorläufige Bestellung liegt ausschließlich serverseitig. Erst ein verifizierter Stripe-Abschluss erzeugt endgültige Eltern-, Kinder-, Kauf- und Leistungszuordnungen. Das Elternkonto hat zunächst keine Anmeldung. Nach erfolgreicher E-Mail-Bestätigung wird die bestätigte Auth-Identität mit der dafür angelegten Gastfamilie verbunden. Das bezahlte Angebot und bei Abos die bisherigen Trainingseinheiten sind unabhängig von der Aktivierung des Portalzugangs gültig; die neuen Zeitstunden bleiben reine Leistungsangaben.

Ein vorhandenes Elternkonto wird anonym niemals allein durch Eingabe seiner E-Mail übernommen. Solche Käufe bleiben mit Zahlungsnachweis in der Prüfung. Nach bestätigter Anmeldung erfolgt eine Zuordnung nur zur eigenen Familie und einem eindeutig passenden Kind; unklare, archivierte oder nicht mit einem Zugang verknüpfte Datensätze bleiben für die Verwaltung. Identische Probetraining-/Camp-Kindidentitäten werden wiederverwendet. Mehrdeutige Treffer werden nicht automatisch zusammengeführt. Eine bereits laufende Mitgliedschaft berechtigt nicht zu einer zweiten automatischen Freischaltung.

Angemeldete Familien verwenden weiter ihre bestehenden Daten und Zahlkonten. Bestehende Abo-Synchronisierung, Kündigungen und externe Stripe-Änderungen bleiben erhalten. Bei einem späteren planmäßigen Downgrade werden vorhandene Abo-Rabatte über ihre bestehenden Stripe-Discount-IDs übernommen, damit die Rabattdauer nicht neu beginnt. Änderungen an Stripe-Rabatten machen eine alte Wechselvorschau ungültig. Individuelle Rabatte direkt an einer einzelnen Abo-Position benötigen vor einem Downgrade eine persönliche Prüfung.

## Rabattregeln

- Bestehende Stripe-Promotion-Codes; kein zweites Gutscheinsystem und keine Couponerstellung im Livekonto.
- Prozent- und Betragsrabatte, bis einschließlich eines kostenlosen Abschlusses; Produkt, Währung, Mindestbetrag, Ablauf, Kunde und Einlösungsgrenzen werden geprüft. Stripe kontrolliert die Einlösung zusätzlich.
- Pro Kauf ein Rabatt. Beim Camp gewinnt der höhere Rabatt aus berechtigtem automatischem Mitgliederrabatt und eingegebenem Code. Keine Addition.
- Interne Camp-Mitgliedercodes können nicht als allgemeine Codes eingegeben werden. Persönliche Kunden- und Erstkaufbeschränkungen erfordern eine Anmeldung.
- Neue Codes gelten für neue Käufe. Ein bestehender Tarifwechsel hat keine zusätzliche Code-Eingabe; bereits vorhandene Abo-Rabatte werden berücksichtigt.
- Erwarteter Endbetrag und Promotion-ID werden vor dem Checkout gespeichert und beim Abschluss exakt gegen Stripe geprüft. Ein kostenloser Einmalkauf verwendet die abgeschlossene Checkout Session als Nachweis und erfindet keinen PaymentIntent. Camps verwenden weiterhin `camp_confirm_payment` einschließlich Kapazität, Identität und des vorhandenen No-Cost-Nachweises.

## Bestätigung, Wiederholung und Datenschutz

Bezahlte Gastkäufe erzeugen dauerhaft einen separaten Versandauftrag für Buchungsbestätigung und Portalzugang. Der bestehende Runner verarbeitet diesen mit dem vorhandenen SMTP-Anbieter, normalerweise beim nächsten Fünf-Minuten-Lauf. `PRODUCT_GUEST_MAIL_ENABLED=true` ist dafür ausdrücklich vorgesehen. Dieser Schalter gibt keine alten Erinnerungs- oder Einladungsschlangen frei und verändert keine bestehenden Versandfreigaben oder Eltern-Sperren. Versandfehler bleiben mit Wiederholungen und einer Anzeige in der Produktverwaltung sichtbar. Fehlende Kontobestätigung kündigt kein Abo und storniert keinen Kauf.

Das Gast-Browser-Cookie ist zufällig, HttpOnly, SameSite=Lax und in Produktion Secure. In der Datenbank liegt nur sein Hash. Bestellnummern alleine erlauben keinen Zugriff. Gäste können ihre offene Bestellung fortsetzen, nach Prüfung bei Stripe sicher beenden und nach bezahltem Kauf einen neuen Zugangslink anfordern. Verlorene Stripe-Antworten behalten ihre Reservierung und werden über die ursprüngliche Referenz gesucht; definitive abgelehnte Checkout-Anfragen dürfen erneut begonnen werden. Wiederholte Webhooks dürfen keine doppelte Buchung anlegen oder einen Identitätsprüfgrund überschreiben.

Bekannt abgelaufene unbezahlte Bestellungen und alte Reservierungen ohne Stripe Session werden nach zwei Tagen von vorläufigen Familien-/Kinderdaten bereinigt. Offene Remote-Sessions werden niemals ohne Stripe-Nachweis als abgebrochen behandelt. Temporäre Formulardaten und Gast-Token-Hashes landen nicht im dauerhaften Bestell-Audit. Bezahlte Bestelldaten bleiben für Zuordnung und Zahlungsnachweis erhalten.

## Prüfungen und Grenzen

- Gesamte Vitest-Suite: 1.036 Tests in 95 Dateien bestanden, dazu TypeScript für Portal und Runner; Datenbanktests installieren die vollständige SQL-Kette in PGlite, einschließlich Gast-Abos, Campbuchung, Nullbetrag, Zugriff, Identitätskonflikten und Wiederholungen.
- Isolierte Browserprüfungen auf Desktop und Mobilgeräten mit Formularvalidierung, Codeübermittlung, Bestellstatus, erneutem Zugangslink und sicherem Abbruch; keine externen Aufrufe.
- Echte Stripe-TEST-API: Prozent, Festbetrag, kostenlose Einzel- und Abo-Checkouts sowie Übernahme bestehender Rabatte in einen Downgrade-Zeitplan. Kein Geld wird abgebucht. Die Test-Checkouts werden beendet, Test-Abos gekündigt und Testangebote deaktiviert.
- Produktionsbuild für Cloudflare und Runner erfolgreich; das vollständig gebündelte Runner-CJS lädt auch isoliert ohne `node_modules`; lokaler Workerd-Smoke mit ausschließlich GET-Anfragen für Shop, öffentlichen Katalog und Login.
- Live-Stripe-Schlüssel ausschließlich lesend auf Promotion Codes einschließlich Coupondetails geprüft; keine neuen Schlüssel nötig.
- Migration 031 gegen den aktuellen Produktionsstand in einer Transaktion getestet und zurückgerollt; 022–030 stimmen exakt mit der vorhandenen Migrationshistorie überein.
- Docker ist nach dem Neustart erreichbar. Das tatsächliche Runner-Image wurde mit `workers/Dockerfile` erfolgreich gebaut; ein netzwerkisolierter Container liefert HTTP 200 auf `/health`, ohne Jobs auszuführen.
- Vollständiger lokaler Ablauf mit der vorhandenen Supabase-/Auth-Instanz und echtem gehostetem Stripe-TEST-Checkout: Gastreservierung ohne vorzeitige Eltern-/Kind-/Auth-Anlage, verweigerter Zugriff aus einem fremden Browser, 100-%-Rabatt, abgeschlossener Nullbetrag, anschließende Familienanlage, private Mail-Capture und reale Auth-Bestätigung aus einem zweiten Browser. Die bestätigte Identität erhält dieselbe Eltern-Kind-Zuordnung genau einmal. Kein SMTP-Versand, keine Abbuchung, keine produktiven Käufe oder Auth-Konten.
- Dabei wurde eine reale Stripe-Eigenheit korrigiert: Ein kostenlos abgeschlossener Checkout kann `payment_status=paid` und trotzdem keinen PaymentIntent besitzen. Der gültige Nachweis ist die abgeschlossene Session mit verifiziertem Rabatt und Nullbetrag. Beide zulässigen Statusvarianten sind zusätzlich geprüft; Camp-SQL-Tests verwenden weiterhin die vorhandene Kapazitäts-/No-Cost-Logik. Stripe-Referenz: https://docs.stripe.com/payments/checkout/no-cost-orders.
- Die produktive Migration wurde ausschließlich im Probelauf mit Rollback geprüft. Portal, Runner und Produktionsdatenbank wurden noch nicht veröffentlicht bzw. migriert.

Belege liegen ignoriert unter `output/product-guest-ui`, `output/product-guest-stripe` und `output/guest-release`. Temporäre Build- oder Testdaten und Schlüssel gehören nicht in Git.

## Veröffentlichung nach Freigabe

1. Nach Freigabe Hauptbranch erneut abrufen und prüfen, ob seit `c297575` weitere Änderungen vorliegen. Den vollständig geprüften Feature-Stand ohne Überschreiben anderer Arbeiten integrieren. Docker-Image und lokaler Gastkauf sind bereits geprüft; bei weiteren Änderungen betroffene Prüfungen wiederholen.
2. `PRODUCT_RELEASE_PROJECT_REF=vgxaatawsbzgsmqiaepj node scripts/products-release.mjs` erneut als Dry-Run ausführen. Erst nach Freigabe mit `--apply` Migration `202610270031` installieren. Bestehende Migrationen sind unverändert; der Shop-Schalter und Versand-Sperren bleiben erhalten.
3. Den Jobs-Runner mit dem neuen Bundle und `PRODUCT_GUEST_MAIL_ENABLED=true` veröffentlichen. Die vorbereitete Cloudflare-Konfiguration leitet diesen Wert in den Container weiter. Die vorhandenen Supabase-, SMTP- und Stripe-Schlüssel bleiben verwendbar; es sind keine zusätzlichen Schlüssel vorgesehen.
4. Das Portal aus einem sauberen Arbeitsverzeichnis mit eigenen Dependencies bauen (`npm ci`, `npm run build:cloudflare -- --env production`) und nach Freigabe mit `npx wrangler deploy --env production` veröffentlichen. Niemals `npm ci` in ein verlinktes `node_modules` ausführen.
5. Öffentlichen Shop, angemeldete Navigation, Katalog, Runner-Gesundheit und Versandwarteschlange prüfen. Ein echter Kauf wird nicht automatisch als Veröffentlichungstest ausgelöst.

Die Migration ist additiv und mit bestehenden authentifizierten Käufen kompatibel. Bei einem Rückbau des Portals muss der neue Runner bezahlte oder noch offene Gastkäufe weiter abarbeiten können. Die Gasttabellen nach ersten Käufen nicht entfernen; bei Problemen den bestehenden Super-Admin-Shop-Schalter verwenden und Fälle mit Zahlungsnachweis prüfen.

## Lokale Wiederaufnahme

`npm run products:setup` aktualisiert die isolierte Instanz um die bereits veröffentlichte 030 und die neue 031. Beide Migrationen wurden lokal angewendet; bestehende Testdaten und Docker-Volumes blieben erhalten. Der lokale Produktworker schreibt Buchungs-/Zugangs-Mails ausschließlich als private Capture-Dateien nach `output/product-management-local/guest-mail`; kein SMTP-Versand. Für die isolierte lokale Auth-Datenbank wird die eingegebene synthetische E-Mail für den Bestätigungslink beibehalten. Die bestehenden lokalen Produkt-, API- und Stripe-Tests bleiben verfügbar.

Zusätzliche Prüfkommandos:

```sh
node scripts/test-products-guest-ui.mjs
PRODUCT_GUEST_LOCAL_CONFIRM=synthetic-stripe-test-only node scripts/test-products-guest-local.mjs
PRODUCT_DISCOUNT_TEST_CONFIRM=synthetic-stripe-test-only PRODUCT_TEST_ENV_FILE=/absoluter/pfad/zur/isolierten/test/.env.local node scripts/test-products-discount-contract.mjs
```

Der lokale Gesamttest erfordert die laufende isolierte Test-App samt Capture-Worker; er deaktiviert seine synthetischen Stripe-Angebote, Rabattcodes und Kunden anschließend und bewahrt lokale Prüfbelege. Der Stripe-Vertragstest akzeptiert ausschließlich `sk_test_`/`rk_test_` und lädt niemals automatisch die Produktionskonfiguration.
