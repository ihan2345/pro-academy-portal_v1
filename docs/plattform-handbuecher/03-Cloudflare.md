# ProAcademy | Cloudflare

Stand: 10.09.2026.

[PDF öffnen](03-Cloudflare.pdf)

## 1. Hier läuft das Portal online

**ÜBERBLICK FÜR ALLE**

Cloudflare stellt die veröffentlichte Webapp bereit. Außerdem läuft dort der Hintergrunddienst, der freigegebene Aufträge verarbeitet.

[Cloudflare-Konto öffnen](https://dash.cloudflare.com/7300475f02c8b8793bb7e6250d0d4690/workers-and-pages)

| Dienst | Aufgabe |
| --- | --- |
| proacademy-portal | Webseiten, Anmeldung im Portal und Schnittstellen. |
| proacademy-jobs | Geschützter Zugang zum Hintergrunddienst und dessen Container. |

> **Aktuelle Portaladresse:** [ProAcademy-Portal öffnen](https://proacademy-portal.proacademy-by-ak.workers.dev)
Die offizielle Adresse portal.proacademy-ak.com bleibt deaktiviert. Keine Custom Domain oder Portal-Route dafür anlegen.

In der Übersicht zuerst das richtige Konto wählen. Die Konto-ID endet auf **d0d4690**. Anschließend den gewünschten Worker öffnen; Portal und Hintergrunddienst haben eigene Einstellungen.

**Für Mitarbeiter:** Wenn die Webapp nicht erreichbar ist, Adresse, Uhrzeit und Fehlermeldung an die Administration geben. Ein neuer Termin oder eine Datenkorrektur in Supabase braucht normalerweise keine neue App-Veröffentlichung.

## 2. Die aktuellen Schalter verstehen

**ADMINISTRATION**

| Einstellung | Aktueller Zweck |
| --- | --- |
| JOBS_ENABLED=false | Automatische Jobverarbeitung gesperrt. |
| MAIL_PROVIDER=capture | Portal-Mails erfassen statt über SMTP versenden. |
| EMAIL_TEST_MODE=true | Testregeln für den Versand aktiv. |
| EMAIL_TEST_RECIPIENT | Vorgesehener Testempfänger für Portal-Mails. |
| AUTH_TEST_EMAILS | Zusätzlich freigegebene Login-Testadressen. |
| workers_dev=true / routes=[] | Worker-Link aktiv; keine konfigurierte Portal-Domainroute. |

Der Zeitplan ist alle zehn Minuten eingerichtet. Solange **JOBS_ENABLED=false** gilt, führt er keine reguläre Verarbeitung aus. Ein Zeitplan allein bedeutet daher nicht, dass E-Mails gesendet werden.

> **Login-Mails sind separat:** Supabase kann für freigegebene Testkonten Login-Mails senden, während die Portal-Warteschlange gesperrt bleibt.

Nicht nur einen Schalter umlegen, um einen Fehler auszuprobieren: Nach einer Aktivierung können auch ältere fällige Aufträge verarbeitet werden. Erst Warteschlange, Empfänger und Freigabe prüfen.

Quelle / Grundlage: Projektgrundlage: wrangler.jsonc, workers/cloudflare/wrangler.jsonc und workers/cloudflare/index.ts.

## 3. Status prüfen, ohne zu veröffentlichen

**ADMINISTRATION**

**Technische Administration:** Terminal im Projektordner öffnen. Die folgenden Befehle zeigen Konto und veröffentlichte Versionen an; sie veröffentlichen keine neue App.

```sh
npx wrangler whoami
npx wrangler deployments list --env production
```

Die Versionen des Hintergrunddienstes werden separat abgefragt:

```sh
npx wrangler deployments list \
  --config workers/cloudflare/wrangler.jsonc
```

Quelle / Grundlage: [Cloudflare: Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)

| Beobachtung | Einordnung im Projekt |
| --- | --- |
| Loginseite erreichbar (200) | Webseite erreichbar; noch kein vollständiger Login-Test. |
| Weiterleitung zum Login (307) | Bei geschützten Seiten ohne Anmeldung normal. |
| 401 oder 403 | Anmeldung, Rolle oder Anfrageberechtigung prüfen. |
| Jobs /run liefert 503 | Bei gesperrten Jobs erwartetes Ergebnis. |

> **/verify und /run sind verschieden:** Der geschützte POST-Aufruf /verify prüft Verbindungen und PDF-Erzeugung ohne Versand oder Datenänderung. /run kann echte Aufträge verarbeiten. Nur die Administration verwendet diese Endpunkte mit dem geheimen Zugang.

Worker-Protokolle im Dashboard helfen bei Fehlern. Keine Tokens, vollständigen Login-Links oder personenbezogenen Protokolle in öffentliche Nachrichten kopieren.

## 4. Veröffentlichen: nur nach Befehl

**ADMINISTRATION**

**Diese Seite ist eine technische Ablaufhilfe, keine aktuelle Freigabe.** Veröffentlichung nur nach ausdrücklichem Deploy-Befehl. Zuerst Änderungen und Prüfungen abschließen.

1. **Lokal prüfen:** Im Projektordner Typprüfung und Tests ausführen. Bei Änderungen am Hintergrunddienst dessen Build und Typprüfung ergänzen.

```sh
npm run typecheck
npm test
npm run build:jobs
npm run typecheck:jobs
```

2. **Portal bauen:** Die Worker-Adresse muss auch beim Build gesetzt sein. Der Build erzeugt zunächst nur lokale Dateien.

```sh
portal_url='https://proacademy-portal.proacademy-by-ak.workers.dev'
NEXT_PUBLIC_APP_URL="$portal_url" \
APP_URL="$portal_url" NEXT_PUBLIC_DEMO_MODE=false \
npm run build:cloudflare -- --env production
```

3. **Freigegebene Version veröffentlichen:** Bei geändertem Hintergrunddienst muss Docker laufen. Die beiden Ziele werden getrennt veröffentlicht.

```sh
npx wrangler deploy \
  --config workers/cloudflare/wrangler.jsonc
npx wrangler deploy --env production
```

> Beim Portal ist **--env production** erforderlich. Ohne diese Angabe zeigt die Standardkonfiguration auf einen anderen Worker. Ein Rollback setzt Programmcode zurück, aber keine Datenbank und keine bereits versendeten Mails.

- [ ] Worker-Link, Login und betroffene Funktion nach Veröffentlichung geprüft.

- [ ] Versionsnummern dokumentiert; Domain und Versandschalter unverändert geprüft.

Quelle / Grundlage: Projektgrundlage: package.json und beide Wrangler-Konfigurationen.
