# Produkte – lokale Umsetzung und Prüfbericht

Stand: 26.10.2026 · Branch `Produkte` · Ausgangsstand `c883c89`.

Die lokale Umsetzung wurde im Chat ausdrücklich freigegeben. Die neue Funktion ist ausschließlich bei `APP_MODE=test`, freigegebener Produktverwaltung und lokalen App-/Supabase-Adressen erreichbar. Produktive Datenbanken, Stripe-Objekte, Cloudflare-Ressourcen und die separate Homepage wurden nicht verändert. Kein Commit, Push, Merge oder Deployment.

## Überarbeitung nach Prüfung vom 26.10.2026

Die zehn besprochenen Punkte sind lokal nachgearbeitet. Auf ausdrücklichen Nutzerwunsch zählen bestehende Kontingente weiterhin Trainingseinheiten. Zusätzlich lassen sich am Verkaufsangebot Fußball- und Athletik-Zeitstunden pro Monat beziehungsweise die Gesamttrainingsstunden eines Camps pflegen. Diese Angaben werden im Shop angezeigt und verändern keine erworbenen Kontingente.

- Die vorhandene Fachplanpflege ist unter `/admin/produkte/tarife` wieder erreichbar. Verkaufsangebote und Tarif-/Kontingentdaten sind damit klar getrennt erreichbar.
- Der Produktstarter startet bei vorhandenem Testschlüssel auch den Zahlungsworker. Er ruft tatsächliche Stripe-Testereignisse mit vollständiger Pagination und überlappendem, dauerhaftem Abrufstand ab. Webhook und API-Abruf verwenden dieselbe dauerhafte Inbox und deduplizieren über die Stripe-Ereignis-ID. Ein öffentlich erreichbarer lokaler Webhook oder eine Stripe-CLI-Anmeldung ist dafür nicht notwendig. Ein signierter Webhook bleibt zusätzlich nutzbar.
- Externe Änderungen bestehender, lokal bekannter Abos werden unabhängig von einem Produktkauf übernommen. Neue externe Abos werden nur über eine eindeutige vorhandene Customer-Zuordnung erkannt; die Kinderzuordnung bleibt geprüft. Eine E-Mail-Übereinstimmung führt nicht zur Übernahme fremder Familien.
- Vorgemerkte oder unbezahlte Wechsel blockieren weder normalen Statusabgleich noch externe Kündigungen. Entfernte beziehungsweise durch Kündigung beendete Wechsel werden geschlossen. Die bisherigen Kontingent-, Jahresabo- und Historienroutinen werden weiterverwendet.
- Offene Käufe sind für Eltern sichtbar. Erneute Aufrufe führen zum bestehenden Checkout. Verlorene Session-Verknüpfungen werden anhand der serverseitigen Referenz in Stripe wiedergefunden. Ein neuer Versuch wird erst nach geprüftem Ablauf freigegeben. Unbezahlte Reservierungen erzeugen kein reguläres Kinderprofil.
- Der Abschluss vergleicht den Datenstand der betroffenen Familie, statt Veränderungen unabhängiger Familien einzubeziehen.
- Bei Abos und Camps werden keine wirkungslosen Shop-Nutzungsregeln oder Nutzungsfreigaben mehr angeboten. Hier gelten Vertrags- und Buchungsrechte. Für sonstige Produkte bleiben zusätzliche Nutzungsregeln nach abgeschlossenem Kauf möglich.
- Exklusive Angebote benötigen ausdrücklich eingeschränkte Sichtbarkeit. Offene Regeln werden auch serverseitig bei Veröffentlichung verweigert. Zielgruppenvorlagen vereinfachen die Pflege; eigene UND-/ODER-Regeln liegen im erweiterten Bereich.
- „Weiteres Kind“ wird bei der Angebotsanzeige als neues Kind ausgewertet; vorhandene Kinder bleiben auswählbar. Sonstige bezahlte Leistungen nutzen für Trial-Kinder dieselbe bestehende Identitätsbrücke, ohne das Probetraining in ein Abo umzuwandeln.
- Rechnungen und Payment Intents werden über Stripe Invoice Payments verknüpft. Dadurch werden auch Abo-Erstattungen und spätere Rechnungszahlungen zugeordnet. Finanzielle Klärungen sind sichtbar und mit Adminbegründung dokumentierbar; Erstattungsnachweise und historische Kontingente bleiben erhalten. Ungeklärte andere Zuordnungs-/Kontingentfälle werden nicht pauschal freigegeben.
- Die Änderungsvorschau unterscheidet Anzeigeänderungen, Berechtigungsänderungen, eindeutige Familien und offene Kaufaufträge. Sonstige Leistungen besitzen einen getrennten Bearbeitungsstand „Gebucht / Termin vereinbart / Erbracht“.

