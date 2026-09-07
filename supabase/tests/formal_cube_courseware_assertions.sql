-- 固定开发身份；课程、页面与审核发布全部位于事务内，最终回滚。
begin;
do $test$
declare
  admin_id uuid; researcher_id uuid; student_id uuid;
  course_id uuid; lecture_id uuid; original_page_id uuid := gen_random_uuid(); source_revision_id uuid;
  cube_page_id uuid := gen_random_uuid(); first_revision_id uuid; next_revision_id uuid; next_revision_no integer;
  old_release_id uuid; release_id uuid; cycle_id uuid; frozen_snapshot jsonb; result uuid;
  tool jsonb := '{"toolId":"spatial-lab","contentVersion":"cube-structures-lesson-v2","payload":{"title":"Cube fixture","toolbar":["orbit","cut"],"history":{"version":"cube-structures-draft-v3","cursor":0,"initial":{"cubes":[{"id":"cube-1","position":{"x":0,"y":0,"z":0},"color":"#8fbf88","faces":{}}],"hiddenCubeIds":[],"groups":[],"origin":{"x":-0.5,"y":-0.5,"z":-0.5},"axesVisible":true,"view":"angle","frame":{"center":{"x":0,"y":0,"z":0},"radius":2},"nextCubeId":2,"nextNumber":1,"hiddenEdgesVisible":true},"operations":[]}}}'::jsonb;
  doc jsonb; edited jsonb; base_doc jsonb;
