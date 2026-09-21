-- 队列先确定本页讲次，再补齐页数、草稿及最后编辑；素材统计使用窄覆盖索引。
-- 保留原 RPC、角色权限、轨道、搜索和排序规则，同值时以课程和讲次 ID 稳定排序。
do $guard$
begin
  if md5(pg_get_functiondef('public.list_courseware_tasks(text,text,integer)'::regprocedure)) <> 'e58429a17586f06e57898c0a8d715f58'
    or md5(pg_get_functiondef('public.list_cw_shared_assets(text,text,text,text,integer,integer,integer)'::regprocedure)) <> '4386b4bb4eb223effbfd102e7b5fa507'
    then raise exception 'COURSEWARE_READ_DEFINITION_CHANGED'; end if;
end;
$guard$;

create index cw_page_revisions_page_track_edited_idx
  on public.cw_page_revisions(page_doc_id, track, created_at desc, id desc) include(created_by);
create index cw_page_asset_bindings_native_asset_page_idx
  on public.cw_page_asset_bindings(shared_asset_id, page_doc_id) where track = 'native-16x9';
create index cw_page_asset_bindings_adapted_asset_page_idx
  on public.cw_page_asset_bindings(shared_asset_id, page_doc_id) where track = 'adapted-4x3';
create index cw_page_docs_live_lecture_id_idx
  on public.cw_page_docs(lecture_id, id) where deleted_at is null;
create index cw_page_track_heads_draft_track_page_idx
  on public.cw_page_track_heads(track, page_doc_id) where draft_revision_id is not null;

create or replace function public.list_courseware_tasks(
  p_tab text default 'incomplete', p_query text default '', p_limit integer default 60
)
returns table (
  lecture_id uuid, family_id uuid, family_title text, course_id uuid, course_title text,
  product_code text, lecture_no integer, lecture_name text, track text, page_count integer,
  has_draft boolean, release_no integer, last_edited_at timestamptz, last_editor_name text
)
language plpgsql security definer
set search_path = public, pg_temp
set plan_cache_mode = force_custom_plan
as $$
declare
  uid uuid := auth.uid();
  normalized_tab text := lower(trim(coalesce(p_tab, 'incomplete')));
  normalized_query text := left(trim(coalesce(p_query, '')), 200);
  bounded_limit integer := least(greatest(coalesce(p_limit, 60), 1), 100);
