# Road to Elternprofile

Stand: 08.10.2026 · Branch: `Profile` · **Analyseplan mit anschließendem lokalen Umsetzungsstand**

Die Abschnitte 1–18 dokumentieren den freigegebenen Plan. Der tatsächliche lokale Umsetzungs- und Prüfstand steht in Abschnitt 19.

## 1. Ergebnis und Untersuchungsgrenze

Das Elternprofil lässt sich in die bestehende Portalarchitektur integrieren. Rollen, Familienzuordnung, Trainingsdaten, Kalender, Modal, Styling und Archivierungsfeld sind bereits vorhanden. Eine neue Eltern-/Kinderarchitektur ist nicht erforderlich.

Nicht ausreichend vorhanden sind zentrale Telefonnummer und Ort, ein Self-Service-Änderungszeitpunkt sowie eine vollständige lokale Zahlungshistorie. Nach Nutzerpräzisierung bleibt E-Mail im neuen Profil unveränderbar; ein E-Mail-Workflow entfällt. Finanzdaten sollen möglichst einfach rein lesend über die vorhandene Stripe-Anbindung geladen werden, ohne neue Zahlungsdatenbank oder Änderungen an Checkout/Workern. Abo-Monate lassen sich aus Leistungszeiträumen ableiten, benötigen aber eine ausdrücklich festgelegte Zählregel und eine Prüfung der historischen Vollständigkeit.

Diese Analyse beruht auf dem lokalen Quellcode, SQL-Migrationen, Release-/Camp-Erweiterungen und vorhandenen Tests. Es wurden **keine Live-Abfragen gegen Supabase oder Stripe** ausgeführt. Ein SQL-Skript im Repository beweist nicht, dass es auf der Zielinstanz installiert ist. Datenfüllstand, Stripe-Kontenidentität, historische Importabdeckung, tatsächlich aktive RLS/Grants müssen vor der späteren Inbetriebnahme lesend verifiziert werden. Fehlende oder ungeprüfte Daten werden nicht als null Euro, null Teilnahmen oder vollständige Historie ausgegeben.

Bereits vor dieser Analyse lagen zwei unversionierte Dateien vor: `supabase/release/006-manual-training-recipient-exception 2.sql` und `supabase/release/007-staff-training-confirmations 2.sql`. Sie bleiben unverändert und werden nicht als zusätzliche Migrationen eingeplant.

## 2. Ist-Zustand: Architektur und Navigation

- Next.js App Router, React 19, TypeScript, Tailwind 4 mit umfangreichem eigenem CSS, Supabase SSR und Stripe SDK. Keine zusätzliche UI-/Chart-/Carousel-Bibliothek notwendig.
- `src/app/[[...section]]/page.tsx` akzeptiert eine feste Routenliste und ruft `loadPortal(section)` auf. Dynamische Eltern-IDs sind darin noch nicht vorgesehen. Die Seite ist `force-dynamic`.
- `src/components/portal.tsx` enthält Portalrahmen, rollenabhängige Navigation, Elternübersicht, Konto, Terminansicht, `Badge` und den zugänglichen `Modal` mit Fokusverwaltung.
- `src/components/admin.tsx` enthält bereits Elternverwaltung unter `/admin/eltern`, Spieler-/Elternzuordnung, Suchfeld, Tabellen und Formulare. Der sichtbare Hauptnavigationseintrag heißt „Spieler & Eltern“. Die neue Profilübersicht ergänzt diese Verwaltung; Zuordnungs- und Einladungsabläufe bleiben erhalten.
- Coaches heißen technisch `staff`. Sie haben `/team` und `/team/stempelkarten`; Admins haben einen eigenen Bereich. Kein neues Rollenenum einführen.
- `src/lib/portal-access.ts` und `loadPortal()` schützen die Bereiche auf dem Server. `src/proxy.ts` erneuert Auth-Cookies, ersetzt aber keine Autorisierung.
- `sessionUser()` in `src/lib/server/supabase.ts` prüft `auth.getUser()` und ermittelt die wirksame Rolle über `current_role()`. Inaktive Mitarbeiter erhalten durch die Hardening-Migration keine wirksame Staff-Rolle.
- `src/app/api/[...path]/route.ts` bündelt APIs und prüft für Mutationen den Origin. Adminzweige verwenden `assertRole`; Supabase-Sessionzugriffe wirken zusätzlich unter RLS. `serviceDb()` umgeht RLS und ist deshalb nur nach expliziter Rollen-/Objektprüfung geeignet.
- `loadPortal()` lädt derzeit große gemeinsame Datensätze, teilweise vollständig über `readAll()`. Dieses Muster nicht unverändert auf jede Profilseite übertragen.
- Camp-only/ehemalige Abo-Eltern können von der Startseite nach `/camps` umgeleitet werden. „Mein Profil“ muss auch dort erreichbar sein; der direkte Profilaufruf darf keine aktive Subscription verlangen.

Der lokale Next-Leitfaden `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` wurde geprüft: Routenparameter werden asynchron aufgelöst. Vor späteren Änderungen zusätzlich die jeweils relevanten lokalen Leitfäden zu Server-/Client-Komponenten und Caching lesen.

## 3. Relevantes Datenmodell

Die folgenden Angaben beschreiben das Repository-Schema einschließlich ergänzender Migrationen, nicht einen verifizierten Produktionsstand.

| Quelle | Relevante Felder / Beziehungen | Verwendung und Grenzen |
| --- | --- | --- |
| `profiles` | `id → auth.users`, `full_name`, `role`, `created_at`, `updated_at` | Auth-Identität/Rolle; nicht der zentrale Familienkontakt. |
| `parents` | `id`, eindeutige `auth_user_id → profiles`, `full_name`, `contact_email`, `billing_email`, primäre `stripe_customer_id`, `archived_at`, `notifications_held`, Zeitstempel | Profilkopf und Eigentümerschaft. Telefonnummer, Ort und Self-Service-Zeitpunkt fehlen. |
| `parent_players` | `parent_id → parents`, `player_id → players` | Maßgebliche aktuelle Familienzuordnung. `202610040013_single_parent_assignment.sql` erzwingt genau höchstens einen Elternaccount pro Kind. |
| `players` | Name, optionales `birth_year`, `team`, `archived_at` | Kinderkarten/Soft-Archivierung. Geburtsjahr allein ergibt kein exaktes heutiges Alter. |
| optionale Camp-Spielerfelder | `camp_birth_date`, `camp_gender`, `camp_clothing_size`; später `camp_age_at_booking`, `camp_age_recorded_on` | Exaktes Alter nur mit Geburtsdatum; beobachtetes Alter ist datiert und darf nicht als heutiges Alter ausgegeben werden. Die `drop column`-Passagen in Camp-Dateien gehören teilweise zu Reset-Funktionen, nicht zu einer generell ausgeführten Entfernung. |
| `parent_stripe_customers` | `parent_id`, `stripe_customer_id`, `billing_email` | Ein Elternaccount kann mehrere Stripe-Kunden haben. Nicht auf `parents.stripe_customer_id` reduzieren. Der Customer ist schemaweit nicht exklusiv einem Elternaccount garantiert. |
| `subscriptions` | `parent_id`, Customer-/Subscription-ID, `status`, `billing_cycle_anchor`, `stripe_data`, `needs_review`, `synced_at` | Aktueller Abostand; `stripe_data` ist ein reduzierter Sync-Snapshot, keine vollständige Stripe-Zahlungshistorie. |
| `subscription_players` | Subscription, Stripe-Item, Spieler | Kinder-/Abozuordnung, auch bei mehreren Items. |
| `entitlement_periods` | Spieler, Subscription, Item/Price, `product_name`, `starts_at`, `ends_at`, `status`, Kontingente, Tarifgeneration | Historische Leistungsfenster, im Wesentlichen unveränderlich. Jahresabos werden durch `allowance_windows()` in Monatsfenster geteilt. Enthält keine verlässlichen Zahlungssummen. |
| `plans` | Name, Stripe-Price, `billing_interval`, Generation, Kontingente | Tarifbezeichnung und Monats-/Jahreslogik. Angebotspreis ist kein Beleg für vereinnahmtes Geld. |
| `training_events` | Start/Ende, Titel, Art, Ort, Trainer, `status`, `auto_attendance_at` | Termin und Trainingsdauer. `event_private_notes` separat. |
| `event_participants` | Event, Spieler, Leistungszeitraum, Status, später `removed_from_event` | Maßgebliche Teilnahme. Geplant, automatisch/manuell teilgenommen, abwesend, entschuldigt und abgesagt unterscheiden. |
| `training_backfills` | Spieler, Zeitraum, `occurred_on` optional, `duration_minutes`, Art, Elternnotiz | Bestätigte nachgetragene Einheiten; Erstellungsdatum ist ausdrücklich kein Trainingsdatum. Interne Notizen liegen separat. |
| `report_snapshots`, `report_files` | Versionierte Periodenberichte/PDFs | Keine zusätzliche Zählquelle: sonst doppelte Statistik und Verwechslung mit Stempelkartenabrechnung. |
| `camps`, `camp_bookings` | Camp-Tage; Parent-/Player-ID, Buchungsstatus, `attendance_status`, `attendance_confirmed_at`, `parent_data`, `child_data` | Tatsächliche Camp-Teilnahme ab `008-notifications.sql` verfügbar. Buchung/Bezahlung allein beweist keine Teilnahme. Telefonnummer kann im historischen Buchungssnapshot liegen. |
| Camp-Zahlungsfelder | `paid_amount`, `currency`, `paid_at`, Customer-/Payment-/Session-ID, `payment_details`, `booking_origin` | Teilweise lokale Zahlungsbelege; keine allgemeine Zahlungs-/Refundbuchhaltung. |
| `stripe_webhook_events` | Event-ID, Typ, Payload, Bearbeitungsstatus | Dauerhafte Inbox; vorhandene `invoice.paid`-Payloads sind mögliche Nachweise, aber kein Beweis vollständiger Historie. |
| `camp_payment_events`, `camp_review_snapshots` | Ereignisreferenzen, Prüfstände | Bestehenden Worker weiterverwenden; keine zweite Camp-Synchronisierung aufbauen. |
| `stripe_customer_registry` | Name, E-Mail, `first_seen_at` | Erstbeobachtung im Portal, ausdrücklich weder Abo- noch Stripe-Kundenbeginn. |
| `user_activity` | `user_id`, `last_seen_at` | Bereits vorhandene letzte Aktivität; RLS erlaubt Lesen nur Admins. |
| `audit_log`, `parent_invitations`, Mailtabellen | Änderungen, Einladungen, Empfänger/Versandfreigaben | Audit wiederverwenden; Auswirkungen einer E-Mail-Änderung beachten. |

