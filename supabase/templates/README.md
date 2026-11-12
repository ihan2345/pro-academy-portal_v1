# Deutsche Supabase-Auth-Mails

Am 14.10.2026 im produktiven Supabase-Projekt `vgxaatawsbzgsmqiaepj` über die Management API aktiviert und durch erneuten Konfigurationsabruf geprüft.

| Mail | Betreff | Inhalt |
| --- | --- | --- |
| Anmeldung (Code und Magic Link) | Dein Anmeldecode für ProAcademy | `magic-link.html` |
| Erste Registrierung | Bestätige deine E-Mail-Adresse für ProAcademy | `confirmation.html` |

Die Dateien dokumentieren die Vorlagen. Ein Portal-Deployment lädt sie nicht automatisch in Supabase. Änderungen müssen gezielt in den Supabase-E-Mail-Vorlagen oder über `/v1/projects/{project_ref}/config/auth` veröffentlicht werden.

Stand 15.10.2026: `magic-link.html` wurde um einen hervorgehobenen Hinweis zum selben Browser und Gerät, ein Chrome/Safari-Beispiel und eine Kopieranleitung ergänzt. Die Vorlage wurde im produktiven Supabase-Dashboard gespeichert und nach vollständigem Neuladen in der Vorschau überprüft. Kein App-Deployment und kein Testversand wurden ausgelöst. Ein JavaScript-Kopierbutton wird wegen fehlender zuverlässiger Unterstützung in Mailprogrammen nicht verwendet.

Der vorhandene Platzhalter `{{ .ConfirmationURL }}` bleibt erhalten. Das Logo verwendet die aktive Portal-Subdomain. Tokenlaufzeit, Weiterleitungen und SMTP-Einstellungen werden durch diese Übersetzung nicht geändert. Kein Testversand wurde ausgelöst.

[Supabase-Dokumentation zu E-Mail-Vorlagen](https://supabase.com/docs/guides/auth/auth-email-templates)

Stand 13.11.2026: Die Anmeldung verwendet einen sechsstelligen E-Mail-Code als Hauptmethode. Beide Vorlagen enthalten `{{ .Token }}` und weiterhin `{{ .ConfirmationURL }}`. Die Vorlagen wurden im bestehenden Projekt im Supabase-Dashboard gespeichert und nach Neuladen geprüft. SMTP, erlaubte Weiterleitungen und Tokenlaufzeit bleiben unverändert. Code und Link verbrauchen denselben einmaligen Auth-Token.

`POST /api/auth/verify` prüft den Code mit dem Supabase-Session-Client (`type: "email"`) und setzt dessen Session-Cookies. Link und Code verwenden denselben Abschluss für Einladungen, Gastkäufe und sichere interne Weiterleitungen. Origin-Prüfung, Testkonto-Einschränkungen und lokale Schreibsperre bleiben aktiv. Die Code-Prüfung nutzt zusätzlich getrennte, gehashte Konto- und IP-Limits über das vorhandene Cloudflare-Limit (20 Anfragen pro Minute). Fehlende Limit-Konfiguration wird abgewiesen.

Prüfungen: `npm test`, `npm run typecheck`, `node scripts/test-login-ui.mjs` (isolierte Handy-/Desktop-Prüfung ohne Versand), `node scripts/test-login-auth.mjs` (echte lokale Supabase-Prüfung, benötigt den bestehenden Produkt-Teststack auf Port 57321, kein Versand). Der lokale Auth-Test prüft Session-Cookies und die gegenseitige Entwertung von Code und Link. Keine Benutzerkonten aus der Produktion werden für diese Prüfungen angemeldet oder verändert.
