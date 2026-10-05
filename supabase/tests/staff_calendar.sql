-- staff-calendar-local.mjs 在已识别本机 BEGIN / ROLLBACK 内执行；复用固定开发身份。
create function pg_temp.expect_calendar_error(p_sql text,p_error text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm=p_error then return; end if;
    raise exception 'EXPECTED_%,GOT_%',p_error,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',p_error;
end $$;
do $setup$
declare v_teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid;
  v_admin uuid:=current_setting('test.parent_preview.admin_user_id')::uuid; v_start timestamptz; v_student uuid; v_class uuid:=gen_random_uuid();
begin
  if not exists(select 1 from public.profiles where id=v_teacher and purpose='test' and role='staff')
    or not exists(select 1 from public.profiles where id=v_admin and purpose='test' and role='admin') then raise exception 'FIXED_TEST_STAFF_REQUIRED'; end if;
  if has_table_privilege('authenticated','public.staff_calendar_events','insert,update,delete')
    or has_table_privilege('authenticated','public.staff_calendar_attendees','insert,update,delete')
    or has_function_privilege('anon','public.get_calendar_workspace(timestamptz,timestamptz)','execute')
    or has_function_privilege('authenticated','public.staff_calendar_time_busy(uuid,timestamptz,timestamptz,uuid,uuid,boolean)','execute')
    or has_function_privilege('authenticated','public.staff_calendar_event_projection(uuid)','execute') then raise exception 'CALENDAR_ACL_FAILED'; end if;
  select t into v_start from generate_series(
    (((now() at time zone 'Asia/Shanghai')::date+2)+time '06:00') at time zone 'Asia/Shanghai',
    (((now() at time zone 'Asia/Shanghai')::date+10)+time '06:00') at time zone 'Asia/Shanghai',interval '1 day') t
    where not public.assessment_teacher_time_busy(v_teacher,t,t+interval '6 hours')
      and not public.assessment_teacher_time_busy(v_admin,t,t+interval '6 hours')
      and not exists(select 1 from public.assessment_slots where teacher_id=v_teacher and enabled and tstzrange(starts_at,ends_at,'[)')&&tstzrange(t,t+interval '6 hours','[)'))
    order by t limit 1;
  if v_start is null then raise exception 'AVAILABLE_TEST_TIME_REQUIRED'; end if;
  select s.id into v_student from public.students s join public.leads l on l.student_id=s.id
    where s.id in(current_setting('test.parent_preview.first_student_id')::uuid,current_setting('test.parent_preview.second_student_id')::uuid)
      and s.source='本机小程序固定联调' and l.purpose='test'
      and not exists(select 1 from public.lead_invitation_threads t where t.lead_id=l.id and t.state not in ('completed','cancelled'))
    order by s.id limit 1;
  if v_student is null then raise exception 'AVAILABLE_FIXED_TEST_CHILD_REQUIRED'; end if;
  perform set_config('test.calendar.start',v_start::text,true);
  perform set_config('test.calendar.student',v_student::text,true);
  perform set_config('test.calendar.slot',gen_random_uuid()::text,true);
  perform set_config('test.calendar.meeting',gen_random_uuid()::text,true);
  perform set_config('test.calendar.private',gen_random_uuid()::text,true);
  perform set_config('test.calendar.task',gen_random_uuid()::text,true);
  perform set_config('test.calendar.class',v_class::text,true);
  insert into public.classrooms(id,name,invite_code,owner_id,purpose) values(v_class,'日历回滚专用班','CALENDAR-'||v_class::text,v_admin,'test');
  insert into public.class_sessions(classroom_id,title,scheduled_at,duration_min,teacher_override)
    values(v_class,'日历回滚专用课次',v_start+interval '4 hours',40,v_teacher);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_teacher,'role','authenticated','aal','aal2')::text,true);
end $setup$;

set local role authenticated;
do $teacher$
declare v_teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid; v_start timestamptz:=current_setting('test.calendar.start')::timestamptz;
  v_event jsonb; v_campus uuid;
