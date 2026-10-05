-- Run inside a rolled-back transaction with fixed development identities.
create function pg_temp.expect_calendar_ux_error(p_sql text,p_error text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm=p_error then return; end if;
    raise exception 'EXPECTED_%,GOT_%',p_error,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',p_error;
end $$;

do $setup$
declare v_teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid;
  v_admin uuid:=current_setting('test.parent_preview.admin_user_id')::uuid;
begin
  if not exists(select 1 from public.profiles where id=v_teacher and role='staff' and purpose='test')
    or not exists(select 1 from public.profiles where id=v_admin and role='admin' and purpose='test') then raise exception 'FIXED_TEST_STAFF_REQUIRED'; end if;
  if has_table_privilege('authenticated','public.staff_calendar_settings','insert,update,delete')
    or has_function_privilege('anon','public.save_calendar_scheduling_settings(jsonb,jsonb,timestamptz)','execute')
    or has_function_privilege('anon','public.get_calendar_series(uuid)','execute') then raise exception 'CALENDAR_UX_ACL_FAILED'; end if;
  perform set_config('test.calendar_ux.series',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
end $setup$;

set local role authenticated;
do $settings$
declare v_workspace jsonb; v_saved jsonb;
  v_school jsonb:='[{"weekday":1,"startMinute":480,"endMinute":960}]';
  v_available jsonb:='[{"weekday":1,"startMinute":540,"endMinute":1200},{"weekday":6,"startMinute":540,"endMinute":1080}]';
begin
  v_workspace:=public.get_calendar_workspace(now(),now()+interval '7 days');
  v_saved:=public.save_calendar_scheduling_settings(v_school,v_available,(v_workspace->>'settingsUpdatedAt')::timestamptz);
  if v_saved->'schoolWindows'<>v_school or v_saved->'availableWindows'<>v_available then raise exception 'BOTH_RULES_MUST_PERSIST'; end if;
  if public.save_calendar_scheduling_settings(v_school,v_available,'2000-01-01T00:00:00Z')<>v_saved then raise exception 'SETTINGS_REPLAY_CHANGED'; end if;
  perform pg_temp.expect_calendar_ux_error('select public.save_calendar_scheduling_settings(''[]'',''[]'',''2000-01-01T00:00:00Z'')','CONFLICT');
  perform pg_temp.expect_calendar_ux_error('select public.save_calendar_scheduling_settings(''[]'',''[{"weekday":1,"startMinute":480,"endMinute":600},{"weekday":1,"startMinute":540,"endMinute":660}]'')','VALIDATION');
  perform public.save_calendar_school_windows('[]',(v_saved->>'updatedAt')::timestamptz);
  v_workspace:=public.get_calendar_workspace(now(),now()+interval '7 days');
  if v_workspace->'schoolWindows'<>'[]' or v_workspace->'availableWindows'<>v_available then raise exception 'LEGACY_WRITE_MUST_PRESERVE_AVAILABLE_RANGES'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.teacher_user_id'),'role','authenticated','aal','aal2')::text,true);
end $settings$;

do $series$
declare v_start timestamptz:=date_trunc('day',now())+interval '90 days 12 hours'; v_result jsonb;
begin
  perform pg_temp.expect_calendar_ux_error('select public.save_calendar_scheduling_settings(''[]'',''[]'')','FORBIDDEN');
  v_result:=public.save_calendar_event(current_setting('test.calendar_ux.series')::uuid,'task','周期关联权限检查','仅事务回滚',v_start,v_start+interval '30 minutes','','{}',null,null,
    jsonb_build_object('frequency','weekly','interval',1,'until',((v_start at time zone 'Asia/Shanghai')::date+14)::text,'timeZone','Asia/Shanghai'));
  if jsonb_array_length(public.get_calendar_series(current_setting('test.calendar_ux.series')::uuid))<>3 then raise exception 'SERIES_MUST_INCLUDE_OTHER_WEEKS'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.admin_user_id'),'role','authenticated','aal','aal2')::text,true);
  if public.get_calendar_series(current_setting('test.calendar_ux.series')::uuid)<>'[]' then raise exception 'UNRELATED_STAFF_SAW_PRIVATE_SERIES'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.expect_calendar_ux_error(format('select public.get_calendar_series(%L)',current_setting('test.calendar_ux.series')),'FORBIDDEN');
end $series$;
reset role;
