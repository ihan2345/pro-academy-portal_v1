# Deutsche Supabase-Auth-Mails

Am 14.10.2026 im produktiven Supabase-Projekt `vgxaatawsbzgsmqiaepj` über die Management API aktiviert und durch erneuten Konfigurationsabruf geprüft.

| Mail | Betreff | Inhalt |
| --- | --- | --- |
| Anmeldung (Magic Link) | Dein Anmeldelink für ProAcademy | `magic-link.html` |
| Erste Registrierung | Bestätige deine E-Mail-Adresse für ProAcademy | `confirmation.html` |

Die Dateien dokumentieren die aktiven Vorlagen. Ein Portal-Deployment lädt sie nicht automatisch in Supabase. Änderungen müssen gezielt in den Supabase-E-Mail-Vorlagen oder über `/v1/projects/{project_ref}/config/auth` veröffentlicht werden.

Der vorhandene Platzhalter `{{ .ConfirmationURL }}` bleibt erhalten. Das Logo verwendet die aktive Portal-Subdomain. Tokenlaufzeit, Weiterleitungen und SMTP-Einstellungen werden durch diese Übersetzung nicht geändert. Kein Testversand wurde ausgelöst.

[Supabase-Dokumentation zu E-Mail-Vorlagen](https://supabase.com/docs/guides/auth/auth-email-templates)