Wichtige SQL-Quellen: `supabase/migrations/202609090001_portal.sql`, `202609090003_hardening.sql`, `202609090005_tariff_variants.sql`, `202609120009_family_accounts.sql`, `202609230010_training_backfills.sql`, `202609230012_team_cancellations.sql`, `202610040013_single_parent_assignment.sql`, `202610050001_user_activity.sql`; zusätzlich `supabase/release/001-onboarding-mail.sql`, `005-training-notifications.sql` und die geordneten Erweiterungen in `supabase/camp/`.

## 4. Wiederverwendung statt Doppelimplementierung

| Bestehende Implementierung | Geplante Nutzung |
| --- | --- |
| `sessionUser`, `sessionDb`, `assertRole`, `requireOrigin`, `HttpError` | Identität, Session-RLS, Rollen, Mutationen und Fehlerkonventionen. Achtung: `assertRole(role, "parent")` erzwingt derzeit keine exklusive Elternrolle; Eigentümerschaft immer explizit prüfen. |
| `canOpenPortalSection`, `portalHome` | Bestehende Rollenbereiche behalten; neue Routen darin einordnen. |
| `Portal`, `Badge`, `Modal` | Gemeinsamer Rahmen, Statusdarstellung, Bearbeiten und Archivierungsbestätigung. |
| Admin-Suchfeld, `RecordTable`, `.segmented`, `.search-input` | Bestehendes UI-Muster verwenden. Lokale Suche über `JSON.stringify()` und Komplettladen über `allAdminRows()` nicht für die neue skalierende Liste kopieren. Private Komponenten nur bei tatsächlichem Bedarf klein extrahieren. |
| `MonthCalendar` | Bestehendes Monatsraster erweitern, optional unterschiedliche Teilnahmemarkierungen anbieten; bisherige Team-Nutzung bleibt kompatibel. |
| `calendarDate`, `monthStart`, `addMonths`, `monthDays`, `formatDate`, `formatTime` | Einheitliche Tages-/Monatsgrenzen in der Portalzeitzone `Europe/Berlin`. |
| `isAttended`, `isRemovedParticipant`, `durationMinutes`, `durationLabel`, `STATUS_LABELS` | Teilnahmeauswertung und Beschriftungen; bestehende Stempelkartenstatistik nicht umdefinieren. |
| `backfillColumns`, `optionalBackfills`, `backfillEvent` | Nachträge kontrolliert integrieren. Für Datumsfilter `occurred_on` verwenden, nicht den synthetischen `starts_at` aus `backfillEvent`. |
| `useUserActivity`, `activityStatus`, `UserActivityHeartbeat` | Letzte Aktivität in der Adminliste; keine neue Trackinglogik. |
| `syncSubscription`, `syncInvoicePeriods`, `processStripeInbox`, `apply_stripe`, `import_stripe_allowance` | Abo- und Periodenquellen erhalten. Bestehenden Stripe-Client für einen separaten rein lesenden Adminabruf wiederverwenden; Verarbeitung nicht ändern. |
| `campContext`, `campSession`, Camp-Guards, bestehender Processing-Worker | Bewährte Ownership-/Betriebsmodusregeln; kleine gefilterte Profilprojektion ergänzen. `dashboard()` und `childBenefit()` nicht pro Kind unkritisch im Profil aufrufen. |
| `/api/admin/parents`, `/api/admin/players`, `adminSchemas` | Verwaltungsfunktionen erhalten; Profilabfragen und validierte Kontaktänderungen im vorhandenen API-Router ergänzen. |

Es gibt kein vorhandenes universelles Elternprofil-Hook und keine eigenständige vollständige Zahlungsübersicht. Ein neues Fetching-Framework ist nicht nötig; initiale Daten serverseitig liefern, Interaktionen mit vorhandenem API-Muster und gezieltem Refresh.

## 5. Routen und gemeinsamer Komponentenaufbau

Vorgeschlagene Routen:

- Admin: `/admin/elternprofile`, `/admin/elternprofile/[parentId]`, darunter `/einheiten`.
- Coach: `/team/elternprofile`, `/team/elternprofile/[parentId]`, darunter `/einheiten`.
- Eltern: `/profil` und `/profil/einheiten`; die Parent-ID kommt ausschließlich aus der authentifizierten Session.

Entweder gezielte dynamische Page-Dateien oder eine eng validierte Erweiterung der bestehenden Catch-all-Auflösung verwenden. Bevorzugt letztere für den vorhandenen Portalrahmen; nur diese konkreten Muster erlauben, keine beliebigen Unterpfade. UUID und Objektberechtigung werden serverseitig geprüft. Bestehende Verwaltungsrouten werden nicht umbenannt.

Admin/Coach erhalten den Navigationseintrag „Elternprofile“. Die Elternübersicht erhält „Mein Profil“ als Karte sowie einen dauerhaft erreichbaren Link; Camp-Dashboard berücksichtigt die bestehende Startseitenumleitung. Breadcrumb: „Elternprofile → Name“.

Gemeinsame Ansicht: Profilkopf → Status/Progress → Kinderkarten mit Zeitraumfilter → ausschließlich für Admin Finanzkarten → Mini-Kalender → maximal fünf Einheiten → vollständige Einheitenansicht. Der Server liefert je Rolle eine explizite Projektion und erlaubte Aktionen. Finanzdaten sind kein optional verstecktes Feld eines universell ausgelieferten Objekts.

Elternliste: serverseitige Suche nach Name/E-Mail, stabile Sortierung mit ID als zweitem Schlüssel, begrenzte Seitengröße (z. B. 25), Name/E-Mail/Kinderzahl/Abo-Bezeichnung/Familienstatus. Letzte Aktivität nur Admin. Status und Kinderzahlen für die angefragte Seite gesammelt berechnen; keine Detailabfrage pro Zeile. Keine Suche in Stripe-JSON oder ungefilterten personenbezogenen Datensätzen.

## 6. Familienstatus und Abo-Monate

**Empfohlene, noch freizugebende Fachregel:** Ein Abo-Monat ist ein bereits vollständig durchlaufener, gültiger monatlicher Leistungszeitraum eines aktuell zugeordneten Kindes. Künftige Jahresabofenster zählen nicht vorzeitig. Angebrochene Monate zählen erst bei Abschluss. Damit bedeutet „12 Monate“ tatsächlich zwölf abgeschlossene Monatsfenster und nicht zwölf im Voraus gekaufte oder lediglich berührte Kalendermonate.

Quelle: `entitlement_periods` über die aktuellen `parent_players`, abgesichert durch `subscription_players`/`subscriptions`. Frühester belegter Beginn ergibt „Abonnent seit“. `parents.created_at`, Registry-Erstbeobachtung und Billing-Cycle-Anker sind dafür kein Ersatz. Bei unvollständigem Import „Historie erfasst ab …“ statt eines behaupteten ursprünglichen Beginns anzeigen.

Berechnungsschritte:

1. Aktuelle Kindzuordnungen auflösen. Vorschlag: Archivierung allein entfernt den Link nicht, deshalb bleiben historische Abo-Monate eines weiterhin zugeordneten archivierten Kindes im Familienwert; Karten standardmäßig nur aktive Kinder. Admin kann archivierte Kinder separat sehen. Unlink entfernt den Beitrag. Diese Regel sichtbar dokumentieren und zur Freigabe stellen.
2. Gültige historische Monatsfenster pro Kind identifizieren. `void`, bekannte Trial-Zeiträume, künftige und nicht zuverlässig belegte suspendierte Zeiträume nicht pauschal mitzählen. Abgelaufene echte Abos behalten ihren historischen Beitrag.
3. Überschneidende Abo-Items/Tarifwechsel pro Kind zeitlich zusammenführen, damit parallele Abos nicht doppelte Familienmonate erzeugen. Zusammenhängende Intervalle kalenderbasiert vom tatsächlichen Startanker in ganze Monate zerlegen; Lücken nicht überbrücken. Monatsende/Schaltjahr explizit testen, keine Division durch 30 Tage.
4. Vollständige Monate pro Kind summieren, dann über die aktuell zugeordneten Kinder addieren: 4 + 8 = 12.

