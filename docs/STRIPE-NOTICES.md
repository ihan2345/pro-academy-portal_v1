# Stripe-Meldungen: Filter und Bearbeitungsstand

Lokal umgesetzt auf `codex/stripe-notice-workflow`. Diese Erweiterung ist noch nicht veröffentlicht; der veröffentlichte Stand ist in [STRIPE-CONFLICTS-RELEASE.md](STRIPE-CONFLICTS-RELEASE.md) dokumentiert.

Beide Bereiche in der Admin-Übersicht starten geschlossen mit dem Filter **Letzte 30 Tage**. **Gesamt** zeigt zusätzlich ältere Einträge. Pro Seite erscheinen zehn Meldungen; nummerierte Seiten, Zurück und Weiter befinden sich innerhalb des jeweiligen Bereichs. Der Badge zählt immer nur offene Aktionen der letzten 30 Tage, unabhängig vom Filter und der geöffneten Seite. Im Aktivitätenverlauf zählt jede eigenständige handlungsbedürftige Stripe-Meldung einmal. Reine Informationen zählen nicht.

Für Zahlungsfälle bestimmen aktuelle offene Rechnungen, tatsächliche Zahlungsfehler und relevante Abo-Statuswechsel das Meldungsdatum. Normale Metadatenänderungen setzen das Datum nicht zurück. Zuordnungen verwenden das Erstellungsdatum der Prüfung, Aktivitäten das originale Stripe-Ereignisdatum. **Gesamt** bei Konflikten umfasst die aktuell noch bestehenden Fälle aller Altersgruppen; erledigte Zahlungen werden weiterhin anhand des aktuellen Stripe-Zustands erkannt und verschwinden aus der Konfliktliste. Der Ereignisverlauf bleibt unter Aktivitäten verfügbar.

**Erledigt** und **Ignorieren** speichern den Bearbeitungsstand für alle Admins. Eine offene Meldung der letzten 30 Tage fällt nach erfolgreichem Speichern aus dem Badge; ältere Meldungen verändern ihn nicht. **Wieder öffnen** macht die Markierung rückgängig. Einträge bleiben sichtbar, solange ihre Quelle im jeweiligen Verlauf enthalten ist. Die Markierung bestätigt keine Zahlung, entsperrt kein Abo, verarbeitet keine Webhooks erneut und ersetzt keine Kinderzuordnung. Die bisherige Zuordnungsprüfung öffnet weiterhin den bestehenden fachlichen Dialog für das gewählte Abo.

Die Entscheidung gilt für den konkreten Stand eines Falls. Ein neuer Rechnungssatz, ein anderer offener Betrag oder Abo-Status sowie eine geänderte Zuordnungsprüfung werden wieder offen angezeigt. Ein neues Stripe-Ereignis ist eine eigene Meldung. Bereits bearbeitete unveränderte Fälle bleiben auch nach Neuladen markiert. Ein erneuter Zahlungsversuch zur unveränderten offenen Rechnung erzeugt keinen zweiten Zahlungsfall.

## Speicherung und Veröffentlichung

Vor Veröffentlichung ist `supabase/release/030-stripe-notice-decisions.sql` einmalig über den bestehenden transaktionalen Supabase-Release-Ablauf anzuwenden und in der Migrationshistorie zu erfassen. Die neue, separate Tabelle speichert Meldungsart, Quellen-ID, Fingerabdruck, Status, Admin-ID und Zeitpunkt. Sie besitzt RLS; direkte Zugriffe von `anon` und `authenticated` sind gesperrt. Die API erfordert Adminrolle, gültigen Origin für Schreibzugriffe und ein auf den Quellenstand begrenztes, signiertes Meldungstoken. Es werden keine neuen Schlüssel benötigt.

Ein fehlgeschlagenes Speichern verändert weder Status noch Badge im Browser. Fehlgeschlagene Abrufe zeigen `!`. Bei nicht verfügbarem Stripe-Zahlungsabgleich bleiben Abo-Zuordnungen bearbeitbar; die unvollständige Prüfung wird kenntlich gemacht. Beim Wechsel zurück ins Browserfenster werden die Daten neu geladen, damit Entscheidungen anderer Admins sichtbar werden. Konfliktseiten und Filter arbeiten auf dem bereits geladenen Ergebnis, ohne pro Seitenwechsel einen vollständigen Stripe-Abruf auszulösen.

## Prüfung

36 gezielte Tests in vier Dateien bestanden, einschließlich der neuen isolierten SQL-/RLS-Prüfung. TypeScript, Formatierung und isolierter Next.js-Build erfolgreich. Desktop mit 1280 Pixeln und Smartphone mit 390 Pixeln geprüft: Standardfilter, zehn Einträge, nummerierte Seiten, unveränderter Badge beim Filtern, beide Markierungen, Neuladen, Rücknahme, Zuordnungsdialog, leere Ergebnisse sowie Abruf- und Speicherfehler. Keine horizontale Überbreite. Der zusätzliche nur lesende Live-Abgleich der Zahlungsdaten ist erfolgreich; die produktive Datenbank wurde nicht verändert. Private Vorschau und Nachweise liegen unter `output/stripe-notices/`.
