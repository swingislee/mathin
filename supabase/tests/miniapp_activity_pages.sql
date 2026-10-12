-- Run on an identified isolated database; the caller rolls back all fixtures.
create function pg_temp.expect_activity_page_error(statement text,expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm like '%'||expected||'%' then return; end if;
    raise exception 'EXPECTED_%,GOT_%',expected,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;

do $setup$
declare admin_id uuid; parent_id uuid; activity_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); class_id uuid:=gen_random_uuid();
  image_path text; draft_path text; page jsonb; draft jsonb;
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select id into parent_id from auth.users where email='test-parent@mathin.local';
  if admin_id is null or parent_id is null or not exists(select 1 from profiles where id=admin_id and purpose='test' and role='admin')
    then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  insert into activities(id,kind,title,scheduled_at,capacity,created_by,target_grades) values
    (activity_id,'public_class','Activity page check',now()+interval '7 days',20,admin_id,array[5]::smallint[]),
    (other_id,'public_class','Unlisted page check',now()+interval '7 days',20,admin_id,array[5]::smallint[]);
  insert into classrooms(id,owner_id,name,invite_code,grade,capacity,purpose,offering_type,operational_status)
    values(class_id,admin_id,'Short course page check',class_id::text,5,20,'production','short_term_topic','planning');
  insert into class_sessions(classroom_id,title,scheduled_at,duration_min) values(class_id,'First session',now()+interval '7 days',90);
  insert into miniapp_short_course_publications(classroom_id,location,tags) values(class_id,'Check campus',array['活动']);
  perform public.save_parent_registration_publication('activity',activity_id,'Activity page check','Original description',now()+interval '6 days',true,0);
  perform public.save_parent_registration_publication('class',class_id,'Short course page check','',now()+interval '6 days',true,0);
  image_path:='activity/'||activity_id||'/'||gen_random_uuid()||'.png';
  draft_path:='activity/'||activity_id||'/'||gen_random_uuid()||'.png';
  insert into storage.objects(bucket_id,name) values('miniapp-activity-images',image_path),('miniapp-activity-images',draft_path),
    ('miniapp-activity-images',replace(image_path,'.png','.thumb.png'));
  page:=jsonb_build_object('version',1,'layout','cards','cover',image_path,'blocks',jsonb_build_array(
    jsonb_build_object('id',gen_random_uuid(),'type','text','title','Introduction','body','Published copy')));
  page:=page||jsonb_build_object('listing',jsonb_build_object('cover','','summary','Published card','labels',jsonb_build_array('Open day'),'sortOrder',-2),
    'signup',jsonb_build_object('instructions','Bring a notebook','confirmation','Meet at reception','success','We will contact you'));
  draft:=jsonb_set(jsonb_set(page,'{blocks,0,body}','"Private draft"'),'{cover}',to_jsonb(draft_path));
  perform public.save_miniapp_activity_page('activity',activity_id,page,0,true);
  perform public.save_miniapp_activity_page('activity',activity_id,draft,1,false);
  perform public.save_miniapp_activity_page('activity',other_id,jsonb_set(page,'{cover}','""'),0,true);
  perform public.save_miniapp_activity_page('class',class_id,jsonb_set(page,'{cover}','""'),0,true);
  perform set_config('test.page.activity',activity_id::text,true); perform set_config('test.page.other',other_id::text,true);
  perform set_config('test.page.class',class_id::text,true); perform set_config('test.page.image',image_path,true);
  perform set_config('test.page.draft_image',draft_path,true); perform set_config('test.page.admin',admin_id::text,true);
  perform set_config('test.page.parent',parent_id::text,true); perform set_config('test.page.content',page::text,true);
  if has_table_privilege('anon','public.miniapp_activity_page_history','select') or has_table_privilege('authenticated','public.miniapp_activity_page_history','select,insert,update,delete')
    or has_table_privilege('anon','public.miniapp_activity_pages','select') or has_table_privilege('authenticated','public.miniapp_activity_pages','select,insert,update,delete')
    or has_function_privilege('anon','public.save_miniapp_activity_page(text,uuid,jsonb,integer,boolean)','execute') then raise exception 'DIRECT_PAGE_ACCESS'; end if;
end $setup$;

select set_config('request.jwt.claims','{}',true);
set local role anon;
do $public$
declare detail jsonb:=public.miniapp_activity_detail(current_setting('test.page.activity')::uuid); card jsonb;
begin
  if detail#>>'{page,blocks,0,body}'<>'Published copy' or detail#>>'{page,cover}'<>current_setting('test.page.image') then raise exception 'DRAFT_LEAK'; end if;
  if detail->'page' ? 'draft' or detail->'page' ? 'updatedBy' then raise exception 'INTERNAL_FIELDS'; end if;
  select x into card from jsonb_array_elements(public.miniapp_activity_catalog_presentation()) x where x->>'id'=current_setting('test.page.activity');
  if card#>>'{listing,summary}'<>'Published card' or card#>>'{listing,cover}'<>current_setting('test.page.image')
    or card ? 'page' or card ? 'signup' then raise exception 'LISTING_PROJECTION'; end if;
  if public.miniapp_activity_image_path(current_setting('test.page.image'),true)<>replace(current_setting('test.page.image'),'.png','.thumb.png')
    or public.miniapp_activity_image_path(current_setting('test.page.image'),true,true) is not null
    or public.miniapp_activity_image_path(current_setting('test.page.draft_image'),true) is not null then raise exception 'THUMBNAIL_ACCESS'; end if;
  if not public.can_access_miniapp_activity_image(current_setting('test.page.image')) or public.can_access_miniapp_activity_image(current_setting('test.page.draft_image')) then raise exception 'IMAGE_VISIBILITY'; end if;
  if public.can_access_miniapp_activity_image(current_setting('test.page.image'),true) then raise exception 'ANONYMOUS_WRITE'; end if;
  if (select count(*) from storage.objects where bucket_id='miniapp-activity-images' and name in(current_setting('test.page.image'),current_setting('test.page.draft_image')))<>1 then raise exception 'STORAGE_RLS'; end if;
  if public.miniapp_activity_detail(current_setting('test.page.other')::uuid) is not null then raise exception 'UNLISTED_PAGE_VISIBLE'; end if;
  if public.miniapp_activity_detail(current_setting('test.page.class')::uuid)#>>'{page,blocks,0,body}'<>'Published copy' then raise exception 'SHORT_COURSE_PAGE_MISSING'; end if;