Einschränkung: Der derzeitige Sync erzeugt Leistungsfenster auch aus aktiven/trialing Subscriptions, nicht ausschließlich aus bezahlten Rechnungen. Statusänderungen können offene Fenster ändern; eine vollständige Pause-/Trial-Historie fehlt. Wenn „Abo-Monate“ stattdessen **bezahlte** oder **angefangene** Monate bedeuten soll, muss die Regel angepasst werden; für bezahlte Monate ist zusätzlich die Zahlungs-/Invoicehistorie erforderlich. Unklare/`needs_review`-Abos nicht durch Schätzung aufwerten; Datenqualität anzeigen. Keine persistierte manuelle Statuszahl.

| Gesamtmonate | Status | Anzeige |
| --- | --- | --- |
| 0–9 | Bronze | `M / 10 Monate`, `Noch 10 − M Monate bis Silber` |
| 10–17 | Silber | `M / 18 Monate`, `Noch 18 − M Monate bis Gold` |
| ab 18 | Gold | `Gold Status erreicht`, vollständiger Ring/Progress, kein nächster Rang |

Progress entsprechend Gesamtwert/Ziel bei Bronze und Silber; Werte auf 0–100 % begrenzen. Für 12 Monate also 12/18 und noch 6 Monate. Rangname zusätzlich als Text, nicht nur Farbe. Null Monate bei nachweislich keinem Abo ergibt Bronze; fehlgeschlagene Datenabfrage ergibt keinen vermeintlich sicheren Bronze-Status.

## 7. Trainings-, Camp- und Kalenderstatistik

### Trainingseinheiten und Stunden

- Pro Kind/Event genau einen nicht entfernten Teilnehmer verwenden. Nur `attended_auto` und `attended_manual` bei nicht abgesagtem, beendetem Event zählen. Automatische Teilnahme bleibt die bestehende fachliche Bestätigung; keine eigene Automatik erfinden.
- `absent`, `excused`, `cancelled` und `planned` sind keine besuchten Einheiten. `attendanceStats().completed` zählt derzeit auch berechnete Fehlzeiten und darf daher nicht direkt übernommen werden. `isAttended()` und Dauerfunktionen wiederverwenden.
- Stunden = Summe gültiger tatsächlicher Eventdauern plus bestätigter Nachtragsminuten; Minuten intern ganzzahlig, erst zur Anzeige formatieren.
- Nachträge zählen einmal zusätzlich. Für Monatsfilter zählt nur `occurred_on` im gewählten Monat. Undatierte Nachträge zählen in Gesamtstatistik und werden als undatiert ausgewiesen, niemals auf `created_at` in den Kalender gelegt. Kein unsicheres Zusammenführen nach Titel/Datum; mögliche historische Dubletten als Datenproblem behandeln.
- Monat: halboffenes Intervall `[Monatsbeginn, nächster Monatsbeginn)` in `Europe/Berlin`; Eventzuordnung nach Beginn, keine doppelte Zuordnung bei Monatswechsel. Gesamter Zeitraum serverseitig aggregieren, nicht alle Events an den Browser senden.

### Camps und Alter

- Campzahl = Anzahl unterschiedlicher `camp_id` mit bestätigtem `attendance_status = attended` für das aktuell zugeordnete Kind. Zahlung, Anmeldung, vergangenes Campdatum und Anzahl Camptage ersetzen keinen Teilnahmenachweis.
- `attendance_confirmed_at` ist Bestätigungszeit, kein Teilnahmezeitpunkt. Stornierte/erstattete Buchungen mit Attendance nicht still umdeuten: echte dokumentierte Teilnahme bleibt historische Teilnahme; widersprüchliche/importierte Datensätze sichtbar prüfen. Keine alte Buchung nachträglich allein wegen Zahlung als besucht markieren.
- Ein optional nicht installiertes Camp-Modul bedeutet „Campdaten nicht verfügbar“, kein Fehler für das ganze Elternprofil und keine vorgetäuschte Null.
- Exaktes Alter nur aus vorhandenem Geburtsdatum mit `ageAt`-Logik. Sonst Jahrgang bzw. „Alter bei Buchung: … (Stand …)“ oder „Nicht hinterlegt“. Keine erfundenen Geburtstage.

### Kalender und Einheiten

- `MonthCalendar` mit zwei optionalen Markierungstypen erweitern: bestätigte Teilnahme und geplante zukünftige Einheit; beide dürfen am selben Tag vorkommen. Beschriftete Legende und zugängliche Labels.
- Familienkalender dedupliziert Tagesmarker; Terminliste behält pro Kind Teilnahme/Status, auch bei gemeinsamem Training. Datierte Nachträge können markieren; undatierte bleiben außerhalb des Rasters.
- Vergangene, noch `planned` markierte Events als „Vergangen – Bestätigung ausstehend“ anzeigen, nicht als besucht oder zukünftig.
- Vorschau maximal fünf: zunächst kommende Einheiten aufsteigend, verbleibende Plätze mit jüngsten vergangenen Einheiten. Datumsauswahl filtert Vorschau und Link zur vollständigen Liste.
- Vollansicht mit serverseitiger Pagination und Filtern Kind, Zeitraum, geplant/vergangen, optional Terminart. Jeder Filter wird gegen erlaubte Kinder geprüft. Abgesagte/entfernte Teilnahmen nicht als geplante Aktivität markieren; Absagen dürfen beschriftet in der Historie bleiben.
- Für Camps existiert nur Anwesenheit je Buchung, keine Anwesenheit je Camptag. Deshalb im ersten Schritt Trainings-/Nachtragseinheiten im Mini-Kalender und Camps separat als Statistik; aus einem Campbesuch keine taggenauen Teilnahmen erfinden.

## 8. Editierlogik: nur Telefon und Ort

**Nutzerpräzisierung vom 08.10.2026:** E-Mail bleibt im neuen Elternprofil für alle Rollen ausschließlich lesbar. Es wird kein E-Mail-Änderungsworkflow eingeführt. Bestehende Auth-, Login-, Einladungs-, Kontaktverwaltungs- und Versandabläufe werden durch dieses Feature nicht umgebaut; vorhandene administrative Pflege außerhalb des neuen Profils bleibt bestehen.

Profilfelder: Name aus `parents.full_name`, E-Mail aus `contact_email`, neue kanonische `phone`/`city`. Nur Telefon und Ort sind für Eltern und Admin im Profil bearbeitbar. Historische `camp_bookings.parent_data.phone` sind höchstens ein zu bestätigender Vorschlag. Stripe-Rechnungsadresse nicht automatisch als Wohnort verwenden. Initialen-/User-Symbol genügt; kein Foto-Upload erforderlich.

`parents.updated_at` ist für das Wochenlimit ungeeignet, weil andere Prozesse es verändern. Ergänzung: `parents.profile_self_service_updated_at timestamptz null`.

Eine eng begrenzte RPC schreibt ausschließlich Telefon/Ort. Sie prüft `auth.uid()`, wirksame Rolle und aktiven Parent in der Datenbank. Unter `FOR UPDATE` wird atomar geprüft, ob die letzte erfolgreiche Self-Service-Änderung mindestens 168 Stunden zurückliegt. Parallele Requests dürfen nicht beide erfolgreich sein. Leere/identische Änderungen verbrauchen kein Kontingent. Adminänderungen werden protokolliert, setzen aber nicht den Elternzeitpunkt.

Keine allgemeine Eltern-UPDATE-Policy öffnen. Die neue API/RPC akzeptiert keine E-Mail-, Auth-, Billing-, Rollen-, Owner-, Archivierungs- oder clientseitig gesetzten Zeitstempelfelder. Die UI zeigt den serverseitig berechneten nächsten Bearbeitungszeitpunkt. Keine Bestätigungsmails, zusätzlichen Vorgangstabellen oder Änderungen am Auth-Callback nötig.

## 9. Kind archivieren

`players.archived_at` und adminseitige Schema-/RLS-Unterstützung existieren; `loadPortal()` blendet archivierte Kinder bereits aus. Eine dedizierte Archivierungsoberfläche wurde in `admin.tsx` nicht gefunden.

Nur Admin bekommt die Aktion mit vorhandenem `Modal`, Kindname und expliziter Bestätigung. Vorzugsweise ein kleines Update nur von `archived_at` über den bestehenden Adminrouter; nicht das gesamte möglicherweise veraltete Kindobjekt per Upsert zurückschreiben. Actor und Zeitpunkt über vorhandenes Audit erfassen, wiederholte Archivierung idempotent behandeln.

Keine Hard Deletes, kein Unlink, keine Stripe-Kündigung und keine automatische Stornierung bestehender Trainings-/Campbuchungen. Aktives Abo bzw. künftige Termine im Dialog benennen. Historie bleibt erhalten. `owns_player()` berücksichtigt derzeit die Archivierung des Parents, aber nicht `players.archived_at`: Soft-Archivierung ist damit keine vollständige Rechteentziehung für historische Daten. Das Profil muss seine aktive/archivierte Projektion ausdrücklich filtern; eine globale Ownership-Änderung würde Berichte/Stempelkarten betreffen und gehört nicht beiläufig in dieses Feature.

## 10. Stripe-Datenquellen und Finanzdefinition

### Befund

