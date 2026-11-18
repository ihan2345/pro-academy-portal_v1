# Mail-Vorschau Design 2026

Vorschau aller 28 Portal-Mails im Design 2026 (dunkle Hero-Karte, Lime + Violett, weiche Karten). Seit 18.11.2026 nutzen alle Versandwege dieses Layout (`htmlEmail`, `trialEmailDesign`). Versand-Freigaben bleiben unverändert.

- `index.html` öffnen = Übersicht, jede Mail als eigene HTML-Datei (Beispieldaten).
- Layout: `src/lib/mail-2026/render.ts` (Tabellen + Inline-Styles, Handy-Media-Query, Fallbackfarben für Outlook).
- Neu erzeugen: `npx tsx scripts/mail-preview-2026.ts`
- Supabase-Vorlagen: `supabase/templates/magic-link.html` und `confirmation.html` (siehe README dort).


## Anrede und Kalender (Stand 18.11.2026)

- Jede Mail beginnt mit „Hallo <Vorname>,“ (Vorname aus `parents.full_name`, Camp-Buchungsdaten, Probetraining-Familie oder Gastkauf). Supabase-Vorlagen nutzen `{{ .Data.first_name }}` mit Rückfall auf „Hallo,“; dafür muss `first_name` in den Benutzer-Metadaten stehen.
- Termin-Mails (Training geplant/Erinnerung/geändert, Camp-Buchung/-Erinnerungen, Probetraining geplant/Erinnerung) haben „In Kalender eintragen“: Apple (iPhone & Mac), Google (Android & Web), Outlook und .ics-Datei, jeweils mit Erinnerung 1 Tag und 2 Stunden vorher. Logik: `src/lib/mail-2026/calendar.ts`, Icons: `public/mail/kalender-*.png`, Beispiel-Dateien: `kalender/*.ics`.
- Live: Apple/.ics-Button zeigt auf `/api/public/kalender/<signierter Token>` (HMAC, `ICS_LINK_SECRET` oder abgeleitet aus dem Service-Role-Key, 60 Tage nach Termin gültig); die .ics geht zusätzlich als Anhang mit.
