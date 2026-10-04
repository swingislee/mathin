-- 复用固定身份；材料、课次和对象元数据仅存于外层回滚事务。
do $$
declare
  teacher_id uuid := current_setting('materials.test.teacher')::uuid;
  admin_id uuid := current_setting('materials.test.admin')::uuid;
  classroom_id uuid := gen_random_uuid();
  other_classroom uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  other_session uuid := gen_random_uuid();
  empty_session uuid := gen_random_uuid();
  file_path text;
begin
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  insert into public.classrooms(id, owner_id, name, invite_code, purpose) values
    (classroom_id, teacher_id, 'Material read assertion', gen_random_uuid()::text, 'test'),
    (other_classroom, admin_id, 'Other material assertion', gen_random_uuid()::text, 'test');
  insert into public.classroom_staff_assignments(classroom_id,user_id,responsibility) values(classroom_id,teacher_id,'primary_teacher');
  insert into public.classroom_members(classroom_id,user_id,role) values(classroom_id,teacher_id,'teacher');
  insert into public.class_sessions(id,classroom_id,title) values
    (session_id,classroom_id,'Material lesson'), (empty_session,classroom_id,'Empty lesson'), (other_session,other_classroom,'Other lesson');
  insert into public.session_preparations(session_id,reviewer_id,reviewer_assignment_source) values
    (session_id,current_setting('materials.test.reviewer')::uuid,'teacher_selected');
  file_path := session_id::text || '/lesson-plan/material.pdf';
  insert into public.session_preparation_artifacts(session_id,solution_notes,lesson_plan_files,rehearsal_video_url,updated_by) values
    (session_id,'Saved solution notes',jsonb_build_array(jsonb_build_object('path',file_path,'name','material.pdf','size',10,'type','application/pdf')),
    'https://example.test/rehearsal',teacher_id);
  insert into public.lesson_plans(session_id,content,created_by,updated_by,revision) values
    (session_id,'[{"type":"paragraph","content":"Saved plan"}]',teacher_id,teacher_id,1);
  insert into storage.objects(bucket_id,name) values('prep-artifacts',file_path);
  perform set_config('materials.test.session',session_id::text,true);
  perform set_config('materials.test.classroom',classroom_id::text,true);
  perform set_config('materials.test.other',other_session::text,true);
  perform set_config('materials.test.other_classroom',other_classroom::text,true);
  perform set_config('materials.test.empty',empty_session::text,true);
end;
$$;
set local role authenticated;
do $$
declare
  account_key text;
  account_id text;
  session_id uuid := current_setting('materials.test.session')::uuid;
  classroom_id uuid := current_setting('materials.test.classroom')::uuid;
  result jsonb;
  kind text;
begin
  foreach account_key in array array['admin','supervisor','teacher','reviewer'] loop
    account_id := current_setting('materials.test.' || account_key);
    perform set_config('request.jwt.claim.sub',account_id,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',account_id,'role','authenticated','aal','aal2')::text,true);
    begin result := public.get_session_materials(session_id,classroom_id,'summary');
    exception when others then raise exception 'MATERIAL_READ_FAILED_FOR_ROLE_%: %', account_key, sqlerrm; end;
    if (result->>'lessonPlanCount')::int <> 2 or not (result->>'hasVideo')::boolean or not (result->>'hasSolutionNotes')::boolean then raise exception 'MATERIAL_SUMMARY_MISMATCH'; end if;
    result := public.get_session_materials(session_id,classroom_id,'lesson_plan');
    if result #>> '{plan,content,0,content}' <> 'Saved plan' or jsonb_array_length(result->'files') <> 1 then raise exception 'MATERIAL_BODY_MISMATCH'; end if;
    if not exists(select 1 from storage.objects where bucket_id='prep-artifacts' and name=session_id::text || '/lesson-plan/material.pdf') then raise exception 'ATTACHMENT_READ_DENIED'; end if;
    if not exists(select 1 from public.lesson_plans p where p.session_id=current_setting('materials.test.session')::uuid) then raise exception 'PLAN_RLS_READ_DENIED'; end if;
    foreach kind in array array['solution','rehearsal_video','courseware'] loop perform public.get_session_materials(session_id,classroom_id,kind); end loop;
    if account_key='supervisor' then
      if public.can_review_session_preparation(session_id,account_id::uuid) then raise exception 'MANAGER_REVIEW_ESCALATION'; end if;
      begin
        perform public.save_session_lesson_plan(session_id,'mathin-teaching-plan-v1','[]',1);
        raise exception 'MANAGER_WRITE_ALLOWED';
      exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
    end if;
    if account_key='teacher' then
      result := public.get_session_materials(current_setting('materials.test.empty')::uuid,classroom_id,'lesson_plan');
      if result->'plan' <> 'null'::jsonb or jsonb_array_length(result->'files') <> 0 then raise exception 'EMPTY_PLAN_BECAME_TEMPLATE'; end if;
      begin
        perform public.get_session_materials(current_setting('materials.test.other')::uuid,current_setting('materials.test.other_classroom')::uuid,'summary');
        raise exception 'UNRELATED_TEACHER_ALLOWED';
      exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
    end if;
    begin
      perform public.get_session_materials(session_id,current_setting('materials.test.other_classroom')::uuid,'lesson_plan');
      raise exception 'CLASSROOM_SUBSTITUTION_ALLOWED';
    exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  end loop;
  account_id := current_setting('materials.test.outsider');
  perform set_config('request.jwt.claim.sub',account_id,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',account_id,'role','authenticated')::text,true);
  begin perform public.get_session_materials(session_id,classroom_id,'summary'); raise exception 'OUTSIDER_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  if exists(select 1 from storage.objects where bucket_id='prep-artifacts' and name=session_id::text || '/lesson-plan/material.pdf') then raise exception 'OUTSIDER_ATTACHMENT_VISIBLE'; end if;
  if exists(select 1 from public.lesson_plans p where p.session_id=current_setting('materials.test.session')::uuid) then raise exception 'OUTSIDER_PLAN_VISIBLE'; end if;
  perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{}',true);
  begin perform public.get_session_materials(session_id,classroom_id,'summary'); raise exception 'ANONYMOUS_ALLOWED';
  exception when raise_exception then if sqlerrm <> 'UNAUTHENTICATED' then raise; end if; end;
  if has_function_privilege('anon','public.get_session_materials(uuid,uuid,text)','execute') then raise exception 'ANONYMOUS_GRANT'; end if;
end;
$$;
reset role;
