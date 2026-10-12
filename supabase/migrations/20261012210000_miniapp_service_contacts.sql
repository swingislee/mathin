begin;

do $copy$ begin
  execute replace(pg_get_functiondef('mathin_internal.valid_miniapp_settings(jsonb)'::regprocedure),
    'mathin_internal.valid_miniapp_settings(', 'mathin_internal.valid_miniapp_settings_before_contacts(');
  execute replace(replace(pg_get_functiondef('public.save_miniapp_settings(jsonb,integer,boolean)'::regprocedure),
    'public.save_miniapp_settings(', 'mathin_internal.save_miniapp_settings_before_contacts('),'CREATE OR REPLACE FUNCTION','CREATE FUNCTION');
end $copy$;
create function mathin_internal.valid_miniapp_contacts(p jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare c jsonb; ids text[]:='{}';
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p)>40 then return false; end if;
  for c in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(c) is distinct from 'object' or not(c ?& array['id','name','service','phone','qrImage','stageNumbers','campusId','hours','address','visible'])
      or c-array['id','name','service','phone','qrImage','stageNumbers','campusId','hours','address','visible']<>'{}'
      or not coalesce(c->>'id' ~ '^[a-zA-Z0-9_-]{1,64}$',false) or c->>'id'=any(ids)
      or not mathin_internal.miniapp_text_valid(c->'name',60) or not mathin_internal.miniapp_text_valid(c->'service',120)
      or not mathin_internal.miniapp_text_valid(c->'hours',500) or not mathin_internal.miniapp_text_valid(c->'address',500)
      or jsonb_typeof(c->'phone') is distinct from 'string' or c->>'phone' !~ '^(|\+?[0-9][0-9 -]{5,23})$'
      or jsonb_typeof(c->'qrImage') is distinct from 'string'
      or c->>'qrImage' !~ '^(|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp|-?[0-9]{1,2}/[0-9a-f-]{36}\.(png|jpg|webp))$'
      or jsonb_typeof(c->'campusId') is distinct from 'string' or c->>'campusId' !~ '^(|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
      or jsonb_typeof(c->'visible') is distinct from 'boolean' or jsonb_typeof(c->'stageNumbers') is distinct from 'array'
      or (c->'visible'='true' and c->>'phone'='' and c->>'qrImage'='') then return false; end if;
    if jsonb_array_length(c->'stageNumbers')>14
      or exists(select 1 from jsonb_array_elements(c->'stageNumbers') v where jsonb_typeof(v)<>'number' or v::text !~ '^(-1|[0-9]|1[0-2])$')
      or jsonb_array_length(c->'stageNumbers')<>(select count(distinct v) from jsonb_array_elements(c->'stageNumbers') v) then return false; end if;
    ids:=array_append(ids,c->>'id');
  end loop;
  return true;
exception when others then return false;
end $$;
create or replace function mathin_internal.valid_miniapp_settings(p jsonb) returns boolean
language sql immutable security definer set search_path=public,pg_temp as $$
  select mathin_internal.valid_miniapp_settings_before_contacts(p-'contacts')
    and (not(p ? 'contacts') or mathin_internal.valid_miniapp_contacts(p->'contacts')) and octet_length(p::text)<=65536;
$$;
create or replace function public.save_miniapp_settings(p_config jsonb,p_revision integer,p_publish boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb; path text;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if not mathin_internal.valid_miniapp_settings(p_config) then raise exception 'VALIDATION'; end if;
  for c in select value from jsonb_array_elements(coalesce(p_config->'contacts','[]')) loop
    if c->>'campusId'<>'' and not exists(select 1 from campuses where id=(c->>'campusId')::uuid) then raise exception 'VALIDATION'; end if;
    path:=c->>'qrImage';
    if path<>'' and not exists(select 1 from storage.objects where name=path
      and bucket_id=case when strpos(path,'/')>0 then 'parent-advisor-qrcodes' else 'miniapp-content-images' end) then raise exception 'VALIDATION'; end if;
  end loop;
  return mathin_internal.save_miniapp_settings_before_contacts(p_config,p_revision,p_publish);
end $$;
-- Contact details are obtained through the visibility-filtered directory, not the layout cache.
create or replace function public.miniapp_settings_publication() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select jsonb_build_object('revision',coalesce(published_revision,0),'publishedAt',published_at,'config',published-'contacts')
    from miniapp_settings where singleton),jsonb_build_object('revision',0,'publishedAt',null,'config',null));