Ein tatsächlicher Adminabschluss der Testerstattung wurde ebenfalls geprüft: Der Erstattungsnachweis und der gekündigte Vertragszustand bleiben erhalten; der dokumentierte Finanzhinweis wird nur bei weiterhin eindeutiger Zuordnung freigegeben. Unveränderte doppelte Erstattungsereignisse öffnen eine bereits dokumentierte Klärung nicht erneut.

Die Verwaltung zeigt unter „Bestellungen, Tarifwechsel & Zahlungsbetrieb“ den tatsächlichen Worker-/Abrufstatus, problematische Ereignisse, offene Wechsel und Zahlungsprüfungen. Eltern sehen unter „Meine Buchungen und offenen Käufe“ ihre eigenen Aufträge. Die Shopanzeige aktualisiert sich bei Rückkehr ins Fenster und regelmäßig im sichtbaren Browserfenster.

Tatsächliche Stripe-Testprüfung mit einer eigenen synthetischen Familie bestanden: externes Bestandsabo mit 4 Einheiten, externes Upgrade auf 8 Einheiten bei identischer Kontingent-ID, Kündigungsvormerkung und Rücknahme, lokaler Downgrade am selben Abo, externe Beendigung des zugehörigen Stripe-Schedules, geschlossene Wechsel-/Kontingentzustände, passende Elternaktion und Abo-Erstattung über Rechnungs-/Payment-Intent-Zuordnung. Ein angehängter Stripe-Schedule wird über dessen API beendet; Stripe erlaubt dort keine direkte Änderung des Kündigungsverhaltens am Abo.

Ergebnisdateien: `output/products-review/stripe-workflow-results.json`, `checkout-recovery-results.json`, `workflow-ui-results.json` und `payment-review-results.json`. Wiederholbare Befehle: `npm run products:test:stripe`, `npm run products:test:recovery`, `node scripts/test-products-workflow-ui.mjs`. Die Stripe-Prüfung legt ausschließlich gekennzeichnete Testobjekte an, verwendet eine Stripe-Testzahlungsmethode und beendet ihr Testabo. Die Recovery-Prüfung öffnet und beendet nur Test-Checkout-Sessions und übermittelt keine Zahlung.

## Implementierte Funktionen

