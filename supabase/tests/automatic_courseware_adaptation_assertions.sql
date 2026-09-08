begin;
do $test$
declare
  admin_id uuid := nullif(current_setting('mathin.assertion.admin',true),'')::uuid;
  student_id uuid := nullif(current_setting('mathin.assertion.student',true),'')::uuid;
  researcher_id uuid := nullif(current_setting('mathin.assertion.researcher',true),'')::uuid;
  course_id uuid; lecture_id uuid; page_id uuid := gen_random_uuid(); native_id uuid; adapted_id uuid;
  cycle_id uuid; native_release uuid; adapted_release uuid; frozen jsonb; created boolean;
  native_doc jsonb := '{"docVersion":"page-doc-v1","sourceCoursewareId":"mathin-manual","sourcePageId":"auto-fixture","sourcePageDatabaseId":1,"sourceSnapshotId":1,"sourceContentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","canvas":{"width":1280,"height":720,"backgroundColor":null,"backgroundBindingKey":null},"nodes":[],"interactions":[]}'::jsonb;
  adapted_doc jsonb;
begin
  if admin_id is null or student_id is null or researcher_id is null then raise exception 'FIXED_IDENTITIES_REQUIRED'; end if;
  if has_function_privilege('anon','public.create_missing_cw_adapted_draft(uuid,uuid,jsonb)','execute')
    or has_function_privilege('service_role','public.create_missing_cw_adapted_draft(uuid,uuid,jsonb)','execute') then raise exception 'AUTO_ADAPT_ACL_FAILED'; end if;
  insert into public.courses(title,product_code,grade,term,class_type,status,created_by)
    values('__AUTO_ADAPT_TRANSACTION__','__AUTO__'||replace(gen_random_uuid()::text,'-',''),1,1,'audit','enabled',admin_id) returning id into course_id;
  insert into public.course_lectures(course_id,no,name,status) values(course_id,1,'__AUTO_ADAPT_TRANSACTION__','active') returning id into lecture_id;
  insert into public.cw_page_docs(id,lecture_id,page_no,title,source_courseware_id,doc_version)
    values(page_id,lecture_id,1,'Automatic draft fixture','mathin-manual','page-doc-v1');
  insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,created_by,track)
    values(page_id,1,native_doc,'edit',admin_id,'native-16x9') returning id into native_id;
  insert into public.cw_page_track_heads(page_doc_id,track,draft_revision_id) values(page_id,'native-16x9',native_id);
  adapted_doc := jsonb_set(native_doc,'{canvas,width}','960');
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claim.sub',student_id::text,true);
  begin
    perform public.create_missing_cw_adapted_draft(page_id,native_id,adapted_doc);
    raise exception 'STUDENT_AUTO_ADAPT_ACCEPTED';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claim.sub',researcher_id::text,true);
  begin
    perform public.create_missing_cw_adapted_draft(page_id,native_id,adapted_doc);
    raise exception 'UNRELATED_AUTO_ADAPT_ACCEPTED';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  begin
    perform public.create_missing_cw_adapted_draft(page_id,gen_random_uuid(),adapted_doc);
    raise exception 'STALE_SOURCE_ACCEPTED';
  exception when others then if sqlerrm <> 'VERSION_CONFLICT' then raise; end if; end;
  if exists(select 1 from public.cw_page_track_heads where page_doc_id=page_id and track='adapted-4x3') then raise exception 'FAILED_DRAFT_LEFT_HEAD'; end if;
  cycle_id := public.submit_cw_review(lecture_id,'native-16x9','fixture');
  perform public.approve_cw_review(cycle_id,'Transaction check',array[1]);
  native_release := public.publish_cw_review_cycle(lecture_id,'native-16x9','fixture');
  select snapshot into frozen from public.cw_lecture_releases where id=native_release;
  created := public.create_missing_cw_adapted_draft(page_id,native_id,adapted_doc);
  if not created then raise exception 'MISSING_DRAFT_NOT_CREATED'; end if;
  select draft_revision_id into adapted_id from public.cw_page_track_heads where page_doc_id=page_id and track='adapted-4x3';
  if adapted_id is null or adapted_id=native_id then raise exception 'ADAPTED_DRAFT_NOT_INDEPENDENT'; end if;
  if (select snapshot from public.cw_lecture_releases where id=native_release) is distinct from frozen
    or (select doc from public.cw_page_revisions where id=native_id) is distinct from native_doc then raise exception 'SOURCE_OR_RELEASE_CHANGED'; end if;
  created := public.create_missing_cw_adapted_draft(page_id,native_id,jsonb_set(adapted_doc,'{canvas,backgroundColor}','"#ff0000"'));
  if created or (select draft_revision_id from public.cw_page_track_heads where page_doc_id=page_id and track='adapted-4x3') is distinct from adapted_id then raise exception 'EXISTING_EDITS_OVERWRITTEN'; end if;
  cycle_id := public.submit_cw_review(lecture_id,'adapted-4x3','Automatic draft review');
  perform public.approve_cw_review(cycle_id,'Transaction check',array[1]);
  adapted_release := public.publish_cw_review_cycle(lecture_id,'adapted-4x3','Explicit publication');
  if not exists(select 1 from public.cw_lecture_releases r, jsonb_array_elements(r.snapshot) entry where r.id=adapted_release and entry->>'revisionId'=adapted_id::text) then raise exception 'AUTO_DRAFT_RELEASE_MISSING'; end if;
  if public.create_missing_cw_adapted_draft(page_id,native_id,adapted_doc) then raise exception 'RELEASED_TRACK_REGENERATED'; end if;
  perform set_config('role','postgres',true);
end;
$test$;
rollback;
