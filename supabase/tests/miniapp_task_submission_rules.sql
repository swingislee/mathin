-- Synthetic classroom, participant and uploads in a transaction rolled back by the local runner.
create function pg_temp.expect_task_error(statement text,expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise exception 'EXPECTED_%,GOT_%',expected,sqlerrm; end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $check$
declare actor uuid; parent_id uuid; outsider uuid; student uuid:=gen_random_uuid(); classroom uuid:=gen_random_uuid(); sess uuid:=gen_random_uuid();
  text_task uuid; media_task uuid; old_task uuid; paper_task uuid; receipt uuid:=gen_random_uuid(); media_receipt uuid:=gen_random_uuid(); image_id uuid:=gen_random_uuid();
  rules jsonb:=mathin_internal.default_miniapp_task_rules(); text_rules jsonb; image_rules jsonb; image_path text;
begin
  select id into actor from profiles where purpose='test' and role='admin' and id=(select id from auth.users where email='test-admin@mathin.local');
  select id into parent_id from profiles where purpose='test' and id=(select id from auth.users where email='test-parent@mathin.local');
  select id into outsider from profiles where purpose='test' and id=(select id from auth.users where email='test-parent-unbound@mathin.local');
  if actor is null or parent_id is null or outsider is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  insert into classrooms(id,owner_id,name,invite_code,capacity,purpose,operational_status) values(classroom,actor,'Submission rules fixture',classroom::text,20,'test','active');
  insert into classroom_members(classroom_id,user_id,role) values(classroom,actor,'teacher');
  insert into class_sessions(id,classroom_id,title,scheduled_at,duration_min) values(sess,classroom,'Submission rules lesson',now()+interval '2 days',45);
  insert into students(id,name,bind_code,created_by,assigned_to) values(student,'Task rules fixture',student::text,actor,actor);
  insert into student_guardians(student_id,guardian_id,scope) values(student,parent_id,array['grades','video']);
  insert into enrollments(classroom_id,student_id,status,operated_by) values(classroom,student,'active',actor);
  text_rules:=rules||'{"mediaTypes":[],"minFiles":0,"maxFiles":0,"noteRequired":true,"maxNoteLength":100}'::jsonb;
  image_rules:=rules||'{"mediaTypes":["image"],"minFiles":1,"maxFiles":2,"noteRequired":true,"maxNoteLength":100,"imageMaxBytes":2000}'::jsonb;
  text_task:=public.publish_session_assignment_with_rules(sess,'Text fixture','Write a short reflection',null,text_rules);
  media_task:=public.publish_session_assignment_with_rules(sess,'Image fixture','Share a photo and comment',null,image_rules);
  old_task:=public.publish_session_assignment(sess,'Old client fixture','Original API',null);
  paper_task:=public.publish_session_template_assignment_with_rules(sess,'Paper fixture','Keep the question snapshot',null,text_rules);
  if (select miniapp_submission_rules from assignments where id=paper_task)<>text_rules
    or (select miniapp_submission_rules from assignments where id=old_task)<>rules then raise exception 'PUBLICATION_RULES_OR_LEGACY'; end if;
  perform pg_temp.expect_task_error(format('select public.publish_session_assignment_with_rules(%L,%L,%L,null,%L)',sess,'Invalid rules','',jsonb_set(rules,'{maxFiles}','10')),'VALIDATION');
  perform pg_temp.expect_task_error(format('update public.assignments set miniapp_submission_rules=%L where id=%L',rules,text_task),'SUBMISSION_RULES_IMMUTABLE');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  if public.miniapp_task_submission_rules(text_task,student)<>text_rules then raise exception 'TASK_RULES_MISSING'; end if;
  if not exists(select 1 from jsonb_array_elements(public.miniapp_my_practices()) t where t->>'id'=text_task::text and t->'submissionRules'=text_rules) then raise exception 'TASK_LIST_RULES'; end if;
  perform pg_temp.expect_task_error(format('select public.miniapp_submit_practice(%L,%L,%L,%L,%L::uuid[])',receipt,text_task,student,'','{}'),'VALIDATION');
  perform pg_temp.expect_task_error(format('select public.miniapp_submit_practice(%L,%L,%L,%L,%L::uuid[])',receipt,text_task,student,repeat('a',101),'{}'),'VALIDATION');
  if public.miniapp_submit_practice(receipt,text_task,student,'Text-only reflection','{}')<>receipt
    or public.miniapp_submit_practice(receipt,text_task,student,'Text-only reflection','{}')<>receipt then raise exception 'TEXT_SUBMISSION_RETRY'; end if;
  perform pg_temp.expect_task_error(format('select public.miniapp_submit_practice(%L,%L,%L,%L,%L::uuid[])',receipt,text_task,student,'Changed body','{}'),'CONFLICT');
  if (select submission_rules from miniapp_practice_submissions where id=receipt)<>text_rules then raise exception 'SUBMISSION_SNAPSHOT_MISSING'; end if;
  image_path:=parent_id::text||'/'||media_task::text||'/'||student::text||'/'||image_id::text||'.png';
  perform pg_temp.expect_task_error(format('select public.miniapp_reserve_upload(%L,%L,%L,%L,%L,%L,%L,128)',image_id,text_task,student,image_path,'image.png','image','image/png'),'FILE_TYPE');
  perform pg_temp.expect_task_error(format('select public.miniapp_reserve_upload(%L,%L,%L,%L,%L,%L,%L,128)',image_id,media_task,student,image_path,'video.mp4','video','video/mp4'),'FILE_TYPE');
  perform pg_temp.expect_task_error(format('select public.miniapp_reserve_upload(%L,%L,%L,%L,%L,%L,%L,2001)',image_id,media_task,student,image_path,'image.png','image','image/png'),'TOO_LARGE');
  perform public.miniapp_reserve_upload(image_id,media_task,student,image_path,'image.png','image','image/png',128);
  perform pg_temp.expect_task_error(format('select public.miniapp_submit_practice(%L,%L,%L,%L,array[%L::uuid])',media_receipt,media_task,student,'Not uploaded yet',image_id),'VALIDATION');
  insert into storage.objects(bucket_id,name) values('miniapp-practice',image_path);
  update miniapp_practice_uploads set ready=true where id=image_id;
  perform pg_temp.expect_task_error(format('select public.miniapp_submit_practice(%L,%L,%L,%L,array[%L::uuid])',media_receipt,media_task,student,'',image_id),'VALIDATION');
  perform pg_temp.expect_task_error(format('select public.miniapp_submit_practice(%L,%L,%L,%L,array[%L::uuid,%L::uuid])',media_receipt,media_task,student,'Duplicate media',image_id,image_id),'VALIDATION');
  perform pg_temp.expect_task_error(format('select public.miniapp_submit_practice(%L,%L,%L,%L,array[%L::uuid])',gen_random_uuid(),old_task,student,'Foreign assignment upload',image_id),'VALIDATION');
  if public.miniapp_submit_practice(media_receipt,media_task,student,'Photo reflection',array[image_id])<>media_receipt then raise exception 'MEDIA_SUBMISSION'; end if;
  if (select submission_rules from miniapp_practice_submissions where id=media_receipt)<>image_rules then raise exception 'MEDIA_RULES_SNAPSHOT'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated','aal','aal1')::text,true);
  perform pg_temp.expect_task_error(format('select public.miniapp_task_submission_rules(%L,%L)',text_task,student),'FORBIDDEN');
  perform pg_temp.expect_task_error(format('select public.miniapp_submit_practice(%L,%L,%L,%L,%L::uuid[])',gen_random_uuid(),text_task,student,'Outsider','{}'),'FORBIDDEN');
  perform pg_temp.expect_task_error(format('select public.publish_session_assignment_with_rules(%L,%L)',sess,'Outsider'),'FORBIDDEN');
  if has_function_privilege('authenticated','mathin_internal.miniapp_reserve_upload_before_rules(uuid,uuid,uuid,text,text,text,text,bigint)','execute')
    or has_function_privilege('anon','public.miniapp_task_submission_rules(uuid,uuid)','execute') then raise exception 'PRIVATE_UPLOAD_OR_TASK_ACCESS'; end if;
end $check$;