- Spezialisierte Verwaltung unter `/admin/produkte`: beliebige Anzeigenamen, Abonnement/Camp/Sonstiges, interne Namen, Beschreibungen, Kategorien, Reihenfolge und Hervorhebung.
- Serverseitige Suche, Filter und stabile Cursor-Pagination. 1.105 Produkte wurden über 47 Seiten vollständig erreicht. Die Seitengröße ist keine Gesamtkataloggrenze.
- Separate Entwürfe und veröffentlichte Versionen mit Revisionsprüfung. Unveröffentlichte Namen, Kategorien und Reihenfolge beeinflussen die öffentliche Produktanzeige nicht.
- Status Entwurf/Aktiv/Intern/Exklusiv/Ausverkauft/Archiviert, fünf getrennte Anzeigeorte und zeitgesteuerte Freigabe. Shop-Archivierung verändert keine bestehenden Fachpläne oder Verträge.
- Drei serverseitige Regelprüfungen: Sichtbarkeit, Kauf und Nutzung. ODER/UND, Ausschlüsse, Familien-/Kindbezug sowie individuelle, befristete Freigaben. Spielerbedingungen desselben UND-Ausdrucks gelten für dasselbe Kind.
- Automatische Zielgruppen aus tatsächlichen Familien-, Trial-, Abo-/Item-, Kontingent- und Campzuordnungen. Gleiche Camp-/Trial-Kinder werden über ihre UUID zusammengeführt.
- Live-Vorschau für Besucher, Neukunde, Trial, vier Tarife, ehemalige Kunden, Campkunden, interne Nutzer, individuelle Freigaben und Mischfamilien. Eine Simulation erteilt keine echten Rechte.
- Änderungsvorschau aus vollständigen lokalen DB-Abfragen: vorher/nachher berechtigte Familien, neu/entfallen, betroffene Familien und sichtbare Einträge. Individuelle Freigaben besitzen ebenfalls eine bestätigungspflichtige DB-Vorschau. Signierte, kurzlebige Ergebnisse sind an Revision und Datenstand gebunden.
- Hauptbild/Galerie, Vorschau, Reihenfolge, Ersetzen und Entfernen. Uploads werden auf Signatur, Dekodierbarkeit, Dateigröße, Pixelzahl und Animation geprüft, von Metadaten bereinigt und als WebP gespeichert. Zugriff über autorisierte Endpunkte und privaten Supabase-Storage. Referenzlose Dateien lassen sich nach Wartefrist bereinigen; historische Versionen bleiben geschützt.
- Serverbasierte Stripe-Testpreisprüfung einschließlich Product, Aktivität, Betrag, Währung, Zahlungsart und Intervall. Lokale Preisbeispiele sind ausdrücklich als `fixture` gekennzeichnet und werden nicht als echte Stripe-Prüfung akzeptiert.
- `/produkte` als responsive zentrale Angebotsübersicht mit Kinder-/Familienauswahl und zustandsabhängigen Kaufaktionen.
- Neukundeneinstieg mit bestätigter Anmeldung, kontrollierter Elternanlage und Kindreservierung. Ein reguläres neues Kinderprofil entsteht erst nach geprüfter Zahlung. Keine Zusammenführung allein anhand einer Rechnungs-E-Mail.
- API-Checkout mit dauerhaften Kaufaufträgen, Idempotenz und Sperren gegen parallele Käufe; Preise und Zahlkonten werden serverseitig bestimmt.
- Zahlungsabschluss mit erneut abgerufener Session, Artikel-, Betrags-, Währungs-, Customer- und Zahlungsprüfung. Browserredirects aktivieren keine Mitgliedschaft. Fehler, Deaktivierung während Checkout oder widersprüchliche Zuordnungen führen zur Prüfung.
- Gemeinsamer interner Kern für bestehende Adminzuordnung und bezahlte Trial-Übernahme. Die bisherigen Adminaufrufe behalten ihre Rollenprüfungen. Trial-/Campidentität, bestehende Feedback- und Teilnahmebezüge bleiben erhalten.
- Camp-API-Checkout mit tatsächlichem Ursprung `api_checkout` und ohne erfundene Payment-Link-ID. Alter, Kapazität, Identität und Zahlungsbestätigung verwenden die bestehenden Fachroutinen. Alte Linkbuchungen behalten ihren Ursprung.
- Wechselvorschau für eindeutige bestehende Abos/Items: zahlungsabhängiges sofortiges Upgrade, Downgrade über einen Zeitplan zum bestehenden Abrechnungsende. Keine zweite Subscription für einen Tarifwechsel. Vorhandene Einheitenberechnung und Kontingentrevisionen werden wiederverwendet.
- Signierter Testwebhook mit dauerhafter Inbox, Claims, Wiederholung und Deduplizierung. Separater lokaler Zahlungsworker startet keine regulären Mail-, Trainings- oder Campimportjobs.

## Architektur und Grenzen

`plans`, `subscriptions`, `subscription_players`, `entitlement_periods` und die bestehenden Camp-/Trialmodelle bleiben die Fachgrundlage. Der neue Katalog legt Darstellung und Verkaufsfreigaben darüber. Ein Anzeigename ist kein neuer Kontingenttarif.

Die Bildkomprimierung läuft in einem privaten Node-Hilfsprozess unter `127.0.0.1:3111`. App und Hilfsprozess authentifizieren sich mit einem ausschließlich lokal erzeugten Secret. Das native Bildmodul wird vom Anwendungscode nicht importiert und gehört nicht in den Cloudflare-Worker. Der lokale Starter verwaltet beide Prozesse. Vor einem späteren produktiven Einsatz ist ein ausdrücklich freigegebener, dort verfügbarer Bildverarbeitungsweg erforderlich.