$$;
create function public.miniapp_service_contacts() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare config jsonb;
begin
  select published into config from miniapp_settings where singleton;
  if config ? 'contacts' then
    return (with contacts as (select value c,ordinality pos from jsonb_array_elements(config->'contacts') with ordinality where value->'visible'='true')
      select coalesce(jsonb_agg(jsonb_build_object('id',c->>'id','grade',n,'teacherName',coalesce(nullif(c#>>'{name,zh}',''),c#>>'{name,en}'),
        'name',c->'name','service',c->'service','phone',c->>'phone','qrPath',c->>'qrImage','campusId',c->>'campusId',
        'campusName',coalesce((select name from campuses where id=nullif(c->>'campusId','')::uuid),''),'hours',c->'hours','address',c->'address') order by n,pos),'[]')
      from contacts cross join generate_series(-1,12) n where (c->'stageNumbers' @> to_jsonb(array[n])
        or (c->'stageNumbers'='[]' and not exists(select 1 from contacts specific where specific.c->>'campusId'=c->>'campusId' and specific.c->'stageNumbers' @> to_jsonb(array[n])))));
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id','legacy-'||grade,'grade',grade,'teacherName',teacher_name,'phone',phone,'qrPath',qr_path) order by grade),'[]') from parent_advisor_contacts where enabled);
end $$;
create or replace function public.miniapp_advisor_contacts() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select public.miniapp_service_contacts();
$$;
create function public.miniapp_contact_campuses() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from campuses);
end $$;
create or replace function public.can_access_miniapp_content_image(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare base text; config jsonb;
begin
  if p_path is null or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.thumb)?\.webp$' then return false; end if;
  if coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then return true; end if;
  if p_write is distinct from false then return false; end if;
  base:=replace(p_path,'.thumb.webp','.webp'); select published into config from miniapp_settings where singleton;
  return coalesce(config->'brand'->>'image'=base or exists(select 1 from jsonb_array_elements(config->'home') b where b->'visible'='true' and b->>'image'=base)
    or exists(select 1 from jsonb_array_elements(config->'contacts') c where c->'visible'='true' and c->>'qrImage'=base),false);
end $$;
create function public.can_access_miniapp_advisor_qr(p_path text,p_preview boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare config jsonb;
begin
  if p_path is null or p_path !~ '^-?[0-9]{1,2}/[0-9a-f-]{36}\.(png|jpg|webp)$' then return false; end if;
  if coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then return true; end if;
  if p_preview is distinct from false then return false; end if;
  select published into config from miniapp_settings where singleton;
  if config ? 'contacts' then return exists(select 1 from jsonb_array_elements(config->'contacts') c where c->'visible'='true' and c->>'qrImage'=p_path); end if;
  return exists(select 1 from parent_advisor_contacts where qr_path=p_path and enabled);
end $$;
update storage.buckets set public=false where id='parent-advisor-qrcodes';
create policy parent_advisor_qr_read on storage.objects for select to anon,authenticated
  using(bucket_id='parent-advisor-qrcodes' and public.can_access_miniapp_advisor_qr(name,false));
revoke all on function mathin_internal.valid_miniapp_settings_before_contacts(jsonb),mathin_internal.valid_miniapp_contacts(jsonb),
  mathin_internal.save_miniapp_settings_before_contacts(jsonb,integer,boolean) from public,anon,authenticated;
revoke all on function public.miniapp_service_contacts(),public.miniapp_contact_campuses(),public.can_access_miniapp_advisor_qr(text,boolean) from public,anon,authenticated;
grant execute on function public.miniapp_service_contacts(),public.can_access_miniapp_advisor_qr(text,boolean) to anon,authenticated;
grant execute on function public.miniapp_service_contacts() to postgres;
grant execute on function public.miniapp_contact_campuses() to authenticated;
notify pgrst,'reload schema';
commit;
