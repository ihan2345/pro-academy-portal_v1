# Manuelle Freigabe von Campbuchungen mit 100 % Sonderrabatt

Vor Veröffentlichung: `supabase/camp/012-free-booking-approval.sql` anwenden, anschließend das Portal mit den zugehörigen API- und UI-Änderungen deployen. Die Migration bestätigt keine Buchung und versendet keine Nachricht. Der Jobs-Worker benötigt keine Codeänderung.

Unter Camp → Kinder zur Prüfung / Angaben ergänzen sehen Admins einen eigenen Abschnitt für vorhandene Portalbuchungen mit Status `review` und 0 € Zahlbetrag. Vor dem Bestätigen muss der Stripe-Nachweis geladen werden. Erneut geprüft werden beim Speichern insbesondere Live-Modus, abgeschlossener Checkout, 100 % Rabatt, fehlender PaymentIntent, Menge, Währung, Preis, Produkt, Kunden-ID und die zum Buchungsdatensatz passende Checkout-Referenz.

Eltern und Kind werden ausdrücklich ausgewählt oder innerhalb derselben Transaktion neu angelegt. Eine vorhandene Zuordnung wird nicht überschrieben. Altersprüfung, doppelte Teilnahme und Kapazitätsgrenzen bleiben wirksam. Es entstehen keine Abos oder Trainingskontingente. Kunden ohne Abo erhalten im bisherigen Stripe-Zuordnungsdialog stattdessen einen Hinweis mit Camp-Verweisen; ein Kind wird dort nicht mehr automatisch vorausgewählt.

Die Freigabe verändert den bestehenden Buchungsdatensatz. Die Checkout-ID dient als Referenz; es wird keine PaymentIntent-ID erfunden. `payment_details.special_discount_approval` und `CAMP_FREE_BOOKING_APPROVED` protokollieren Admin, Zeitpunkt, Begründung und Zuordnung. Wiederholte Freigaben werden abgewiesen.

`manual_notifications_held=true` sperrt für diese Buchung auch die automatischen Camp-Mails. Die Oberfläche verspricht keinen Versand und bietet keine automatische Einladungsfreigabe. Eine spätere Nachrichtenfreigabe ist ein gesonderter Vorgang. Bereits genehmigte Gratisbuchungen verschwinden aus der Stripe-Prüfliste, wenn die einzige verbleibende Beanstandung der bekannte Gratischeckout-Hinweis ist; andere Beanstandungen bleiben sichtbar.

Prüfung: gezielte Stripe-/Berechtigungstests, PGlite-Integrationstests einschließlich Familie/Kind, Kapazität, Transaktionsrollback und Mail-Sperre sowie lokale Browserprüfung mit Beispieldaten. Ein konkreter Checkout wurde ausschließlich lesend gegen die neue Prüfung validiert; sein Status blieb `review`.
