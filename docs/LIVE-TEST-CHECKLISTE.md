# ProAcademy – Checkliste des Livetests

Stand: 10. September 2026. Testkennung: **LIVE-TEST-20260910-BECKER**.

Die Daten liegen im tatsächlichen Supabase-Projekt. Terminplanung und Statusänderungen wurden über die veröffentlichte Cloudflare-Portal-API ausgeführt. Die automatische Bestätigung wurde gezielt über die echte Supabase-Funktion geprüft. PDF-Erstellung und die vier einzeln ausgewählten Versandaufträge liefen vom lokalen Prüfprozess gegen Supabase Storage und Proton SMTP. Der automatische Cloudflare-Hintergrundlauf wurde dabei **nicht** aktiviert oder als erfolgreich getestet ausgegeben.

## Stammdaten und Beispiel

| Eintrag | Inhalt | Nach dem Test |
| --- | --- | --- |
| Coach | Muhsin Ayhan, proacademy.by.ak@gmail.com, Rolle Mitarbeiter | Behalten; Adminzugang ayh.kaan@icloud.com bleibt separat erhalten |
| Trainingsort | Sportzentrum Schürenkamp, Grenzstraße 1, 45881 Gelsenkirchen, Deutschland | Behalten |
| Test-Elternteil | Daniel Becker · LIVE-TEST, ayh.kaan@googlemail.com | Nach Abnahme bereinigen |
| Testkind | Leon Becker · LIVE-TEST, Jahrgang 2015, U12 | Nach Abnahme bereinigen |
| Tarif | Academy Pass Game Changer, Bestandstarif, 8 Einheiten je Monatszeitraum | Testzuordnung entfernen; Originalprodukt behalten |
| Laufender Zeitraum | 12.08.–11.09.2026, Ende exklusiv 12.09.2026 um 00:00 Uhr Berlin | 6 absolviert / 360 Minuten, 1 entschuldigt, 1 geplant |
| Kommender Termin | 11.09.2026, 17:00–18:00 Uhr Berlin, Spielformen & Anwendung | Sichtbar und noch nicht absolviert |
| Abgeschlossener Zeitraum | 12.07.–11.08.2026 | 7 von 8 Einheiten / 420 Minuten; Bericht vorhanden |

Insgesamt 16 Beispieltrainings. Die Stripe-Kunden-, Abo- und Item-Referenzen dieses Beispiels sind ausdrücklich synthetisch; es wurden keine echten Stripe-Kunden, Abonnements, Rechnungen oder Zahlungen angelegt. Ein zusätzliches archiviertes Kontrollkind dient ausschließlich dem Test fremder Zugriffsrechte und gehört ebenfalls zur Bereinigung.

## Technische Ergebnisse

- [x] Coachprofil und echter Standort in Supabase vorhanden.
- [x] Die bestehende Adminrolle wurde nicht in eine Mitarbeiterrolle umgewandelt.
- [x] Beispielfamilie, Kind und zwei Leistungszeiträume angelegt und verknüpft.
- [x] Historische Trainings und kommende Planung über die Cloudflare-API gespeichert.
- [x] Planungsmail für den zukünftigen Termin erzeugt und versendet.
- [x] Automatische Bestätigung mit tatsächlicher Supabase-Funktion geprüft: Training 08.09., Ende 18:00 Uhr; Frist 09.09., 12:00 Uhr Berlin.
- [x] Eine Millisekunde vor dieser Frist: keine Bestätigung; an der Frist: genau eine; Wiederholung: keine weitere. Die Nachtpause 00:00–06:00 Uhr ist berücksichtigt.
- [x] Abschlussmail nach automatischer Bestätigung erzeugt und versendet.
- [x] Vergangene Teilnahme vom 01.09. über die API auf „entschuldigt“ korrigiert und Korrekturmail versendet.
- [x] Kontingent danach korrekt: 6 absolvierte Einheiten, 360 Minuten; entschuldigter und zukünftiger Termin zählen nicht als absolviert.
- [x] Vorzeitige Bestätigung des zukünftigen Trainings wird abgewiesen.
- [x] Vormonatsbericht aus echten Supabase-Daten erstellt, als PDF im privaten Storage abgelegt und per E-Mail versendet.
- [x] Bericht enthält 7 von 8 Einheiten und 420 Minuten; PDF mit Original-Logo visuell geprüft, keine abgeschnittenen Inhalte.
- [x] Erneute Berichtsanforderung liefert denselben Snapshot, keine doppelte Version.
- [x] Mit echtem Eltern-JWT: eigenes Kind sichtbar, fremdes Kontrollkind nicht lesbar und nicht änderbar, interne Trainernotizen verborgen.
- [x] Elternzugriff auf Admin-API: HTTP 403; Adminseite leitet zur Elternstartseite um.
- [x] Elternstartseite, Termine, Stempelkarte und Berichte mit echter Elternsitzung: HTTP 200.
- [x] PDF-Download als Elternteil: signierte Weiterleitung und HTTP 200; unangemeldeter Zugriff: HTTP 401.
- [x] Vier ausgewählte Benachrichtigungsaufträge stehen in Supabase auf „sent“, jeweils genau ein Versandversuch.
- [x] Empfänger aller vier Trainings-/Berichtsmails ist ausschließlich ayh.kaan@icloud.com.
- [x] Eingang der Planungsmail und des PDF-Berichts anhand der Nutzerrückmeldung und Screenshots bestätigt.
- [x] Auch Abschluss- und Korrekturmail empfangen. Der Nutzer hat alle vier Mails gefunden; die zwischenzeitliche Unklarheit entstand durch die Postfachansichten „Wichtiges“ und „Alle Mails“.
- [x] Lokale Anpassung für separate Test-Anmeldeadressen: Typprüfung, 118 Tests und Cloudflare-Build erfolgreich.