Käufe benötigen einen echten Elternkontext und eine konkrete eigene Kinderidentität. Beim Hinzufügen eines neuen Kindes wird zunächst nur eine stabile Reservierung gespeichert. Ein Campkauf übernimmt ein Trial-Kind nicht in ein Abo. Archivierte Angebote entziehen keine weiterhin gültigen Abo-/Camprechte. Der Nutzungsendpunkt berücksichtigt bei Abo-/Campkäufen die gespeicherte Angebotsversion.

Die Wechselautomatik behandelt eindeutige Einzelpositionen mit Menge 1 und gleichem Monats-/Jahresintervall. Offene Zahlungen, bestehende Zeitpläne, Kündigungsfälle, Mengen-/Mehrfachpositionen, Währungs-/Intervallwechsel und gegenläufige Leistungsänderungen werden zur persönlichen Prüfung gesperrt. Jahresabos wechseln nicht automatisch an der Grenze eines bloßen monatlichen Trainingsfensters.

Bei einer bereits bezahlten, zwischenzeitlich gesperrten Bestellung wird kein neuer Anspruch still aktiviert. Die Zahlung bleibt zur Klärung sichtbar. Eine automatische Erstattung wurde nicht eingeführt.

## Migrationen

Ausschließlich in PGlite und der eigenen lokalen Supabase-Instanz verwendet:

| Datei                                                  | Inhalt                                                                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/release/022-product-management.sql`          | Katalog, Versionen, Bilder, Freigaben, Kauf-/Wechselaufträge, Zahlungsinbox, Rollen/RLS, geschützter gemeinsamer Zuordnungskern, API-Campursprung und Neukundenvorbereitung. |
| `supabase/release/023-product-checkout-hardening.sql`  | Gespeicherter Kaufkanal, ausdrückliche Campdaten, Reservierungsdauer und eindeutige aktive Preiszuordnung.                                                                   |
| `supabase/release/024-product-catalog-isolation.sql`   | Suche und Reihenfolge der veröffentlichten Fassung sowie Prüfung tatsächlicher Stripe-Validierung.                                                                           |
| `supabase/release/025-product-payment-consistency.sql` | Abschließend geprüfte Auftrags-/Abschlussroutinen, Datenstandprüfung und Schutz gegen konkurrierende Erfüllung.                                                              |
| `supabase/release/026-product-grant-preview.sql`       | Transaktionale individuelle Freigaben nach aktueller Änderungsvorschau.                                                                                                      |

Zusätzlich: `027-product-workflows.sql` ergänzt familienbezogene Abschlussprüfung, Zahlungsreferenzen, Leistungsstände, Exklusivprüfung und erneute Adminprüfung. `028-product-payment-review.sql` ergänzt protokollierte finanzielle Klärungen und erhält Erstattungs- und Kontingentnachweise.

Die Voraussetzungen und ihre Reihenfolge sind in `scripts/products-local/schema.mjs` zentral festgehalten. Vorhandene Migrationen wurden nicht rückwirkend geändert. Ein Zurücksetzen bestehender Familien-/Camp-Testdaten ist nicht erforderlich. Bestehende Testumgebungen werden vom Setup nicht ausgewählt.

## Lokale Umgebung öffnen und starten

Einstieg: [Testkonto auswählen](http://127.0.0.1:3110/lokaler-test).

- App: `http://127.0.0.1:3110`
- Eigene Supabase-API: `http://127.0.0.1:57321`
- Eigene Datenbank: `127.0.0.1:57322`
- Lokaler Auth-Mailausgang: `http://127.0.0.1:57324`
- Privater Bildprozessor: `127.0.0.1:3111`, kein öffentlicher Zugriff.
- Arbeitsbereich: `output/product-management-local/`; Kontodaten, Passwörter und Secrets bleiben dort ignoriert.

Im Repository, bei vorhandener Supabase CLI:

```sh
npm run products:setup
npm run products:seed
npm run products:dev
```

