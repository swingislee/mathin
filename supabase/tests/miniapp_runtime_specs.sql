-- Intended for one rollback transaction in the identified development database.
create function pg_temp.expect_runtime_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise exception 'EXPECTED_%,GOT_%',expected,sqlerrm; end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $check$
#variable_conflict use_variable
declare actor uuid; parent_id uuid; spec jsonb; draft_spec jsonb; bench jsonb; rev integer; published jsonb; image text:=gen_random_uuid()::text||'.webp';
begin
  select id into actor from profiles where purpose='test' and id=(select id from auth.users where email='test-admin@mathin.local');
  select id into parent_id from profiles where purpose='test' and id=(select id from auth.users where email='test-parent@mathin.local');
  if actor is null or parent_id is null then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  spec:=jsonb_build_object('version',1,
    'tabs',jsonb_build_array(jsonb_build_object('slot',1,'screen','home','label',jsonb_build_object('zh','发现','en','Discover'),'icon','discover'),
      jsonb_build_object('slot',3,'screen','home','label',jsonb_build_object('zh','我的','en','Account'),'icon','account')),
    'screens',jsonb_build_array(jsonb_build_object('id','home','title',jsonb_build_object('zh','首页','en','Home'),'navigation','title',
      'blocks',jsonb_build_array(jsonb_build_object('id','hero','type','image','image',image,'fit','width')))));

  -- Visitors and family accounts cannot read or change drafts.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',parent_id,'role','authenticated','aal','aal1')::text,true);
  perform pg_temp.expect_runtime_error('select public.miniapp_runtime_workbench()','FORBIDDEN');
  perform pg_temp.expect_runtime_error(format('select public.save_miniapp_runtime(%L::jsonb,0,true)',spec),'FORBIDDEN');

  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  bench:=public.miniapp_runtime_workbench(); rev:=(bench->>'revision')::integer;
  perform pg_temp.expect_runtime_error(format('select public.save_miniapp_runtime(%L::jsonb,%s,false)',spec||'{"script":"x"}'::jsonb,rev),'VALIDATION');
  perform pg_temp.expect_runtime_error(format('select public.save_miniapp_runtime(%L::jsonb,%s,false)',jsonb_set(spec,'{tabs}','[]'),rev),'VALIDATION');
  -- An image path must exist in the content bucket before it can be saved.
  perform pg_temp.expect_runtime_error(format('select public.save_miniapp_runtime(%L::jsonb,%s,false)',spec,rev),'VALIDATION');
  insert into storage.objects(bucket_id,name,owner) values('miniapp-content-images',image,actor);
  perform pg_temp.expect_runtime_error(format('select public.save_miniapp_runtime(%L::jsonb,%s,false)',spec,rev+5),'FORM_CHANGED');

  published:=public.miniapp_runtime_publication();
  bench:=public.save_miniapp_runtime(spec,rev,false);
  if public.miniapp_runtime_publication() is distinct from published then raise exception 'DRAFT_WAS_PUBLISHED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('role','anon')::text,true);
  if public.can_access_miniapp_content_image(image,false) then raise exception 'DRAFT_IMAGE_PUBLIC'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  bench:=public.save_miniapp_runtime(spec,(bench->>'revision')::integer,true);
  if (public.miniapp_runtime_publication()->>'revision')::integer<>(bench->>'publishedRevision')::integer
    or public.miniapp_runtime_publication()->'spec'<>spec then raise exception 'PUBLICATION_MISMATCH'; end if;
  if not exists(select 1 from miniapp_runtime_history h where h.revision=(bench->>'publishedRevision')::integer and h.spec=spec::jsonb) then raise exception 'HISTORY_MISSING'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('role','anon')::text,true);
  if not public.can_access_miniapp_content_image(image,false) or not public.can_access_miniapp_content_image(replace(image,'.webp','.thumb.webp'),false) then raise exception 'PUBLISHED_IMAGE_HIDDEN'; end if;
  if public.can_access_miniapp_content_image(image,true) then raise exception 'ANON_IMAGE_WRITE'; end if;

  -- A newer draft does not change what clients read; restoring history only creates a draft.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2')::text,true);
  draft_spec:=jsonb_set(spec,'{screens,0,title,zh}','"草稿"');
  bench:=public.save_miniapp_runtime(draft_spec,(bench->>'revision')::integer,false);
  if public.miniapp_runtime_publication()->'spec'<>spec then raise exception 'DRAFT_CHANGED_PUBLICATION'; end if;
  bench:=public.restore_miniapp_runtime((bench->>'publishedRevision')::integer,(bench->>'revision')::integer);
  if bench->'draft'<>spec or public.miniapp_runtime_publication()->'spec'<>spec then raise exception 'RESTORE_MISMATCH'; end if;
end $check$;
