-- DEV-TMC-3 follow-up: one free classroom is one catalog course, one source
-- session is one catalog lecture, and proposals for that session publish as
-- distinct immutable releases of that lecture.

begin;

drop index if exists public.teacher_microcourses_course_session_series_idx;

create table public.teacher_microcourse_class_courses (
  source_classroom_id uuid primary key
    references public.classrooms(id) on delete restrict,
  course_id uuid not null unique
    references public.courses(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_classroom_id, course_id)
);

create table public.teacher_microcourse_class_lectures (
  source_session_id uuid primary key
    references public.class_sessions(id) on delete restrict,
  source_classroom_id uuid not null,
  course_id uuid not null,
  lecture_id uuid not null unique
    references public.course_lectures(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (source_classroom_id, course_id)
    references public.teacher_microcourse_class_courses(source_classroom_id, course_id)
    on delete restrict
);

create table public.teacher_microcourse_catalog_releases (
  release_id uuid primary key
    references public.cw_lecture_releases(id) on delete restrict,
  microcourse_id uuid not null
    references public.teacher_microcourses(id) on delete restrict,
  catalog_lecture_id uuid not null
    references public.course_lectures(id) on delete restrict,
  metadata_revision_id uuid,
  review_cycle_id uuid unique
    references public.cw_review_cycles(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (microcourse_id, metadata_revision_id)
    references public.teacher_microcourse_metadata_revisions(microcourse_id, id)
    on delete restrict
);

create index teacher_microcourse_catalog_releases_variant_idx
  on public.teacher_microcourse_catalog_releases(microcourse_id, created_at desc);
create index teacher_microcourse_catalog_releases_lecture_idx
  on public.teacher_microcourse_catalog_releases(catalog_lecture_id, created_at desc);

alter table public.teacher_microcourse_class_courses enable row level security;
alter table public.teacher_microcourse_class_lectures enable row level security;
alter table public.teacher_microcourse_catalog_releases enable row level security;
revoke all on table
  public.teacher_microcourse_class_courses,
  public.teacher_microcourse_class_lectures,
  public.teacher_microcourse_catalog_releases
from public, anon, authenticated;

-- Keep the shared release completeness gate fail-closed. A snapshot may point
-- at another lecture only when every page belongs to one registered proposal
-- workspace for the exact source session represented by the catalog lecture.
create or replace function public.build_cw_release_courseware_pages(
  p_lecture_id uuid,
  p_snapshot jsonb
)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  result jsonb;
  snapshot_count integer;
  snapshot_lecture_id uuid;
  snapshot_lecture_count integer;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'array' then
    raise exception 'INVALID_RELEASE_SNAPSHOT';
  end if;
  snapshot_count := jsonb_array_length(p_snapshot);
  if snapshot_count < 1 or snapshot_count > 200 then
    raise exception 'INVALID_RELEASE_SNAPSHOT';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_snapshot) entry(value)
    where jsonb_typeof(entry.value) is distinct from 'object'
       or coalesce(entry.value ->> 'pageDocId', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(entry.value ->> 'revisionId', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) or (
    select count(distinct entry.value ->> 'pageDocId')
    from jsonb_array_elements(p_snapshot) entry(value)
  ) <> snapshot_count then
    raise exception 'INVALID_RELEASE_SNAPSHOT';
  end if;

  select
    (array_agg(distinct page.lecture_id))[1],
    count(distinct page.lecture_id)
  into snapshot_lecture_id, snapshot_lecture_count
  from jsonb_array_elements(p_snapshot) entry(value)
  join public.cw_page_docs page
    on page.id = (entry.value ->> 'pageDocId')::uuid
  join public.cw_page_revisions revision
    on revision.id = (entry.value ->> 'revisionId')::uuid
   and revision.page_doc_id = page.id;

  if snapshot_lecture_count <> 1 or not (
    snapshot_lecture_id = p_lecture_id
    or exists (
      select 1
      from public.teacher_microcourses microcourse
      join public.teacher_microcourse_class_lectures class_lecture
        on class_lecture.source_session_id = microcourse.source_session_id
      where microcourse.lecture_id = snapshot_lecture_id
        and class_lecture.lecture_id = p_lecture_id
    )
  ) then
    raise exception 'RELEASE_SNAPSHOT_INCOMPLETE';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', page.id,
      'type', 'doc',
      'docId', page.id,
      'title', left(coalesce(nullif(trim(page.title), ''), format('P%s', entry.ordinal)), 100)
    ) order by entry.ordinal
  )
  into result
  from jsonb_array_elements(p_snapshot) with ordinality entry(value, ordinal)
  join public.cw_page_docs page
    on page.id = (entry.value ->> 'pageDocId')::uuid
   and page.lecture_id = snapshot_lecture_id
  join public.cw_page_revisions revision
    on revision.id = (entry.value ->> 'revisionId')::uuid
   and revision.page_doc_id = page.id;

  if result is null
     or jsonb_array_length(result) <> snapshot_count
     or octet_length(result::text) > 1048576
     or exists (
       select 1 from jsonb_array_elements(result) page(value)
       where not public.cw_courseware_page_is_valid(page.value)
     ) then
    raise exception 'RELEASE_SNAPSHOT_INCOMPLETE';
  end if;
  return result;
