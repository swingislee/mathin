-- 固定开发身份，所有样例与修改随外层事务回滚。
do $$
declare
  admin_id uuid; teacher_id uuid; outsider_id uuid;
  old_course public.courses%rowtype; new_course public.courses%rowtype;
  classroom_id uuid:=gen_random_uuid(); session_id uuid; lecture record;
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select id into teacher_id from auth.users where email='test-teacher@mathin.local';
  select id into outsider_id from auth.users where email='test-student@mathin.local';
  if num_nonnulls(admin_id,teacher_id,outsider_id)<>3 then raise exception 'FIXED_ACCOUNTS_REQUIRED'; end if;
  select b.* into old_course from public.courses b join public.courses a
    on a.family_id=b.family_id and a.catalog_version_id=b.catalog_version_id and a.grade=b.grade and a.term=b.term
    where b.class_type='B' and a.class_type='A' and a.status='enabled' and b.status='enabled'
      and a.trashed_at is null and b.trashed_at is null and b.purpose='production' and a.purpose='production'
      and b.course_kind='curriculum'
      and (select count(*) from public.course_lectures l where l.course_id=b.id and l.status='active')>=6
    order by b.created_at desc limit 1;
  select * into new_course from public.courses where family_id=old_course.family_id
    and catalog_version_id=old_course.catalog_version_id and grade=old_course.grade and term=old_course.term
    and class_type='A' and status='enabled' and trashed_at is null limit 1;
  if old_course.id is null or new_course.id is null then raise exception 'EXISTING_COURSE_PAIR_REQUIRED'; end if;
  perform set_config('material.test.admin',admin_id::text,true);
  perform set_config('material.test.teacher',teacher_id::text,true);
  perform set_config('material.test.outsider',outsider_id::text,true);
  perform set_config('material.test.class',classroom_id::text,true);
  perform set_config('material.test.old',old_course.id::text,true);
  perform set_config('material.test.new',new_course.id::text,true);
  perform set_config('material.test.family',old_course.family_id::text,true);
  insert into public.classrooms(id,owner_id,name,invite_code,course_id,purpose)
    values(classroom_id,admin_id,'Material assertion',gen_random_uuid()::text,old_course.id,'production');
  for lecture in select * from public.course_lectures where course_id=old_course.id and status='active' and archived_at is null order by no limit 6 loop
    session_id:=gen_random_uuid();
    insert into public.class_sessions(id,classroom_id,lecture_id,lecture_no,title,scheduled_at)
      values(session_id,classroom_id,lecture.id,lecture.no,lecture.name,'2040-10-10T04:00:00Z');
    perform set_config('material.test.session'||lecture.no::text,session_id::text,true);
    if lecture.no=2 then update public.class_sessions set started_at=now() where id=session_id; end if;
    if lecture.no=3 then insert into public.session_preparations(session_id,status) values(session_id,'in_progress'); end if;
    if lecture.no=4 then insert into public.session_preparations(session_id,status,prepared_at,prepared_by) values(session_id,'ready',now(),admin_id); end if;
    if lecture.no=5 then update public.class_sessions set courseware_overlay='[{"op":"remove","uid":"assertion-only"}]' where id=session_id; end if;
    if lecture.no=6 then insert into public.session_preparation_reviews(session_id,artifact_kind,status,submitted_by)
      values(session_id,'lesson_plan','pending',admin_id); end if;
  end loop;
end;
$$;

set local role authenticated;
do $$
declare
  admin_id text:=current_setting('material.test.admin');
  class_id uuid:=current_setting('material.test.class')::uuid;
  target_id uuid:=current_setting('material.test.new')::uuid;
  input jsonb; selection jsonb; preview jsonb; result jsonb; first_rule jsonb; second_rule jsonb;
  old_snapshot jsonb; inherited jsonb; term_id uuid; built_id uuid;
