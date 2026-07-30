-- R1：逐生检查归属正式课件的准确动画页，而非跨课件复用的标题模板。
-- 标记按 page_doc_id + track 保存并在 release snapshot 中冻结；备课可为本课增删，
-- 本课调整只写 session_learning_checks，不回写正式课件标记。

do $$
begin
  if to_regclass('public.cw_page_learning_check_flags') is null
     and to_regclass('public.cw_page_teaching_metadata') is not null then
    alter table public.cw_page_teaching_metadata rename to cw_page_learning_check_flags;
  end if;
end
$$;

create table if not exists public.cw_page_learning_check_flags (
  page_doc_id uuid not null references public.cw_page_docs(id) on delete cascade,
  track text not null check (track in ('native-16x9', 'adapted-4x3')),
  draft_enabled boolean,
  published_enabled boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (page_doc_id, track)
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cw_page_learning_check_flags'
      and column_name='draft_learning_check_enabled'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cw_page_learning_check_flags'
      and column_name='draft_enabled'
  ) then
    alter table public.cw_page_learning_check_flags
      rename column draft_learning_check_enabled to draft_enabled;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cw_page_learning_check_flags'
      and column_name='published_learning_check_enabled'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='cw_page_learning_check_flags'
      and column_name='published_enabled'
  ) then
    alter table public.cw_page_learning_check_flags
      rename column published_learning_check_enabled to published_enabled;
  end if;
end
$$;

alter table public.cw_page_learning_check_flags
  add column if not exists draft_enabled boolean,
  add column if not exists published_enabled boolean not null default false,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now(),
  drop column if exists draft_role,
  drop column if exists published_role;

alter table public.cw_page_learning_check_flags enable row level security;
drop policy if exists "cw_page_teaching_metadata_select_staff" on public.cw_page_learning_check_flags;
drop policy if exists "cw_page_learning_check_flags_select_staff" on public.cw_page_learning_check_flags;
create policy "cw_page_learning_check_flags_select_staff" on public.cw_page_learning_check_flags
  for select to authenticated using (public.is_staff(auth.uid()));
revoke all on public.cw_page_learning_check_flags from anon, authenticated;
grant select on public.cw_page_learning_check_flags to authenticated;

drop function if exists public.set_cw_page_teaching_metadata(uuid, text, text, boolean);

create or replace function public.set_cw_page_learning_check_flag(
  p_page_doc_id uuid,
  p_track text,
  p_enabled boolean
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'courseware.page.edit') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9', 'adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  if not exists (
    select 1 from public.cw_page_docs page
    join public.cw_page_track_heads head on head.page_doc_id = page.id and head.track = p_track
    where page.id = p_page_doc_id and page.deleted_at is null
  ) then raise exception 'PAGE_TRACK_NOT_FOUND'; end if;

  insert into public.cw_page_learning_check_flags(
    page_doc_id, track, draft_enabled, published_enabled, updated_by, updated_at
  ) values (
    p_page_doc_id, p_track, p_enabled, false, uid, now()
  )
  on conflict(page_doc_id, track) do update
    set draft_enabled = excluded.draft_enabled,
        updated_by = uid,
        updated_at = now();
end
$$;

