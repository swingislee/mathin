begin;

-- Version 1 pages without the optional presentation fields remain readable.
create or replace function mathin_internal.valid_activity_page(p jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
declare b jsonb; k text; keys text[]; extra jsonb;
begin
  if p is null or jsonb_typeof(p)<>'object' or p->'version'<>'1'::jsonb
    or jsonb_typeof(p->'layout')<>'string' or p->>'layout' not in ('cards','continuous') or jsonb_typeof(p->'cover')<>'string'
    or jsonb_typeof(p->'blocks')<>'array' or octet_length(p::text)>200000
    or not (p ?& array['version','layout','cover','blocks'])
    or exists(select 1 from jsonb_object_keys(p) v where v not in ('version','layout','cover','blocks','listing','signup')) then return false; end if;
  if jsonb_array_length(p->'blocks')>30 or char_length(p->>'cover')>120 then return false; end if;
  if p ? 'listing' then
    extra:=p->'listing';
    if jsonb_typeof(extra)<>'object' or not(extra ?& array['cover','summary','labels','sortOrder'])
      or exists(select 1 from jsonb_object_keys(extra) v where v not in ('cover','summary','labels','sortOrder'))
      or jsonb_typeof(extra->'cover')<>'string' or char_length(extra->>'cover')>120
      or jsonb_typeof(extra->'summary')<>'string' or char_length(extra->>'summary')>200
      or jsonb_typeof(extra->'labels')<>'array' or jsonb_array_length(extra->'labels')>5
      or jsonb_typeof(extra->'sortOrder')<>'number' or (extra->>'sortOrder')::numeric<>trunc((extra->>'sortOrder')::numeric)
      or abs((extra->>'sortOrder')::numeric)>9999 then return false; end if;
    if exists(select 1 from jsonb_array_elements(extra->'labels') l where jsonb_typeof(l)<>'string' or char_length(l#>>'{}') not between 1 and 24)
      or (select count(*)<>count(distinct l) from jsonb_array_elements(extra->'labels') l) then return false; end if;
  end if;
  if p ? 'signup' then
    extra:=p->'signup';
    if jsonb_typeof(extra)<>'object' or not(extra ?& array['instructions','confirmation','success'])
      or exists(select 1 from jsonb_object_keys(extra) v where v not in ('instructions','confirmation','success'))
      or jsonb_typeof(extra->'instructions')<>'string' or char_length(extra->>'instructions')>2000
      or jsonb_typeof(extra->'confirmation')<>'string' or char_length(extra->>'confirmation')>500
      or jsonb_typeof(extra->'success')<>'string' or char_length(extra->>'success')>2000 then return false; end if;
  end if;
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
exception when others then return false;
end $$;

create table public.miniapp_activity_page_history (
  kind text not null, target_id uuid not null, revision integer not null check(revision>0),
  page jsonb not null check(mathin_internal.valid_activity_page(page)),
  published_at timestamptz not null default now(), published_by uuid references public.profiles(id),
  primary key(kind,target_id,revision), foreign key(kind,target_id) references public.miniapp_activity_pages(kind,target_id)
);
alter table public.miniapp_activity_page_history enable row level security;
revoke all on public.miniapp_activity_page_history from public,anon,authenticated;
insert into public.miniapp_activity_page_history(kind,target_id,revision,page,published_at,published_by)
  select kind,target_id,published_revision,published,published_at,updated_by from public.miniapp_activity_pages where published is not null;

create or replace function public.miniapp_activity_page_workbench(p_kind text,p_target_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare r public.miniapp_activity_pages;
begin
  if not public.can_manage_miniapp_activity_page(p_kind,p_target_id) then raise exception 'FORBIDDEN'; end if;
  select * into r from miniapp_activity_pages where kind=p_kind and target_id=p_target_id;
  return jsonb_build_object('draft',r.draft,'revision',coalesce(r.revision,0),'publishedRevision',r.published_revision,'publishedAt',r.published_at,
    'history',coalesce((select jsonb_agg(jsonb_build_object('revision',h.revision,'publishedAt',h.published_at) order by h.revision desc)
      from (select revision,published_at from miniapp_activity_page_history where kind=p_kind and target_id=p_target_id order by revision desc limit 50) h),'[]'::jsonb));
end $$;

create or replace function public.save_miniapp_activity_page(p_kind text,p_target_id uuid,p_page jsonb,p_revision integer,p_publish boolean) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare old_revision integer; path text;
begin
  if not public.can_manage_miniapp_activity_page(p_kind,p_target_id) then raise exception 'FORBIDDEN'; end if;
  if p_revision is null or p_revision<0 or p_publish is null or not mathin_internal.valid_activity_page(p_page) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-activity-page/'||p_kind||'/'||p_target_id::text,913));
  select revision into old_revision from miniapp_activity_pages where kind=p_kind and target_id=p_target_id for update;
  if p_revision is distinct from coalesce(old_revision,0) then raise exception 'FORM_CHANGED'; end if;
  for path in select p_page->>'cover' union all select p_page#>>'{listing,cover}' union all
    select value->>'imagePath' from jsonb_array_elements(p_page->'blocks') where value->>'type' in ('image','imageText') loop
    if path<>'' and (path !~ ('^'||p_kind||'/'||p_target_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
      or not exists(select 1 from storage.objects where bucket_id='miniapp-activity-images' and name=path)) then raise exception 'VALIDATION'; end if;
  end loop;
  if p_publish and exists(select 1 from jsonb_array_elements(p_page->'blocks') b where b->>'type' in ('image','imageText') and b->>'imagePath'='') then raise exception 'VALIDATION'; end if;
  insert into miniapp_activity_pages(kind,target_id,draft,published,revision,published_revision,published_at,updated_by)
    values(p_kind,p_target_id,p_page,case when p_publish then p_page end,1,case when p_publish then 1 end,case when p_publish then now() end,auth.uid())
    on conflict(kind,target_id) do update set draft=p_page,revision=miniapp_activity_pages.revision+1,
      published=case when p_publish then p_page else miniapp_activity_pages.published end,
      published_revision=case when p_publish then miniapp_activity_pages.revision+1 else miniapp_activity_pages.published_revision end,
      published_at=case when p_publish then now() else miniapp_activity_pages.published_at end,updated_by=auth.uid(),updated_at=now();
  if p_publish then
    insert into miniapp_activity_page_history(kind,target_id,revision,page,published_by)
      select kind,target_id,revision,published,auth.uid() from miniapp_activity_pages where kind=p_kind and target_id=p_target_id;
  end if;
  return public.miniapp_activity_page_workbench(p_kind,p_target_id);
end $$;

create function public.restore_miniapp_activity_page(p_kind text,p_target_id uuid,p_source_revision integer,p_revision integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare page jsonb;
begin
  if not public.can_manage_miniapp_activity_page(p_kind,p_target_id) then raise exception 'FORBIDDEN'; end if;
  select h.page into page from miniapp_activity_page_history h where kind=p_kind and target_id=p_target_id and revision=p_source_revision;
  if page is null then raise exception 'NOT_FOUND'; end if;
  return public.save_miniapp_activity_page(p_kind,p_target_id,page,p_revision,false);
end $$;

-- One catalog read and one set join; no detail-page or image queries per card.
create function public.miniapp_activity_catalog_presentation() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  with offers as materialized (select x from jsonb_array_elements(public.miniapp_participant_activity_catalog()) x),
  presented as (select o.x || jsonb_build_object('listing',jsonb_build_object(
    'cover',coalesce(nullif(p.published#>>'{listing,cover}',''),p.published->>'cover',''),
    'summary',coalesce(p.published#>>'{listing,summary}',''),'labels',coalesce(p.published#>'{listing,labels}','[]'::jsonb),
    'sortOrder',coalesce(p.published#>'{listing,sortOrder}','0'::jsonb))) item
    from offers o left join miniapp_activity_pages p on p.target_id=(o.x->>'id')::uuid and p.kind=case
      when exists(select 1 from miniapp_short_course_publications s join classrooms c on c.id=s.classroom_id
        where c.id=(o.x->>'id')::uuid and c.offering_type='short_term_topic') then 'class' else 'activity' end)
  select coalesce(jsonb_agg(item order by (item#>>'{listing,sortOrder}')::integer,item#>>'{activity,startsAt}',item->>'id'),'[]'::jsonb) from presented;
$$;

create or replace function public.can_access_miniapp_activity_image(p_path text,p_write boolean default false) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare kind text; target uuid; page jsonb; base text;
begin
  if p_path is null or p_path !~ '^(activity|class)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}(\.thumb)?\.(jpg|png|webp)$' then return false; end if;
  kind:=split_part(p_path,'/',1); target:=split_part(p_path,'/',2)::uuid;
  if public.can_manage_miniapp_activity_page(kind,target) then return true; end if;
  if p_write is distinct from false then return false; end if;
  base:=replace(p_path,'.thumb.','.'); page:=public.miniapp_activity_detail(target)->'page';
  return coalesce(page->>'cover'=base or page#>>'{listing,cover}'=base or exists(select 1 from jsonb_array_elements(page->'blocks') b
    where b->>'type' in ('image','imageText') and b->>'imagePath'=base),false);
end $$;

create function public.miniapp_activity_image_path(p_path text,p_thumbnail boolean default false,p_preview boolean default false) returns text
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare thumb text;
begin
  if p_path is null or p_path like '%.thumb.%' or not public.can_access_miniapp_activity_image(p_path,p_preview) then return null; end if;
  thumb:=regexp_replace(p_path,'\.(jpg|png|webp)$','.thumb.\1');
  if p_thumbnail and exists(select 1 from storage.objects where bucket_id='miniapp-activity-images' and name=thumb) then return thumb; end if;
  if exists(select 1 from storage.objects where bucket_id='miniapp-activity-images' and name=p_path) then return p_path; end if;
  return null;
end $$;

revoke all on function public.restore_miniapp_activity_page(text,uuid,integer,integer),public.miniapp_activity_catalog_presentation(),
  public.miniapp_activity_image_path(text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.restore_miniapp_activity_page(text,uuid,integer,integer) to authenticated;
grant execute on function public.miniapp_activity_catalog_presentation(),public.miniapp_activity_image_path(text,boolean,boolean) to anon,authenticated;
notify pgrst,'reload schema';
commit;
