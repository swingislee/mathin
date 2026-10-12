begin;

create function mathin_internal.miniapp_text_valid(p jsonb, n integer) returns boolean
language sql immutable set search_path=public,pg_temp as $$
  select coalesce(jsonb_typeof(p)='object' and p ?& array['zh','en']
    and not exists(select 1 from jsonb_object_keys(p) k where k not in ('zh','en'))
    and jsonb_typeof(p->'zh')='string' and jsonb_typeof(p->'en')='string'
    and char_length(p->>'zh')<=n and char_length(p->>'en')<=n,false);
$$;
create function mathin_internal.valid_miniapp_settings(p jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare b jsonb; g jsonb; e jsonb; s jsonb; nums integer[]:='{}'; ids text[]; all_ids text[]:='{}'; n integer;
  actions text[]:=array['none','assessment','activities','applications','service','agenda','calendar','reflections','records','participants','register','guardian','account','privacy','document'];
begin
  if p is null or jsonb_typeof(p)<>'object' or p->'version' is distinct from '1'::jsonb or octet_length(p::text)>65536
    or not(p ?& array['version','brand','home','floating','accountGroups','stages'])
    or exists(select 1 from jsonb_object_keys(p) k where k not in ('version','brand','home','floating','accountGroups','stages')) then return false; end if;
  b:=p->'brand';
  if jsonb_typeof(b) is distinct from 'object' or not coalesce(b ?& array['name','introduction','image','theme'],false)
    or not mathin_internal.miniapp_text_valid(b->'name',60) or not mathin_internal.miniapp_text_valid(b->'introduction',500)
    or jsonb_typeof(b->'image') is distinct from 'string' or not coalesce(b->>'theme'=any(array['paper','leaf','rose']),false)
    or exists(select 1 from jsonb_object_keys(b) k where k not in ('name','introduction','image','theme')) then return false; end if;
  if jsonb_typeof(p->'home')<>'array' or jsonb_typeof(p->'floating')<>'array'
    or jsonb_typeof(p->'accountGroups')<>'array' or jsonb_typeof(p->'stages')<>'array' then return false; end if;
  if jsonb_array_length(p->'home')>12 or jsonb_array_length(p->'floating')>5 or jsonb_array_length(p->'accountGroups')>8
    or jsonb_array_length(p->'stages') not between 1 and 14 then return false; end if;
  ids:='{}';
  for b in select value from jsonb_array_elements(p->'home') loop
    if jsonb_typeof(b)<>'object' or not (b ?& array['id','type','visible','title','body','image','action','target','limit','featuredIds'])
      or not coalesce(b->>'id' ~ '^[a-zA-Z0-9_-]{1,64}$',false) or b->>'id'=any(ids)
      or not coalesce(b->>'type'=any(array['feature','activities','text','image']),false)
      or jsonb_typeof(b->'visible') is distinct from 'boolean' or not mathin_internal.miniapp_text_valid(b->'title',120)
      or not mathin_internal.miniapp_text_valid(b->'body',2000) or jsonb_typeof(b->'image') is distinct from 'string'
      or not coalesce(b->>'action'=any(actions),false) or not coalesce(b->>'target' ~ '^[a-zA-Z0-9_-]{0,64}$',false)
      or not coalesce(b->>'limit' ~ '^([1-9]|1[0-2])$',false) or jsonb_typeof(b->'featuredIds') is distinct from 'array'
      or exists(select 1 from jsonb_object_keys(b) k where k not in ('id','type','visible','title','body','image','action','target','limit','featuredIds')) then return false; end if;
    if jsonb_array_length(b->'featuredIds')>30 or exists(select 1 from jsonb_array_elements_text(b->'featuredIds') v
      where v !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then return false; end if;
    ids:=array_append(ids,b->>'id');
  end loop;
  for g in select value from jsonb_array_elements(p->'accountGroups') loop
    if jsonb_typeof(g)<>'object' or not (g ?& array['id','title','entries']) or not coalesce(g->>'id' ~ '^[a-zA-Z0-9_-]{1,64}$',false)
      or g->>'id'=any(all_ids) or not mathin_internal.miniapp_text_valid(g->'title',60) or jsonb_typeof(g->'entries') is distinct from 'array'
      or exists(select 1 from jsonb_object_keys(g) k where k not in ('id','title','entries')) then return false; end if;
    if jsonb_array_length(g->'entries')>20 then return false; end if;
    all_ids:=array_append(all_ids,g->>'id');
  end loop;
  for g in select p->'floating' union all select value->'entries' from jsonb_array_elements(p->'accountGroups') loop
    ids:='{}';
    for e in select value from jsonb_array_elements(g) loop
      if jsonb_typeof(e)<>'object' or not (e ?& array['id','title','action','target','icon','visible','audience'])
        or not coalesce(e->>'id' ~ '^[a-zA-Z0-9_-]{1,64}$',false) or e->>'id'=any(ids)
        or not mathin_internal.miniapp_text_valid(e->'title',60) or not coalesce(e->>'action'=any(actions),false)
        or not coalesce(e->>'target' ~ '^[a-zA-Z0-9_-]{0,64}$',false)
        or not coalesce(e->>'icon'=any(array['activity','calendar','book','report','task','participants','form','account','privacy','reservations','complete','ticket']),false)
        or jsonb_typeof(e->'visible') is distinct from 'boolean' or not coalesce(e->>'audience'=any(array['all','signedIn','participants']),false)
        or exists(select 1 from jsonb_object_keys(e) k where k not in ('id','title','action','target','icon','visible','audience')) then return false; end if;
      ids:=array_append(ids,e->>'id');
    end loop;
  end loop;
  ids:='{}';
  for g in select value from jsonb_array_elements(p->'stages') loop
    if jsonb_typeof(g)<>'object' or not (g ?& array['id','label','stages']) or not coalesce(g->>'id' ~ '^[a-zA-Z0-9_-]{1,64}$',false)
      or g->>'id'=any(ids) or not mathin_internal.miniapp_text_valid(g->'label',60) or jsonb_typeof(g->'stages') is distinct from 'array'
      or exists(select 1 from jsonb_object_keys(g) k where k not in ('id','label','stages')) then return false; end if;
    ids:=array_append(ids,g->>'id');
    for s in select value from jsonb_array_elements(g->'stages') loop
      if jsonb_typeof(s)<>'object' or not (s ?& array['id','stageNumber','label','visible'])
        or not coalesce(s->>'stageNumber' ~ '^(-1|[0-9]|1[0-2])$',false) or not mathin_internal.miniapp_text_valid(s->'label',60)
        or jsonb_typeof(s->'visible') is distinct from 'boolean'
        or exists(select 1 from jsonb_object_keys(s) k where k not in ('id','stageNumber','label','visible')) then return false; end if;
      n:=(s->>'stageNumber')::integer;
      if n=any(nums) or s->>'id' is distinct from (case when n<1 then 'k'||(n+3)::text else 'g'||n::text end) then return false; end if;
      nums:=array_append(nums,n);
    end loop;
  end loop;
  return cardinality(nums)=14 and not exists(select 1 from (select p->'brand'->>'image' as path union all
    select value->>'image' from jsonb_array_elements(p->'home')) images where path<>''
    and path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$');
exception when others then return false;
end $$;
revoke all on function mathin_internal.miniapp_text_valid(jsonb,integer),mathin_internal.valid_miniapp_settings(jsonb) from public,anon,authenticated;

create table public.miniapp_settings (
  singleton boolean primary key default true check(singleton),
  draft jsonb not null check(mathin_internal.valid_miniapp_settings(draft)),
  published jsonb check(published is null or mathin_internal.valid_miniapp_settings(published)),
  revision integer not null check(revision>0), published_revision integer, published_at timestamptz,
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
create table public.miniapp_settings_history (
  revision integer primary key, config jsonb not null check(mathin_internal.valid_miniapp_settings(config)),
  published_at timestamptz not null default now(), published_by uuid references public.profiles(id)
);
alter table public.miniapp_settings enable row level security;
alter table public.miniapp_settings_history enable row level security;
revoke all on public.miniapp_settings,public.miniapp_settings_history from public,anon,authenticated;

create function public.miniapp_settings_workbench() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.miniapp_settings;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  select * into r from miniapp_settings where singleton;
  return jsonb_build_object('draft',r.draft,'revision',coalesce(r.revision,0),'publishedRevision',r.published_revision,'publishedAt',r.published_at,
    'history',coalesce((select jsonb_agg(jsonb_build_object('revision',h.revision,'publishedAt',h.published_at) order by h.revision desc)
      from (select revision,published_at from miniapp_settings_history order by revision desc limit 50) h),'[]'::jsonb));
end $$;
create function public.save_miniapp_settings(p_config jsonb,p_revision integer,p_publish boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_settings; path text;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if p_revision is null or p_revision<0 or p_publish is null or not mathin_internal.valid_miniapp_settings(p_config) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-settings',914));
  select * into r from miniapp_settings where singleton for update;
  if p_revision is distinct from coalesce(r.revision,0) then raise exception 'FORM_CHANGED'; end if;
  for path in select p_config->'brand'->>'image' union all select value->>'image' from jsonb_array_elements(p_config->'home') loop
    if path<>'' and not exists(select 1 from storage.objects where bucket_id='miniapp-content-images' and name=path) then raise exception 'VALIDATION'; end if;
  end loop;
  insert into miniapp_settings(singleton,draft,published,revision,published_revision,published_at,updated_by)
    values(true,p_config,case when p_publish then p_config end,1,case when p_publish then 1 end,case when p_publish then now() end,auth.uid())
    on conflict(singleton) do update set draft=p_config,revision=miniapp_settings.revision+1,
      published=case when p_publish then p_config else miniapp_settings.published end,
      published_revision=case when p_publish then miniapp_settings.revision+1 else miniapp_settings.published_revision end,
      published_at=case when p_publish then now() else miniapp_settings.published_at end,updated_at=now(),updated_by=auth.uid();
  if p_publish then
    insert into miniapp_settings_history(revision,config,published_by)
      select revision,published,auth.uid() from miniapp_settings where singleton;
  end if;
  return public.miniapp_settings_workbench();
end $$;
create function public.restore_miniapp_settings(p_source_revision integer,p_revision integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare config jsonb;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  select h.config into config from miniapp_settings_history h where revision=p_source_revision;
  if config is null then raise exception 'NOT_FOUND'; end if;
  -- Restoring makes a new draft. The operator can preview it before publishing.
  return public.save_miniapp_settings(config,p_revision,false);
end $$;
create function public.miniapp_settings_publication() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select jsonb_build_object('revision',coalesce(published_revision,0),'publishedAt',published_at,'config',published)
    from miniapp_settings where singleton),jsonb_build_object('revision',0,'publishedAt',null,'config',null));
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('miniapp-content-images','miniapp-content-images',false,2097152,array['image/webp']);
create function public.can_access_miniapp_content_image(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare base text; config jsonb;
begin
  if p_path is null or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.thumb)?\.webp$' then return false; end if;
  if coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then return true; end if;
  if p_write is distinct from false then return false; end if;
  base:=replace(p_path,'.thumb.webp','.webp');
  select published into config from miniapp_settings where singleton;
  return coalesce(config->'brand'->>'image'=base or exists(select 1 from jsonb_array_elements(config->'home') b
    where b->'visible'='true'::jsonb and b->>'image'=base),false);
end $$;
create policy miniapp_content_images_insert on storage.objects for insert to authenticated
  with check(bucket_id='miniapp-content-images' and public.can_access_miniapp_content_image(name,true));
create policy miniapp_content_images_select on storage.objects for select to anon,authenticated
  using(bucket_id='miniapp-content-images' and public.can_access_miniapp_content_image(name,false));

revoke all on function public.miniapp_settings_workbench(),public.save_miniapp_settings(jsonb,integer,boolean),public.restore_miniapp_settings(integer,integer),
  public.miniapp_settings_publication(),public.can_access_miniapp_content_image(text,boolean) from public,anon,authenticated;
grant execute on function public.miniapp_settings_workbench(),public.save_miniapp_settings(jsonb,integer,boolean),public.restore_miniapp_settings(integer,integer) to authenticated;
grant execute on function public.miniapp_settings_publication(),public.can_access_miniapp_content_image(text,boolean) to anon,authenticated;
notify pgrst,'reload schema';
commit;