begin
  perform set_config('request.jwt.claim.sub',admin_id,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  input:=jsonb_build_object('title','Material assertion rule','familyId',current_setting('material.test.family'),
    'businessClassType','ASSERT','materialClassType','A','fromYear',2026,'fromSeason',1,
    'toYear',2026,'toSeason',2,'entryGrade',1,'enabled',true);
  first_rule:=public.save_course_material_rule(null,0,input);
  begin
    perform public.save_course_material_rule(null,0,input);
    raise exception 'OVERLAPPING_RULE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'MATERIAL_RULE_OVERLAP' then raise; end if; end;
  selection:=jsonb_build_object('businessClassType','ASSERT','cohortYear',2026,'cohortSeason',1,
    'cohortGrade',1,'ruleRevisionId',first_rule->>'revisionId','inheritedFromClassroomId',null);
  preview:=public.preview_classroom_material_change(class_id,target_id,selection,false);
  if (preview->>'changeCount')::int<>1 or (preview->>'preserveCount')::int<>5
    then raise exception 'DEFAULT_PROTECTION_FAILED: %',preview; end if;
  if (public.preview_classroom_material_change(class_id,target_id,selection,true)->>'changeCount')::int<>2
    then raise exception 'DRAFT_OPT_IN_FAILED'; end if;
  begin
    perform public.apply_classroom_material_change(class_id,target_id,selection,false,'stale','assertion');
    raise exception 'STALE_TOKEN_ALLOWED';
  exception when raise_exception then if sqlerrm<>'MATERIAL_STALE' then raise; end if; end;
  result:=public.apply_classroom_material_change(class_id,target_id,selection,false,preview->>'token','assertion');
  if (result->>'changedSessions')::int<>1 then raise exception 'CHANGE_COUNT_FAILED'; end if;
  old_snapshot:=public.get_classroom_material_workspace(class_id);
  if old_snapshot->>'courseId'<>target_id::text or jsonb_array_length(old_snapshot->'history')<>1
    then raise exception 'WORKSPACE_HISTORY_FAILED'; end if;
  second_rule:=public.save_course_material_rule((first_rule->>'id')::uuid,1,input||jsonb_build_object('materialClassType','B'));
  if (second_rule->>'version')::int<>2 then raise exception 'RULE_VERSION_FAILED'; end if;
  if (public.get_classroom_material_workspace(class_id)->'selection') is distinct from (old_snapshot->'selection')
    then raise exception 'RULE_REWROTE_EXISTING_CLASS'; end if;
  -- 已采用旧版的班级可以继续沿用；普通新班采用当前版本。
  perform public.preview_classroom_material_change(class_id,target_id,selection,false);
  inherited:=selection||jsonb_build_object('inheritedFromClassroomId',class_id);
  select id into term_id from public.school_terms order by year desc limit 1;
  if term_id is null then raise exception 'EXISTING_TERM_REQUIRED'; end if;
  input:=jsonb_build_object('name','Inherited material assertion','courseId',target_id,'capacity',null,'roomId',null,
    'primaryTeacherId',current_setting('material.test.teacher'),'learningSupportId',null,'schoolTermId',term_id,
    'purpose','production','offeringType','long_term_formal','activateNow',false,'sessions','[]'::jsonb);
  built_id:=public.create_class_with_material(input,inherited);
  if (public.get_classroom_material_workspace(built_id)#>>'{selection,ruleRevisionId}')<>first_rule->>'revisionId'
    then raise exception 'INHERITED_VERSION_LOST'; end if;
  begin
    perform public.create_class_with_material(input,selection);
    raise exception 'NEW_CLASS_ACCEPTED_OLD_VERSION';
  exception when raise_exception then if sqlerrm<>'MATERIAL_STALE' then raise; end if; end;
  begin
    perform public.preview_classroom_material_change(class_id,target_id,selection||'{"cohortYear":2025}',false);
    raise exception 'COHORT_MISMATCH_ALLOWED';
  exception when raise_exception then if sqlerrm<>'MATERIAL_RULE_MISMATCH' then raise; end if; end;
  begin
    update public.course_material_rule_revisions set title='tamper' where id=(first_rule->>'revisionId')::uuid;
    raise exception 'DIRECT_REVISION_WRITE_ALLOWED';
  exception when insufficient_privilege then null; end;
  perform set_config('material.test.preview',(public.preview_classroom_material_change(class_id,target_id,selection,false))->>'token',true);
  perform set_config('material.test.selection',selection::text,true);
end;
$$;
reset role;

-- 预览后班级变化使 token 失效；教学历史、草稿和待审来源保留。
do $$
declare
  class_id uuid:=current_setting('material.test.class')::uuid;
  old_id uuid:=current_setting('material.test.old')::uuid;
begin
  if (select count(*) from public.class_sessions s join public.course_lectures l on l.id=s.lecture_id
    where s.classroom_id=class_id and l.course_id=old_id)<>5 then raise exception 'PROTECTED_SOURCES_CHANGED'; end if;
  if (select count(*) from public.session_preparations where session_id in
    (current_setting('material.test.session3')::uuid,current_setting('material.test.session4')::uuid))<>2
    then raise exception 'PREPARATION_LOST'; end if;
  update public.classrooms set name='Concurrent class update' where id=class_id;
end;
$$;
set local role authenticated;
do $$
declare
  class_id uuid:=current_setting('material.test.class')::uuid;
  target_id uuid:=current_setting('material.test.new')::uuid;
  selection jsonb:=current_setting('material.test.selection')::jsonb;
  account text;
begin
  begin
    perform public.apply_classroom_material_change(class_id,target_id,selection,false,current_setting('material.test.preview'),'stale assertion');
    raise exception 'CONCURRENT_UPDATE_ALLOWED';
  exception when raise_exception then if sqlerrm<>'MATERIAL_STALE' then raise; end if; end;
  foreach account in array array[current_setting('material.test.teacher'),current_setting('material.test.outsider')] loop
    perform set_config('request.jwt.claim.sub',account,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',account,'role','authenticated','aal','aal2')::text,true);
    begin
      perform public.preview_classroom_material_change(class_id,target_id,selection,false);
      raise exception 'OUT_OF_SCOPE_READ_ALLOWED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN_SCOPE' then raise; end if; end;
    begin
      perform public.apply_classroom_material_change(class_id,target_id,selection,false,'token','unauthorized');
      raise exception 'OUT_OF_SCOPE_WRITE_ALLOWED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN_SCOPE' then raise; end if; end;
    begin
      perform public.save_course_material_rule(null,0,'{}');
      raise exception 'NON_MANAGER_RULE_WRITE_ALLOWED';
    exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
    if exists(select 1 from public.classroom_material_changes where classroom_id=class_id) then raise exception 'HISTORY_RLS_LEAK'; end if;
  end loop;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.get_course_material_options();
    raise exception 'UNAUTHENTICATED_READ_ALLOWED';
  exception when raise_exception then if sqlerrm<>'UNAUTHENTICATED' then raise; end if; end;
end;
$$;
reset role;
select 'PASS: rule revisions, cohorts, inheritance, preview, history/draft/review preservation, stale writes, ACL and RLS';
