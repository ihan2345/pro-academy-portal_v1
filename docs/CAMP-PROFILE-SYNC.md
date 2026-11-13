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

## Weiteres Kind für angemeldete Eltern

„Kind auswählen“ enthält neben den aktiven zugeordneten Kindern die Auswahl „Neues Kind angeben“, sowohl im direkten Campformular als auch im Shop. Im direkten Formular öffnet sie die Eingabe von Namen und Geburtsdatum; Geschlecht und Kleidergröße werden ebenfalls erfasst. Das neue Kind bekommt keinen Rabatt aus einem anderen Kinderprofil. Beim Zurückwechseln zu einem vorhandenen Kind werden dessen gespeicherte Angaben wieder eingesetzt.

Release 046 speichert beim direkten Checkout die serverseitig geprüfte Elternidentität als `new_child_auth_id` am Buchungsauftrag. Ein neuer Spieler samt Familienverknüpfung entsteht erst nach bestätigter Zahlung. Die Datenbank prüft die aktuelle Elternzuordnung nochmals; eine geänderte Zuordnung oder ein inzwischen vorhandenes gleiches Kind führt zur Prüfung. Bereits erkennbare Duplikate werden vor Checkout abgewiesen. Eine neue Kindangabe erfordert einen individuellen, an diese Buchung gebundenen Checkout. Wiederholte Zahlungsereignisse erzeugen keine weiteren Kinder. Vorhandene Gast-, Profil- und Versandregeln bleiben bestehen.

Geprüft mit 1.276 Tests und Browserprüfungen auf 390/1.440 Pixeln, einschließlich Formularwechsel, neuer Kindangaben, Familienbindung, Duplikaten und verzögerter Zahlungsbestätigung.
