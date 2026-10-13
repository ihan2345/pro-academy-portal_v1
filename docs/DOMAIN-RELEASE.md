# Portal-Subdomain – am 13.10.2026 vollständig aktiviert

Zieladresse: `https://portal.proacademy-ak.com`. Auf Nutzerauftrag soll ausschließlich diese Portaladresse aktiv bleiben; die bisherige Portal-Adresse unter workers.dev wurde nach vollständiger Funktionsprüfung deaktiviert. Der separate, authentifizierte Jobs-Worker bleibt für den Hintergrunddienst erreichbar.

Bereits durchgeführt:

- Cloudflare Custom Domain an `proacademy-portal` angebunden, öffentliches DNS aktiv. Anmeldung im Browser unter HTTPS geprüft.
- Portal-Version `2a25b1ff-5969-4914-8563-71a7430a67af`: APP_URL, NEXT_PUBLIC_APP_URL und CAMP_PUBLIC_ORIGIN umgestellt; manuelle Einladungsprüfung auf die Subdomain angepasst.
- Supabase Site URL und produktive Anmelde-Rücksprungadressen umgestellt; lokale Entwicklungsadresse erhalten.
- SQL `supabase/release/010-portal-domain.sql` angewendet: serverseitige Einladungspfad-Prüfung und noch nicht versendete Portal-Links angepasst. Versandfreigaben unverändert.
- Beide Camp-Payment-Links führen auf die neue Erfolgsseite. Die Stripe-Kundenportal-Konfiguration enthält keine alte Standard-Rücksprungadresse; die Anwendung übergibt künftig die neue Kontoadresse.
- Jobs-Version `b120849d-e362-4662-b3ca-4e3c58277601`, Container `sha256:32d5a52b3394469df070a4910f933d47890c10dca1ab22977e1e5683c40e8454`: Portal-/Camp-Adresse umgestellt. Verbindungsprüfung HTTP 200 und erfolgreich; keine Testmail ausgelöst.
- 14 gezielte Onboarding-/Sicherheitstests sowie Portal- und Runner-Build erfolgreich.

Abschluss am 13.10.2026:

- Ursache war die benutzerdefinierte Regel „Challenge suspicious API posts“ (`0476d785dcf54a928c8a3c3cba500ba7`). Sie erfasste sämtliche POST-Aufrufe unter `/api/` einschließlich Portal-Anmeldung und Speichern. Nach Einsicht und Vorbereitung wurde sie durch den Nutzer um `and http.host ne "portal.proacademy-ak.com"` ergänzt. Alle übrigen Custom Rules, Managed Rules und Durchsatzbegrenzungen bleiben bestehen; Anwendungs-Authentifizierung, Origin-/Rollenprüfung und Stripe-Signaturen bleiben erforderlich.
- Beide vorhandenen Stripe-Webhook-Endpunkte auf die neue Subdomain umgestellt; Endpunkt-IDs, Aktivierung und Secrets erhalten. Unsigned POST-Prüfungen erreichen die Anwendung und werden mit HTTP 400 zurückgewiesen, ohne Browser-Challenge.
- Portal-workers.dev-Route und Preview-URLs deaktiviert. Custom Domain bleibt aktiv. Die endgültige Konfiguration in `wrangler.jsonc` und die lokale Deploy-Konfiguration verwenden `workers_dev: false`.
- Live geprüft: Login HTTP 200, geschützte Teamseite HTTP 307 zur Anmeldung, Auth-Callback zur neuen Domain, anonyme Schreib-API HTTP 401. Alte Portaladresse HTTP 404. Supabase-Anmeldung, Stripe-Webhooks, beide Camp-Payment-Links und Konfiguration auf die Subdomain geprüft. Sonstige Worker-Konfiguration und Secret-Bindings sind unverändert.
- Keine erneute vollständige Testsuite nötig: die gezielten Tests und Builds waren bereits bestanden; der Abschluss änderte nur externe Konfiguration.

Private Sicherungen und Prüfnachweise liegen unter `output/domain-release/` und dürfen nicht eingecheckt werden. Keine erneute vollständige Testsuite ohne neue Fehler oder relevante Codeänderungen nötig.

Nachkorrektur Elternprofile am 13.10.2026:

- Beim ursprünglichen Portal-Build wurde `LOCAL_PROFILE_STRIPE_READ=true` aus `.env.local` in die OpenNext-Produktionsvorgaben übernommen. Der ausschließlich lokal erlaubte Vorschaupfad blockierte dadurch Stripe-Historienabrufe bei fehlendem oder abgelaufenem Cache; die Übersicht meldete eine unvollständige Abo-Historie.
- Produktion setzt jetzt ausdrücklich `LOCAL_PROFILE_STRIPE_READ=false` in `wrangler.jsonc`. Ein isolierter Build ohne `.env.local` wurde veröffentlicht: Portal-Version `6a1e42db-f29b-4d41-9f32-49c3f5ae6a36`, 100 % Traffic. Die erzeugten Produktionsvorgaben enthalten keine privaten Stripe-/Supabase-Schlüssel.
- Neun gezielte Tests in `profile-stripe.test.ts` und `profile-subscription-history.test.ts` sowie der Cloudflare-Produktionsbuild bestanden. In der angemeldeten Safari-Sitzung laden Seite 1 und die zuvor fehlerhafte Seite 2 wieder mit Profilen und Abo-Historie.
- Live-Binding `LOCAL_PROFILE_STRIPE_READ=false` bestätigt. Custom Domain bleibt aktiv; Portal-workers.dev und Preview-URLs bleiben deaktiviert.
- Der alte Build im Repository-Wurzelverzeichnis darf nicht erneut veröffentlicht werden; Produktionsbuilds müssen lokale Vorschauvariablen ausschließen. Private Build-/Prüfdateien liegen unter `output/profile-domain-fix/`.