revoke all on function public.set_cw_page_learning_check_flag(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_cw_page_learning_check_flag(uuid, text, boolean) to authenticated;

-- 只有发布后的页级标记进入教师备课默认清单。
create or replace function public.publish_cw_track_release(p_lecture_id uuid, p_track text, p_note text default '')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); next_no int; release_id uuid; release_snapshot jsonb;
begin
  if uid is null or not public.has_perm(uid,'courseware.release.publish') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9','adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  perform 1 from public.course_lectures where id=p_lecture_id for update;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  if exists (
    select 1 from public.cw_page_docs page
    left join public.cw_page_track_heads head on head.page_doc_id=page.id and head.track=p_track
    where page.lecture_id=p_lecture_id and page.deleted_at is null
      and coalesce(head.draft_revision_id,head.current_revision_id) is null
  ) then raise exception 'PAGE_TRACK_NOT_READY'; end if;
  if exists (
    select 1 from public.cw_page_asset_bindings binding
    join public.cw_page_docs page on page.id=binding.page_doc_id
    left join public.cw_asset_variant_heads variant on variant.shared_asset_id=binding.shared_asset_id and variant.track=p_track
    left join public.cw_shared_assets asset on asset.id=binding.shared_asset_id
    where page.lecture_id=p_lecture_id and page.deleted_at is null and binding.track=p_track
      and coalesce(binding.pinned_revision_id,variant.draft_revision_id,variant.published_revision_id,asset.published_revision_id) is null
  ) then raise exception 'UNRESOLVED_ASSET_BINDING'; end if;
  select jsonb_agg(jsonb_build_object(
      'pageDocId',rows.page_id,
      'revisionId',rows.revision_id,
      'bindings',rows.bindings,
      'learningCheckEnabled',rows.learning_check_enabled
    ) order by rows.page_no)
    into release_snapshot
    from (
      select page.id page_id,page.page_no,coalesce(head.draft_revision_id,head.current_revision_id) revision_id,
        coalesce(flags.draft_enabled,flags.published_enabled,false) learning_check_enabled,
        coalesce((select jsonb_agg(jsonb_build_object('bindingKey',binding.binding_key,'assetRevisionId',
          coalesce(binding.pinned_revision_id,variant.draft_revision_id,variant.published_revision_id,asset.published_revision_id)) order by binding.binding_key)
          from public.cw_page_asset_bindings binding
          join public.cw_shared_assets asset on asset.id=binding.shared_asset_id
          left join public.cw_asset_variant_heads variant on variant.shared_asset_id=binding.shared_asset_id and variant.track=p_track
          where binding.page_doc_id=page.id and binding.track=p_track),'[]'::jsonb) bindings
      from public.cw_page_docs page
      join public.cw_page_track_heads head on head.page_doc_id=page.id and head.track=p_track
      left join public.cw_page_learning_check_flags flags on flags.page_doc_id=page.id and flags.track=p_track
      where page.lecture_id=p_lecture_id and page.deleted_at is null
    ) rows;
  if release_snapshot is null or octet_length(release_snapshot::text)>1048576 then raise exception 'RELEASE_SNAPSHOT_TOO_LARGE_OR_INVALID'; end if;
  select coalesce(max(release_no),0)+1 into next_no from public.cw_lecture_releases where lecture_id=p_lecture_id and track=p_track;
  insert into public.cw_lecture_releases(lecture_id,release_no,note,snapshot,published_by,track)
  values(p_lecture_id,next_no,left(trim(coalesce(p_note,'')),1000),release_snapshot,uid,p_track) returning id into release_id;
  update public.cw_page_track_heads head set current_revision_id=coalesce(head.draft_revision_id,head.current_revision_id),draft_revision_id=null,updated_at=now()
   from public.cw_page_docs page where page.id=head.page_doc_id and page.lecture_id=p_lecture_id and head.track=p_track;
  insert into public.cw_page_learning_check_flags(
    page_doc_id,track,published_enabled,updated_by,updated_at
  )
  select (item.value->>'pageDocId')::uuid,p_track,
         coalesce((item.value->>'learningCheckEnabled')::boolean,false),uid,now()
    from jsonb_array_elements(release_snapshot) item
  on conflict(page_doc_id,track) do update
    set published_enabled=excluded.published_enabled,
        draft_enabled=null,
        updated_by=uid,
        updated_at=now();
  insert into public.cw_lecture_track_heads(lecture_id,track,current_release_id)
  values(p_lecture_id,p_track,release_id)
  on conflict(lecture_id,track) do update set current_release_id=excluded.current_release_id,updated_at=now();
  if p_track='native-16x9' then
    update public.cw_page_docs page set current_revision_id=head.current_revision_id,draft_revision_id=null,aspect='16:9'
      from public.cw_page_track_heads head where head.page_doc_id=page.id and page.lecture_id=p_lecture_id and head.track=p_track;
    update public.course_lectures set current_release_id=release_id where id=p_lecture_id;
  end if;
  return release_id;
end;
$$;

