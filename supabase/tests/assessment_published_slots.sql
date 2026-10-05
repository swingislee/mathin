-- 由 assessment-slots-local.mjs 在已识别的隔离本机库 BEGIN / ROLLBACK 内执行。
-- 固定开发身份从私有清单传入；所有排班、校区、预约和临时权限调整都回滚。
create function pg_temp.expect_slot_error(p_sql text,p_error text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm=p_error then return; end if;
    raise exception 'EXPECTED_%,GOT_%',p_error,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',p_error;
end $$;

do $setup$
declare v_teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid; v_student uuid; v_day date:=(now() at time zone 'Asia/Shanghai')::date+2;
begin
  if not exists(select 1 from public.profiles where id=v_teacher and purpose='test' and role='staff')
    or not exists(select 1 from public.profiles where id=current_setting('test.parent_preview.admin_user_id')::uuid and purpose='test' and role='admin')
    then raise exception 'FIXED_TEST_STAFF_REQUIRED'; end if;
  select s.id into v_student from public.students s join public.leads l on l.student_id=s.id
    where s.id in(current_setting('test.parent_preview.first_student_id')::uuid,current_setting('test.parent_preview.second_student_id')::uuid)
      and s.source='本机小程序固定联调' and l.purpose='test'
      and not exists(select 1 from public.lead_invitation_threads t where t.lead_id=l.id and t.state not in ('completed','cancelled'))
    order by s.id limit 1;
  if v_student is null then raise exception 'AVAILABLE_FIXED_TEST_CHILD_REQUIRED'; end if;
  perform set_config('test.slots.student',v_student::text,true);
  perform set_config('test.slots.start',((v_day+time '14:15') at time zone 'Asia/Shanghai')::text,true);
  perform set_config('test.slots.id',gen_random_uuid()::text,true);
  perform set_config('test.slots.admin_slot',gen_random_uuid()::text,true);
  perform set_config('test.slots.request',gen_random_uuid()::text,true);
  -- 仅本事务中把固定开发教师缩成 review.write，证明自管边界；管理员权限不受影响。
  delete from public.role_permissions where perm_key in ('followup.write','schedule.manage')
    and role_id in(select role_id from public.staff_role_members where user_id=v_teacher);
  if public.has_perm(v_teacher,'followup.write') or public.has_perm(v_teacher,'schedule.manage') or not public.has_perm(v_teacher,'review.write')
    then raise exception 'REVIEW_ONLY_FIXTURE_REQUIRED'; end if;
  -- 已发布教师不必是孩子当前任课老师。只移除明确 test 班中的开发教师关系，随后整体回滚。
  delete from public.classroom_staff_assignments a using public.classrooms c
    where a.classroom_id=c.id and c.purpose='test' and a.user_id=v_teacher;
  if exists(select 1 from public.parent_assessment_eligible_teachers(v_student) where id=v_teacher)
    then raise exception 'NON_ASSIGNED_TEST_TEACHER_REQUIRED'; end if;
  if has_table_privilege('authenticated','public.assessment_slots','insert,update,delete')
    or has_function_privilege('anon','public.parent_assessment_availability(uuid,text[],integer)','execute')
    or has_function_privilege('anon','public.book_parent_assessment_slot(uuid,uuid,uuid,text[],integer)','execute')
    or has_function_privilege('authenticated','public.assessment_teacher_time_busy(uuid,timestamptz,timestamptz,uuid)','execute')
    then raise exception 'SLOT_ACL_FAILED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.admin_user_id'),'role','authenticated','aal','aal2')::text,true);
end $setup$;

set local role authenticated;
do $admin$
declare v_campus uuid; v_slot jsonb; v_start timestamptz:=current_setting('test.slots.start')::timestamptz; v_admin uuid:=current_setting('test.parent_preview.admin_user_id')::uuid;
begin
  v_campus:=public.create_campus_v2('测评排班安全检查 '||gen_random_uuid()::text,'仅回滚事务内的开发校区');
  perform set_config('test.slots.campus',v_campus::text,true);
  v_slot:=public.save_assessment_slot(current_setting('test.slots.admin_slot')::uuid,v_admin,v_campus,array['math'],array[3],v_start,v_start+interval '40 minutes',true);
  if not (public.get_assessment_slot_management((v_start at time zone 'Asia/Shanghai')::date,(v_start at time zone 'Asia/Shanghai')::date)->>'canManageAll')::boolean
    then raise exception 'ADMIN_CANNOT_MANAGE'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.teacher_user_id'),'role','authenticated','aal','aal2')::text,true);
