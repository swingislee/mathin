-- 仅验证新增课次身份读取；由本机脚本包裹 BEGIN / ROLLBACK。
do $setup$
declare v_teacher uuid:=current_setting('test.parent_preview.teacher_user_id')::uuid;
  v_admin uuid:=current_setting('test.parent_preview.admin_user_id')::uuid;
  v_class uuid:=gen_random_uuid(); v_other_class uuid:=gen_random_uuid(); v_start timestamptz:=date_trunc('day',now())+interval '200 days 8 hours';
begin
  if not exists(select 1 from public.profiles where id=v_teacher and purpose='test' and role='staff')
    or not exists(select 1 from public.profiles where id=v_admin and purpose='test' and role='admin') then raise exception 'FIXED_TEST_STAFF_REQUIRED'; end if;
  if has_function_privilege('anon','public.get_staff_schedule_teacher_ids(timestamptz,timestamptz,uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.staff_calendar_session_teachers(uuid,uuid)','execute') then raise exception 'LESSON_IDENTITY_ACL_FAILED'; end if;
  perform set_config('test.calendar_identity.start',v_start::text,true);
  perform set_config('test.calendar_identity.primary',gen_random_uuid()::text,true);
  perform set_config('test.calendar_identity.override',gen_random_uuid()::text,true);
  perform set_config('test.calendar_identity.owner',gen_random_uuid()::text,true);
  insert into public.classrooms(id,name,invite_code,owner_id,purpose) values
    (v_class,'课次身份回滚班','IDENTITY-'||v_class::text,v_admin,'test'),
    (v_other_class,'课次身份范围回滚班','IDENTITY-'||v_other_class::text,v_admin,'test');
  insert into public.classroom_staff_assignments(classroom_id,user_id,responsibility) values
    (v_class,v_teacher,'primary_teacher'),(v_class,v_admin,'assistant_teacher');
  insert into public.class_sessions(id,classroom_id,title,scheduled_at,duration_min,teacher_override) values
    (current_setting('test.calendar_identity.primary')::uuid,v_class,'实际主讲与助教',v_start,40,null),
    (current_setting('test.calendar_identity.override')::uuid,v_class,'代课与助教去重',v_start+interval '1 hour',40,v_admin),
    (current_setting('test.calendar_identity.owner')::uuid,v_other_class,'负责人回退',v_start+interval '2 hours',40,null);
  -- 事务内缩窄固定开发教师，验证身份读取不会扩大既有课表范围。
  delete from public.role_permissions where perm_key in ('schedule.view.all','class.view.all')
    and role_id in(select role_id from public.staff_role_members where user_id=v_teacher);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_teacher,'role','authenticated','aal','aal2')::text,true);
end $setup$;
set local role authenticated;
do $teacher$
declare v_start timestamptz:=current_setting('test.calendar_identity.start')::timestamptz; v_ids uuid[]; v_expected uuid[];
begin
  v_expected:=array(select id from unnest(array[current_setting('test.parent_preview.teacher_user_id')::uuid,current_setting('test.parent_preview.admin_user_id')::uuid]) id order by id);
  select teacher_ids into v_ids from public.get_staff_schedule_teacher_ids(v_start,v_start+interval '1 day')
    where session_id=current_setting('test.calendar_identity.primary')::uuid;
  if v_ids is distinct from v_expected then raise exception 'PRIMARY_ASSISTANT_IDENTITIES_FAILED'; end if;
  select teacher_ids into v_ids from public.get_staff_schedule_teacher_ids(v_start,v_start+interval '1 day')
    where session_id=current_setting('test.calendar_identity.override')::uuid;
  if v_ids is distinct from array[current_setting('test.parent_preview.admin_user_id')::uuid] then raise exception 'SUBSTITUTE_IDENTITY_FAILED'; end if;
  if exists(select 1 from public.get_staff_schedule_teacher_ids(v_start,v_start+interval '1 day')
    where session_id=current_setting('test.calendar_identity.owner')::uuid) then raise exception 'IDENTITY_EXPANDED_TEACHER_SCOPE'; end if;
  if exists((select session_id from public.get_staff_schedule_teacher_ids(v_start,v_start+interval '1 day')
      except select session_id from public.get_staff_schedule_v2(v_start,v_start+interval '1 day'))
    union all (select session_id from public.get_staff_schedule_v2(v_start,v_start+interval '1 day')
      except select session_id from public.get_staff_schedule_teacher_ids(v_start,v_start+interval '1 day'))) then raise exception 'IDENTITY_SCOPE_MISMATCH'; end if;
  if exists(select 1 from public.get_staff_schedule_teacher_ids(v_start,v_start+interval '1 day',gen_random_uuid(),null)) then raise exception 'IDENTITY_CAMPUS_FILTER_FAILED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.admin_user_id'),'role','authenticated','aal','aal2')::text,true);
end $teacher$;
do $admin$
declare v_start timestamptz:=current_setting('test.calendar_identity.start')::timestamptz; v_ids uuid[];
begin
  select teacher_ids into v_ids from public.get_staff_schedule_teacher_ids(v_start,v_start+interval '1 day')
    where session_id=current_setting('test.calendar_identity.owner')::uuid;
  if v_ids is distinct from array[current_setting('test.parent_preview.admin_user_id')::uuid] then raise exception 'OWNER_FALLBACK_IDENTITY_FAILED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.parent_preview.parent_user_id'),'role','authenticated','aal','aal2')::text,true);
end $admin$;
do $parent$
declare v_start timestamptz:=current_setting('test.calendar_identity.start')::timestamptz;
begin
  if exists(select 1 from public.get_staff_schedule_teacher_ids(v_start,v_start+interval '1 day')
    where session_id in(current_setting('test.calendar_identity.primary')::uuid,current_setting('test.calendar_identity.override')::uuid,current_setting('test.calendar_identity.owner')::uuid))
    then raise exception 'PARENT_STAFF_IDENTITIES_VISIBLE'; end if;
end $parent$;
reset role;
