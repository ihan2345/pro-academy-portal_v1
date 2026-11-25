-- Einladungswelle (Super-Admin, /admin/einstellungen).
-- Verschickt NICHTS von selbst. Erst der Knopf „Welle starten“ erstellt
-- Einladungen, und nur nach Bestätigung der angezeigten Empfängerzahl.
--
-- Empfänger der Welle (nur für die Welle, Selbstaktivierung bleibt unverändert):
--   * noch nicht mit einem Portal-Konto verbunden, nicht archiviert
--   * laufendes Abo (active, trialing, past_due) ODER bezahlte Buchung in einem
--     Camp, dessen letzter Camptag noch nicht vorbei ist
--   * gültige, eindeutige E-Mail-Adresse, kein Team-Konto mit dieser Adresse,
--     keine offene Einladung
-- Zusätzlich gibt die Welle bereits verbundene, berechtigte Familien frei, die
-- noch „zurückgehalten“ sind (ohne Einladungsmail).
-- Unverändert: Training-Sperre (recipients), parent_auto_mail, Einzel-
-- Einladungen, Selbstaktivierung, Camp-/Probetraining-Regeln. Zurückgehaltene
-- Mails bleiben zurückgehalten; alte, gesperrte Einladungsmails ohne Link
-- werden als verworfen markiert und nie verschickt.
-- Apply after 061.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.invitation_wave_basis(pid uuid) returns text
language sql stable security definer set search_path=public as $$
 select case
  when exists(select 1 from subscriptions s where s.parent_id=pid and s.status in ('active','trialing','past_due')) then 'abo'
  when exists(select 1 from camp_bookings b join camps c on c.id=b.camp_id
   where b.parent_id=pid and b.status='paid' and b.paid_at is not null
   and (select max((d->>'ends_at')::timestamptz) from jsonb_array_elements(c.days) d)>=now()) then 'camp'
 end
$$;

-- Alle Familien der Welle mit Entscheidung „einladen“ oder Ausschlussgrund.
create function public.invitation_wave_families()
returns table(parent_id uuid, full_name text, email text, basis text, decision text)
language sql stable security definer set search_path=public as $$
 select p.id, p.full_name, lower(btrim(p.contact_email)), b.basis,
  case
   when lower(btrim(p.contact_email)) !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then 'mail_ungueltig'
   when (select count(*) from parents q where q.archived_at is null
         and lower(btrim(q.contact_email))=lower(btrim(p.contact_email)))>1 then 'dublette'
   when exists(select 1 from auth.users u join profiles f on f.id=u.id
         where lower(btrim(u.email))=lower(btrim(p.contact_email)) and f.role<>'parent') then 'team_konto'
   when exists(select 1 from parent_invitations i where i.parent_id=p.id
         and i.consumed_at is null and i.expires_at>now()) then 'einladung_offen'
   else 'einladen'
  end
 from parents p cross join lateral (select invitation_wave_basis(p.id) basis) b
 where p.archived_at is null and p.auth_user_id is null and b.basis is not null
$$;

create function public.invitation_wave_holds()
returns table(parent_id uuid, full_name text, email text, basis text)
language sql stable security definer set search_path=public as $$
 select p.id, p.full_name, lower(btrim(p.contact_email)), invitation_wave_basis(p.id)
 from parents p
 where p.archived_at is null and p.auth_user_id is not null and p.notifications_held
  and invitation_wave_basis(p.id) is not null
$$;

create function public.invitation_wave_overview() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare settings jsonb;
begin
 if not can_manage_features() then raise exception 'Forbidden' using errcode='42501'; end if;
 select value into settings from system_settings where key='portal_delivery_release';
 return jsonb_build_object(
  'delivery_enabled', coalesce((settings->>'enabled')::boolean,false),
  'invite', coalesce((select jsonb_agg(jsonb_build_object('parent_id',parent_id,'name',full_name,'email',email,'basis',basis) order by full_name)
    from invitation_wave_families() where decision='einladen'),'[]'),
  'skipped', coalesce((select jsonb_agg(jsonb_build_object('parent_id',parent_id,'name',full_name,'email',email,'basis',basis,'reason',decision) order by decision,full_name)
    from invitation_wave_families() where decision<>'einladen'),'[]'),
  'release_holds', coalesce((select jsonb_agg(jsonb_build_object('parent_id',parent_id,'name',full_name,'email',email,'basis',basis) order by full_name)
    from invitation_wave_holds()),'[]'),
  'old_held_invitations', (select count(*) from notification_jobs where kind='invitation' and status='held'
    and coalesce(payload->>'invitation_discarded','false')<>'true'),
  'wave_jobs', coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from notification_jobs
    where kind='invitation' and payload->>'invitation_wave'='true' group by status) s),'{}'),
  'accepted', (select count(*) from parent_invitations i join notification_jobs j on j.payload->>'invitation_id'=i.id::text
    where j.kind='invitation' and j.payload->>'invitation_wave'='true' and i.consumed_at is not null)
 );
