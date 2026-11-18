# Mail-Vorschau Design 2026

Vorschau aller 28 Portal-Mails im Design 2026 (dunkle Hero-Karte, Lime + Violett, weiche Karten). **Reine Vorschau:** Kein Versandweg nutzt das neue Layout, es wird nichts verschickt und keine Freigabe geändert.

- `index.html` öffnen = Übersicht, jede Mail als eigene HTML-Datei (Beispieldaten).
- Layout: `src/lib/mail-2026/render.ts` (Tabellen + Inline-Styles, Handy-Media-Query, Fallbackfarben für Outlook).
- Neu erzeugen: `npx tsx scripts/mail-preview-2026.ts`
- Supabase-Vorlagen zum Einfügen: `supabase/templates/design-2026/` (siehe README dort).

Umstellung später: `htmlEmail` (src/lib/mail.ts) und `trialEmailDesign` (src/lib/trials/mail-design.ts) auf `renderMail2026` umbauen. Das ist bewusst nicht Teil dieser Vorschau.
