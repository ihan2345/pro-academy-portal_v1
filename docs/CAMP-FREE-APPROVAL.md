# Manuelle Freigabe von Campbuchungen mit 1–100 % Sonderrabatt

## Veröffentlichung

Nach der bereits veröffentlichten Migration `012-free-booking-approval.sql` die neue Migration `supabase/camp/013-discount-booking-approval.sql` anwenden. Anschließend Portal **und Jobs-Worker** mit den zugehörigen Änderungen veröffentlichen. Die Datenbank sperrt Sonderrabatte bereits unabhängig vom Alter eines gespeicherten Prüfstands; der neue Worker ergänzt Rabatt und Ausgangspreis im Prüfstand. Die Migration selbst bestätigt keine Buchung und versendet keine Nachricht. Bereits übernommene Buchungen werden nicht rückwirkend verändert.

## Verarbeitung

Neukunden ohne Abo-Vorteil benötigen bei jedem Rabatt eine ausdrückliche Admin-Freigabe, sowohl bei einer Portalbuchung als auch beim direkten Stripe-Link. Buchungen ohne Rabatt bleiben bei eindeutigen, vollständigen Angaben automatisch verarbeitbar. Reguläre Abo-Rabatte von 10, 15 oder 20 % sind weiterhin ohne Sonderfreigabe zulässig, sofern das tatsächlich zugeordnete Kind einen ausreichenden aktiven Tarifvorteil besitzt. Die Prüfung erfolgt nach der Familien-/Kindzuordnung in der Datenbank und schützt auch den gewöhnlichen manuellen Import. Bei Ablehnung werden eventuell innerhalb der Importtransaktion angelegte Eltern und Kinder zurückgerollt.

Unter Camp → Kinder zur Prüfung / Angaben ergänzen sehen Admins vorhandene Portalbuchungen im Abschnitt „Sonderrabatte · Portalbuchungen prüfen“. Noch nicht übernommene rabattierte Direktbuchungen öffnen denselben Freigabedialog in der Stripe-Prüfliste. Mitarbeiter erhalten keine Freigabefunktion oder zusätzlichen Zahlungsdetails.

Vor dem Bestätigen muss der Stripe-Nachweis geladen werden. Preis, Rabatt in Euro und Prozent sowie tatsächlicher Zahlbetrag sind sichtbar. Beim Speichern werden diese Fakten erneut unabhängig vom Browser aus Stripe gelesen. Geprüft werden Live-Modus, abgeschlossener Checkout, Rabatt, Menge, Währung, Preis, Produkt, zugehöriger Camp-Link und eine passende bzw. bei Direktbuchungen fehlende Portalreferenz. Direkte Links können aus dem bisherigen Quellenverzeichnis oder aktuellen Camp-Angeboten stammen.

Bei 1–99 % Rabatt muss die Restzahlung erfolgreich und vollständig bestätigt sein; Erstattungen, Teil-Erstattungen und Anfechtungen sperren die Freigabe. Bei 100 % wird ein abgeschlossener Checkout ohne PaymentIntent mit Status `paid` oder `no_payment_required` akzeptiert. Eine PaymentIntent-ID wird niemals erfunden.

## Zuordnung und Protokollierung

Eltern und Kind müssen ausdrücklich ausgewählt oder innerhalb derselben Transaktion neu angelegt werden. Eine vorhandene Zuordnung wird nicht überschrieben. Altersprüfung, Schutz vor doppelter Teilnahme und Kapazitätsgrenzen bleiben wirksam. Neue Direktbuchungen werden erst mit der erfolgreich abgeschlossenen Freigabe gespeichert; Portalbuchungen behalten ihre Buchungs-ID. Wiederholte Freigaben werden abgewiesen.

Admin, Zeitpunkt, Pflichtbegründung, tatsächlicher Rabatt, Zahlung und Stripe-Nachweis werden in `payment_details.special_discount_approval` gespeichert. Audit-Aktion ist bei 100 % weiterhin `CAMP_FREE_BOOKING_APPROVED`, bei einem Restbetrag `CAMP_DISCOUNT_BOOKING_APPROVED`. Jede Formularänderung verlangt eine neue Zustimmung.

Es entstehen keine Abos oder Trainingskontingente. `manual_notifications_held=true` sperrt die automatischen Camp-Mails für die manuell freigegebene Buchung. Eine spätere Nachrichtenfreigabe ist ein gesonderter Vorgang. Genehmigte Buchungen verschwinden aus der Prüfliste, sofern nur der bekannte Sonderrabatt-/Gratischeckout-Hinweis verbleibt; andere Beanstandungen bleiben sichtbar.

## Gezielte Prüfung

Stripe-Nachweise für 1, 10, 50, 99 und 100 %, unbestätigte/erstattete/angefochtene Restzahlungen, Quellbindung, Rollen und vom Browser eingeschleuste Zahlungsdaten sind durch Unit-Tests abgedeckt. PGlite prüft die vollständige Migrationsfolge sowie Freigaben, reguläre Abo-Vorteile, Transaktionsrollback, Kapazität, Duplikate, Familienzuordnung, Audit und Mail-Sperre. Die lokale Browserprüfung mit Beispieldaten deckt Nachweis, 99-%-Anzeige, Bestätigungspflicht und erneute Zustimmung nach Änderungen ab. Keine echte Buchung wurde dafür freigegeben.
