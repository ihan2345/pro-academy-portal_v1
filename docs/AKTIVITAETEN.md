# Aktivitäten

Verwaltung → Aktivitäten ist für Admins und Mitarbeiter/Coaches lesbar. Eltern haben keinen Zugriff. Der Menü-Badge zählt offene Vorgänge mit Handlungsbedarf, unabhängig vom Alter. Die Übersicht zeigt zusätzlich die letzten drei von Stripe empfangenen Originalereignisse (z. B. neue Abos, bezahlte Rechnungen, Kündigungen). Als Quelle dient ausschließlich `stripe_webhook_events`; lokale Audit-Einträge werden nicht in diese Box übernommen. Die Anzeige ergänzt nur den aktuellen Zuordnungsstatus des betreffenden Abos. Ein Button lädt die letzten sieben Tage mit weiterer Paginierung. Ein rotes Achtung-Icon kennzeichnet für Admins erforderliche Aktionen.

„Heute“ umfasst die letzten 24 Stunden und ist geöffnet. Die beiden weiteren Abschnitte umfassen 24–48 und 48–72 Stunden; sie laden beim ersten Öffnen. „Alle Aktivitäten“ öffnet eine eigene Seite mit Datumsgruppen (Europe/Berlin). Je Abruf werden maximal 50 Einträge geladen. Ein stabiler Zeit-/ID-Cursor ermöglicht weiteres Nachladen ohne serverseitigen Sitzungsspeicher.

Offene Probleme bleiben unabhängig von ihrem Alter sichtbar. Nur Admins erhalten die Kennzeichnung „Problem: Aktion erforderlich!“ und die konkrete Hilfsanleitung. Der Info-Button unterstützt Mouseover, Tippen und Tastatur. Mitarbeiter erhalten auch über die API keine Handlungsanleitungen. Der Bereich selbst verändert keine Daten.

Migration `supabase/release/012-human-activities.sql` muss vor dem Portal-Deployment eingespielt werden. Die ausschließlich für den Service zugängliche Datenbankansicht übersetzt bestehende Audit-Einträge und fehlgeschlagene Hintergrundläufe. Selektive Trigger ergänzen künftig Mail- und Stripe-Verarbeitungsstatus; bestehende Mail-Endzustände und Stripe-Fehler werden einmalig übernommen. Technische Aktualisierungen ohne fachliche Änderung werden ausgefiltert, zusammengehörige Jahreskontingente gebündelt. Die Historie reicht so weit wie die vorhandenen Protokolle; fehlende historische Ereignisse werden nicht erfunden.

Rohfehler, Webhook-Inhalte, Mailadressen, Nachrichtentexte und Zahlungsbeträge gehören nicht zur Aktivitäten-API. Der aktuelle Zustand des zugrunde liegenden Vorgangs entscheidet, ob ein Problem noch offen ist.

Prüfung: `npm test`, `node scripts/test-activities-ui.mjs`, Produktionsbuild. Die Aktivitäten-Tests prüfen zusätzlich SQL-Migration, rollenabhängige Antworten, Zeitgrenzen und Cursor-Paginierung.