Die technischen Elternprüfungen verwenden einen von Supabase erzeugten, im Prüfprozess verifizierten Einmaltoken. Das ersetzt **nicht** den noch offenen Login aus dem E-Mail-Postfach im Browser.

## Versand und bestätigter Postfacheingang

Absender: **ProAcademy <billing@proacademy-ak.com>**. Empfänger: **ayh.kaan@icloud.com**. Zeiten: Europe/Berlin.

| Versand | Betreff | Versandprotokoll | Postfach bestätigt |
| --- | --- | --- | --- |
| 10.09., 12:27 | Training geplant: Leon am 11.09.2026 | Proton, 1 Versuch, sent | Ja |
| 10.09., 12:29 | Training absolviert: Leon | Proton, 1 Versuch, sent | Ja |
| 10.09., 12:29 | Training aktualisiert: Leon | Proton, 1 Versuch, sent | Ja |
| 10.09., 12:29 | Dein Trainingsbericht für Leon Becker · LIVE-TEST | Proton, 1 Versuch, sent; PDF-Anhang | Ja, inklusive PDF |

Versandbelege erneut geprüft: vier unterschiedliche Message-IDs, jeweils genau ein Versuch an dieselbe iCloud-Adresse, kein protokollierter SMTP-Fehler. Der Eingang aller vier Mails inklusive PDF wurde anschließend vom Nutzer ausdrücklich bestätigt.

### Einmalige zusätzliche Kopien an Hotmail

Auf ausdrückliche Nutzeranweisung wurden dieselben vier Mails separat und genau einmal an **muhsin_ayhan@hotmail.de** gesendet. Die gespeicherten ursprünglichen HTML- und Textinhalte wurden unverändert wiederverwendet; der PDF-Anhang ist anhand seines SHA-256-Werts mit dem Original im Supabase-Speicher abgeglichen. Vier neue eindeutige Versandaufträge und Message-IDs, jeweils ein erfolgreicher Proton-Versandversuch. Der Eingang im Hotmail-Postfach ist noch nicht bestätigt.

Diese Ausnahme galt ausschließlich für den einmaligen Versandprozess. `.env.local`, Cloudflare-Konfiguration und die dauerhafte Empfängerbegrenzung wurden dafür nicht geändert. Die acht Versandaufträge (vier Originale und vier Kopien) sind im privaten Testmanifest für die spätere Bereinigung erfasst.

## Noch gemeinsam abzunehmen

- [x] Persönliche Einladung an `ayh.kaan@googlemail.com` erzeugt und einmalig per Proton versendet (Betreff „Deine Einladung zur ProAcademy“). Es existierte zuvor keine Einladung. Eltern-/Kindzuordnung und Adminrolle unverändert; Einladung noch nicht angenommen. Ihr Postfacheingang ist noch zu bestätigen.

- [x] Anpassung für Googlemail-Testanmeldung nach ausdrücklicher Freigabe auf Cloudflare veröffentlicht. Adminanmeldung über iCloud bleibt möglich; die allgemeine Versandbegrenzung ist unverändert.
- [ ] Als ayh.kaan@googlemail.com über eine tatsächlich empfangene Login-Mail im Browser anmelden und Leon, Kontingent, nächsten Termin und Bericht selbst prüfen.
- [ ] Sitzung nach Neuladen sowie nach tatsächlichem Ablauf/Erneuerung prüfen. Die zuvor beobachtete erneute Anmeldeaufforderung auf Cloudflare ist noch nicht abschließend erklärt.
- [x] Separates Coachkonto für Muhsin Ayhan unter `proacademy.by.ak@gmail.com` mit Rolle `staff` angelegt. Alle 16 Beispieltrainings zugeordnet; Trainingsinhalte und Teilnahmen unverändert geprüft. Altes Coachprofil deaktiviert, bestehende Adminrolle und Elternkonto unverändert.
- [x] Neue Coachadresse nach ausdrücklicher Freigabe auf Cloudflare für das Login freigegeben (10.09.2026, Worker-Version `0f7a9c95-e0f3-4f42-af6a-68be9e98804a`). Loginseite HTTP 200; regulärer Benachrichtigungsempfänger unverändert iCloud.
- [x] Einladung „Deine Einladung zum ProAcademy-Coachportal“ einmalig per Proton an `proacademy.by.ak@gmail.com` gesendet, Versandauftrag `sent`, ein Versuch. Link zur Anmeldung; persönlichen Magic Link fordert der Coach dort selbst an.
- [ ] Eingang der Coach-Einladung und anschließenden Login-Mail im Postfach bestätigen.
- [ ] Mit dem separaten Coachkonto anmelden und Mitarbeiterrechte einschließlich gesperrter Admin-/Elternbereiche prüfen.
- [ ] Automatischer Cloudflare-Hintergrundlauf einschließlich Container-Versand: bleibt bewusst deaktiviert und ist durch die einzelnen SMTP-Tests nicht abgenommen.
- [ ] Tatsächliche Stripe-Abrechnung, Kundenportal und Stripe-Ereignisverarbeitung: nicht Teil dieses Beispiels; keine Zahlung ausgelöst.
- [ ] Nach Abnahme Testfamilie, Kontrollkind, Trainings, synthetische Abozuordnungen, Testberichte und Test-Authkonto gezielt bereinigen. Echten Coach, Standort, Originaltarife und Admin behalten.

