# Schnellere Auswirkungsprüfung und getrennte Vorgangsanzeigen

Auf ausdrücklichen Nutzerauftrag vom 30.10.2026 zur Veröffentlichung unter `https://portal.proacademy-ak.com` vorbereitet.

Die Auswirkungsprüfung lädt Familiendaten in Gruppen statt Familie für Familie über getrennte Netzwerkanfragen. Verknüpfte Kinder, Probetrainings, Mitgliedschaften, Leistungszeiträume, Campbuchungen, Käufe und individuelle Freigaben werden pro Gruppe gemeinsam geladen und anschließend dem jeweiligen Familienkontext zugeordnet. Die bestehende Kontextberechnung und Produkt-Berechtigungslogik wird weiterverwendet. Gemeinsam zugeordnete Kinder übernehmen keine familienfremden Campbuchungen, Käufe oder Freigaben.

IN-Listen sind auf 100 Werte begrenzt; zusammengehörige Daten werden weiterhin vollständig in Seiten mit höchstens 500 Zeilen gelesen. Zusammengeführte Ergebnisse behalten die ursprüngliche ID-Reihenfolge. Freigaben über Eltern-ID und Auth-ID werden ohne Duplikate berücksichtigt. Fehler eines benötigten Datenabrufs brechen die Auswertung weiterhin ab. Prüfung und Veröffentlichung behalten den vorhandenen Datenstand-Abgleich, Versions-/Entwurfsschutz, signierten Prüfbeleg und Stripe-Preisabgleich.

Die Bedienoberfläche unterscheidet „Entwurf wird gespeichert“, „Auswirkungen werden geprüft“ und „Produktfassung wird übernommen“. Nur die zur laufenden Phase gehörige Schaltfläche zeigt einen Fortschrittsindikator. Muss eine Prüfung zunächst einen geänderten Entwurf speichern, erscheinen die Phasen nacheinander. Der irreführende Hinweis „lokale Datenbank“ wurde durch eine neutrale Beschreibung des Vergleichs ersetzt.

## Messung und Prüfung

Ein einmaliger, ausschließlich lesender Vorher-/Nachher-Vergleich mit denselben 20 nicht archivierten produktiven Familien ergab:

| Familiendaten-Abruf |    Bisher | Gebündelt |
| ------------------- | --------: | --------: |
| Laufzeit            | 13.116 ms |    543 ms |
| Datenbankanfragen   |       178 |         8 |

Das entspricht **95,9 % weniger Abrufzeit** und **95,5 % weniger Datenbankanfragen**. Die ermittelten Kontexte waren vollständig identisch; der Datenstand blieb während des Vergleichs unverändert. Die Messung erfolgte vom Entwicklungsrechner aus und umfasst den Familiendaten-Abruf, nicht die vollständige HTTP-Anfrage, das reine Entwurfspeichern oder einen Stripe-Preisabgleich. Netzwerk, Familienzahl und Datenumfang beeinflussen die tatsächliche Gesamtersparnis.

Neue Regressionstests vergleichen Einzel- und Gruppenabruf einschließlich gemeinsam zugeordneter Kinder, aktiver und ehemaliger Probetrainings, archivierter Kinder, aktiver/abgelaufener Mitgliedschaften, bezahlter/stornierter Campbuchungen und persönlicher Freigaben. Sie prüfen außerdem mehr als 500 verwandte Datensätze, begrenzte IN-Listen, Fehlerabbruch und die Admin-Berechtigung. Der lokale Browsernachweis mit verzögerten Antworten bestätigt getrennte Speicher-, Prüf- und Übernahmephasen am synthetischen Prüfprodukt.

Keine Datenbankmigration oder Änderung an Zahlungs-, Vertrags-, Kontingent- und Versandabläufen. Produktive Produktfassungen und Kundendaten wurden für die Messung nicht geändert. Private Mess- und Prüfbelege liegen unter `output/product-impact-performance/`.
