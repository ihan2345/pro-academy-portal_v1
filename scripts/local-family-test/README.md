# Lokaler Test mit echten Zuordnungen

Dieser Test verwendet die normale Anwendung, Supabase Auth, Postgres und RLS. Die Daten werden aus dem bereits vorhandenen lokalen Snapshot importiert. Kein neuer Stripe-Abruf, keine Produktionsschlüssel, keine SMTP-Konfiguration, kein Job-Runner und kein Versanddienst.

Alle erzeugten Daten, Passwörter, Umgebungseinstellungen und die Testkopie liegen im ignorierten Verzeichnis `output/eltern-kind-lokal/`. Nicht hochladen oder veröffentlichen. Die eigentliche Anwendung erhält keine zusätzliche Anmeldeumgehung. Der Kontowechsel ist ausschließlich in der erzeugten lokalen Kopie vorhanden, auf Loopback beschränkt und verwendet echte lokale Passwortanmeldungen.

## Bereits eingerichteten Test starten

Im Repository:

```sh
npx --yes supabase start --workdir output/eltern-kind-lokal --network-id pabyak-family-loopback -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
python3 scripts/local-family-test/bind-loopback.py
```

Nach dem Start warten, bis Datenbank und Gateway gesund sind. Die Docker-Portprüfung ist erforderlich, da die verwendete CLI die Standardbindung des Netzwerkes nicht zuverlässig übernimmt. Das Hilfsskript ändert ausschließlich Container dieses lokalen Testprojektes und bewahrt Datenvolumes sowie Gatewaydateien.

Die App startet aus der lokalen Kopie:

```sh
cd output/eltern-kind-lokal/app
NODE_OPTIONS=--require=./network-guard.cjs ./node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port 3107
```

Öffnen: `http://127.0.0.1:3107/lokaler-test`. Dort Verwaltung oder Elternkonto auswählen. Änderungen bleiben in der lokalen Docker-Datenbank erhalten. Nicht `supabase db reset` ausführen, wenn lokale Änderungen erhalten bleiben sollen.

## Daten und Prüfungen

`seed.mjs` übernimmt 84 Familien, 91 Kinder, deren Stripe-Kunden/Abos/Positionen und die aus bekannten Preisen berechneten Leistungszeiträume. Geburtsjahre bleiben leer; Altersklassen werden nicht erfunden. Die bestätigten Sonderfälle aus `confirmed-decisions.json` werden berücksichtigt. Einladungen: 84 Jobs mit Status `held`, ohne Einladungstoken. Menzurs ursprüngliche Stripe-Menge 2 bleibt in den lokalen Quelldaten erhalten; sein Kontingent beträgt vorerst ein Paket mit 4 Einheiten. Sevgi erhält ein Konto mit beiden Kindern.

Ein einmal abgeschlossener Import wird bei erneutem Aufruf nicht überschrieben. `prepare.mjs` kopiert den aktuellen Anwendungsstand in den isolierten Test und konfiguriert dort ausschließlich lokale Dienste. Nicht während einer laufenden lokalen Next-Instanz aktualisieren.

```sh
node scripts/local-family-test/seed.mjs
node scripts/local-family-test/prepare.mjs
node scripts/local-family-test/verify.mjs
```

Die Prüfung verwendet echte lokale Auth-Sitzungen und ungemockte Datenbankzugriffe. Sie prüft die Zugriffsrechte zweier Familien, zwei Stripe-Konten, die bestätigten Sonderfälle, echte Speicherung eines Kindes ohne Geburtsjahr und gesperrte externe Aktionen. Das für den Speichertest neu angelegte Kind wird anschließend wieder entfernt. Ergebnisse: `verification.json` und `test-results.json` im lokalen Ausgabeverzeichnis.

Bestehende reale Trainingstermine, Anwesenheiten und Berichte gehören nicht zum Zuordnungssnapshot und werden nicht simuliert. Ein ausdrücklich benannter lokaler Testtrainer und Testplatz ermöglichen eigene Planungstests. Automatische Hintergrundverarbeitung läuft nicht. Ein echter Stripe-Tarifwechsel und Mailzustellung werden hier nicht getestet.
