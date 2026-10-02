-- Coaches use the same verified-payment import as admins, through the server only.
-- Preserve the installed payment, occupancy, family and notification logic.
begin;
do $$
declare
 name text;
 definition text;
 admin_guard text := 'and role=''admin'') then raise exception ''Admin required'';';
 team_guard text := 'and role in (''admin'',''staff'')) then raise exception ''Academy team required'';';
begin
 foreach name in array array['camp_import_paid_booking','camp_import_review_booking'] loop
  select pg_get_functiondef(('public.'||name||'(jsonb)')::regprocedure) into definition;
  if strpos(definition,admin_guard)>0 then
   execute replace(definition,admin_guard,team_guard);
  elsif strpos(definition,team_guard)=0 then
   raise exception 'Unexpected authorization guard in %; migration aborted',name;
  end if;
 end loop;
end $$;
revoke all on function public.camp_import_paid_booking(jsonb),public.camp_import_review_booking(jsonb) from public,anon,authenticated;
grant execute on function public.camp_import_paid_booking(jsonb),public.camp_import_review_booking(jsonb) to service_role;
commit;