## Nachvollziehbarkeit und Bereinigung

Alle erzeugten IDs, Prüfergebnisse und Versandbelege sind lokal unter `tmp/live-test/manifest.json` dokumentiert (ignoriert, Dateirechte 0600). Der konkrete Prüfablauf liegt daneben in `run.mts`. Einmal versandte Aufträge werden nicht automatisch wiederholt. Keine komplette Warteschlange wurde zum Versand freigegeben.

Die Haupt-Testdaten bleiben bis zur persönlichen Abnahme bestehen. Historische Snapshots und Versandbelege sind absichtlich gegen normales Löschen geschützt; die spätere gezielte Bereinigung muss mit dem nötigen SQL-Administratorzugang anhand der erfassten IDs erfolgen. Technische Audit-Einträge und bereits zugestellte E-Mails bleiben nachvollziehbar erhalten. Vor einer allgemeinen Job-Aktivierung müssen die Testdaten bereinigt sein.

Die offizielle Domain bleibt deaktiviert. Keine neuen Deployments ohne ausdrücklichen Befehl.

Die Einladung verwendet die Worker-Adresse. Die Googlemail-Freigabe für das dortige Login wurde am 10.09.2026 veröffentlicht (Anwendungscommit `bbb56e7`, Worker-Version `ab4ebb1b-0fc0-4b6c-a8e8-27d78277e528`). Beide Branches `start` und `main` enthalten die Anpassung. Geprüft: neue Anmeldesperre aktiv, nicht freigegebene Adresse vor Mailversand abgewiesen, Login HTTP 200, Hintergrundjobs weiterhin gesperrt. Die Einladung ist gültig und noch nicht verbraucht; Leon, seine 16 Trainings und sein Bericht sind unverändert vorhanden. Für die spätere Bereinigung ist die Einladung samt zusätzlichem Versandauftrag unter `parentInvitation` im privaten Testmanifest erfasst.

## Stempelkarten für Admin und Coach – lokal vorbereitet

- [x] Eigene Navigation `/admin/stempelkarten` und `/team/stempelkarten`; Eltern bleiben im eigenen Portal.
- [x] Kindersuche und Auswahl vorhandener Leistungszeiträume, einschließlich aktueller und vergangener Zeiträume.
- [x] Anzeige absolvierter, geplanter und offener Stempel, Trainingsübersicht sowie Fußball-/Athletik-Aufteilung.
- [x] PDF-Export mit aktuellem Datenstand, Original-Logo und Trainingsübersicht; vorhandene Monatsberichte bleiben unverändert.
- [x] Versandvorbereitung an einen ausgewählten, aktuell zugeordneten Elternkontakt. Keine frei eingegebene Zieladresse. Testempfängerbegrenzung bleibt bestehen.
- [x] Datenstand für den Mailanhang wird beim Vormerken gespeichert. Wiederholung derselben Versandanfrage erzeugt keinen zweiten Auftrag. Vor Verarbeitung wird die Elternzuordnung erneut geprüft.
- [x] Rollen-/Empfängertests, PDF-Erzeugung und Desktop-/Handy-Prüfung erfolgreich. Kein tatsächlicher Mailversand für diese neue Funktion ausgeführt.
- [ ] Nach ausdrücklichem Deploy-Befehl Portal und Hintergrunddienst mit dem neuen Stempelkarten-Versandtyp veröffentlichen. Der Hintergrunddienst bleibt bis zur separaten Freigabe deaktiviert.
- [ ] Anschließend PDF-Export und einen einzelnen freigegebenen Stempelkartenversand mit dem echten Coachkonto persönlich abnehmen.

Bedienung: **Stempelkarten → Kind und Leistungszeitraum wählen → PDF exportieren** oder **Empfänger auswählen → Per E-Mail vormerken**. Ein vorgemerkter Auftrag ist noch keine zugestellte E-Mail. Bei deaktiviertem Hintergrunddienst bleibt er ausstehend.
