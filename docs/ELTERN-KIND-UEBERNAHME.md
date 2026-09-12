# Eltern-Kind-Übernahme: intern online

Stand 12.09.2026, Branch `Eltern-Kind`. Nach ausdrücklicher Freigabe des Nutzers sind 84 Familien mit 91 Kindern und 91 Abo-Zuordnungen in der bestehenden Online-Datenbank übernommen. Die neuen Familien sind ausschließlich für Admins und berechtigte Mitarbeiter sichtbar. Alle neuen `parents.auth_user_id` bleiben leer. Es wurden keine Auth-Benutzer, nutzbaren Einladungslinks oder Einladungsablaufdaten erstellt und keine E-Mails gesendet. Vorher vorhandene Datensätze wurden erhalten.

## Anwendung

Der Demo-Modus wurde aus dem Anwendungscode entfernt: keine fiktiven Portal-Daten, Demo-Umschalter, Browser-Datenspeicherung als Datenbankersatz, Demo-PDFs oder frei wechselnden Demo-Rollen. Ohne echte Anmeldung werden keine Portaldaten angezeigt. Automatisierte Tests besitzen eigene Fixtures unter `tests/fixtures`; diese werden von der Anwendung nicht geladen. Die frühere temporäre Demokopie wurde gelöscht. Der lokale Test läuft weiterhin mit einer getrennten Supabase-Datenbank und echten lokalen Anmeldungen.

Ein Elternkonto kann mehrere Stripe-Kunden-IDs führen. Die automatische Auswahl verlangt denselben normalisierten Namen und dieselbe Kontakt-E-Mail. Abweichende Schreibweisen werden nur bei expliziter Einzelbestätigung zusammengeführt. Die primäre Stripe-ID bleibt für bestehende Abläufe erhalten; die Verwaltung zeigt alle verknüpften IDs.

Geburtsjahre sind optional. Leere Werte werden `null`; aus dem Alter wird kein Jahr abgeleitet. Das Elternportal zeigt und lädt keine Geburtsjahre.

## Bestätigte Sonderfälle

- Menzur Turhal: ein FirstTouch-Paket mit vier Fußball-Einheiten. Die Stripe-Menge 2 bleibt unverändert und ist in den übernommenen Quelldaten erhalten. Das Abo ist für die spätere Mengenprüfung markiert. Keine Änderung der Stripe-Abrechnung.
- Sevgi Karalioglu / Karalıoğlu: ausdrücklich dieselbe Person. Beide Kinder und Stripe-Kundenkonten sind unter „Sevgi Karalıoğlu“ zusammengeführt.

## Versand und spätere Elternfreigabe

Pro neuer Familie existiert genau ein Auftrag mit `notification_jobs.status=held`, insgesamt 84. Seine Nutzlast enthält nur Eltern-ID und Name; keinen Link und keinen Token. `parents.notifications_held=true` hält neue und bereits wartende Nachrichten an die Kontaktadresse zurück. Der Versanddienst überspringt zurückgehaltene Aufträge. Der Wiederholen-Button kann `held` nicht freigeben.

Der Hintergrunddienst bleibt zusätzlich vollständig gesperrt: `JOBS_ENABLED=false`, `ACCEPTANCE_TEST_ENABLED=false`, `MAIL_PROVIDER=capture`, `EMAIL_TEST_MODE=true`. Es wurde kein Joblauf ausgelöst. Damit sind auch automatische Stripe-Abgleiche und automatische Berichte noch nicht aktiviert. Die Listen verwenden den beim Import erneut geprüften Stripe-Stand.

Eine spätere Freigabe der Elternkonten und des Versands benötigt einen gesonderten Auftrag. Vorher müssen Ablauf, Empfänger und Aktualität der vorgemerkten Nachrichten geprüft werden. Erst dann dürfen frische Einladungslinks erzeugt werden. Alte Trainingshinweise und zurückgehaltene Einladungen nicht pauschal auf `pending` setzen. Die normale persönliche Admin-Anmeldung bleibt ein separater, vom Nutzer ausgelöster Vorgang; für diese Veröffentlichung wurde keine Anmeldemail angefordert.

## Veröffentlichung und Import

Migration `202609120009_family_accounts.sql` wurde nach Prüfung auf laufende Versandaufträge als Transaktion in der bestehenden Supabase-Datenbank angewendet. Portal und Hintergrunddienst wurden auf der bestehenden Cloudflare-Adresse aktualisiert. Keine offizielle Domain oder neue Hosting-Plattform eingerichtet.

`scripts/import-internal-families.mjs` prüft vor dem Schreiben alle Zuordnungen anhand der aktuell aktiven Stripe-Abos, exakter Kunden-/Abo-/Positions-/Preis-IDs, bekannter Tarifkontingente und der bestätigten Ausnahmen. Bestehende fremde Zuordnungen oder Auth-Verknüpfungen stoppen den Import. Der explizite Schalter `--apply-internal` schreibt nur Familien-, Kinder- und Abo-Daten mit gesperrten Einladungsvormerkungen. Die Kundenkonten bei Stripe bleiben unverändert.

Die privaten Ausgangssicherungen, Vorprüfung, Import-IDs und Abschlussprüfungen liegen im ignorierten Ordner `output/eltern-kind-online/`. Nicht veröffentlichen. Eine erneute Ausführung nutzt die aufgezeichneten IDs; sie dient nicht zur allgemeinen Synchronisierung oder zur Übernahme lokaler Teständerungen.

## Verifikation

- 157 automatisierte Tests und 14 Browserprüfungen auf Desktop/Mobil erfolgreich.
- TypeScript, Runner-Build und Cloudflare-Produktionsbuild erfolgreich.
- Öffentliche Assets: keine Dienstgeheimnisse, Demo-Daten oder lokale Kontowechsel-Routen.
- Import: 84 Familien, 91 Kinder, 91 Stripe-Kundenverknüpfungen, 91 Kind-Zuordnungen und passende Tarifkontingente; keine neuen Eltern-Auth-Verknüpfungen oder nutzbaren Einladungen; alle 84 Einladungsvormerkungen `held`.
- Online-RLS unter echten Datenbankrollen: Admin und Mitarbeiter sehen jeweils die 91 importierten Kinder; ein bestehender Elternzugang sieht keines davon. Anonymer direkter Datenbankzugriff liefert keine Kinder.
- Portal ohne Anmeldung: Login 200, Verwaltung zur Anmeldung umgeleitet, Admin-API 401. Im Browser war keine aktive Admin-Sitzung vorhanden; es wurde keine Login-Mail angefordert.

Portal-Version: `588cdefa-c2b7-4870-ba8b-299a37655daf`. Hintergrunddienst: `3dbec021-0dd0-4741-b074-3d54dfa3f615`.
