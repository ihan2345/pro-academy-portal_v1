# Geschenkkarten – Veröffentlichung 31.10.2026

Code: `fcecfc4` auf `main`, einschließlich der Vorbereitung aus `cffc807`. Veröffentlicht auf https://portal.proacademy-ak.com.

## Aktive Versionen

- Portal: `1559da0c-3337-4578-b9c5-cfce97c94d56`, 100 %.
- Jobs-Gateway: `5b2570eb-28b6-4d43-a11b-07826dcdc5d5`, 100 %.
- Node-Container: `sha256:c6712d0558f20d062f87633c28aca0073ede14a86fc8cb5023201e0f12ac2372`; Rollout vollständig abgeschlossen.
- Datenbank: Migrationen `202610310034` bis `202610310038` transaktional angewendet. Vorheriger Dry-run und abschließende SQL-Dateien stimmen überein.
- Geschenkverkauf, Einlösung und Mailverarbeitung aktiviert. Verschlüsselungsschlüssel identisch in beiden Diensten hinterlegt und separat gesichert; kein Schlüssel im Repository.

## Verhalten

Geschenkbeträge werden unter Produkte → Geschenke angelegt und regulär veröffentlicht. Die Veröffentlichung der Funktion erstellt keine beispielhaften Katalogprodukte oder Testbestellungen in Produktion.

Die Karte umfasst Kaufbestätigung, personalisierten PNG-Export, Käufer-/Empfängernachrichten, geschützten Bestellstatus ohne Anmeldung, Profilverknüpfung, Guthabenmenü und einmaligen Guthabenhinweis im Shop. Nach Einlösung erhält verbleibender Wert einen neuen Code und eine Restguthaben-Mail. Die Gültigkeit bleibt bis Ende des dritten Kalenderjahres nach dem ursprünglichen Kaufjahr bestehen.

Gutscheinwert wird auf Stripe-Rechnungen als Zahlung zugeordnet. Echte Preisvorteile werden vorher berechnet und wiederkehrende Abo-Rabatte bleiben erhalten. Das Abrechnungsmodell berücksichtigt die Betreiberangaben „sämtliche Leistungen in Deutschland, überall 19 %“. Vollständige Rückzahlungen werden mit passenden Steuerbelegen und einmaliger Guthabenrückbuchung abgeglichen. Details: [Geschenkkarten](GIFT-CARDS-PREPARATION.md).

## Nachweise und Grenzen

Gezielte Geschenk-, Produkt- und Camp-Prüfungen, Datenbanktests, Typprüfungen und isolierter OpenNext-Produktionsbuild erfolgreich. Tatsächliche Stripe-Sandbox-Prüfungen umfassten vollständige/anteilige Einlösung, Abos mit fortbestehendem Rabatt, Folgepreise, Wiederholungen und vollständige Erstattungen. Im gehosteten Checkout: Geschenk 77 €, Einkauf 49 €, Restwert 28 €, neuer Code und unveränderte Gültigkeit; anschließend beide Testkäufe erfolgreich zurückabgewickelt.

Online bestätigt: öffentliche Shop-/Bestellstatusseiten, gesperrte private Zugriffe, Gültigkeitsregel und identische ausgelieferte Build-Assets. Bestehende Versandfreigaben und zentrale Familien-/Abo-Zuordnungsfunktionen unverändert; finanzielle Geschenkfunktionen nur für `service_role`. Der geschützte Worker-Verbindungstest bestätigt Supabase, Stripe, SMTP und PDF. Der erste Container-Upload scheiterte an einem Cloudflare-500; die Wiederholung und der abschließende Rollout waren erfolgreich.

Keine produktiven Testzahlungen oder Testmails. Die tatsächliche externe Mailzustellung wurde für diese Veröffentlichung nicht erneut ausgelöst; Verbindung und Render-/Nachrichtenlogik sind geprüft. Produktive Geschenktabellen waren bei der Online-Abnahme leer. Private Prüfartefakte und Zugangsdaten liegen ausschließlich in ignorierten lokalen Ausgabeverzeichnissen.
