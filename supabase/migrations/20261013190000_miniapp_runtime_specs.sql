begin;

-- Runtime screens published to Mini Program clients. Mathin validates the full structure before saving;
-- the database keeps the outer shape, size and history so every revision can be read and restored.
create function mathin_internal.valid_miniapp_runtime_spec(p jsonb) returns boolean
language sql immutable set search_path=public,pg_temp as $$
  select coalesce(jsonb_typeof(p)='object' and p->'version'='1'::jsonb
    and jsonb_typeof(p->'tabs')='array' and jsonb_array_length(p->'tabs') between 2 and 5
    and jsonb_typeof(p->'screens')='array' and jsonb_array_length(p->'screens') between 1 and 60
    and not exists(select 1 from jsonb_object_keys(p) k where k not in ('version','tabs','screens'))
    and octet_length(p::text)<=262144,false);
$$;
revoke all on function mathin_internal.valid_miniapp_runtime_spec(jsonb) from public,anon,authenticated;

create table public.miniapp_runtime_specs (
  singleton boolean primary key default true check(singleton),
  draft jsonb not null check(mathin_internal.valid_miniapp_runtime_spec(draft)),
  published jsonb check(published is null or mathin_internal.valid_miniapp_runtime_spec(published)),
  revision integer not null check(revision>0), published_revision integer, published_at timestamptz,
  updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id)
);
create table public.miniapp_runtime_history (
  revision integer primary key, spec jsonb not null check(mathin_internal.valid_miniapp_runtime_spec(spec)),
  published_at timestamptz not null default now(), published_by uuid references public.profiles(id)
);
alter table public.miniapp_runtime_specs enable row level security;
alter table public.miniapp_runtime_history enable row level security;
revoke all on public.miniapp_runtime_specs,public.miniapp_runtime_history from public,anon,authenticated;

create function public.miniapp_runtime_workbench() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.miniapp_runtime_specs;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  select * into r from miniapp_runtime_specs where singleton;
  return jsonb_build_object('draft',r.draft,'revision',coalesce(r.revision,0),'publishedRevision',r.published_revision,'publishedAt',r.published_at,
    'updatedAt',r.updated_at,
    'history',coalesce((select jsonb_agg(jsonb_build_object('revision',h.revision,'publishedAt',h.published_at) order by h.revision desc)
      from (select revision,published_at from miniapp_runtime_history order by revision desc limit 50) h),'[]'::jsonb));
end $$;

create function public.save_miniapp_runtime(p_spec jsonb,p_revision integer,p_publish boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_runtime_specs; path text;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  if p_revision is null or p_revision<0 or p_publish is null or not mathin_internal.valid_miniapp_runtime_spec(p_spec) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-runtime',914));
  select * into r from miniapp_runtime_specs where singleton for update;
  if p_revision is distinct from coalesce(r.revision,0) then raise exception 'FORM_CHANGED'; end if;
  for path in select distinct value #>> '{}' from jsonb_path_query(p_spec,'lax $.**.image') value
      union select distinct value #>> '{}' from jsonb_path_query(p_spec,'lax $.**.icon') value loop
    if path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
      and not exists(select 1 from storage.objects where bucket_id='miniapp-content-images' and name=path) then raise exception 'VALIDATION'; end if;
  end loop;
  insert into miniapp_runtime_specs(singleton,draft,published,revision,published_revision,published_at,updated_by)
    values(true,p_spec,case when p_publish then p_spec end,1,case when p_publish then 1 end,case when p_publish then now() end,auth.uid())
    on conflict(singleton) do update set draft=p_spec,revision=miniapp_runtime_specs.revision+1,
      published=case when p_publish then p_spec else miniapp_runtime_specs.published end,
      published_revision=case when p_publish then miniapp_runtime_specs.revision+1 else miniapp_runtime_specs.published_revision end,
      published_at=case when p_publish then now() else miniapp_runtime_specs.published_at end,updated_at=now(),updated_by=auth.uid();
  if p_publish then
    insert into miniapp_runtime_history(revision,spec,published_by) select revision,published,auth.uid() from miniapp_runtime_specs where singleton;
  end if;
  return public.miniapp_runtime_workbench();
end $$;

create function public.restore_miniapp_runtime(p_source_revision integer,p_revision integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare value jsonb;
begin
  if not coalesce(public.has_perm(auth.uid(),'organization.profile.manage'),false) then raise exception 'FORBIDDEN'; end if;
  select h.spec into value from miniapp_runtime_history h where revision=p_source_revision;
  if value is null then raise exception 'NOT_FOUND'; end if;
  -- Restoring creates a draft; publishing remains a separate, explicit action.
  return public.save_miniapp_runtime(value,p_revision,false);
end $$;

create function public.miniapp_runtime_publication() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select jsonb_build_object('revision',coalesce(published_revision,0),'publishedAt',published_at,'spec',published)
    from miniapp_runtime_specs where singleton),jsonb_build_object('revision',0,'publishedAt',null,'spec',null));
$$;

-- Images placed on published runtime screens become readable with the same caching rules as other published images.
do $copy$ begin
  execute replace(pg_get_functiondef('public.can_access_miniapp_content_image(text,boolean)'::regprocedure),
    'public.can_access_miniapp_content_image(', 'mathin_internal.can_access_miniapp_content_image_before_runtime(');
end $copy$;
create or replace function public.can_access_miniapp_content_image(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare base text;
begin
  if mathin_internal.can_access_miniapp_content_image_before_runtime(p_path,p_write) then return true; end if;
  if p_write is distinct from false or p_path is null or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.thumb)?\.webp$' then return false; end if;
  base:=replace(p_path,'.thumb.webp','.webp');
  return exists(select 1 from miniapp_runtime_specs s where s.singleton and s.published is not null
    and (jsonb_path_exists(s.published,'lax $.**.image ? (@ == $p)',jsonb_build_object('p',base))
      or jsonb_path_exists(s.published,'lax $.**.icon ? (@ == $p)',jsonb_build_object('p',base))));
end $$;
revoke all on function mathin_internal.can_access_miniapp_content_image_before_runtime(text,boolean) from public,anon,authenticated;

revoke all on function public.miniapp_runtime_workbench(),public.save_miniapp_runtime(jsonb,integer,boolean),public.restore_miniapp_runtime(integer,integer),
  public.miniapp_runtime_publication() from public,anon,authenticated;
grant execute on function public.miniapp_runtime_workbench(),public.save_miniapp_runtime(jsonb,integer,boolean),public.restore_miniapp_runtime(integer,integer) to authenticated;
grant execute on function public.miniapp_runtime_publication() to anon,authenticated;
grant execute on function public.can_access_miniapp_content_image(text,boolean) to anon,authenticated;
notify pgrst,'reload schema';
commit;
