# Probetraining selbst lokal testen

Einstieg: **http://127.0.0.1:3107/lokaler-test/probetraining**

Die bisherige Testumgebung `pabyak-family-local` wird weiterverwendet. Der Kontowechsel unter `/lokaler-test` meldet echte lokale Konten an. Neue Probetraining-Eltern werden dort direkt aus der lokalen Datenbank geladen. Nach bestätigter E-Mail öffnet der Kontowechsel das Elternportal; bei offener Bestätigung führt er zuerst zum persönlichen Willkommenszugang. Nach einer Abo-Übernahme wird das reguläre Elternprofil geöffnet. Die Anwendungskopie und Testdaten liegen ausschließlich unter dem ignorierten Verzeichnis `output/eltern-kind-lokal/`. Produktive Dateien erhalten keine Testanmeldung und keine Zeitsimulation.

## Ablauf

1. Auf der Teststartseite das Formular öffnen und erfundene Daten verwenden, etwa eine neue Adresse `familie-test-2@example.invalid`. Die Daten müssen neu sein, weil die Dublettenprüfung auch lokal aktiv ist.
2. Auf der Teststartseite **Mails aktualisieren** klicken. Im lokalen Mailausgang die Willkommensmail aufklappen und den persönlichen Link öffnen. Dort die E-Mail bestätigen.
3. Über **Konto wechseln** die Verwaltung öffnen. Im Menü **Probetraining** den lokalen Testtermin zuordnen.
4. Auf der Teststartseite **Teilnahme simulieren** wählen. Dadurch wird der zugeordnete lokale Termin in die Vergangenheit versetzt und die Teilnahme bestätigt. Alle Teilnehmer desselben Termins sehen entsprechend dessen verschobene Uhrzeit.
5. In der Verwaltung **Teilnehmer bewerten** öffnen, Feedback eintragen und für Eltern freigeben.
6. Auf der Teststartseite **Mails aktualisieren** wählen: Die Feedbackmail wird nach der Coachfreigabe sofort aufgezeichnet. Diese Mail öffnen. Im Elternportal eine Bewertung abgeben.
7. **7 Tage nach Coachfeedback** und anschließend **14 Tage nach Coachfeedback** ausprobieren. Angebotsmails entstehen nur bei optionaler Einwilligung, ohne passendes Abo und ohne negative Elternbewertung.

8. Optional **Abo-Abschluss simulieren** wählen. In der Verwaltung erscheinen ein ausdrücklich lokaler Stripe-Vorgang und eine offene Abo-Zuordnung mit Probetraining-Vorschlag. Die Bestätigung übernimmt das vorhandene Kinderprofil. Es wird kein Stripe-Aufruf und keine Zahlung ausgeführt.

Nach Änderungen in anderen Tabs die jeweilige Ansicht neu laden. Die lokale Mailvorschau zeigt ausschließlich aufgezeichnete Mails; nichts wird an die angegebenen Adressen verschickt. Links in der eingebetteten Mailvorschau öffnen das Portal im Hauptfenster. Dadurch laufen Bestätigung und Bewertung außerhalb der isolierten Maildarstellung. Der Camp-Eintrag ist ein ausdrücklich gekennzeichnetes Anzeigebeispiel ohne Zahlungsangebot. Für zusätzliche Trainings kann die normale lokale Trainingsplanung genutzt werden.

## Wieder starten

Der vorhandene lokale Docker-Stack muss laufen (siehe `../local-family-test/README.md`). Dann im Repository:

```sh
cd output/eltern-kind-lokal/app
NODE_OPTIONS=--require=./network-guard.cjs ./node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port 3107
```

## Testkopie aktualisieren

Zuerst den Next-Testserver auf Port 3107 beenden. Im Repository:

```sh
python3 scripts/local-family-test/bind-loopback.py
node scripts/local-trials/prepare.mjs
```

Das Skript akzeptiert ausschließlich den lokalen Docker-Container und die API `http://127.0.0.1:55321`. Es ergänzt fehlende Schemastände, aktiviert Probetraining nur in der Testdatenbank und kopiert den aktuellen Anwendungsstand. Bereits vorhandene Familien und Testeingaben bleiben erhalten. Die Vorbereitung startet keine Jobs und versendet keine Mails. Die lokale Zeitsimulation wird ausschließlich dem lokalen Schema hinzugefügt, nie den Release-Migrationen.

Vor dem ersten Update wurde `output/eltern-kind-lokal/before-trials.dump` gesichert. Keine Datenbank zurücksetzen, wenn eigene Testeingaben erhalten bleiben sollen.
