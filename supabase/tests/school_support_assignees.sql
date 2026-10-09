-- Run inside an identified isolated rollback transaction. All created users,
-- role settings, leads, students and assignment events below are synthetic.
do $$
declare
  actor uuid:=gen_random_uuid(); owner uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
  inactive uuid:=gen_random_uuid(); no_permission uuid:=gen_random_uuid(); fixture uuid;
  outsider uuid; scoped_staff uuid; invite_code text; sid uuid; combined_sid uuid; lid uuid; combined_lid uuid;
  label text:='学服配置回滚-'||left(gen_random_uuid()::text,8); result jsonb; subject jsonb;
begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  select code into strict invite_code from public.registration_invite_settings where id=1 and is_active;
  select id into strict outsider from auth.users where email='test-parent-unbound@mathin.local';
  select id into strict scoped_staff from auth.users where email='test-sales@mathin.local';
  if public.can_manage_school_groups(scoped_staff) or public.has_perm(scoped_staff,'student.view.all') then
    raise exception 'SCOPED_STAFF_FIXTURE_REQUIRED';
  end if;
  foreach fixture in array array[actor,owner,other,inactive,no_permission] loop
    insert into auth.users(id,email,raw_user_meta_data) values(fixture,'support-owner-'||fixture||'@example.invalid',
      jsonb_build_object('display_name',label,'registration_invite_code',invite_code,'privacy_consent',true,'children_privacy_consent',true));
    update public.profiles set role=case when fixture=no_permission then 'staff' else 'admin' end,purpose='test' where id=fixture;
  end loop;
  update public.profiles set is_active=false where id=inactive;
  insert into public.school_staff_business_roles(user_id,business_role) values(inactive,'school_support');
  insert into public.students(name,bind_code,assigned_to,created_by) values(label,gen_random_uuid()::text,actor,actor) returning id into sid;
  insert into public.students(name,bind_code,assigned_to,created_by) values(label,gen_random_uuid()::text,actor,actor) returning id into combined_sid;
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,created_by)
    values(label,public.normalize_lead_name(label),'15500092031','15500092031','uncontacted',actor,actor) returning id into lid;
  insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,status,owner_id,student_id,created_by,identity_confirmed_by,identity_confirmed_at)
    values(label,public.normalize_lead_name(label),'15500092032','15500092032','uncontacted',actor,combined_sid,actor,actor,now()) returning id into combined_lid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);

  perform public.set_school_staff_business_role(owner,'school_support');
  perform public.set_school_staff_business_role(other,'teacher');
  result:=public.list_school_support_owners();
  if not exists(select 1 from jsonb_array_elements(result) r where r->>'userId'=owner::text)
    or exists(select 1 from jsonb_array_elements(result) r where r->>'userId'=any(array[actor::text,other::text,inactive::text,no_permission::text])) then
    raise exception 'SUPPORT_ROSTER_SCOPE_WRONG';
  end if;
  result:=public.read_school_collaboration_settings();
  if not exists(select 1 from jsonb_array_elements(result->'staff') r where r->>'id'=owner::text and r->>'canFollowUp'='true')
    or not exists(select 1 from jsonb_array_elements(result->'staff') r where r->>'id'=no_permission::text and r->>'canFollowUp'='false') then
    raise exception 'SUPPORT_CONFIGURATION_CAPABILITY_MISSING';
  end if;
  begin
    perform public.set_school_staff_business_role(no_permission,'school_support');
    raise exception 'UNQUALIFIED_SUPPORT_ROLE_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'TARGET_CANNOT_FOLLOW_UP' then raise; end if; end;

  foreach fixture in array array[other,inactive,no_permission] loop
    begin
      perform public.assign_student(sid,fixture);
      raise exception 'UNQUALIFIED_STUDENT_OWNER_ACCEPTED';
    exception when raise_exception then if sqlerrm<>'TARGET_CANNOT_FOLLOW_UP' then raise; end if; end;
    begin
      perform public.assign_leads(array[lid],fixture);
      raise exception 'UNQUALIFIED_LEAD_OWNER_ACCEPTED';
    exception when raise_exception then if sqlerrm<>'TARGET_CANNOT_FOLLOW_UP' then raise; end if; end;
    begin
      perform public.assign_student_stage_subjects(jsonb_build_array(jsonb_build_object('studentId',combined_sid,'leadId',combined_lid,'expectedOwnerId',actor)),fixture);
      raise exception 'UNQUALIFIED_COMBINED_OWNER_ACCEPTED';
    exception when raise_exception then if sqlerrm<>'TARGET_CANNOT_FOLLOW_UP' then raise; end if; end;
  end loop;

  perform public.assign_student(sid,owner);
  perform public.assign_leads(array[lid],owner);
  result:=public.assign_student_stage_subjects(jsonb_build_array(jsonb_build_object('studentId',combined_sid,'leadId',combined_lid,'expectedOwnerId',actor)),owner);
  if (select assigned_to from public.students where id=sid) is distinct from owner
    or (select owner_id from public.leads where id=lid) is distinct from owner
    or (select assigned_to from public.students where id=combined_sid) is distinct from owner
    or (select owner_id from public.leads where id=combined_lid) is distinct from owner
    or result#>>'{0,subject,ownerId}'<>owner::text then raise exception 'CONFIGURED_OWNER_NOT_ASSIGNED'; end if;

  perform public.set_school_staff_business_role(owner,null);
  result:=public.list_school_support_owners();
  if exists(select 1 from jsonb_array_elements(result) r where r->>'userId'=owner::text)
    or (select assigned_to from public.students where id=sid) is distinct from owner
    or (select owner_id from public.leads where id=lid) is distinct from owner then raise exception 'CLEAR_ROLE_CHANGED_EXISTING_OWNERSHIP'; end if;
  begin
    perform public.assign_leads(array[lid],owner);
    raise exception 'REMOVED_SUPPORT_OWNER_ACCEPTED';
  exception when raise_exception then if sqlerrm<>'TARGET_CANNOT_FOLLOW_UP' then raise; end if; end;
  perform public.set_school_staff_business_role(owner,'school_support');
  begin
    perform public.assign_student_stage_subjects(jsonb_build_array(jsonb_build_object('studentId',combined_sid,'leadId',combined_lid,'expectedOwnerId',actor)),owner);
    raise exception 'OWNER_CONFLICT_CHECK_LOST';
  exception when raise_exception then if sqlerrm<>'ASSIGNMENT_CONFLICT' then raise; end if; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',scoped_staff,'role','authenticated')::text,true);
  begin
    perform public.set_school_staff_business_role(other,'school_support');
    raise exception 'NON_MANAGER_CHANGED_SUPPORT_ROSTER';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  begin
    perform public.assign_student(sid,owner);
    raise exception 'OTHER_STUDENT_ASSIGNMENT_ALLOWED';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN_SCOPE' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
  begin
    perform public.list_school_support_owners();
    raise exception 'PARENT_READ_SUPPORT_ROSTER';
  exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
  if has_function_privilege('anon','public.list_school_support_owners()','execute')
    or has_function_privilege('authenticated','public.is_school_support_owner(uuid)','execute') then
    raise exception 'SUPPORT_FUNCTION_GRANTS_TOO_BROAD';
  end if;
end $$;