end $admin$;
do $teacher$
declare v_id uuid:=current_setting('test.slots.id')::uuid; v_teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid;
  v_campus uuid:=current_setting('test.slots.campus')::uuid; v_start timestamptz:=current_setting('test.slots.start')::timestamptz; v_slot jsonb; v_management jsonb;
begin
  v_slot:=public.save_assessment_slot(v_id,v_teacher,v_campus,array['math','english'],'{}',v_start,v_start+interval '40 minutes',true);
  if public.save_assessment_slot(v_id,v_teacher,v_campus,array['english','math'],'{}',v_start,v_start+interval '40 minutes',true)<>v_slot then raise exception 'SLOT_CREATE_REPLAY'; end if;
  perform set_config('test.slots.updated',v_slot->>'updatedAt',true);
  perform pg_temp.expect_slot_error(format('select public.save_assessment_slot(%L,%L,%L,array[''math'',''english''],''{}'',%L,%L,false,%L)',
    v_id,v_teacher,v_campus,v_start,v_start+interval '40 minutes',(v_slot->>'updatedAt')::timestamptz-interval '1 second'),'CONFLICT');
  perform pg_temp.expect_slot_error(format('select public.save_assessment_slot(%L,%L,%L,array[''math''],''{}'',%L,%L,true)',
    gen_random_uuid(),v_teacher,v_campus,v_start+interval '20 minutes',v_start+interval '1 hour'),'TIME_UNAVAILABLE');
  perform pg_temp.expect_slot_error(format('select public.save_assessment_slot(%L,%L,%L,array[''math''],''{}'',%L,%L,true)',
    gen_random_uuid(),current_setting('test.parent_preview.admin_user_id'),v_campus,v_start,v_start+interval '40 minutes'),'FORBIDDEN');
  perform public.save_assessment_slot(gen_random_uuid(),v_teacher,v_campus,array['english'],array[4],v_start+interval '1 day',v_start+interval '1 day 40 minutes',true);
  perform public.save_assessment_slot(gen_random_uuid(),v_teacher,v_campus,array['math'],'{}',v_start+interval '12 days',v_start+interval '12 days 40 minutes',true);
  perform public.save_assessment_slot(gen_random_uuid(),v_teacher,v_campus,array['math'],'{}',v_start+interval '2 days',v_start+interval '2 days 40 minutes',false);
  v_management:=public.get_assessment_slot_management((v_start at time zone 'Asia/Shanghai')::date,(v_start at time zone 'Asia/Shanghai')::date+13);
  if (v_management->>'canManageAll')::boolean or jsonb_array_length(v_management->'teachers')<>1
    or exists(select 1 from jsonb_array_elements(v_management->'slots') s where s->>'teacherId'<>v_teacher::text)
    or exists(select 1 from public.assessment_slots where teacher_id<>v_teacher) then raise exception 'TEACHER_SCOPE_FAILED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
end $teacher$;
do $parent$
declare v_id uuid:=current_setting('test.slots.id')::uuid; v_student uuid:=current_setting('test.slots.student')::uuid;
  v_request uuid:=current_setting('test.slots.request')::uuid; v_availability jsonb; v_booked jsonb; v_start timestamptz:=current_setting('test.slots.start')::timestamptz;
