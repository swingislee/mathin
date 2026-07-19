begin;

-- The source migration already uses the explicit cast. Re-apply the function
-- for development databases that received its first implementation before the
-- smallint-to-integer result mismatch was discovered.
create or replace function public.list_courseware_tasks(
  p_tab text default 'incomplete',
  p_query text default '',
  p_limit integer default 60
)
returns table (
  lecture_id uuid,
  family_id uuid,
  family_title text,
  course_id uuid,
  course_title text,
  product_code text,
  lecture_no integer,
  lecture_name text,
  track text,
  page_count integer,
  has_draft boolean,
  release_no integer,
  last_edited_at timestamptz,
  last_editor_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
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
  ) then
    raise exception 'FORBIDDEN';
  end if;

  if normalized_tab not in ('incomplete', 'recent', 'publish') then
    raise exception 'INVALID_TASK_TAB';
  end if;

  return query
  with track_rows as (
    select
      lecture.id as lecture_id,
      family.id as family_id,
      family.title as family_title,
      course.id as course_id,
      course.title as course_title,
      course.product_code,
      lecture.no::integer as lecture_no,
      lecture.name as lecture_name,
      requested_track.track,
      track_head.current_release_id
    from public.course_lectures as lecture
    join public.courses as course on course.id = lecture.course_id
    join public.course_families as family on family.id = course.family_id
    cross join lateral (
      values ('native-16x9'::text), ('adapted-4x3'::text)
    ) as requested_track(track)
    left join public.cw_lecture_track_heads as track_head
      on track_head.lecture_id = lecture.id
      and track_head.track = requested_track.track
    where requested_track.track = 'native-16x9'
      or track_head.lecture_id is not null
  ), page_stats as (
    select page.lecture_id, count(*)::integer as page_count
    from public.cw_page_docs as page
    where page.deleted_at is null
    group by page.lecture_id
  ), draft_stats as (
    select
      page.lecture_id,
      page_head.track,
      bool_or(page_head.draft_revision_id is not null) as has_draft
    from public.cw_page_docs as page
    join public.cw_page_track_heads as page_head on page_head.page_doc_id = page.id
    where page.deleted_at is null
    group by page.lecture_id, page_head.track
  ), latest_revisions as (
    select distinct on (page.lecture_id, revision.track)
      page.lecture_id,
      revision.track,
      revision.created_at as last_edited_at,
      profile.display_name as last_editor_name
    from public.cw_page_docs as page
    join public.cw_page_revisions as revision on revision.page_doc_id = page.id
    left join public.profiles as profile on profile.id = revision.created_by
    where page.deleted_at is null
    order by page.lecture_id, revision.track, revision.created_at desc, revision.id desc
  )
  select
    task.lecture_id,
    task.family_id,
    task.family_title,
    task.course_id,
    task.course_title,
    task.product_code,
    task.lecture_no,
    task.lecture_name,
    task.track,
    coalesce(page_stats.page_count, 0),
    coalesce(draft_stats.has_draft, false),
    release.release_no,
    latest_revisions.last_edited_at,
    latest_revisions.last_editor_name
  from track_rows as task
  left join page_stats on page_stats.lecture_id = task.lecture_id
  left join draft_stats on draft_stats.lecture_id = task.lecture_id and draft_stats.track = task.track
  left join public.cw_lecture_releases as release on release.id = task.current_release_id
  left join latest_revisions on latest_revisions.lecture_id = task.lecture_id and latest_revisions.track = task.track
  where (
    normalized_query = ''
    or task.family_title ilike '%' || normalized_query || '%'
    or coalesce(task.product_code, '') ilike '%' || normalized_query || '%'
    or task.course_title ilike '%' || normalized_query || '%'
    or task.lecture_name ilike '%' || normalized_query || '%'
  )
    and case normalized_tab
      when 'incomplete' then task.current_release_id is null
      when 'recent' then latest_revisions.last_edited_at is not null
      when 'publish' then coalesce(draft_stats.has_draft, false)
    end
  order by
    case when normalized_tab = 'recent' then latest_revisions.last_edited_at end desc nulls last,
    case when normalized_tab = 'incomplete' then task.current_release_id is null end desc,
    task.family_title,
    task.product_code,
    task.lecture_no,
    task.track
  limit bounded_limit;
end;
$$;

commit;