end;
$$;

-- Select one existing course container per classroom. Current “本节使用”
-- choices win, so the production 1-class/3-session dataset keeps its current
-- selected lesson order and all immutable proposal data.
with candidates as (
  select
    microcourse.source_classroom_id,
    microcourse.course_id,
    min(microcourse.created_at) as first_created_at,
    count(*) filter (
      where session.selected_teacher_microcourse_id = microcourse.id
    ) as selected_count,
    row_number() over (
      partition by microcourse.source_classroom_id
      order by
        count(*) filter (
          where session.selected_teacher_microcourse_id = microcourse.id
        ) desc,
        min(microcourse.created_at),
        microcourse.course_id
    ) as choice_no
  from public.teacher_microcourses microcourse
  join public.class_sessions session on session.id = microcourse.source_session_id
  group by microcourse.source_classroom_id, microcourse.course_id
)
insert into public.teacher_microcourse_class_courses(
  source_classroom_id, course_id, created_by
)
select candidate.source_classroom_id, candidate.course_id, classroom.owner_id
from candidates candidate
join public.classrooms classroom on classroom.id = candidate.source_classroom_id
where candidate.choice_no = 1;

-- A source session owns one stable catalog lecture. The currently selected
-- proposal provides that lecture when possible; alternatives remain editable
-- workspace lectures inside the same hidden aggregate.
with candidates as (
  select
    microcourse.source_session_id,
    microcourse.source_classroom_id,
    root.course_id,
    microcourse.lecture_id,
    row_number() over (
      partition by microcourse.source_session_id
      order by
        (session.selected_teacher_microcourse_id = microcourse.id) desc,
        microcourse.created_at,
        microcourse.id
    ) as choice_no
  from public.teacher_microcourses microcourse
  join public.teacher_microcourse_class_courses root
    on root.source_classroom_id = microcourse.source_classroom_id
  join public.class_sessions session on session.id = microcourse.source_session_id
)
insert into public.teacher_microcourse_class_lectures(
  source_session_id, source_classroom_id, course_id, lecture_id
)
select source_session_id, source_classroom_id, course_id, lecture_id
from candidates
where choice_no = 1;

do $$
begin
  if exists (
    select 1
    from public.teacher_microcourses microcourse
    group by microcourse.source_classroom_id
    having count(*) > 32767
  ) then
    raise exception 'MICROCOURSE_CLASS_WORKSPACE_LIMIT';
  end if;
end $$;

create temporary table teacher_microcourse_class_root_map on commit drop as
select
  microcourse.id as microcourse_id,
  microcourse.course_id as old_course_id,
  microcourse.lecture_id,
  root.course_id as canonical_course_id,
  class_lecture.lecture_id as catalog_lecture_id,
  microcourse.source_classroom_id,
  microcourse.source_session_id,
  microcourse.created_at,
  session.scheduled_at,
  microcourse.lecture_id = class_lecture.lecture_id as is_catalog_lecture,
  row_number() over (
    partition by root.course_id
    order by
      (microcourse.lecture_id = class_lecture.lecture_id) desc,
      session.scheduled_at,
      microcourse.source_session_id,
      microcourse.created_at,
      microcourse.id
  ) as lecture_no
from public.teacher_microcourses microcourse
join public.teacher_microcourse_class_courses root
  on root.source_classroom_id = microcourse.source_classroom_id
join public.teacher_microcourse_class_lectures class_lecture
  on class_lecture.source_session_id = microcourse.source_session_id
join public.class_sessions session on session.id = microcourse.source_session_id;

-- Move all numbers outside the positive target range before course reparenting
-- so unique(course_id,no) cannot collide.
update public.course_lectures lecture
set no = (-mapping.lecture_no)::smallint
from teacher_microcourse_class_root_map mapping
where lecture.id = mapping.lecture_id;

update public.course_lectures lecture
set course_id = mapping.canonical_course_id,
    no = mapping.lecture_no::smallint,
    status = case when mapping.is_catalog_lecture then 'active' else 'draft' end
from teacher_microcourse_class_root_map mapping
where lecture.id = mapping.lecture_id;

update public.teacher_microcourses microcourse
set course_id = mapping.canonical_course_id
from teacher_microcourse_class_root_map mapping
where microcourse.id = mapping.microcourse_id;

with classroom_metadata as (
  select
    root.course_id,
    classroom.name,
    classroom.grade,
    classroom.owner_id,
    school_term.term
  from public.teacher_microcourse_class_courses root
  join public.classrooms classroom on classroom.id = root.source_classroom_id
  left join public.school_terms school_term on school_term.id = classroom.term_id
)
update public.courses course
set title = left(btrim(classroom_metadata.name), 100),
    grade = coalesce(classroom_metadata.grade, course.grade),
    term = classroom_metadata.term,
    created_by = classroom_metadata.owner_id,
    updated_at = now()
from classroom_metadata
where course.id = classroom_metadata.course_id;

