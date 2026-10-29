# Produktbühne, Darstellung und Hintergrundaktualisierung

Nach ausdrücklichem Nutzerauftrag am 29.10.2026 unter `https://portal.proacademy-ak.com` veröffentlicht. Funktionsstand `0fa12b3`, per Fast-forward nach `main` übernommen und auf GitHub gepusht. Portal-Version `b5c608c9-c6ef-4813-9daf-8e2b5548d0f2` erhält 100 % Traffic; Online-Abnahme am 29.10.2026 um 23:31 Uhr (Europe/Istanbul).

## Verhalten

Der Shop ergänzt die bestehende Angebotsübersicht um eine Produktbühne mit Pfeilen und Miniaturauswahl. Beim Wechsel fliegt das bisherige Produktmotiv mit Drehung hinaus, das nächste hinein. Die Hintergrundfarbe folgt der gespeicherten Effektfarbe. Reduzierte Bewegung wird berücksichtigt. Bilder behalten ihr Originalseitenverhältnis; die gemeinsame maximale Motivhöhe orientiert sich an der ursprünglichen Beispielkarte und passt sich an die Bildschirmgröße an.

Erstellung und Bearbeitung enthalten einen Farbkreis mit HEX-Eingabe, Sättigung und Helligkeit. Die Effektfarbe wird mit dem Entwurf gespeichert. „Aktionspreis“ kennzeichnet den bereits hinterlegten Preis ausschließlich für die ausgewählten Kundenarten; die Mehrfachauswahl verändert weder Preise noch Rabattberechnung oder Kaufberechtigungen.

Priorität ist ein eigenes Feld von 0 bis 10: höhere Werte zuerst, bei Gleichstand zuletzt erstellte Produkte zuerst. Eine zusätzliche ID-Sortierung hält die Seitennavigation bei identischen Erstellungszeitpunkten eindeutig. Alte `sort_order`-Werte bleiben erhalten. Bestehende Produkte ohne neue Felder bleiben lesbar und bearbeitbar.

Regelmäßige Aktualisierungen und erneuter Fensterfokus laden die aktuelle Ansicht im Hintergrund. Produktbühne und Auswahl bleiben erhalten. Erstes Laden sowie Wechsel von Suche, Kind, Anzeigeort oder Produktseite verwenden weiterhin den bisherigen Ladezustand.

## Datenbank und Umfang

Migration `202610290032` (`supabase/release/032-product-presentation.sql`) ergänzt ausschließlich berechnete Prioritätsspalten und passende Indizes. Entwurfspriorität und veröffentlichte Priorität bleiben getrennt. Effektfarbe und Aktionspreis-Einstellungen liegen im bestehenden Produkt-JSON.

Bestehende Vertrags-, Kontingent-, Zahlungs-, Rabatt-, Zugriffs- und Versandlogik bleibt erhalten. Jobs-Runner, Stripe-Einstellungen und Shop-Schalter werden nicht verändert. Lokale Design- und Prüfseiten sowie synthetische Angebote und Testdaten werden nicht veröffentlicht. Das bereitgestellte FirstTouch-Motiv dient lokal als gespeichertes Produktbeispiel; vorhandene produktive Produktbilder bleiben erhalten.

## Prüfung

- TypeScript und 72 gezielte Tests in fünf Dateien erfolgreich: Präsentationsschema, Produktdatenbank einschließlich Migration, API, Berechtigungen und Navigation.
- Lokaler HTTP-/Postgres-Abgleich mit 29 temporären Produkten über zwei Seiten: Priorität, Erstellungsdatum und ID-Reihenfolge ohne fehlende oder doppelte Produkte; Entwurf und Veröffentlichung getrennt.
- Browserprüfung: Farbe und Kundenarten speichern und erneut laden; Flugwechsel in beide Richtungen und über Miniaturen; proportionale Bildgröße; mobile Darstellung.
- Hintergrundaktualisierung mit absichtlich verzögerter Antwort geprüft: dieselbe Produktbühne und gewählte Karte bleiben erhalten. Ein Suchwechsel lädt weiterhin die neue Ansicht.

## Produktive Abnahme

- Isolierter Cloudflare-Produktionsbuild mit frischen Dependencies aus dem eingecheckten Lockfile erfolgreich; keine lokale Vorschaukonfiguration, privaten Server-Schlüssel oder Prüfseiten im Build. Wrangler-Probelauf erfolgreich.
- Migration `202610290032` nach erfolgreichem transaktionalem Probelauf installiert. Alle vorhandenen Migrationen 022–031 stimmen exakt mit der gespeicherten Migrationshistorie überein. Beide berechneten Prioritätsspalten sind vorhanden.
- Der Vorher-/Nachher-Abgleich bestätigte unveränderte Familienzuordnungen und Eltern-Sperren, bestehende Vertrags-/Kontingentfunktionen, Anzahlen von Abos, Kontingenten und Campbuchungen sowie Versandfreigaben.
- Shop und Login liefern HTTP 200. Anonyme Adminseiten werden weiter zur Anmeldung umgeleitet, die Admin-Produkt-API verweigert anonymen Zugriff mit HTTP 401. Alle zwölf von der Shopseite referenzierten JavaScript-/CSS-Dateien stimmen anhand ihrer SHA-256-Werte mit dem geprüften Build überein.
- Der öffentliche Katalog enthält weiterhin dieselben drei echten Angebote. Alle bestehenden Hauptbilder laden erfolgreich; das produktive FirstTouch-Motiv entspricht bereits dem bereitgestellten Beispiel. Preise und veröffentlichte Produktinhalte wurden nicht geändert. Neue Präsentationsfelder verwenden bis zur Bearbeitung ihre rückwärtskompatiblen Standardwerte.
- Im öffentlichen Browser wurden Produktbühne, proportional begrenzte Motivgröße und Kartenwechsel mit den produktiven Bildern geprüft. Es wurden keine Käufe oder Zahlungsanfragen ausgelöst.
- Portal-Bindings und sämtliche vorhandenen Klartext-Konfigurationswerte entsprechen der vorherigen Version. Jobs-Runner und Stripe-Konfiguration wurden nicht veröffentlicht oder geändert.

Private Nachweise liegen unter `output/shop-design-review/` und `output/shop-presentation-release/` und gehören nicht in Git.
