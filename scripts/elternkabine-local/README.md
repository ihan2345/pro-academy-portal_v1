# Elternkabine lokal testen

Nur lokal. Nichts davon in Produktion ausführen, bevor PHOS es freigibt.

1. Lokales Supabase mit allen Migrationen und Release-SQLs bis `supabase/release/051-elternkabine.sql`.
2. In `.env.local` der App zusätzlich: `ELTERNKABINE_ADMIN_PASSWORD=<frei wählbar>` und `MAIL_PROVIDER=capture` (Mails landen nur in `output/mail/`).
3. Testdaten: `SUPABASE_URL=http://127.0.0.1:<port> SUPABASE_SERVICE_ROLE_KEY=<lokal> node scripts/elternkabine-local/seed.mjs`
   - ~120 erfundene Familien (FirstTouch, GameChanger, Pro-Player, Lesefrist, Probetraining, Camp), jede vierte mit zweitem Elternteil, 3 Regionen, Beiträge, eine Meldung, zwei Entwurfskanäle.
   - Zugänge: `output/elternkabine-lokal/accounts.private.json` (nicht hochladen).
4. Eltern: `/elternkabine`. Verwaltung: als `ek-admin@example.invalid` anmelden, `/admin-elternkabine` öffnen, Passwort eingeben.