Portal-Stripe verarbeitet Subscription-Ereignisse, Checkout-Abschluss, `invoice.paid`, `invoice.payment_failed` und `customer.updated`. `syncInvoicePeriods()` importiert Leistungszeiträume aus Invoice-Lines, aber keine Rechnungsbeträge. Der Haupt-Eventfilter verarbeitet bisher keine Refundereignisse.

Camp-Verarbeitung hat bereits Checkout-/Refund-/Dispute-Ereignisse und regelmäßigen Abgleich. `confirmPayment()` prüft vereinnahmte Zahlungen, kann volle Refunds erkennen und behandelt Teilrefunds/Disputes als Prüfbedarf. `camp_bookings.paid_at` kann Import-/Bestätigungszeit sein; für Monatsausgaben darf nicht ungeprüft darauf vertraut werden. Ein stornierter Campteilnehmer kann weiterhin eine vereinnahmte, nicht erstattete Zahlung besitzen.

Portal und Camp verwenden unterschiedliche Konfigurationen (`STRIPE_SECRET_KEY`, `CAMP_STRIPE_SECRET_KEY`, `CAMP_STRIPE_READ_KEY`). Vor einer Zusammenrechnung Konto und Live/Test-Modus feststellen. Identische Customer-IDs über unbestätigte Kontengrenzen nicht zusammenführen.

### Exakte vorgeschlagene Definition

**Aboausgaben:** Summe tatsächlich erfolgreicher, vereinnahmter Zahlungen für eindeutig zugeordnete Abo-Rechnungspositionen, inklusive bezahlter Prorationen und Steuern, nach Rabatten, abzüglich erfolgreicher Erstattungen. Trial-/Nullrechnungen tragen null bei. Unbezahlte/fehlgeschlagene/void Rechnungen und autorisierte, aber nicht vereinnahmte Beträge tragen nichts bei. Manuell als bezahlt markierte Rechnungen ohne belegten Geldeingang werden nicht als Stripe-Zahlung gewertet.

**Gesamtausgaben:** dieselben Abozahlungen plus vereinnahmte Camp-, Event- und sonstige Produktzahlungen, die dem Parent eindeutig zugeordnet sind, jeweils abzüglich erfolgreicher Erstattungen. Ein Zahlungsobjekt zählt genau einmal, auch wenn es über Checkout, Invoice und Campbuchung auffindbar ist. Camp-Stornierung ist kein Zahlungsstorno; Refund und Buchungsstatus getrennt behandeln.

**Zeitraumregel:** Zahlungsfluss im gewählten Zeitraum. Erfolgreiche Zahlung nach tatsächlichem Vereinnahmungszeitpunkt positiv, erfolgreicher Refund nach Refundzeitpunkt negativ. Der aktuelle Monat kann deshalb negativ sein, wenn ältere Zahlungen erstattet wurden. Gesamt umfasst alle verifizierten Buchungen bis jetzt. Beträge in kleinster Währungseinheit verarbeiten und pro Währung getrennt anzeigen; keine stille Währungsumrechnung. Rückbelastungen separat als offene/abgeschlossene Korrekturen ausweisen und erst bei belastbarem Ergebnis entsprechend verbuchen.

Gemischte Rechnungen benötigen belegte Zuordnung von Positionen, Rabatten, Steuern und Refunds. Unzuordenbare Teilbeträge als ungeklärt ausweisen, nicht komplett den Abos zuschlagen. Bei nicht eindeutig klassifizierbaren Teilrefunds bleibt Aboausgabe als unvollständig markiert, selbst wenn die Gesamtausgabe exakt bestimmbar ist.

### Vereinfachter Finanzabruf ohne neue Zahlungsarchitektur

**Neuer bevorzugter Vorschlag nach Nutzerpräzisierung:** Eine Adminaktion „Finanzdaten laden“ ruft serverseitig ausschließlich lesend die Zahlungen der eindeutig zugeordneten Stripe-Kunden ab. Bestehende Clients, Customer-/Subscription- und Campzuordnungen wiederverwenden. Kein automatischer Stripeabruf bei jedem Profilaufruf, kein Abruf pro Kind, keine neue Tabelle, kein neuer Worker und keine Änderung an Checkout oder Webhookverarbeitung.

Lokale Campbelege und vorhandene Stripeereignisse helfen bei Zuordnung und Plausibilisierung. Sie ersetzen keine vollständige Liste. Der lesende Abruf muss erfolgreiche Vereinnahmungen, zugehörige Rechnungen zur Aboklassifikation und erfolgreiche Erstattungen berücksichtigen. Invoice/Checkout/Campdarstellungen derselben Zahlung deduplizieren. Welche Stripe-Listen/Expansionen dafür mit der installierten SDK-Version am sparsamsten sind, wird bei Umsetzung geprüft.

Ein Admin-Klick kann intern mehrere paginierte Stripe-Requests erfordern, insbesondere für „Gesamt“. Seiten vollständig lesen, Requests begrenzen, Doppelklicks unterbinden und Rate-Limits/Timeouts behandeln. Bei Überschreiten des sicheren Abrufbudgets „Unvollständig“ anzeigen und keine Teilsumme als Gesamtbetrag ausgeben. Monatsrefunds älterer Zahlungen dürfen nicht durch einen Filter nur auf neue Zahlungen verschwinden. Konto, Test/Live und eindeutige Eigentümerschaft vor Zusammenrechnung prüfen; keine Zuordnung nur nach E-Mail.

Nach erfolgreichem Abruf die kleinen aggregierten Monats-/Gesamtwerte mit Abrufzeitpunkt im aktuellen Adminseitenzustand halten. Umschalten zwischen den beiden Ansichten braucht dann keine erneute Stripeabfrage. Keine dauerhafte Browserablage, kein rollenübergreifender Cache. Ein erneuter bewusster Abruf aktualisiert den Stand.

Die Finanzdefinitionen oben bleiben gültig. Gemischte Rechnungen oder unklare Erstattungszuordnungen ehrlich kennzeichnen; keine neue Buchhaltungsarchitektur für seltene Sonderfälle einführen. Ob der Gesamtabruf im vorhandenen Hosting-Zeitbudget praktikabel ist, hängt von der realen Historiengröße und den Schlüsselrechten ab und wurde noch nicht live geprüft. Nur wenn reale Messungen den einfachen Ansatz ausschließen, eine zusätzliche Persistenz gesondert vorschlagen, nicht vorsorglich bauen.

## 11. Berechtigungslogik und Security Check

### Zielmatrix

| Zugriff | Admin | aktiver Coach (`staff`) | Eltern |
| --- | --- | --- | --- |
| Elternliste | ja | ja, Kontakt-/Trainingsprojektion | nein |
| Profil/Kinder/Trainingsstatistik | alle erlaubten Familien | gemäß bestehendem globalem Teamscope | nur eigene aktuelle Zuordnung |
| Telefon/Ort ändern | ja | nein | nur selbst, Wochenlimit |
| Kind archivieren | ja | nein | nein |
| Ausgaben/Zahlungsdetails | ja | nein | nein im neuen Profil |
| Letzte Aktivität | ja | nein | nicht benötigt |

Bestehende Teamrechte sind global, nicht trainerbezogen; es gibt keine belastbare Coach-Familien-Scope-Tabelle. Für die angefragte Coachliste diesen bestehenden Scope verwenden. Eine Einschränkung auf eigene Trainingsgruppen wäre eine zusätzliche Fachanforderung.

### Betroffene Zugriffspfade

