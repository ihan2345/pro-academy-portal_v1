# ProAcademy | Docker

Stand: 10.09.2026.

[PDF öffnen](06-Docker.pdf)

## 1. Das Werkzeug für den Hintergrunddienst

**ÜBERBLICK FÜR ALLE**

Docker verpackt den Hintergrunddienst mit seiner Laufzeit in ein ausführbares Paket. Dieses Paket wird bei Cloudflare als Container gestartet, wenn ein berechtigter Aufruf das erfordert.

| Begriff | Einfach erklärt |
| --- | --- |
| Docker Desktop | Das lokale Programm auf dem Mac. |
| Image | Das gebaute Paket mit dem Hintergrunddienst. |
| Container | Eine laufende Ausführung dieses Pakets. |
| Dockerfile | Die Bauanleitung für das Paket. |
| Cloudflare Container | Die Ausführung in der Cloud, unabhängig vom lokalen Mac. |

> **Docker ergänzt die externen Plattformen.** Es ist ein lokales Betriebswerkzeug. Ein ausgeschalteter Mac beendet nicht die bereits veröffentlichte Webapp bei Cloudflare.

Coaches brauchen Docker nicht für ihre tägliche Arbeit. Die technische Administration benötigt es insbesondere beim Bauen und Veröffentlichen des Container-Hintergrunddienstes.

Die Bauanleitung dieses Projekts liegt in **workers/Dockerfile**. Die Cloud-Konfiguration liegt in **workers/cloudflare/wrangler.jsonc**.

## 2. Lokal und in der Cloud unterscheiden

**ADMINISTRATION**

1. **Auf dem Mac:** Docker Desktop startet die lokale Container-Umgebung. Ein offenes Fenster allein genügt nicht; Docker muss betriebsbereit sein.

2. **Beim Bauen:** Die Projektdateien werden nach der Dockerfile-Anleitung zu einem Image verarbeitet. Geheime Zugangsdaten gehören nicht in dieses Paket.

3. **Bei der Veröffentlichung:** Wrangler baut beziehungsweise überträgt das Container-Image für den Cloudflare-Hintergrunddienst. Dieser Schritt veröffentlicht und braucht einen entsprechenden Auftrag.

4. **Im Cloudbetrieb:** Der Worker steuert den Container. Der derzeitige Aufbau erlaubt höchstens eine Instanz. Automatische Jobverarbeitung ist aktuell gesperrt.

> Ein Container, der nach erledigter Arbeit stoppt oder wegen gesperrter Jobs gar nicht startet, ist in diesem Projekt nicht automatisch ein Fehler.

### Was Docker nicht ersetzt

Die Datenbank bleibt in Supabase. Abos bleiben in Stripe. Der Mailversand läuft über Proton. Die öffentliche Portaladresse wird über Cloudflare bereitgestellt.

Auch ein erfolgreich gebautes Image bestätigt noch keinen Eltern-Login, keine korrekte Kindzuordnung und keinen tatsächlichen Mail-Eingang. Diese Abläufe werden separat geprüft.

Quelle / Grundlage: Projektgrundlage: workers/Dockerfile, workers/cloudflare/index.ts und workers/cloudflare/wrangler.jsonc.

## 3. Docker einfach prüfen

**ADMINISTRATION**

**Technische Administration am Mac:** Der erste Befehl öffnet Docker Desktop. Warte, bis Docker bereit ist. Die weiteren Befehle zeigen nur den lokalen Zustand.

```sh
open -a Docker
docker info --format '{{.ServerVersion}}'
docker ps
docker ps -a
docker images
```

| Befehl | Ergebnis |
| --- | --- |
| docker info | Prüft die Verbindung zur lokalen Docker-Umgebung. |
| docker ps | Zeigt lokal laufende Container. |
| docker ps -a | Zeigt auch lokal gestoppte Container. |
| docker images | Zeigt die lokal vorhandenen Images. |

Quelle / Grundlage: [Docker: Container auflisten](https://docs.docker.com/reference/cli/docker/container/ls/)

> Eine leere Liste bei docker ps bedeutet nur, dass lokal kein Container läuft. Die Container bei Cloudflare erscheinen dort nicht.

**Cannot connect to the Docker daemon:** Docker Desktop starten und den Start abwarten. Bleibt der Fehler, den lokalen Docker-Status prüfen lassen. Nicht Supabase-Zugangsdaten ändern.

Diese Befehle verarbeiten keine Portal-Aufträge und senden keine Trainingsmails.

## 4. Build, Fehler und Abschlussprüfung

**ADMINISTRATION**

### Lokale Prüfung des Hintergrunddienstes

Im Projektordner ausführen. Diese beiden Projektbefehle bauen beziehungsweise prüfen den Runner-Code lokal; sie starten keinen Versand und veröffentlichen kein Cloud-Image.

```sh
npm run build:jobs
npm run typecheck:jobs
```

### Wenn etwas nicht funktioniert

| Problem | Nächster sinnvoller Schritt |
| --- | --- |
| Docker nicht erreichbar | Docker Desktop und docker info prüfen. |
| Build bricht ab | Erste konkrete Fehlermeldung im Build-Protokoll prüfen lassen. |
| Cloud-Job antwortet mit 503 | Zuerst die absichtliche Jobsperre prüfen, nicht lokal Docker neu installieren. |
| Mail fehlt trotz Docker | Mailauftrag, Anbieter und Empfänger prüfen; siehe Proton-Handbuch. |

> Das Aufräumen von Docker-Volumes oder kompletten Umgebungen kann lokale Daten entfernen. Für einfache Verbindungsfehler sind solche Löschbefehle nicht erforderlich.

- [ ] Docker betriebsbereit; lokale Prüfungen erfolgreich.

- [ ] Build und Veröffentlichung klar unterschieden.

- [ ] Falls veröffentlicht: Jobs-Version und Cloud-Protokolle geprüft.

- [ ] Versand bleibt nur im ausdrücklich freigegebenen Umfang aktiv.

Der genaue Veröffentlichungsbefehl steht im Cloudflare-Handbuch. Dafür gibt es keine zusätzliche automatische Freigabe durch einen erfolgreichen Docker-Start.
