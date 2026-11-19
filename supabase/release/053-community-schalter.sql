-- Elternkabine: zweistufige Freischaltung. NUR LOKAL TESTEN, nicht in Produktion
-- ausführen, bevor PHOS es ausdrücklich freigibt. Setzt 051 + 052 voraus. Mehrfach ausführbar.
--   'community'    = Funktion an: Bereich nur für Mitarbeiter (Admin/Staff) sichtbar
--   'elternkabine' = zusätzlich für Eltern veröffentlicht (wirkt nur, wenn 'community' an ist)
begin;
insert into public.platform_features(key, enabled) values ('community', false)
 on conflict (key) do nothing;

-- ProMediathek-Kanäle (requires_consent = 'child_photos') bleiben gesperrt, solange der
-- Admin-Schalter 'elternkabine_child_photos' (ProMediathek) aus ist, auch mit gespeicherter Zustimmung.
do $$ declare def text; old text := 'if c.requires_consent = ''child_photos'' and f.consent_child_photos_at is null then';
begin
 def := pg_get_functiondef('public.community_access(uuid,uuid)'::regprocedure);
 if position('pf.key = ''elternkabine_child_photos''' in def) > 0 then return; end if;
 if position(old in def) = 0 then raise exception 'community_access drift: child_photos'; end if;
 def := replace(def, old, 'if c.requires_consent = ''child_photos'' and (f.consent_child_photos_at is null or not coalesce((select pf.enabled from platform_features pf where pf.key = ''elternkabine_child_photos''), false)) then');
 execute def;
end $$;
commit;
