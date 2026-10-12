-- Run inside BEGIN / ROLLBACK on the verified isolated development database.
create function pg_temp.expect_reference_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm like '%'||expected||'%' then return; end if;
    raise exception 'EXPECTED_%,GOT_%',expected,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;

do $calendar$
begin
  if public.assessment_reference_validity_value('2024-08-31',6,'2025-02-28')->>'validUntil'<>'2025-02-28'
    or public.assessment_reference_validity_value('2024-08-31',6,'2025-02-28')->>'status'<>'valid'
    or public.assessment_reference_validity_value('2024-08-31',6,'2025-03-01')->>'status'<>'expired'
    or public.assessment_reference_validity_value('2023-08-31',6,'2024-02-29')->>'validUntil'<>'2024-02-29'
    or public.assessment_reference_validity_value(null,6,'2026-10-12')->>'status'<>'unknown'
    or public.assessment_reference_validity_value('2026-10-13',6,'2026-10-12')->>'status'<>'unknown'
    then raise exception 'CALENDAR_REFERENCE_BOUNDARIES'; end if;
end $calendar$;

do $fixtures$
#variable_conflict use_variable
declare actor uuid; parent_id uuid; outsider uuid; teacher uuid; role_id uuid:=gen_random_uuid();
  student uuid:=gen_random_uuid(); activity uuid:=gen_random_uuid(); reg uuid:=gen_random_uuid(); report_id uuid:=gen_random_uuid();
  old_date date:=((now() at time zone 'Asia/Shanghai')::date-interval '7 months')::date;
begin
  select id into actor from profiles where purpose='test' and role='admin' and id=(select id from auth.users where email='test-admin@mathin.local');
  select id into parent_id from profiles where purpose='test' and id=(select id from auth.users where email='test-parent@mathin.local');
  select id into outsider from profiles where purpose='test' and id=(select id from auth.users where email='test-parent-unbound@mathin.local');
  select id into teacher from profiles where purpose='test' and role='staff' and is_active and account_status='active' and not password_change_required order by id limit 1;
  if actor is null or parent_id is null or outsider is null or teacher is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  -- Narrow only a fixed test employee, within the rollback transaction.
  delete from public.staff_role_members where user_id=teacher;
  insert into public.staff_roles(id,key,name) values(role_id,'reference_fixture_'||role_id,'有效期事务岗位');
  insert into public.role_permissions(role_id,perm_key) values(role_id,'review.write');
  insert into public.staff_role_members(user_id,role_id) values(teacher,role_id);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  insert into students(id,name,bind_code,created_by,assigned_to) values(student,'Assessment reference fixture',student::text,actor,actor);
  insert into student_guardians(student_id,guardian_id,relation,scope,is_primary) values(student,parent_id,'监护人',array['grades','activities'],true);
  insert into activities(id,kind,title,scheduled_at,capacity,created_by) values(activity,'lecture','Assessment reference fixture',old_date::timestamp at time zone 'Asia/Shanghai',20,actor);
  insert into activity_registrations(id,activity_id,student_id,operated_by) values(reg,activity,student,actor);
  insert into assessment_results(activity_registration_id,student_id,overall_level,assessed_by,assessed_on)
    values(reg,student,'developing',actor,old_date);
  insert into assessment_reports(id,registration_id,version,payload,content_hash,created_by)
    values(report_id,reg,1,'{"activityTitle":"Reference fixture","teacherObservation":"Original observation","score":0,"totalScore":10}',report_id::text,actor);
  insert into assessment_workflow_states(registration_id,stage,report_id,updated_by) values(reg,'feedback',report_id,actor)
    on conflict(registration_id) do update set stage='feedback',report_id=excluded.report_id,updated_by=excluded.updated_by;
  perform set_config('test.reference.admin',actor::text,true);
  perform set_config('test.reference.parent',parent_id::text,true);
  perform set_config('test.reference.outsider',outsider::text,true);
  perform set_config('test.reference.teacher',teacher::text,true);
  perform set_config('test.reference.registration',reg::text,true);
  perform set_config('test.reference.report',report_id::text,true);
  perform set_config('test.reference.date',old_date::text,true);
end $fixtures$;

