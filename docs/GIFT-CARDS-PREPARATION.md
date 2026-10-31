# Geschenkkarten

Stand: 31.10.2026. Ersetzt die ursprüngliche Vorbereitung mit Coupon-Anrechnung und zwölfmonatiger Frist. Veröffentlichung und Migration wurden vom Betreiber beauftragt.

## Ablauf

Der Shop fasst veröffentlichte Geschenkbeträge in einer Karte zusammen; ein eigener Betrag ist möglich. Käufer und Empfänger werden getrennt erfasst, Telefon optional. Kein automatisches Empfängerkonto. Deterministische Stripe-Produkt-IDs verhindern doppelte Artikel je Betrag, EUR und Zahlungsmodus. Eigene Beträge erzeugen keinen öffentlichen Katalogeintrag. Zwei zusätzliche interne Stripe-Produkte dienen ausschließlich der steuerlichen Verrechnung.

Erst ein bestätigter Checkout einschließlich tatsächlich bezahlter Rechnung erzeugt den Code. Bei Einlösung wird der Wert reserviert und erst beim bestätigten Abschluss verbraucht. Der bisherige Code wird gesperrt, verbleibender Wert erhält einen neuen Code. Bei 0 Euro entfällt der Folgecode. Ein bestätigter Checkout-Ablauf gibt die Reservierung frei. Gleichzeitige offene Käufe mit demselben Code sind ausgeschlossen.

Guthaben gilt für neue Käufe aller Shoparten, beim Abo für die erste Zahlung. Frühbucher-, Camp- und echte Rabattvorteile werden vorher berechnet; wiederkehrende Abo-Rabatte bleiben erhalten. Weitere Geschenkkarten werden nicht mit Geschenkguthaben finanziert. Neue Karten gelten bis Ende des dritten Kalenderjahres nach dem Kaufjahr, in Europe/Berlin: Kauf 2026 → 31.12.2029. Restcodes und Erstattungen verlängern die Ausgangsgültigkeit nicht. Bestehende Ausgabedaten bleiben bestehen.

## Abrechnung

