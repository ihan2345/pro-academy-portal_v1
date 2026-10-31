# Geschenkkarten – lokale Vorbereitung

Stand: 30.10.2026. Keine Veröffentlichung, keine Commits, keine produktive Migration und keine echten Stripe- oder Mailvorgänge in dieser Vorbereitung.

## Vereinbarter Ablauf

- Eine Geschenkkarte auf Bühne und Liste. Veröffentlichte Geschenkbeträge bilden die Auswahl; eigener Betrag ist möglich. Die Priorität des repräsentativen Produkts bestimmt die Position im Katalog, einschließlich der bestehenden Seitennavigation.
- Käufername/-mail und Begünstigte mit Vorname, Nachname, E-Mail; Telefon optional. Keine automatische Anlage eines Empfängerkontos beim Kauf.
- Stripe-Checkout für den vollen Geschenkwert. Geschenkcodes entstehen ausschließlich nach Abgleich der gespeicherten Session, des Artikels, des Betrags und der tatsächlich bestätigten Zahlung.
- Ein zufälliger Code je bezahlter Bestellung. Nach jedem bestätigten Einsatz wird der Code gesperrt und für verbleibenden Wert ein neuer Code bereitgestellt. Restbetrag und Historie sind über den persönlichen Bestellstatus erreichbar.
- Guthaben gilt für neue Käufe aller Shoparten, einschließlich der ersten regulären Abo-Zahlung. Automatische Camp-Vorteile werden vor dem Guthaben berechnet; beim Camp bleibt die Kombination mit Frühbucherpreis erhalten. Bestehende Verträge und spätere Abo-Rechnungen bleiben unverändert. Weitere Geschenkkarten werden aus diesem Guthaben nicht finanziert.
- Restwert bleibt erhalten. Guthaben wird je Bestellung zunächst reserviert, beim erfolgreichen Abschluss verbraucht, bei bestätigtem Checkout-Ablauf freigegeben und nach vollständiger Erstattung des damit bezahlten Kaufs zurückgebucht. Die ursprüngliche Gültigkeit wird durch eine Erstattung nicht verlängert. Geschenkkauf-Erstattungen bzw. Zahlungsstreitigkeiten sperren den zugehörigen Wert; bereits verwendete Leistungen benötigen ggf. eine manuelle Prüfung.
- Einstellungen enthalten zwölf Kalendermonate ab bestätigtem Zahlungszeitpunkt. Abgelaufener Wert wird nicht gelöscht. Bereits beanspruchte Codes werden bei erneuter Eingabe nicht neu aufgeladen.
- Bestätigungsansicht: Code und Nachricht kopieren, PNG herunterladen, Empfänger-Mailstatus anzeigen und schließen. Die bereitgestellten Vorder- und Rückseitenmotive werden mit Wert, vollständigem Code und persönlichen Angaben ergänzt. Beide Seiten sind einzeln sowie gemeinsam als PNG exportierbar.

## Verwaltungs- und Stripe-Zuordnung

Produktart `gift` / „Geschenke“ nutzt bestehende Bilder, Effektfarbe, Beschreibungen und Veröffentlichung. Der Betrag ersetzt die manuelle Price-ID-Eingabe. Ein zusätzlicher Datenbankindex verhindert mehrere Katalogeinträge desselben Betrags. Ein vorhandener Betrag wird bearbeitet, statt nochmals angelegt.

`gift_stripe_values` ordnet Betrag, EUR und Test-/Livemodus dauerhaft zu. Deterministische Stripe-Produkt-IDs (`prod_pa_gift_test_eur_5000` usw.) verhindern doppelte Artikel auch nach dem zeitlichen Ende der Stripe-Idempotenzspeicherung. Preise werden wiederverwendet. Ein eigener Betrag erzeugt keinen öffentlichen Katalogeintrag, sondern nur eine interne Stripe-Zuordnung.

Die Checkout-Referenz und ihr Ablaufzeitpunkt bleiben bei Wiederholung unverändert. Nach ungewissem Speichern werden vorhandene Stripe-Sessions anhand der Bestellreferenz gesucht, bevor erneut ein Checkout angelegt wird. Alte unklare Vorgänge werden nicht als neue Zahlung gestartet.