with superseded as (
  select distinct mapping.old_course_id, mapping.canonical_course_id
  from teacher_microcourse_class_root_map mapping
  where mapping.old_course_id <> mapping.canonical_course_id
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

-- Existing proposal releases become release versions of their stable catalog
-- lecture. IDs stay unchanged, so review-cycle evidence and frozen references
-- remain valid; only lecture_id/release_no are normalized.
create temporary table teacher_microcourse_release_root_map on commit drop as
select
  release.id as release_id,
  microcourse.id as microcourse_id,
  class_lecture.lecture_id as catalog_lecture_id,
  coalesce(snapshot.metadata_revision_id, microcourse.published_metadata_revision_id)
    as metadata_revision_id,
  cycle.id as review_cycle_id,
  row_number() over (
    partition by class_lecture.lecture_id, release.track
    order by release.published_at, release.id
  ) as release_no
from public.teacher_microcourses microcourse
join public.cw_lecture_releases release on release.lecture_id = microcourse.lecture_id
join public.teacher_microcourse_class_lectures class_lecture
  on class_lecture.source_session_id = microcourse.source_session_id
left join public.cw_review_cycles cycle on cycle.published_release_id = release.id
left join public.teacher_microcourse_review_snapshots snapshot
  on snapshot.review_cycle_id = cycle.id;

insert into public.teacher_microcourse_catalog_releases(
  release_id, microcourse_id, catalog_lecture_id,
  metadata_revision_id, review_cycle_id, created_at
)
select
  mapping.release_id,
  mapping.microcourse_id,
  mapping.catalog_lecture_id,
  mapping.metadata_revision_id,
  mapping.review_cycle_id,
  release.published_at
from teacher_microcourse_release_root_map mapping
join public.cw_lecture_releases release on release.id = mapping.release_id;

alter table public.cw_lecture_releases
  drop constraint cw_lecture_releases_lecture_id_track_release_no_key;

update public.cw_lecture_releases release
set lecture_id = mapping.catalog_lecture_id,
    release_no = mapping.release_no
from teacher_microcourse_release_root_map mapping
where release.id = mapping.release_id;

alter table public.cw_lecture_releases
  add constraint cw_lecture_releases_lecture_id_track_release_no_key
  unique(lecture_id, track, release_no);

-- Only the selected proposal's latest non-withdrawn release is current. Other
-- proposal releases remain immutable history on the same catalog lecture.
update public.course_lectures lecture
set current_release_id = null
where exists (
  select 1 from public.teacher_microcourse_class_lectures class_lecture
  where class_lecture.lecture_id = lecture.id
);

update public.cw_lecture_track_heads head
set current_release_id = null,
    updated_at = now()
where exists (
  select 1 from public.teacher_microcourse_class_lectures class_lecture
  where class_lecture.lecture_id = head.lecture_id
);

with selected_release as (
  select distinct on (class_lecture.lecture_id, release.track)
    class_lecture.lecture_id,
    release.track,
    release.id as release_id
  from public.teacher_microcourse_class_lectures class_lecture
  join public.class_sessions session on session.id = class_lecture.source_session_id
  join public.teacher_microcourses microcourse
    on microcourse.id = session.selected_teacher_microcourse_id
   and microcourse.withdrawn_at is null
  join public.teacher_microcourse_catalog_releases catalog_release
    on catalog_release.microcourse_id = microcourse.id
   and catalog_release.catalog_lecture_id = class_lecture.lecture_id
  join public.cw_lecture_releases release on release.id = catalog_release.release_id
  order by class_lecture.lecture_id, release.track, release.release_no desc
)
insert into public.cw_lecture_track_heads(lecture_id, track, current_release_id)
select lecture_id, track, release_id from selected_release
on conflict(lecture_id, track) do update
set current_release_id = excluded.current_release_id,
    updated_at = now();

update public.course_lectures lecture
set current_release_id = head.current_release_id
from public.cw_lecture_track_heads head
where head.lecture_id = lecture.id
  and head.track = 'native-16x9'
  and exists (
    select 1 from public.teacher_microcourse_class_lectures class_lecture
    where class_lecture.lecture_id = lecture.id
  );

create or replace function public.teacher_microcourse_course_is_publishable(
  p_course_id uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.teacher_microcourse_class_lectures class_lecture
    where class_lecture.course_id = p_course_id
  ) and not exists (
    select 1
    from public.teacher_microcourse_class_lectures class_lecture
    join public.class_sessions session on session.id = class_lecture.source_session_id
    left join public.teacher_microcourses selected
      on selected.id = session.selected_teacher_microcourse_id
    left join public.cw_lecture_track_heads head
      on head.lecture_id = class_lecture.lecture_id
     and head.track = 'native-16x9'
    where class_lecture.course_id = p_course_id
      and (
        selected.id is null
        or selected.published_metadata_revision_id is null
        or selected.withdrawn_at is not null
        or head.current_release_id is null
        or not exists (
          select 1
          from public.teacher_microcourse_catalog_releases catalog_release
          where catalog_release.release_id = head.current_release_id
            and catalog_release.microcourse_id = selected.id
            and catalog_release.catalog_lecture_id = class_lecture.lecture_id
        )
      )
  )
$$;

create or replace function public.renumber_teacher_microcourse_class_course(
  p_course_id uuid
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.teacher_microcourse_class_courses root
    where root.course_id = p_course_id
  ) then raise exception 'MICROCOURSE_CLASS_ROOT_NOT_FOUND'; end if;

  with ordered as (
    select
      microcourse.lecture_id,
      row_number() over (
        order by
          (class_lecture.lecture_id is not null) desc,
          session.scheduled_at,
          microcourse.source_session_id,
          microcourse.created_at,
          microcourse.id
      ) as lecture_no
    from public.teacher_microcourses microcourse
    join public.class_sessions session on session.id = microcourse.source_session_id
    left join public.teacher_microcourse_class_lectures class_lecture
      on class_lecture.lecture_id = microcourse.lecture_id
    where microcourse.course_id = p_course_id
  )
  update public.course_lectures lecture
  set no = (-ordered.lecture_no)::smallint
  from ordered
  where lecture.id = ordered.lecture_id;

  with ordered as (
    select
      microcourse.lecture_id,
      row_number() over (
        order by
          (class_lecture.lecture_id is not null) desc,
          session.scheduled_at,
          microcourse.source_session_id,
          microcourse.created_at,
          microcourse.id
      ) as lecture_no
    from public.teacher_microcourses microcourse
    join public.class_sessions session on session.id = microcourse.source_session_id
    left join public.teacher_microcourse_class_lectures class_lecture
      on class_lecture.lecture_id = microcourse.lecture_id
    where microcourse.course_id = p_course_id
  )
  update public.course_lectures lecture
  set no = ordered.lecture_no::smallint
  from ordered
  where lecture.id = ordered.lecture_id;
end;
$$;

create or replace function public.guard_teacher_microcourse_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.teacher_microcourse_class_courses root
    join public.courses course_row
      on course_row.id = root.course_id
     and course_row.course_kind = 'microcourse'
    join public.course_lectures lecture_row
      on lecture_row.id = new.lecture_id
     and lecture_row.course_id = root.course_id
    where root.source_classroom_id = new.source_classroom_id
      and root.course_id = new.course_id
  ) then raise exception 'INVALID_MICROCOURSE_CLASS_COURSE_LECTURE'; end if;
  if not exists (
    select 1
    from public.class_sessions session_row
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    where session_row.id = new.source_session_id
      and session_row.classroom_id = new.source_classroom_id
      and session_row.deleted_at is null
      and session_row.lecture_id is null
      and classroom_row.course_id is null
  ) then raise exception 'MICROCOURSE_SOURCE_MUST_BE_FREE_SESSION'; end if;
  return new;
