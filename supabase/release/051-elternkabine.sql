-- Elternkabine (Community) + zweiter Elternteil. NUR LOKAL TESTEN, nicht in Produktion ausführen,
-- bevor PHOS es ausdrücklich freigibt. Alles bleibt hinter platform_features 'elternkabine' (aus).
begin;

-- ───────────────────────── Zweiter Elternteil ─────────────────────────
create table public.parent_co_accounts (
 id uuid primary key default gen_random_uuid(),
 parent_id uuid not null references public.parents(id),
 email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
 first_name text not null default '',
 auth_user_id uuid references public.profiles(id),
 status text not null default 'invited' check (status in ('invited','active','revoked')),
 invite_sent_at timestamptz,
 invite_count int not null default 0,
 accepted_at timestamptz,
 revoked_at timestamptz,
 revoked_reason text,
 created_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index parent_co_one_open on public.parent_co_accounts(parent_id) where status in ('invited','active');
create unique index parent_co_user_active on public.parent_co_accounts(auth_user_id) where status = 'active';
create unique index parent_co_email_open on public.parent_co_accounts(email) where status in ('invited','active');
alter table public.parent_co_accounts enable row level security;
revoke all on public.parent_co_accounts from public, anon, authenticated;
grant all on public.parent_co_accounts to service_role;
create trigger touch_updated before update on public.parent_co_accounts for each row execute function public.touch_updated();
create trigger audit_change after insert or update or delete on public.parent_co_accounts for each row execute function public.audit_change();

-- Elternkonto (Haupt- oder aktives Zweitkonto) eines Logins.
create function public.portal_parent_id_for(uid uuid) returns uuid language sql stable security definer set search_path=public as $$
 select coalesce(
  (select p.id from parents p where p.auth_user_id = uid and p.archived_at is null),
  (select p.id from parent_co_accounts c join parents p on p.id = c.parent_id
    where c.auth_user_id = uid and c.status = 'active' and p.archived_at is null))
$$;
create function public.portal_parent_id() returns uuid language sql stable security definer set search_path=public as $$
 select public.portal_parent_id_for(auth.uid())
$$;
create function public.is_co_parent_for(uid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select not exists(select 1 from parents where auth_user_id = uid and archived_at is null)
  and exists(select 1 from parent_co_accounts c join parents p on p.id = c.parent_id
   where c.auth_user_id = uid and c.status = 'active' and p.archived_at is null)
$$;
create function public.is_co_parent() returns boolean language sql stable security definer set search_path=public as $$
 select public.is_co_parent_for(auth.uid())
$$;
revoke all on function public.portal_parent_id_for(uuid), public.is_co_parent_for(uuid) from public, anon, authenticated;
grant execute on function public.portal_parent_id_for(uuid), public.is_co_parent_for(uuid) to service_role;
revoke all on function public.portal_parent_id(), public.is_co_parent() from public, anon;
grant execute on function public.portal_parent_id(), public.is_co_parent() to authenticated;

-- Lesezugriff des Zweitkontos: dieselben Zeilen wie das Hauptkonto (nur SELECT-Regeln).
create or replace function public.owns_player(pid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.parent_players pp where pp.player_id = pid and pp.parent_id = public.portal_parent_id())
$$;
drop policy own_parent on public.parents;
create policy own_parent on public.parents for select to authenticated using (id = public.portal_parent_id());
drop policy own_links on public.parent_players;
create policy own_links on public.parent_players for select to authenticated using (parent_id = public.portal_parent_id());
drop policy own_subscription on public.subscriptions;
create policy own_subscription on public.subscriptions for select to authenticated using (
 stripe_customer_id in (select stripe_customer_id from public.parents where id = public.portal_parent_id()));
drop policy own_customer on public.parent_stripe_customers;
create policy own_customer on public.parent_stripe_customers for select to authenticated using (parent_id = public.portal_parent_id());

-- Darf sich diese E-Mail als Zweitkonto anmelden?
create function public.co_parent_activation_available(input_email text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from parent_co_accounts c join parents p on p.id = c.parent_id
  where c.email = lower(btrim(input_email)) and c.status in ('invited','active') and p.archived_at is null)
$$;
revoke all on function public.co_parent_activation_available(text) from public, anon, authenticated;
grant execute on function public.co_parent_activation_available(text) to service_role;

-- Nach dem Login: bestätigte E-Mail mit offener Einladung verbinden.
create function public.activate_co_parent() returns boolean language plpgsql security definer set search_path=public as $$
declare mail text; c parent_co_accounts;
begin
 select lower(btrim(email)) into mail from auth.users where id = auth.uid() and email_confirmed_at is not null;
 if mail is null then return false; end if;
 if exists(select 1 from parents where auth_user_id = auth.uid()) then return false; end if;
 select * into c from parent_co_accounts where email = mail and status in ('invited','active') for update;
 if not found then return false; end if;
 if not exists(select 1 from parents where id = c.parent_id and archived_at is null) then return false; end if;
 if c.status = 'active' and c.auth_user_id is distinct from auth.uid() then return false; end if;
 insert into profiles(id, role, full_name) values (auth.uid(), 'parent', coalesce(nullif(c.first_name,''), split_part(mail,'@',1)))
  on conflict (id) do nothing;
 if (select role from profiles where id = auth.uid()) <> 'parent' then return false; end if;
 perform set_config('app.audit_reason', 'Zweites Elternkonto verbunden', true);
 update parent_co_accounts set auth_user_id = auth.uid(), status = 'active', accepted_at = coalesce(accepted_at, now()) where id = c.id;
 return true;
end $$;
revoke all on function public.activate_co_parent() from public, anon;
grant execute on function public.activate_co_parent() to authenticated;

-- Hauptkonto archiviert → Zweitkonto sofort deaktivieren (Mail kommt aus dem Job-Lauf).
create function public.revoke_co_on_parent_archive() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.archived_at is not null and old.archived_at is null then
  insert into notification_jobs(idempotency_key, kind, recipient, payload)
   select 'co-parent-removed:' || c.id, 'co_parent_removed', c.email,
    jsonb_build_object('first_name', c.first_name, 'main_name', new.full_name, 'reason', 'main_archived')
   from parent_co_accounts c where c.parent_id = new.id and c.status = 'active'
   on conflict (idempotency_key) do nothing;
  update parent_co_accounts set status = 'revoked', revoked_at = now(), revoked_reason = 'main_archived'
   where parent_id = new.id and status in ('invited','active');
 end if;
 return new;
end $$;
create trigger revoke_co_on_archive after update of archived_at on public.parents for each row execute function public.revoke_co_on_parent_archive();

-- Geschenkkarten: Gutschein an die Mail des Zweitkontos (oder des Hauptkontos) sehen beide.
alter table public.gift_account_links drop constraint gift_account_links_scope_check;
alter table public.gift_account_links add constraint gift_account_links_scope_check check (scope in ('buyer','recipient','family'));
create function public.gift_family_emails(uid uuid) returns text[] language sql stable security definer set search_path=public as $$
 with fam as (select public.portal_parent_id_for(uid) id)
 select coalesce(array_agg(distinct m), '{}') from (
  select lower(btrim(u.email)) m from fam join parents p on p.id = fam.id join auth.users u on u.id = p.auth_user_id
  union select c.email from fam join parent_co_accounts c on c.parent_id = fam.id and c.status = 'active'
 ) x where m is not null and m <> (select lower(btrim(email)) from auth.users where id = uid)
$$;
revoke all on function public.gift_family_emails(uuid) from public, anon, authenticated;
do $$ declare def text; begin
 def := pg_get_functiondef('public.gift_account_state(jsonb)'::regprocedure);
 if position('bool_or(scope=''recipient'') received' in def) = 0 then raise exception 'gift_account_state drift: received'; end if;
 def := replace(def, 'bool_or(scope=''recipient'') received', 'bool_or(scope in(''recipient'',''family'')) received');
 if position(' select coalesce(jsonb_agg(jsonb_build_object(' in def) = 0 then raise exception 'gift_account_state drift: select'; end if;
 def := replace(def, ' select coalesce(jsonb_agg(jsonb_build_object(',
  ' insert into gift_account_links(auth_id,order_id,scope)select uid,o.id,''family'' from gift_orders o join gift_cards g on g.order_id=o.id where o.livemode=mode and lower(btrim(o.recipient->>''email''))=any(gift_family_emails(uid)) on conflict do nothing;'
  || chr(10) || ' select coalesce(jsonb_agg(jsonb_build_object(');
 execute def;
end $$;

-- ───────────────────────── Elternkabine ─────────────────────────
insert into public.platform_features(key, enabled) values ('elternkabine', false), ('elternkabine_child_photos', false)
 on conflict (key) do nothing;

alter table public.locations add column if not exists is_region boolean not null default false;

-- Familien-Einstellungen: nur das Hauptkonto ändert sie.
create table public.community_families (
 parent_id uuid primary key references public.parents(id),
 enabled boolean not null default false,
 consent_privacy_at timestamptz,
 consent_photos_at timestamptz,
 consent_child_photos_at timestamptz,
 consent_version text,
 region_id uuid references public.locations(id),
 updated_at timestamptz not null default now()
);
-- Persönliche Einstellungen je Login (auch Zweitkonto).
create table public.community_members (
 user_id uuid primary key references public.profiles(id),
 name_style text not null default 'first_initial' check (name_style in ('full','first_initial','initials')),
 muted_until timestamptz,
 banned_at timestamptz,
 updated_at timestamptz not null default now()
);
create table public.community_channels (
 id uuid primary key default gen_random_uuid(),
 area text not null check (area in ('academy','training','camps','regions','ages','trial')),
 kind text not null check (kind in ('announcements','ask_team','general','plan','camp','region','age','trial')),
 title text not null,
 emoji text not null default '',
 description text not null default '',
 plan_name text,
 camp_id uuid references public.camps(id),
 location_id uuid references public.locations(id),
 u_from int, u_to int,
 write_mode text not null default 'members' check (write_mode in ('members','team','questions')),
 requires_consent text check (requires_consent in ('photos','child_photos')),
 published_at timestamptz,
 status text not null default 'active' check (status in ('active','readonly','archived')),
 sort int not null default 100,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index community_channel_unique on public.community_channels(kind, coalesce(plan_name,''), coalesce(camp_id::text,''), coalesce(location_id::text,''), coalesce(u_from,0));
create table public.community_posts (
 id uuid primary key default gen_random_uuid(),
 channel_id uuid not null references public.community_channels(id),
 author_id uuid not null references public.profiles(id),
 author_parent_id uuid references public.parents(id),
 author_team boolean not null default false,
 reply_to uuid references public.community_posts(id),
 kind text not null default 'text' check (kind in ('text','question','tip','info','ride','swap')),
 body text not null check (char_length(body) between 1 and 4000),
 mentions uuid[] not null default '{}',
 pinned boolean not null default false,
 solved_by uuid references public.community_posts(id),
 hidden_at timestamptz, hidden_by uuid references public.profiles(id), hidden_reason text,
 edited_at timestamptz, deleted_at timestamptz,
 created_at timestamptz not null default now()
);
create index community_posts_channel on public.community_posts(channel_id, created_at desc);
create index community_posts_reply on public.community_posts(reply_to);
create table public.community_reactions (
 post_id uuid not null references public.community_posts(id),
 user_id uuid not null references public.profiles(id),
 emoji text not null check (emoji in ('👍','❤️','🙌','😂','⚽','🙏')),
 created_at timestamptz not null default now(),
 primary key (post_id, user_id, emoji)
);
create table public.community_reads (
 user_id uuid not null references public.profiles(id),
 channel_id uuid not null references public.community_channels(id),
 last_read_at timestamptz not null default now(),
 muted boolean not null default false,
 primary key (user_id, channel_id)
);
create table public.community_reports (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.community_posts(id),
 reporter_id uuid not null references public.profiles(id),
 reason text not null check (reason in ('insult','ads','photo','privacy','other')),
 note text not null default '',
 state text not null default 'open' check (state in ('open','resolved','dismissed')),
 resolved_by uuid references public.profiles(id), resolved_at timestamptz,
 created_at timestamptz not null default now(),
 unique (post_id, reporter_id)
);
create table public.community_files (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.community_posts(id),
 path text not null unique,
 mime text not null check (mime in ('image/webp','application/pdf')),
 bytes int not null check (bytes between 1 and 5242880),
 width int, height int,
 created_at timestamptz not null default now(),
 expires_at timestamptz
);
do $$ declare t text; begin
 foreach t in array array['community_families','community_members','community_channels','community_posts','community_reactions','community_reads','community_reports','community_files'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
  execute format('grant all on public.%I to service_role', t);
 end loop;
end $$;
create trigger audit_change after insert or update or delete on public.community_channels for each row execute function public.audit_change();
create trigger audit_change after update or delete on public.community_posts for each row execute function public.audit_change();
create trigger audit_change after insert or update or delete on public.community_reports for each row execute function public.audit_change();

-- Altersklasse wie im Verein: Saison wechselt am 1. Juli, U = Saison-Endjahr − Geburtsjahr.
create function public.community_u_age(birth_year int) returns int language sql stable set search_path=public as $$
 select case when birth_year is null then null else
  (extract(year from now())::int + case when extract(month from now()) >= 7 then 1 else 0 end) - birth_year end
$$;

-- Zugriff wird berechnet, nicht gespeichert.
-- level: none | locked | read | write | ask (nur Fragen stellen)
create function public.community_access(uid uuid, ch uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c community_channels; r app_role; fam uuid; f community_families; m community_members;
 grace constant interval := interval '14 days'; active_until timestamptz; trial_only boolean; locked_reason text;
begin
 select * into c from community_channels where id = ch;
 if not found or c.status = 'archived' then return jsonb_build_object('level','none'); end if;
 select role into r from profiles where id = uid;
 if r in ('admin','staff') then
  return jsonb_build_object('level', case when c.status = 'readonly' and r = 'staff' then 'read' else 'write' end, 'team', true);
 end if;
 if r is distinct from 'parent' or c.published_at is null then return jsonb_build_object('level','none'); end if;
 fam := portal_parent_id_for(uid);
 if fam is null then return jsonb_build_object('level','none'); end if;
 select * into f from community_families where parent_id = fam;
 if not found or not f.enabled or f.consent_privacy_at is null then return jsonb_build_object('level','none'); end if;
 select * into m from community_members where user_id = uid;
 if m.banned_at is not null then return jsonb_build_object('level','none'); end if;

 -- letztes Ende eines Abo-Zeitraums eines Kindes (passend zum Kanal)
 select max(e.ends_at) into active_until from entitlement_periods e join parent_players pp on pp.player_id = e.player_id
  where pp.parent_id = fam and e.status = 'active'
   and (c.kind <> 'plan' or replace(lower(e.product_name),'-','') like '%' || replace(lower(c.plan_name),'-','') || '%')
   and (c.kind <> 'age' or exists(select 1 from players pl where pl.id = e.player_id
        and public.community_u_age(pl.birth_year) between c.u_from and c.u_to));
 trial_only := active_until is null
  and exists(select 1 from trial_families tf where tf.parent_id = fam)
  and not exists(select 1 from entitlement_periods e join parent_players pp on pp.player_id = e.player_id where pp.parent_id = fam);

 if c.requires_consent = 'photos' and f.consent_photos_at is null then locked_reason := 'consent_photos'; end if;
 if c.requires_consent = 'child_photos' and f.consent_child_photos_at is null then locked_reason := 'consent_child_photos'; end if;

 if c.kind in ('announcements') then return jsonb_build_object('level','read');
 elsif c.kind = 'ask_team' then return jsonb_build_object('level','ask');
 elsif c.kind = 'trial' then
  return jsonb_build_object('level', case when trial_only then 'ask' else 'none' end);
 elsif c.kind = 'camp' then
  if not exists(select 1 from camp_bookings b where b.camp_id = c.camp_id and b.parent_id = fam and b.status = 'paid') then
   return jsonb_build_object('level','none'); end if;
  if locked_reason is not null then return jsonb_build_object('level','locked','reason',locked_reason); end if;
  return jsonb_build_object('level', case when c.status = 'readonly' or c.write_mode = 'team' then 'read' else 'write' end);
 elsif c.kind in ('general','plan','age','region') then
  if active_until is null or active_until + grace < now() then return jsonb_build_object('level','none'); end if;
  if c.kind = 'region' then
   if f.region_id is null then return jsonb_build_object('level','locked','reason','region'); end if;
   if f.region_id is distinct from c.location_id then return jsonb_build_object('level','none'); end if;
  end if;
  if locked_reason is not null then return jsonb_build_object('level','locked','reason',locked_reason); end if;
  if active_until < now() then
   return jsonb_build_object('level','read','grace_until', active_until + grace);
  end if;
  return jsonb_build_object('level', case when c.status = 'readonly' or c.write_mode = 'team' then 'read' else 'write' end);
 end if;
 return jsonb_build_object('level','none');
end $$;
revoke all on function public.community_access(uuid, uuid) from public, anon, authenticated;
grant execute on function public.community_access(uuid, uuid) to service_role;

-- Anzeigename nach Wahl (voller Name / Vorname + Initiale / Initialen).
create function public.community_display_name(uid uuid) returns text language sql stable security definer set search_path=public as $$
 with n as (select regexp_split_to_array(btrim(coalesce(nullif(p.full_name,''),'Elternteil')), '\s+') parts,
   coalesce(m.name_style,'first_initial') style from profiles p left join community_members m on m.user_id = p.id where p.id = uid)
 select case style
  when 'full' then array_to_string(parts,' ')
  when 'initials' then upper(left(parts[1],1)) || '.' || coalesce(upper(left(parts[array_length(parts,1)],1)) || '.','')
  else parts[1] || case when array_length(parts,1) > 1 then ' ' || upper(left(parts[array_length(parts,1)],1)) || '.' else '' end end
 from n
$$;
revoke all on function public.community_display_name(uuid) from public, anon, authenticated;
grant execute on function public.community_display_name(uuid) to service_role;

-- Automatisch angelegte Grundkanäle (Abo-Unterkanäle sind unveröffentlicht, bis ein Admin die erste Nachricht schreibt).
insert into public.community_channels(area, kind, title, emoji, description, write_mode, published_at, sort) values
 ('academy','announcements','Ankündigungen','📣','Offizielle Infos von Pro Academy.','team', now(), 1),
 ('academy','ask_team','Frag das Team','💬','Deine Frage sieht nur das Team.','questions', now(), 2),
 ('trial','trial','Probetraining','👋','Fragen rund ums Probetraining. Antworten kommen vom Team.','questions', null, 5),
 ('training','general','Alle Abo-Eltern','⚽','Für alle Eltern mit aktivem Abo.','members', null, 10);
insert into public.community_channels(area, kind, title, emoji, plan_name, description, sort) values
 ('training','plan','FirstTouch-Eltern','●','FirstTouch','Nur für FirstTouch-Familien.', 11),
 ('training','plan','GameChanger-Eltern','●','GameChanger','Nur für GameChanger-Familien.', 12),
 ('training','plan','Pro-Player-Eltern','●','Pro-Player','Nur für Pro-Player-Familien.', 13);
insert into public.community_channels(area, kind, title, emoji, u_from, u_to, description, sort) values
 ('ages','age','U4–U5','🧒',4,5,'Eltern von Kindern U4 bis U5.', 30),
 ('ages','age','U6–U8','🧒',6,8,'Eltern von Kindern U6 bis U8.', 31),
 ('ages','age','U9–U12','🧒',9,12,'Eltern von Kindern U9 bis U12.', 32),
 ('ages','age','U13–U16','🧒',13,16,'Eltern von Kindern U13 bis U16.', 33);

-- Kanäle für Camps und Regionen nachziehen (idempotent; Jobs-Lauf und Admin rufen das auf).
create function public.community_sync_channels() returns int language plpgsql security definer set search_path=public as $$
declare n int := 0; k int;
begin
 insert into community_channels(area, kind, title, emoji, camp_id, description, sort)
  select 'camps','camp', c.title, '🏕️', c.id, 'Für alle Familien mit bezahlter Buchung.', 50 from camps c
  where not exists(select 1 from community_channels x where x.kind = 'camp' and x.camp_id = c.id);
 get diagnostics k = row_count; n := n + k;
 insert into community_channels(area, kind, title, emoji, location_id, description, sort)
  select 'regions','region', l.name, '📍', l.id, 'Für Familien aus dieser Region.', 70 from locations l
  where l.is_region and l.active and not exists(select 1 from community_channels x where x.kind = 'region' and x.location_id = l.id);
 get diagnostics k = row_count; n := n + k;
 update community_channels x set status = 'archived' from locations l where x.kind = 'region' and l.id = x.location_id and not (l.is_region and l.active) and x.status <> 'archived';
 return n;
end $$;
revoke all on function public.community_sync_channels() from public, anon, authenticated;
grant execute on function public.community_sync_channels() to service_role;
select public.community_sync_channels();


-- Mitglieder je Kanal, pro Person gezählt (Haupt- und Zweitkonto einzeln).
create function public.community_member_counts() returns table(channel_id uuid, members int) language sql stable security definer set search_path=public as $$
 with users as (
  select p.auth_user_id uid from parents p join community_families f on f.parent_id = p.id
   where p.archived_at is null and p.auth_user_id is not null and f.enabled and f.consent_privacy_at is not null
  union
  select c.auth_user_id from parent_co_accounts c join community_families f on f.parent_id = c.parent_id
   where c.status = 'active' and f.enabled and f.consent_privacy_at is not null)
 select ch.id, count(u.uid) filter (where community_access(u.uid, ch.id)->>'level' in ('read','write','ask'))::int
 from community_channels ch cross join users u where ch.status <> 'archived' group by ch.id
$$;
revoke all on function public.community_member_counts() from public, anon, authenticated;
grant execute on function public.community_member_counts() to service_role;


create function public.community_my_channels(uid uuid) returns table(channel_id uuid, access jsonb) language sql stable security definer set search_path=public as $$
 select id, community_access(uid, id) from community_channels where status <> 'archived'
$$;
create function public.community_names(uids uuid[]) returns table(user_id uuid, name text, team boolean) language sql stable security definer set search_path=public as $$
 select p.id, case when p.role in ('admin','staff') then coalesce(nullif(s.display_name,''), nullif(p.full_name,''), 'Pro Academy')
   else community_display_name(p.id) end, p.role in ('admin','staff')
 from profiles p left join staff_profiles s on s.id = p.id where p.id = any(uids)
$$;
revoke all on function public.community_my_channels(uuid), public.community_names(uuid[]) from public, anon, authenticated;
grant execute on function public.community_my_channels(uuid), public.community_names(uuid[]) to service_role;

commit;
