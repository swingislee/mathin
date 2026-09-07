-- 使用固定开发身份；新课程、空白页、资源元数据和发布记录均随事务回滚。
begin;
do $test$
declare
  admin_id uuid; student_id uuid; researcher_id uuid; course_id uuid; lecture_id uuid;
  page_id uuid; second_page_id uuid; original_page_id uuid := gen_random_uuid();
  first_revision uuid; saved_revision uuid; original_revision uuid; revision_no integer;
  cycle_id uuid; release_id uuid; frozen_snapshot jsonb; doc jsonb; blank_doc jsonb;
  image_key text := md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  image_hash text := md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  tool jsonb := '{"toolId":"spatial-lab","contentVersion":"cube-structures-lesson-v2","payload":{"title":"Cube fixture","toolbar":["orbit","cut"],"history":{"version":"cube-structures-draft-v3","cursor":0,"initial":{"cubes":[{"id":"cube-1","position":{"x":0,"y":0,"z":0},"color":"#8fbf88","faces":{}}],"hiddenCubeIds":[],"groups":[],"origin":{"x":-0.5,"y":-0.5,"z":-0.5},"axesVisible":true,"view":"angle","frame":{"center":{"x":0,"y":0,"z":0},"radius":2},"nextCubeId":2,"nextNumber":1,"hiddenEdgesVisible":true},"operations":[]}}}'::jsonb;