end;
$$;

create or replace function public.sync_teacher_microcourse_class_course_metadata()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare class_term smallint;
begin
  select school_term.term into class_term
  from public.school_terms school_term where school_term.id = new.term_id;
  update public.courses course
  set title = left(btrim(new.name), 100),
      grade = coalesce(new.grade, course.grade),
      term = class_term,
      created_by = new.owner_id,
      updated_at = now()
  from public.teacher_microcourse_class_courses root
  where root.source_classroom_id = new.id
    and course.id = root.course_id;
  return new;
end;
$$;

drop trigger if exists classrooms_sync_teacher_microcourse_metadata on public.classrooms;
create trigger classrooms_sync_teacher_microcourse_metadata
  after update of name, grade, term_id, owner_id on public.classrooms
  for each row execute function public.sync_teacher_microcourse_class_course_metadata();

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
  v_classroom_id uuid;
  v_classroom_name text;
  v_classroom_grade smallint;
  v_classroom_season smallint;
  v_classroom_owner_id uuid;
  selected_microcourse_id uuid;
  class_course_id uuid;
  catalog_lecture_id uuid;
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

  select
    classroom.id, classroom.name, classroom.grade, school_term.term,
    classroom.owner_id, session.selected_teacher_microcourse_id
  into
    v_classroom_id, v_classroom_name, v_classroom_grade, v_classroom_season,
    v_classroom_owner_id, selected_microcourse_id
  from public.class_sessions session
  join public.classrooms classroom on classroom.id = session.classroom_id
  left join public.school_terms school_term on school_term.id = classroom.term_id
  where session.id = p_source_session_id
  for update of session;
  if v_classroom_id is null then raise exception 'SESSION_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtext(
    'teacher-microcourse-class-root:' || v_classroom_id::text
  ));
  select root.course_id into class_course_id
  from public.teacher_microcourse_class_courses root
  where root.source_classroom_id = v_classroom_id
  for update;

  if class_course_id is null then
    select family.id, version.id into family_id, catalog_version_id
    from public.course_families family
    join public.course_catalog_versions version
      on version.family_id = family.id and version.is_current
    where family.slug = 'teacher-microcourses' and family.status = 'enabled';
    if family_id is null or catalog_version_id is null then
      raise exception 'MICROCOURSE_FAMILY_MISSING';
    end if;
    insert into public.courses(
      family_id, catalog_version_id, title, grade, term, class_type,
      status, purpose, course_kind, created_by
    ) values (
      family_id, catalog_version_id, left(btrim(v_classroom_name), 100),
      coalesce(v_classroom_grade, p_grade),
      coalesce(v_classroom_season, p_course_season),
      btrim(coalesce(p_class_type, '')),
      'draft', 'production', 'microcourse', v_classroom_owner_id
    ) returning id into class_course_id;
    insert into public.teacher_microcourse_class_courses(
      source_classroom_id, course_id, created_by
    ) values (v_classroom_id, class_course_id, uid);
  end if;

  select class_lecture.lecture_id into catalog_lecture_id
  from public.teacher_microcourse_class_lectures class_lecture
  where class_lecture.source_session_id = p_source_session_id;

  select (coalesce(max(lecture.no), 0) + 1)::smallint into next_lecture_no
  from public.course_lectures lecture where lecture.course_id = class_course_id;
  insert into public.course_lectures(course_id, no, name, objectives, status)
  values (
    class_course_id, next_lecture_no, btrim(p_title), coalesce(p_description, ''),
    case when catalog_lecture_id is null then 'active' else 'draft' end
  ) returning id into new_lecture_id;

  if catalog_lecture_id is null then
    catalog_lecture_id := new_lecture_id;
    insert into public.teacher_microcourse_class_lectures(
      source_session_id, source_classroom_id, course_id, lecture_id
    ) values (p_source_session_id, v_classroom_id, class_course_id, new_lecture_id);
  end if;

  insert into public.teacher_microcourses(
    source_classroom_id, source_session_id, author_id, course_id, lecture_id, variant_name
  ) values (
    v_classroom_id, p_source_session_id, uid, class_course_id,
    new_lecture_id, btrim(p_variant_name)
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

  if selected_microcourse_id is null then
    update public.class_sessions
    set selected_teacher_microcourse_id = new_microcourse_id
    where id = p_source_session_id
      and selected_teacher_microcourse_id is null
      and courseware_frozen_at is null
      and started_at is null;
    if not found then raise exception 'SESSION_COURSEWARE_ALREADY_FROZEN'; end if;
  end if;

  perform public.renumber_teacher_microcourse_class_course(class_course_id);
  update public.courses course
  set title = left(btrim(v_classroom_name), 100),
      grade = coalesce(v_classroom_grade, course.grade),
      term = v_classroom_season,
      created_by = v_classroom_owner_id,
      status = case
        when public.teacher_microcourse_course_is_publishable(course.id) then 'enabled'
        else 'draft'
      end,
      updated_at = now()
  where course.id = class_course_id;

  perform public.emit_domain_event(
    'teacher_microcourse.variant_created', 'teacher_microcourse', new_microcourse_id,
    jsonb_build_object(
      'sourceClassroomId', v_classroom_id,
      'sourceSessionId', p_source_session_id,
      'courseId', class_course_id,
      'catalogLectureId', catalog_lecture_id,
      'workspaceLectureId', new_lecture_id,
      'metadataRevisionId', metadata_revision_id,
      'variantName', btrim(p_variant_name)
    ), null, null
  );
  return new_microcourse_id;
end;
$$;

create or replace function public.select_teacher_microcourse_variant(
  p_session_id uuid,
  p_microcourse_id uuid
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  class_course_id uuid;
  workspace_lecture_id uuid;
  v_catalog_lecture_id uuid;
  selected_release_id uuid;
  selected_title text;
  selected_description text;
begin
  if uid is null or not public.is_session_teacher(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select microcourse.course_id, microcourse.lecture_id, class_lecture.lecture_id
  into class_course_id, workspace_lecture_id, v_catalog_lecture_id
  from public.teacher_microcourses microcourse
  join public.teacher_microcourse_class_lectures class_lecture
    on class_lecture.source_session_id = microcourse.source_session_id
  where microcourse.id = p_microcourse_id
    and microcourse.source_session_id = p_session_id;
  if not found then raise exception 'MICROCOURSE_VARIANT_SESSION_MISMATCH'; end if;
  if not exists (
    select 1 from public.cw_page_docs page
    where page.lecture_id = workspace_lecture_id and page.deleted_at is null
  ) then raise exception 'MICROCOURSE_PAGES_REQUIRED'; end if;

  perform 1 from public.class_sessions session
  where session.id = p_session_id for update;
  update public.class_sessions
  set selected_teacher_microcourse_id = p_microcourse_id
  where id = p_session_id
    and deleted_at is null
    and started_at is null
    and courseware_frozen_at is null;
  if not found then raise exception 'SESSION_COURSEWARE_ALREADY_FROZEN'; end if;

  select catalog_release.release_id into selected_release_id
  from public.teacher_microcourse_catalog_releases catalog_release
  join public.cw_lecture_releases release on release.id = catalog_release.release_id
  join public.teacher_microcourses microcourse
    on microcourse.id = catalog_release.microcourse_id
   and microcourse.withdrawn_at is null
  where catalog_release.microcourse_id = p_microcourse_id
    and catalog_release.catalog_lecture_id = v_catalog_lecture_id
    and release.track = 'native-16x9'
  order by release.release_no desc
  limit 1;

  insert into public.cw_lecture_track_heads(lecture_id, track, current_release_id)
  values (v_catalog_lecture_id, 'native-16x9', selected_release_id)
  on conflict(lecture_id, track) do update
  set current_release_id = excluded.current_release_id, updated_at = now();
  update public.course_lectures
  set current_release_id = selected_release_id
  where id = v_catalog_lecture_id;

  select metadata.title, metadata.description
  into selected_title, selected_description
  from public.teacher_microcourses microcourse
  join public.teacher_microcourse_metadata_revisions metadata
    on metadata.id = case
      when selected_release_id is null then microcourse.draft_metadata_revision_id
      else microcourse.published_metadata_revision_id
    end
  where microcourse.id = p_microcourse_id;
  update public.course_lectures
  set name = coalesce(selected_title, name),
      objectives = coalesce(selected_description, objectives)
  where id = v_catalog_lecture_id;

  update public.courses course
  set status = case
      when public.teacher_microcourse_course_is_publishable(course.id) then 'enabled'
      else 'draft'
    end,
    updated_at = now()
  where course.id = class_course_id;
  perform public.emit_domain_event(
    'teacher_microcourse.variant_selected', 'class_session', p_session_id,
    jsonb_build_object(
      'microcourseId', p_microcourse_id,
      'courseId', class_course_id,
      'catalogLectureId', v_catalog_lecture_id,
      'releaseId', selected_release_id
    ), null, null
  );
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
  catalog_lecture_id uuid;
  selected_microcourse_id uuid;
  previous_release_id uuid;
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

  select class_lecture.lecture_id, session.selected_teacher_microcourse_id
  into catalog_lecture_id, selected_microcourse_id
  from public.teacher_microcourse_class_lectures class_lecture
  join public.class_sessions session on session.id = class_lecture.source_session_id
  where class_lecture.source_session_id = microcourse_row.source_session_id
  for update of session;
  select head.current_release_id into previous_release_id
  from public.cw_lecture_track_heads head
  where head.lecture_id = catalog_lecture_id and head.track = 'native-16x9';

  release_id := public.perform_cw_publish(
    catalog_lecture_id, 'native-16x9', p_note,
    cycle_row.content_snapshot, p_uid
  );
  insert into public.teacher_microcourse_catalog_releases(
    release_id, microcourse_id, catalog_lecture_id,
    metadata_revision_id, review_cycle_id
  ) values (
    release_id, micro_snapshot.microcourse_id, catalog_lecture_id,
    micro_snapshot.metadata_revision_id, p_review_cycle_id
  );

  update public.cw_page_docs
  set aspect = '4:3'
  where lecture_id = microcourse_row.lecture_id
    and doc_version = 'microcourse-page-v1';
  update public.course_lectures
  set name = metadata_row.title,
      objectives = metadata_row.description
  where id = microcourse_row.lecture_id;
  update public.teacher_microcourses
  set published_metadata_revision_id = micro_snapshot.metadata_revision_id,
      first_published_at = coalesce(first_published_at, now()),
      last_published_at = now(),
      withdrawn_at = null
  where id = micro_snapshot.microcourse_id;

  if selected_microcourse_id = micro_snapshot.microcourse_id then
    update public.course_lectures
    set name = metadata_row.title,
        objectives = metadata_row.description,
        status = 'active'
    where id = catalog_lecture_id;
  else
    update public.cw_lecture_track_heads
    set current_release_id = previous_release_id, updated_at = now()
    where lecture_id = catalog_lecture_id and track = 'native-16x9';
    update public.course_lectures
    set current_release_id = previous_release_id
    where id = catalog_lecture_id;
  end if;

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
  update public.courses course
  set status = case
      when public.teacher_microcourse_course_is_publishable(course.id) then 'enabled'
      else 'draft'
    end,
    updated_at = now()
  where course.id = microcourse_row.course_id;

  perform public.emit_domain_event(
    'teacher_microcourse.published', 'teacher_microcourse', micro_snapshot.microcourse_id,
    jsonb_build_object(
      'sourceClassroomId', microcourse_row.source_classroom_id,
      'reviewCycleId', p_review_cycle_id,
      'releaseId', release_id,
      'catalogLectureId', catalog_lecture_id,
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
declare
  microcourse_row public.teacher_microcourses%rowtype;
  catalog_lecture_id uuid;
  selected_microcourse_id uuid;
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

  select class_lecture.lecture_id, session.selected_teacher_microcourse_id
  into catalog_lecture_id, selected_microcourse_id
  from public.teacher_microcourse_class_lectures class_lecture
  join public.class_sessions session on session.id = class_lecture.source_session_id
  where class_lecture.source_session_id = microcourse_row.source_session_id;
  if selected_microcourse_id = p_microcourse_id then
    update public.cw_lecture_track_heads
    set current_release_id = null, updated_at = now()
    where lecture_id = catalog_lecture_id and track = 'native-16x9';
    update public.course_lectures set current_release_id = null
    where id = catalog_lecture_id;
  end if;
  update public.courses course
  set status = case
      when public.teacher_microcourse_course_is_publishable(course.id) then 'enabled'
      else 'draft'
    end,
    updated_at = now()
  where course.id = microcourse_row.course_id;
  perform public.emit_domain_event(
    'teacher_microcourse.withdrawn', 'teacher_microcourse', p_microcourse_id,
    jsonb_build_object(
      'sourceClassroomId', microcourse_row.source_classroom_id,
      'courseId', microcourse_row.course_id,
      'catalogLectureId', catalog_lecture_id
    ), null, null
  );
end;
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
    select topic.slug, topic.title_zh, topic.title_en, metadata.keywords
    from public.teacher_microcourse_class_lectures class_lecture
    join public.class_sessions session on session.id = class_lecture.source_session_id
    join public.teacher_microcourses microcourse
      on microcourse.id = session.selected_teacher_microcourse_id
     and microcourse.withdrawn_at is null
    join public.teacher_microcourse_metadata_revisions metadata
      on metadata.id = microcourse.published_metadata_revision_id
    left join public.teacher_microcourse_topics topic on topic.id = metadata.primary_topic_id
    where class_lecture.course_id = course_row.id
    order by microcourse.last_published_at desc nulls last,
             microcourse.created_at,
             microcourse.id
    limit 1
  ) representative on true
  left join lateral (
    select max(microcourse.last_published_at) as last_published_at
    from public.teacher_microcourse_class_lectures class_lecture
    join public.class_sessions session on session.id = class_lecture.source_session_id
    join public.teacher_microcourses microcourse
      on microcourse.id = session.selected_teacher_microcourse_id
     and microcourse.withdrawn_at is null
    where class_lecture.course_id = course_row.id
  ) publication on true
  where course_row.id = p_course_id
$$;

-- Existing read models expect currentReleaseId on the proposal workspace. Keep
-- that JSON contract while sourcing the ID from the proposal→catalog mapping.
alter function public.teacher_microcourse_summary_json(uuid)
  rename to teacher_microcourse_summary_json_pre_class_release;

create function public.teacher_microcourse_summary_json(p_microcourse_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare result jsonb; release_id uuid; catalog_lecture_id uuid;
begin
  result := public.teacher_microcourse_summary_json_pre_class_release(p_microcourse_id);
  select catalog_release.release_id, catalog_release.catalog_lecture_id
  into release_id, catalog_lecture_id
  from public.teacher_microcourse_catalog_releases catalog_release
  join public.cw_lecture_releases release on release.id = catalog_release.release_id
  where catalog_release.microcourse_id = p_microcourse_id
  order by release.release_no desc
  limit 1;
  return jsonb_set(
    jsonb_set(result, '{currentReleaseId}', coalesce(to_jsonb(release_id), 'null'::jsonb), true),
    '{catalogLectureId}', coalesce(to_jsonb(catalog_lecture_id), 'null'::jsonb), true
  );
end;
$$;

-- Preserve the shared Aixuexi/Mofaxiao product page and replace only the
-- teacher-family projections: variants are classroom courses, teaching-plan
-- rows are source sessions, and page counts come from current release snapshots.
alter function public.get_course_family_detail(uuid, uuid, text)
  rename to get_course_family_detail_pre_teacher_class_root;

create function public.get_course_family_detail(
  p_family_id uuid,
  p_variant_id uuid default null,
  p_scope text default 'all'
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  family_slug text;
  result jsonb;
  can_manage boolean := auth.uid() is not null and public.has_perm(auth.uid(), 'course.manage');
begin
  select family.slug into family_slug from public.course_families family
  where family.id = p_family_id;
  if family_slug is distinct from 'teacher-microcourses' then
    return public.get_course_family_detail_pre_teacher_class_root(
      p_family_id, p_variant_id, p_scope
    );
  end if;
  if p_variant_id is not null and not exists (
    select 1 from public.teacher_microcourse_class_courses root
    where root.course_id = p_variant_id
  ) then raise exception 'COURSE_VARIANT_NOT_IN_FAMILY'; end if;

  result := public.get_course_family_detail_pre_teacher_class_root(
    p_family_id, p_variant_id, p_scope
  );
  result := jsonb_set(result, '{catalogVersions}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', version.id,
      'slug', version.slug,
      'title', version.title,
      'editionYear', version.edition_year,
      'isCurrent', version.is_current,
      'status', version.status,
      'variantCount', (
        select count(*)
        from public.teacher_microcourse_class_courses root
        join public.courses course on course.id = root.course_id
        where course.catalog_version_id = version.id
          and course.trashed_at is null
      )
    ) order by version.sort_order, version.slug)
    from public.course_catalog_versions version
    where version.family_id = p_family_id
      and (version.status = 'enabled' or can_manage)
  ), '[]'::jsonb), true);
  result := jsonb_set(result, '{variants}', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', course.id,
      'title', course.title,
      'productCode', course.product_code,
      'catalogVersionId', course.catalog_version_id,
      'catalogVersionSlug', version.slug,
      'catalogVersionTitle', version.title,
      'supersededByCourseId', course.superseded_by_course_id,
      'grade', course.grade,
      'courseSeason', course.term,
      'classType', course.class_type,
      'status', course.status,
      'purpose', course.purpose,
      'trashedAt', course.trashed_at,
      'lectureCount', (
        select count(*) from public.teacher_microcourse_class_lectures class_lecture
        where class_lecture.course_id = course.id
      ),
      'releasedLectureCount', (
        select count(*)
        from public.teacher_microcourse_class_lectures class_lecture
        join public.course_lectures lecture on lecture.id = class_lecture.lecture_id
        where class_lecture.course_id = course.id
          and lecture.current_release_id is not null
      ),
      'classroomCount', (
        select count(*) from public.classrooms classroom
        where classroom.course_id = course.id and classroom.archived_at is null
      ),
      'hasRisk', exists (
        select 1
        from public.cw_lecture_workflows workflow
        join public.teacher_microcourses microcourse
          on microcourse.lecture_id = workflow.lecture_id
        where microcourse.course_id = course.id
          and (
            workflow.stage = 'changes_requested'
            or (workflow.internal_due_at is not null
                and workflow.internal_due_at < now()
                and workflow.stage <> 'ready_to_publish')
          )
      )
    ) order by version.sort_order, course.grade, course.term, course.class_type, course.product_code)
    from public.teacher_microcourse_class_courses root
    join public.courses course on course.id = root.course_id
    join public.course_catalog_versions version on version.id = course.catalog_version_id
    where course.family_id = p_family_id
      and (can_manage or (course.trashed_at is null and course.status = 'enabled'))
  ), '[]'::jsonb), true);

  if p_variant_id is not null then
    result := jsonb_set(result, '{teachingPlan}', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', lecture.id,
        'no', session_order.no,
        'name', lecture.name,
        'objectives', lecture.objectives,
        'status', lecture.status,
        'archivedAt', lecture.archived_at,
        'hasRelease', lecture.current_release_id is not null,
        'pageCount', coalesce(jsonb_array_length(release.snapshot), 0)
      ) order by session_order.no)
      from (
        select
          class_lecture.*,
          row_number() over (
            order by session.scheduled_at, class_lecture.source_session_id
          )::integer as no
        from public.teacher_microcourse_class_lectures class_lecture
        join public.class_sessions session on session.id = class_lecture.source_session_id
        where class_lecture.course_id = p_variant_id
      ) session_order
      join public.course_lectures lecture on lecture.id = session_order.lecture_id
      left join public.cw_lecture_releases release on release.id = lecture.current_release_id
    ), '[]'::jsonb), true);
    result := jsonb_set(result, '{readiness}', jsonb_build_object(
      'lectureCount', (
        select count(*) from public.teacher_microcourse_class_lectures class_lecture
        where class_lecture.course_id = p_variant_id
      ),
      'releasedLectureCount', (
        select count(*)
        from public.teacher_microcourse_class_lectures class_lecture
        join public.course_lectures lecture on lecture.id = class_lecture.lecture_id
        where class_lecture.course_id = p_variant_id
          and lecture.current_release_id is not null
      ),
      'pageCount', coalesce((
        select sum(jsonb_array_length(release.snapshot))
        from public.teacher_microcourse_class_lectures class_lecture
        join public.course_lectures lecture on lecture.id = class_lecture.lecture_id
        join public.cw_lecture_releases release on release.id = lecture.current_release_id
        where class_lecture.course_id = p_variant_id
      ), 0)
    ), true);
  end if;
  return result;