1. **Seiten/RSC/Clientprops:** Rollenprüfung vor Datenzugriff. Parent aus `auth.uid()` auflösen; fremde IDs auch bei direktem URL-Aufruf ablehnen. Keine Finanzfelder in serialisierten Coach-/Elternprops, Fehlern oder Debugdaten.
2. **Profil-, Listen-, Einheiten- und Finanz-API:** zentrale serverseitige Authorisierung je Request; keine Clientrolle vertrauen. Kinderfilter als Teilmenge erlaubter IDs prüfen. Finanzzweig vor jeder Finanzquery exklusiv Admin. UUID-/Filtervalidierung, begrenzte Pagination; konsistente 401/403/404 ohne fremde Stammdaten.
3. **Direktes Supabase REST/RPC:** bestehende `own_parent`, `owns_player`, `own_period`, `own_participant` und Adminpolicies bleiben maßgeblich. Eltern erhalten keine allgemeine Tabellen-UPDATE-Freigabe. Neue RPCs prüfen intern Rolle/Owner, setzen festen `search_path`, begrenzen Rückgabespalten, entziehen PUBLIC/anon EXECUTE. Views dürfen RLS nicht unbemerkt umgehen.
4. **Coach-Kontaktdaten:** `parents`/`parent_players` sind derzeit nicht allgemein für Staff lesbar. Keine pauschale Team-SELECT-Policy auf `parents` hinzufügen, weil dort Billing-/Customerfelder liegen. Bevorzugt eng begrenzte, intern autorisierte Read-RPC für Liste/Profil mit nichtfinanzieller Projektion. Vorhandene `subscriptions` nicht für Coaches öffnen; stattdessen nur Abo-Bezeichnung, Zeitraum und Status projizieren.
5. **Camp-Service mit Service Role:** vor jedem Zugriff Session/Parent/Kinder prüfen. Der neue Profilpfad darf nicht `dashboard()` ungefiltert wiederverwenden. Camp-Tabellen bleiben ohne authenticated/anon-Tabellenrechte.
6. **Bestehende Camp-Datenleckpfade:** `dashboard()` liefert an Staff unter anderem `paid_amount`, `paid_at`, `stripe_session_id`; `/api/camp/review` bzw. `local-review` akzeptieren Teamrollen und liefern Beträge, Payment-/Customer-/Session-IDs. Das widerspricht der neuen Anforderung „Coach kann keine Finanzinformationen abrufen“. Für die spätere Umsetzung ist eine bewusste, kleine rollenabhängige Projektion auch dieser Pfade erforderlich. Review-/Importaktionen für Coaches funktional erhalten, aber mit interner Referenz statt unnötigen Zahlungsdetails; Tests in `camp-team-review.test.ts` als fachliche Regression berücksichtigen. Nicht lediglich UI ausblenden. Readiness-/öffentliche Angebotspreise sind von personenbezogenen Ausgaben zu unterscheiden.
7. **Bestehender Eltern-Campfilter:** `dashboard()` verwendet Parent-ID ODER aktuelle Kinder-IDs. Nach einer Umzuordnung kann so eine historische Buchung mit inzwischen fremdem Kind über die alte Parent-ID sichtbar bleiben. Profilqueries müssen aktuelle Kinderzuordnung erzwingen; die bestehende Campausgabe benötigt eine gezielte Prüfung/Projektion, damit die Anforderung „keine fremden Kinder“ auch über diesen Pfad gilt. Finanzbelegzugriff und heutige Kinderdaten separat behandeln.
8. **Mutation/CSRF:** `requireOrigin`/Camp-Originchecks beibehalten, nur passende HTTP-Methoden. Kontakt-RPC prüft Limit atomar; Archivierungs-API prüft Admin unabhängig vom Button. Direktaufrufe und konkurrierende Requests testen.
9. **Audit/Logs/PDF/öffentliche Trainingslinks:** neue Kontakt-/Paymentdaten nicht in öffentliche Trainings-RPC, PDF-URLs oder generische Teamlogs einspeisen. Audit bleibt adminlesbar; keine kompletten Stripepayloads in Fehlerlogs. Vorhandene Reportzugriffe nicht aufweichen.
10. **Caching:** private Antworten `private, no-store`; bestehender network-only Service Worker bleibt. Keine globale Parent-/Coach-Responsecache, keine Profilpersistenz in localStorage. Rollen-/Zuordnungswechsel müssen beim nächsten Request wirksam sein.
11. **Lesender Finanzabruf:** Adminrolle vor Stripezugriff prüfen; Kunden-IDs ausschließlich aus serverseitig geprüfter Familienzuordnung. Coach/Parent/anon dürfen den Abruf nicht auslösen. Keine Stripe-Secrets oder Rohpayloads im Client; ausschließlich benötigte aggregierte Werte ausliefern.

Diese Befunde sind Codeanalyse, kein abgeschlossener Sicherheitstest der laufenden Installation. Die kleine Absicherung bestehender Camp-Ausgaben ist fachlich durch die neue Zugriffsvorgabe begründet, berührt aber vorhandene Coachabläufe und muss in Phase 2 ausdrücklich mitgetestet werden.

## 12. Notwendige und optionale Migrationen

Nur geplant; keine SQL-Datei erstellt oder ausgeführt.

| Änderung | Begründung / Schutz |
| --- | --- |
| `parents.phone text null`, `parents.city text null` | Zentrale aktuelle Kontaktfelder fehlen. Längen-/Leerwertvalidierung; historische Campdaten nicht pauschal importieren. |
| `parents.profile_self_service_updated_at timestamptz null` | Unabhängige, nur serverseitig gesetzte Wochenquote; vorhandenes `updated_at` ungeeignet. |
| Kontaktänderungs-RPC und eng begrenzte Profil-Read-RPC | Atomare Quote, Staff-Projektion ohne Billingfelder, identitätsgebundene Zugriffe. Bestehendes Audit nutzen. |
| bedarfsgerechte Indexergänzungen | Vorhandene Spieler-/Perioden-/Event-/Linkindizes nutzen; weitere Suchindizes erst anhand Queryplan/Volumen. |

Keine neuen Tabellen für Familien, Kinder, Statuswerte, Trainingszähler, Campzähler, Kalender oder Archivierung. Keine neuen E-Mail-Vorgangs- oder Zahlungstabellen. Kleine additive Migration für Telefon/Ort, Self-Service-Zeitpunkt und begrenzte RPCs; Anwendung explizit erst nach Freigabe. Optionale Campinstallation und unterschiedliche Release-Stände müssen berücksichtigt werden, statt Features durch leere Catch-Blöcke scheinbar funktionieren zu lassen.

## 13. Design und Responsive-Umsetzung

Quelle ist das aktuelle `src/app/globals.css`, nicht ein älteres Design. Tatsächlich vorhandene Tokens:

| Token / Muster | Bestehender Wert |
| --- | --- |
| `--dark` / `--color-brand-dark` | `#0b0f1a` |
| `--lime` / `--color-brand-lime` | `#8eff01` |
| `--purple` / `--color-brand-purple` | `#8b53fe` |
| `--ink`, `--muted` | `#171c27`, `#777d88` |
| `--line`, `--surface`, `--white` | `#e8e9ed`, `#f6f7f9`, `#fff` |
| Schrift | Arial/Helvetica/sans-serif, Basis 14 px / Zeilenhöhe 1,5 |
| Karten/Controls | überwiegend 9–10 px bzw. 5–8 px Radius, feine Border, dezente Schatten |
| Abstände/Breakpoints | bestehende 12/16/20/24-px-Muster; relevante Breakpoints 1200/1000/760/600 px |

Bestehende Card-, Button-, Badge-, Tabellen-, Formular- und Segmented-Control-Klassen nutzen. Es gibt keinen vollständigen abstrakten Tokenkatalog für alle Radien/Abstände; lokale neue Profilklassen sollen die bestehenden Muster übernehmen, keine parallele Designsprache aufbauen.

Runder Initialen-/User-Avatar mit Bronze-/Silber-/Goldring. Nur für die bisher fehlenden Metallstatus nötige semantische Tokens ergänzen; Grundflächen, Texte, Lime/Purple bleiben Portal-Tokens. Dezenter statischer Gradient/Glow plus optional seltener Light Sweep über `transform`/`opacity`; keine kontinuierlich animierten Schatten/Filter. Bestehendes `prefers-reduced-motion` respektieren und neue Animationen ebenfalls deaktivieren. Progress semantisch beschriften.

Mobile einspaltig, Tablet nach verfügbarem Platz zweispaltig, Desktop Kopf/Kinder/Statistiken mit passender Rasterbreite. Kinderkarten mit `overflow-x: auto`, Scroll Snap und Touch; Pfeile nur bei Overflow, zusätzlich Tastatur bedienbar. Kein Drag-only-Bedienkonzept. Lange Namen/E-Mails umbrechen, Gridkinder `min-width: 0`; kein Seitenoverflow. Listen mobil in lesbare Karten/Zeilen umformen. Kalender mit sieben flexiblen Spalten und genügend großen Touchflächen. Dialoge mit erreichbaren Aktionen auch bei Bildschirmtastatur. Ring, Status und Diagramm dürfen nicht nur über Farbe verständlich sein.

## 14. Voraussichtliche Dateien

### Bestehende Dateien, gezielt anzupassen

- `src/app/[[...section]]/page.tsx`: eng validierte neue Profil-/Einheitenpfade.
- `src/components/portal.tsx`: Navigation, „Mein Profil“, Einbindung gemeinsamer Ansichten und ggf. schlanker Rahmen für Profilseiten.
- `src/lib/server/data.ts`: Profilladen vom bisherigen vollständigen Portaldatensatz trennen; Camp-only-Erreichbarkeit erhalten.
- `src/app/api/[...path]/route.ts`: Read-/Edit-/Archivierungszweige mit bestehender Auth-/Originstruktur.
- `src/lib/server/schemas.ts`, `src/lib/types.ts`: strikte Kontakt-/Filtervalidierung und rollenbezogene Datentypen.
- `src/components/month-calendar.tsx`: optionale differenzierte Marker.
- `src/app/globals.css`: ausschließlich passende Profil-/Responsive-/Statusstile.
- `src/components/admin.tsx`: Link von bestehenden Elternzeilen ins Profil; bisherige Pflege/Zuordnung erhalten.
- `src/lib/server/stripe.ts`: bestehenden Client wiederverwenden; keine Änderung an Sync/Webhooks geplant.
- `src/lib/camps/service.ts`, `src/lib/camps/local-review.ts`, `src/lib/camps/import-review.ts`, `src/app/api/camp/[...path]/route.ts` und betroffene Camp-Komponenten: sichere Projektionen/Referenzen und eigene-Kinder-Filter; minimal nötige Anpassung vorhandener Coachabläufe.
- `src/components/camps/dashboard.tsx`: Profilzugang für umgeleitete Eltern, rollenabhängige nichtfinanzielle Datenform.
- `src/lib/portal-access.ts` nur bei erforderlicher Erweiterung; Rollenpräfixe passen bereits grundsätzlich.

### Voraussichtlich neue Dateien

