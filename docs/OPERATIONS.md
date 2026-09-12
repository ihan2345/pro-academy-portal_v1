# Betrieb und Wiederanlauf

## Vertrauensgrenzen

Browser verwendet ausschließlich Session/Anon-Konfiguration. Supabase-RLS ist die letzte Schranke. Next-APIs autorisieren nochmals. Service Role wird für Stripe, Einladungs-Erzeugung, PDF-Verarbeitung und Jobs gebraucht; alle Admin-Aufrufe prüfen zuerst die echte Sessionrolle. Ein Demo-Modus existiert nicht. Ohne eingerichtete Anmeldung und Datenbank werden keine Portaldaten angezeigt.

## Jobs und Fehler

`job_runs` protokolliert jede Ausführung. `stripe_webhook_events` ist eine Inbox mit eindeutiger Stripe Event ID. Ein fehlgeschlagener API-Abruf erhält Backoff; nach sechs Versuchen bleibt der Eintrag failed zur Prüfung. Abgelaufene Verarbeitungssperren werden erneut beansprucht. `apply_stripe` serialisiert Updates je Abonnement; der neuere Abrufzeitpunkt schützt gegen verspätet eintreffende Ergebnisse. `invoice.paid` importiert auch alte Stripe-Line-Perioden ohne deren historischen Anspruch zu überschreiben.

`notification_jobs` reserviert kleine Batches atomar, mit eigener Lease-ID. Ein normaler Fehler vor Sendebeginn wird maximal fünfmal automatisch wiederholt. Verbindungsfehler während DATA bzw. ein abgestürzter SMTP-Lease werden uncertain. Niemals blind neu auf pending setzen: zuerst Proton-Versandprotokoll und Empfänger kontrollieren. Die Admin-RPC `retry_notification(job, checked_not_delivered, retry_reason)` erfordert explizite Bestätigung und einen Audit-Grund. `notification_deliveries` bleibt unverändert. Ein bereits gesendeter Bericht wird bewusst über `resend_report` mit neuem Request-ID-Schlüssel erneut versandt.

Automatische Teilnahme ist ein einziges bedingtes SQL-Update (`planned`, Termin nicht storniert, Frist erreicht); Outbox und Audit entstehen in derselben Transaktion. Gleichzeitige Korrekturen werden durch Zeilensperren serialisiert. Ein verspäteter Job verarbeitet sämtliche fälligen Teilnahmen.

Berichts-Snapshot wird innerhalb einer Transaktion unter Sperre des Leistungszeitraums erfasst. Version 1 ist eindeutig. Datei-Upload ist create-only, nie overwrite. Abgebrochene Upload-/Registrierungsprozesse werden erneut aufgenommen. Ein neuer Bericht wird nur durch ausdrückliche Versionierung erzeugt. Dateiname enthält Kind, Zeitraum und Version/UUID. Signed Download URLs laufen nach 60 Sekunden ab.

## Überwachung vor Livebetrieb

Alerts für ausbleibende Cron-Aufrufe (>20 Minuten), failed/uncertain Jobs, ungewöhnliche Login-Versuche und fehlende PDF-Dateien konfigurieren. Bei längerer Unterbrechung zuerst Stripe-Synchronisierung kontrollieren; danach Job erneut laufen lassen. Keine Zähler manuell erhöhen: Einheiten werden immer aus Teilnahmen berechnet.

## Testdaten

Seed-Datei enthält nur Tarifkatalog und Standort. Fiktive Datensätze existieren ausschließlich als Testfixtures unter tests/; die Anwendung lädt sie nie. DB-Integrationstests erzeugen isolierte UUIDs und `.invalid`-Adressen in einem temporären PGlite-Prozess. Reale Testkonten erst über Supabase/Stripe im eigenen Testprojekt anlegen. Entwicklungsartefakte, Testreports und Capture-E-Mails liegen in ignorierten Ordnern.

## Sicherheits- und Betriebsänderungen

RLS-Regeln niemals durch pauschale permissive Policies ergänzen. Supabase-Systemtabellen und `service_role` müssen in externen Tests unter echten JWTs geprüft werden. Datensicherungen/PITR für die spätere Produktivumgebung aktivieren. Lösch- und Aufbewahrungsregeln für Kinder, Audit und Berichte organisatorisch festlegen, bevor echte Daten aufgenommen werden. Konten-/Schlüsselrotation separat zwischen Test und Produktion durchführen.
