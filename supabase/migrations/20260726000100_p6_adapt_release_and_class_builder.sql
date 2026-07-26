-- P6：把 4:3 背景审校、页面校对与讲次发布串成可筛选的人工路径；
-- 同时让建班准备度显式以 native-16x9 发布头为准，4:3 仍是可选增强轨。

create or replace function public.get_cw_adapt_filter_options(p_course_id uuid default null)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null or not (
    public.has_perm(uid, 'courseware.asset.manage')
    or public.has_perm(uid, 'courseware.page.edit')
    or public.has_perm(uid, 'courseware.review')
    or public.has_perm(uid, 'courseware.release.publish')
  ) then raise exception 'FORBIDDEN'; end if;

  select jsonb_build_object(
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', course_row.id,
        'title', course_row.title,
        'productCode', course_row.product_code
      ) order by course_row.grade, course_row.term, course_row.class_type, course_row.title)
      from public.courses course_row
      where course_row.trashed_at is null
        and exists (
          select 1 from public.course_lectures lecture_row
          join public.cw_page_docs page_row on page_row.lecture_id = lecture_row.id and page_row.deleted_at is null
          where lecture_row.course_id = course_row.id
        )
    ), '[]'::jsonb),
    'lectures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', lecture_row.id,
        'courseId', lecture_row.course_id,
        'no', lecture_row.no,
        'name', lecture_row.name
      ) order by lecture_row.no)
      from public.course_lectures lecture_row
      where p_course_id is not null
        and lecture_row.course_id = p_course_id
        and lecture_row.status = 'active'
        and exists (
          select 1 from public.cw_page_docs page_row
          where page_row.lecture_id = lecture_row.id and page_row.deleted_at is null
        )
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.list_cw_adapt_background_review_queue(
  p_course_id uuid default null,
  p_lecture_id uuid default null,
  p_offset integer default 0,
  p_limit integer default 24
)
returns table (
  id uuid,
  crop_x integer,
  crop_y integer,
  source_asset_revision_id uuid,
  derived_asset_revision_id uuid,
  page_count integer,
  total_count bigint
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  bounded_offset integer := greatest(coalesce(p_offset, 0), 0);
  bounded_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
begin
  if uid is null or not (
    public.has_perm(uid, 'courseware.asset.manage')
    or public.has_perm(uid, 'courseware.page.edit')
    or public.has_perm(uid, 'courseware.review')
    or public.has_perm(uid, 'courseware.release.publish')
  ) then raise exception 'FORBIDDEN'; end if;
  if p_lecture_id is not null and p_course_id is not null and not exists (
    select 1
    from public.course_lectures filter_lecture
    where filter_lecture.id = p_lecture_id
      and filter_lecture.course_id = p_course_id
  ) then raise exception 'FILTER_MISMATCH'; end if;

  return query
  with filtered as (
    select
      adaptation.id,
      adaptation.crop_x,
      adaptation.crop_y,
      adaptation.source_asset_revision_id,
      adaptation.derived_asset_revision_id,
      count(distinct page_row.id)::integer as page_count
    from public.cw_adapt_backgrounds adaptation
    join public.cw_asset_revisions derived_revision on derived_revision.id = adaptation.derived_asset_revision_id
    left join public.cw_page_asset_bindings binding_row
      on binding_row.shared_asset_id = derived_revision.shared_asset_id
     and binding_row.track = 'adapted-4x3'
     and binding_row.role = 'background'
    left join public.cw_page_docs page_row
      on page_row.id = binding_row.page_doc_id and page_row.deleted_at is null
    left join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id
    where adaptation.status = 'pending'
      and (p_course_id is null or lecture_row.course_id = p_course_id)
      and (p_lecture_id is null or lecture_row.id = p_lecture_id)
    group by adaptation.id, adaptation.crop_x, adaptation.crop_y,
      adaptation.source_asset_revision_id, adaptation.derived_asset_revision_id
  )
  select filtered.*, count(*) over() as total_count
  from filtered
  order by filtered.id
  offset bounded_offset limit bounded_limit;
end;
$$;

create or replace function public.list_cw_adapt_page_review_queue(
  p_classification text default 'D',
  p_course_id uuid default null,
  p_lecture_id uuid default null,
  p_offset integer default 0,
  p_limit integer default 24
)
returns table (
  id uuid,
  course_id uuid,
  course_title text,
  lecture_id uuid,
  lecture_no smallint,
  lecture_name text,
  page_no integer,
  title text,
  adapt_class text,
  adapt_reason text,
  total_count bigint
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  bounded_offset integer := greatest(coalesce(p_offset, 0), 0);
  bounded_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
begin
  if uid is null or not (
    public.has_perm(uid, 'courseware.asset.manage')
    or public.has_perm(uid, 'courseware.page.edit')
    or public.has_perm(uid, 'courseware.review')
    or public.has_perm(uid, 'courseware.release.publish')
  ) then raise exception 'FORBIDDEN'; end if;
  if p_classification not in ('A', 'B', 'C', 'D', 'E', 'F', 'all') then
    raise exception 'INVALID_ADAPT_CLASSIFICATION';
  end if;
  if p_lecture_id is not null and p_course_id is not null and not exists (
    select 1
    from public.course_lectures filter_lecture
    where filter_lecture.id = p_lecture_id
      and filter_lecture.course_id = p_course_id
  ) then raise exception 'FILTER_MISMATCH'; end if;

  return query
  select
    page_row.id,
    course_row.id,
    course_row.title,
    lecture_row.id,
    lecture_row.no,
    lecture_row.name,
    page_row.page_no,
    page_row.title,
    page_row.adapt_class,
    page_row.adapt_reason,
    count(*) over() as total_count
  from public.cw_page_docs page_row
  join public.course_lectures lecture_row on lecture_row.id = page_row.lecture_id
  join public.courses course_row on course_row.id = lecture_row.course_id
  where page_row.deleted_at is null
    and page_row.adapt_class is not null
    and (p_classification = 'all' or page_row.adapt_class = p_classification)
    and (p_course_id is null or course_row.id = p_course_id)
    and (p_lecture_id is null or lecture_row.id = p_lecture_id)
  order by course_row.grade, course_row.term, course_row.class_type, lecture_row.no, page_row.page_no
  offset bounded_offset limit bounded_limit;
end;
$$;

create or replace function public.list_cw_adapt_release_queue(
  p_course_id uuid default null,
  p_lecture_id uuid default null,
  p_scope text default 'pending',
  p_offset integer default 0,
  p_limit integer default 24
)
returns table (
  lecture_id uuid,
  course_id uuid,
  course_title text,
  product_code text,
  lecture_no smallint,
  lecture_name text,
  page_count integer,
  current_release_no integer,
  has_unpublished_changes boolean,
  blocked_background_count integer,
  ready boolean,
  total_count bigint
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  bounded_offset integer := greatest(coalesce(p_offset, 0), 0);
  bounded_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
begin
  if uid is null or not (
    public.has_perm(uid, 'courseware.page.edit')
    or public.has_perm(uid, 'courseware.review')
    or public.has_perm(uid, 'courseware.release.publish')
  ) then raise exception 'FORBIDDEN'; end if;
  if p_scope not in ('pending', 'published', 'all') then raise exception 'INVALID_RELEASE_SCOPE'; end if;
  if p_lecture_id is not null and p_course_id is not null and not exists (
    select 1
    from public.course_lectures filter_lecture
    where filter_lecture.id = p_lecture_id
      and filter_lecture.course_id = p_course_id
  ) then raise exception 'FILTER_MISMATCH'; end if;

  return query
  with lecture_rows as (
    select
      lecture_row.id as lecture_id,
      course_row.id as course_id,
      course_row.title as course_title,
      course_row.product_code,
      lecture_row.no as lecture_no,
      lecture_row.name as lecture_name,
      count(distinct page_row.id)::integer as page_count,
      release_row.release_no as current_release_no,
      bool_or(coalesce(page_head.draft_revision_id is not null, false)) as has_unpublished_changes,
      count(distinct adaptation.id) filter (
        where selected_revision.variant = 'mathin-4x3'
          and coalesce(adaptation.status, 'pending') <> 'approved'
      )::integer as blocked_background_count,
      count(distinct page_row.id) filter (
        where coalesce(page_head.draft_revision_id, page_head.current_revision_id) is null
      )::integer as missing_page_count,
      count(distinct binding_row.id) filter (
        where coalesce(binding_row.pinned_revision_id, variant_head.draft_revision_id,
          variant_head.published_revision_id, shared_asset.published_revision_id) is null
      )::integer as unresolved_binding_count
    from public.course_lectures lecture_row
    join public.courses course_row on course_row.id = lecture_row.course_id
    join public.cw_page_docs page_row on page_row.lecture_id = lecture_row.id and page_row.deleted_at is null
    left join public.cw_page_track_heads page_head
      on page_head.page_doc_id = page_row.id and page_head.track = 'adapted-4x3'
    left join public.cw_page_asset_bindings binding_row
      on binding_row.page_doc_id = page_row.id and binding_row.track = 'adapted-4x3'
    left join public.cw_shared_assets shared_asset on shared_asset.id = binding_row.shared_asset_id
    left join public.cw_asset_variant_heads variant_head
      on variant_head.shared_asset_id = binding_row.shared_asset_id and variant_head.track = 'adapted-4x3'
    left join public.cw_asset_revisions selected_revision on selected_revision.id = coalesce(
      binding_row.pinned_revision_id, variant_head.draft_revision_id,
      variant_head.published_revision_id, shared_asset.published_revision_id
    )
    left join public.cw_adapt_backgrounds adaptation
      on adaptation.derived_asset_revision_id = selected_revision.id
    left join public.cw_lecture_track_heads lecture_head
      on lecture_head.lecture_id = lecture_row.id and lecture_head.track = 'adapted-4x3'
    left join public.cw_lecture_releases release_row on release_row.id = lecture_head.current_release_id
    where lecture_row.status = 'active'
      and course_row.trashed_at is null
      and (p_course_id is null or course_row.id = p_course_id)
      and (p_lecture_id is null or lecture_row.id = p_lecture_id)
    group by lecture_row.id, course_row.id, course_row.title, course_row.product_code,
      lecture_row.no, lecture_row.name, release_row.release_no
  ), scoped as (
    select lecture_rows.*,
      (lecture_rows.missing_page_count = 0
       and lecture_rows.unresolved_binding_count = 0
       and lecture_rows.blocked_background_count = 0) as ready
    from lecture_rows
    where p_scope = 'all'
      or (p_scope = 'pending' and (lecture_rows.current_release_no is null or lecture_rows.has_unpublished_changes))
      or (p_scope = 'published' and lecture_rows.current_release_no is not null and not lecture_rows.has_unpublished_changes)
  )
  select scoped.lecture_id, scoped.course_id, scoped.course_title, scoped.product_code,
    scoped.lecture_no, scoped.lecture_name, scoped.page_count, scoped.current_release_no,
    scoped.has_unpublished_changes, scoped.blocked_background_count, scoped.ready,
    count(*) over() as total_count
  from scoped
  order by scoped.course_title, scoped.lecture_no
  offset bounded_offset limit bounded_limit;
end;
$$;

create or replace function public.publish_cw_adapt_releases(
  p_lecture_ids uuid[],
  p_note text default ''
)
returns table (lecture_id uuid, release_id uuid)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  requested_count integer := coalesce(cardinality(p_lecture_ids), 0);
  requested_lecture_id uuid;
  published_release_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'courseware.release.publish') then raise exception 'FORBIDDEN'; end if;
  if requested_count < 1 or requested_count > 30
    or (select count(distinct item) from unnest(p_lecture_ids) item) <> requested_count then
    raise exception 'INVALID_LECTURE_SELECTION';
  end if;

  foreach requested_lecture_id in array p_lecture_ids loop
    published_release_id := public.publish_cw_track_release(
      requested_lecture_id,
      'adapted-4x3',
      left(trim(coalesce(p_note, '')), 1000)
    );
    update public.cw_lecture_workflows
       set stage = 'idle', current_review_round = null, required_review_rounds_snapshot = null,
           active_review_cycle_id = null, internal_due_at = null, updated_by = uid, updated_at = now()
     where cw_lecture_workflows.lecture_id = requested_lecture_id
       and track = 'adapted-4x3'
       and active_review_cycle_id is null;
    lecture_id := requested_lecture_id;
    release_id := published_release_id;
    return next;
  end loop;
end;
$$;

-- 建班候选首次打开即返回最多 30 个紧凑版本摘要；不下发 865 讲明细。
create or replace function public.list_class_build_course_variants(
  p_query text default '',
  p_grade smallint default null,
  p_course_season smallint default null,
  p_class_type text default null,
  p_purpose text default 'production',
  p_limit integer default 30
)
returns table (
  course_id uuid,
  family_id uuid,
  family_title text,
  variant_title text,
  product_code text,
  grade smallint,
  course_season smallint,
  class_type text,
  lecture_count integer,
  released_lecture_count integer
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  normalized_query text := left(lower(btrim(coalesce(p_query, ''))), 80);
  normalized_class_type text := nullif(left(btrim(coalesce(p_class_type, '')), 20), '');
  bounded_limit integer := least(greatest(coalesce(p_limit, 30), 1), 30);
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
  if p_purpose not in ('production', 'test') then raise exception 'INVALID_PURPOSE'; end if;
  if p_grade is not null and (p_grade < 1 or p_grade > 12) then raise exception 'INVALID_GRADE'; end if;
  if p_course_season is not null and p_course_season not between 1 and 4 then raise exception 'INVALID_COURSE_SEASON'; end if;

  return query
  select
    course_row.id,
    family_row.id,
    family_row.title,
    course_row.title,
    course_row.product_code,
    course_row.grade,
    course_row.term,
    course_row.class_type,
    counts.lecture_count,
    counts.released_lecture_count
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  cross join lateral (
    select
      count(*) filter (where lecture_row.status = 'active')::integer as lecture_count,
      count(*) filter (
        where lecture_row.status = 'active'
          and coalesce(native_head.current_release_id, lecture_row.current_release_id) is not null
      )::integer as released_lecture_count
    from public.course_lectures lecture_row
    left join public.cw_lecture_track_heads native_head
      on native_head.lecture_id = lecture_row.id and native_head.track = 'native-16x9'
    where lecture_row.course_id = course_row.id
  ) counts
  where family_row.status = 'enabled'
    and family_row.purpose = p_purpose
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and course_row.purpose = p_purpose
    and (p_grade is null or course_row.grade = p_grade)
    and (p_course_season is null or course_row.term = p_course_season)
    and (normalized_class_type is null or course_row.class_type = normalized_class_type)
    and (
      normalized_query = ''
      or lower(family_row.title) like '%' || normalized_query || '%'
      or lower(course_row.title) like '%' || normalized_query || '%'
      or lower(coalesce(course_row.product_code, '')) like '%' || normalized_query || '%'
      or exists (
        select 1 from public.course_lectures lecture_match
        where lecture_match.course_id = course_row.id
          and lecture_match.status = 'active'
          and lower(lecture_match.name) like '%' || normalized_query || '%'
      )
    )
  order by family_row.title, course_row.grade, course_row.term, course_row.class_type, course_row.title
  limit bounded_limit;
end;
$$;

create or replace function public.get_class_build_course_detail(
  p_course_id uuid,
  p_purpose text default 'production'
)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
  if p_purpose not in ('production', 'test') then raise exception 'INVALID_PURPOSE'; end if;

  select jsonb_build_object(
    'id', course_row.id,
    'familyId', family_row.id,
    'familyTitle', family_row.title,
    'title', course_row.title,
    'productCode', course_row.product_code,
    'grade', course_row.grade,
    'courseSeason', course_row.term,
    'classType', course_row.class_type,
    'lectureCount', counts.lecture_count,
    'releasedLectureCount', counts.released_lecture_count,
    'lectures', coalesce(lectures.rows, '[]'::jsonb)
  ) into result
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  cross join lateral (
    select
      count(*) filter (where lecture_row.status = 'active')::integer as lecture_count,
      count(*) filter (
        where lecture_row.status = 'active'
          and coalesce(native_head.current_release_id, lecture_row.current_release_id) is not null
      )::integer as released_lecture_count
    from public.course_lectures lecture_row
    left join public.cw_lecture_track_heads native_head
      on native_head.lecture_id = lecture_row.id and native_head.track = 'native-16x9'
    where lecture_row.course_id = course_row.id
  ) counts
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', lecture_row.id,
      'no', lecture_row.no,
      'name', lecture_row.name,
      'objectives', lecture_row.objectives,
      'ready', coalesce(native_head.current_release_id, lecture_row.current_release_id) is not null
    ) order by lecture_row.no) as rows
    from public.course_lectures lecture_row
    left join public.cw_lecture_track_heads native_head
      on native_head.lecture_id = lecture_row.id and native_head.track = 'native-16x9'
    where lecture_row.course_id = course_row.id
      and lecture_row.status = 'active'
  ) lectures
  where course_row.id = p_course_id
    and family_row.status = 'enabled'
    and family_row.purpose = p_purpose
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and course_row.purpose = p_purpose;

  if result is null then raise exception 'COURSE_NOT_AVAILABLE'; end if;
  return result;
end;
$$;

revoke all on function public.get_cw_adapt_filter_options(uuid) from public, anon, authenticated;
revoke all on function public.list_cw_adapt_background_review_queue(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.list_cw_adapt_page_review_queue(text, uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.list_cw_adapt_release_queue(uuid, uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.publish_cw_adapt_releases(uuid[], text) from public, anon, authenticated;
grant execute on function public.get_cw_adapt_filter_options(uuid) to authenticated;
grant execute on function public.list_cw_adapt_background_review_queue(uuid, uuid, integer, integer) to authenticated;
grant execute on function public.list_cw_adapt_page_review_queue(text, uuid, uuid, integer, integer) to authenticated;
grant execute on function public.list_cw_adapt_release_queue(uuid, uuid, text, integer, integer) to authenticated;
grant execute on function public.publish_cw_adapt_releases(uuid[], text) to authenticated;