set local role authenticated;
do $staff$
declare policy jsonb; saved jsonb; result jsonb; reg uuid:=current_setting('test.reference.registration')::uuid;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.reference.admin'),'role','authenticated','aal','aal2')::text,true);
  policy:=public.get_assessment_reference_policy();
  policy:=public.save_assessment_reference_policy(6,(policy->>'updatedAt')::timestamptz);
  result:=public.get_assessment_reference_validities(array[reg]);
  if result#>>array[reg::text,'status'] is distinct from 'expired'
    or result#>>array[reg::text,'assessedOn'] is distinct from current_setting('test.reference.date') then raise exception 'IMPORT_TIME_REFRESHED_ASSESSMENT'; end if;
  saved:=public.save_assessment_reference_policy(12,(policy->>'updatedAt')::timestamptz);
  if (public.get_assessment_reference_validities(array[reg]))#>>array[reg::text,'status'] is distinct from 'valid' then raise exception 'POLICY_DID_NOT_RECALCULATE'; end if;
  perform pg_temp.expect_reference_error(format('select public.save_assessment_reference_policy(3,%L)',policy->>'updatedAt'),'CONFLICT');
  perform pg_temp.expect_reference_error(format('select public.save_assessment_reference_policy(0,%L)',saved->>'updatedAt'),'VALIDATION');
  perform public.save_assessment_reference_policy(6,(saved->>'updatedAt')::timestamptz);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.reference.teacher'),'role','authenticated')::text,true);
  policy:=public.get_assessment_reference_policy();
  if (policy->>'canManage')::boolean then raise exception 'TEACHER_POLICY_WRITE'; end if;
  perform pg_temp.expect_reference_error(format('select public.save_assessment_reference_policy(3,%L)',policy->>'updatedAt'),'FORBIDDEN');
  perform pg_temp.expect_reference_error('update public.assessment_reference_policy set validity_months=3','permission denied');
end $staff$;

reset role;
do $delivery$
#variable_conflict use_variable
declare rows jsonb; original jsonb; report_id uuid:=current_setting('test.reference.report')::uuid;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.reference.parent'),'role','authenticated')::text,true);
  if exists(select 1 from jsonb_array_elements(public.miniapp_assessment_reports()) r where r->>'id'=report_id::text) then raise exception 'UNSENT_REPORT_EXPOSED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.reference.admin'),'role','authenticated','aal','aal2')::text,true);
  update public.assessment_workflow_states set sent_report_id=report_id,sent_at=now(),sent_by=current_setting('test.reference.admin')::uuid
    where registration_id=current_setting('test.reference.registration')::uuid;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.reference.parent'),'role','authenticated')::text,true);
  original:=public.miniapp_assessment_reports_before_validity();
  rows:=public.miniapp_assessment_reports();
  if (select coalesce(jsonb_agg(item-'referenceValidity' order by ord),'[]') from jsonb_array_elements(rows) with ordinality r(item,ord)) is distinct from original then raise exception 'REPORT_FIELDS_OR_SCOPE_CHANGED'; end if;
  select r into rows from jsonb_array_elements(rows) r where r->>'id'=report_id::text;
  if rows#>>'{referenceValidity,status}' is distinct from 'expired' then raise exception 'EXPIRED_REPORT_LOST_OR_REFRESHED'; end if;
  if rows->>'summary' is distinct from 'Original observation' or rows->>'score' is distinct from '0' then raise exception 'REPORT_CONTENT_CHANGED'; end if;
end $delivery$;

set local role authenticated;
do $family_permissions$
declare report_id uuid:=current_setting('test.reference.report')::uuid;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.reference.parent'),'role','authenticated')::text,true);
  if not exists(select 1 from jsonb_array_elements(public.miniapp_assessment_reports()) r where r->>'id'=report_id::text and r#>>'{referenceValidity,status}'='expired') then raise exception 'PARENT_HISTORY_MISSING'; end if;
  perform pg_temp.expect_reference_error('select public.get_assessment_reference_policy()','FORBIDDEN');
  perform pg_temp.expect_reference_error('select public.save_assessment_reference_policy(3,now())','FORBIDDEN');
  if exists(select 1 from public.assessment_reference_policy) then raise exception 'PARENT_INTERNAL_POLICY_VISIBLE'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.reference.outsider'),'role','authenticated')::text,true);
  if exists(select 1 from jsonb_array_elements(public.miniapp_assessment_reports()) r where r->>'id'=report_id::text) then raise exception 'OUTSIDER_REPORT_VISIBLE'; end if;
  if exists(select 1 from public.assessment_reference_dates where registration_id=current_setting('test.reference.registration')::uuid) then raise exception 'REFERENCE_DATE_RLS_BYPASS'; end if;
  if has_function_privilege('anon','public.miniapp_assessment_reports()','execute')
    or has_function_privilege('authenticated','public.miniapp_assessment_reports_before_validity()','execute') then raise exception 'REPORT_WRAPPER_PRIVILEGES'; end if;
end $family_permissions$;
reset role;