Wenn die CLI nicht im PATH liegt, kann `PRODUCTS_SUPABASE_CLI` auf deren lokales Binary zeigen. Setup setzt alle veröffentlichten Ports dieser Testinstanz auf Loopback und prüft sie vor dem Anlegen der Testkonten. Es richtet ausschließlich das Projekt `pabyak-products-local` ein. Der Seed verwendet nur erfundene Familien und Preisbeispiele und überschreibt einen bereits markierten Seed nicht.

Nach Quellcodeänderungen den eigenen Produktstarter beenden, Setup ohne Datenreset erneut ausführen und neu starten. `node_modules` der Test-/Buildkopien kann auf die Repository-Abhängigkeiten verweisen: **dort kein `npm ci` ausführen**. Installationen gehören ins Repository oder in eine vorher ausdrücklich von Verknüpfungen befreite Kopie.

Ohne Stripe-Testzugang funktionieren Verwaltung, Vorschau, Berechtigungen, Bilder, Suche, Veröffentlichungssperren und lokale DB-Prüfungen. Die Beispieldaten dürfen nicht als echte Stripeobjekte verwendet werden.

## Stripe-Testzugang und weitere Abnahme

Der bereits vorhandene `CAMP_STRIPE_SECRET_KEY` aus `.env.camp.local` wurde nach Prüfung des Testpräfixes als `PRODUCT_STRIPE_SECRET_KEY` in die ignorierte Produkt-Testumgebung übernommen. Der Zugang ist gültig; die App wurde damit neu gestartet. Die ursprüngliche Aussage, ein Testzugang fehle, war unzutreffend: Er war lediglich noch nicht mit dieser Umgebung verbunden. Keine Livezugänge wurden übernommen.

In `output/product-management-local/app/.env.local` ausschließlich getrennte Testzugänge hinterlegen:

```dotenv
PRODUCT_STRIPE_SECRET_KEY=sk_test_...
PRODUCT_STRIPE_WEBHOOK_SECRET=whsec_...
PRODUCT_PAYMENTS_ENABLED=true
```

Keine Werte aus produktiven Umgebungen übernehmen. Der lokale Netzwerkfilter erlaubt Stripe nur mit exakt diesem konfigurierten Testcredential; geerbte Live-Zugänge bleiben gesperrt. Der Starter überschreibt außerdem generische Stripe-/Camp-Zugänge mit leeren Werten.

Eigene Stripe-Testprodukte/-preise anlegen, im Editor prüfen und den lokalen Fachplänen/Campangeboten eindeutig zuordnen. Der synthetische Seed erzeugt ausdrücklich keine Stripeobjekte. Der vorhandene Testzugang umfasst keine Liveobjekte.

Der Produktstarter startet den lokalen Worker automatisch, sobald ein gültiger Testschlüssel konfiguriert ist. Alternativ separat starten:

```sh
npm run products:worker
```

Optional einen Testwebhook an `/api/products/webhook` weiterleiten und dafür den tatsächlichen Signing-Secret konfigurieren. Der automatische API-Abruf benötigt diesen Secret nicht. Zusätzlich existiert eine geschützte Adminaktion zur Inboxverarbeitung. Der Worker verarbeitet Produktzahlungen und Ereignisse lokal bekannter Testabos; er aktiviert keine bestehende Produktions-/Mailverarbeitung. Details des tatsächlichen Stripe-Testkontos, Zahlungsmethoden und Kundenportal-Konfiguration müssen bei dieser Abnahme geprüft werden.

## Tests und tatsächliche Ergebnisse

