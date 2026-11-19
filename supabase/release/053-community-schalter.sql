-- Elternkabine: zweistufige Freischaltung. NUR LOKAL TESTEN, nicht in Produktion
-- ausführen, bevor PHOS es ausdrücklich freigibt. Setzt 051 + 052 voraus.
--   'community'    = Funktion an: Bereich nur für Mitarbeiter (Admin/Staff) sichtbar
--   'elternkabine' = zusätzlich für Eltern veröffentlicht (wirkt nur, wenn 'community' an ist)
begin;
insert into public.platform_features(key, enabled) values ('community', false)
 on conflict (key) do nothing;
commit;
