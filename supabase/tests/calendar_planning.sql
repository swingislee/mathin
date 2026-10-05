-- 本机事务回滚，固定开发身份；覆盖新写入入口的权限、系列原子性和保留的教师锁。
create function pg_temp.expect_planning_error(p_sql text,p_error text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm=p_error then return; end if;
    raise exception 'EXPECTED_%,GOT_%',p_error,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',p_error;
end $$;

do $setup$
declare v_teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid;
  v_admin uuid:=current_setting('test.parent_preview.admin_user_id')::uuid; v_start timestamptz; v_closed_start timestamptz; v_student uuid; v_name text; v_months timestamptz[]; v_dst timestamptz[];
begin
  if not exists(select 1 from public.profiles where id=v_teacher and role='staff' and purpose='test')
    or not exists(select 1 from public.profiles where id=v_admin and role='admin' and purpose='test') then raise exception 'FIXED_TEST_STAFF_REQUIRED'; end if;
  if has_table_privilege('authenticated','public.staff_calendar_settings','insert,update,delete')
    or has_table_privilege('authenticated','public.staff_calendar_slot_series','select,insert,update,delete')
    or has_function_privilege('anon','public.save_calendar_school_windows(jsonb,timestamptz)','execute')
    or has_function_privilege('anon','public.save_assessment_slot_series(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,jsonb,timestamptz)','execute')
    or has_function_privilege('authenticated','public.staff_calendar_recurrence_starts(timestamptz,jsonb)','execute')
    or has_function_privilege('authenticated','public.staff_calendar_campus_closed(uuid,timestamptz,timestamptz)','execute')
    or has_function_privilege('authenticated','public.staff_calendar_save_occurrence(uuid,text,text,text,timestamptz,timestamptz,text,uuid[],uuid,timestamptz,uuid,jsonb)','execute')
    then raise exception 'PLANNING_ACL_FAILED'; end if;
  select array_agg(t order by t) into v_months from public.staff_calendar_recurrence_starts('2027-01-31 09:00+08',
    '{"frequency":"monthly","interval":1,"until":"2027-03-31","timeZone":"Asia/Shanghai"}') t;
  if v_months<>array['2027-01-31 09:00+08','2027-02-28 09:00+08','2027-03-31 09:00+08']::timestamptz[] then raise exception 'MONTHLY_ANCHOR_FAILED'; end if;
  select array_agg(t order by t) into v_dst from public.staff_calendar_recurrence_starts('2027-03-13 14:00Z',
    '{"frequency":"daily","interval":1,"until":"2027-03-15","timeZone":"America/New_York"}') t;
  if v_dst<>array['2027-03-13 14:00Z','2027-03-14 13:00Z','2027-03-15 13:00Z']::timestamptz[] then raise exception 'RECURRENCE_DST_FAILED'; end if;
  perform pg_temp.expect_planning_error('select public.staff_calendar_recurrence_starts(now(),''{"frequency":"daily","interval":0,"until":"2027-10-01","timeZone":"Asia/Shanghai"}'')','VALIDATION');
  perform pg_temp.expect_planning_error('select public.staff_calendar_recurrence_starts(now(),''{"frequency":"daily","interval":1,"until":"2027-10-01","timeZone":"Missing/Zone"}'')','VALIDATION');
  select t into v_start from generate_series(
    (((now() at time zone 'Asia/Shanghai')::date+30)+time '06:00') at time zone 'Asia/Shanghai',
    (((now() at time zone 'Asia/Shanghai')::date+100)+time '06:00') at time zone 'Asia/Shanghai',interval '1 day') t
    where not exists(select 1 from generate_series(0,2) n
      where public.staff_calendar_time_busy(v_teacher,t+make_interval(days=>n),t+make_interval(days=>n,hours=>6))
        or public.staff_calendar_time_busy(v_admin,t+make_interval(days=>n),t+make_interval(days=>n,hours=>6))
        or exists(select 1 from public.assessment_slots where teacher_id=v_teacher and enabled
          and tstzrange(starts_at,ends_at,'[)')&&tstzrange(t+make_interval(days=>n),t+make_interval(days=>n,hours=>6),'[)')))
    order by t limit 1;
  if v_start is null then raise exception 'AVAILABLE_PLANNING_TEST_TIME_REQUIRED'; end if;
  perform set_config('test.planning.start',v_start::text,true);
  select t into v_closed_start from generate_series(
    (((now() at time zone 'Asia/Shanghai')::date+3)+time '06:00') at time zone 'Asia/Shanghai',
    (((now() at time zone 'Asia/Shanghai')::date+10)+time '06:00') at time zone 'Asia/Shanghai',interval '1 day') t
    where not public.staff_calendar_campus_closed(null,t,t+interval '3 hours')
      and not public.staff_calendar_campus_closed(null,t-interval '1 day',t-interval '1 day'+interval '3 hours')
      and not public.staff_calendar_time_busy(v_teacher,t,t+interval '3 hours')
      and not public.staff_calendar_time_busy(v_teacher,t-interval '1 day',t-interval '1 day'+interval '3 hours')
      and not exists(select 1 from public.assessment_slots where teacher_id=v_teacher and enabled
        and (tstzrange(starts_at,ends_at,'[)')&&tstzrange(t,t+interval '3 hours','[)')
          or tstzrange(starts_at,ends_at,'[)')&&tstzrange(t-interval '1 day',t-interval '1 day'+interval '3 hours','[)')))
    order by t limit 1;
  if v_closed_start is null then raise exception 'AVAILABLE_CLOSED_DAY_TEST_TIME_REQUIRED'; end if;
  perform set_config('test.planning.closed_start',v_closed_start::text,true);
  select s.id into v_student from public.students s join public.leads l on l.student_id=s.id
    where s.id in(current_setting('test.parent_preview.first_student_id')::uuid,current_setting('test.parent_preview.second_student_id')::uuid)
      and s.source='本机小程序固定联调' and l.purpose='test'
      and not exists(select 1 from public.lead_invitation_threads t where t.lead_id=l.id and t.state not in ('completed','cancelled'))
    order by s.id limit 1;
  if v_student is null then raise exception 'AVAILABLE_FIXED_TEST_CHILD_REQUIRED'; end if;
  perform set_config('test.planning.student',v_student::text,true);
  foreach v_name in array array['strategy','milestone','meeting','series','atomic','slot_series','slot_atomic','holiday','closed_slot','closed_atomic'] loop
    perform set_config('test.planning.'||v_name,gen_random_uuid()::text,true);
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
end $setup$;

set local role authenticated;
do $admin_settings$
declare v_start timestamptz:=current_setting('test.planning.start')::timestamptz; v_closed_start timestamptz:=current_setting('test.planning.closed_start')::timestamptz;
  v_workspace jsonb; v_saved jsonb; v_windows jsonb;
  v_campus uuid; v_holiday uuid;
begin
  v_workspace:=public.get_calendar_workspace(v_start,v_start+interval '366 days');
  if not (v_workspace->>'canManageSettings')::boolean or jsonb_typeof(v_workspace->'teachingCalendar')<>'array'
    or jsonb_typeof(v_workspace->'schoolWindows')<>'array' then raise exception 'WORKSPACE_SETTINGS_FAILED'; end if;
  v_windows:='[{"weekday":6,"startMinute":480,"endMinute":720},{"weekday":6,"startMinute":720,"endMinute":780}]';
  v_saved:=public.save_calendar_school_windows(v_windows,(v_workspace->>'settingsUpdatedAt')::timestamptz);
  if v_saved->'schoolWindows'<>v_windows then raise exception 'WINDOWS_SAVE_FAILED'; end if;
  if public.save_calendar_school_windows(v_windows,'2000-01-01T00:00:00Z')->>'updatedAt'<>v_saved->>'updatedAt' then raise exception 'WINDOWS_REPLAY_FAILED'; end if;
  perform pg_temp.expect_planning_error(format('select public.save_calendar_school_windows(%L,%L)',
    '[{"weekday":6,"startMinute":700,"endMinute":800},{"weekday":6,"startMinute":780,"endMinute":900}]',v_saved->>'updatedAt'),'VALIDATION');
  perform pg_temp.expect_planning_error(format('select public.save_calendar_school_windows(%L,%L)',
    '[{"weekday":5,"startMinute":480,"endMinute":720}]',(v_saved->>'updatedAt')::timestamptz-interval '1 second'),'CONFLICT');
  v_campus:=public.create_campus_v2('日历规划回滚校区 '||gen_random_uuid()::text,'仅回滚事务');
  perform set_config('test.planning.campus',v_campus::text,true);
  perform public.save_assessment_slot(current_setting('test.planning.closed_slot')::uuid,current_setting('test.parent_preview.teacher_user_id')::uuid,
    v_campus,array['math'],array[3],v_closed_start,v_closed_start+interval '40 minutes',true);
  perform public.create_teaching_calendar_entry_v2(v_campus,'闭校后可约时段回滚检查','closed',
    (v_closed_start at time zone 'Asia/Shanghai')::date,(v_closed_start at time zone 'Asia/Shanghai')::date);
  v_holiday:=public.create_teaching_calendar_entry_v2(v_campus,'周范围外休假回滚检查','closed',
    (v_start at time zone 'Asia/Shanghai')::date+500,(v_start at time zone 'Asia/Shanghai')::date+500,'',null);
  if not exists(select 1 from jsonb_array_elements(public.get_calendar_workspace(v_start,v_start+interval '7 days')->'teachingCalendar') item
    where item->>'id'=v_holiday::text) then raise exception 'COMPLETE_TEACHING_CALENDAR_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.teacher_user_id'),'role','authenticated','aal','aal2')::text,true);
