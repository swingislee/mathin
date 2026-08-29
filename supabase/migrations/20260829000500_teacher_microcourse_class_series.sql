-- DEV-TMC-3: the saved teacher microcourse is rooted at a free classroom.
-- Session proposals remain independently editable/reviewable, while proposals
-- from the same classroom/author series share one course with many lectures.

begin;

drop trigger if exists course_lectures_guard_microcourse_single on public.course_lectures;
drop function if exists public.guard_microcourse_single_lecture();

alter table public.teacher_microcourses
  drop constraint if exists teacher_microcourses_course_id_key;

alter table public.teacher_microcourses
  add column source_classroom_id uuid;

update public.teacher_microcourses microcourse
set source_classroom_id = session.classroom_id
from public.class_sessions session
where session.id = microcourse.source_session_id;

alter table public.teacher_microcourses
  alter column source_classroom_id set not null,
  add constraint teacher_microcourses_source_classroom_id_fkey
    foreign key (source_classroom_id) references public.classrooms(id) on delete restrict;

create index teacher_microcourses_classroom_author_idx
  on public.teacher_microcourses(source_classroom_id, author_id, created_at);

-- Existing variants are paired into deterministic classroom-level series. The
-- first proposal per author/session is series 1, the second is series 2, etc.
-- This preserves parallel proposals without turning each lesson into a course.
create temporary table teacher_microcourse_series_map on commit drop as
with ranked as (
  select
    microcourse.id as microcourse_id,
    microcourse.course_id as old_course_id,
    microcourse.lecture_id,
    microcourse.source_classroom_id,
    microcourse.source_session_id,
    microcourse.author_id,
    microcourse.created_at,
    session.scheduled_at,
    row_number() over (
      partition by microcourse.source_classroom_id, microcourse.author_id, microcourse.source_session_id
      order by microcourse.created_at, microcourse.id
    ) as series_slot
  from public.teacher_microcourses microcourse
  join public.class_sessions session on session.id = microcourse.source_session_id
), grouped as (
  select
    ranked.*,
    first_value(ranked.old_course_id) over (
      partition by ranked.source_classroom_id, ranked.author_id, ranked.series_slot
      order by ranked.created_at, ranked.microcourse_id
    ) as canonical_course_id
  from ranked
)
select
  grouped.*,
  row_number() over (
    partition by grouped.canonical_course_id
    order by grouped.scheduled_at, grouped.source_session_id, grouped.created_at, grouped.microcourse_id
  ) as lecture_no
from grouped;

-- Move all numbers away from the positive target range before re-parenting, so
-- unique(course_id, no) cannot collide during the set-based update.
update public.course_lectures lecture
set no = (-series.lecture_no)::smallint
from teacher_microcourse_series_map series
where lecture.id = series.lecture_id;

update public.course_lectures lecture
set course_id = series.canonical_course_id,
    no = series.lecture_no::smallint
from teacher_microcourse_series_map series
where lecture.id = series.lecture_id;

update public.teacher_microcourses microcourse
set course_id = series.canonical_course_id
from teacher_microcourse_series_map series
where microcourse.id = series.microcourse_id;

-- Course-level title/grade/season come from the source classroom. The first
-- lesson metadata only fills a missing classroom grade or legacy term.
with series_metadata as (
  select distinct on (series.canonical_course_id)
    series.canonical_course_id,
    classroom.name as classroom_name,
    classroom.grade as classroom_grade,
    school_term.term as classroom_season,
    metadata.grade as fallback_grade,
    metadata.course_season as fallback_season
  from teacher_microcourse_series_map series
  join public.classrooms classroom on classroom.id = series.source_classroom_id
  left join public.school_terms school_term on school_term.id = classroom.term_id
  left join public.teacher_microcourses microcourse on microcourse.id = series.microcourse_id
  left join public.teacher_microcourse_metadata_revisions metadata
    on metadata.id = microcourse.draft_metadata_revision_id
  order by series.canonical_course_id, series.created_at, series.microcourse_id
)
update public.courses course
set title = left(btrim(series_metadata.classroom_name), 100),
    grade = coalesce(
      case when series_metadata.classroom_grade between 1 and 9 then series_metadata.classroom_grade end,
      series_metadata.fallback_grade,
      course.grade
    ),
    term = coalesce(series_metadata.classroom_season, series_metadata.fallback_season, course.term),
    status = case when not exists (
      select 1
      from public.course_lectures lecture
      left join public.cw_lecture_track_heads native_head
        on native_head.lecture_id = lecture.id and native_head.track = 'native-16x9'
      left join public.teacher_microcourses lesson on lesson.lecture_id = lecture.id
      where lecture.course_id = course.id
        and lecture.status = 'active'
        and (
          coalesce(native_head.current_release_id, lecture.current_release_id) is null
          or lesson.published_metadata_revision_id is null
          or lesson.withdrawn_at is not null
        )
    ) then 'enabled' else 'draft' end,
    updated_at = now()
