# Verbindliche Tarifregeln

Stand 09.09.2026, nach letzter Korrektur des Inhabers. Die Preis-IDs stehen in Migration `202609090006_stripe_catalog.sql` und wurden im vorhandenen Stripe-Konto gelesen.

| Tarif                | Bestand                | Neu ab 01.09.2026 | Rhythmus des Kontingents           |
| -------------------- | ---------------------- | ----------------- | ---------------------------------- |
| FirstTouch           | 4 Fußball              | 4 Fußball         | Stripe-Monatsperiode               |
| GameChanger          | 8 Fußball              | 8 Fußball         | Stripe-Monatsperiode               |
| Pro-Player           | 10 Fußball             | 12 Fußball        | Stripe-Monatsperiode               |
| Pro-Player Jahresabo | 10 Fußball             | —                 | monatlich trotz jährlicher Zahlung |
| NEXT LEVEL           | 8 Fußball + 4 Athletik | Sondertarif       | Stripe-Monatsperiode               |

- Bestandsprodukte bleiben für fortbestehende Abos aktiv und werden Eltern nicht als öffentlich verfügbare Produkte angeboten. Keine automatische Umstellung bei Verlängerung. Stripe-Produkte und Preise selbst wurden nicht verändert.
- Die tatsächliche Preis-ID bestimmt die Variante. Ein altes Abo erhält auch nach dem Stichtag weiter sein bisheriges Kontingent. Ein ab dem Stichtag neu erzeugtes Stripe-Abo mit einem alten Preis wird zur manuellen Prüfung markiert und erhält nicht automatisch Bestandsrechte. Maßgeblich ist der 01.09.2026 um 00:00 Europe/Berlin.
- Unbekannte Preise und Tarifwechsel innerhalb bereits gespeicherter Zeiträume markieren das Abo zur Prüfung. Historische Snapshots werden nicht überschrieben. Der archivierte 175-€-Preis des neueren PRO-Produkts wurde mangels bestätigter Verwendung nicht zugeordnet; das alte aktive 175-€-Bestandsprodukt ist zugeordnet.
- Jahreskontingente werden vom Originalbeginn abgeleitet, ohne Verkürzung des Ankertages nach Februar. Europe/Berlin bestimmt die lokale Uhrzeit; Beginn und Ende bleiben UTC-Zeitstempel. Der letzte Monat endet exakt am Stripe-Ende. Kein pauschales Kontingent von 10 für das ganze Jahr und kein frei vorziehbarer Jahrestopf.
- Nur aktive oder laufende Probeabos erzeugen neue zukünftige Kontingente. Bei beendetem Abo werden zukünftige Zeiträume gesperrt; vollständig zukünftige Monate eines Jahresabos werden `void` und nicht mehr als leere Berichte versendet. Bezahlte vergangene Rechnungsperioden können über denselben Importweg nachgetragen werden.
- `included_units` ist die Gesamtzahl; `athletics_units` ist der darin enthaltene Athletikanteil. Fußball = Gesamt minus Athletik. NEXT LEVEL darf diese beiden Kontingente nicht gegeneinander aufrechnen.
- Die Terminart „Athletiktraining“ zählt als Athletik; Gruppen-, Einzel- und Fördertraining zählen als Fußball. Ohne passendes Kontingent lässt sich der Termin nicht zuordnen. Neue Wertungsregel vom 10.09.2026 (lokal vorbereitet): Teilnahmen, Absagen und Nichterscheinen zählen als Einheit; Absagen/Nichterscheinen erhalten ein rotes OK. Trainingszeit zählt nur bei tatsächlicher Teilnahme. Entschuldigungen zählen nicht und erscheinen mit Termindaten im Portal und im Bericht. Geplante Termine und rein administrative Kinderentfernungen verbrauchen keine Einheit. Zusätzliche absolvierte Einheiten bleiben sichtbar, ohne das Kontingent zu erhöhen.
- Stempelkarten, Mitarbeiterübersicht, Benachrichtigungstexte und versionierte PDF-Berichte zeigen getrennte Disziplinen. Korrekturen an bereits bestätigten Terminen erfordern zunächst eine Teilnahme-Korrektur; historische PDF-Versionen bleiben bestehen.

## Verifikation

79 lokale Tests, darunter Migrationen/RLS, alte Verlängerung nach Stichtag, neuer PRO mit 12, Bestands-Neuabschluss abgelehnt, Jahresmonate, Monatsende/Schaltjahr/Sommerzeit, Import-Idempotenz, Kündigung, getrennte Athletik, Berichtssnapshot und unveränderliche Historie. Next-Produktionsbuild erfolgreich. PDF-Vorschauen für 12 Einheiten und NEXT LEVEL auf beiden Seiten visuell geprüft.

Migrationen 005/006 sind im Launch-Supabase angewendet; acht Varianten im echten Adminportal gelesen. Eigene Kundenportal-Konfiguration inzwischen gespeichert (siehe LAUNCH-SETUP.md); Eingeschränkter API-Schlüssel erstellt und lesende Live-Zugriffe erfolgreich geprüft; Webhook-Verbindung noch offen. Nach zusätzlicher Korrektur des Stripe-Importabrufs bestehen 84 lokale Tests und Typecheck. Kundenimport und vollständige Zustellungsabnahme stehen aus.

## Veröffentlichung der Wertungsänderung

Migration `202609100007_charged_absences.sql` zusammen mit der passenden App- und Runner-Version veröffentlichen, erst nach ausdrücklichem Auftrag. Sie trennt administrative Kinderentfernungen von wertbaren Absagen und erweitert neue Berichtssnapshots um die Wertungsregel sowie öffentliche Standort-/Coach-Angaben. Bereits erstellte Berichte und vorgemerkte PDF-Snapshots bleiben unverändert; bei Bedarf eine neue Berichtsversion bewusst erstellen. Keine automatische Neuversendung.
