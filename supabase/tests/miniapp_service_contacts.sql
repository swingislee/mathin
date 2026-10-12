-- Fixed development identities, synthetic assets and contacts; caller rolls back everything.
create function pg_temp.expect_contact_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then if sqlerrm like '%'||expected||'%' then return; end if; raise exception 'EXPECTED_%,GOT_%',expected,sqlerrm; end;
  raise exception 'EXPECTED_ERROR_%',expected;
end $$;
do $setup$
declare admin_id uuid; parent_id uuid; cfg jsonb; c jsonb; image text:=gen_random_uuid()||'.webp'; old_image text:='1/'||gen_random_uuid()||'.png';
  campus uuid; rev integer;
begin
  select id into admin_id from auth.users where email='test-admin@mathin.local';
  select id into parent_id from auth.users where email='test-parent@mathin.local';
  if not exists(select 1 from profiles where id=admin_id and purpose='test' and role='admin') or not exists(select 1 from profiles where id=parent_id and purpose='test') then raise exception 'FIXED_DEVELOPMENT_IDENTITIES_REQUIRED'; end if;
  select id into campus from campuses order by id limit 1;
  if campus is null then raise exception 'DEVELOPMENT_CAMPUS_REQUIRED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  insert into storage.objects(bucket_id,name) values('miniapp-content-images',image),('parent-advisor-qrcodes',old_image);
  cfg:=jsonb_build_object('version',1,'brand',jsonb_build_object('name',jsonb_build_object('zh','测试','en','Test'),'introduction',jsonb_build_object('zh','','en',''),'image','','theme','paper'),
    'home','[]'::jsonb,'floating','[]'::jsonb,'accountGroups','[]'::jsonb,'stages',jsonb_build_array(jsonb_build_object('id','all','label',jsonb_build_object('zh','阶段','en','Stages'),
    'stages',(select jsonb_agg(jsonb_build_object('id',case when n<1 then 'k'||(n+3)::text else 'g'||n::text end,'stageNumber',n,'label',jsonb_build_object('zh',n::text,'en',n::text),'visible',true)) from generate_series(-1,12) n))));
  rev:=(public.miniapp_settings_workbench()->>'revision')::integer;
  perform public.save_miniapp_settings(cfg,rev,true);
  perform public.save_parent_advisor_contact(1::smallint,'兼容联系人','+1 555 010 0200',old_image,true);
  if not exists(select 1 from jsonb_array_elements(public.miniapp_service_contacts()) v where v->>'qrPath'=old_image) then raise exception 'LEGACY_CONTACT_LOST'; end if;
  c:=jsonb_build_object('id','general','name',jsonb_build_object('zh','默认服务','en','General'),'service',jsonb_build_object('zh','咨询','en','Service'),
    'phone','+1 555 010 0300','qrImage',image,'stageNumbers','[]'::jsonb,'campusId',campus::text,'hours',jsonb_build_object('zh','预约后联系','en','By appointment'),'address',jsonb_build_object('zh','开发测试地址','en','Development fixture'),'visible',true);
  cfg:=cfg||jsonb_build_object('contacts',jsonb_build_array(c,jsonb_set(jsonb_set(jsonb_set(c,'{id}','"specific"'),'{stageNumbers}','[2]'),'{qrImage}',to_jsonb(old_image)),
    jsonb_set(jsonb_set(c,'{id}','"hidden"'),'{visible}','false')));
  perform public.save_miniapp_settings(cfg,rev+1,false);
  if exists(select 1 from jsonb_array_elements(public.miniapp_service_contacts()) v where v->>'id'='general') then raise exception 'CONTACT_DRAFT_LEAK'; end if;
  perform public.save_miniapp_settings(cfg,rev+2,true);
  perform set_config('test.contacts.admin',admin_id::text,true); perform set_config('test.contacts.parent',parent_id::text,true);
  perform set_config('test.contacts.config',cfg::text,true); perform set_config('test.contacts.revision',(rev+3)::text,true);
  perform set_config('test.contacts.image',image,true); perform set_config('test.contacts.legacy_image',old_image,true);
  if (select public from storage.buckets where id='parent-advisor-qrcodes') then raise exception 'QR_BUCKET_PUBLIC'; end if;
end $setup$;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $public$
declare contacts jsonb:=public.miniapp_service_contacts();
begin
  if jsonb_array_length(contacts)<>14 or exists(select 1 from jsonb_array_elements(contacts) v where v->>'id'='hidden') then raise exception 'CONTACT_SCOPE'; end if;
  if not exists(select 1 from jsonb_array_elements(contacts) v where v->>'grade'='2' and v->>'id'='specific')
    or not exists(select 1 from jsonb_array_elements(contacts) v where v->>'grade'='1' and v->>'id'='general') then raise exception 'DEFAULT_STAGE_FALLBACK'; end if;
  if public.miniapp_settings_publication()->'config' ? 'contacts' then raise exception 'CONTACTS_IN_LAYOUT_CACHE'; end if;
  if not public.can_access_miniapp_content_image(current_setting('test.contacts.image')) or not public.can_access_miniapp_advisor_qr(current_setting('test.contacts.legacy_image'))
    or public.can_access_miniapp_advisor_qr(current_setting('test.contacts.legacy_image'),true) then raise exception 'PUBLISHED_QR_ACCESS'; end if;
  if (select count(*) from storage.objects where bucket_id='parent-advisor-qrcodes' and name=current_setting('test.contacts.legacy_image'))<>1 then raise exception 'LEGACY_QR_RLS'; end if;
end $public$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.contacts.parent'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $parent$ begin
  perform pg_temp.expect_contact_error('select public.miniapp_contact_campuses()','FORBIDDEN');
  perform pg_temp.expect_contact_error(format('select public.save_miniapp_settings(%L,%s,true)',current_setting('test.contacts.config'),current_setting('test.contacts.revision')),'FORBIDDEN');
end $parent$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.contacts.admin'),'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $staff$
declare cfg jsonb:=current_setting('test.contacts.config')::jsonb; rev integer:=current_setting('test.contacts.revision')::integer;
begin
  perform pg_temp.expect_contact_error(format('select public.save_miniapp_settings(%L,%s,true)',jsonb_set(cfg,'{contacts,0,stageNumbers}','[99]'),rev),'VALIDATION');
  perform pg_temp.expect_contact_error(format('select public.save_miniapp_settings(%L,%s,true)',jsonb_set(cfg,'{contacts,0,campusId}',to_jsonb(gen_random_uuid()::text)),rev),'VALIDATION');
  perform pg_temp.expect_contact_error(format('select public.save_miniapp_settings(%L,%s,true)',jsonb_set(cfg,'{contacts,0,qrImage}',to_jsonb(gen_random_uuid()||'.webp')),rev),'VALIDATION');
  perform public.save_miniapp_settings(jsonb_set(cfg,'{contacts}','[]'),rev,true);
end $staff$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $withdrawn$ begin
  if public.miniapp_service_contacts()<>'[]' or public.can_access_miniapp_content_image(current_setting('test.contacts.image'))
    or public.can_access_miniapp_advisor_qr(current_setting('test.contacts.legacy_image')) then raise exception 'WITHDRAWN_CONTACT_OR_QR_VISIBLE'; end if;
  if exists(select 1 from storage.objects where bucket_id='parent-advisor-qrcodes' and name=current_setting('test.contacts.legacy_image')) then raise exception 'WITHDRAWN_QR_RLS'; end if;
end $withdrawn$;
reset role;