- `src/components/parent-profile.tsx`: gemeinsame Profilansicht mit kleinen lokalen Unterkomponenten.
- `src/components/parent-profile-list.tsx`: paginierte Liste mit vorhandenen UI-Mustern.
- `src/components/parent-profile-units.tsx`: gefilterte vollständige Einheitenansicht.
- `src/lib/parent-profile.ts`: reine Status-/Statistikberechnung, ohne DB/Stripezugriff.
- `src/lib/server/parent-profile.ts`: zentrale Autorisierung, gefilterte Loader und Kontaktworkflow.
- `src/lib/server/parent-profile-finances.ts`: rein lesender, expliziter Adminabruf über vorhandene Stripe-Clients; Aggregation und Zuordnung ohne neue Persistenz.
- Kleine additive SQL-Migrationen in `supabase/migrations/`; optionale Campintegration separat im bestehenden Camp-Releasepfad.
- `tests/parent-profile.test.ts`, `tests/parent-profile-security.test.ts`, `tests/parent-profile-finances.test.ts`, ggf. `tests/e2e/parent-profile.spec.ts`.

Aufteilung bei Implementierung klein halten; kein separater Hook/Service pro Karte. Die genannten Namen sind Planung, keine bereits existierenden Dateien.

## 15. Performance und Fehlersituationen

- Auth/Parent zuerst auflösen, danach unabhängige erlaubte Daten parallel laden. Queries immer auf Parent-/Kinder-IDs, Zeitbereich und benötigte Spalten beschränken.
- Liste paginiert; Aggregation je geladener Seite gebündelt. Profilstatistiken serverseitig, Kalender nur aktueller Monat, Vorschau fünf Zeilen; vollständige Terminansicht paginiert.
- `readAll()` löst zwar das 1.000-Zeilen-Limit, kann derzeit aber keine fachlichen Filter entgegennehmen. Nicht ungefiltert für das neue Profil verwenden; bei notwendiger Wiederverwendung minimal um sichere Filter erweiterbar, sonst zielgerichtete Query/RPC.
- Eltern, Coaches und Admins bekommen keine unnötigen globalen `PortalData`-Sammlungen allein zum Rendern des Rahmens. Dies muss insbesondere bei Wiederverwendung von `Portal` und `loadPortal` geprüft werden.
- Keine dauerhaften Clientcaches für Kinderdaten und keine Stripe-Requests je Kartenrender. Abrufzeitpunkt und Vollständigkeit der Finanzwerte sichtbar; optionales Campmodul getrennt fehlerfähig.
- Leere Familie, fehlender Name/Kontakt, unbekanntes Alter, fehlende Subscription, undatierte Nachträge und unvollständige Zahlungshistorie erhalten eigene ehrliche Zustände. Datenbankfehler sind nicht gleich „keine Daten“.

## 16. Risiken und vor Umsetzung zu bestätigende Regeln

1. **Abo-Monatsdefinition:** abgeschlossen versus angefangen/bezahlt; Trial-/Pausehistorie und historische Vollständigkeit. Empfehlung siehe Abschnitt 6.
2. **Archivierte Kinder:** aktueller Link bleibt bestehen; vorgeschlagen ist Statusbeitrag bis zum Unlink, aktive Karten separat. Anderes Verhalten wäre fachlich festzulegen.
3. **E-Mail/Login/Versand:** E-Mail bleibt im neuen Profil unveränderbar. Neue Edit-API muss E-Mail-Felder ausdrücklich ablehnen; bestehende Abläufe nicht umbauen.
4. **Coach-Campzugriff:** Finanzdaten sind heute Teil vorhandener Teamantworten und Tests. Die neue Vorgabe erfordert eine kontrollierte Anpassung dieser bestehenden Abläufe, keinen pauschalen Entzug aller Campfunktionen.
5. **Elternwechsel:** bestehender Camp-OR-Filter kann historische fremde Kinderdaten zeigen; aktuelle Kindersicht und unveränderliche Zahlungseigentümerschaft müssen auseinandergehalten werden.
6. **Zahlungsvollständigkeit:** mehrere Kunden, mögliche gemeinsame Customerzuordnung, unterschiedliche Stripekonfigurationen, historische Lücken, Null-Checkouts, Teilrefunds und gemischte Invoices. Keine ungeprüfte globale Summe anbieten.
7. **Statistikregression:** Stempelkartenverbrauch ist nicht besuchte Trainingszahl. Bestehende Berichte/Kontingente bleiben unverändert.
8. **Zeit und Alter:** Portal rechnet absichtlich mit `Europe/Berlin`; Gerätezeitzone nicht übernehmen. Monatsende, Sommerzeit, fehlendes Geburtsdatum und undatierte Nachträge berücksichtigen.
9. **Migrationen/optionale Module:** Installationsstand vor Anwendung prüfen, kein automatischer Live-Rollout. Tabellen-/Spaltenergänzungen allein machen alte Daten nicht vollständig.

Diese Entscheidungen sind im Plan offen gekennzeichnet; es wird vor Freigabe keine Annahme als neue Geschäftslogik umgesetzt.

## 17. Konkrete Implementierungsreihenfolge nach Freigabe

1. Fachregeln aus Abschnitt 16 bestätigen, installierten Schema-/Auth-/Stripequellenstand lesend prüfen und Datenlücken festhalten.
2. Rollenbezogene DTOs und Autorisierungsgrenzen definieren; gezielte Regressionstests für eigene/fremde Familien und Coach-Finanzdaten vorbereiten.
3. Kleine Telefon-/Ort-/RPC-Migration erstellen; atomare Quote und direkte REST-/RPC-Sicherheit in isolierter Testdatenbank prüfen. Anwendung auf eine Zielinstanz bleibt ein gesondert bewusster Schritt.
4. Gefilterte Profil-/Listen-/Einheitenloader und reine Monats-/Trainings-/Campberechnungen implementieren; vorhandene fachliche Helfer verwenden.
5. Rein lesenden Admin-Finanzabruf mit vorhandenen Clients implementieren und anhand Fixtures testen; Berechtigungen, Pagination, Refunds und Zeitbudget prüfen. Keine Änderung an Zahlungsvorgängen, Workern oder Webhooks.
6. Notwendige sichere Camp-Projektionen ergänzen, einschließlich Coach-Review und Parentwechsel; bestehende Import-/Teilnehmerfunktionen erhalten.
7. Gemeinsame UI, Navigation, Profileinstieg, Kinderkarten, Status, Filter, Kalender und Vollansicht integrieren; responsive Varianten und reduzierte Bewegung prüfen.
8. Telefon-/Ortbearbeitung für Eltern/Admin und bestätigte Soft-Archivierung verbinden; Fehler-/Wiederholungszustände vollständig behandeln.
9. Relevante Tests, Typecheck und gezieltes Security-/Responsive-Review durchführen; Änderungen und verbleibende Grenzen zusammenfassen.
10. **Stoppen. Kein Commit, Push oder Deployment ohne jeweils ausdrücklichen Auftrag.**

## 18. Gezielte Validierung für Phase 2

In Phase 1 wurden keine Tests gestartet: Es wird ausschließlich dieses Dokument erstellt.

Nach Implementierungsfreigabe nur Tests passend zum jeweiligen Änderungsschritt, keine wiederholten vollständigen Suites:

- Status: 0/9/10/17/18 Monate, 4+8, Jahresabo ohne Zukunftsvorsprung, überlappende Items, Lücken, Trial/Suspension, Unlink/Archivierung, unvollständige Historie.
- Statistik: manuell/automatisch teilgenommen, bezahlte Fehlzeit ausgeschlossen, Absage/Entfernung, Monatsgrenzen, Nachträge mit/ohne Datum, Mehrkindtermin, Campteilnahme versus Buchung.
- Sicherheit: Adminliste/-detail, Coachliste/-detail ohne Finanzfelder; direktes Finanz-API/REST/RPC verboten; Parent-URL-/ID-/Kindfiltermanipulation; deaktivierter Coach; archivierter Parent; Campdaten nach Elternwechsel; RSC-/Clientpayload prüfen.
- Editieren: vor/nach exakt 168 Stunden, konkurrierende Requests, manipulierte Zeitstempel, No-op, Admin ohne Quoteneffekt, E-Mail-Felder werden von der neuen Edit-API abgelehnt; bestehende Auth-/Kontaktabläufe bleiben unverändert.
- Finanzen: successful versus failed/unpaid/void, deduplizierte Invoice/Checkout/Campzahlung, vollständige/teilweise/verspätete Refunds, Monats-/Gesamtfilter, Währungen, Test/Live und mehrere Customers; Pagination, Timeout, Doppelklick und keine erneute Abfrage beim Filterwechsel.
- UI: 360/390 px, Tablet, Desktop; Tastatur, Dialogfokus, Swipe/Snap, lange Kontakte, keine horizontale Seite, reduzierte Bewegung; maximal fünf Vorschautermine und funktionierende Filter.
- Vorhandene gezielte Regressionstests je Änderung: `portal-access.test.ts`, `family-accounts.test.ts`, `single-parent-assignment.test.ts`, `calendar.test.ts`, `domain.test.ts`, `training-period.test.ts`, `camp-team-review.test.ts`, und die passenden DB-Tests. Unveränderte Auth-/Webhook-/Checkouttests nicht routinemäßig erneut starten.

`npm run typecheck` nach integrierter TypeScript-Änderung; für Lint existiert aktuell kein eigener Script-Eintrag. Keine neue Lint-Infrastruktur dafür einführen. Vorhandene Tests nicht zum bloßen Grünwerden abschwächen; fachlich absichtlich geänderte Zugriffsverträge nachvollziehbar mit Negativtests ergänzen.

## 19. Lokaler Umsetzungsstand nach Freigabe

