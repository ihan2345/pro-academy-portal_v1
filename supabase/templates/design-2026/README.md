# Supabase-Auth-Mails im Design 2026 (Entwurf)

Noch **nicht** live. Die aktiven Vorlagen bleiben `../magic-link.html` und `../confirmation.html`, bis sie im Supabase-Dashboard ersetzt werden.

| Dashboard (Authentication › Email Templates) | Datei | Betreff (unverändert) |
| --- | --- | --- |
| Magic Link | `magic-link.html` | Dein Anmeldecode für ProAcademy |
| Confirm signup | `confirmation.html` | Bestätige deine E-Mail-Adresse für ProAcademy |

Platzhalter `{{ .Token }}` und `{{ .ConfirmationURL }}` sind enthalten. Nach dem Einfügen im Dashboard die Dateien nach `../` kopieren, damit die Repo-Kopien wieder dem Live-Stand entsprechen. Erzeugt von `scripts/mail-preview-2026.ts`.
