# Campübersicht und gemeinsame Preisquelle

Die Startseite `/camps` zeigt die für den jeweiligen Zugang sichtbaren Camps als Karten mit Zeitraum, Ort, Altersgruppe, Trainingsumfang, Preis und Status. Die Filter unterscheiden alle, geplante/laufende und vergangene Camps; die Karten öffnen die bisherigen Campseiten. Die Startseite leitet nicht mehr automatisch auf das erste Camp um. Archiv, Verwaltungsaktionen und Tarifvorteile bleiben erhalten. Eltern sehen weiterhin nur die bisherigen geöffneten Camps beziehungsweise ihre zugeordneten Buchungen.

Für neue automatisch angelegte Camps entsteht ein Stripeprodukt mit je einem Normal- und optionalem Frühbucherpreis. Es werden keine separaten Stripe Payment Links dafür angelegt. Der feste, teilbare Buchungslink bleibt `/camp/buchung/{camp-id}`. Der Server erstellt beim Buchungsbeginn einen individuellen Stripe-Checkout mit dem aktuell gültigen Preis, Camp-/Angebots-/Buchungsreferenz und gegebenenfalls dem geprüften zusätzlichen Abo-Vorteil des Kindes. Diese Checkout-Sitzung läuft nach rund einer halben Stunde ab (31 Minuten einschließlich einer Minute Übertragungsreserve für Stripes Mindestlaufzeit). Der Preis wird beim Buchungsbeginn bestimmt; ein bereits gestarteter Checkout behält seinen Preis während dieser Laufzeit.

Bei Shopprodukten wird einmal das Camp ausgewählt. Titel/Beschreibung und Trainingsumfang ergänzen leere Produktangaben; Normalpreis, Frühbucherpreis, Frist und vorhandene Stripe-Zuordnung werden aus den Campdaten abgerufen. Der Normalpreis wird dabei geprüft und als feste Camp-Verknüpfung hinterlegt. Die Preisfelder sind für Campprodukte keine gesonderten manuellen Eingaben mehr. Bestehende Texte und Gestaltung bleiben bearbeitbar.

Katalog und Checkout ermitteln aus dieser Verknüpfung das aktuell gültige Campangebot. Die Kaufreservierung löst den Preis ebenfalls in der Datenbank auf und hält das tatsächlich gebuchte Angebot im Auftrag fest. Bei einem Fristwechsel während der Prüfung wird die Reservierung abgewiesen, statt einen abweichenden Preis zu übernehmen. Abo-Vorteile gelten zusätzlich zum jeweiligen Grundpreis; Rabattberechtigung, Familienzuordnung, bestätigte Zahlungen, Alters-/Kapazitätsprüfung und Erfüllung nutzen die vorhandenen Routinen.

Neue direkte Camp-Checkouts erhalten den Ursprung `portal_checkout` und eine eigene gespeicherte Checkout-Sitzungs-ID. Webhooks ordnen diese Sitzung über die gespeicherte Buchung und passende Camp-/Angebotsreferenzen zu. Der vorhandene Hintergrunddienst bestätigt die Zahlung mit den bisherigen vollständigen Nachweisen. Er verarbeitet offene Webhook-Ereignisse und gleicht aktuelle offene Camp-Checkouts zusätzlich ab; die manuelle Zahlungsprüfung berücksichtigt die gespeicherten Sitzungen ebenfalls. Nicht abgeschlossene aktuelle Sitzungen werden bis zu zwei Tage nach Buchungsbeginn im Hintergrund berücksichtigt. Bestehende Stripe-Payment-Links und frühere Buchungen werden weiterhin über ihre ursprüngliche Zuordnung verarbeitet. Historische Stripeobjekte werden nicht automatisch zusammengeführt oder gelöscht.

Migration `033-camp-unified-checkout.sql` ergänzt die Sitzungsreferenz, erlaubt echte Nullwerte für linkfreie Angebote/Ereignisse und erweitert die vorhandenen Ursprungsprüfungen. Sie ersetzt keine historischen Buchungen und ändert keine Versandfreigaben.

## Validierung

Gezielte Tests decken ein Stripeprodukt mit zwei Preisen ohne Payment Links, zusätzliche Abo-Vorteile im Checkout, Camp-Zeiträume, Frühbucherwechsel in der Datenbank, verbindliche Sitzungszuordnung, fremde Metadaten, Webhook-/Hintergrundverarbeitung sowie bestehende Gast-, Produkt- und Campbuchungen ab. TypeScript sowie Build und Typprüfung des Hintergrunddiensts sind erfolgreich. Die Migration wurde lokal und in einem zurückgerollten Produktions-Probelauf geprüft.

Die lokale Kartenübersicht, der Vergangenheitsfilter und das Öffnen sowie Zurückkehren aus einer Campseite wurden im Browser an ausschließlich erfundenen Camps geprüft. Lokale Daten und Vorschauseiten werden nicht veröffentlicht. Ein echter Kauf wurde zur Releaseprüfung nicht ausgelöst.

## Veröffentlichung

Auf ausdrücklichen Nutzerauftrag am 30.10.2026 veröffentlicht. Funktionscommit `5272a07` und die anschließende Checkout-Zeitreserve `4203346` sind auf `main` gepusht. Finale Onlineprüfung abgeschlossen um 15:08 Uhr (Europe/Istanbul).

- Portal-Version `87410399-feb1-4f77-b0fc-9bd9dad266a2`, 100 % Traffic unter `https://portal.proacademy-ak.com`.
- Jobs-Version `c90d4316-30f0-4c1b-9a43-fb0b4014597b`, 100 % Traffic; Container `sha256:f7d7ceb4d4584e5f3323cd16ee8cdcede962f6cdb20974c81d2f48e4b89eb5cb`. Der gebündelte Hintergrunddienst aus dem finalen Quellstand ist bytegleich zum veröffentlichten Stand; die Zeitreserve betrifft ausschließlich die Checkout-Erstellung im Portal.
- Migration `202610300033` angewendet; der gespeicherte SQL-Text stimmt exakt mit dem Commit überein. Neue Sitzungsspalte und verschachtelte Camp-/Preisbeziehungen sind über die produktive Datenbank-API verfügbar. Die Preisfunktion ist ausschließlich für die Serverrolle ausführbar.
- TypeScript, 95 gezielte Tests sowie Portal- und Hintergrundbuild erfolgreich. Die Zeitreserve wurde zusätzlich im bestehenden Checkout-Vertragstest bestätigt.
- Zwölf vom öffentlichen Shop geladene JS-/CSS-Dateien und drei Clientdateien mit Campübersicht, Camp-Datenübernahme und persönlichem Preis stimmen anhand ihrer SHA-256-Werte exakt mit dem finalen Produktionsbuild überein. Vorhandene öffentliche Produktbilder laden weiterhin.
- Shop/Login HTTP 200, Camp-/Adminseiten ohne Anmeldung HTTP 307. Camp-Dashboard-, Camp-Lösch- und Admin-Produkt-API bleiben ohne Anmeldung mit HTTP 401 gesperrt.
- Hintergrund-Verbindungsprüfung erfolgreich: Datenbank, Stripe, SMTP und PDF. Dafür wurden keine Jobs ausgelöst und keine Nachrichten verschickt. Bestehende Worker-Konfiguration, Versandfreigaben und die ursprünglichen Zuordnungsfunktionen sind unverändert.

Private Build-, Migrations- und Prüfnachweise liegen unter `output/camp-unified-release/`.