create or replace function public.rollback_cw_track_release(p_lecture_id uuid,p_track text,p_release_id uuid,p_note text default '')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); old_snapshot jsonb; next_no int; next_id uuid;
begin
  if uid is null or not public.has_perm(uid,'courseware.release.publish') then raise exception 'FORBIDDEN'; end if;
  if p_track not in ('native-16x9','adapted-4x3') then raise exception 'INVALID_COURSEWARE_TRACK'; end if;
  perform 1 from public.course_lectures where id=p_lecture_id for update;
  select snapshot into old_snapshot from public.cw_lecture_releases where id=p_release_id and lecture_id=p_lecture_id and track=p_track;
  if old_snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;
  select coalesce(max(release_no),0)+1 into next_no from public.cw_lecture_releases where lecture_id=p_lecture_id and track=p_track;
  insert into public.cw_lecture_releases(lecture_id,release_no,note,snapshot,published_by,track)
  values(p_lecture_id,next_no,left(trim(coalesce(p_note,'')),1000),old_snapshot,uid,p_track) returning id into next_id;
  update public.cw_page_track_heads head set current_revision_id=(item.value->>'revisionId')::uuid,draft_revision_id=null,updated_at=now()
    from jsonb_array_elements(old_snapshot) item
   where head.page_doc_id=(item.value->>'pageDocId')::uuid and head.track=p_track;
  insert into public.cw_page_learning_check_flags(page_doc_id,track,published_enabled,updated_by,updated_at)
  select (item.value->>'pageDocId')::uuid,p_track,
         coalesce((item.value->>'learningCheckEnabled')::boolean,false),uid,now()
    from jsonb_array_elements(old_snapshot) item
  on conflict(page_doc_id,track) do update
    set published_enabled=excluded.published_enabled,
        draft_enabled=null,
        updated_by=uid,
        updated_at=now();
  insert into public.cw_lecture_track_heads(lecture_id,track,current_release_id) values(p_lecture_id,p_track,next_id)
  on conflict(lecture_id,track) do update set current_release_id=excluded.current_release_id,updated_at=now();
  if p_track='native-16x9' then
    update public.cw_page_docs page set current_revision_id=head.current_revision_id,draft_revision_id=null,aspect='16:9'
      from public.cw_page_track_heads head where head.page_doc_id=page.id and page.lecture_id=p_lecture_id and head.track=p_track;
    update public.course_lectures set current_release_id=next_id where id=p_lecture_id;
  end if;
  return next_id;
end;
$$;

alter table public.session_learning_checks
  add column if not exists source_page_doc_id uuid references public.cw_page_docs(id) on delete set null;
create unique index if not exists session_learning_checks_source_page_unique
  on public.session_learning_checks(session_id,source_page_doc_id)
  where source_page_doc_id is not null;

create or replace function public.replace_session_learning_checks(p_session_id uuid,p_titles jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  uid uuid:=auth.uid();
  session_row public.class_sessions%rowtype;
  item jsonb;
  title_value text;
  source_page uuid;
  item_index integer:=0;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into session_row from public.class_sessions where id=p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id,uid) then raise exception 'FORBIDDEN'; end if;
  if session_row.started_at is not null then raise exception 'SESSION_ALREADY_STARTED'; end if;
  if jsonb_typeof(p_titles)<>'array' or jsonb_array_length(p_titles)>30 then raise exception 'VALIDATION'; end if;

  for item in select value from jsonb_array_elements(p_titles)
  loop
    if jsonb_typeof(item)='string' then
      title_value:=btrim(item #>> '{}');
      source_page:=null;
    elsif jsonb_typeof(item)='object' then
      title_value:=btrim(coalesce(item->>'title',''));
      begin source_page:=nullif(item->>'sourcePageId','')::uuid;
      exception when invalid_text_representation then raise exception 'VALIDATION'; end;
    else
      raise exception 'VALIDATION';
    end if;
    if length(title_value) not between 1 and 100 then raise exception 'VALIDATION'; end if;
    if source_page is not null and not exists (
      select 1 from public.cw_page_docs page
       where page.id=source_page and page.lecture_id=session_row.lecture_id and page.deleted_at is null
    ) then raise exception 'VALIDATION'; end if;
  end loop;

  if exists (
    select 1 from (
      select nullif(value->>'sourcePageId','') source_id,count(*)
        from jsonb_array_elements(p_titles)
       where jsonb_typeof(value)='object' and nullif(value->>'sourcePageId','') is not null
       group by 1 having count(*)>1
    ) duplicate
  ) then raise exception 'VALIDATION'; end if;

  delete from public.session_learning_checks where session_id=p_session_id;
  for item in select value from jsonb_array_elements(p_titles)
  loop
    if jsonb_typeof(item)='string' then
      title_value:=btrim(item #>> '{}'); source_page:=null;
    else
      title_value:=btrim(item->>'title'); source_page:=nullif(item->>'sourcePageId','')::uuid;
    end if;
    insert into public.session_learning_checks(session_id,position,title,source_page_doc_id,created_by)
    values(p_session_id,item_index,title_value,source_page,uid);
    item_index:=item_index+1;
  end loop;
end
$$;

comment on table public.learning_check_templates is
  'Deprecated in R1: generic title templates drift from courseware animation/page identity. Kept only for migration compatibility.';