from series_metadata
where course.id = series_metadata.canonical_course_id;

-- Empty legacy one-lesson containers remain recoverable rows and point to the
-- canonical classroom course, but no longer appear in any current catalog.
with superseded as (
  select distinct old_course_id, canonical_course_id
  from teacher_microcourse_series_map
  where old_course_id <> canonical_course_id
)
update public.courses course
set status = 'disabled',
    trashed_at = coalesce(course.trashed_at, now()),
    superseded_by_course_id = superseded.canonical_course_id,
    updated_at = now()
from superseded
where course.id = superseded.old_course_id
  and not exists (
    select 1 from public.teacher_microcourses microcourse
    where microcourse.course_id = course.id
  );

create unique index teacher_microcourses_course_session_series_idx
  on public.teacher_microcourses(course_id, source_session_id);

create or replace function public.guard_teacher_microcourse_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.courses course_row
    join public.course_lectures lecture_row
      on lecture_row.id = new.lecture_id
     and lecture_row.course_id = course_row.id
    where course_row.id = new.course_id
      and course_row.course_kind = 'microcourse'
  ) then
    raise exception 'INVALID_MICROCOURSE_COURSE_LECTURE';
  end if;
  if not exists (
    select 1
    from public.class_sessions session_row
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    where session_row.id = new.source_session_id
      and session_row.classroom_id = new.source_classroom_id
      and session_row.deleted_at is null
      and session_row.lecture_id is null
      and classroom_row.course_id is null
  ) then
    raise exception 'MICROCOURSE_SOURCE_MUST_BE_FREE_SESSION';
  end if;
  return new;
end;
$$;

drop trigger if exists teacher_microcourses_guard_integrity on public.teacher_microcourses;
create trigger teacher_microcourses_guard_integrity
  before insert or update of source_classroom_id, source_session_id, course_id, lecture_id
  on public.teacher_microcourses
  for each row execute function public.guard_teacher_microcourse_integrity();

