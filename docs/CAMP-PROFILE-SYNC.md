# Profilübernahme aus Campbuchungen

Bestätigte Portal-Campbuchungen übernehmen die tatsächlich angegebenen gemeinsamen Profilfelder. Neue Familien und Kinder entstehen weiterhin ausschließlich durch den bestehenden geprüften Buchungs-/Zahlungsablauf und bleiben über `parent_players` verknüpft. Die Ergänzung erstellt keine zweite Kinderidentität und vergibt keine Abo-Rechte.

| Campangabe                      | Profil                                                            |
| ------------------------------- | ----------------------------------------------------------------- |
| Telefon                         | `parents.phone`                                                   |
| Geburtsdatum                    | `players.camp_birth_date`; daraus abgeleitet `players.birth_year` |
| Geschlecht                      | allgemeines `players.gender` und Camp-Feld `players.camp_gender`  |
| Kleidergröße                    | `players.camp_clothing_size`                                      |
| Vor-/Nachname bei neuen Kindern | bestehende Anlage in `players`                                    |

Bestehende Telefonnummern und Kindesangaben werden vorausgefüllt. Auch angemeldete Eltern können im Shop eine Telefonnummer für das Camp bestätigen. Beim Wechsel des ausgewählten Kindes übernimmt das Formular dessen eigene Angaben. Nach bestätigter Buchung werden neue, nicht leere Angaben aktualisiert. „Keine Angabe“ löscht kein vorhandenes Geschlecht. Verein, Mannschaft, Position und weitere nicht abgefragte Felder bleiben erhalten.

Die private Datenbankfunktion `camp_sync_paid_profiles` läuft beim erstmaligen Übergang zu `paid` für Portal-/Shopbuchungen. Sie prüft die aktive Eltern-Kind-Verknüpfung, Familienadresse und Kinderidentität. Ein vorhandenes abweichendes Geburtsdatum oder Geburtsjahr wird nicht überschrieben. Ein vollständig angegebenes, passendes Geburtsdatum ergänzt ein fehlendes Geburtsjahr automatisch. Bereits nach Checkout-Beginn bearbeitete Kinderprofile und neuere Änderungen am Elternprofil werden erhalten. Wiederholte Zahlungsereignisse spielen alte Angaben nicht erneut ein. Entwürfe, Klärungsfälle und Erstattungen lösen keine Profilübernahme aus.

Die Ergänzung läuft für künftige Bestätigungen. Sie schreibt keine historischen Profile pauschal um und verändert weder Versandfreigaben noch Warteschlangen oder Importabläufe. Im Formular wird die Übernahme nach bestätigter Buchung erklärt.

Migration: `supabase/release/045-camp-profile-sync.sql`, nach Release 044. Sie ergänzt den Trigger und die Telefonangabe im Shop-Buchungssnapshot; die bisherigen Zahlungs-, Kapazitäts-, Zuordnungs- und Rabattprüfungen bleiben bestehen.

Geprüft mit 1.269 Tests, darunter 47 SQL-Integrationstests, TypeScript, Cloudflare-Build sowie Browserprüfungen auf Mobil-/Desktopbreite. Abgedeckt sind Anlage und Verknüpfung, allgemeines Geschlecht, Geburtstag/Geburtsjahr, Telefon, leere Angaben, fremde/geänderte Zuordnung, verspätete Bestätigung und wiederholte Zahlungsereignisse. Es wurden keine echten Testkäufe oder E-Mails ausgelöst.
