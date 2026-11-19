-- Elternkabine Runde 2: eigene Kanäle durch Super-Admins + bearbeitbare Blacklist.
-- NUR LOKAL TESTEN, nicht in Produktion ausführen, bevor PHOS es ausdrücklich freigibt.
-- Setzt 051-elternkabine.sql voraus.
begin;

-- ───────────── Eigene Kanäle ─────────────
-- Super-Admins legen Kanäle selbst an. Wer sie sieht, folgt denselben Regeln wie bei
-- den automatischen Kanälen (alle Abo-Eltern / ein Abo / Jahrgang / Region / Camp).
-- Eigene Kanäle starten als Entwurf und gehen mit der ersten Team-Nachricht live.
alter table public.community_channels
 add column custom boolean not null default false,
 add column created_by uuid references public.profiles(id);
drop index public.community_channel_unique;
create unique index community_channel_unique on public.community_channels(kind, coalesce(plan_name,''), coalesce(camp_id::text,''), coalesce(location_id::text,''), coalesce(u_from,0)) where not custom;
alter table public.community_channels add constraint community_channel_custom_shape check (
 not custom or (
  (kind = 'general') or
  (kind = 'plan' and plan_name is not null) or
  (kind = 'age' and u_from is not null and u_to is not null and u_from <= u_to) or
  (kind = 'region' and location_id is not null) or
  (kind = 'camp' and camp_id is not null)
 ));

create or replace function public.community_sync_channels() returns int language plpgsql security definer set search_path=public as $$
declare n int := 0; k int;
begin
 insert into community_channels(area, kind, title, emoji, camp_id, description, sort)
  select 'camps','camp', c.title, '🏕️', c.id, 'Für alle Familien mit bezahlter Buchung.', 50 from camps c
  where not exists(select 1 from community_channels x where x.kind = 'camp' and x.camp_id = c.id and not x.custom);
 get diagnostics k = row_count; n := n + k;
 insert into community_channels(area, kind, title, emoji, location_id, description, sort)
  select 'regions','region', l.name, '📍', l.id, 'Für Familien aus dieser Region.', 70 from locations l
  where l.is_region and l.active and not exists(select 1 from community_channels x where x.kind = 'region' and x.location_id = l.id and not x.custom);
 get diagnostics k = row_count; n := n + k;
 update community_channels x set status = 'archived' from locations l where x.kind = 'region' and l.id = x.location_id and not (l.is_region and l.active) and x.status <> 'archived';
 return n;
end $$;

-- ───────────── Blacklist ─────────────
-- match 'contains': trifft auch Wortteile und Schreibtricks (A.r.s.c.h…, 4rschl0ch).
-- match 'word': nur das ganze Wort bzw. den ganzen Satz (für Wörter, die in harmlosen Wörtern stecken).
create table public.community_blocked_terms (
 id uuid primary key default gen_random_uuid(),
 term text not null check (length(btrim(term)) between 2 and 80),
 match text not null default 'contains' check (match in ('contains','word')),
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now()
);
create unique index community_blocked_term_unique on public.community_blocked_terms(lower(btrim(term)));
alter table public.community_blocked_terms enable row level security;
revoke all on public.community_blocked_terms from public, anon, authenticated;
grant all on public.community_blocked_terms to service_role;
insert into public.community_blocked_terms(term, match) values
 ('arschloch','contains'), ('hurensohn','contains'), ('wichser','contains'), ('fotze','contains'),
 ('missgeburt','contains'), ('spast','word'), ('behindert','word'), ('halt die fresse','word'), ('du opfer','word');

commit;