begin
  v_event:=public.save_calendar_event(current_setting('test.calendar.private')::uuid,'preparation','仅我可见的备课','回滚检查',v_start+interval '1 hour',v_start+interval '100 minutes','线上','{}');
  if not (v_event->>'canEdit')::boolean or (v_event->>'canComplete')::boolean then raise exception 'CALENDAR_OWNER_PROJECTION'; end if;
  if public.save_calendar_event(current_setting('test.calendar.private')::uuid,'preparation','仅我可见的备课','回滚检查',v_start+interval '1 hour',v_start+interval '100 minutes','线上','{}')<>v_event then raise exception 'CALENDAR_CREATE_REPLAY'; end if;
  perform set_config('test.calendar.private.updated',v_event->>'updatedAt',true);
  perform pg_temp.expect_calendar_error(format('select public.save_calendar_event(%L,''meeting'',''冲突'','''',%L,%L,'''',''{}'')',gen_random_uuid(),v_start+interval '70 minutes',v_start+interval '110 minutes'),'TIME_UNAVAILABLE');
  perform pg_temp.expect_calendar_error(format('select public.save_calendar_event(%L,''meeting'',''课次冲突'','''',%L,%L,'''',''{}'')',gen_random_uuid(),v_start+interval '4 hours',v_start+interval '4 hours 40 minutes'),'TIME_UNAVAILABLE');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.admin_user_id'),'role','authenticated','aal','aal2')::text,true);
end $teacher$;
do $admin$
declare v_start timestamptz:=current_setting('test.calendar.start')::timestamptz; v_event jsonb; v_campus uuid;
begin
  if exists(select 1 from public.staff_calendar_events where id=current_setting('test.calendar.private')::uuid)
    or exists(select 1 from jsonb_array_elements(public.get_calendar_workspace(v_start,v_start+interval '1 day')->'events') e where e->>'id'=current_setting('test.calendar.private'))
    then raise exception 'UNINVOLVED_STAFF_CAN_READ'; end if;
  perform pg_temp.expect_calendar_error(format('select public.change_calendar_event_status(%L,''cancelled'',%L)',current_setting('test.calendar.private'),current_setting('test.calendar.private.updated')),'FORBIDDEN');
  perform pg_temp.expect_calendar_error(format('select public.save_calendar_event(%L,''preparation'',''越权'','''',%L,%L,'''',''{}'',null,%L)',current_setting('test.calendar.private'),v_start,v_start+interval '40 minutes',current_setting('test.calendar.private.updated')),'FORBIDDEN');
  v_campus:=public.create_campus_v2('内部日历回滚检查 '||gen_random_uuid()::text,'仅回滚事务');
  perform set_config('test.calendar.campus',v_campus::text,true);
  perform public.save_assessment_slot(current_setting('test.calendar.slot')::uuid,current_setting('test.parent_preview.teacher_user_id')::uuid,
    v_campus,array['math'],array[3],v_start,v_start+interval '40 minutes',true);
  v_event:=public.save_calendar_event(current_setting('test.calendar.meeting')::uuid,'meeting','内部会议','家长不可见',v_start,v_start+interval '40 minutes','办公室',array[current_setting('test.parent_preview.teacher_user_id')::uuid],v_campus);
  perform set_config('test.calendar.meeting.updated',v_event->>'updatedAt',true);
  if not exists(select 1 from jsonb_array_elements(public.get_assessment_slot_management((v_start at time zone 'Asia/Shanghai')::date,(v_start at time zone 'Asia/Shanghai')::date)->'slots') s
    where s->>'id'=current_setting('test.calendar.slot') and (s->>'blocked')::boolean) then raise exception 'MANAGEMENT_BUSY_MISSING'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
