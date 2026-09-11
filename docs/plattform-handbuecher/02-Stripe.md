# ProAcademy | Stripe

Stand: 10.09.2026.

[PDF öffnen](02-Stripe.pdf)

## 1. Abos und Zahlungen verstehen

**ÜBERBLICK FÜR ALLE**

Stripe verwaltet Verträge und Zahlungen. Das Portal übernimmt daraus die passenden Leistungszeiträume für die Stempelkarten. Eine Zahlung ist kein Trainingsstempel.

[ProAcademy Stripe-Dashboard öffnen](https://dashboard.stripe.com/acct_1RlAPDRoswKHkM76/dashboard)

> **Richtiges Konto:** acct_1RlAPDRoswKHkM76. Im Projekt ist ein Live-Zugang hinterlegt. Der Name „Testkunde“ macht daraus keinen Stripe-Testmodus.

| Begriff / Kennung | Einfach erklärt |
| --- | --- |
| Customer · cus_ | Der zahlende Kunde. |
| Subscription · sub_ | Das laufende Abo. |
| Subscription Item · si_ | Eine einzelne Position dieses Abos. |
| Price · price_ | Der konkrete Preis und die zugeordnete Tarifvariante. |
| Invoice · in_ | Eine Rechnung. |
| Event · evt_ | Eine Nachricht über eine Änderung. |

Coaches klären Trainingsfragen im Portal. Änderungen an Zahlungen, Kündigungen oder Tarifen übernimmt die dafür berechtigte Verwaltung.

## 2. Die ProAcademy-Tariflogik

**ADMINISTRATION**

| Tarif | Bestand | Neu ab 01.09.2026 |
| --- | --- | --- |
| FirstTouch | 4 Fußball | 4 Fußball |
| GameChanger | 8 Fußball | 8 Fußball |
| Pro-Player | 10 Fußball | 12 Fußball |
| Pro-Player Jahresabo | 10 je Monat | Bestandsvariante |
| NEXT LEVEL | 8 Fußball + 4 Athletik | Sondertarif |

**Bestandskunden behalten ihren bisherigen Tarif**, solange das bestehende Abo fortbesteht. Alte Varianten bleiben für sie verfügbar, werden aber nicht öffentlich für Neukunden angeboten.

Entscheidend ist die **Preis-ID**. Derselbe oder ein ähnlicher Produktname reicht zur Zuordnung nicht aus. Ein neuer Abschluss mit einem alten Preis ab dem Stichtag wird zur manuellen Prüfung markiert.

**Jahresabo:** Die Zahlung erfolgt jährlich, das Trainingskontingent wird monatlich geführt. Es gibt keinen frei vorziehbaren Jahrestopf.

**NEXT LEVEL:** Die zwölf Einheiten bestehen aus zwei getrennten Anteilen. Eine Athletikeinheit ersetzt keine Fußball-Einheit und umgekehrt.

> Beispiel: Ein altes Pro-Player-Abo erhält auch nach September weiter 10 Einheiten. Der aktuelle Pro-Player-Tarif erhält 12. Eine Verlängerung allein ist kein Tarifwechsel.

Quelle / Grundlage: Projektgrundlage: docs/TARIFF-RULES.md und Migration 202609090006_stripe_catalog.sql.

## 3. Eine Elternanfrage prüfen

**ADMINISTRATION**

1. **Kunde suchen:** Im Stripe-Dashboard unter Kunden nach der Abrechnungsadresse suchen. Name und Kunden-ID mit der Zuordnung im Portal vergleichen.

2. **Abo öffnen:** Abo-Status, konkrete Preis-ID und Beginn sowie Ende des Abrechnungszeitraums ansehen. Bei mehreren Positionen die richtige Abo-Position prüfen.

3. **Rechnung ansehen:** Bei Zahlungsfragen die betreffende Rechnung öffnen. Eine fehlgeschlagene Zahlung nicht durch eine erfundene erfolgreiche Zahlung im Portal ersetzen.

4. **Zuordnung prüfen:** Die Portalverwaltung gleicht Kunde, Abo, Position, Kind und Elternzugang ab. Rechnungsadresse und Login-Adresse dürfen unterschiedlich sein.

### Warum kann „Abo verwalten“ scheitern?

Der Aufruf braucht einen echten Stripe-Kunden im Konto, zum verwendeten Schlüssel passende Daten und eine Kundenportal-Konfiguration. Die künstlichen Stripe-Referenzen des bisherigen Beispielkindes ersetzen keinen echten Stripe-Kunden.

Das Stripe-Kundenportal zeigt Zahlungs- und Abo-Funktionen entsprechend seiner Konfiguration. Welche Änderungen Eltern ausführen dürfen, wird dort festgelegt.

Quelle / Grundlage: [Stripe: Customer portal](https://docs.stripe.com/customer-management)

> Keine pauschale Umstellung aller Bestandsabos durchführen. Einen unklaren Fall mit Kunden-ID, Preis-ID und Zeitraum an die zuständige Verwaltung geben.

## 4. Testen und Nachrichten verstehen

**ADMINISTRATION**

### Ein einfacher Stripe-Test

1. Die technische Administration richtet eine getrennte Stripe-Sandbox mit passendem Testzugang ein. Die produktive Portalverbindung wird dafür nicht nebenbei umgestellt.

2. Einen Testkunden und ein passendes Testabo anlegen. Dieses gezielt mit einem Beispielkind in einer getrennten Testkonfiguration verbinden.

3. Als Testelternteil „Abo verwalten“ öffnen. Kunde, Abo, Rückkehr ins Portal und fehlende Zugriffe auf fremde Kinder prüfen. Ergebnis und verwendete Umgebung notieren.

Stripe-Testzahlungen bewegen kein echtes Geld. Für einen solchen Test werden Testdaten und die dazugehörigen Testschlüssel verwendet.

Quelle / Grundlage: [Stripe: Testing](https://docs.stripe.com/testing)

### Webhook bedeutet Änderungsnachricht

Stripe sendet Abo- und Rechnungsereignisse an **/api/stripe/webhook** der Worker-Adresse. Das Portal prüft die Signatur und speichert die Nachricht in Supabase. Erst die spätere Jobverarbeitung übernimmt den fachlichen Abgleich.

> Ein HTTP-Ergebnis 200 bestätigt die Annahme der Nachricht. Bei gesperrten Jobs ist damit noch kein Abo-Abgleich abgeschlossen. Im Stripe-Dashboard unter Workbench / Webhooks die Zustellversuche ansehen; eine Wiederholung ist eine bewusste Aktion.

- [ ] Live oder Sandbox eindeutig erkannt; richtiger Kunde und Preis geprüft.

- [ ] Kundenportal geöffnet und Portal-Zuordnung geprüft.

- [ ] Webhook-Annahme und anschließende Verarbeitung getrennt geprüft.

Für diese einfachen Prüfungen sind keine Terminalbefehle nötig. Zahlungsänderungen nicht als technischen Verbindungstest benutzen.