create or replace function public.create_teacher_microcourse_variant(
  p_source_session_id uuid,
  p_variant_name text,
  p_title text,
  p_description text,
  p_grade smallint,
  p_course_season smallint default null,
  p_class_type text default '',
  p_primary_topic_slug text default 'integrated-practice',
  p_keywords text[] default '{}'::text[]
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  family_id uuid;
  catalog_version_id uuid;
  v_source_classroom_id uuid;
  v_source_classroom_name text;
  v_source_classroom_grade smallint;
  v_source_classroom_season smallint;
  course_grade smallint;
  course_season smallint;
  series_course_id uuid;
  next_lecture_no smallint;
  new_lecture_id uuid;
  new_microcourse_id uuid;
  metadata_revision_id uuid;
  topic_id uuid;
  clean_keywords text[];
begin
  if not public.can_create_teacher_microcourse_variant(p_source_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  if char_length(btrim(coalesce(p_variant_name, ''))) not between 1 and 120 then
    raise exception 'VALIDATION';
  end if;
  topic_id := public.assert_teacher_microcourse_metadata(
    p_title, p_description, p_grade, p_course_season,
    p_class_type, p_primary_topic_slug, p_keywords
  );
  clean_keywords := public.normalize_teacher_microcourse_keywords(p_keywords);

  select classroom.id, classroom.name, classroom.grade, school_term.term
  into v_source_classroom_id, v_source_classroom_name, v_source_classroom_grade, v_source_classroom_season
  from public.class_sessions session
  join public.classrooms classroom on classroom.id = session.classroom_id
  left join public.school_terms school_term on school_term.id = classroom.term_id
  where session.id = p_source_session_id;
  if v_source_classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  course_grade := coalesce(
    case when v_source_classroom_grade between 1 and 9 then v_source_classroom_grade end,
    p_grade
  );
  course_season := coalesce(v_source_classroom_season, p_course_season);

  perform pg_advisory_xact_lock(hashtext(
    'teacher-microcourse-series:' || v_source_classroom_id::text || ':' || uid::text
  ));
  select family.id, version.id into family_id, catalog_version_id
  from public.course_families family
  join public.course_catalog_versions version
    on version.family_id = family.id and version.is_current
  where family.slug = 'teacher-microcourses'
    and family.status = 'enabled';
  if family_id is null or catalog_version_id is null then
    raise exception 'MICROCOURSE_FAMILY_MISSING';
  end if;

  -- Reuse the oldest series by this author that does not already contain this
  -- source lesson. A second proposal for the same lesson starts series 2.
  select candidate.course_id into series_course_id
  from (
    select microcourse.course_id, min(microcourse.created_at) as created_at
    from public.teacher_microcourses microcourse
    join public.courses course_row on course_row.id = microcourse.course_id
    where microcourse.source_classroom_id = v_source_classroom_id
      and microcourse.author_id = uid
      and course_row.course_kind = 'microcourse'
      and course_row.trashed_at is null
      and not exists (
        select 1
        from public.teacher_microcourses same_session
        where same_session.course_id = microcourse.course_id
          and same_session.source_session_id = p_source_session_id
      )
    group by microcourse.course_id
    order by min(microcourse.created_at), microcourse.course_id
    limit 1
  ) candidate;

  if series_course_id is null then
    insert into public.courses(
      family_id, catalog_version_id, title, grade, term, class_type,
      status, purpose, course_kind, created_by
    ) values (
      family_id, catalog_version_id, left(btrim(v_source_classroom_name), 100),
      course_grade, course_season, btrim(coalesce(p_class_type, '')),
      'draft', 'production', 'microcourse', uid
    ) returning id into series_course_id;
  else
    update public.courses
    set title = left(btrim(v_source_classroom_name), 100),
        grade = course_grade,
        term = course_season,
        status = 'draft',
        updated_at = now()
    where id = series_course_id;
  end if;

  select (coalesce(max(lecture.no), 0) + 1)::smallint into next_lecture_no
  from public.course_lectures lecture
  where lecture.course_id = series_course_id;

  insert into public.course_lectures(course_id, no, name, objectives, status)
  values (series_course_id, next_lecture_no, btrim(p_title), coalesce(p_description, ''), 'active')
  returning id into new_lecture_id;

  insert into public.teacher_microcourses(
    source_classroom_id, source_session_id, author_id, course_id, lecture_id, variant_name
  ) values (
    v_source_classroom_id, p_source_session_id, uid, series_course_id, new_lecture_id,
    btrim(p_variant_name)
  ) returning id into new_microcourse_id;

  insert into public.teacher_microcourse_metadata_revisions(
    microcourse_id, revision_no, title, description, grade, course_season,
    class_type, primary_topic_id, keywords, created_by
  ) values (
    new_microcourse_id, 1, btrim(p_title), coalesce(p_description, ''), p_grade,
    p_course_season, btrim(coalesce(p_class_type, '')), topic_id, clean_keywords, uid
  ) returning id into metadata_revision_id;

  update public.teacher_microcourses
  set draft_metadata_revision_id = metadata_revision_id
  where id = new_microcourse_id;

  update public.class_sessions
  set selected_teacher_microcourse_id = new_microcourse_id
  where id = p_source_session_id
    and selected_teacher_microcourse_id is null
    and courseware_frozen_at is null
    and started_at is null;

  perform public.emit_domain_event(
    'teacher_microcourse.variant_created', 'teacher_microcourse', new_microcourse_id,
    jsonb_build_object(
      'sourceClassroomId', v_source_classroom_id,
      'sourceSessionId', p_source_session_id,
      'courseId', series_course_id,
      'lectureId', new_lecture_id,
      'metadataRevisionId', metadata_revision_id,
      'variantName', btrim(p_variant_name)
    ), null, null
  );
  return new_microcourse_id;
end;
$$;

create or replace function public.publish_teacher_microcourse_review_internal(
  p_review_cycle_id uuid,
  p_note text,
  p_uid uuid
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  cycle_row public.cw_review_cycles%rowtype;
  micro_snapshot public.teacher_microcourse_review_snapshots%rowtype;
  microcourse_row public.teacher_microcourses%rowtype;
  metadata_row public.teacher_microcourse_metadata_revisions%rowtype;
  release_id uuid;
begin
  select cycle.* into cycle_row
  from public.cw_review_cycles cycle
  join public.teacher_microcourse_review_snapshots snapshot_row
    on snapshot_row.review_cycle_id = cycle.id
  where cycle.id = p_review_cycle_id
  for update of cycle;
  if not found or cycle_row.status <> 'passed' then raise exception 'NOT_READY_TO_PUBLISH'; end if;
  select * into micro_snapshot
  from public.teacher_microcourse_review_snapshots
  where review_cycle_id = p_review_cycle_id;
  select * into microcourse_row from public.teacher_microcourses
  where id = micro_snapshot.microcourse_id for update;
  select * into metadata_row from public.teacher_microcourse_metadata_revisions
  where id = micro_snapshot.metadata_revision_id
    and microcourse_id = micro_snapshot.microcourse_id;
  if not found then raise exception 'MICROCOURSE_METADATA_REQUIRED'; end if;
  if not public.teacher_microcourse_h5_promotions_are_ready(p_review_cycle_id) then
    raise exception 'H5_PROMOTION_REQUIRED';
  end if;
  release_id := public.perform_cw_publish(
    cycle_row.lecture_id, 'native-16x9', p_note,
    cycle_row.content_snapshot, p_uid
  );
  update public.cw_page_docs
  set aspect = '4:3'
  where lecture_id = microcourse_row.lecture_id
    and doc_version = 'microcourse-page-v1';
  update public.course_lectures
  set name = metadata_row.title,
      objectives = metadata_row.description,
      status = 'active'
  where id = microcourse_row.lecture_id;
  update public.teacher_microcourses
  set published_metadata_revision_id = micro_snapshot.metadata_revision_id,
      first_published_at = coalesce(first_published_at, now()),
      last_published_at = now(),
      withdrawn_at = null
  where id = micro_snapshot.microcourse_id;
  update public.courses course
  set status = case when not exists (
        select 1
        from public.course_lectures lecture
        left join public.cw_lecture_track_heads native_head
          on native_head.lecture_id = lecture.id and native_head.track = 'native-16x9'
        left join public.teacher_microcourses lesson on lesson.lecture_id = lecture.id
        where lecture.course_id = course.id
          and lecture.status = 'active'
          and (
            coalesce(native_head.current_release_id, lecture.current_release_id) is null
            or lesson.published_metadata_revision_id is null
            or lesson.withdrawn_at is not null
          )
      ) then 'enabled' else 'draft' end,
      updated_at = now()
  where course.id = microcourse_row.course_id;
  update public.teacher_microcourse_h5_artifacts artifact
  set status = 'published',
      public_path = 'packages/' || artifact.sha256 || '/index.html',
      published_at = coalesce(artifact.published_at, now())
  where artifact.microcourse_id = micro_snapshot.microcourse_id
    and artifact.sha256 in (
      select hash_item.value
      from jsonb_array_elements_text(micro_snapshot.h5_hashes) hash_item
    );
  update public.cw_review_cycles
  set status = 'published',
      published_release_id = release_id,
      closed_at = coalesce(closed_at, now())
  where id = p_review_cycle_id;
  update public.cw_lecture_workflows
  set stage = 'idle', current_review_round = null,
      required_review_rounds_snapshot = null,
      active_review_cycle_id = null, internal_due_at = null,
      updated_by = p_uid, updated_at = now()
  where lecture_id = microcourse_row.lecture_id and track = 'native-16x9';
  perform public.emit_domain_event(
    'teacher_microcourse.published', 'teacher_microcourse', micro_snapshot.microcourse_id,
    jsonb_build_object(
      'sourceClassroomId', microcourse_row.source_classroom_id,
      'reviewCycleId', p_review_cycle_id,
      'releaseId', release_id,
      'metadataRevisionId', micro_snapshot.metadata_revision_id
    ), null, null
  );
  return release_id;
end;
$$;

create or replace function public.withdraw_teacher_microcourse(p_microcourse_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare microcourse_row public.teacher_microcourses%rowtype;
begin
  select * into microcourse_row from public.teacher_microcourses
  where id = p_microcourse_id for update;
  if not found then raise exception 'MICROCOURSE_NOT_FOUND'; end if;
  if auth.uid() is null or not (
    public.can_author_teacher_microcourse(p_microcourse_id, auth.uid())
    or public.is_admin(auth.uid())
    or public.has_perm(auth.uid(), 'courseware.review')
  ) then raise exception 'FORBIDDEN'; end if;
  if microcourse_row.published_metadata_revision_id is null then
    raise exception 'MICROCOURSE_NOT_PUBLISHED';
  end if;
  update public.teacher_microcourses set withdrawn_at = now()
  where id = p_microcourse_id;
  update public.courses set status = 'draft', updated_at = now()
  where id = microcourse_row.course_id;
  perform public.emit_domain_event(
    'teacher_microcourse.withdrawn', 'teacher_microcourse', p_microcourse_id,
    jsonb_build_object(
      'sourceClassroomId', microcourse_row.source_classroom_id,
      'courseId', microcourse_row.course_id,
      'lectureId', microcourse_row.lecture_id
    ), null, null
  );
end;
$$;

create or replace function public.teacher_microcourse_course_is_publishable(p_course_id uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.course_lectures lecture
    where lecture.course_id = p_course_id and lecture.status = 'active'
  ) and not exists (
    select 1
    from public.course_lectures lecture
    left join public.cw_lecture_track_heads native_head
      on native_head.lecture_id = lecture.id and native_head.track = 'native-16x9'
    left join public.teacher_microcourses lesson on lesson.lecture_id = lecture.id
    where lecture.course_id = p_course_id
      and lecture.status = 'active'
      and (
        coalesce(native_head.current_release_id, lecture.current_release_id) is null
        or lesson.published_metadata_revision_id is null
        or lesson.withdrawn_at is not null
      )
  )
$$;

create or replace function public.teacher_microcourse_course_catalog_metadata(p_course_id uuid)
returns table(
  author_id uuid,
  author_name text,
  primary_topic_slug text,
  primary_topic_title_zh text,
  primary_topic_title_en text,
  keywords text[],
  last_published_at timestamptz
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select
    course_row.created_by,
    author_profile.display_name,
    representative.slug,
    representative.title_zh,
    representative.title_en,
    coalesce(representative.keywords, '{}'::text[]),
    publication.last_published_at
  from public.courses course_row
  left join public.profiles author_profile on author_profile.id = course_row.created_by
  left join lateral (
    select
      topic.slug,
      topic.title_zh,
      topic.title_en,
      metadata.keywords
    from public.teacher_microcourses microcourse
    join public.teacher_microcourse_metadata_revisions metadata
      on metadata.id = microcourse.published_metadata_revision_id
    left join public.teacher_microcourse_topics topic on topic.id = metadata.primary_topic_id
    where microcourse.course_id = course_row.id
      and microcourse.withdrawn_at is null
    order by microcourse.last_published_at desc nulls last,
             microcourse.created_at,
             microcourse.id
    limit 1
  ) representative on true
  left join lateral (
    select max(microcourse.last_published_at) as last_published_at
    from public.teacher_microcourses microcourse
    where microcourse.course_id = course_row.id
      and microcourse.withdrawn_at is null
  ) publication on true
  where course_row.id = p_course_id
$$;

create or replace function public.list_class_build_course_variants(
  p_query text default '',
  p_grade smallint default null,
  p_course_season smallint default null,
  p_class_type text default null,
  p_purpose text default 'production',
  p_limit integer default 30,
  p_include_superseded boolean default false,
  p_course_kind text default null,
  p_author_id uuid default null,
  p_primary_topic_slug text default null,
  p_keyword text default null
)
returns table(
  course_id uuid,
  family_id uuid,
  family_title text,
  variant_title text,
  product_code text,
  catalog_version_slug text,
  catalog_version_title text,
  is_superseded boolean,
  grade smallint,
  course_season smallint,
  class_type text,
  lecture_count integer,
  released_lecture_count integer,
  course_kind text,
  author_id uuid,
  author_name text,
  primary_topic_slug text,
  primary_topic_title_zh text,
  primary_topic_title_en text,
  keywords text[]
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  normalized_query text := left(lower(btrim(coalesce(p_query, ''))), 100);
  normalized_class_type text := nullif(left(btrim(coalesce(p_class_type, '')), 40), '');
  normalized_keyword text := nullif(left(lower(btrim(coalesce(p_keyword, ''))), 32), '');
  bounded_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  can_build_class boolean := uid is not null and public.has_perm(uid, 'class.create');
  can_select_microcourse_source boolean := uid is not null
    and public.has_perm(uid, 'courseware.microcourse.author')
    and public.is_feature_enabled('teaching.teacher_microcourses_v1')
    and p_purpose = 'production'
    and p_course_kind = 'curriculum'
    and p_author_id is null
    and p_primary_topic_slug is null
    and p_keyword is null;
begin
  if uid is null or not (can_build_class or can_select_microcourse_source) then
    raise exception 'FORBIDDEN';
  end if;
  if p_purpose not in ('production', 'test') then raise exception 'INVALID_PURPOSE'; end if;
  if p_grade is not null and p_grade not between 1 and 12 then raise exception 'INVALID_GRADE'; end if;
  if p_course_season is not null and p_course_season not between 1 and 4 then
    raise exception 'INVALID_COURSE_SEASON';
  end if;
  if p_course_kind is not null and p_course_kind not in ('curriculum', 'microcourse') then
    raise exception 'INVALID_COURSE_KIND';
  end if;

  return query
  select
    course_row.id,
    family_row.id,
    family_row.title,
    course_row.title,
    course_row.product_code,
    version_row.slug,
    version_row.title,
    course_row.superseded_by_course_id is not null,
    course_row.grade,
    course_row.term,
    course_row.class_type,
    counts.lecture_count,
    counts.released_lecture_count,
    course_row.course_kind,
    catalog.author_id,
    catalog.author_name,
    catalog.primary_topic_slug,
    catalog.primary_topic_title_zh,
    catalog.primary_topic_title_en,
    catalog.keywords
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
  left join lateral public.teacher_microcourse_course_catalog_metadata(course_row.id) catalog
    on course_row.course_kind = 'microcourse'
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
    and (coalesce(p_include_superseded, false) or course_row.superseded_by_course_id is null)
    and (p_course_kind is null or course_row.course_kind = p_course_kind)
    and (p_grade is null or course_row.grade = p_grade)
    and (p_course_season is null or course_row.term = p_course_season)
    and (normalized_class_type is null or course_row.class_type = normalized_class_type)
    and (p_author_id is null or catalog.author_id = p_author_id)
    and (p_primary_topic_slug is null or exists (
      select 1
      from public.teacher_microcourses lesson
      join public.teacher_microcourse_metadata_revisions metadata
        on metadata.id = lesson.published_metadata_revision_id
      join public.teacher_microcourse_topics topic on topic.id = metadata.primary_topic_id
      where lesson.course_id = course_row.id
        and lesson.withdrawn_at is null
        and topic.slug = p_primary_topic_slug
    ))
    and (
      normalized_keyword is null
      or exists (
        select 1
        from public.teacher_microcourses lesson
        join public.teacher_microcourse_metadata_revisions metadata
          on metadata.id = lesson.published_metadata_revision_id
        cross join lateral unnest(coalesce(metadata.keywords, '{}'::text[])) keyword_value
        where lesson.course_id = course_row.id
          and lesson.withdrawn_at is null
          and lower(keyword_value) like '%' || normalized_keyword || '%'
      )
    )
    and (
      course_row.course_kind = 'curriculum'
      or public.teacher_microcourse_course_is_publishable(course_row.id)
    )
    and (
      normalized_query = ''
      or lower(family_row.title) like '%' || normalized_query || '%'
      or lower(course_row.title) like '%' || normalized_query || '%'
      or lower(coalesce(course_row.product_code, '')) like '%' || normalized_query || '%'
      or lower(coalesce(catalog.author_name, '')) like '%' || normalized_query || '%'
      or lower(coalesce(catalog.primary_topic_title_zh, '')) like '%' || normalized_query || '%'
      or lower(coalesce(catalog.primary_topic_title_en, '')) like '%' || normalized_query || '%'
      or exists (
        select 1 from public.course_lectures lecture_match
        where lecture_match.course_id = course_row.id
          and lecture_match.status = 'active'
          and lower(lecture_match.name) like '%' || normalized_query || '%'
      )
      or exists (
        select 1
        from public.teacher_microcourses lesson
        join public.teacher_microcourse_metadata_revisions metadata
          on metadata.id = lesson.published_metadata_revision_id
        cross join lateral unnest(coalesce(metadata.keywords, '{}'::text[])) keyword_value
        where lesson.course_id = course_row.id
          and lesson.withdrawn_at is null
          and lower(keyword_value) like '%' || normalized_query || '%'
      )
    )
  order by
    case when course_row.course_kind = 'microcourse' then 0 else 1 end,
    coalesce(catalog.last_published_at, course_row.updated_at) desc,
    family_row.title,
    version_row.sort_order desc,
    course_row.grade,
    course_row.term nulls last,
    course_row.class_type,
    course_row.title
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
  can_build_class boolean := uid is not null and public.has_perm(uid, 'class.create');
  can_select_microcourse_source boolean := uid is not null
    and public.has_perm(uid, 'courseware.microcourse.author')
    and public.is_feature_enabled('teaching.teacher_microcourses_v1')
    and p_purpose = 'production';
begin
  if uid is null or not (can_build_class or can_select_microcourse_source) then
    raise exception 'FORBIDDEN';
  end if;
  if p_purpose not in ('production', 'test') then raise exception 'INVALID_PURPOSE'; end if;

  select jsonb_build_object(
    'id', course_row.id,
    'familyId', family_row.id,
    'familyTitle', family_row.title,
    'title', course_row.title,
    'productCode', course_row.product_code,
    'catalogVersionSlug', version_row.slug,
    'catalogVersionTitle', version_row.title,
    'isSuperseded', course_row.superseded_by_course_id is not null,
    'grade', course_row.grade,
    'courseSeason', course_row.term,
    'classType', course_row.class_type,
    'lectureCount', counts.lecture_count,
    'releasedLectureCount', counts.released_lecture_count,
    'courseKind', course_row.course_kind,
    'authorId', catalog.author_id,
    'authorName', catalog.author_name,
    'primaryTopicSlug', catalog.primary_topic_slug,
    'primaryTopicTitleZh', catalog.primary_topic_title_zh,
    'primaryTopicTitleEn', catalog.primary_topic_title_en,
    'keywords', catalog.keywords,
    'lectures', coalesce(lectures.rows, '[]'::jsonb)
  ) into result
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
  left join lateral public.teacher_microcourse_course_catalog_metadata(course_row.id) catalog
    on course_row.course_kind = 'microcourse'
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
    where lecture_row.course_id = course_row.id and lecture_row.status = 'active'
  ) lectures
  where course_row.id = p_course_id
    and family_row.status = 'enabled'
    and family_row.purpose = p_purpose
    and course_row.status = 'enabled'
    and course_row.trashed_at is null
    and course_row.purpose = p_purpose
    and (can_build_class or course_row.course_kind = 'curriculum')
    and (
      course_row.course_kind = 'curriculum'
      or public.teacher_microcourse_course_is_publishable(course_row.id)
    );

  if result is null then raise exception 'COURSE_NOT_AVAILABLE'; end if;
  return result;
end;
$$;

revoke all on function public.teacher_microcourse_course_is_publishable(uuid)
  from public, anon, authenticated;
revoke all on function public.teacher_microcourse_course_catalog_metadata(uuid)
  from public, anon, authenticated;

comment on column public.teacher_microcourses.source_classroom_id is
  'Authoritative free-class root. Session proposals in one author series share a multi-lecture microcourse course.';
comment on table public.teacher_microcourses is
  'DEV-TMC lesson proposal: one source session and one lecture inside a classroom-level, multi-lecture teacher microcourse.';

notify pgrst, 'reload schema';

commit;