end $admin$;
do $parent$
declare v_start timestamptz:=current_setting('test.calendar.start')::timestamptz;
begin
  if exists(select 1 from public.staff_calendar_events) or exists(select 1 from public.staff_calendar_attendees) then raise exception 'PARENT_CALENDAR_DETAILS_VISIBLE'; end if;
  perform pg_temp.expect_calendar_error(format('select public.get_calendar_workspace(%L,%L)',v_start,v_start+interval '1 day'),'FORBIDDEN');
  if not exists(select 1 from jsonb_array_elements(public.parent_assessment_availability(current_setting('test.calendar.student')::uuid,array['math'],3)->'slots') s
    where s->>'id'=current_setting('test.calendar.slot') and not (s->>'available')::boolean) then raise exception 'PARENT_BUSY_SLOT_AVAILABLE'; end if;
  perform pg_temp.expect_calendar_error(format('select public.book_parent_assessment_slot(%L,%L,%L,array[''math''],3)',gen_random_uuid(),current_setting('test.calendar.student'),current_setting('test.calendar.slot')),'TIME_UNAVAILABLE');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.teacher_user_id'),'role','authenticated','aal','aal2')::text,true);
end $parent$;
do $invitation$
declare v_event jsonb; v_start timestamptz:=current_setting('test.calendar.start')::timestamptz;
begin
  if not exists(select 1 from public.staff_calendar_events where id=current_setting('test.calendar.meeting')::uuid) then raise exception 'INVITEE_CANNOT_READ'; end if;
  perform pg_temp.expect_calendar_error(format('select public.change_calendar_event_status(%L,''cancelled'',%L)',current_setting('test.calendar.meeting'),current_setting('test.calendar.meeting.updated')),'FORBIDDEN');
  v_event:=public.respond_calendar_invitation(current_setting('test.calendar.meeting')::uuid,'accepted');
  if (v_event->>'canEdit')::boolean then raise exception 'INVITEE_CAN_EDIT'; end if;
  v_event:=public.respond_calendar_invitation(current_setting('test.calendar.meeting')::uuid,'declined');
  perform set_config('test.calendar.meeting.latest',v_event->>'updatedAt',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.admin_user_id'),'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.expect_calendar_error(format('select public.change_calendar_event_status(%L,''cancelled'',%L)',current_setting('test.calendar.meeting'),current_setting('test.calendar.meeting.updated')),'CONFLICT');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
  if not exists(select 1 from jsonb_array_elements(public.parent_assessment_availability(current_setting('test.calendar.student')::uuid,array['math'],3)->'slots') s
    where s->>'id'=current_setting('test.calendar.slot') and (s->>'available')::boolean) then raise exception 'DECLINE_NOT_RELEASED'; end if;
  perform public.book_parent_assessment_slot(gen_random_uuid(),current_setting('test.calendar.student')::uuid,current_setting('test.calendar.slot')::uuid,array['math'],3);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.teacher_user_id'),'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.expect_calendar_error(format('select public.respond_calendar_invitation(%L,''accepted'')',current_setting('test.calendar.meeting')),'TIME_UNAVAILABLE');
  perform pg_temp.expect_calendar_error(format('select public.save_calendar_event(%L,''preparation'',''预约冲突'','''',%L,%L,'''',''{}'')',gen_random_uuid(),v_start,v_start+interval '40 minutes'),'TIME_UNAVAILABLE');
end $invitation$;
do $task$
declare v_event jsonb; v_start timestamptz:=current_setting('test.calendar.start')::timestamptz;
begin
  -- 即使测评正在占用同一时间，任务仍可以分配；双方各自完成才汇总完成。
  v_event:=public.save_calendar_event(current_setting('test.calendar.task')::uuid,'task','共同任务','个人完成',v_start,v_start+interval '40 minutes','',
    array[current_setting('test.parent_preview.teacher_user_id')::uuid,current_setting('test.parent_preview.admin_user_id')::uuid]);
  if not (v_event->>'canComplete')::boolean then raise exception 'TASK_ASSIGNEE_CANNOT_COMPLETE'; end if;
  v_event:=public.change_calendar_event_status(current_setting('test.calendar.task')::uuid,'completed',(v_event->>'updatedAt')::timestamptz);
  if v_event->>'status'<>'scheduled' or v_event->>'myCompletedAt' is null or (v_event->>'canComplete')::boolean then raise exception 'TASK_PERSONAL_COMPLETION_FAILED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.admin_user_id'),'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.expect_calendar_error(format('select public.change_calendar_event_status(%L,''cancelled'',%L)',current_setting('test.calendar.task'),v_event->>'updatedAt'),'FORBIDDEN');
  v_event:=public.change_calendar_event_status(current_setting('test.calendar.task')::uuid,'completed',(v_event->>'updatedAt')::timestamptz);
  if v_event->>'status'<>'completed' or exists(select 1 from jsonb_array_elements(v_event->'attendees') a where a->>'completedAt' is null) then raise exception 'TASK_ALL_COMPLETION_FAILED'; end if;
  v_event:=public.change_calendar_event_status(current_setting('test.calendar.task')::uuid,'scheduled',(v_event->>'updatedAt')::timestamptz);
  if v_event->>'status'<>'scheduled' or v_event->>'myCompletedAt' is not null then raise exception 'TASK_REOPEN_FAILED'; end if;
  perform public.change_calendar_event_status(current_setting('test.calendar.meeting')::uuid,'cancelled',current_setting('test.calendar.meeting.latest')::timestamptz);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.teacher_user_id'),'role','authenticated','aal','aal2')::text,true);
  v_event:=public.change_calendar_event_status(current_setting('test.calendar.private')::uuid,'cancelled',current_setting('test.calendar.private.updated')::timestamptz);
  if v_event->>'status'<>'cancelled' then raise exception 'ORGANIZER_CANCEL_FAILED'; end if;
