# Mail-Vorschau Design 2026

Vorschau aller 28 Portal-Mails im Design 2026 (dunkle Hero-Karte, Lime + Violett, weiche Karten). **Reine Vorschau:** Kein Versandweg nutzt das neue Layout, es wird nichts verschickt und keine Freigabe geändert.

- `index.html` öffnen = Übersicht, jede Mail als eigene HTML-Datei (Beispieldaten).
- Layout: `src/lib/mail-2026/render.ts` (Tabellen + Inline-Styles, Handy-Media-Query, Fallbackfarben für Outlook).
- Neu erzeugen: `npx tsx scripts/mail-preview-2026.ts`
- Supabase-Vorlagen zum Einfügen: `supabase/templates/design-2026/` (siehe README dort).

Umstellung später: `htmlEmail` (src/lib/mail.ts) und `trialEmailDesign` (src/lib/trials/mail-design.ts) auf `renderMail2026` umbauen. Das ist bewusst nicht Teil dieser Vorschau.

## Anrede und Kalender (Stand 18.11.2026)

- Jede Mail beginnt mit „Hallo <Vorname>,“. Für die Live-Umstellung muss der Versand den Vornamen des Elternteils laden (Camp-, Training-, Bericht- und Stempelkarten-Mails tun das heute noch nicht). Supabase-Vorlagen nutzen `{{ .Data.first_name }}` mit Rückfall auf „Hallo,“; dafür muss `first_name` in den Benutzer-Metadaten stehen.
- Termin-Mails (Training geplant/Erinnerung/geändert, Camp-Buchung/-Erinnerungen, Probetraining geplant/Erinnerung) haben „In Kalender eintragen“: Apple (iPhone & Mac), Google (Android & Web), Outlook und .ics-Datei, jeweils mit Erinnerung 1 Tag und 2 Stunden vorher. Logik: `src/lib/mail-2026/calendar.ts`, Icons: `public/mail/kalender-*.png`, Beispiel-Dateien: `kalender/*.ics`.
- Live braucht der Apple-/.ics-Button einen signierten Download-Link im Portal (in der Vorschau liegt die Datei neben der Mail); zusätzlich sollte die .ics als Anhang mitgehen.