## E-Mails und persönliche Links

Käufer und Begünstigte haben unabhängige Mailaufträge mit Wiederholungen. Bei gleicher E-Mail-Adresse wird nur die gemeinsame Geschenkbenachrichtigung versendet. Capture-Versand wird als `captured` erfasst, nicht als tatsächlich versendet angezeigt. Geschenk-Portaleinladungen entfallen. Ein verlorener persönlicher Statuslink kann erneut angefordert werden, ohne ein Portal-Konto anzulegen. Ein SMTP-Timeout kann trotz stabiler Message-ID zu einer erneuten Zustellung führen; garantiert wird eine einmalige Ausstellung des Werts, nicht Exactly-once-SMTP.

Codes werden verschlüsselt gespeichert und über einen Hash gefunden. Die Bestätigungsseite ist über einen eigenen zufälligen Leseschlüssel geschützt. Geschenk- und Guthabentabellen sind nicht direkt für Browserrollen les- oder beschreibbar. Lediglich das eigene Guthaben wird über die bestehende Sitzung ausgegeben.

## Lokale Prüfung

- Vorschau: `http://127.0.0.1:3115/geschenkkarten-vorschau`.
- Lokaler Shop: `http://127.0.0.1:3115/produkte`; vorbereitete Beispielbeträge: 25, 50 und 100 Euro. Die Demo-Codes sind keine gültigen Gutscheine.
- Produktart in der lokalen Verwaltung: `/admin/produkte`; Konto wechseln über `/lokaler-test`.
- Echte Zahlungen und SMTP sind in der isolierten Vorschau ausgeschaltet. Die Migration `supabase/release/034-gift-cards.sql` wurde nur auf `supabase_db_pabyak-products-local` angewendet. Sie ist ausschließlich in der lokalen Schema-Kette registriert, nicht im produktiven Release-Skript.
- Finanzielle Kernfälle sind gegen PostgreSQL/PGlite geprüft, Stripe- und Mail-Schnittstellen gegen gezielte Vertragsmocks. Es gab keinen echten Testkauf oder tatsächlichen Mailversand.

## Noch vor einer Live-Freigabe

Die bereitgestellten Motive sind integriert; Bestätigung, Export und E-Mail verwenden dieselbe SVG-Textvorlage. Alle Geschenkfunktionen bleiben standardmäßig aus. Die Aktivierung benötigt `GIFT_CARDS_ENABLED=true`, produktiv zusätzlich `GIFT_CARDS_LIVE_ENABLED=true`, einen dauerhaft gesicherten `GIFT_ENCRYPTION_KEY` und für Mails `GIFT_MAIL_ENABLED=true`. Ein Schlüsselwechsel benötigt eine Migration der verschlüsselten Codes und Leseschlüssel, sonst sind historische Geschenke nicht mehr entschlüsselbar.