end $task$;
reset role;
do $reverse_session_guard$
declare v_start timestamptz:=current_setting('test.calendar.start')::timestamptz; v_teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid; v_event jsonb; v_class uuid:=gen_random_uuid();
begin
  perform pg_temp.expect_calendar_error(format('insert into public.class_sessions(classroom_id,scheduled_at,duration_min,teacher_override) values(%L,%L,40,%L)',
    current_setting('test.calendar.class'),v_start,v_teacher),'TIME_UNAVAILABLE');
  v_event:=public.save_calendar_event(gen_random_uuid(),'preparation','反向课次检查','',v_start+interval '5 hours',v_start+interval '5 hours 40 minutes','','{}');
  perform pg_temp.expect_calendar_error(format('insert into public.class_sessions(classroom_id,scheduled_at,duration_min,teacher_override) values(%L,%L,40,%L)',
    current_setting('test.calendar.class'),v_start+interval '5 hours',v_teacher),'TIME_UNAVAILABLE');
  insert into public.classrooms(id,name,invite_code,owner_id,purpose)
    values(v_class,'日历换老师回滚班','CALENDAR-'||v_class::text,current_setting('test.parent_preview.admin_user_id')::uuid,'test');
  insert into public.class_sessions(classroom_id,title,scheduled_at,duration_min) values(v_class,'回滚课次',v_start,40);
  perform pg_temp.expect_calendar_error(format('update public.classrooms set owner_id=%L where id=%L',v_teacher,v_class),'TIME_UNAVAILABLE');
  perform pg_temp.expect_calendar_error(format('insert into public.classroom_staff_assignments(classroom_id,user_id,responsibility) values(%L,%L,''primary_teacher'')',v_class,v_teacher),'TIME_UNAVAILABLE');
  perform pg_temp.expect_calendar_error(format('insert into public.classroom_staff_assignments(classroom_id,user_id,responsibility) values(%L,%L,''assistant_teacher'')',v_class,v_teacher),'TIME_UNAVAILABLE');
  -- 学管关系不会把人员变成这节课的实际教师。
  insert into public.classroom_staff_assignments(classroom_id,user_id,responsibility) values(v_class,v_teacher,'learning_support');
  if not public.staff_calendar_time_busy(v_teacher,v_start,v_start+interval '40 minutes') then raise exception 'BOOKING_BUSY_GUARD_FAILED'; end if;
end $reverse_session_guard$;