begin
  if exists(select 1 from public.assessment_slots) then raise exception 'PARENT_RAW_SLOTS_VISIBLE'; end if;
  perform pg_temp.expect_slot_error(format('select public.get_assessment_slot_management(%L,%L)',current_date,current_date+13),'FORBIDDEN');
  v_availability:=public.parent_assessment_availability(v_student,array['math','english'],3);
  if v_availability->>'timeZone'<>'Asia/Shanghai' or (v_availability->>'to')::date-(v_availability->>'from')::date<>13
    or not exists(select 1 from jsonb_array_elements(v_availability->'slots') s where s->>'id'=v_id::text and (s->>'available')::boolean)
    or exists(select 1 from jsonb_array_elements(v_availability->'slots') s where (s->>'startsAt')::timestamptz>=(((now() at time zone 'Asia/Shanghai')::date+14)::timestamp at time zone 'Asia/Shanghai'))
    then raise exception 'PUBLISHED_SLOT_PROJECTION_FAILED'; end if;
  v_booked:=public.book_parent_assessment_slot(v_request,v_student,v_id,array['english','math'],3);
  if v_booked->>'state'<>'confirmed' or (v_booked->>'canConfirm')::boolean or (v_booked->>'scheduledAt')::timestamptz<>v_start
    or v_booked#>>'{booking,slotId}'<>v_id::text or v_booked#>>'{booking,mode}'<>'campus'
    or v_booked#>>'{booking,campus,id}'<>current_setting('test.slots.campus')
    or (v_booked#>>'{booking,endsAt}')::timestamptz<>v_start+interval '40 minutes' then raise exception 'BOOKING_PROJECTION_FAILED'; end if;
  if public.book_parent_assessment_slot(v_request,v_student,v_id,array['math','english'],3)<>v_booked then raise exception 'BOOKING_REPLAY_FAILED'; end if;
  perform pg_temp.expect_slot_error(format('select public.book_parent_assessment_slot(%L,%L,%L,array[''math''],3)',v_request,v_student,v_id),'CONFLICT');
  perform pg_temp.expect_slot_error(format('select public.book_parent_assessment_slot(%L,%L,%L,array[''math'',''english''],4)',v_request,v_student,v_id),'CONFLICT');
  perform pg_temp.expect_slot_error(format('select public.book_parent_assessment_slot(%L,%L,%L,array[''math''],3)',gen_random_uuid(),v_student,v_id),'ACTIVE_INVITATION');
  if not exists(select 1 from jsonb_array_elements(public.parent_assessment_availability(v_student,array['math','english'],3)->'slots') s
    where s->>'id'=v_id::text and not (s->>'available')::boolean) then raise exception 'TAKEN_SLOT_STILL_AVAILABLE'; end if;
  if not exists(select 1 from jsonb_array_elements(public.parent_assessment_overview(v_student)->'requests') r where r=v_booked)
    then raise exception 'OVERVIEW_BOOKING_MISSING'; end if;
  perform set_config('test.slots.booking',v_booked::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.outsider_user_id'),'role','authenticated','aal','aal2')::text,true);
  perform pg_temp.expect_slot_error(format('select public.parent_assessment_availability(%L,array[''math''],3)',v_student),'FORBIDDEN');
  perform pg_temp.expect_slot_error(format('select public.book_parent_assessment_slot(%L,%L,%L,array[''math''],3)',gen_random_uuid(),v_student,v_id),'FORBIDDEN');
end $parent$;
reset role;
do $guards$
declare v_id uuid:=current_setting('test.slots.id')::uuid; v_request uuid:=current_setting('test.slots.request')::uuid;
  v_slot public.assessment_slots%rowtype; v_invitation public.lead_invitation_threads%rowtype; v_lead uuid:=gen_random_uuid(); v_admin uuid:=current_setting('test.parent_preview.admin_user_id')::uuid;
begin
  select * into v_slot from public.assessment_slots where id=v_id;
  select * into v_invitation from public.lead_invitation_threads where id=v_request;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated','aal','aal2')::text,true);
  if public.read_student_record_subject(current_setting('test.slots.student')::uuid,null)#>>'{invitation,assessmentSlotId}' is distinct from v_id::text
    then raise exception 'STUDENT_RECORD_SLOT_SOURCE_MISSING'; end if;
  perform pg_temp.expect_slot_error(format('update public.lead_invitation_threads set scheduled_at=scheduled_at+interval ''1 minute'' where id=%L',v_request),'SLOT_BOOKING_IMMUTABLE');
  perform pg_temp.expect_slot_error(format('select public.save_assessment_slot(%L,%L,%L,array[''math'',''english''],''{}'',%L,%L,true,%L)',
    v_id,v_slot.teacher_id,v_slot.campus_id,v_slot.starts_at+interval '1 minute',v_slot.ends_at+interval '1 minute',v_slot.updated_at),'SLOT_BOOKED');
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by,purpose)
    values(v_lead,'开发回滚测评检查','开发回滚测评检查','00000000009','00000000009','contacted',v_admin,v_admin,'test');
  -- 表级触发器也拒绝第二条 slot 预约，独立于同一学生的进行中邀约限制。
  perform pg_temp.expect_slot_error(format('insert into public.lead_invitation_threads(id,lead_id,kind,state,assessor_id,scheduled_at,location_text,created_by,updated_by,parent_request_actor,parent_request_payload,assessment_slot_id) values(%L,%L,''assessment_1v1'',''confirmed'',%L,%L,%L,%L,%L,%L,%L,%L)',
    gen_random_uuid(),v_lead,v_slot.teacher_id,v_slot.starts_at,v_invitation.location_text,v_admin,v_admin,v_invitation.parent_request_actor,v_invitation.parent_request_payload,v_id),'TIME_UNAVAILABLE');
  -- 旧协调入口同样不能确认到已被公开排班预约占用的时间。
  perform pg_temp.expect_slot_error(format('insert into public.lead_invitation_threads(id,lead_id,kind,state,assessor_id,scheduled_at,parent_time_options,assessor_time_options,created_by,updated_by) values(%L,%L,''assessment_1v1'',''confirmed'',%L,%L,array[%L],array[%L],%L,%L)',
    gen_random_uuid(),v_lead,v_slot.teacher_id,v_slot.starts_at-interval '15 minutes',to_char(v_slot.starts_at at time zone 'Asia/Shanghai','YYYY-MM-DD')||'@14:00',to_char(v_slot.starts_at at time zone 'Asia/Shanghai','YYYY-MM-DD')||'@14:00',v_admin,v_admin),'TIME_UNAVAILABLE');
end $guards$;
set local role authenticated;
do $cancel$
declare v_slot_id uuid:=current_setting('test.slots.id')::uuid; v_request uuid:=current_setting('test.slots.request')::uuid;
  v_student uuid:=current_setting('test.slots.student')::uuid; v_slot jsonb; v_booking jsonb:=current_setting('test.slots.booking')::jsonb;
  v_new jsonb; v_start timestamptz:=current_setting('test.slots.start')::timestamptz;
begin
  v_slot:=public.save_assessment_slot(v_slot_id,current_setting('test.parent_preview.teacher_user_id')::uuid,current_setting('test.slots.campus')::uuid,
    array['math','english'],'{}',v_start,v_start+interval '40 minutes',false,current_setting('test.slots.updated')::timestamptz);
  if not (v_slot->>'booked')::boolean then raise exception 'BOOKED_FLAG_MISSING'; end if;
  perform public.save_assessment_slot(v_slot_id,current_setting('test.parent_preview.teacher_user_id')::uuid,current_setting('test.slots.campus')::uuid,
    array['math','english'],'{}',v_start,v_start+interval '40 minutes',true,(v_slot->>'updatedAt')::timestamptz);
  perform public.update_lead_invitation_v3(v_request,'assessment_1v1','cancelled',null,current_setting('test.parent_preview.teacher_user_id')::uuid,
    '{}','{}',v_start,'线下到校区测试 · '||(v_booking#>>'{booking,campus,name}'),'other','开发回滚取消检查',null);
  select s into v_slot from jsonb_array_elements(public.get_assessment_slot_management((v_start at time zone 'Asia/Shanghai')::date,(v_start at time zone 'Asia/Shanghai')::date)->'slots') s where s->>'id'=v_slot_id::text;
  if not (v_slot->>'booked')::boolean or (v_slot->>'activeBooked')::boolean then raise exception 'CANCELLED_SLOT_STATUS_FAILED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
  v_new:=public.book_parent_assessment_slot(v_request,v_student,v_slot_id,array['math','english'],3);
  if v_new->>'state'<>'cancelled' or v_new->'booking'<>v_booking->'booking' then raise exception 'CANCELLED_REPLAY_FAILED'; end if;
  v_new:=public.book_parent_assessment_slot(gen_random_uuid(),v_student,v_slot_id,array['math','english'],3);
  if v_new->>'state'<>'confirmed' then raise exception 'CANCELLED_SLOT_NOT_RELEASED'; end if;
end $cancel$;
reset role;
do $retired_resource$
declare v_slot public.assessment_slots%rowtype; v_closed jsonb;
begin
  select * into v_slot from public.assessment_slots where id=current_setting('test.slots.id')::uuid;
  update public.profiles set is_active=false where id=v_slot.teacher_id;
  update public.campuses set status='archived' where id=v_slot.campus_id;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.admin_user_id'),'role','authenticated','aal','aal2')::text,true);
  v_closed:=public.save_assessment_slot(v_slot.id,v_slot.teacher_id,v_slot.campus_id,v_slot.subjects,v_slot.grades,v_slot.starts_at,v_slot.ends_at,false,v_slot.updated_at);
  if (v_closed->>'enabled')::boolean or not (v_closed->>'booked')::boolean then raise exception 'RETIRED_RESOURCE_CLOSURE_FAILED'; end if;
end $retired_resource$;
