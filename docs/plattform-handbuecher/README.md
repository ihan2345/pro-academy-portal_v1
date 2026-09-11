# ProAcademy: Plattform-Handbücher

Stand: 10.09.2026. Für Mitarbeiter zum Verständnis und für autorisierte Administratoren zum Nachschlagen.

Mit **00-Start-hier** beginnen. Jedes Handbuch ist einzeln lesbar und druckbar. Die PDF-Dateien enthalten große Schrift, nummerierte Abläufe und eine Abschlusscheckliste.

| Handbuch | PDF | Textfassung |
| --- | --- | --- |
| Start hier: die Plattformen | [PDF](00-Start-hier.pdf) | [Markdown](00-Start-hier.md) |
| Supabase | [PDF](01-Supabase.pdf) | [Markdown](01-Supabase.md) |
| Stripe | [PDF](02-Stripe.pdf) | [Markdown](02-Stripe.md) |
| Cloudflare | [PDF](03-Cloudflare.pdf) | [Markdown](03-Cloudflare.md) |
| Proton Mail | [PDF](04-Proton-Mail.pdf) | [Markdown](04-Proton-Mail.md) |
| GitHub und Git | [PDF](05-GitHub-und-Git.pdf) | [Markdown](05-GitHub-und-Git.md) |
| Docker | [PDF](06-Docker.pdf) | [Markdown](06-Docker.md) |

## Aktueller Betriebsstand

- Veröffentlichung nur auf ausdrücklichen Deploy-Befehl.
- Ausschließlich die Worker-Adresse verwenden; portal.proacademy-ak.com bleibt inaktiv.
- Automatische Jobs und allgemeiner Elternversand bleiben gesperrt. Die Supabase-Datenbank und das Stripe-Konto sind echte Produktionssysteme.
- Diese Dokumentation wurde aus Projektdateien und offiziellen Anleitungen erstellt. Sie ist kein erneuter Live-Funktionstest. Plattformoberflächen können ihre Beschriftungen ändern.

## Pflege und automatische Kopie

Die Quelle ist `inhalte.json`. Aus dem Projektordner ausführen:

```sh
python3 scripts/create-platform-handbooks.py
```

Der Befehl erzeugt alle PDFs und Textfassungen im Projekt und kopiert das Dokumentationspaket automatisch nach:

`/Users/karayla/Desktop/Schreibtisch – MacBook Air von Kaan/PROACADEMY/Portal/Plattform-Handbuecher`

Anschließend werden die SHA-256-Prüfsummen beider Ablagen verglichen. `EXPORT-NACHWEIS.json` dokumentiert die Dateien. Es gibt keinen permanenten Ordnerabgleich; Änderungen werden bei der nächsten Erstellung erneut kopiert. Unbeteiligte Dateien werden nicht gelöscht.

Das Kopieren ist weder ein Git-Push noch ein App-Deployment. Im Paket stehen keine Passwörter oder geheimen Schlüssel.

Für die technische Pflege im Projekt: `wrangler.jsonc`, `workers/cloudflare/wrangler.jsonc`, `docs/TARIFF-RULES.md`, `docs/ARCHITECTURE.md` und die neuesten Einträge in `docs/LAUNCH-SETUP.md`. Ältere Einträge der Launch-Dokumentation beschreiben historische Zwischenstände.
