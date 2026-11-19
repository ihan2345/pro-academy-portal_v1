-- Elternkabine: zwei eigene Elternkonten (je mit eigenem Abo) verbinden. NUR LOKAL TESTEN,
-- nicht in Produktion ausführen, bevor PHOS es ausdrücklich freigibt. Setzt 051–054 voraus.
-- Verbunden wird NUR die Elternkabine: beide sehen die Kanäle aller Kinder beider Konten.
-- Im restlichen Portal bleiben die Konten getrennt, jeder ändert nur seine eigenen Kinder.
begin;
create table public.community_family_links (
 id uuid primary key default gen_random_uuid(),
 parent_a uuid not null references public.parents(id),  -- fragt an
 parent_b uuid not null references public.parents(id),  -- nimmt an
 status text not null default 'requested' check (status in ('requested','active','declined','ended')),
 requested_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 accepted_at timestamptz,
 ended_at timestamptz,
 ended_by uuid references public.profiles(id),
 check (parent_a <> parent_b)
);
create unique index community_family_link_a on public.community_family_links(parent_a) where status in ('requested','active');
create unique index community_family_link_b on public.community_family_links(parent_b) where status in ('requested','active');
alter table public.community_family_links enable row level security;
revoke all on public.community_family_links from public, anon, authenticated;
grant all on public.community_family_links to service_role;

-- Familie eines Elternkontos in der Elternkabine: das Konto selbst + aktiv verbundenes Konto.
create function public.community_family_ids(fam uuid) returns uuid[] language sql stable security definer set search_path=public as $$
 select array[fam] || coalesce(array_agg(case when l.parent_a = fam then l.parent_b else l.parent_a end), '{}')
 from community_family_links l
 join parents pa on pa.id = l.parent_a and pa.archived_at is null
 join parents pb on pb.id = l.parent_b and pb.archived_at is null
 where l.status = 'active' and fam in (l.parent_a, l.parent_b)
$$;
revoke all on function public.community_family_ids(uuid) from public, anon, authenticated;
grant execute on function public.community_family_ids(uuid) to service_role;

-- Zugriff: Abos und Camp-Buchungen beider verbundener Konten zählen.
do $$ declare def text;
begin
 def := pg_get_functiondef('public.community_access(uuid,uuid)'::regprocedure);
 if position('community_family_ids(fam)' in def) > 0 then return; end if;
 if position('where pp.parent_id = fam and e.status = ''active''' in def) = 0
  or position('where pp.parent_id = fam);' in def) = 0
  or position('b.parent_id = fam and b.status = ''paid''' in def) = 0 then
  raise exception 'community_access drift: family';
 end if;
 def := replace(def, 'where pp.parent_id = fam and e.status = ''active''', 'where pp.parent_id = any(public.community_family_ids(fam)) and e.status = ''active''');
 def := replace(def, 'where pp.parent_id = fam);', 'where pp.parent_id = any(public.community_family_ids(fam)));');
 def := replace(def, 'b.parent_id = fam and b.status = ''paid''', 'b.parent_id = any(public.community_family_ids(fam)) and b.status = ''paid''');
 execute def;
end $$;

-- Konto archiviert → Verbindung endet.
create function public.end_family_link_on_archive() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.archived_at is not null and old.archived_at is null then
  update community_family_links set status = 'ended', ended_at = now()
   where status in ('requested','active') and new.id in (parent_a, parent_b);
 end if;
 return new;
end $$;
create trigger end_family_link_on_archive after update of archived_at on public.parents for each row execute function public.end_family_link_on_archive();
commit;
