-- Consistent deactivation and controlled replay of failed deliveries.
create unique index parents_customer_contact on public.parents(stripe_customer_id,lower(contact_email)) where stripe_customer_id is not null;
create or replace function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$
 select case when p.role='staff' and not exists(select 1 from public.staff_profiles s where s.id=p.id and s.active) then null else p.role end from public.profiles p where p.id=auth.uid()
$$;
create or replace function public.owns_player(pid uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.parent_players pp join public.parents p on p.id=pp.parent_id where pp.player_id=pid and p.auth_user_id=auth.uid() and p.archived_at is null) $$;
create function public.retry_notification(job uuid, checked_not_delivered boolean, retry_reason text) returns void language plpgsql security definer set search_path=public as $$
declare current_job public.notification_jobs;
begin
 if not public.is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 if not checked_not_delivered or length(trim(retry_reason))<5 then raise exception 'Vor erneutem Versand Zustellung prüfen und Grund angeben'; end if;
 select * into current_job from public.notification_jobs where id=job for update;
 if not found then raise exception 'Auftrag nicht gefunden'; end if;
 if current_job.status not in ('uncertain','failed') then raise exception 'Nur fehlgeschlagene oder unklare Aufträge können freigegeben werden'; end if;
 update public.notification_jobs set status='pending',available_at=now(),locked_at=null where id=job;
 insert into public.audit_log(actor_id,action,table_name,record_id,old_value,new_value,reason) values(auth.uid(),'MAIL_RETRY','notification_jobs',job,jsonb_build_object('status',current_job.status),jsonb_build_object('status','pending'),retry_reason);
end $$;
revoke execute on function public.retry_notification(uuid,boolean,text) from public,anon;
grant execute on function public.retry_notification(uuid,boolean,text) to authenticated;
create function public.unlink_parent_player(link uuid, unlink_reason text) returns void language plpgsql security definer set search_path=public as $$ begin
 if not public.is_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 if length(trim(unlink_reason))<5 then raise exception 'Begründung erforderlich'; end if;
 perform set_config('app.audit_reason',unlink_reason,true);
 delete from public.parent_players where id=link;
end $$;
revoke execute on function public.unlink_parent_player(uuid,text) from public,anon;
grant execute on function public.unlink_parent_player(uuid,text) to authenticated;
