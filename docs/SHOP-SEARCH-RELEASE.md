# Shop-Suche

Am 02.11.2026 auf ausdrücklichen Nutzerauftrag veröffentlicht. Die Korrektur wird mit diesem Release auf `main` committet und gepusht.

## Bestätigte Fehler

Im veröffentlichten Shop lieferten `Game`, `Fußball`, `Fussball` und `Training` keine Treffer, obwohl veröffentlichte Produkte passende Namen oder Texte enthalten. Die bisherige `websearch`-Abfrage auf einem `tsvector` verlangte weitgehend vollständige Wörter. Die lange Beschreibung fehlte im öffentlichen Suchdokument. Eine fehlgeschlagene Suchanfrage ließ außerdem ihre Fehlermeldung nach einer später erfolgreichen Anfrage stehen und konnte Treffer des vorherigen Begriffs anzeigen.

## Korrektur

- Öffentliche Suche in veröffentlichtem Namen, Kurzbeschreibung, Langbeschreibung, Kategorie und Produktart. Teilbegriffe funktionieren innerhalb eines Wortes; Groß-/Kleinschreibung, Bindestriche/Trennzeichen, Akzente und `ß`/`ss` werden vereinheitlicht. `ProPlayer` findet damit `Pro-Player`; `Fussball` findet `Fußballtraining`.
- Mehrere durch Leerzeichen getrennte Begriffe werden mit UND verknüpft. Reine Sonderzeichen werden nicht als Platzhalter oder ungefilterte Gesamtabfrage interpretiert. Sucheingaben sind auf die schon serverseitig geltenden 160 Zeichen begrenzt.
- Neue additive Migration `supabase/release/040-product-shop-search.sql`: normalisierte, automatisch aus dem veröffentlichten JSON berechnete Spalte `published_shop_search`, mit GIN-/Trigrammindex über `pg_trgm`. Keine manuellen Produktdatenänderungen. Bei vorhandenem `pg_trgm` in einem anderen Schema wird dieses verwendet. Die bestehenden Volltextspalten und die administrative Suche bleiben erhalten.
- Alle Suchbegriffe werden vor der bestehenden serverseitigen Seiteneinteilung gefiltert. Reihenfolge, Sichtbarkeitsregeln und Kaufberechtigungen bleiben erhalten; interne Namen und Entwürfe werden nicht in der öffentlichen Suche verwendet.
- Die eine Geschenkkarte wählt bei einer Suche einen passenden sichtbaren Repräsentanten. Ihre gesamte weiterhin berechtigte Betragsauswahl bleibt verfügbar, auch wenn nur ein Geschenk-Unterprodukt zum Begriff passt. `Geschenkkarte`, `Gutschein` und `Guthabenkarte` funktionieren auch bei abweichenden Namen der Unterprodukte.
- Neue Suchanfragen brechen überholte Requests ab und blenden alte Treffer schon während der kurzen Eingabeverzögerung aus. Hintergrundaktualisierungen derselben Ansicht lassen die Darstellung weiterhin bestehen. Suchfehler sind von Kauf-/Checkoutfehlern getrennt, zeigen keine alten Treffer als neues Suchergebnis und verschwinden bei einer neuen Anfrage. Ein Fehlschlag verwirft den geladenen Suchstand, damit auch die Rückkehr zum vorherigen Begriff korrekt lädt.

## Prüfung

56 gezielte Tests in fünf Dateien erfolgreich: echte PostgreSQL-Auswertung mit PGlite für Teilbegriffe, Namensvarianten, Beschreibungen, deutsche Schreibweisen, Unicode, Draft-Isolation und GIN-Index; serverseitige Filterung vor Pagination, Cursorwechsel, unveränderte Sichtbarkeitsauswertung und vollständige Geschenkwerte. Die vier vorhandenen Datenbanktests laden die bereits mitgelieferte `pg_trgm`-Erweiterung für die zusätzliche Migration. Der Pagination-Test wurde anschließend gezielt um höher priorisierte, passende, aber unsichtbare Produkte erweitert und erneut erfolgreich ausgeführt.

TypeScript erfolgreich. Browserprüfung der echten Shop-Komponente in einer ausschließlich lokalen Vorschau mit abgegrenzten Katalogantworten: `Game`, `Fussball`, `ProPlayer`, ein nur in der Langbeschreibung vorhandener Begriff, Abbruch bei schneller Eingabe, Suchfehler und anschließende Erholung (auch mit demselben vorher erfolgreichen Begriff), reine Sonderzeichen und Leeren der Suche. Die lokale Docker-Datenbank war ausgeschaltet; der Suchindex wurde daher in PGlite geprüft, nicht auf der produktiven Datenbank. Keine Käufe, Mails oder Zahlungsanfragen ausgelöst.

## Veröffentlichung

**Vor dem Portal-Deployment muss Migration 040 installiert sein.** Alte Portal-Versionen funktionieren mit der zusätzlichen Spalte weiter. Die neue Portal-Version benötigt sie für öffentliche Suchabfragen. Bei Veröffentlichung zuerst den tatsächlichen aktuellen Datenbank-/GitHub-/Live-Stand abgleichen, dann Migration und geprüften Portalcode veröffentlichen. Keine Jobs-Runner-Veröffentlichung erforderlich.

Private Nachweise: `output/shop-search-review/`. Vergleichsansicht: `http://localhost:3115/shop-suche-vorschau` im ignorierten lokalen Projekt; sie ist kein Bestandteil des veröffentlichten Quellcodes.

## Produktive Abnahme am 02.11.2026

Migration `202611020040` ist installiert; Suchspalte und GIN-Index sind gültig. Die 18 bestehenden Produktmigrationen 022–039 wurden vorher mit dem lokalen Original abgeglichen. Produktive Normalisierung für acht Schreibweisen/Unicode-Fälle stimmt mit der Anwendung überein. Die Migration wurde in einer Transaktion einschließlich Migrationshistorie und Abgleich unveränderter Katalogdaten sowie bestehender Funktionen eingespielt.

Portal-Version `62ddfd3a-f074-401e-a3d3-ac40b661fabe` erhält 100 % Traffic. Isolierter Produktionsbuild inklusive TypeScript erfolgreich; alle 337 Laufzeit-/Konfigurationsdateien stimmen mit dem Workspace überein. Elf Live-Suchen einschließlich Teilbegriffen, Schreibweisen, Beschreibungsbegriff, Geschenkkarten, Sonderzeichen und fehlendem Treffer liefern exakt die anhand des vorhandenen öffentlichen Katalogs erwarteten Ergebnisse. Der ungefilterte Katalog einschließlich Reihenfolge, Produktinhalten, Preisen und Geschenkwerten bleibt identisch.

Die ausgelieferten Such-, Produkt-, Rechts-/Footer- und Stripe-Verwaltungsdateien wurden anhand SHA-256 mit dem Build verglichen. Rechtliche Seiten/Weiterleitungen und bestehender anonymer Admin-API-Zugriffsschutz funktionieren weiterhin. Bestehende Produkt-/Kauffunktionen, Versandfreigaben, Cloudflare-Bindings und Jobs-Runner sind unverändert. Die lokale Suchvorschau ist produktiv nicht erreichbar. Keine Käufe oder Mails ausgelöst.

Private Build-, Migrations-, Deployment- und Prüfnachweise: `output/shop-search-release/`.