Auf ausdrücklichen Auftrag „nur lokal umsetzen vorerst“ implementiert. Keine Veröffentlichung, kein Commit und kein Push. Keine entfernte Datenbank oder Stripe-Zahlung verändert.

### Umgesetzt

- Rollenabhängige Elternliste und gemeinsames Profil unter `/admin/elternprofile`, `/team/elternprofile` und `/profil`, jeweils mit vollständiger Einheitenansicht.
- Einstieg in Elternübersicht/Campbereich sowie Link aus bestehender Elternverwaltung.
- Profilkopf, Bronze/Silber/Gold, abgeschlossene Abo-Monate, swipebare Kinderkarten, Monats-/Gesamtstatistiken, Kalender mit getrennten Markierungen und fünf Vorschauterminen.
- E-Mail im neuen Profil unveränderbar. Telefon/Ort mit strikter Feldliste und atomarer 168-Stunden-Sperre in SQL; Adminänderungen verbrauchen keine Elternquote.
- Bestätigte Soft-Archivierung, ohne Unlink oder Änderung von Abos/Terminen/Campbuchungen.
- Rein lesender, ausdrücklich ausgelöster Admin-Finanzabruf mit begrenzter Pagination, Zahlung-/Invoicezuordnung, Erstattungen und separaten Währungen. Kein neues Zahlungsschema, keine Änderungen an Checkout-/Worker-/Webhooklogik. Unklare Aboanteile oder unvollständige Daten ergeben keine geschätzten verlässlichen Summen.
- Coach-Antworten im bestehenden Camp-Dashboard/Prüfstand enthalten keine Beträge oder rohen Zahlungsreferenzen; Prüfvorgänge verwenden eine interne Referenz. Bestehende Import-/Speicheraktionen bleiben nutzbar. Tests des geänderten Antwortvertrags prüfen ausdrücklich die entfernten Felder und den fortbestehenden Ablauf.
- Campbuchungen für Eltern werden nach aktueller Kindzuordnung gefiltert; ein früherer Parent-Link allein gewährt keine fremden Kinderdaten mehr.

### Lokale Datenbank und Vorschau

Die additive Datei `supabase/migrations/202610080001_parent_profile.sql` wurde ausschließlich auf die bereits bestehende isolierte Docker-Datenbank `supabase_db_pabyak-family-local` angewendet (Loopback-API `127.0.0.1:55321`). Kein Reset und keine Anwendung auf eine Remoteinstanz.

Separate Vorschaukopie: `output/eltern-kind-lokal/profile-app`. Start dort mit:

```sh
NODE_OPTIONS=--require=./network-guard.cjs ./node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port 3117
```

Kontowechsel: `http://127.0.0.1:3117/lokaler-test`. Die Vorschau verwendet ausschließlich lokale Zugangsdaten und blockiert externe Fetch-Verbindungen. Der lokale Anmeldehelfer liegt nur in der ignorierten Testkopie, nicht im auslieferbaren Quellcode. Die bestehende Vorschau auf Port 3107 wurde nicht ersetzt.

### Gezielte Prüfungen

- Reine Berechnungstests: Statusgrenzen, 4+8 Monate, Jahresabo, Überschneidungen, Monatsende/Lücken, Fehlzeiten, Nachträge, Kalender und Alter.
- PGlite-Tests: eigener/fremder Parent, Coach, direkte Tabellenzugriffe, Wochenlimit, No-op, Adminquote, archivierte Eltern und Eingabegrenzen.
- Finanztests mit Fixtures: Coach-/Elternsperre vor Stripezugriff, erfolgreiche Zahlung, fehlgeschlagene Zahlung, Erstattung älterer Zahlung im aktuellen Monat, gemischte Invoice und unvollständige Belege/Dispute.
- Passende bestehende Tests zu Portalzugriff, Kalender und Camp-Prüfung/-Buchungsstatus; zusätzlich negative Tests für Zahlungsfelder und ehemalige Kindzuordnung.
- Playwright lokal auf Desktop und iPhone-Abmessungen: eigene/fremde Profile, Coachrechte, Adminsuche/-profil, unveränderbare E-Mail und kein Seitenoverflow. Speicher-/Archivierungsablauf zusätzlich einmal auf Desktop mit Wiederherstellung der geänderten lokalen Stammdaten geprüft.
- Screenshots in `output/parent-profile-desktop.png` und `output/parent-profile-mobile.png` visuell geprüft.
- TypeScript-Quellcode separat geprüft. Der reguläre Projekt-Typecheck trifft auf bereits vorhandene doppelte generierte `.next/types/* 3.ts`-Deklarationen. Diese fremden generierten Dateien wurden nicht gelöscht; die gezielte Prüfung schließt sie aus.

### Grenzen und bewusste Vereinfachungen

- Keine echten Stripeabfragen im lokalen Test. Live-Schlüsselrechte, reale Historiengröße und Kontoidentität sind nicht als geprüft zu verstehen. Der lokale Finanzbutton kann ohne Stripe-Schlüssel keine echten Summen laden.
- Bestehende lokale Historie ist ein älterer Snapshot. Fehlende Nachtrags-/Camp-/Aktivitätsmodule werden nicht als vollständige Daten ausgegeben. Abo-Monate zeigen nur die erfassten gültigen Zeiträume.
- Profilqueries sind nach Familie gefiltert und begrenzt; die Einheitenansicht liefert paginierte Antworten. Serverseitige Statistikberechnung liest maximal 10.000 Datensätze pro relevanter Quelle; größere Historien brechen ausdrücklich ab statt still falsch zu zählen. Eine zusätzliche Aggregations-RPC wurde nicht vorsorglich eingeführt.
- Keine Animation erforderlich: Status verwendet dezente statische Metallverläufe/Glow. Swipe-Navigation respektiert reduzierte Bewegung.
- EUR wird als Eurobetrag formatiert; andere Währungen werden getrennt mit ihrem originalen Minor-Unit-Betrag beschriftet, damit keine falsche Dezimalumrechnung entsteht.

**Phase 2 endet lokal. Commit, Push und Production-Deployment bleiben jeweils ausdrücklich freigabepflichtig.**


## 20. Lokale Aktivierung am 09.10.2026

- Profilmigration in `supabase_db_pabyak-family-local` erneut geprüft: Telefon, Ort, Self-Service-Zeitpunkt und RPC sind vorhanden. Keine erneute Migration und keine Remoteänderung erforderlich.
- Die Vorschau auf Port 3117 verwendet jetzt den vorhandenen eingeschränkten Stripe-Live-Schlüssel ausschließlich über einen lokalen Leseclient (`PROFILE_STRIPE_READ_KEY` in der ignorierten lokalen Vorschaukonfiguration). Die normale `STRIPE_SECRET_KEY`-Variable der Vorschau bleibt ungesetzt; `APP_MODE=test` und die lokale Supabase-Verbindung bleiben erhalten.
- Der lokale Netzwerkguard erlaubt neben Loopback nur GET-Abfragen ausgewählter Stripe-Leseendpunkte. POST/DELETE an Stripe, Billing-Portal-Erzeugung und externe Supabase-Verbindungen wurden als gesperrt geprüft. Zahlungs-, Checkout- und Webhookabläufe wurden nicht aktiviert.
- Ein echter Admin-Finanzabruf über die lokale API war erfolgreich: HTTP 200, vollständige EUR-Auswertung, keine Datenqualitätswarnung für die geprüfte Familie. Dies ist eine Stichprobe, keine Prüfung aller Familien.
- Der Schlüssel hat keine Connected-Account-Leseberechtigung. Der Finanzservice fragt bei einer einzelnen Stripequelle deshalb kein Accountobjekt mehr ab. Die Prüfung mehrerer Quellen bleibt bestehen. Die sechs gezielten Finanztests decken den einzelnen eingeschränkten Zugang ab.
- Lokale Sonderkonfiguration liegt ausschließlich in `output/eltern-kind-lokal/profile-app`; beim vollständigen Neuaufbau dieser Testkopie muss sie erneut eingerichtet werden. Kein Commit, Push oder Deployment.


## 21. Originale Supabase-Anbindung für den lokalen Test (09.10.2026)

Nach Klarstellung des Nutzers wurde die tatsächlich in der Root-App konfigurierte Supabase-Instanz `proacademy-portal-test` (`vgxaatawsbzgsmqiaepj`) verwendet. Dort fehlten alle drei Profilspalten. Ausschließlich `202610080001_parent_profile.sql` wurde transaktional angewendet und in `supabase_migrations.schema_migrations` erfasst; der PostgREST-Schemacache wurde neu geladen. Kein Reset, kein allgemeines `db push`, keine Anwendung auf das separate Projekt `proacademy-ak.com`. Die früheren Aussagen über ausschließlich lokale Datenbankänderungen beschreiben den damaligen Stand.

Die ursprüngliche App auf `http://127.0.0.1:3000` lädt nun Profile aus dieser Remote-Datenbank. Im vorhandenen angemeldeten Admin-Browser wurden Kind, Status, Kalender und Trainingseinheiten nach Neuladen sichtbar. RPC-Berechtigungen geprüft: `anon` darf nicht ausführen, `authenticated` darf ausführen; die Funktion prüft Rolle und Eigentümer. Es wurden keine Kontaktwerte für einen Test verändert.