begin
  select p.id into admin_id from public.profiles p join auth.users u on u.id = p.id where u.email = 'test-admin@mathin.local' and p.role = 'admin' and p.is_active;
  select p.id into researcher_id from public.profiles p join auth.users u on u.id = p.id where u.email = 'test-research@mathin.local' and p.is_active;
  select p.id into student_id from public.profiles p join auth.users u on u.id = p.id where u.email = 'test-student@mathin.local' and p.is_active;
  if admin_id is null or researcher_id is null or student_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  if has_function_privilege('anon', 'public.create_cw_formal_cube_page(uuid,uuid,text,jsonb)', 'execute')
    or has_function_privilege('service_role', 'public.save_cw_formal_cube_page(uuid,text,jsonb,integer,text)', 'execute')
    or has_function_privilege('authenticated', 'public.cw_formal_cube_page_is_valid(jsonb)', 'execute')
    or not has_function_privilege('authenticated', 'public.create_cw_formal_cube_page(uuid,uuid,text,jsonb)', 'execute') then raise exception 'FORMAL_CUBE_ACL_FAILED'; end if;

  base_doc := jsonb_build_object('docVersion','page-doc-v1','sourceCoursewareId','teacher-composition-overlay','sourcePageId',null,
    'sourcePageDatabaseId',1,'sourceSnapshotId',1,'sourceContentHash',repeat('0',64),
    'canvas',jsonb_build_object('width',960,'height',720,'backgroundColor',null,'backgroundBindingKey',null),'nodes','[]'::jsonb,'interactions','[]'::jsonb);
  doc := jsonb_build_object('docVersion','courseware-composition-v1','canvas',jsonb_build_object('width',960,'height',720,'backgroundColor','#ffffff'),
    'source',null,'overlay',base_doc,'layout',jsonb_build_object('version','courseware-composition-grid-v1','columns',12,'rows',9,'blocks',jsonb_build_array(
      jsonb_build_object('id','cube-1','type','tool','tool',tool,'placement',jsonb_build_object('column',0,'row',0,'columnSpan',12,'rowSpan',9)))));
  if public.cw_formal_cube_page_is_valid(doc) is not true
    or public.cw_formal_cube_page_is_valid(null)
    or public.cw_formal_cube_page_is_valid(jsonb_set(doc,'{layout,blocks,0,tool,payload,toolbar}','["unknown"]'))
    or public.cw_formal_cube_page_is_valid(jsonb_set(doc,'{layout,blocks,0,tool}','{"toolId":"spatial-lab","contentVersion":"tool-embed-v1"}'))
    or public.cw_formal_cube_page_is_valid(jsonb_set(doc,'{overlay,canvas,backgroundBindingKey}',to_jsonb(repeat('a',64))))
    or public.cw_formal_cube_page_is_valid(jsonb_set(doc,'{source}','{}')) then raise exception 'FORMAL_CUBE_SHAPE_FAILED'; end if;

  insert into public.courses(title, product_code, grade, term, class_type, status, created_by)
    values('__FORMAL_CUBE_TRANSACTION__','__FORMAL_CUBE__'||replace(gen_random_uuid()::text,'-',''),1,1,'audit','enabled',admin_id) returning id into course_id;
  insert into public.course_lectures(course_id,no,name,status) values(course_id,1,'__FORMAL_CUBE_TRANSACTION__','active') returning id into lecture_id;
  insert into public.cw_page_docs(id,lecture_id,page_no,title,source_courseware_id,doc_version)
    values(original_page_id,lecture_id,1,'Original source','formal-cube-fixture-source','page-doc-v1');
  insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,created_by,track)
    values(original_page_id,1,jsonb_set(base_doc,'{canvas,width}','1280'),'import',admin_id,'native-16x9') returning id into source_revision_id;
  insert into public.cw_page_track_heads(page_doc_id,track,current_revision_id) values
    (original_page_id,'native-16x9',source_revision_id),(original_page_id,'adapted-4x3',source_revision_id);
  update public.cw_page_docs set current_revision_id = source_revision_id where id = original_page_id;
  frozen_snapshot := jsonb_build_array(jsonb_build_object('pageDocId',original_page_id,'revisionId',source_revision_id,'bindings','[]'::jsonb));
  insert into public.cw_lecture_releases(lecture_id,track,release_no,snapshot,note,published_by)
    values(lecture_id,'native-16x9',1,frozen_snapshot,'Fixture immutable release',admin_id) returning id into old_release_id;
  insert into public.cw_lecture_track_heads(lecture_id,track,current_release_id) values(lecture_id,'native-16x9',old_release_id);

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claim.sub',researcher_id::text,true);
  begin
    perform public.create_cw_formal_cube_page(lecture_id,cube_page_id,'Cube',doc);
    raise exception 'UNRELATED_RESEARCHER_ACCEPTED';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claim.sub',student_id::text,true);
  begin
    perform public.create_cw_formal_cube_page(lecture_id,cube_page_id,'Cube',doc);
    raise exception 'STUDENT_CREATE_ACCEPTED';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  result := public.create_cw_formal_cube_page(lecture_id,cube_page_id,'Cube',doc);
  if result <> cube_page_id or public.create_cw_formal_cube_page(lecture_id,cube_page_id,'Retry',doc) <> cube_page_id then raise exception 'CREATE_RETRY_FAILED'; end if;
  select draft_revision_id into first_revision_id from public.cw_page_track_heads where page_doc_id = cube_page_id and track = 'adapted-4x3';
  if (select count(*) from public.cw_page_revisions where page_doc_id = cube_page_id) <> 1
    or (select count(*) from public.cw_page_track_heads where page_doc_id = cube_page_id and draft_revision_id = first_revision_id and current_revision_id is null) <> 2
    or (select page_no from public.cw_page_docs where id = cube_page_id) <> 2
    or (select page_no from public.cw_page_docs where id = original_page_id) <> 1
    or (select snapshot from public.cw_lecture_releases where id = old_release_id) is distinct from frozen_snapshot then raise exception 'CREATE_BOUNDARIES_FAILED'; end if;

  edited := jsonb_set(doc,'{layout,blocks,0,tool,payload,toolbar}','["number"]');
  select s.revision_id,s.revision_no into next_revision_id,next_revision_no from public.save_cw_formal_cube_page(cube_page_id,'adapted-4x3',edited,1,'toolbar') s;
  if next_revision_no <> 2
    or (select draft_revision_id from public.cw_page_track_heads where page_doc_id = cube_page_id and track = 'native-16x9') <> first_revision_id
    or (select r.doc from public.cw_page_revisions r where r.id = first_revision_id) is distinct from doc then raise exception 'TRACK_OR_REVISION_ISOLATION_FAILED'; end if;
  begin
    perform public.save_cw_formal_cube_page(cube_page_id,'adapted-4x3',doc,1,'stale');
    raise exception 'STALE_WRITE_ACCEPTED';
  exception when others then if sqlerrm <> 'VERSION_CONFLICT' then raise; end if; end;
  begin
    perform public.save_cw_formal_cube_page(original_page_id,'native-16x9',doc,1,'wrong target');
    raise exception 'SOURCE_CONVERSION_ACCEPTED';
  exception when others then if sqlerrm <> 'FORMAL_CUBE_PAGE_REQUIRED' then raise; end if; end;
  begin
    perform public.save_cw_formal_cube_page(cube_page_id,'adapted-4x3',jsonb_set(edited,'{layout,blocks,0,tool,payload,toolbar}','["bad"]'),2,'invalid');
    raise exception 'INVALID_SAVE_ACCEPTED';
  exception when others then if sqlerrm <> 'INVALID_FORMAL_CUBE_PAGE' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',student_id::text,true);
  begin
    perform public.save_cw_formal_cube_page(cube_page_id,'adapted-4x3',doc,2,'student');
    raise exception 'STUDENT_SAVE_ACCEPTED';
  exception when sqlstate '42501' then null; end;
  if exists (select 1 from public.cw_page_revisions where page_doc_id = cube_page_id) then raise exception 'STUDENT_DRAFT_READ_ACCEPTED'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);

  cycle_id := public.submit_cw_review(lecture_id,'adapted-4x3','Cube contract check');
  perform public.approve_cw_review(cycle_id,'Verified in transaction',array[1,2]);
  release_id := public.publish_cw_review_cycle(lecture_id,'adapted-4x3','Cube contract check');
  if not exists (select 1 from public.cw_lecture_releases r, jsonb_array_elements(r.snapshot) p
    where r.id = release_id and p ->> 'pageDocId' = cube_page_id::text and p ->> 'revisionId' = next_revision_id::text)
    then raise exception 'FORMAL_RELEASE_MISSING_CUBE'; end if;
  perform public.save_cw_formal_cube_page(cube_page_id,'adapted-4x3',doc,2,'After publication');
  if (select r.doc from public.cw_page_revisions r where r.id = next_revision_id) is distinct from edited
    or (select current_revision_id from public.cw_page_track_heads where page_doc_id = cube_page_id and track = 'adapted-4x3') <> next_revision_id
    or (select snapshot from public.cw_lecture_releases where id = old_release_id) is distinct from frozen_snapshot then raise exception 'FROZEN_RELEASE_CHANGED'; end if;
  perform set_config('role','postgres',true);
end;
$test$;
rollback;