end;
$$;

update public.courses course
set status = case
    when public.teacher_microcourse_course_is_publishable(course.id) then 'enabled'
    else 'draft'
  end,
  updated_at = now()
where exists (
  select 1 from public.teacher_microcourse_class_courses root
  where root.course_id = course.id
);

revoke all on function public.renumber_teacher_microcourse_class_course(uuid)
  from public, anon, authenticated;
revoke all on function public.teacher_microcourse_course_is_publishable(uuid)
  from public, anon, authenticated;
revoke all on function public.teacher_microcourse_course_catalog_metadata(uuid)
  from public, anon, authenticated;
revoke all on function public.teacher_microcourse_summary_json_pre_class_release(uuid)
  from public, anon, authenticated;
revoke all on function public.get_course_family_detail_pre_teacher_class_root(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.teacher_microcourse_summary_json(uuid)
  from public, anon, authenticated;
revoke all on function public.get_course_family_detail(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.teacher_microcourse_summary_json(uuid) to authenticated;
grant execute on function public.get_course_family_detail(uuid, uuid, text) to authenticated;

comment on table public.teacher_microcourse_class_courses is
  'One authoritative teacher-microcourse catalog course per free classroom.';
comment on table public.teacher_microcourse_class_lectures is
  'One stable catalog lecture per free-class source session.';
comment on table public.teacher_microcourse_catalog_releases is
  'Proposal provenance for immutable release versions published to a source session catalog lecture.';
comment on column public.teacher_microcourses.source_classroom_id is
  'Free-class root. Proposals share one class course; same-session proposals publish as releases of one catalog lecture.';

notify pgrst, 'reload schema';

commit;