begin
  select p.id into admin_id from public.profiles p where p.id=nullif(current_setting('mathin.assertion.admin',true),'')::uuid and p.role='admin' and p.is_active;
  select p.id into student_id from public.profiles p where p.id=nullif(current_setting('mathin.assertion.student',true),'')::uuid and p.role='student' and p.is_active;
  select p.id into researcher_id from public.profiles p where p.id=nullif(current_setting('mathin.assertion.researcher',true),'')::uuid and p.role='staff' and p.is_active;
  if admin_id is null or student_id is null or researcher_id is null then raise exception 'FIXED_DEVELOPMENT_ACCOUNTS_REQUIRED'; end if;
  if has_function_privilege('anon','public.create_blank_cw_page(uuid,uuid,text)','execute')
    or has_function_privilege('service_role','public.save_cw_manual_composition_page(uuid,text,jsonb,integer,text)','execute')
    or has_function_privilege('authenticated','public.cw_manual_composition_doc_is_valid(jsonb)','execute') then raise exception 'BLANK_PAGE_ACL_FAILED'; end if;
  insert into public.courses(title,product_code,grade,term,class_type,status,created_by)
    values('__BLANK_PAGE_TRANSACTION__','__BLANK__'||replace(gen_random_uuid()::text,'-',''),1,1,'audit','enabled',admin_id) returning id into course_id;
  insert into public.course_lectures(course_id,no,name,status) values(course_id,1,'__BLANK_PAGE_TRANSACTION__','active') returning id into lecture_id;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claim.sub',student_id::text,true);
  begin
    perform public.create_blank_cw_page(lecture_id,null,'Forbidden');
    raise exception 'STUDENT_CREATE_ACCEPTED';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claim.sub',researcher_id::text,true);
  begin
    perform public.create_blank_cw_page(lecture_id,null,'Forbidden');
    raise exception 'UNRELATED_CREATE_ACCEPTED';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  page_id := public.create_blank_cw_page(lecture_id,null,'Blank');
  select p.draft_revision_id into first_revision from public.cw_page_docs p where p.id=page_id;
  select r.doc into blank_doc from public.cw_page_revisions r where r.id=first_revision;
  if blank_doc ->> 'docVersion' <> 'courseware-composition-v1'
    or blank_doc #> '{layout,blocks}' <> '[]'::jsonb or blank_doc #> '{overlay,nodes}' <> '[]'::jsonb
    or (select count(*) from public.cw_page_track_heads where page_doc_id=page_id and draft_revision_id=first_revision and current_revision_id is null) <> 2
    or (select source_courseware_id from public.cw_page_docs where id=page_id) <> 'mathin-manual'
    then raise exception 'BLANK_PAGE_INITIAL_STATE_FAILED'; end if;
  second_page_id := public.create_blank_cw_page(lecture_id,page_id,'Second blank');
  if (select page_no from public.cw_page_docs where id=page_id) <> 1
    or (select page_no from public.cw_page_docs where id=second_page_id) <> 2 then raise exception 'BLANK_PAGE_ORDER_FAILED'; end if;

  doc := jsonb_set(blank_doc,'{layout,blocks}',jsonb_build_array(
    jsonb_build_object('id','cube-1','type','tool','tool',tool,'placement',jsonb_build_object('column',0,'row',0,'columnSpan',8,'rowSpan',9)),
    jsonb_build_object('id','node-image-1','type','node','nodeId','image-1','placement',jsonb_build_object('column',8,'row',0,'columnSpan',4,'rowSpan',4))));
  doc := jsonb_set(doc,'{overlay,nodes}',jsonb_build_array(jsonb_build_object(
    'id','image-1','adapter','image','transform',jsonb_build_object('x',640,'y',0,'width',320,'height',320,'rotation',0,'scaleX',1,'scaleY',1),
    'visible',true,'opacity',1,'zIndex',1,'content',jsonb_build_object('kind','image'),'children','[]'::jsonb,
    'resources',jsonb_build_array(jsonb_build_object('bindingKey',image_key,'bindingPath','$.src','role','image','kind','image')))));
  perform public.register_cw_page_inserted_asset(second_page_id,'adapted-4x3',image_key,image_hash,'image/png',12,1,1,'Fixture','image','image','sha256/'||substr(image_hash,1,2)||'/'||image_hash);
  begin
    perform public.save_cw_manual_composition_page(page_id,'adapted-4x3',doc,1,'foreign binding');
    raise exception 'FOREIGN_BINDING_ACCEPTED';
  exception when others then if sqlerrm <> 'COURSEWARE_DOC_BINDING_MISSING' then raise; end if; end;
  image_key := md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  doc := jsonb_set(doc,'{overlay,nodes,0,resources,0,bindingKey}',to_jsonb(image_key));
  perform public.register_cw_page_inserted_asset(page_id,'native-16x9',image_key,image_hash,'image/png',12,1,1,'Fixture','image','image','sha256/'||substr(image_hash,1,2)||'/'||image_hash);
  begin
    perform public.save_cw_manual_composition_page(page_id,'adapted-4x3',doc,1,'wrong track binding');
    raise exception 'WRONG_TRACK_BINDING_ACCEPTED';
  exception when others then if sqlerrm <> 'COURSEWARE_DOC_BINDING_MISSING' then raise; end if; end;
  image_key := md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);
  doc := jsonb_set(doc,'{overlay,nodes,0,resources,0,bindingKey}',to_jsonb(image_key));
  perform public.register_cw_page_inserted_asset(page_id,'adapted-4x3',image_key,image_hash,'image/png',12,1,1,'Fixture','image','image','sha256/'||substr(image_hash,1,2)||'/'||image_hash);
  select saved.revision_id,saved.revision_no into saved_revision,revision_no
    from public.save_cw_manual_composition_page(page_id,'adapted-4x3',doc,1,'Insert cube and image') saved;
  if revision_no <> 2
    or (select draft_revision_id from public.cw_page_track_heads where page_doc_id=page_id and track='native-16x9') <> first_revision
    or (select r.doc from public.cw_page_revisions r where r.id=first_revision) is distinct from blank_doc then raise exception 'TRACK_ISOLATION_FAILED'; end if;
  begin
    perform public.save_cw_manual_composition_page(page_id,'adapted-4x3',blank_doc,1,'stale');
    raise exception 'STALE_WRITE_ACCEPTED';
  exception when others then if sqlerrm <> 'VERSION_CONFLICT' then raise; end if; end;
  perform set_config('request.jwt.claim.sub',student_id::text,true);
  begin
    perform public.save_cw_manual_composition_page(page_id,'adapted-4x3',blank_doc,2,'student');
    raise exception 'STUDENT_SAVE_ACCEPTED';
  exception when sqlstate '42501' then null; end;
  if exists(select 1 from public.cw_page_revisions where page_doc_id=page_id) then raise exception 'STUDENT_READ_ACCEPTED'; end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  cycle_id := public.submit_cw_review(lecture_id,'adapted-4x3','Blank page contract');
  perform public.approve_cw_review(cycle_id,'Transaction check',array[1,2]);
  release_id := public.publish_cw_review_cycle(lecture_id,'adapted-4x3','Blank page contract');
  select snapshot into frozen_snapshot from public.cw_lecture_releases where id=release_id;
  if not exists(select 1 from jsonb_array_elements(frozen_snapshot) page where page ->> 'revisionId'=saved_revision::text)
    then raise exception 'PUBLISHED_COMPONENT_MISSING'; end if;
  perform public.save_cw_manual_composition_page(page_id,'adapted-4x3',blank_doc,2,'Remove components after publication');
  if (select snapshot from public.cw_lecture_releases where id=release_id) is distinct from frozen_snapshot
    or (select r.doc from public.cw_page_revisions r where r.id=saved_revision) is distinct from doc then raise exception 'FROZEN_RELEASE_CHANGED'; end if;

  perform set_config('role','postgres',true);
  insert into public.cw_page_docs(id,lecture_id,page_no,title,source_courseware_id,doc_version)
    values(original_page_id,lecture_id,3,'Original manual PageDoc','mathin-manual','page-doc-v1');
  insert into public.cw_page_revisions(page_doc_id,revision_no,doc,origin,created_by,track)
    values(original_page_id,1,blank_doc -> 'overlay','edit',admin_id,'native-16x9') returning id into original_revision;
  insert into public.cw_page_track_heads(page_doc_id,track,draft_revision_id) values(original_page_id,'native-16x9',original_revision);
  perform set_config('role','authenticated',true);
  begin
    perform public.save_cw_manual_composition_page(original_page_id,'native-16x9',blank_doc,1,'wrong document');
    raise exception 'OLD_PAGE_CONVERSION_ACCEPTED';
  exception when others then if sqlerrm <> 'MANUAL_COMPOSITION_PAGE_REQUIRED' then raise; end if; end;
  perform set_config('role','postgres',true);
end;
$test$;
rollback;
