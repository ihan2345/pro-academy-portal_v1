# Produktverwaltung: Veröffentlichung

Die ausdrückliche Veröffentlichungsfreigabe vom 26.10.2026 ersetzt die Beschränkung auf lokale Tests aus dem ursprünglichen Arbeitsauftrag. Der isolierte lokale Produkttest bleibt separat verfügbar.

## Funktionen und bestehende Abos

Die zentrale Verwaltung liegt unter `/admin/produkte`. Bestehende Tarife und Einheiten werden unter `/admin/produkte/tarife` verwaltet. Die bestehenden Trainingskontingente zählen weiterhin Einheiten. Fußball- und zusätzliche Athletik-Zeitstunden pro Monat sowie Gesamtstunden bei Camps sind ergänzende, editierbare Angaben; sie verändern keine Ansprüche.

Veröffentlichte Produkte verwenden geprüfte Stripe-Preise derselben Umgebung. Entwürfe verändern keine veröffentlichten Angebote. Zielgruppen, individuelle Freigaben, Kaufzustand und Aktionen werden serverseitig geprüft. Auswirkungen einer Veröffentlichung werden aus den Datenbankdaten berechnet und vor dem Veröffentlichen erneut abgeglichen.

Bestehende Abo-Zuordnungen, Leistungszeiträume und Kontingentberechnungen bleiben in den bisherigen SQL-Routinen. Die Produktabläufe verwenden dieselben Routinen. Bei aktivierten Produktzahlungen werden externe Stripe-Änderungen zusätzlich durch die dauerhafte Produkt-Ereigniswarteschlange abgeglichen. Der bisherige signierte Webhook bleibt bestehen; der bestehende Jobs-Runner verarbeitet Produkt-Ereignisse ebenfalls. Ein Abruf über die Stripe-API alle fünf Minuten ergänzt Ereignisse, die am bestehenden Webhook nicht abonniert sind. Ein deaktivierter Shop hält diese Verarbeitung nicht an.

## Shop-Schalter

In **Admin → Einstellungen**, direkt nach **Spieler-API**, erscheint **Produkt-Shop** ausschließlich für Admins mit der vorhandenen Datenbankberechtigung `manage_features` (Super-Admin). Dieselbe Einstellung ist auch unter „Globale Funktionen“ erreichbar. Es handelt sich um denselben gespeicherten Schalter, keine zweite Steuerung.

Der Schalter startet bei der Erstinstallation **deaktiviert**. Er sperrt `/produkte`, die Großschreibungsvariante `/Produkte` und die Shop-API einschließlich Kaufstart und Tarifwechsel. Admin-Verwaltung, Webhooks und die Verarbeitung bereits bezahlter Bestellungen bleiben verfügbar. Fehler beim Lesen des Schalters öffnen den Shop nicht. Änderungen erfordern serverseitige Berechtigung, passenden Origin und den erwarteten bisherigen Zustand; sie werden protokolliert.

## Migrationen und Zahlungsumgebung

`supabase/release/022` bis `029` werden gemeinsam transaktional angewendet. `scripts/products-release.mjs` prüft bereits angewendete Versionen auf unveränderten Inhalt und protokolliert die SQL-Dateien in der Supabase-Migrationshistorie. Standard ist ein Probelauf mit Rollback:

```sh
PRODUCT_RELEASE_PROJECT_REF=<projekt-ref> node scripts/products-release.mjs
PRODUCT_RELEASE_PROJECT_REF=<projekt-ref> node scripts/products-release.mjs --apply
```

Die produktive Migration setzt `product_runtime.livemode=true`. Diese Tabelle kann kein normaler Admin oder Client verändern. Lokale Tests bleiben im Testmodus mit eigener Datenbank. Zahlungsnachweise, gespeicherte Bestellungen, Stripe-Preise und Camp-Angebote müssen jeweils zur Umgebung passen. Keine synthetischen Testfamilien oder Beispielprodukte werden in Produktion übernommen.