Der Betreiber hat Deutschland als Leistungsort sämtlicher einlösbarer Leistungen und einheitlich 19 % Umsatzsteuer bestätigt. Das implementierte Modell `single_purpose_de_19` berücksichtigt die Umsatzsteuer bereits beim Geschenkkauf. Ändern sich Steuersätze oder Leistungsorte, muss das Modell vor weiteren Verkäufen angepasst werden. Grundlage: [§ 3 UStG](https://www.gesetze-im-internet.de/ustg_1980/__3.html).

Geschenkguthaben wird als native Stripe-Zahlungsaufzeichnung auf der vollständigen Leistungsrechnung zugeordnet, nicht als Coupon. Die Checkout-Zuzahlung wird derselben Rechnung zugeordnet. Das kundenweite Stripe-Rechnungsguthaben bleibt unberührt. Die Leistungsrechnung enthält den Artikel nach echten Rabatten und zwei sich im Bruttowert ausgleichende Verrechnungszeilen. Diese verrechnen die bereits versteuerte Gutscheinleistung, sodass nur der zusätzlich bezahlte Anteil weitere Umsatzsteuer verursacht.

Beispiel: 100 € Leistung minus 10 % Rabatt = 90 €, bezahlt mit 50 € Gutschein und 40 € Karte. Neue Steuer auf der Leistungsrechnung: 6,39 €. Die folgende Abo-Rechnung bleibt bei 90 € einschließlich 14,37 € Umsatzsteuer. Grundlage: [Stripe Invoice Payments](https://docs.stripe.com/api/invoices/attach_payment), [Payment Records](https://docs.stripe.com/payments/payment-records).

Die erste Abo-Rechnung entsteht mit `send_invoice`, wird vollständig beglichen und anschließend auf automatische Folgezahlungen mit dem gespeicherten Zahlungsmittel umgestellt. Bei vollständig gedeckter erster Zahlung bestätigt ein Setup-Checkout die Karte für Folgezahlungen. Vor Abschluss der ersten Rechnung werden keine Abo-Berechtigungen importiert.

Vollständige Erstattungen benötigen einen Credit-Note-Beleg mit passender Steuer und bestätigte Rückzahlungen. Eine Zuzahlung muss zuerst vollständig in Stripe erstattet werden; danach wird der Gutscheinanteil einmalig zurückgebucht. Für reine Guthabenkäufe gibt es „Guthaben-Erstattung abschließen“ in der Verwaltung mit Pflichtbegründung. Verträge werden dabei nicht automatisch gekündigt. Teilweise oder fremd veränderte Rückzahlungen benötigen manuelle Prüfung. Die vollständige Erstattung eines Geschenkkaufs erstellt ebenfalls einen steuerlich passenden Beleg und sperrt die zugehörige Karte.

## Status, Profil und Nachrichten

`/bestellstatus` funktioniert ohne Anmeldung, benötigt aber einen zufälligen persönlichen Leseschlüssel zusätzlich zur Bestellnummer. Käufer und Empfänger erhalten getrennte Links. Käufer sehen Rechnung und ursprüngliche Karte; aktuelle Restcodes und Verbrauchshistorie sind Empfängern vorbehalten. Bei gleicher Adresse bestehen beide Rollen. Verlorene Links können an die hinterlegte Adresse neu angefordert werden, ohne Rollenabfrage oder Portalkonto.

Bestätigte Elternadressen werden passenden Karten zugeordnet. Manuelles Hinzufügen erfolgt mit passender bestätigter E-Mail und Code oder persönlichem Empfängerlink. Die dauerhafte Verknüpfung unter `/profil/geschenkkarten` zeigt den aktuellen kopierbaren Code und die Historie.

Der Shop-Button erscheint erst bei einer ausgegebenen Karte, bei verfügbarem Empfängerguthaben als „Guthaben · Betrag €“. Das Dropdown bietet Übersicht und Hinzufügen. Einmal pro Anmeldung erscheint beim ersten berechtigten Shop-Besuch die PA-Karte mit Guthabenhinweis und Konfetti; reduzierte Bewegung wird berücksichtigt. Kein periodisches Polling.

Käufer und Empfänger erhalten getrennte Bestätigungen, bei gleicher Adresse eine gemeinsame Nachricht. Nach jeder bestätigten Einlösung mit Restwert erhält der Empfänger eine Nachricht mit bisherigem Betrag, Einsatz, Restwert, neuem Code, Produkt, Bestell-ID, ursprünglicher Gültigkeit und Statuslink. Überholte unversendete Restcode-Nachrichten werden übersprungen. Geschenkkarten-Portaleinladungen entfallen. SMTP-Wiederholungen können eine Nachricht erneut zustellen; die Wertausgabe bleibt einmalig.

Die Originalmotive unter `public/gifts` werden mit Betrag, Code, Gültigkeit und persönlichen Angaben ergänzt. Bestätigung und E-Mail nutzen dieselbe Vorlage. Vorderseite, Rückseite und beide gemeinsam sind als PNG exportierbar; die Systemfreigabe wird unterstützt. Der Node-Mailworker enthält Sharp, Motive und Schriften.

## Betrieb und Prüfung

Migrationen 034–038 sind im Release-Skript registriert. Tabellen besitzen RLS, finanzielle Funktionen sind ausschließlich für `service_role` freigegeben. Codes und Leseschlüssel werden mit AES-256-GCM verschlüsselt. Der dauerhaft zu sichernde `GIFT_ENCRYPTION_KEY` muss in Portal und Jobs identisch sein. Ein Schlüsselwechsel benötigt eine Datenmigration. Aktivierung: `GIFT_CARDS_ENABLED=true`, `GIFT_CARDS_LIVE_ENABLED=true`, `GIFT_MAIL_ENABLED=true`.

Die isolierte Vorschau auf Port 3115 verwendet nur lokale Beispieldaten ohne Zahlungen oder SMTP. Die separate Testinstanz auf Port 3116 nutzt Stripe-Testmodus und lokale Supabase-Daten. Keine echten Zahlungen oder produktiven Testmails.

Geprüft wurden relevante Geschenk-, Produkt- und Camp-Fälle einschließlich PostgreSQL/PGlite, Typprüfung und Produktionsbuild. Tatsächliche Stripe-Sandbox-Prüfungen deckten vollständige und anteilige Guthabenzahlungen für Abos und Einmalkäufe, wiederkehrende Rabatte, unveränderte Folgepreise, native Zahlungszuordnung, Wiederholungen und vollständige Erstattungen samt Steuerbelegen ab. Ein 77-Euro-Geschenkkauf wurde im gehosteten Checkout abgeschlossen und anschließend ein echter 49-Euro-Testkauf mit 28 Euro Restwert und Codewechsel durchgeführt. Testartefakte und Zugangsdaten bleiben in ignorierten lokalen Ausgabeverzeichnissen.
