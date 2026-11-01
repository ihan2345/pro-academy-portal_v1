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

## Mehrere Beträge innerhalb eines Produkts – 31.10.2026

Portal-Version `dcf60ad4-55fa-4173-8629-6a77cf98927e`, 100 %. Migration `202610310039` nach erfolgreichem Dry-run angewendet. Veröffentlichung auf ausdrücklichen Nutzerauftrag; die Änderungen dieses Schritts wurden noch nicht committet.

Unter „Stripe & Leistung“ lassen sich mehrere Geschenkbeträge hinzufügen und entfernen. Ein Verwaltungseintrag besitzt gemeinsame Gestaltung und mehrere Betragsvarianten. „Geschenkkarte veröffentlichen“ speichert, prüft und übernimmt alle Werte gemeinsam. Vorhandene Stripe-Zuordnungen werden wiederverwendet, fehlende mit begrenzter Parallelität vorbereitet. Der öffentliche Katalog zeigt weiterhin eine gemeinsame Karte und jeden verfügbaren Betrag nur einmal. Ältere Produkte mit einzelnem Betrag bleiben kompatibel; bestehende Geschenkkäufe und Guthaben werden nicht verändert.

78 gezielte Tests, Typprüfung und isolierter Cloudflare-Build erfolgreich. Im Browser wurde ein einziges lokales Produkt mit 40, 80 und 120 Euro veröffentlicht; drei passende echte Stripe-Testzuordnungen, eine öffentliche Karte und die eindeutige Auswahl von 80 Euro bestätigt. Keine produktiven Testprodukte, Zahlungen oder Mails angelegt. Der zusätzliche Stripe-Testserver wurde anschließend beendet.

Online-Abnahme: neue Verwaltungsfunktion anhand des exakt übereinstimmenden ausgelieferten JavaScript-Bundles bestätigt, öffentliche APIs erreichbar, Verwaltung ohne Sitzung gesperrt. Migration und Zugriffsrechte geprüft; Portal-Bindings, Versandfreigaben und Jobs-Version unverändert. Private Nachweise unter `output/gift-denominations-release/`.

## Shopnavigation und Zielgruppe „Alle“ – 01.11.2026

Portal-Version `b811a7ec-2ed0-4b81-9fb9-6c7e4e2f166a`, 100 %. Grundlage ist der aktuelle GitHub-Hauptstand `711f70fa0a7f94e154fe78e55f5f8de356321573` mit den bereits veröffentlichten Betragsvarianten sowie den freigegebenen lokalen Geschenkkarten-Korrekturen. Der Hauptbranch wurde vor dem Build und unmittelbar vor dem Deployment mit `origin/main` abgeglichen. Alle acht gegenüber `d88f199` geänderten Stripe-Quelldateien entsprechen unverändert dem aktuellen GitHub-Stand. Die 321 Laufzeit-/Build-Quelldateien wurden gegen die isolierte Arbeitskopie abgeglichen.

Im öffentlichen Shop steht „Gutscheinstatus“ als dezenter, abgerundeter Button neben dem PA-grünen „Anmelden“-Button. Der Textlink unter der Produktbühne entfällt. Beide Links wurden im Browser auf ihr Ziel geprüft; Desktop und schmaler Bildschirm visuell kontrolliert. Fokusdarstellung und reduzierte Bewegung sind berücksichtigt. Im angemeldeten Portal bleibt der vorhandene persönliche Geschenkbereich erhalten.

Die feste Elternrollen-Sperre für Geschenkkarten entfällt in Kaufentscheidung und Checkout. Die Zielgruppe „Alle“ umfasst jetzt Gäste, Eltern, Admins und Mitarbeiter. Ausdrückliche Zielgruppenregeln bleiben wirksam; angemeldete Käufer benötigen weiterhin eine bestätigte E-Mail. Sichtbare Geschenke bleiben außerdem als nicht kaufbare Karte darstellbar, wenn nur das Kaufrecht fehlt. Die bereits vorbereiteten 35 gezielten Testfälle und der lokale API-Abgleich aller vier Rollen bestätigen diese Korrektur; der abschließende OpenNext-Build einschließlich Typprüfung war erfolgreich.

Online bestätigt: neue Navigation im echten öffentlichen Shop, identische ausgelieferte Feature-Dateien für Shop, Betragsverwaltung und aktuelle Stripe-Anzeigen, unveränderte öffentliche Produkte und Gutscheinwerte sowie geschützte Admin-APIs. Portal-Bindings, Datenbankstand, Versandfreigaben und Jobs-Version sind unverändert. Keine Migration und keine produktiven Testzahlungen oder Testmails. Private Belege unter `output/shop-header-release/`. Dieser Schritt ist veröffentlicht, aber noch nicht committet.

## Einheitliche Karten und gemeinsamer Git-Stand – 01.11.2026

Portal-Version `96e0c030-e141-47b7-b222-81bb6393d5a9`, 100 %. Nach ausdrücklichem Auftrag gemeinsam mit sämtlichen zuvor offenen Geschenkkarten- und Shopänderungen committed und nach `main` gepusht. Grundlage bleibt GitHub-Stand `711f70f`; die jüngsten Stripe-Prüf-/Zuordnungskorrekturen sind unverändert enthalten. Die vorstehenden Hinweise auf noch nicht eingecheckte Änderungen dokumentieren jeweils den damaligen Zwischenstand und sind mit dieser Veröffentlichung abgeschlossen.

Die Produktliste verwendet gleich hohe Karten über alle Reihen, reservierte Textbereiche und gemeinsame Preis-/Buttonlinien. Titel und Beschreibungen sind nur in der Kartenübersicht auf zwei beziehungsweise drei Zeilen begrenzt; gespeicherte Inhalte bleiben unverändert. Fehlende Trainingsangaben lassen ihren Bereich frei. Optionale Aktionspreise, Camp-Vorteile und Buchungshinweise bleiben berücksichtigt. Produktbühne, Bildproportionen und Kaufabwicklung sind unverändert.

Sechs lokale Beispiele mit langen, kurzen und fehlenden Texten, Camp-Vorteilen und einem nicht kaufbaren Angebot wurden auf Desktop und Mobil geprüft. Kartenhöhen, Preisbaselines und Buttonpositionen stimmen mit weniger als einem Pixel Abweichung überein; Camp-Hinweise überlappen keine Buttons. Der abschließende isolierte OpenNext-Build einschließlich Typprüfung ist erfolgreich. Die ausgelieferten CSS-/JavaScript-Dateien wurden online gegen denselben Build geprüft; öffentliche Shop-/Status-/Loginseiten und geschützte Admin-APIs bestätigt. Öffentliche Produkte und Gutscheinvarianten, Portal-Bindings, Versandfreigaben und Jobs-Version entsprechen dem vorherigen Stand. Keine neue Datenbankmigration und keine Testzahlungen oder Testmails.

Private Layoutnachweise unter `output/card-alignment-review/`, Build-/Deployment-/Online-Nachweise unter `output/card-alignment-release/`. Migration 039 ist bereits produktiv vorhanden und wird nun ebenfalls im Repository mitgeführt; sie wurde für dieses Deployment nicht erneut angewendet.