Die zwölfmonatige Einlösefrist ist technisch vorbereitet, aber bei entgeltlich erworbenen, allgemein verwendbaren Gutscheinen rechtlich zu klären: [Verbraucherzentrale zu Gutscheinfristen](https://www.verbraucherzentrale.de/wissen/vertraege-reklamation/kundenrechte/gutscheine-als-geschenk-so-lange-sind-sie-gueltig-13861). Sie ist konfigurierbar; abgelaufene Werte bleiben für die Prüfung dokumentiert.

Die vorbereitete Stripe-Anrechnung nutzt einen ausschließlich für diesen Checkout/Kunden gültigen Coupon (`duration=once`, `max_redemptions=1`) und eine gesonderte Guthabenbuchung. Die steuerliche Einordnung des Wertgutscheins und die korrekte Rechnungs-/Umsatzdarstellung müssen vor Live-Betrieb festgelegt werden: Eine reine Coupon-Darstellung kann die steuerliche Bemessungsgrundlage anders behandeln als eine Zahlung mit Wertguthaben. Die Vorbereitung wird deshalb nicht als fertige Live-Abrechnung freigegeben.

Zusätzliche manuelle Rabattcodes und wiederkehrende Abo-Rabatte werden bei aktiv gewähltem Guthaben aktuell ausdrücklich abgewiesen, damit keine bestehenden Rabattlaufzeiten oder Einlöselimits verändert werden. Ohne Guthaben läuft die vorhandene Rabattlogik unverändert. Die Abrechnung solcher Kombinationen ist ein offener Schritt für die vollständige Live-Integration; automatische Camp-Vorteile sind bereits kombinierbar.

Der vorbereitete frei eingebbare Bereich beträgt 1–1.000 Euro und ist zentral konfigurierbar. Bei teilweiser Guthabenzahlung bleibt ein positiver Stripe-Restbetrag mindestens 50 Cent; nicht verwendete Centbeträge verbleiben im Konto. Eine produktive Zahlungsprobe mit Webhook, Mailzustellung und korrekter Rechnung folgt erst nach den genannten fachlichen Entscheidungen und ausdrücklicher Freigabe.

## Ergebnis der Validierung

132 gezielte Tests erfolgreich: Geschenk-Datenbank und Wertbuchungen, Code-/Betragsprüfung, Stripe-Zuordnung und Zahlungsnachweise, Mailaufträge sowie bestehende Produkt-, Berechtigungs- und Camp-Preislogik. Root-Typprüfung erfolgreich. Ein vollständiger Next.js-Build einschließlich Typprüfung und statischer Seitengenerierung lief in der frischen, isolierten Kopie `output/gift-cards-build-20261030` erfolgreich. Ein älteres Prüfverzeichnis enthielt bereits eine zusätzliche `node_modules 2`-Kopie; deshalb wurde für die abschließende Validierung ein neuer Pfad verwendet, ohne diese fremden Dateien zu löschen.

Der lokale Katalog liefert für drei vorbereitete Geschenkbeträge genau einen gemeinsamen Eintrag mit drei Varianten. Betragsauswahl, Empfängerfelder, ausgeschalteter Zahlungsbutton und die gekennzeichnete Bestätigungs-Vorschau wurden im Browser kontrolliert.

## Personalisierte PA-Karte (30.10.2026)

Die beiden Original-PNGs liegen unverändert unter `public/gifts/card-front.png` und `card-back.png`. Die Darstellung entfernt lediglich den transparenten Außenabstand über den SVG-Ausschnitt; die sichtbaren Motive werden nicht verzerrt. Die gemeinsame Vorlage in `src/lib/gifts/artwork.ts` platziert vorne Wert, vollständigen Code und Gültigkeit. Hinten stehen Begünstigte, Absender, Danksagung und Einlösehinweise. Alle persönlichen Texte werden als XML-Text maskiert; lange Namen bleiben vollständig erhalten. Das Datum wird einheitlich in Europe/Berlin ausgegeben.

Die Bestätigungsansicht schaltet zwischen Vorder-/Rückseite um. Export: aktuelle Seite als PNG oder beide Seiten in einer gemeinsamen PNG-Datei. „Karte teilen“ nutzt bei Unterstützung die Systemfreigabe und bietet sonst den PNG-Download zum manuellen Teilen an. Browserexport verwendet eingebettete Motivdaten, damit die Dateien vollständig und ohne nachzuladende Bilder weitergegeben werden können. Erst der bestätigte Bestellstatus gibt diesen Bereich frei; unveränderte Gutschein- und Zahlungsprüfung.

Kauf- und Geschenk-E-Mails enthalten beide personalisierten PNGs über Content-ID und als speicherbare Bilddateien. Der Code steht zusätzlich im Nachrichtentext. Der Node-Mailworker rendert über Sharp; das Worker-Image enthält dafür Motive, Sharp und Liberation-Schriften. Pro Bestellung wird innerhalb eines Maildurchlaufs nur ein Kartenpaar gerendert und für beide Empfänger wiederverwendet. Zugangsmails bleiben ohne Kartenbilder.

Lokale Ansichten:

- `http://127.0.0.1:3115/geschenkkarten-vorschau`
- `http://127.0.0.1:3115/geschenkkarten-vorschau/email`

Acht gezielte Bild-/Mailtests erfolgreich, einschließlich vollständiger Werte/Codes, XML-Maskierung, langen Namen, Datum und realem PNG-Rendering beider Seiten. Typprüfung und frischer isolierter Next-Build erfolgreich. Der Browserexport wurde mit den personalisierten Angaben erfolgreich ausgeführt; beide Seiten und die E-Mail-Bilder wurden visuell kontrolliert. Ein lokales Worker-Image wurde gebaut; PNG-Rendering, Schriften und bereitgestellte Motivdateien wurden anschließend auch direkt im Node-Container erfolgreich geprüft. Keine produktiven Mails, Änderungen an der Datenbank, Commits oder Veröffentlichungen für diesen Designschritt.

## Bestellstatus und fortlaufende Restcodes (30.10.2026)

Diese Erweiterung ersetzt die bisher vorbereitete Übernahme ins Eltern-Guthabenkonto für neue Geschenke. Geschenkcodes werden direkt im Shop-Checkout verwendet, auch beim Gastkauf. Nach einem bestätigten Kauf wird der alte Code gesperrt und ein neuer Code für den verbleibenden Wert freigegeben; bei 0 Euro gibt es keinen weiteren Code. Der Betrag bleibt beim ursprünglichen Geschenk, es entstehen keine Stripe-Artikel für Restwerte. Die ursprüngliche Gültigkeit wird nie neu gestartet.

`/bestellstatus` funktioniert ohne Portal-Anmeldung. Käufer- und Empfängerschlüssel sind getrennt. Käufer sehen Kauf-/Zahlungsstatus und vor der ersten Verwendung ihre ursprüngliche Karte zum Weitergeben. Spätere Restcodes und Verbrauchshistorie werden ausschließlich beim Empfängerschlüssel geliefert. Die Beschränkung gilt bereits in der API, nicht nur in der Darstellung. Bestellnummer allein gewährt keinen Zugriff. Ein persönlicher Statuslink kann erneut an die hinterlegte Adresse angefordert werden; dabei wird kein Auth-Konto erstellt.

Die zwei Geschenk-Portaleinladungen (`access_buyer`, `access_recipient`) entfallen. Alte, nicht versendete Aufträge werden lokal storniert. Stattdessen werden nach bestätigten Einlösungen mit Restwert `gift_balance_messages` angelegt. Die Restguthaben-Mail geht nur an die beschenkte Person und enthält:

- Guthaben davor, eingesetzten Betrag und verbleibenden Wert,
- neuen Code und aktualisierte PA-Karte,
- Produkt, Bestell-ID, Einlösedatum, Bestellwert nach Preisvorteilen und zusätzliche Zahlung,
- ursprüngliche Gültigkeit und persönlichen Link zur aktuellen Guthaben-Historie.

Jeder Auftragsabschluss erzeugt höchstens einen Mailauftrag. Wiederholte Webhooks können Guthaben nicht nochmals abbuchen. Überholte, noch nicht versendete Restmails werden nicht nachträglich mit einem alten Code ausgeliefert. Bereits versendete Mails beschreiben den Stand nach diesem Kauf und verweisen für spätere Änderungen auf den Statuslink. Die erneute Anforderung eines verlorenen Statuslinks ist eine separate Hilfsnachricht und keine Portal-Einladung.

Die Migration `035-gift-order-status.sql` erweitert ausschließlich die lokale Schema-Kette. `gift_code_uses` protokolliert Reservierung, Verbrauch und vollständige Rückbuchung. Ein Code kann nicht gleichzeitig für zwei offene Käufe reserviert werden. Bei bestätigtem Checkout-Ablauf wird die Reservierung freigegeben; bei unklaren/fehlgeschlagenen Zahlungen bleibt sie bis zur Klärung bestehen. Bei vollständiger Erstattung des damit bezahlten Kaufs wird der eingesetzte Wert einmalig zurückgegeben, mit neuem Code und unveränderter Gültigkeit. Die Historie behält Verbrauch und Rückbuchung getrennt bei.

Validierung für diesen Schritt: 113 gezielte Tests erfolgreich, einschließlich bestehender Produkt-/Zahlungslogik, Codewechsel bis 0 Euro, Gastkauf, Abbruch, Erstattung, Datenschutz nach Empfängerrolle und Mailinhalt. Typprüfung, isolierter Next-Build und Worker-Bundle erfolgreich. Die lokale HTTP-API wurde ohne Sitzung geprüft: Empfänger sieht 30 Euro und eine Einlösung; Käufer erhält weder Restbetrag noch Historie oder Folgecode.

Lokale Demo: Geschenk 50 Euro, Trainingspaket 20 Euro, Rest 30 Euro. Ausschließlich fiktive Daten in `supabase_db_pabyak-products-local`. Weder reale Stripe-Zahlung noch tatsächlicher Mailversand. Keine produktive Migration, kein Commit und kein Deployment. Die oben genannten offenen fachlichen Punkte zur Live-Abrechnung und Gültigkeit bleiben bestehen.


## Geschenkkarten im Elternprofil und Shop-Guthaben (31.10.2026)

Lokal ergänzt: `036-gift-account-links.sql` speichert dauerhafte, rollenbezogene Verknüpfungen zwischen Elternprofil und Geschenkbestellung. Bestätigte Käufer-/Empfängeradressen werden automatisch zugeordnet. Manuelles Hinzufügen erfolgt über einen Geschenkcode mit passender bestätigter E-Mail oder über den persönlichen Statuslink. Ein Empfänger-Statuslink kann als Besitznachweis einer weitergegebenen Karte dienen; eine Karte erhält höchstens ein Empfängerprofil. Käufer bleiben auf ihre bisherigen Kaufdaten beschränkt. Identische Käufer-/Empfängeradressen ergeben eine gemeinsame Karte mit beiden Rollen.

Im eigenen Profil führt „Meine Geschenkkarten“ zur Übersicht unter `/profil/geschenkkarten` und zur jeweiligen Status-/Historienseite. Aktuelle Restcodes werden serverseitig nach Rollenprüfung entschlüsselt und sind kopierbar. Die Verknüpfung bleibt bei Codewechseln erhalten. Ein erstes Geschenk kann direkt im Profil hinzugefügt werden, auch wenn im Shop noch kein Geschenkbereich sichtbar ist.

Der Shop zeigt den Dropdown-Button nur, sobald tatsächlich mindestens eine ausgegebene Karte vorliegt. Bei positivem verfügbarem Empfängerguthaben lautet er „Guthaben · Betrag €“, sonst „Meine Geschenkkarten“. Das Dropdown öffnet per Maus, Klick oder Tastatur und bietet Übersicht sowie Hinzufügen. Historische, verbrauchte Karten bleiben sichtbar. Reserviertes, abgelaufenes oder erstattetes Guthaben zählt nicht zum verfügbaren Betrag; mehrere Karten werden im Button summiert, pro Checkout bleibt es beim bisherigen einzelnen Geschenkcode.

Beim ersten berechtigten Shop-Besuch pro authentifizierter Anmeldesitzung erscheint der Guthaben-Hinweis mit Original-PA-Vorderseite und kurzer Konfetti-Animation. Ein gehashter Sitzungsmarker verhindert Wiederholungen nach Navigation oder Neuladen; eine Token-Erneuerung startet ihn nicht neu. Bei 0 Euro wird kein Marker verbraucht. Reduzierte Bewegung blendet Konfetti aus. Ohne nutzbaren Browserspeicher gilt der Marker nur innerhalb der laufenden Seiteninstanz. Initiales Laden, Fensterfokus und manuelle Aktualisierung halten die Angaben aktuell; kein periodisches Polling oder wiederholtes Aus-/Einblenden.

Die Rollenabfrage beim Anfordern eines Statuslinks entfällt: Die hinterlegte E-Mail bestimmt Käufer-/Empfängerrolle. Eine bloße Eingabe der Adresse zeigt keine Daten im Browser und erzeugt kein Portalkonto.

Validierung: gezielte Datenbank-, Dienst-, Sitzungsmarker-, Status- und Produkt-API-Tests erfolgreich; Typprüfung und frischer isolierter Next-Build erfolgreich. Lokal im Browser geprüft: leeres Elternkonto ohne Shop-Button, Hinzufügen der fiktiven 30-Euro-Karte, Kopierbestätigung, gespeicherte Profilkarte, geschützte Historie und Guthaben-Popup/Dropdown. Ausschließlich lokale Beispieldaten; keine echten Zahlungen oder Mails, kein Commit/Deployment. Die offenen Punkte zur späteren Live-Abrechnung bleiben unverändert.