Die ignorierte Root-Datei `.env.local` aktiviert `LOCAL_PROFILE_STRIPE_READ=true`. Der Profil-Finanzservice verwendet damit einen eigenen Client ausschließlich im Next-Entwicklungsmodus mit Loopback-APP_URL. Sein Transport erlaubt nur GET an die benötigten Stripe-Finanzendpunkte und verweigert Weiterleitungen. Der normale Stripe-Testmodus bleibt unverändert. Der bestehende eingeschränkte Schlüssel wird serverseitig wiederverwendet.

Prüfungen: neun gezielte Finanz-/Transporttests erfolgreich, TypeScript für Quellcode und Tests erfolgreich (bekannte doppelte generierte Next-Typen ausgeschlossen). Ein direkter lesender Integrationsabruf des Finanzservices gegen die originale Supabase-Zuordnung und Stripe lieferte `complete=true`, EUR und keine Datenqualitätswarnungen. Das ersetzt keine vollständige Prüfung aller Familien. Die E-Mail bleibt unveränderbar. Kein Commit, Push oder App-Deployment.


## 22. Profilanpassungen am 09.10.2026

- Elternliste standardmäßig auf Familien mit mindestens einem zugeordneten, nicht archivierten Kind mit synchronisiertem Stripe-Abostatus `active` beschränkt. Filterung vor Pagination; Checkbox schließt Eltern ohne aktives Abo zusätzlich ein.
- Prüfung ergab: Bisher wurden nur importierte Berechtigungszeiträume addiert. Die Originaldatenbank hat ältere Stripe-Startdaten (ab Juli 2025), während Berechtigungszeiträume erst ab März 2026 vorliegen. Nach Nutzerentscheidung zählt jedes Kind einmal: abgeschlossene Monate seit dem frühesten belegten Stripe-Abo, einschließlich Pausen, dann Summe der Kinder. Quelle ist das synchronisierte `subscription_created_at` für aktive oder durch aktive Zeiträume belegte Abos; fehlende Startdaten fallen auf belegte Berechtigungszeiträume zurück. Dies ist keine Rekonstruktion eines unbekannten ersten Zahlungsdatums oder einer Trial-Endzeit.
- Bronze 0–3, Silber 4–8, Gold 9–12, Ultimativ ab 13 Monaten. Ultimativ bleibt über 18 hinaus bestehen. Neon-gelber Metallverlauf mit dunklem Hintergrund und dezentem Glanz.
- Finanzabruf nur für Admins automatisch 1500 ms nach Client-Render. Timer/Request werden beim Verlassen abgebrochen; manueller Button dient Aktualisierung oder Wiederholung.
- 23 gezielte Unit-/Finanztests und Quellcode-Typecheck bestanden. Read-only Integration mit Original-Supabase erfolgreich; Stichprobe liefert elf Mitgliedsmonate. Gezielter Browsertest bestätigt Checkbox und exakt verzögerten automatischen Finanzabruf. Kein Commit, Push oder Deployment.


### Korrigierte Statusgrenzen

Nach Nutzerkorrektur gelten Bronze ab 3, Silber ab 6, Gold ab 10 und Ultimativ ab 16 abgeschlossenen Familienmonaten. Unter drei Monaten wird neutral „Auf dem Weg zu Bronze“ angezeigt. Fortschritt und Grenzwerttests wurden angepasst; die Monatsberechnung bleibt unverändert.


### Sortierung der Elternliste

Sortierauswahl A–Z (Standard), Platzierung nach Gesamtmonaten absteigend und Neu–Alt nach Erstellungsdatum des Elternprofils. Suche und Aktivfilter bleiben erhalten, ein Sortierwechsel startet auf Seite 1. Monatsrangliste wird serverseitig vor Pagination berechnet, bei Gleichstand nach Name und ID sortiert. Begrenzte vollständige Abfrage mit ausdrücklichem Fehler bei zu großer Datenmenge statt falscher Teilrangliste. Gesamtmonate werden in der Liste angezeigt. Original-Supabase lesend geprüft: 86 passende Familien ohne Duplikate über Seitengrenzen korrekt absteigend. Quellcode-Typecheck erfolgreich.


### Kinderkarten: Verwaltung, Design und Stempelkarten

- Admins können Vorname, Nachname, Geburtsjahr und Altersklasse direkt im zugrunde liegenden Kinderprofil bearbeiten. Strikte Eingabevalidierung und Prüfung der Eltern-Kind-Zuordnung vor jeder Änderung; Eltern und Team dürfen diese Aktionen nicht ausführen.
- „Kind vom Elternteil lösen“ steht neben Archivieren. Bestätigungsdialog erklärt Zugriffsverlust, Erhalt von Kinderprofil/Historie und unveränderte Abos/Buchungen. Die bestehende auditierte `unlink_parent_player`-RPC entfernt ausschließlich die gewählte Zuordnung; erneutes Verknüpfen bleibt möglich. Keine neue Datenbankmigration.
- Kinderkarten nach aktuellem Produkt: FirstTouch schwarz, GameChanger lila, Pro/Next Level neon; ohne aktuelles Produkt neutral. Mehrere Produkte verwenden die höchste passende Variante. Runde Initialen aus Vor- und Nachname, Glanzanimation innerhalb der Karte im 10-Sekunden-Takt, abgeschaltet bei `prefers-reduced-motion`.
- Unten native Kinderauswahl im iOS-Stil und Link zur Stempelkarte. Kind wird in der Zielansicht nur aus den bereits autorisierten Spielern ausgewählt.
- Gezielte Tests: fünf Rechte-/Validierungs-/Designzuordnungstests bestanden; isolierter Browsertest prüft Stammdatenänderung, Abbrechen/Bestätigen des Lösens, Erhalt des Kindes, erneute Verknüpfung und Stempelkarten-Vorauswahl. Test-Stammdaten wiederhergestellt. TypeScript-Prüfung erfolgreich. Alle drei Farbvarianten visuell geprüft, Mobilansicht ohne horizontalen Seitenüberlauf, Animation 10s und Reduced-Motion-Abschaltung im Browser bestätigt. Screenshots unter `output/premium-child-desktop.png` und `output/premium-child-mobile.png` mit fiktiven Demodaten. Nur lokal, kein Commit/Push/Deployment.


### Filterzustand innerhalb der Elternprofile

Suche, Sortierung, Anzeige inaktiver Abos und Seite liegen nun in einem Client-Provider über den Seiten. Beim Öffnen eines Profils oder seiner Einheiten sowie bei Rückkehr per Profilnavigation oder Browser-Zurück bleiben die Werte erhalten. Navigation zu einem anderen Menübereich, Rollenbereich oder Login setzt sie zurück; keine dauerhafte Browser-Speicherung. Ein vollständiger Seiten-Neustart beginnt ebenfalls mit Standardwerten. Gezielter E2E-Test prüft Seite 2 mit Suche, Monatsrangfolge und inaktiven Abos, beide Rückwege sowie Reset nach Besuch der Verwaltung. TypeScript-Quellcodeprüfung erfolgreich.


### Eltern bearbeiten eigene Kinderdaten (10.10.2026)

Eltern können bei ihren aktuell verknüpften, nicht archivierten Kindern Vorname, Nachname, Geburtsjahr und Altersklasse bearbeiten. UI und API sind freigegeben, während Archivieren und Lösen Admin-Funktionen bleiben. Neue schmale RPC `update_own_child_profile` prüft auth.uid, Elternrolle, aktive Eltern-Kind-Zuordnung und Eingabefelder; sie hält die Zuordnung während der Änderung gesperrt und nutzt die bestehende Auditierung. Keine allgemeine UPDATE-Policy für Eltern. Migration `202610100001_parent_child_edit` nach gezielten Tests auf der isolierten lokalen DB und der original angebundenen `proacademy-portal-test`-Instanz angewendet und dort registriert.

Prüfungen: 12 gezielte Unit-/DB-Sicherheitstests sowie Eltern-Browsertest erfolgreich (eigene Daten speichern, fremdes Kind abweisen, Lösen verbieten). Die lokale Teständerung wurde zurückgesetzt. TypeScript-Quellcodeprüfung erfolgreich. Kein App-Deployment, Commit oder Push.


### Produktionsfreigabe vorbereitet (10.10.2026)

Der Nutzer hat Commit/Push auf `Profile`, Übernahme nach `main` und Deployment autorisiert. Beide Profilmigrationen sind in der originalen Produktionsdatenbank registriert. Die Finanzübersicht nutzt einen Stripe-Kontozugang für sämtliche Kundenzahlungen einschließlich Camps; mehrere eingeschränkte Schlüssel desselben Kontos werden nicht als getrennte Zahlungsquellen behandelt. Ein lesender Produktionsabruf liefert vollständige Finanzdaten ohne Warnungen.

Releaseprüfung in isolierter Kopie: 44 Testdateien / 521 Tests erfolgreich; 11 relevante Desktop-/Mobil-Browsertests erfolgreich, drei doppelte mobile Mutationstests absichtlich übersprungen. Cloudflare-Produktionsbuild einschließlich TypeScript erfolgreich. Sicherheitsupdates innerhalb bestehender Versionsbereiche (u. a. Next 16.4.0, Nodemailer 10.0.16, Wrangler 4.149.0); npm audit meldet null bekannte Schwachstellen. Bestehende Produktionsvariablen und Secret-Bindings bleiben erhalten. Veröffentlichung auf dem vorhandenen workers.dev-Portal; Jobs-Runner und eigene Domain sind nicht Teil dieses Releases.