Produktbilder werden in Produktion über die Cloudflare-Bindung `PRODUCT_IMAGES` geprüft, verkleinert und als WebP in privatem Supabase Storage gespeichert. Lokal bleibt der eigene Bildprozessor auf Port 3111 zuständig. Es wird kein öffentlicher Bild-Link zur Verarbeitung benötigt.

## Stripe-Einrichtung

Der bisher hinterlegte eingeschränkte Live-Schlüssel wurde geprüft: Preis-/Ereignisabruf, Rechnungszahlungen, Kunden und Abos sind lesbar. Stripe verweigert jedoch das Schreiben von Checkout Sessions, Customers, Subscriptions und Subscription Schedules sowie das Lesen von Disputes mit HTTP 403. Schreibprüfungen verwenden absichtlich ungültige Parameter oder nicht vorhandene IDs und erzeugen keine Zahlungsobjekte.

Nach Anpassung durch den Nutzer wurden sämtliche benötigten Lesezugriffe erneut mit HTTP 200 bestätigt. Absichtlich ungültige Schreibanfragen werden nun wegen ihrer Parameter bzw. fehlenden Testreferenzen abgewiesen (HTTP 400/404), nicht mehr wegen fehlender Berechtigung. Auch die Rechnungsvorschau ist erlaubt. Der geprüfte Live-Schlüssel wird als `PRODUCT_STRIPE_SECRET_KEY` im Portal und Runner hinterlegt; `PRODUCT_PAYMENTS_ENABLED=true` aktiviert die Zahlungsfunktionen. Der Super-Admin-Shop-Schalter bleibt zunächst geschlossen. Bestehende Abos und Camp-Zahlungen verwenden weiterhin ihre bisherigen Einstellungen.

Ein zusätzlicher eingeschränkter Live-Schlüssel kann als `PRODUCT_STRIPE_SECRET_KEY` eingerichtet werden. Er benötigt Schreiben für Checkout Sessions, Customers, Subscriptions und Subscription Schedules sowie Lesen für Prices, Products, Invoices, Invoice Payments, Charges, Promotion Codes, Events und Disputes. Die Berechtigung für Rechnungsvorschauen ist ebenfalls zu prüfen. Der bisherige Synchronisierungsschlüssel muss dafür nicht erweitert werden.

Nach Hinterlegung: Schlüssel ausschließlich als Cloudflare-Secret in **Portal und Runner** setzen, Berechtigungen prüfen, `PRODUCT_PAYMENTS_ENABLED=true` in beiden Konfigurationen veröffentlichen, Runner-Verarbeitung prüfen und erst danach den Shop über den Super-Admin-Schalter öffnen. Eine komplette bezahlte Live-Bestellung wurde nicht als Veröffentlichungstest ausgelöst.

Eine echte kostenpflichtige Live-Bestellung wurde zur Veröffentlichung nicht ausgelöst.

## Prüfungen

Automatisierte Fach-, Datenbank- und Sicherheitsprüfungen sowie ein frischer Cloudflare-Produktionsbuild gehören zur Veröffentlichung. Der Browser-Test prüft die fehlende Schalterberechtigung normaler Admins, Sperre von Seite/API, weiterhin erreichbare Admin-Verwaltung, Wiederöffnung und mobile Darstellung. Echte Stripe-Zahlungsabläufe wurden vorab ausschließlich im isolierten Stripe-Testmodus geprüft. Private Nachweise und technische Protokolle liegen unter `output/products-release/` und werden nicht eingecheckt.

