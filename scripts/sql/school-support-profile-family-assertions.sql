savepoint support_profile_family;
do $test$
#variable_conflict use_variable
declare actor uuid:=current_setting('manual_entry_test.admin')::uuid; teacher uuid:=current_setting('manual_entry_test.teacher')::uuid;
  student_actor uuid:=current_setting('manual_entry_test.student')::uuid;
  a uuid; b uuid; c uuid; d uuid; family_id uuid; second_family uuid; request uuid:=gen_random_uuid();
  profile jsonb; preview jsonb; payload jsonb; link jsonb; item jsonb; result jsonb; before_profile jsonb;
  err text; change_count bigint; event_count bigint; work_count bigint; guardian_count bigint;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  a:=public.create_student(p_name=>'Uncorrected '||request,p_grade=>null,p_phone=>'600000009601',p_parent_name=>'Parent',p_parent_phone=>'600000009601',p_remark=>'Keep note');
  b:=public.create_student(p_name=>'Sibling '||request,p_grade=>3::smallint,p_phone=>'600000009601');
  profile:=public.read_school_support_profile(a,null);
  preview:=public.preview_school_support_family_link(a,b);
  link:=jsonb_build_object('otherStudentId',b,'otherVersion',preview->>'otherVersion','version',preview->>'version','confirmed',true);
  payload:=jsonb_build_object('workspace','students','subject',jsonb_build_object('studentId',a,'leadId',null,'version',profile->>'version'),
    'newPerson',null,'acknowledgeDuplicate',false,'work',jsonb_build_object('note','Profile correction and family link'),
    'profileEdit',jsonb_build_object('version',profile->>'version','values',profile->'values'||jsonb_build_object('name','Corrected '||request,'grade',4)), 'familyLink',link);
  execute 'reset role';
  select count(*) into guardian_count from public.student_guardians;
  execute 'set local role authenticated';
  item:=public.add_school_support_work_item(request,payload);
  result:=public.read_school_support_profile(a,null);
  if item->>'studentId'<>a::text or result->'values'->>'name'<>'Corrected '||request or result->'values'->>'grade'<>'4'
    or result->'values'->>'remark'<>'Keep note' or jsonb_array_length(result->'changes')<>1 then raise exception 'EXISTING_PROFILE_CORRECTION_FAILED'; end if;
  family_id:=(public.preview_school_support_family_link(a,b)->>'familyId')::uuid;
  if family_id is null or not (public.preview_school_support_family_link(a,b)->>'alreadyLinked')::boolean then raise exception 'FAMILY_LINK_MISSING'; end if;
  if public.add_school_support_work_item(request,payload) is distinct from item then raise exception 'RETRY_CHANGED_RESULT'; end if;
  execute 'reset role';
  if (select count(*) from public.family_students m where m.family_id=family_id and m.student_id in(a,b))<>2
    or (select count(*) from public.students where id in(a,b) and deleted_at is null)<>2 then raise exception 'CHILDREN_NOT_PRESERVED'; end if;
  if (select count(*) from public.student_guardians)<>guardian_count then raise exception 'GUARDIAN_ACCESS_CHANGED'; end if;
  if (select count(*) from public.domain_events where event_type='school_support.family_linked' and entity_id=family_id)<>1 then raise exception 'FAMILY_AUDIT_OR_RETRY_FAILED'; end if;
  execute 'set local role authenticated';
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'STALE_PROFILE_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'SUBJECT_CHANGED' then raise; end if; end;

  -- 家庭失败发生在办理动作后，仍应将档案更正、事项及修订轨迹一起回滚。
  profile:=public.read_school_support_profile(a,null);before_profile:=profile;
  preview:=public.preview_school_support_family_link(a,b);
  link:=jsonb_build_object('otherStudentId',b,'otherVersion',preview->>'otherVersion','version',preview->>'version','confirmed',true);
  payload:=payload||jsonb_build_object('subject',jsonb_build_object('studentId',a,'leadId',null,'version',profile->>'version'),
    'profileEdit',jsonb_build_object('version',profile->>'version','values',profile->'values'||'{"phone":"600000009602","parentPhone":"600000009602"}'), 'familyLink',link);
  execute 'reset role';
  select count(*) into change_count from public.school_support_change_log;
  select count(*) into work_count from public.school_support_work_items;
  select count(*) into event_count from public.domain_events;
  execute 'set local role authenticated';
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'MISMATCHED_PHONE_LINKED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FAMILY_PHONE_MISMATCH' then raise; end if; end;
  if public.read_school_support_profile(a,null) is distinct from before_profile then raise exception 'FAILED_FAMILY_CHANGED_PROFILE'; end if;
  payload:=payload||jsonb_build_object('profileEdit',null,'familyLink',link||'{"confirmed":false}');
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'UNCONFIRMED_FAMILY_LINKED';
    exception when others then get stacked diagnostics err=message_text; if err<>'VALIDATION' then raise; end if; end;
  payload:=payload||jsonb_build_object('familyLink',link||'{"version":"stale"}');
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'STALE_FAMILY_ALLOWED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FAMILY_CHANGED' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from public.school_support_change_log)<>change_count or (select count(*) from public.school_support_work_items)<>work_count
    or (select count(*) from public.domain_events)<>event_count then raise exception 'FAILED_FAMILY_PARTIAL_WRITE'; end if;

  -- 新学生显式关联至原家庭，保留原家庭成员和两份学生档案。
  execute 'set local role authenticated';
  preview:=public.preview_school_support_family_link(null,a);
  payload:=jsonb_build_object('workspace','students','subject',null,'acknowledgeDuplicate',true,'work',jsonb_build_object('note','New sibling'),
    'newPerson',jsonb_build_object('name','New sibling '||request,'phone','600000009601','grade',1,'createStudent',true,'identityPending',false),
    'familyLink',jsonb_build_object('otherStudentId',a,'otherVersion',preview->>'otherVersion','version',preview->>'version','confirmed',true));
  item:=public.add_school_support_work_item(gen_random_uuid(),payload);c:=(item->>'studentId')::uuid;
  if c in(a,b) or (public.preview_school_support_family_link(c,a)->>'familyId')::uuid<>family_id then raise exception 'NEW_SIBLING_NOT_LINKED'; end if;
  d:=public.create_student(p_name=>'Other family '||request,p_grade=>2::smallint,p_phone=>'600000009601');
  execute 'reset role';
  insert into public.families(display_name,owner_id,created_by) values('Other family '||request,actor,actor) returning id into second_family;
  insert into public.family_students(family_id,student_id,created_by) values(second_family,d,actor);
  execute 'set local role authenticated';
  preview:=public.preview_school_support_family_link(a,d);
  if preview->>'blocker'<>'FAMILY_REVIEW_REQUIRED' then raise exception 'DIFFERENT_FAMILIES_NOT_FLAGGED'; end if;
  profile:=public.read_school_support_profile(a,null);
  payload:=jsonb_build_object('workspace','students','subject',jsonb_build_object('studentId',a,'leadId',null,'version',profile->>'version'),
    'newPerson',null,'acknowledgeDuplicate',false,'work',jsonb_build_object('note','Review conflicting families'),
    'familyLink',jsonb_build_object('otherStudentId',d,'otherVersion',preview->>'otherVersion','version',preview->>'version','confirmed',true));
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'DIFFERENT_FAMILIES_JOINED';
    exception when others then get stacked diagnostics err=message_text; if err<>'FAMILY_REVIEW_REQUIRED' then raise; end if; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',teacher,'role','authenticated')::text,true);
  begin perform public.preview_school_support_family_link(a,d); raise exception 'OTHER_OWNER_VISIBLE';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  begin perform public.add_school_support_work_item(gen_random_uuid(),payload); raise exception 'OTHER_OWNER_WRITABLE';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  execute 'reset role';
  update public.students set assigned_to=teacher where id in(a,b,c);
  execute 'set local role authenticated';
  profile:=public.read_school_support_profile(c,null);preview:=public.preview_school_support_family_link(c,b);
  if not (profile->>'canEdit')::boolean or (profile->>'canResolveIdentity')::boolean then raise exception 'BASIC_CORRECTION_EXPANDED_IDENTITY_PERMISSION'; end if;
  payload:=payload||jsonb_build_object('subject',jsonb_build_object('studentId',c,'leadId',null,'version',profile->>'version'),
    'profileEdit',jsonb_build_object('version',profile->>'version','values',profile->'values'||'{"name":"Teacher corrected","grade":2,"phone":"600000009603","parentPhone":"600000009601"}'),
    'familyLink',jsonb_build_object('otherStudentId',b,'otherVersion',preview->>'otherVersion','version',preview->>'version','confirmed',true));
  result:=public.add_school_support_work_item(gen_random_uuid(),payload);
  if result->>'studentId'<>c::text or public.read_school_support_profile(c,null)->'values'->>'phone'<>'600000009603' then raise exception 'TEACHER_CORRECTION_FAILED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',student_actor,'role','authenticated')::text,true);
  begin perform public.preview_school_support_family_link(a,b); raise exception 'STUDENT_CAN_LINK';
    exception when others then get stacked diagnostics err=message_text; if err<>'FORBIDDEN_SCOPE' then raise; end if; end;
  execute 'reset role';
  if has_function_privilege('anon','public.preview_school_support_family_link(uuid,uuid)','execute')
    or has_function_privilege('authenticated','mathin_internal.link_school_support_family(uuid,jsonb)','execute')
    or has_function_privilege('service_role','mathin_internal.link_school_support_family(uuid,jsonb)','execute') then raise exception 'FAMILY_HELPER_ACL_UNSAFE'; end if;
  if (select count(*) from public.student_guardians)<>guardian_count then raise exception 'FAMILY_LINK_GRANTED_LOGIN_ACCESS'; end if;
end $test$;
rollback to savepoint support_profile_family;
release savepoint support_profile_family;
