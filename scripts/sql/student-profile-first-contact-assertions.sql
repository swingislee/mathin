-- 固定本机开发账号；业务夹具只存在于保存点内，检查后全部回滚。
savepoint student_profile_contract;
do $test$
#variable_conflict use_variable
declare
  actor uuid;
  lead_id uuid;
  other_lead_id uuid;
  student_id uuid;
  invitation_id uuid;
  result jsonb;
  result_again jsonb;
  outcome text;
  profile_count bigint;
  family_count bigint;
  auth_count bigint;
  relationship_count bigint;
  actual_error text;
  permission_actor uuid;
  sales_actor uuid;
  established_student uuid;
begin
  select u.id into actor from auth.users u join public.profiles p on p.id=u.id where u.email='test-admin@mathin.local' and p.role='admin';
  if not exists(select 1 from public.profiles where id=actor and role='admin') then raise exception 'FIXED_LOCAL_ADMIN_REQUIRED'; end if;
  select count(*) into family_count from public.families;
  select count(*) into auth_count from auth.users;
  select count(*) into relationship_count from public.student_guardians;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);

  foreach outcome in array array['unreachable','connected','declined','invalid_number'] loop
    lead_id := gen_random_uuid();
    insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
    values(lead_id,'profile-contract-'||lead_id,'profile-contract-'||lead_id,'600000001234','600000001234','uncontacted',actor,actor);
    if public.get_student_lifecycle(null,lead_id)<>'awaiting_first_contact' then raise exception 'UNSAVED_CONTACT_ADVANCED'; end if;
    result := public.record_lead_contact_v4(lead_id,outcome,'profile contract',null,null,null,null,null,null,'{}','{}',null,'',
      case when outcome='declined' then now()+interval '3 days' else null end);
    student_id := (result->>'studentId')::uuid;
    if outcome in ('connected','declined') then
      if student_id is null or result->>'studentProfileStatus'<>'created' then raise exception 'EFFECTIVE_CONTACT_DID_NOT_CREATE'; end if;
      if (select status from public.leads where id=lead_id)='converted' then raise exception 'PROFILE_CLOSED_WORKFLOW'; end if;
      if not exists(select 1 from public.students where id=student_id and assigned_to=actor and parent_phone='600000001234' and user_id is null) then raise exception 'PROFILE_FACTS_INVALID'; end if;
      if public.get_student_lifecycle(student_id,lead_id)<>'awaiting_assessment' then raise exception 'CONTACT_STAGE_INVALID'; end if;
      if outcome='declined' and not exists(select 1 from public.lead_next_actions a where a.lead_id=lead_id and a.status='open' and a.kind='nurture') then raise exception 'REMINDER_LOST'; end if;
      select count(*) into profile_count from public.students;
      result_again := public.record_lead_contact_v4(lead_id,'connected','second call',null,null,null,null,null,null,'{}','{}',null,'',null);
      if result_again->>'studentId'<>student_id::text or (select count(*) from public.students)<>profile_count then raise exception 'REPLAY_CREATED_DUPLICATE'; end if;
      -- 继续创建邀约、改约及提醒，保持同一 Student。
      result_again := public.record_lead_contact_v4(lead_id,'connected','invitation',null,null,'waiting_activity','waiting_activity',null,null,'{}','{}',null,'',now()+interval '2 days');
      select id into invitation_id from public.lead_invitation_threads i where i.lead_id=lead_id;
      perform public.update_lead_invitation_v3(invitation_id,'waiting_activity','waiting_activity',null,null,'{}','{}',null,'','wechat','followup',now()+interval '4 days');
      if (select l.student_id from public.leads l where l.id=lead_id) is distinct from student_id then raise exception 'FOLLOWUP_REBOUND_PROFILE'; end if;
    elsif student_id is not null or public.get_student_lifecycle(null,lead_id)<>'awaiting_first_contact' then
      raise exception 'UNSUCCESSFUL_CONTACT_CREATED_PROFILE';
    end if;
  end loop;

  -- 已有同名同电话档案须复核，不依据候选或手机号自动合并。
  other_lead_id := gen_random_uuid();
  insert into public.students(name,parent_phone,bind_code,assigned_to,created_by)
  values('profile-duplicate-'||other_lead_id,'600000005678',public.generate_student_bind_code(),actor,actor);
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
  values(other_lead_id,'profile-duplicate-'||other_lead_id,'profile-duplicate-'||other_lead_id,'600000005678','600000005678','uncontacted',actor,actor);
  result := public.record_lead_contact_v4(other_lead_id,'connected','duplicate',null,null,null,null,null,null,'{}','{}',null,'',null);
  if result->>'studentProfileStatus'<>'needs_review' or result->>'studentId' is not null then raise exception 'DUPLICATE_AUTO_MERGED'; end if;
  if not exists(select 1 from public.lead_communications c where c.lead_id=other_lead_id) then raise exception 'REVIEW_LOST_CONTACT'; end if;

  -- 只有首联权限的固定老师也能在职责内自动建档，不获得通用学生编辑权限。
  select id into permission_actor from auth.users where email='test-teacher@mathin.local';
  select id into sales_actor from auth.users where email='test-sales@mathin.local';
  if permission_actor is null or sales_actor is null then raise exception 'FIXED_LOCAL_STAFF_REQUIRED'; end if;
  lead_id := gen_random_uuid();
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
  values(lead_id,'profile-teacher-'||lead_id,'profile-teacher-'||lead_id,'600000008888','600000008888','uncontacted',permission_actor,actor);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',permission_actor,'role','authenticated')::text,true);
  result := public.record_lead_contact_v4(lead_id,'connected','teacher contact',null,null,null,null,null,null,'{}','{}',null,'',null);
  student_id := (result->>'studentId')::uuid;
  if student_id is null or not public.can_access_student(student_id,permission_actor) then raise exception 'TEACHER_OWN_PROFILE_FAILED'; end if;
  if public.has_perm(permission_actor,'student.create') or public.has_perm(permission_actor,'student.edit') then raise exception 'FIXED_TEACHER_PERMISSION_CHANGED'; end if;
  begin
    perform public.record_lead_contact_v4(other_lead_id,'connected','outside scope',null,null,null,null,null,null,'{}','{}',null,'',null);
    raise exception 'EXPECTED_SCOPE_DENIAL';
  exception when others then
    get stacked diagnostics actual_error=message_text;
    if actual_error<>'FORBIDDEN_SCOPE' then raise; end if;
  end;
  begin
    perform public.get_student_lifecycle(null,other_lead_id); raise exception 'EXPECTED_READ_SCOPE_DENIAL';
  exception when others then
    get stacked diagnostics actual_error=message_text;
    if actual_error<>'FORBIDDEN_SCOPE' then raise; end if;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  perform public.assign_leads(array[lead_id],sales_actor);
  if not exists(select 1 from public.students s where s.id=student_id and s.assigned_to=sales_actor) then raise exception 'PROFILE_ASSIGNMENT_LOST'; end if;

  -- 历史报名/在班事实缺少前置首联时，仍以更高的真实里程碑为准。
  select s.id into established_student from public.students s
   where s.deleted_at is null and exists(select 1 from public.course_enrollments e where e.student_id=s.id and e.record_state='historical') limit 1;
  if established_student is null then raise exception 'HISTORICAL_ENROLLMENT_FIXTURE_REQUIRED'; end if;
  if public.get_student_lifecycle(established_student,null)<>'awaiting_renewal' then raise exception 'HISTORICAL_ENROLLMENT_REGRESSED'; end if;
  select s.id into established_student from public.students s
   where s.deleted_at is null and exists(select 1 from public.assessment_results a where a.student_id=s.id)
     and not exists(select 1 from public.course_enrollments e where e.student_id=s.id)
     and not exists(select 1 from public.enrollments e where e.student_id=s.id) limit 1;
  if established_student is null then raise exception 'ASSESSMENT_FIXTURE_REQUIRED'; end if;
  if public.get_student_lifecycle(established_student,null)<>'awaiting_enrollment' then raise exception 'ASSESSMENT_STAGE_INVALID'; end if;

  -- 回滚整个保存：无效的提醒不能留下沟通或 Student。
  lead_id := gen_random_uuid();
  insert into public.leads(id,provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
  values(lead_id,'profile-rollback-'||lead_id,'profile-rollback-'||lead_id,'600000009999','600000009999','uncontacted',actor,actor);
  begin
    perform public.record_lead_contact_v4(lead_id,'connected','rollback',null,null,null,null,null,null,'{}','{}',null,'',now()-interval '1 day');
    raise exception 'EXPECTED_INVALID_REMINDER';
  exception when others then
    get stacked diagnostics actual_error=message_text;
    if actual_error<>'REMINDER_NOT_FUTURE' then raise; end if;
  end;
  if exists(select 1 from public.lead_communications c where c.lead_id=lead_id) or (select l.student_id from public.leads l where l.id=lead_id) is not null then raise exception 'FAILED_SAVE_LEFT_FACTS'; end if;

  -- 未登录与无权限读取关闭；不可利用 NULL 负责人绕过范围判断。
  update public.leads set owner_id=null where id=lead_id;
  select id into permission_actor from auth.users where email='test-student@mathin.local';
  if permission_actor is null then raise exception 'FIXED_LOCAL_STUDENT_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',permission_actor,'role','authenticated')::text,true);
  begin
    perform public.get_student_lifecycle(null,lead_id); raise exception 'EXPECTED_FORBIDDEN';
  exception when others then
    get stacked diagnostics actual_error=message_text;
    if actual_error<>'FORBIDDEN' then raise; end if;
  end;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.ensure_lead_student_profile(lead_id); raise exception 'EXPECTED_UNAUTHENTICATED';
  exception when others then
    get stacked diagnostics actual_error=message_text;
    if actual_error<>'UNAUTHENTICATED' then raise; end if;
  end;

  if has_function_privilege('authenticated','public.ensure_lead_student_profile(uuid)','EXECUTE') then raise exception 'INTERNAL_PROFILE_HELPER_EXPOSED'; end if;
  if has_function_privilege('anon','public.get_student_lifecycle(uuid,uuid)','EXECUTE') then raise exception 'LIFECYCLE_EXPOSED_TO_ANON'; end if;
  if (select count(*) from public.families)<>family_count or (select count(*) from auth.users)<>auth_count
    or (select count(*) from public.student_guardians)<>relationship_count then raise exception 'PROFILE_CREATED_UNCONFIRMED_RELATIONSHIP'; end if;
end $test$;
rollback to savepoint student_profile_contract;
release savepoint student_profile_contract;