Für den Release wurden Next.js auf 16.4.3 und weitere Pakete innerhalb ihrer unterstützten Versionsbereiche aktualisiert. `npm audit --omit=dev` meldete danach keine bekannten Schwachstellen in den Produktionsabhängigkeiten. Alle 965 Tests in 88 Dateien liefen auch mit dem aktualisierten Lockfile erfolgreich. Der Cloudflare-Build verwendet Webpack; Next.js- und OpenNext-Versionen stammen aus dem eingecheckten Lockfile. Die Produktions-Bildverarbeitung verwendet die [offizielle Images-Bindung](https://developers.cloudflare.com/images/optimization/binding/).

Die erste Online-Abnahme des aktualisierten Next.js-Builds erkannte einen Laufzeitfehler im bisherigen OpenNext-Adapter (fehlende Einbindung von `preview-props.json`). Das Portal wurde unmittelbar auf seine vorherige funktionierende Version zurückgesetzt. Der Adapter wurde anschließend auf die offizielle Version 1.20.13 aktualisiert; sie enthält die [Upstream-Korrektur für Next.js 16.4](https://github.com/opennextjs/opennextjs-cloudflare/pull/1356). Vor der erneuten Veröffentlichung bestand der Build zusätzlich die Prüfung unter der tatsächlichen lokalen Cloudflare-Laufzeit: SSR-Login, statische Assets, Admin-Anmeldeschutz, geschlossener Shop und Ablehnung unsignierter Webhooks. Diese Regression prüft `scripts/test-products-worker.mjs`. Es werden keine Manifest-Dateien erfunden oder manuell in den Build eingeschleust.

Der bestehende signierte Portal-Webhook wurde nach erfolgreicher Rechteprüfung um Checkout-, asynchrone Zahlungs-, Customer-, Pending-Update-, Erstattungs- und Dispute-Ereignisse ergänzt. Andere Webhooks bleiben unverändert. Der periodische Ereignisabruf bleibt als zusätzliche Absicherung aktiv.

## Produktbühne auf externen Websites

Super-Admins finden unter **Admin → Einstellungen → Produkt-Shop** direkt unter der Aktivierung die Verwaltung der Einbettung. **Neue Einbettung** erstellt den ersten Code oder ersetzt die einzige aktive Freigabe. **Einbettung kopieren** kopiert den fertigen iframe; **Code anzeigen** öffnet ihn als reinen Text in einem geschützten neuen Tab. Bei Erneuerung muss der Code auf allen verwendenden Websites ersetzt werden. Gleichzeitige Änderungen überschreiben sich nicht; Erneuerungen werden ohne Token im Audit erfasst.

Die externe Ansicht zeigt ausschließlich die bestehende Produktbühne mit öffentlichen Besucherangeboten des Shopkanals `catalog`, ohne Portalnavigation, Produktliste oder Kaufabwicklung. Die Bühne nutzt dieselbe Komponente und dieselben Veröffentlichungs- und Sichtbarkeitsregeln wie der Shop. Daten werden alle 30 Sekunden geladen; bei gesperrtem Shop, erneuertem Token oder Abruffehlern wird die bisherige Anzeige geleert. Eine bestehende Portalanmeldung erweitert die öffentliche Ansicht nicht. Produktbilder werden ebenfalls mit Token und Besucherberechtigung geprüft.

Der iframe füllt die Breite seines Containers und eine Bildschirmhöhe (`100svh`). Auf schmalen Displays kann die Bühne für vollständig lesbare Inhalte vertikal scrollen. Produktlinks öffnen `/produkte?product=<Produkt-ID>` in einem neuen Tab direkt mit der passenden Produktauswahl. Nicht mehr sichtbare Produkte zeigen dort einen Verfügbarkeitshinweis. **Zum Shop** öffnet die Shopübersicht.

Nur `/einbettung/produktbuehne/<token>` darf von HTTPS-Websites eingebettet werden (zusätzlich lokale HTTP-Entwicklung). Andere Portalansichten behalten ihren Frame-Schutz. Der Token ist eine öffentliche, widerrufbare Freigabe der Bühne und gewährt keine Verwaltungs- oder Familienrechte.

Die Datenbankergänzung wird mit `PRODUCT_RELEASE_PROJECT_REF=<projekt-ref> node scripts/release-product-showcase.mjs` zunächst mit Rollback geprüft; `--apply` wendet sie transaktional mit Migrationshistorie an. Sie erstellt noch keinen aktiven Token. Lokale Produkttests installieren `041-product-showcase-embed.sql` über die vorhandene Schemakette.
