-- Beziehung zum Kind je Elternkonto (Haupt- und Zweitkonto). NUR LOKAL TESTEN,
-- nicht in Produktion ausführen, bevor PHOS es ausdrücklich freigibt. Mehrfach ausführbar.
begin;
alter table public.profiles add column if not exists child_relation text
 check (child_relation in ('mutter','vater','elternteil','stiefmutter','stiefvater','grossmutter','grossvater','vormund','sonstige'));
comment on column public.profiles.child_relation is 'Beziehung zum Kind (Eltern-Logins), im Profil und beim Elternkabine-Beitritt angegeben.';
commit;
