begin;

create function mathin_internal.valid_activity_page(p jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare b jsonb; k text; keys text[];
begin
  if p is null or jsonb_typeof(p)<>'object' or p->'version'<>'1'::jsonb
    or jsonb_typeof(p->'layout')<>'string' or p->>'layout' not in ('cards','continuous') or jsonb_typeof(p->'cover')<>'string'
    or jsonb_typeof(p->'blocks')<>'array' or octet_length(p::text)>200000
    or not (p ?& array['version','layout','cover','blocks'])
    or exists(select 1 from jsonb_object_keys(p) v where v not in ('version','layout','cover','blocks')) then return false; end if;
  if jsonb_array_length(p->'blocks')>30 or char_length(p->>'cover')>120 then return false; end if;
  for b in select value from jsonb_array_elements(p->'blocks') loop
    if jsonb_typeof(b)<>'object' or not (b ?& array['id','type'])
      or (b->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
    keys:=case b->>'type' when 'text' then array['id','type','title','body']
      when 'image' then array['id','type','imagePath','caption']
      when 'imageText' then array['id','type','imagePath','title','body','position'] else null end;
    if keys is null or not (b ?& keys) or exists(select 1 from jsonb_object_keys(b) v where not(v=any(keys))) then return false; end if;
    foreach k in array keys loop
      if jsonb_typeof(b->k)<>'string' then return false; end if;
    end loop;
    if char_length(b->>'title')>120 or char_length(b->>'body')>6000 or char_length(b->>'caption')>300
      or char_length(b->>'imagePath')>120 or (b->>'type'='imageText' and b->>'position' not in ('above','left','right')) then return false; end if;
  end loop;
  return (select count(*)=count(distinct value->>'id') from jsonb_array_elements(p->'blocks'));
end $$;
revoke all on function mathin_internal.valid_activity_page(jsonb) from public,anon,authenticated;

create table public.miniapp_activity_pages (
  kind text not null check(kind in ('activity','class')),
  target_id uuid not null,
  activity_id uuid generated always as (case when kind='activity' then target_id end) stored references public.activities(id),
  classroom_id uuid generated always as (case when kind='class' then target_id end) stored references public.classrooms(id),
  draft jsonb not null check(mathin_internal.valid_activity_page(draft)),
  published jsonb check(published is null or mathin_internal.valid_activity_page(published)),
  revision integer not null check(revision>0),
  published_revision integer,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  primary key(kind,target_id)
);
alter table public.miniapp_activity_pages enable row level security;
revoke all on public.miniapp_activity_pages from public,anon,authenticated;

create function public.can_manage_miniapp_activity_page(p_kind text,p_target_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and case p_kind
    when 'activity' then public.has_perm(auth.uid(),'activity.manage') and exists(
      select 1 from activities where id=p_target_id and deleted_at is null and record_state='current')
    when 'class' then public.has_perm(auth.uid(),'class.manage') and public.can_manage_classroom(p_target_id,auth.uid()) and exists(
      select 1 from classrooms where id=p_target_id and trashed_at is null and offering_type='short_term_topic')
    else false end;
$$;

create function public.miniapp_activity_page_workbench(p_kind text,p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare row public.miniapp_activity_pages;
begin
  if not public.can_manage_miniapp_activity_page(p_kind,p_target_id) then raise exception 'FORBIDDEN'; end if;
  select * into row from miniapp_activity_pages where kind=p_kind and target_id=p_target_id;
  return jsonb_build_object('draft',row.draft,'revision',coalesce(row.revision,0),
    'publishedRevision',row.published_revision,'publishedAt',row.published_at);
end $$;

create function public.save_miniapp_activity_page(p_kind text,p_target_id uuid,p_page jsonb,p_revision integer,p_publish boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare old_revision integer; path text;
begin
  if not public.can_manage_miniapp_activity_page(p_kind,p_target_id) then raise exception 'FORBIDDEN'; end if;
  if p_revision is null or p_revision<0 or p_publish is null or not mathin_internal.valid_activity_page(p_page) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-activity-page/'||p_kind||'/'||p_target_id::text,913));
  select revision into old_revision from miniapp_activity_pages where kind=p_kind and target_id=p_target_id for update;
  if p_revision is distinct from coalesce(old_revision,0) then raise exception 'FORM_CHANGED'; end if;
  for path in select p_page->>'cover' union all select value->>'imagePath' from jsonb_array_elements(p_page->'blocks')
    where value->>'type' in ('image','imageText') loop
    if path<>'' and (path !~ ('^'||p_kind||'/'||p_target_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
      or not exists(select 1 from storage.objects where bucket_id='miniapp-activity-images' and name=path)) then raise exception 'VALIDATION'; end if;
  end loop;
  if p_publish and exists(select 1 from jsonb_array_elements(p_page->'blocks') b where b->>'type' in ('image','imageText') and b->>'imagePath'='')
    then raise exception 'VALIDATION'; end if;
  insert into miniapp_activity_pages(kind,target_id,draft,published,revision,published_revision,published_at,updated_by)
    values(p_kind,p_target_id,p_page,case when p_publish then p_page end,1,case when p_publish then 1 end,case when p_publish then now() end,auth.uid())
    on conflict(kind,target_id) do update set draft=p_page,revision=miniapp_activity_pages.revision+1,
      published=case when p_publish then p_page else miniapp_activity_pages.published end,
      published_revision=case when p_publish then miniapp_activity_pages.revision+1 else miniapp_activity_pages.published_revision end,
      published_at=case when p_publish then now() else miniapp_activity_pages.published_at end,updated_by=auth.uid(),updated_at=now();
  return public.miniapp_activity_page_workbench(p_kind,p_target_id);
end $$;

-- Visibility and identity follow the existing activity/short-course catalog.
create function public.miniapp_activity_detail(p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare offer jsonb; page jsonb; native_kind text;
begin
  select x into offer from jsonb_array_elements(public.miniapp_participant_activity_catalog()) x where x->>'id'=p_target_id::text;
  if offer is null then return null; end if;
  native_kind:=case when exists(select 1 from miniapp_short_course_publications p join classrooms c on c.id=p.classroom_id
    where c.id=p_target_id and c.offering_type='short_term_topic') then 'class' else 'activity' end;
  select published into page from miniapp_activity_pages where kind=native_kind and target_id=p_target_id;
  return jsonb_build_object('offer',offer,'page',page);
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('miniapp-activity-images','miniapp-activity-images',false,5242880,array['image/jpeg','image/png','image/webp']);

create function public.can_access_miniapp_activity_image(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare kind text; target uuid; detail jsonb; page jsonb;
begin
  if p_path is null or p_path !~ '^(activity|class)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(jpg|png|webp)$' then return false; end if;
  kind:=split_part(p_path,'/',1); target:=split_part(p_path,'/',2)::uuid;
  if public.can_manage_miniapp_activity_page(kind,target) then return true; end if;
  if p_write is distinct from false then return false; end if;
  detail:=public.miniapp_activity_detail(target); page:=detail->'page';
  return coalesce(page->>'cover'=p_path or exists(select 1 from jsonb_array_elements(page->'blocks') b
    where b->>'type' in ('image','imageText') and b->>'imagePath'=p_path),false);
end $$;
create policy miniapp_activity_images_insert on storage.objects for insert to authenticated
  with check(bucket_id='miniapp-activity-images' and public.can_access_miniapp_activity_image(name,true));
create policy miniapp_activity_images_select on storage.objects for select to anon,authenticated
  using(bucket_id='miniapp-activity-images' and public.can_access_miniapp_activity_image(name,false));

revoke all on function public.can_manage_miniapp_activity_page(text,uuid),public.miniapp_activity_page_workbench(text,uuid),
  public.save_miniapp_activity_page(text,uuid,jsonb,integer,boolean),public.miniapp_activity_detail(uuid),
  public.can_access_miniapp_activity_image(text,boolean) from public,anon,authenticated;
grant execute on function public.can_manage_miniapp_activity_page(text,uuid),public.miniapp_activity_page_workbench(text,uuid),
  public.save_miniapp_activity_page(text,uuid,jsonb,integer,boolean) to authenticated;
grant execute on function public.miniapp_activity_detail(uuid),public.can_access_miniapp_activity_image(text,boolean) to anon,authenticated;
notify pgrst,'reload schema';
commit;
