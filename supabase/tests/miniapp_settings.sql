-- Only run against the identified development database, inside a rollback transaction.
create function pg_temp.expect_settings_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm like '%'||expected||'%' then return; end if;
    raise exception 'EXPECTED_%,GOT_%',expected,sqlerrm;
  end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $setup$
declare admin_id uuid; parent_id uuid; config jsonb; image text:=gen_random_uuid()||'.webp'; draft_image text:=gen_random_uuid()||'.webp'; r integer;
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select id into parent_id from auth.users where email='test-parent@mathin.local';
  if admin_id is null or parent_id is null or not exists(select 1 from profiles where id=admin_id and purpose='test' and role='admin') then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  config:=jsonb_build_object('version',1,'brand',jsonb_build_object('name',jsonb_build_object('zh','公开品牌','en','Published brand'),
    'introduction',jsonb_build_object('zh','','en',''),'image',image,'theme','paper'),'home','[]'::jsonb,'floating','[]'::jsonb,'accountGroups','[]'::jsonb,
    'stages',jsonb_build_array(jsonb_build_object('id','stages','label',jsonb_build_object('zh','阶段','en','Stages'),
      'stages',(select jsonb_agg(jsonb_build_object('id',case when n<1 then 'k'||(n+3)::text else 'g'||n::text end,
        'stageNumber',n,'label',jsonb_build_object('zh',n::text,'en',n::text),'visible',true)) from generate_series(-1,12) n))));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  insert into storage.objects(bucket_id,name) values('miniapp-content-images',image),('miniapp-content-images',replace(image,'.webp','.thumb.webp')),('miniapp-content-images',draft_image);
  r:=(public.miniapp_settings_workbench()->>'revision')::integer;
  perform public.save_miniapp_settings(config,r,true);
  perform public.save_miniapp_settings(jsonb_set(jsonb_set(config,'{brand,name,zh}','"秘密草稿"'),'{brand,image}',to_jsonb(draft_image)),r+1,false);
  perform set_config('test.settings.revision',(r+2)::text,true); perform set_config('test.settings.published_revision',(r+1)::text,true);
  perform set_config('test.settings.config',config::text,true); perform set_config('test.settings.admin',admin_id::text,true);
  perform set_config('test.settings.parent',parent_id::text,true); perform set_config('test.settings.image',image,true); perform set_config('test.settings.draft_image',draft_image,true);
  if has_table_privilege('anon','public.miniapp_settings','select') or has_table_privilege('authenticated','public.miniapp_settings','select,insert,update,delete')
    or has_table_privilege('anon','public.miniapp_settings_history','select') or has_function_privilege('anon','public.save_miniapp_settings(jsonb,integer,boolean)','execute') then raise exception 'DIRECT_SETTINGS_ACCESS'; end if;
end $setup$;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $public$
begin
  if public.miniapp_settings_publication()#>>'{config,brand,name,zh}'<>'公开品牌' then raise exception 'DRAFT_LEAK'; end if;
  if not public.can_access_miniapp_content_image(current_setting('test.settings.image'))
    or not public.can_access_miniapp_content_image(replace(current_setting('test.settings.image'),'.webp','.thumb.webp'))
    or public.can_access_miniapp_content_image(current_setting('test.settings.draft_image'))
    or public.can_access_miniapp_content_image(current_setting('test.settings.image'),true) then raise exception 'IMAGE_VISIBILITY'; end if;
  if (select count(*) from storage.objects where bucket_id='miniapp-content-images' and name in(current_setting('test.settings.image'),current_setting('test.settings.draft_image')))<>1 then raise exception 'STORAGE_RLS'; end if;
end $public$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.settings.parent'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $parent$
begin
  perform pg_temp.expect_settings_error('select public.miniapp_settings_workbench()','FORBIDDEN');
  perform pg_temp.expect_settings_error(format('select public.save_miniapp_settings(%L,%s,true)',current_setting('test.settings.config'),current_setting('test.settings.revision')),'FORBIDDEN');
  perform pg_temp.expect_settings_error(format('select public.restore_miniapp_settings(%s,%s)',current_setting('test.settings.published_revision'),current_setting('test.settings.revision')),'FORBIDDEN');
  perform pg_temp.expect_settings_error(format('insert into storage.objects(bucket_id,name) values(%L,%L)','miniapp-content-images',gen_random_uuid()||'.webp'),'row-level security');
end $parent$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.settings.admin'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $admin$
declare r integer:=current_setting('test.settings.revision')::integer; config jsonb:=current_setting('test.settings.config')::jsonb; restored jsonb;
begin
  perform pg_temp.expect_settings_error(format('select public.save_miniapp_settings(%L,%s,true)',config,r-1),'FORM_CHANGED');
  perform pg_temp.expect_settings_error(format('select public.save_miniapp_settings(%L,%s,true)',jsonb_set(config,'{stages,0,stages,0,stageNumber}','99'),r),'VALIDATION');
  perform pg_temp.expect_settings_error(format('select public.save_miniapp_settings(%L,%s,true)',jsonb_set(config,'{brand,image}','"https://outside.invalid/image.png"'),r),'VALIDATION');
  perform pg_temp.expect_settings_error(format('select public.save_miniapp_settings(%L,%s,true)',jsonb_set(config,'{brand,name}','null'),r),'VALIDATION');
  restored:=public.restore_miniapp_settings(current_setting('test.settings.published_revision')::integer,r);
  if restored#>>'{draft,brand,name,zh}'<>'公开品牌' or (restored->>'revision')::integer<>r+1
    or (public.miniapp_settings_publication()->>'revision')::integer<>r-1 then raise exception 'RESTORE_MUST_NOT_PUBLISH'; end if;
  perform public.save_miniapp_settings(jsonb_set(config,'{brand,image}','""'),r+1,true);
end $admin$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $withdrawn$ begin
  if public.can_access_miniapp_content_image(current_setting('test.settings.image')) then raise exception 'WITHDRAWN_IMAGE_VISIBLE'; end if;
end $withdrawn$;
reset role;