begin
  if uid is null or not (
    public.has_perm(uid, 'courseware.page.edit')
    or public.has_perm(uid, 'courseware.release.publish')
    or public.has_perm(uid, 'courseware.asset.manage')
  ) then raise exception 'FORBIDDEN'; end if;
  if normalized_tab not in ('incomplete', 'recent', 'publish') then raise exception 'INVALID_TASK_TAB'; end if;

  return query
  with candidates as materialized (
    select lecture.id as lecture_id, family.id as family_id, family.title as family_title,
      course.id as course_id, course.title as course_title, course.product_code,
      lecture.no::integer as lecture_no, lecture.name as lecture_name,
      requested.track, head.current_release_id
    from public.course_lectures lecture
    join public.courses course on course.id = lecture.course_id
    join public.course_families family on family.id = course.family_id
    cross join lateral (values ('native-16x9'::text), ('adapted-4x3'::text)) requested(track)
    left join public.cw_lecture_track_heads head on head.lecture_id = lecture.id and head.track = requested.track
    where (requested.track = 'native-16x9' or head.lecture_id is not null)
      and (normalized_tab <> 'incomplete' or head.current_release_id is null)
      and (normalized_query = '' or family.title ilike '%' || normalized_query || '%'
        or coalesce(course.product_code, '') ilike '%' || normalized_query || '%'
        or course.title ilike '%' || normalized_query || '%' or lecture.name ilike '%' || normalized_query || '%')
  ), recent as materialized (
    -- 只有按最近编辑排序时，选页前才需要候选讲次的修订时间。
    select candidate.lecture_id, candidate.track, latest.created_at, latest.created_by
    from candidates candidate
    cross join lateral (
      select revision.created_at, revision.created_by
      from public.cw_page_docs page
      cross join lateral (
        select r.id, r.created_at, r.created_by from public.cw_page_revisions r
        where r.page_doc_id = page.id and r.track = candidate.track
        order by r.created_at desc, r.id desc limit 1
      ) revision
      where page.lecture_id = candidate.lecture_id and page.deleted_at is null
      order by revision.created_at desc, revision.id desc limit 1
    ) latest
    where normalized_tab = 'recent'
  ), selected as materialized (
    select candidate.*, recent.created_at, recent.created_by
    from candidates candidate
    left join recent on recent.lecture_id = candidate.lecture_id and recent.track = candidate.track
    where case normalized_tab
      when 'incomplete' then true
      when 'recent' then recent.created_at is not null
      when 'publish' then exists (
        select 1 from public.cw_page_docs page
        join public.cw_page_track_heads head on head.page_doc_id = page.id and head.track = candidate.track
        where page.lecture_id = candidate.lecture_id and page.deleted_at is null and head.draft_revision_id is not null
      ) end
    order by case when normalized_tab = 'recent' then recent.created_at end desc nulls last,
      case when normalized_tab = 'incomplete' then candidate.current_release_id is null end desc,
      candidate.family_title, candidate.product_code, candidate.lecture_no, candidate.track,
      candidate.course_id, candidate.lecture_id
    limit bounded_limit
  )
  select task.lecture_id, task.family_id, task.family_title, task.course_id, task.course_title,
    task.product_code, task.lecture_no, task.lecture_name, task.track,
    (select count(*)::integer from public.cw_page_docs page where page.lecture_id = task.lecture_id and page.deleted_at is null),
    exists (select 1 from public.cw_page_docs page
      join public.cw_page_track_heads head on head.page_doc_id = page.id and head.track = task.track
      where page.lecture_id = task.lecture_id and page.deleted_at is null and head.draft_revision_id is not null),
    release.release_no,
    case when normalized_tab = 'recent' then task.created_at else last_revision.created_at end,
    profile.display_name
  from selected task
  left join public.cw_lecture_releases release on release.id = task.current_release_id
  left join lateral (
    select revision.created_at, revision.created_by
    from public.cw_page_docs page
    cross join lateral (
      select r.id, r.created_at, r.created_by from public.cw_page_revisions r
      where r.page_doc_id = page.id and r.track = task.track
      order by r.created_at desc, r.id desc limit 1
    ) revision
    where normalized_tab <> 'recent' and page.lecture_id = task.lecture_id and page.deleted_at is null
    order by revision.created_at desc, revision.id desc limit 1
  ) last_revision on true
  left join public.profiles profile on profile.id = case when normalized_tab = 'recent' then task.created_by else last_revision.created_by end
  order by case when normalized_tab = 'recent' then task.created_at end desc nulls last,
    case when normalized_tab = 'incomplete' then task.current_release_id is null end desc,
    task.family_title, task.product_code, task.lecture_no, task.track, task.course_id, task.lecture_id;
end;
$$;

-- 素材使用次数决定排序；本页以外的课程/讲次数不参与筛选，留到选页后计算。
do $asset_query$
declare definition text;
begin
  select pg_get_functiondef('public.list_cw_shared_assets(text,text,text,text,integer,integer,integer)'::regprocedure) into definition;
  definition := replace(definition,
    'count(*) as usage_count, count(distinct lecture.course_id) as course_count, count(distinct page.lecture_id) as lecture_count',
    'count(*) as usage_count');
  definition := replace(definition,
    'coalesce(usage.usage_count, 0) as usage_count, coalesce(usage.course_count,0) as course_count, coalesce(usage.lecture_count,0) as lecture_count',
    'coalesce(usage.usage_count, 0) as usage_count');
  definition := replace(definition,
    'asset.usage_count, asset.course_count, asset.lecture_count, asset.updated_at',
    'asset.usage_count, details.course_count, details.lecture_count, asset.updated_at');
  definition := replace(definition, 'from selected asset' || chr(10) || '  left join public.cw_asset_revisions',
    $join$from selected asset
  cross join lateral (
    select count(distinct lecture.course_id) as course_count, count(distinct page.lecture_id) as lecture_count
    from public.cw_page_asset_bindings binding
    join public.cw_page_docs page on page.id = binding.page_doc_id and page.deleted_at is null
    join public.course_lectures lecture on lecture.id = page.lecture_id
    where binding.shared_asset_id = asset.id and binding.track = p_track
  ) details
  left join public.cw_asset_revisions$join$);
  if definition not like '%) details%' then raise exception 'ASSET_READ_REWRITE_FAILED'; end if;
  execute definition;
end;
$asset_query$;

-- 全库引用次数参与排序，约 6.6 万组在默认 4 MB 下落盘；仅本 RPC 提升工作内存。
alter function public.list_cw_shared_assets(text,text,text,text,integer,integer,integer)
  set work_mem = '16MB';
