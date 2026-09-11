# ProAcademy | Supabase

Stand: 10.09.2026.

[PDF öffnen](01-Supabase.pdf)

## 1. Die Datenzentrale verstehen

**ÜBERBLICK FÜR ALLE**

Supabase speichert die Daten des Portals und übernimmt die Anmeldung. Hier lässt sich technisch prüfen, ob ein Konto, eine Zuordnung oder ein Auftrag vorhanden ist.

[ProAcademy-Projekt im Dashboard öffnen](https://supabase.com/dashboard/project/vgxaatawsbzgsmqiaepj)

> **Das richtige Projekt:** vgxaatawsbzgsmqiaepj. Auch wenn der Anzeigename noch „test“ enthält: Dies ist die Datenbank für den späteren Launch. Sie ist kein löschbares Übungsprojekt.

| Bereich | Wofür er gebraucht wird |
| --- | --- |
| Authentication / Users | Anmeldekonten und Login-Probleme prüfen. |
| Table Editor | Gespeicherte Datensätze ansehen. |
| SQL Editor | Gezielte technische Abfragen ausführen. |
| Storage / reports | Privat gespeicherte PDF-Berichte. |
| Database / Backups | Verfügbare Sicherungen kontrollieren. |

**Mitarbeiter und Coaches:** Kinder, Termine und Stempelkarten über das Portal bearbeiten. Direkte Änderungen in Tabellen können Prüfungen und Mailabläufe umgehen.

## 2. Anmeldung, Rolle und Kind

**ADMINISTRATION**

### Drei verschiedene Dinge

| Baustein | Bedeutung |
| --- | --- |
| Anmeldekonto | Die E-Mail-Adresse ist in Supabase Auth bekannt. |
| Portalrolle | profiles legt parent, staff oder admin fest. Für Coaches ist außerdem ein aktives Mitarbeiterprofil nötig. |
| Kindzuordnung | parent_players verbindet ein Elternprofil mit den erlaubten Kindern. |

1. **Kein Login möglich:** Im Portal die richtige E-Mail-Adresse prüfen. Bei einer neuen Einladung den vorgesehenen Einladungsablauf benutzen; ein Auth-Konto allein erstellt keine vollständige Elternzuordnung.

2. **Falscher Bereich sichtbar:** Die Administration prüft Rolle und Mitarbeiterstatus. Eltern-, Coach- und Admin-Konten nicht durch bloßes Austauschen ihrer E-Mail-Adressen vermischen.

3. **Kind fehlt:** Elternprofil und Kindverknüpfung prüfen lassen. Das Kind muss dafür nicht gelöscht oder neu angelegt werden.

> **Braucht das ein Deployment?** Änderungen an vorhandenen Daten und Rollen normalerweise nicht. Eine Änderung an Programmcode oder der derzeitigen Login-Testfreigabe in der Cloud-Konfiguration muss gesondert veröffentlicht werden.

Login-Rückleitungen müssen zur verwendeten Portaladresse passen. Supabase erlaubt nur konfigurierte Rückleitungsziele; für den Cloudbetrieb ist der Callback unter der Worker-Adresse maßgeblich.

Quelle / Grundlage: [Supabase: Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

## 3. Termine, Mails und Berichte finden

**ADMINISTRATION**

| Tabelle / Bereich | Was dort steht |
| --- | --- |
| players / parents | Kinder und Elternkontakte. |
| training_events | Termin, Zeit, Standort und Trainer. |
| event_participants | Teilnahme und Zuordnung zum Leistungszeitraum. |
| entitlement_periods | Gespeicherte Zeiträume und Einheiten. |
| notification_jobs | Noch zu bearbeitende und bearbeitete Mailaufträge. |
| notification_deliveries | Versuch, Anbieter und Ergebnis einer Mailübergabe. |
| report_snapshots / report_files | Berichtsinhalt, Version und private PDF-Datei. |

### Mailstatus richtig lesen

**pending:** wartet. **processing:** wird bearbeitet. **sent:** Verarbeitung meldet Erfolg; zusätzlich Anbieter und tatsächlichen Empfang prüfen. **failed:** Fehler. **uncertain:** Versand unklar, vor einem neuen Versuch manuell klären.

> Im aktuellen Betrieb sind automatische Jobs gesperrt und der Mailanbieter steht auf capture. Ein gespeicherter Auftrag oder ein Capture-Ergebnis beweist keinen Eingang im Postfach.

PDF-Berichte bleiben als Version erhalten. Korrekturen erfolgen über den vorgesehenen Portalprozess. Historische Dateien und Protokolle nicht überschreiben. Downloadlinks zu privaten PDFs sind zeitlich begrenzt.

## 4. Einfache Prüfungen und Sicherung

**ADMINISTRATION**

**Nur für berechtigte Administration:** Projekt öffnen, SQL Editor wählen und die folgende Abfrage ausführen. Sie zählt Aufträge und verändert keine Daten.

```sql
select status, count(*) as anzahl
from public.notification_jobs
group by status
order by status;
```

Dasselbe Prinzip zeigt, welche Stripe-Nachrichten noch auf Verarbeitung warten:

```sql
select status, count(*) as anzahl
from public.stripe_webhook_events
group by status
order by status;
```

> **Backup:** Unter Database / Backups Datum und verfügbaren Wiederherstellungszeitraum prüfen. Ob und wie lange Sicherungen verfügbar sind, hängt vom eingerichteten Tarif ab. Das wurde durch dieses Handbuch nicht erneut live geprüft.

Eine Datenbanksicherung enthält keine eigentlichen Storage-Dateien. Die privaten PDFs brauchen eine zusätzliche Dateisicherung. Eine Wiederherstellung gehört in die Hände der technischen Administration.

Quelle / Grundlage: [Supabase: Database Backups](https://supabase.com/docs/guides/platform/backups)

- [ ] Richtiges Projekt, Konto, Rolle und Kindzuordnung geprüft.

- [ ] Mailauftrag und tatsächlichen Empfang getrennt bewertet.

- [ ] Datenbank- und PDF-Sicherung einschließlich Wiederherstellung eingeplant.

Quelle / Grundlage: Projektgrundlage: supabase/migrations, src/lib/server/auth-test-access.ts und docs/ARCHITECTURE.md.