end $$;

create function public.start_invitation_wave(input jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); settings jsonb; item jsonb; fam record; inv uuid;
 wanted uuid[]; current uuid[]; holds uuid[]; invited int:=0; released int:=0;
 valid_until timestamptz:=now()+interval '14 days';
begin
 if not can_manage_features() then raise exception 'Forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('invitation_wave'));
 select value into settings from system_settings where key='portal_delivery_release';
 if not coalesce((settings->>'enabled')::boolean,false) then raise exception 'WAVE_DELIVERY_DISABLED'; end if;
 if jsonb_typeof(input->'invitations')<>'array' or jsonb_typeof(input->'release_holds')<>'array' then raise exception 'WAVE_INPUT'; end if;
 -- Die bestätigte Liste muss exakt der aktuellen Empfängerliste entsprechen.
 select coalesce(array_agg((x->>'parent_id')::uuid order by x->>'parent_id'),'{}') into wanted from jsonb_array_elements(input->'invitations') x;
 select coalesce(array_agg(parent_id order by parent_id::text),'{}') into current from invitation_wave_families() where decision='einladen';
 if wanted is distinct from current or cardinality(current)<>coalesce((input->>'expected_invitations')::int,-1) then raise exception 'WAVE_CHANGED'; end if;
 select coalesce(array_agg((x#>>'{}')::uuid order by x#>>'{}'),'{}') into wanted from jsonb_array_elements(input->'release_holds') x;
 select coalesce(array_agg(parent_id order by parent_id::text),'{}') into holds from invitation_wave_holds();
 if wanted is distinct from holds or cardinality(holds)<>coalesce((input->>'expected_releases')::int,-1) then raise exception 'WAVE_CHANGED'; end if;

 for item in select * from jsonb_array_elements(input->'invitations') loop
  if coalesce(item->>'token_hash','') !~ '^[a-f0-9]{64}$'
   or coalesce(item->>'url','') !~ '^https://portal[.]proacademy-ak[.]com/einladung[?]token=[a-f0-9]{64}$' then
   raise exception 'WAVE_LINK';
  end if;
  select p.* into strict fam from parents p where p.id=(item->>'parent_id')::uuid for update;
  update parent_invitations set expires_at=now() where parent_id=fam.id and consumed_at is null;
  insert into parent_invitations(parent_id,email,token_hash,expires_at,created_by)
   values(fam.id,fam.contact_email,item->>'token_hash',valid_until,actor) returning id into inv;
  -- Wie bei der Einzel-Einladung: Familienmails erst nach dem Annehmen.
  update parents set notifications_held=true where id=fam.id;
  -- Alte, gesperrte Einladungsabsichten (ohne Link) endgültig verwerfen.
  update notification_jobs set payload=payload||'{"invitation_discarded":true}',last_error='Durch Einladungswelle ersetzt'
   where kind='invitation' and status='held' and lower(btrim(recipient))=lower(btrim(fam.contact_email))
   and coalesce(payload->>'invitation_discarded','false')<>'true';
  insert into notification_jobs(idempotency_key,kind,recipient,payload,status)
   values('wave-invitation:'||inv,'invitation',fam.contact_email,jsonb_build_object('url',item->>'url','parent_name',fam.full_name,
    'invitation_id',inv,'invitation_wave',true,'expires_at',valid_until),'pending');
  insert into audit_log(actor_id,action,table_name,record_id,new_value)
   values(actor,'INVITATION_WAVE','parent_invitations',inv,jsonb_build_object('parent_id',fam.id,'basis',invitation_wave_basis(fam.id)));
  invited:=invited+1;
 end loop;

 update parents set notifications_held=false where id=any(holds);
 get diagnostics released=row_count;
 insert into audit_log(actor_id,action,table_name,record_id,new_value)
  select actor,'NOTIFICATIONS_RELEASED_BY_WAVE','parents',h,'{"notifications_held":false}' from unnest(holds) h;
 return jsonb_build_object('invited',invited,'released',released);
end $$;

-- Testeinladung an die eigene Adresse des Super-Admins (Link führt zur Anmeldung).
create function public.send_invitation_wave_test(input jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); mail text; who text; job uuid; settings jsonb;
begin
 if not can_manage_features() then raise exception 'Forbidden' using errcode='42501'; end if;
 select value into settings from system_settings where key='portal_delivery_release';
 if not coalesce((settings->>'enabled')::boolean,false) then raise exception 'WAVE_DELIVERY_DISABLED'; end if;
 if coalesce(input->>'url','')<>'https://portal.proacademy-ak.com/login' then raise exception 'WAVE_LINK'; end if;
 select lower(btrim(u.email)),coalesce(nullif(f.full_name,''),'Test') into mail,who
  from auth.users u join profiles f on f.id=u.id where u.id=actor and u.email_confirmed_at is not null;
 if mail is null then raise exception 'WAVE_TEST_RECIPIENT'; end if;
 if (select count(*) from notification_jobs where kind='invitation' and payload->>'invitation_wave_test'='true'
  and created_at>now()-interval '1 hour')>=5 then raise exception 'WAVE_TEST_LIMIT'; end if;
 insert into notification_jobs(idempotency_key,kind,recipient,payload,status)
  values('wave-test:'||gen_random_uuid(),'invitation',mail,jsonb_build_object('url',input->>'url','parent_name',who,
   'invitation_wave_test',true,'expires_at',now()+interval '14 days'),'pending') returning id into job;
 return job;
end $$;

-- Versandregel: Wellen-Einladungen brauchen keine Adressliste, aber den
-- Hauptschalter und eine gültige, offene Einladung der unverbundenen Familie.
alter function public.parent_delivery_allowed(text,text,jsonb) rename to parent_delivery_allowed_before_invitation_wave;
revoke all on function public.parent_delivery_allowed_before_invitation_wave(text,text,jsonb) from public,anon,authenticated,service_role;
create function public.parent_delivery_allowed(recipient text,kind text,payload jsonb) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare settings jsonb;
begin
 if kind='invitation' and (payload->>'invitation_wave'='true' or payload->>'invitation_wave_test'='true') then
  select value into settings from system_settings where key='portal_delivery_release';
  if not coalesce((settings->>'enabled')::boolean,false) then return false; end if;
  if payload->>'invitation_wave_test'='true' then
   return exists(select 1 from auth.users u join profiles f on f.id=u.id
    where lower(btrim(u.email))=lower(btrim(recipient)) and f.role='admin' and u.email_confirmed_at is not null);
  end if;
  return exists(select 1 from parent_invitations i join parents p on p.id=i.parent_id
   where i.id::text=payload->>'invitation_id' and lower(btrim(i.email))=lower(btrim(recipient))
   and lower(btrim(p.contact_email))=lower(btrim(recipient)) and i.consumed_at is null and i.expires_at>now()
   and p.archived_at is null and p.auth_user_id is null);
 end if;
 return parent_delivery_allowed_before_invitation_wave(recipient,kind,payload);
end $$;

revoke all on function public.invitation_wave_basis(uuid),public.invitation_wave_families(),public.invitation_wave_holds() from public,anon,authenticated;
grant execute on function public.invitation_wave_basis(uuid),public.invitation_wave_families(),public.invitation_wave_holds() to service_role;
revoke all on function public.invitation_wave_overview(),public.start_invitation_wave(jsonb),public.send_invitation_wave_test(jsonb) from public,anon;
grant execute on function public.invitation_wave_overview(),public.start_invitation_wave(jsonb),public.send_invitation_wave_test(jsonb) to authenticated;
revoke all on function public.parent_delivery_allowed(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.parent_delivery_allowed(text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