- Vollständige Vitest-Suite nach Wiederherstellung der zum Lockfile passenden Abhängigkeiten: **957 Tests in 87 Dateien bestanden**, einschließlich der lokalen Netzwerkfilterprüfungen.
- TypeScript-Prüfung erfolgreich.
- Bestehender Jobs-Build und Worker-Typprüfung erfolgreich.
- Next.js-Produktionskompilierung in isolierter Kopie mit lokalen Umgebungswerten erfolgreich, einschließlich Next.js 16.3.8 und aller neuen Routen.
- Echte Browser-/HTTP-Prüfung mit lokalem Supabase Auth, Postgres und Storage: Produktanlage, Bearbeitung, Bildkomprimierung/-upload/-vorschau, DB-Impact, Archivierung, individuelle Freigabe mit Vorschau, Dialogfokus, Mischfamilie, Desktop/Smartphone sowie verweigerte Eltern-/Besucher-Adminzugriffe.
- Serverseitige Suche und vollständige Pagination: **1.105 Produkte, 47 Seiten**, ohne Duplikate. Die zusätzlichen Pagination-Prüfdatensätze wurden anschließend entfernt.
- Datenbanktests belegen unter anderem: bestehender Adminweg bleibt geschützt und funktionsfähig; private Übernahmekerne sind auch für `service_role` nicht direkt ausführbar; geprüfte Trial-Übernahme erhält dieselbe Camp-Kinder-UUID; API-Campabschluss nutzt die bisherige Bestätigungsroutine; keine Erfüllung bei falschem Zahlungsbetrag; wiederholter Abschluss erzeugt keinen zweiten Kauf.
- Tatsächliche lesende Stripe-Testprüfung über den angemeldeten Admin-Endpunkt bestanden: bestehender aktiver Testpreis, unpassende Produktart, abweichendes Stripe-Produkt und unbekannter Testpreis. Ergebnis unter `output/products-review/stripe-read-results.json`. Keine Stripe-Objekte wurden dabei angelegt oder verändert.
- Stripe-Verhalten ist mit kontrollierten SDK-Antworten geprüft: ungültige/inaktive/fremde Preise, Livezugänge, verzögerte/fehlgeschlagene Zahlung, falscher Betrag/Customer/Artikel, Erstattung/Streit, Deaktivierung während Checkout, vorhandenes Item beim Upgrade, ausstehende Zahlung, terminierter Downgrade und veraltete Vorschau.

Reproduzierbare Befehle:

```sh
npm run typecheck
npm test
npm run build:jobs
npm run typecheck:jobs
npm run products:test:ui
npm run products:test:api
node scripts/products-local/build.mjs
```

Bildschirmnachweise und maschinenlesbare Ergebnisse liegen unter `output/products-review/`. Sie enthalten ausschließlich lokale Testdaten und sind nicht versioniert.

## Lokaler Umgebungsfehler und Wiederherstellung

Beim Abgleich der installierten Abhängigkeiten mit dem vorhandenen Lockfile wurde eine verknüpfte `node_modules`-Kopie versehentlich mitbearbeitet. Die anschließende Wiederherstellung füllte kurzzeitig den lokalen Datenträger. Die vollständigen Abhängigkeiten wurden wiederhergestellt und nur eigene generierte Buildkopien entfernt. Docker wurde neu gestartet; im vorhandenen Camp-Teststack wurden zwei beschädigte PostgreSQL-Sperrdateien gezielt repariert. Datenbankvolumes wurden nicht gelöscht oder zurückgesetzt. Danach wurden die Produktanmeldung, Browser-/API-Prüfungen und bestehenden Worker-Prüfungen erneut erfolgreich ausgeführt.

## Noch offen / nicht als bestanden behauptet

1. **Weitere Stripe-Sonderfälle:** Tatsächliche Testpreis-, Abo-, externe Änderungs-, Downgrade-Vormerkungs-, Kündigungs-, Erstattungs- und Checkout-Recovery-Prüfungen sind bestanden. Noch nicht als vollständig abgenommen gelten das bezahlte Ende eines durch die neue Shopoberfläche begonnenen Checkout, die tatsächliche Ausführung eines Downgrades an einer künftigen Periodengrenze, SCA-/verzögerte Zahlungsfälle sowie die vollständige Weiterleitung eines echten Stripe-Webhooks an localhost. Hier bestehen gezielte Mock-/Datenbankprüfungen; sie ersetzen diese zusätzlichen End-to-End-Fälle nicht. Die ursprünglichen synthetischen Beispielangebote behalten ausdrücklich markierte Platzhalterpreise. Daneben existieren getrennte, als Stripe-Test bezeichnete Angebote mit tatsächlichen Testpreisen.
2. **Cloudflare-Paketierung:** Der isolierte Next-Build besteht. Der vorhandene OpenNext-Adapter 1.20.6 scheitert bei der Cloudflare-Paketierung. Mit Turbopack erwartet er ein nicht erzeugtes `middleware.js.nft.json`; der Webpack-Versuch scheiterte zusätzlich an der Auflösung nativer Sharp-Module. Die neue App importiert das Bildmodul inzwischen ausschließlich im getrennten lokalen Hilfsprozess. Keine ungesicherte Adapter-/Trace-Manipulation und kein Deployment zur Umgehung dieser Fehler. Vor späterer Veröffentlichung ist die Next-/OpenNext-Kompatibilität gesondert zu lösen und in der Zielruntime zu prüfen.
3. **Homepage:** Anzeigeort und öffentliche Produktprojektion sind vorbereitet; der separate Website-Code wurde nicht verändert oder als angeschlossen ausgegeben.
4. **Sonderwechsel:** Abrechnungsintervallwechsel, Mengen-/Mehrfachpositionen, gegensätzliche Fußball-/Athletikänderungen und unklare Bestands-/Zahlerfälle benötigen weiterhin fachliche Prüfung. Bestehende Adminwerkzeuge bleiben erhalten.
5. **Produktiver Bildbetrieb:** Der lokale Node-Hilfsprozess ist kein eingerichteter produktiver Bilddienst. Interne Bilder bleiben durch die App autorisiert; eine spätere öffentliche CDN-Auslieferung benötigt einen eigenen Veröffentlichungsauftrag.

