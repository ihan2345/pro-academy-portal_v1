# Camp-Verwaltung und persönliche Preisanzeige

Camp-Vorteile der Abo-Tarife speichern bei Auswahl automatisch und zeigen den Status unmittelbar an der betreffenden Auswahl. Auch die älteren, fest hinterlegten Tarif-IDs werden als gültige Datenbank-UUIDs akzeptiert. Die Adminprüfung und die Einschränkung auf Abo-Tarife bleiben bestehen; die Antwort enthält den tatsächlich gespeicherten Wert.

Campkarten zeigen zum gültigen verknüpften Angebot einen Frühbucherhinweis und mögliche Abo-Vorteile. Für ein ausgewähltes, zugehöriges Kind wird der persönliche Preis aus dem vorhandenen Frühbucher-/Normalpreis und dem bestehenden Camp-Vorteil berechnet, mit derselben Cent-Rundung wie im Checkout. Der Vorteil gilt zusätzlich zum Frühbucherpreis. Die Erklärung ist per Maus und Tastatur erreichbar. Campangebote werden pro Katalogseite gemeinsam gelesen; der Vorteil des ausgewählten Kindes wird einmal für alle Campkarten ermittelt. Interne Rabattcodes werden nicht an den Browser ausgegeben. Die Anzeige ersetzt weder die Preisprüfung noch die Zahlungsberechnung beim Checkout. Die zuvor besprochene Umstellung auf ein gemeinsames Stripeprodukt/einen Buchungslink ist nicht Bestandteil dieser Änderung.

Unter `/camps` können Teammitglieder Camps archivieren und als geschlossenes Camp wiederherstellen. Das Archiv und die Tarifvorteile verwenden gemeinsame aufklappbare Einstellungsflächen im bestehenden Portaldesign. Die normale Vorauswahl verwendet für das Team ein nicht archiviertes Camp. Eltern behalten den bisherigen Zugriff auf ihre Campbuchungen.

Nur Admins können ungenutzte Entwürfe ohne Zahlungsangebote endgültig löschen. Der Löschdialog verlangt eine ausdrückliche Bestätigung. Die Datenbankoperation ist zusätzlich auf den Entwurfsstatus eingeschränkt; bestehende Fremdschlüssel verhindern das Entfernen von Camps mit verknüpften Buchungs-, Zahlungs- und Stripe-Daten. Archivierung erhält sämtliche Verknüpfungen. Keine der Aktionen löscht Stripeprodukte, Preise oder Zahlungslinks.

## Prüfung

- TypeScript und gezielte Tests für ältere Tarif-IDs, persönliche Preise, Rabatte, Familienzuordnung, Produktkontexte, Löschberechtigungen, Fremdschlüsselfehler und Camp-Buchungsstatus bestanden.
- Lokale Browserprüfung: Auswahl bleibt nach Neuladen gespeichert; persönliche Preiserklärung sichtbar; Camp aus Archiv geholt und wieder archiviert; Löschdialog geöffnet und abgebrochen.
- Mobile Ansichten auf horizontalen Überlauf geprüft. Vorschauseiten, Screenshots und ausschließlich erfundene Testcamps liegen in der ignorierten lokalen Testumgebung und werden nicht veröffentlicht.
- Keine Datenbankmigration, keine Stripe-Konfigurationsänderung und keine Änderung am Jobs-Runner nötig.

Veröffentlichung: auf ausdrücklichen Nutzerauftrag vorbereitet; Ergebnis folgt nach Onlineprüfung.
