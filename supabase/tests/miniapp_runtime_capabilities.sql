-- Intended for one rollback transaction in the identified development database, after 20261015210000_miniapp_runtime_capabilities.
create function pg_temp.expect_capability_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise exception 'EXPECTED_%,GOT_%',expected,sqlerrm; end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $check$
#variable_conflict use_variable
declare actor uuid; parent_id uuid; event_id uuid:=gen_random_uuid(); result jsonb; form jsonb; spec jsonb; bench jsonb; media text:=gen_random_uuid()::text||'.mp3';
  upload text:=gen_random_uuid()::text; visible integer;
begin
  select id into actor from profiles where purpose='test' and id=(select id from auth.users where email='test-admin@mathin.local');
  select id into parent_id from profiles where purpose='test' and id=(select id from auth.users where email='test-parent@mathin.local');
  if actor is null or parent_id is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;

  -- Web sign-in tickets use their own kind; other kinds stay rejected.
  insert into wechat_oauth_tickets(token_hash,kind,browser_hash,payload,expires_at)
    values(encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),'miniapp_web',encode(extensions.digest('miniapp-web','sha256'),'hex'),'{}',now()+interval '1 minute');
  perform pg_temp.expect_capability_error($$insert into wechat_oauth_tickets(token_hash,kind,browser_hash,payload,expires_at)
    values(encode(extensions.digest('x','sha256'),'hex'),'other',encode(extensions.digest('y','sha256'),'hex'),'{}',now()+interval '1 minute')$$,'wechat_oauth_tickets_kind_check');

  -- Commands: visitors cannot record, retries with the same id are safe, and another command cannot reuse the id.
  perform set_config('request.jwt.claims',jsonb_build_object('role','anon')::text,true);
  perform pg_temp.expect_capability_error(format('select public.miniapp_record_runtime_event(%L,''checkin'',null,''{}'')',event_id),'UNAUTHENTICATED');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  result:=public.miniapp_record_runtime_event(event_id,'checkin',null,'{"title":"今日打卡"}');
  if result->'created'<>'true' then raise exception 'EVENT_NOT_CREATED'; end if;
  result:=public.miniapp_record_runtime_event(event_id,'checkin',null,'{"title":"今日打卡"}');
  if result->'created'<>'false' then raise exception 'EVENT_RETRY_DUPLICATED'; end if;
  perform pg_temp.expect_capability_error(format('select public.miniapp_record_runtime_event(%L,''other'',null,''{}'')',event_id),'CONFLICT');
  perform pg_temp.expect_capability_error(format('select public.miniapp_record_runtime_event(%L,''checkin'',%L,''{}'')',gen_random_uuid(),gen_random_uuid()),'FORBIDDEN');
  perform pg_temp.expect_capability_error(format('update miniapp_runtime_events set payload=''{}'' where id=%L',event_id),'');

  -- Families read only their own records and files.
  insert into miniapp_runtime_events(id,owner_id,command) values(gen_random_uuid(),actor,'checkin');
  insert into miniapp_runtime_uploads(id,owner_id,object_path,name,kind,mime_type,bytes,ready) values(upload::uuid,actor,actor||'/'||upload||'.jpg','a.jpg','image','image/jpeg',10,true);
  execute 'set local role authenticated';
  select count(*) into visible from miniapp_runtime_events where owner_id=actor;
  if visible<>0 then raise exception 'OTHER_EVENTS_VISIBLE'; end if;
  select count(*) into visible from miniapp_runtime_uploads where owner_id=actor;
  if visible<>0 then raise exception 'OTHER_UPLOADS_VISIBLE'; end if;
  select count(*) into visible from miniapp_runtime_events where id=event_id;
  if visible<>1 then raise exception 'OWN_EVENT_HIDDEN'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  execute 'set local role authenticated';
  select count(*) into visible from miniapp_runtime_uploads where id=upload::uuid;
  if visible<>1 then raise exception 'STAFF_UPLOAD_HIDDEN'; end if;
  execute 'reset role';

  -- Form answers: time, rating, address and file references.
  form:=jsonb_build_object('groups',jsonb_build_array(jsonb_build_object('id','g','repeat',false,'minEntries',1,'maxEntries',1,'fields',jsonb_build_array(
    jsonb_build_object('id','t','type','time','required',true,'options','[]'::jsonb),
    jsonb_build_object('id','r','type','rating','required',true,'max',5,'options','[]'::jsonb),
    jsonb_build_object('id','a','type','address','required',false,'options','[]'::jsonb),
    jsonb_build_object('id','m','type','media','required',true,'max',2,'options','[]'::jsonb)))));
  if not mathin_internal.experience_answers_valid(form,jsonb_build_object('g',jsonb_build_array(jsonb_build_object('t','09:30','r','4','a','张三 13800000000 上海市','m',jsonb_build_array(upload))))) then raise exception 'VALID_ANSWERS_REJECTED'; end if;
  if mathin_internal.experience_answers_valid(form,jsonb_build_object('g',jsonb_build_array(jsonb_build_object('t','25:00','r','4','m',jsonb_build_array(upload))))) then raise exception 'BAD_TIME_ACCEPTED'; end if;
  if mathin_internal.experience_answers_valid(form,jsonb_build_object('g',jsonb_build_array(jsonb_build_object('t','09:30','r','6','m',jsonb_build_array(upload))))) then raise exception 'BAD_RATING_ACCEPTED'; end if;
  if mathin_internal.experience_answers_valid(form,jsonb_build_object('g',jsonb_build_array(jsonb_build_object('t','09:30','r','4','m',jsonb_build_array('not-an-id'))))) then raise exception 'BAD_FILE_ACCEPTED'; end if;
  if mathin_internal.experience_answers_valid(form,jsonb_build_object('g',jsonb_build_array(jsonb_build_object('t','09:30','r','4','m',jsonb_build_array(upload,gen_random_uuid()::text,gen_random_uuid()::text))))) then raise exception 'TOO_MANY_FILES_ACCEPTED'; end if;
  if pg_get_functiondef('public.miniapp_submit_experience_request(uuid,text,text,integer,jsonb,uuid[],jsonb)'::regprocedure) not like '%cardinality(p_participant_ids)>1 then raise exception ''VALIDATION''%' then raise exception 'FORM_PARTICIPANT_NOT_RELAXED'; end if;

  -- Published media: saving checks the file exists; visitors read it only after publication.
  spec:=jsonb_build_object('version',1,
    'tabs',jsonb_build_array(jsonb_build_object('slot',1,'screen','home','label',jsonb_build_object('zh','发现','en','Discover'),'icon','discover'),
      jsonb_build_object('slot',3,'screen','home','label',jsonb_build_object('zh','我的','en','Account'),'icon','account')),
    'screens',jsonb_build_array(jsonb_build_object('id','home','title',jsonb_build_object('zh','首页','en','Home'),'navigation','title',
      'blocks',jsonb_build_array(jsonb_build_object('id','listen','type','audio','title',jsonb_build_object('zh','磨耳朵','en','Listen'),'loop',true,
        'tracks',jsonb_build_array(jsonb_build_object('id','t1','title',jsonb_build_object('zh','第一首','en','One'),'subtitle',jsonb_build_object('zh','','en',''),'src',media)))))));
  bench:=public.miniapp_runtime_workbench();
  perform pg_temp.expect_capability_error(format('select public.save_miniapp_runtime(%L::jsonb,%s,false)',spec,bench->>'revision'),'VALIDATION');
  insert into storage.objects(bucket_id,name,owner) values('miniapp-content-media',media,actor);
  if not public.can_access_miniapp_content_media(media,false) then raise exception 'STAFF_MEDIA_HIDDEN'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('role','anon')::text,true);
  if public.can_access_miniapp_content_media(media,false) then raise exception 'DRAFT_MEDIA_PUBLIC'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  bench:=public.save_miniapp_runtime(spec,(bench->>'revision')::integer,true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','anon')::text,true);
  if not public.can_access_miniapp_content_media(media,false) then raise exception 'PUBLISHED_MEDIA_HIDDEN'; end if;
  if public.can_access_miniapp_content_media(media,true) then raise exception 'ANON_MEDIA_WRITE'; end if;
  if public.can_access_miniapp_content_media('../'||media,false) then raise exception 'MEDIA_PATH_ACCEPTED'; end if;
end $check$;
