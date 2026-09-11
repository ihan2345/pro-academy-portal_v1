# ProAcademy | Proton Mail

Stand: 10.09.2026.

[PDF öffnen](04-Proton-Mail.pdf)

## 1. Der Versanddienst für E-Mails

**ÜBERBLICK FÜR ALLE**

Proton stellt den Absender für die Portal-Mails bereit. Ob eine Mail entstehen soll und an wen sie geht, entscheidet zuvor Supabase Auth oder der Portal-Hintergrunddienst.

[Proton Mail öffnen](https://mail.proton.me)

| Einrichtung | Bei ProAcademy |
| --- | --- |
| Verwaltendes Postfach | service@proacademy-ak.com |
| Vorgesehener Absender | billing@proacademy-ak.com |
| Anzeigename | ProAcademy |
| Versandserver | smtp.protonmail.ch |
| Port und Verbindung | 587 mit STARTTLS |
| SMTP-Benutzer | billing@proacademy-ak.com |

> Die Absenderadresse billing@ gehört zur bestehenden Proton-Einrichtung. Ein SMTP-Token ist ein eigener Zugang für einen Dienst; es ist nicht das normale Passwort des Postfachs.

Für Mitarbeiter genügt meist die Prüfung: richtige Empfängeradresse, Betreff, Zeitpunkt und Anhang. Änderungen an Tokens und Servereinstellungen übernimmt die zuständige Administration.

## 2. Zwei getrennte Wege zur Mail

**ADMINISTRATION**

### 1. Anmeldung per Login-Link

Supabase Auth verwendet die in Supabase hinterlegten SMTP-Zugangsdaten. Deshalb kann eine Login-Mail funktionieren, obwohl der Hintergrunddienst für Trainingsmails gesperrt ist.

### 2. Einladungen, Training und PDF

Elterneinladungen und Trainingsmails werden als Aufträge in Supabase gespeichert. Der Hintergrunddienst verarbeitet sie später. Nur mit freigegebenem Versand und passender Konfiguration übergibt er die Mail tatsächlich an Proton.

| Zugang | Verwendung |
| --- | --- |
| ProAcademy Supabase Auth | Eigener SMTP-Token in den Supabase-Auth-Einstellungen. |
| ProAcademy Portal Jobs | Separater SMTP-Token für den Hintergrunddienst. In dessen sicherer Konfiguration: PROTON_SMTP_TOKEN. |

> Die Tokens getrennt benennen. So lässt sich ein defekter Zugang austauschen, ohne versehentlich beide Versandwege gleichzeitig zu unterbrechen.

**Aktueller Stand:** Die allgemeine Portal-Verarbeitung ist gesperrt, der Mailanbieter steht auf capture. Frühere gezielte Testmails belegen die getestete Zustellung, aber keinen aktivierten allgemeinen Elternversand.

Eine erfolgreiche SMTP-Verbindungsprüfung meldet nur, dass der Versandzugang erreichbar ist. Den tatsächlichen Eingang und einen PDF-Anhang prüft man im vorgesehenen Testpostfach.

Quelle / Grundlage: Projektgrundlage: docs/LAUNCH-SETUP.md, workers/cloudflare/wrangler.jsonc und docs/ARCHITECTURE.md.

## 3. Einen SMTP-Token austauschen

**ADMINISTRATION**

**Nur bei Bedarf durch die Administration.** Bestehende Tokens nicht vorsorglich löschen. Ein Austausch kann die Anmeldung oder den Mailversand betreffen.

1. In Proton die Einstellungen und anschließend alle Einstellungen öffnen. Unter IMAP/SMTP den Bereich für SMTP-Tokens aufrufen.

2. Einen neuen Token erzeugen, eindeutig nach Dienst benennen und die Absenderadresse billing@proacademy-ak.com auswählen.

3. Den Token geschützt übernehmen. Für Login-Mails wird er in Supabase Auth / SMTP aktualisiert. Für Portal-Mails wird der Zugang des Hintergrunddienstes aktualisiert.

4. Den betroffenen Weg gezielt prüfen: technische Verbindung und, nach entsprechender Freigabe, eine Mail an das eigene Testpostfach. Den alten Token erst danach widerrufen.

Quelle / Grundlage: [Proton: SMTP submission und Tokens](https://proton.me/support/smtp-submission)

### Konfigurationswerte zum Nachschlagen

```text
PROTON_SMTP_HOST=smtp.protonmail.ch
PROTON_SMTP_PORT=587
PROTON_SMTP_USER=billing@proacademy-ak.com
EMAIL_FROM="ProAcademy <billing@proacademy-ak.com>"
```

> Das sind Einstellungsnamen, kein vollständiger Einrichtungsbefehl. Der geheime Token gehört in die geschützte Konfiguration, niemals in dieses Handbuch, einen Screenshot oder GitHub.

## 4. Wenn eine Mail fehlt

**ADMINISTRATION**

1. **Postfach prüfen:** Stimmen Adresse und Schreibweise? In allen Nachrichten, Spam und automatisch sortierten Kategorien nach dem Betreff suchen.

2. **Art der Mail klären:** Bei Login-Mails prüft die Administration Supabase Auth und die Login-Testfreigabe. Bei Elterneinladungen und Trainingsmails prüft sie den Auftrag und Versandversuch in Supabase.

3. **Aktuelle Versandregeln prüfen:** Wartet der Auftrag? Sind Jobs gesperrt? Steht der Anbieter auf capture? Wurde die Mail an den freigegebenen Testempfänger umgeleitet?

4. **Fehler eingrenzen:** Absender, SMTP-Zugang und das Ergebnis des Versandversuchs prüfen lassen. Bei uncertain nicht sofort erneut senden; die erste Mail könnte bereits angekommen sein.

### Was Mitarbeiter melden sollten

Mailart, erwarteter Empfänger, ungefährer Versandzeitpunkt, betroffener Termin oder Berichtszeitraum und ob ein Anhang fehlt. Keine Passwörter oder Einladungslinks weiterreichen.

> Eine Änderung an SPF, DKIM oder DMARC betrifft die Zustellbarkeit der Domain. Das sind Einstellungen für die Administration und kein erster Schritt bei einer einzelnen fehlenden Mail.

- [ ] Richtige Adresse und alle Postfachbereiche geprüft.

- [ ] Login-Mail oder Portal-Mail eindeutig unterschieden.

- [ ] Warteschlange, Anbieter und Testempfänger geprüft.

- [ ] Empfang und PDF-Anhang nach einem freigegebenen Test bestätigt.
