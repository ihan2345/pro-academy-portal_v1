# Camp-Buchung, Aktivierung und Abo-Vorteile

Die Camp-Erstellung und die Camp-Bearbeitung enthalten „Gelten Abo-Vorteile?“ mit Ja/Nein. Bestehende und neue Camps starten mit Nein. In diesem Zustand entfallen persönliche Mitgliedspreise, Abo-Hinweise und Camp-Mitgliedercodes im Shop, im eingebetteten Shop und im Elternbereich. Checkout und Datenbank verhindern entsprechende neue Mitgliederrabatte. Frühbucherpreise und reguläre Rabattcodes bleiben erhalten. Bereits gespeicherte Zahlungsangebote behalten ihren vereinbarten Preis. Mit Ja gelten wieder die vorhandenen Tarifvorteile, auch auf den optionalen Camp-Gesamtpreis.

Bestehende Familien können mit ihrer hinterlegten E-Mail einen Anmeldecode anfordern und ihren Zugang selbst aktivieren. Dafür muss genau eine aktive Familie mit Stripe-Zuordnung existieren. Die Verknüpfung erfolgt erst nach bestätigter E-Mail-Anmeldung. Mehrdeutige oder anderweitig belegte Zuordnungen benötigen eine Prüfung durch das Team. Staff-/Adminrollen werden nicht verändert. Die Aktivierung verschickt keine Einladungen und löst keine alten Versandaufträge aus.

Bei einem neuen Gastkauf wird eine bereits bekannte Familienadresse vor Reservierung und Zahlung zur Anmeldung geleitet. Der Anmeldedialog erklärt die Aktivierung; danach führt er zum Shop zurück. Bestehende Gastbestellungen können weiterhin über ihre bisherigen Zugänge und Zahlungsabläufe fortgesetzt werden.

`044-parent-activation-camp-benefits.sql` erlaubt Camp-Bestätigung, Camp-Erinnerungen und Camp-Abschlussnachricht für ab Freigabe bezahlte Portalbuchungen separat. Voraussetzung bleiben eine bestätigte, passend verknüpfte Elternadresse, die persönliche E-Mail-Einstellung und die bestehenden Buchungs-, Zeit- und manuellen Sperrprüfungen. Die bisherige allgemeine Empfängerfreigabe gilt für andere und ältere Nachrichten weiter. Gastkäufe verwenden weiterhin ihre eigene Kauf-/Zugangs-E-Mail; reguläre Campnachrichten setzen die bestätigte Familienverknüpfung voraus.

Die Migration verändert keine Warteschlangenstatus, keine Einladungen und keine bisherigen Empfängerlisten. `portal_delivery_release.automatic_invitations` bleibt unverändert. `camp_portal_mail_release.starts_after` markiert die Freigabe; `parent_self_activation_release` steuert die selbstständige Aktivierung.

Geprüft: 1.236 automatisierte Tests einschließlich SQL-Zuordnung, unveränderter Alt-Sperren und beider Rabatt-Reservierungswege; TypeScript, Cloudflare-Produktionsbuild und Browserprüfungen für Camp-Erstellung/-Bearbeitung, Buchung und E-Mail-Anmeldung auf Mobil-/Desktopbreite. Keine realen Anmeldemails oder Testkäufe ausgelöst.

## Frühe E-Mail-Prüfung im Campformular

Beim Verlassen des E-Mail-Felds prüfen Campformular und Camp-Kaufdialog im Shop die Adresse. Bereits zugeordnete Familien werden zur Anmeldung/Aktivierung geleitet. Die E-Mail wird im selben Browser vorausgefüllt; nach Code oder Anmeldelink führt eine geprüfte interne Rücksprungadresse zum ausgewählten Camp beziehungsweise Shopprodukt. Die Prüfung selbst fordert keinen Code an und erzeugt keine E-Mail, Einladung, Buchung oder Zahlung.

Der Lookup nutzt die bestehende serverseitige Familienprüfung, Origin-Prüfung, IP-Ratenbegrenzung und eine nicht zwischenspeicherbare Antwort ohne Familienangaben. Neue Adressen können fortfahren. Bei Fehlern bleiben die Eingaben erhalten und der Buchungsablauf wartet auf eine erfolgreiche Prüfung. Die Prüfung vor dem Checkout bleibt zusätzlich bestehen, auch für direkte Campbuchungen. Rücksprünge sind auf Camp-Buchungsseiten und ausgewählte Shopprodukte mit UUID begrenzt.

Validiert mit 1.260 Tests, Mobil-/Desktop-Browserprüfungen für bekannte/neue Adressen, Prüffehler, vorausgefüllte Anmeldung und Rücksprünge sowie dem Cloudflare-Produktionsbuild. Keine Datenbankmigration erforderlich.