end $admin_settings$;

do $teacher_events$
declare v_start timestamptz:=current_setting('test.planning.start')::timestamptz;
  v_admin uuid:=current_setting('test.parent_preview.admin_user_id')::uuid; v_event jsonb; v_repeat jsonb; v_until text;
  v_series uuid:=current_setting('test.planning.series')::uuid; v_child public.staff_calendar_events%rowtype; v_other_updated timestamptz;
begin
  if (public.get_calendar_workspace(v_start,v_start+interval '1 day')->>'canManageSettings')::boolean then raise exception 'FIXED_TEACHER_MUST_BE_SETTINGS_READ_ONLY'; end if;
  perform pg_temp.expect_planning_error('select public.save_calendar_school_windows(''[]'')','FORBIDDEN');
  v_event:=public.save_calendar_event(current_setting('test.planning.strategy')::uuid,'strategy','全年战略','回滚检查',v_start,v_start+interval '370 days','','{}');
  if v_event->>'kind'<>'strategy' or v_event->>'seriesId' is not null then raise exception 'STRATEGY_CONTRACT_FAILED'; end if;
  perform pg_temp.expect_planning_error(format('select public.save_calendar_event(%L,''strategy'',''过长'','''',%L,%L,'''',''{}'')',
    gen_random_uuid(),v_start,v_start+interval '371 days'),'VALIDATION');
  v_event:=public.save_calendar_event(current_setting('test.planning.milestone')::uuid,'milestone','关键节点','回滚检查',v_start,v_start+interval '30 minutes','',array[v_admin]);
  perform set_config('test.planning.milestone.updated',v_event->>'updatedAt',true);
  perform pg_temp.expect_planning_error(format('select public.save_calendar_event(%L,''milestone'',''无效节点'','''',%L,%L,'''',''{}'')',
    gen_random_uuid(),v_start,v_start+interval '40 minutes'),'VALIDATION');
  perform public.save_calendar_event(current_setting('test.planning.meeting')::uuid,'meeting','同一时刻会议','回滚检查',v_start,v_start+interval '40 minutes','','{}');
  v_event:=public.change_calendar_event_status(current_setting('test.planning.milestone')::uuid,'cancelled',(v_event->>'updatedAt')::timestamptz);
  v_event:=public.change_calendar_event_status(current_setting('test.planning.milestone')::uuid,'scheduled',(v_event->>'updatedAt')::timestamptz);
  v_until:=((v_start at time zone 'Asia/Shanghai')::date+14)::text;
  v_repeat:=jsonb_build_object('frequency','weekly','interval',1,'until',v_until,'timeZone','Asia/Shanghai');
  v_event:=public.save_calendar_event(v_series,'task','重复任务','回滚检查',v_start+interval '2 hours',v_start+interval '3 hours','','{}',null,null,v_repeat);
  if (v_event->>'seriesId')::uuid<>v_series or v_event->'recurrence'<>v_repeat
    or (select count(*) from public.staff_calendar_events where series_id=v_series)<>3 then raise exception 'EVENT_SERIES_FAILED'; end if;
  if public.save_calendar_event(v_series,'task','重复任务','回滚检查',v_start+interval '2 hours',v_start+interval '3 hours','','{}',null,null,v_repeat)<>v_event
    or (select count(*) from public.staff_calendar_events where series_id=v_series)<>3 then raise exception 'EVENT_SERIES_REPLAY_FAILED'; end if;
  select * into v_child from public.staff_calendar_events where series_id=v_series and id<>v_series order by starts_at limit 1;
  select updated_at into v_other_updated from public.staff_calendar_events where series_id=v_series and id not in(v_series,v_child.id);
  perform public.save_calendar_event(v_child.id,'task','仅本次修改','回滚检查',v_child.starts_at+interval '30 minutes',v_child.ends_at+interval '30 minutes','',array[current_setting('test.parent_preview.teacher_user_id')::uuid],null,v_child.updated_at);
  if (select title from public.staff_calendar_events where id=v_series)<>'重复任务'
    or (select updated_at from public.staff_calendar_events where series_id=v_series and id not in(v_series,v_child.id))<>v_other_updated
    or (select recurrence from public.staff_calendar_events where id=v_child.id)<>v_repeat then raise exception 'SINGLE_OCCURRENCE_EDIT_FAILED'; end if;
  perform pg_temp.expect_planning_error(format('select public.save_calendar_event(%L,''task'',''重复任务'',''回滚检查'',%L,%L,'''',''{}'',null,null,%L)',
    v_series,v_start+interval '2 hours',v_start+interval '3 hours',jsonb_build_object('frequency','daily','interval',1,'until',v_until,'timeZone','Asia/Shanghai')),'CONFLICT');
  perform public.save_calendar_event(gen_random_uuid(),'meeting','第二天原子冲突','',v_start+interval '1 day 3 hours',v_start+interval '1 day 3 hours 40 minutes','','{}');
  v_repeat:=jsonb_build_object('frequency','daily','interval',1,'until',((v_start at time zone 'Asia/Shanghai')::date+2)::text,'timeZone','Asia/Shanghai');
  perform pg_temp.expect_planning_error(format('select public.save_calendar_event(%L,''meeting'',''整组回滚'','''',%L,%L,'''',''{}'',null,null,%L)',
    current_setting('test.planning.atomic'),v_start+interval '3 hours',v_start+interval '3 hours 40 minutes',v_repeat),'TIME_UNAVAILABLE');
  if exists(select 1 from public.staff_calendar_events where id=current_setting('test.planning.atomic')::uuid
    or series_id=current_setting('test.planning.atomic')::uuid) then raise exception 'EVENT_SERIES_NOT_ATOMIC'; end if;
  perform pg_temp.expect_planning_error(format('select public.save_calendar_event(%L,''task'',''过长重复'','''',%L,%L,'''',''{}'',null,null,%L)',
    gen_random_uuid(),v_start,v_start+interval '40 minutes',jsonb_build_object('frequency','daily','interval',1,'until',((v_start at time zone 'Asia/Shanghai')::date+371)::text,'timeZone','Asia/Shanghai')),'VALIDATION');
end $teacher_events$;

do $teacher_slots$
declare v_start timestamptz:=current_setting('test.planning.start')::timestamptz; v_teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid;
  v_campus uuid:=current_setting('test.planning.campus')::uuid; v_id uuid:=current_setting('test.planning.slot_series')::uuid; v_repeat jsonb; v_slot jsonb;
  v_closed_start timestamptz:=current_setting('test.planning.closed_start')::timestamptz;
begin
  v_repeat:=jsonb_build_object('frequency','daily','interval',1,'until',((v_start at time zone 'Asia/Shanghai')::date+2)::text,'timeZone','Asia/Shanghai');
  v_slot:=public.save_assessment_slot_series(v_id,v_teacher,v_campus,array['math'],array[3],v_start+interval '5 hours',v_start+interval '5 hours 40 minutes',true,v_repeat);
  if (select count(*) from public.assessment_slots where campus_id=v_campus and starts_at>=v_start and starts_at<v_start+interval '3 days')<>3
    or public.save_assessment_slot_series(v_id,v_teacher,v_campus,array['math'],array[3],v_start+interval '5 hours',v_start+interval '5 hours 40 minutes',true,v_repeat)<>v_slot
    then raise exception 'SLOT_SERIES_REPLAY_FAILED'; end if;
  perform public.save_assessment_slot(gen_random_uuid(),v_teacher,v_campus,array['math'],array[3],v_start+interval '1 day 4 hours',v_start+interval '1 day 4 hours 40 minutes',true);
  perform pg_temp.expect_planning_error(format('select public.save_assessment_slot_series(%L,%L,%L,''{math}'',''{3}'',%L,%L,true,%L)',
    current_setting('test.planning.slot_atomic'),v_teacher,v_campus,v_start+interval '4 hours',v_start+interval '4 hours 40 minutes',v_repeat),'TIME_UNAVAILABLE');
  if exists(select 1 from public.assessment_slots where id=current_setting('test.planning.slot_atomic')::uuid) then raise exception 'SLOT_SERIES_NOT_ATOMIC'; end if;
  if not exists(select 1 from jsonb_array_elements(public.get_assessment_slot_management((v_closed_start at time zone 'Asia/Shanghai')::date,
    (v_closed_start at time zone 'Asia/Shanghai')::date)->'slots') item
    where item->>'id'=current_setting('test.planning.closed_slot') and (item->>'blocked')::boolean and (item->>'enabled')::boolean)
    then raise exception 'CLOSED_PUBLISHED_SLOT_NOT_BLOCKED'; end if;
  perform pg_temp.expect_planning_error(format('select public.save_assessment_slot(%L,%L,%L,''{math}'',''{3}'',%L,%L,true)',
    gen_random_uuid(),v_teacher,v_campus,v_closed_start+interval '1 hour',v_closed_start+interval '1 hour 40 minutes'),'TIME_UNAVAILABLE');
  v_repeat:=jsonb_build_object('frequency','daily','interval',1,'until',(v_closed_start at time zone 'Asia/Shanghai')::date::text,'timeZone','Asia/Shanghai');
  perform pg_temp.expect_planning_error(format('select public.save_assessment_slot_series(%L,%L,%L,''{math}'',''{3}'',%L,%L,true,%L)',
    current_setting('test.planning.closed_atomic'),v_teacher,v_campus,v_closed_start-interval '1 day'+interval '1 hour',v_closed_start-interval '1 day'+interval '1 hour 40 minutes',v_repeat),'TIME_UNAVAILABLE');
  if exists(select 1 from public.assessment_slots where id=current_setting('test.planning.closed_atomic')::uuid) then raise exception 'CLOSED_SERIES_NOT_ATOMIC'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.admin_user_id'),'role','authenticated','aal','aal2')::text,true);
end $teacher_slots$;

do $admin_scope$
declare v_start timestamptz:=current_setting('test.planning.start')::timestamptz;
begin
  if exists(select 1 from public.staff_calendar_events where id=current_setting('test.planning.strategy')::uuid
    or series_id=current_setting('test.planning.series')::uuid) then raise exception 'UNINVOLVED_ADMIN_SERIES_VISIBLE'; end if;
  perform public.save_calendar_event(gen_random_uuid(),'meeting','管理员同刻会议','',v_start,v_start+interval '40 minutes','','{}');
  perform public.respond_calendar_invitation(current_setting('test.planning.milestone')::uuid,'accepted');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
end $admin_scope$;

do $parent_scope$
declare v_start timestamptz:=current_setting('test.planning.start')::timestamptz;
begin
  if exists(select 1 from public.staff_calendar_events) or exists(select 1 from public.staff_calendar_settings) then raise exception 'PARENT_CALENDAR_DATA_VISIBLE'; end if;
  perform pg_temp.expect_planning_error(format('select public.get_calendar_workspace(%L,%L)',v_start,v_start+interval '1 day'),'FORBIDDEN');
  perform pg_temp.expect_planning_error('select public.save_calendar_school_windows(''[]'')','FORBIDDEN');
  perform pg_temp.expect_planning_error(format('select public.save_calendar_event(%L,''strategy'',''家长越权'','''',%L,%L,'''',''{}'')',gen_random_uuid(),v_start,v_start+interval '10 days'),'FORBIDDEN');
  perform pg_temp.expect_planning_error(format('select public.save_assessment_slot_series(%L,%L,%L,''{math}'',''{3}'',%L,%L,true,''{}'')',
    gen_random_uuid(),current_setting('test.parent_preview.teacher_user_id'),current_setting('test.planning.campus'),v_start,v_start+interval '40 minutes'),'FORBIDDEN');
  if not exists(select 1 from jsonb_array_elements(public.parent_assessment_availability(current_setting('test.planning.student')::uuid,array['math'],3)->'slots') item
    where item->>'id'=current_setting('test.planning.closed_slot') and not (item->>'available')::boolean) then raise exception 'PARENT_CLOSED_SLOT_AVAILABLE'; end if;
  perform pg_temp.expect_planning_error(format('select public.book_parent_assessment_slot(%L,%L,%L,''{math}'',3)',
    gen_random_uuid(),current_setting('test.planning.student'),current_setting('test.planning.closed_slot')),'SLOT_UNAVAILABLE');
end $parent_scope$;
reset role;