Die vollständige Pflichtfallmatrix steht im [ROAD-TO](../ROAD_TO_PRODUCT_MANAGEMENT_V2.md). Die lokalen Prüfungen sind von der noch offenen echten Stripe- und Zielruntime-Abnahme getrennt.

## Geänderte Dateien

- Katalog-/Policy-/Simulationsmodell: `src/lib/products/`.
- Kontext, Katalog, Impact, Bilder, Stripe-Prüfung, Checkout, Wechsel, Freigaben und Inbox: `src/lib/server/products/`.
- Produkteditor und zentrale Angebotsoberfläche: `src/components/products/`.
- Neue API-Bereiche: `src/app/api/admin/products/[[...action]]/route.ts` und `src/app/api/products/[[...action]]/route.ts`; Produktseite `src/app/produkte/page.tsx`.
- Einbindung in vorhandene Seiten/Navigation: `src/app/[[...section]]/page.tsx`, `src/components/portal.tsx`, `src/lib/types.ts`, `src/lib/server/data.ts`, `src/lib/server/parent-profile.ts`.
- Auth-Rücksprung für den neuen Einstieg: `src/app/auth/callback/route.ts`.
- Bestehender Stripe-Sync: `src/lib/server/stripe.ts` akzeptiert optional einen expliziten Testclient; bisherige Aufrufer behalten ihr Verhalten.
- SQL-Erweiterungen 022–028 unter `supabase/release/`.
- Isoliertes Setup, Seed, Start, Build und Netzfilter: `scripts/products-local/`; Browser-/API-Prüfung: `scripts/test-products-ui.mjs`, `scripts/test-products-api.mjs`.
- Lokale Hilfsprozesse: `workers/products/images.ts` und `workers/products/runner.ts`.
- Neue Prüfungen: `tests/product-events.test.ts`, die echten Stripe-/Checkout-Recovery-Prüfskripte und Browserprüfung der Stunden-/Tarif-/Betriebsfunktionen; außerdem `tests/product-api.test.ts`, `product-change.test.ts`, `product-database.test.ts`, `product-network.test.ts`, `product-payment.test.ts`, `product-policy.test.ts`, `product-price.test.ts`.
- Dokumentation und lokale npm-Skripte; Sharp ist als explizite Abhängigkeit des Bildprozessors erfasst. Es wurde keine UI-Bibliothek ergänzt.

## Technische Quellen

Die neue Orchestrierung wurde mit den installierten SDK-Typen sowie den offiziellen Stripe-Seiten zu [zahlungsabhängigen Updates](https://docs.stripe.com/billing/subscriptions/pending-updates), [Zeitplänen](https://docs.stripe.com/billing/subscriptions/subscription-schedules) und [Checkout-Erfüllung](https://docs.stripe.com/checkout/fulfillment) abgeglichen. Die genaue Testkontoabnahme bleibt wie oben beschrieben offen.

Die Zahlungszuordnung verwendet die offizielle Stripe-Ressource [Invoice Payments](https://docs.stripe.com/api/invoice_payments); der lokale Ereignisabruf verwendet [List all events](https://docs.stripe.com/api/events/list).