end $public$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.page.parent'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $outsider$
begin
  perform pg_temp.expect_activity_page_error(format('select public.miniapp_activity_page_workbench(%L,%L)','activity',current_setting('test.page.activity')),'FORBIDDEN');
  perform pg_temp.expect_activity_page_error(format('select public.restore_miniapp_activity_page(%L,%L,1,2)','activity',current_setting('test.page.activity')),'FORBIDDEN');
  perform pg_temp.expect_activity_page_error(format('select public.save_miniapp_activity_page(%L,%L,%L,2,true)','activity',current_setting('test.page.activity'),current_setting('test.page.content')),'FORBIDDEN');
  perform pg_temp.expect_activity_page_error(format('select public.miniapp_activity_page_workbench(%L,%L)','class',current_setting('test.page.class')),'FORBIDDEN');
  if public.can_access_miniapp_activity_image(current_setting('test.page.draft_image')) then raise exception 'PARENT_READ_DRAFT_IMAGE'; end if;
  perform pg_temp.expect_activity_page_error(format('insert into storage.objects(bucket_id,name) values(%L,%L)','miniapp-activity-images','activity/'||current_setting('test.page.activity')||'/'||gen_random_uuid()||'.png'),'row-level security');
end $outsider$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.page.admin'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $editor$
declare activity_id uuid:=current_setting('test.page.activity')::uuid; page jsonb:=current_setting('test.page.content')::jsonb; state jsonb;
begin
  state:=public.miniapp_activity_page_workbench('activity',activity_id);
  if state#>>'{draft,blocks,0,body}'<>'Private draft' or state->>'revision'<>'2' or state->>'publishedRevision'<>'1' then raise exception 'DRAFT_NOT_SAVED'; end if;
  if not public.can_access_miniapp_activity_image(current_setting('test.page.draft_image')) then raise exception 'STAFF_PREVIEW_DENIED'; end if;
  if public.miniapp_activity_image_path(current_setting('test.page.draft_image'),true,true)<>current_setting('test.page.draft_image') then raise exception 'LEGACY_IMAGE_FALLBACK'; end if;
  perform pg_temp.expect_activity_page_error(format('select public.save_miniapp_activity_page(%L,%L,%L,1,true)','activity',activity_id,page),'FORM_CHANGED');
  perform pg_temp.expect_activity_page_error(format('select public.save_miniapp_activity_page(%L,%L,%L,2,true)','activity',activity_id,jsonb_set(page,'{cover}','"https://outside.invalid/image.png"')),'VALIDATION');
  perform pg_temp.expect_activity_page_error(format('select public.save_miniapp_activity_page(%L,%L,%L,1,true)','activity',current_setting('test.page.other'),page),'VALIDATION');
  perform pg_temp.expect_activity_page_error(format('select public.save_miniapp_activity_page(%L,%L,%L,2,true)','activity',activity_id,jsonb_set(page,'{layout}','null')),'VALIDATION');
  perform public.save_miniapp_activity_page('activity',activity_id,state->'draft',2,true);
  if public.miniapp_activity_detail(activity_id)#>>'{page,blocks,0,body}'<>'Private draft' then raise exception 'PUBLISH_DID_NOT_REPLACE'; end if;
  state:=public.restore_miniapp_activity_page('activity',activity_id,1,3);
  if state#>>'{draft,blocks,0,body}'<>'Published copy' or state->>'revision'<>'4' or state->>'publishedRevision'<>'3'
    or jsonb_array_length(state->'history')<>2 or public.miniapp_activity_detail(activity_id)#>>'{page,blocks,0,body}'<>'Private draft' then raise exception 'RESTORE_CHANGED_PUBLICATION'; end if;
  perform pg_temp.expect_activity_page_error(format('select public.restore_miniapp_activity_page(%L,%L,1,3)','activity',activity_id),'FORM_CHANGED');
  perform pg_temp.expect_activity_page_error(format('select public.save_miniapp_activity_page(%L,%L,%L,4,true)','activity',activity_id,
    jsonb_set(page,'{listing,cover}','"https://outside.invalid/image.png"')),'VALIDATION');
  perform public.save_miniapp_activity_page('activity',activity_id,state->'draft',4,true);
end $editor$;
reset role;

update public.miniapp_activity_publications set enabled=false where activity_id=current_setting('test.page.activity')::uuid;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $hidden$
begin
  if public.miniapp_activity_detail(current_setting('test.page.activity')::uuid) is not null
    or public.can_access_miniapp_activity_image(current_setting('test.page.draft_image'))
    or public.miniapp_activity_image_path(current_setting('test.page.image'),true) is not null
    or exists(select 1 from jsonb_array_elements(public.miniapp_activity_catalog_presentation()) x where x->>'id'=current_setting('test.page.activity')) then raise exception 'DISABLED_PAGE_VISIBLE'; end if;
end $hidden$;
reset role;
