-- DEV-SCHOOL-OPS-1 / public-class teaching continuity.
--
-- A public-class segment may author or reference reusable teacher microcourse
-- content without manufacturing a classroom or class_session. Entering the
-- teaching route first presents a candidate/preflight surface; starting the
-- segment freezes the exact page revisions used on site.

begin;

alter table public.teacher_microcourses
  alter column source_session_id drop not null,
  alter column source_classroom_id drop not null;

alter table public.teacher_microcourses
  add column origin_public_class_segment_id uuid
    references public.public_class_segments(id) on delete set null;

alter table public.teacher_microcourses
  add constraint teacher_microcourses_source_scope_check check (
    (source_session_id is not null and source_classroom_id is not null)
    or (source_session_id is null and source_classroom_id is null)
  );

create index teacher_microcourses_public_class_origin_idx
  on public.teacher_microcourses(origin_public_class_segment_id, updated_at desc)
  where origin_public_class_segment_id is not null;

alter table public.public_class_segments
  add column microcourse_id uuid references public.teacher_microcourses(id) on delete set null,
  add column teaching_snapshot jsonb,
  add column teaching_release_id uuid references public.cw_lecture_releases(id) on delete restrict,
  add column teaching_started_at timestamptz,
  add column teaching_started_by uuid references public.profiles(id) on delete set null,
  add column teaching_ended_at timestamptz,
  add column teaching_ended_by uuid references public.profiles(id) on delete set null;

alter table public.public_class_segments
  add constraint public_class_segments_teaching_snapshot_check check (
    teaching_snapshot is null
    or (
      jsonb_typeof(teaching_snapshot) = 'array'
      and jsonb_array_length(teaching_snapshot) between 1 and 200
    )
  ),
  add constraint public_class_segments_teaching_time_check check (
    teaching_ended_at is null
    or (teaching_started_at is not null and teaching_ended_at >= teaching_started_at)
  );

create or replace function public.guard_teacher_microcourse_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.source_session_id is null) <> (new.source_classroom_id is null) then
    raise exception 'INVALID_MICROCOURSE_SOURCE_SCOPE';
  end if;

  if new.source_session_id is not null then
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
  else
    if not exists (
      select 1
      from public.teacher_microcourse_catalog_courses registry
      join public.courses course_row
        on course_row.id = registry.course_id
       and course_row.course_kind = 'microcourse'
       and course_row.trashed_at is null
      join public.course_lectures lecture_row
        on lecture_row.id = new.lecture_id
       and lecture_row.course_id = course_row.id
       and lecture_row.status <> 'archived'
      where registry.course_id = new.course_id
        and registry.duplicate_of_course_id is null
        and registry.archived_at is null
    ) then raise exception 'INVALID_MICROCOURSE_CATALOG_COURSE_LECTURE'; end if;
    if new.origin_public_class_segment_id is not null and not exists (
      select 1
      from public.public_class_segments segment
      join public.activities activity on activity.id = segment.activity_id
      where segment.id = new.origin_public_class_segment_id
        and activity.kind = 'public_class'
        and activity.deleted_at is null
    ) then raise exception 'PUBLIC_CLASS_SEGMENT_NOT_FOUND'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists teacher_microcourses_guard_integrity on public.teacher_microcourses;
create trigger teacher_microcourses_guard_integrity
  before insert or update of source_classroom_id, source_session_id, course_id, lecture_id,
    origin_public_class_segment_id
  on public.teacher_microcourses
  for each row execute function public.guard_teacher_microcourse_integrity();

create or replace function public.can_author_teacher_microcourse(
  p_microcourse_id uuid,
  p_uid uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null
    and public.has_perm(p_uid, 'courseware.microcourse.author')
    and exists (
      select 1
      from public.teacher_microcourses microcourse_row
      where microcourse_row.id = p_microcourse_id
        and microcourse_row.author_id = p_uid
        and (
          microcourse_row.source_session_id is null
          or public.is_session_teacher(microcourse_row.source_session_id, p_uid)
        )
    )
$$;

create or replace function public.can_read_teacher_microcourse_draft(
  p_microcourse_id uuid,
  p_uid uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null and (
    public.is_admin(p_uid)
    or public.has_perm(p_uid, 'courseware.review')
    or exists (
      select 1
      from public.teacher_microcourses microcourse_row
      where microcourse_row.id = p_microcourse_id
        and (
          microcourse_row.author_id = p_uid
          or (
            microcourse_row.source_session_id is not null
            and public.is_session_teacher(microcourse_row.source_session_id, p_uid)
          )
        )
    )
    or exists (
      select 1
      from public.public_class_segments segment
      where segment.microcourse_id = p_microcourse_id
        and (
          p_uid in (segment.primary_teacher_id, segment.assistant_teacher_id)
          or public.has_perm(p_uid, 'activity.manage')
        )
    )
  )
$$;

create or replace function public.can_teach_public_class_segment(
  p_segment_id uuid,
  p_uid uuid
)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null and (
    public.is_admin(p_uid)
    or public.has_perm(p_uid, 'activity.manage')
    or exists (
      select 1
      from public.public_class_segments segment
      join public.activities activity on activity.id = segment.activity_id
      where segment.id = p_segment_id
        and activity.kind = 'public_class'
        and activity.deleted_at is null
        and p_uid in (segment.primary_teacher_id, segment.assistant_teacher_id)
    )
  )
$$;

create or replace function public.teacher_microcourse_summary_json_pre_class_release(
  p_microcourse_id uuid
)
returns jsonb
language sql security definer stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', microcourse.id,
    'sourceSessionId', microcourse.source_session_id,
    'originPublicClassSegmentId', microcourse.origin_public_class_segment_id,
    'authorId', microcourse.author_id,
    'authorName', coalesce(nullif(btrim(author.display_name), ''), '—'),
    'variantName', microcourse.variant_name,
    'basedOnMicrocourseId', microcourse.based_on_microcourse_id,
    'basedOnMetadataRevisionId', microcourse.based_on_metadata_revision_id,
    'basedOnVariantName', based_on.variant_name,
    'courseId', microcourse.course_id,
    'lectureId', microcourse.lecture_id,
    'courseStatus', course.status,
    'currentReleaseId', lecture.current_release_id,
    'draftMetadataRevisionId', microcourse.draft_metadata_revision_id,
    'publishedMetadataRevisionId', microcourse.published_metadata_revision_id,
    'draftMetadata', case when draft_revision.id is null then null else jsonb_build_object(
      'revisionId', draft_revision.id,
      'revisionNo', draft_revision.revision_no,
      'title', draft_revision.title,
      'description', draft_revision.description,
      'grade', draft_revision.grade,
      'courseSeason', draft_revision.course_season,
      'classType', draft_revision.class_type,
      'primaryTopicSlug', draft_topic.slug,
      'keywords', draft_revision.keywords,
      'createdAt', draft_revision.created_at
    ) end,
    'publishedMetadata', case when published_revision.id is null then null else jsonb_build_object(
      'revisionId', published_revision.id,
      'revisionNo', published_revision.revision_no,
      'title', published_revision.title,
      'description', published_revision.description,
      'grade', published_revision.grade,
      'courseSeason', published_revision.course_season,
      'classType', published_revision.class_type,
      'primaryTopicSlug', published_topic.slug,
      'keywords', published_revision.keywords,
      'createdAt', published_revision.created_at
    ) end,
    'workflow', case when workflow.lecture_id is null then null else jsonb_build_object(
      'stage', workflow.stage,
      'currentReviewRound', workflow.current_review_round,
      'requiredReviewRounds', workflow.required_review_rounds_snapshot,
      'activeReviewCycleId', workflow.active_review_cycle_id,
      'updatedAt', workflow.updated_at
    ) end,
    'firstPublishedAt', microcourse.first_published_at,
    'lastPublishedAt', microcourse.last_published_at,
    'withdrawnAt', microcourse.withdrawn_at,
    'createdAt', microcourse.created_at,
    'updatedAt', microcourse.updated_at,
    'pageCount', (
      select count(*)
      from public.cw_page_docs page
      where page.lecture_id = microcourse.lecture_id and page.deleted_at is null
    ),
    'selectedForSession', coalesce(session.selected_teacher_microcourse_id = microcourse.id, false),
    'canEdit', public.can_author_teacher_microcourse(microcourse.id, auth.uid())
  )
  from public.teacher_microcourses microcourse
  join public.profiles author on author.id = microcourse.author_id
  join public.courses course on course.id = microcourse.course_id
  join public.course_lectures lecture on lecture.id = microcourse.lecture_id
  left join public.class_sessions session on session.id = microcourse.source_session_id
  left join public.teacher_microcourses based_on
    on based_on.id = microcourse.based_on_microcourse_id
  left join public.teacher_microcourse_metadata_revisions draft_revision
    on draft_revision.id = microcourse.draft_metadata_revision_id
  left join public.teacher_microcourse_topics draft_topic
    on draft_topic.id = draft_revision.primary_topic_id
  left join public.teacher_microcourse_metadata_revisions published_revision
    on published_revision.id = microcourse.published_metadata_revision_id
  left join public.teacher_microcourse_topics published_topic
    on published_topic.id = published_revision.primary_topic_id
  left join public.cw_lecture_workflows workflow
    on workflow.lecture_id = microcourse.lecture_id
   and workflow.track = 'native-16x9'
  where microcourse.id = p_microcourse_id
$$;

create or replace function public.create_public_class_microcourse_project(
  p_segment_id uuid,
  p_course_title text,
  p_lecture_title text,
  p_grade smallint
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_segment public.public_class_segments%rowtype;
  v_family_id uuid;
  v_catalog_version_id uuid;
  v_organization_id uuid;
  v_normalized_name text;
  v_course_id uuid;
  v_lecture_id uuid;
  v_microcourse_id uuid;
  v_metadata_revision_id uuid;
  v_topic_id uuid;
  v_branch_id uuid;
  v_actor_name text;
begin
  select * into v_segment
  from public.public_class_segments where id = p_segment_id for update;
  if not found then raise exception 'PUBLIC_CLASS_SEGMENT_NOT_FOUND'; end if;
  if not public.can_record_public_class(v_segment.activity_id, v_uid)
     or not public.has_perm(v_uid, 'courseware.microcourse.author') then
    raise exception 'FORBIDDEN';
  end if;
  if v_segment.teaching_started_at is not null then
    raise exception 'PUBLIC_CLASS_TEACHING_STARTED';
  end if;
  if char_length(btrim(coalesce(p_course_title, ''))) not between 1 and 100
     or char_length(btrim(coalesce(p_lecture_title, ''))) not between 1 and 120
     or p_grade not between 1 and 9 then
    raise exception 'VALIDATION';
  end if;

  v_topic_id := public.assert_teacher_microcourse_metadata(
    p_lecture_title, '', p_grade, null, '', 'integrated-practice', '{}'
  );
  select organization_row.id into v_organization_id
  from public.organizations organization_row where organization_row.singleton_key = 1;
  select family.id, version.id into v_family_id, v_catalog_version_id
  from public.course_families family
  join public.course_catalog_versions version
    on version.family_id = family.id and version.is_current and version.status = 'enabled'
  where family.slug = 'teacher-microcourses' and family.status = 'enabled';
  if v_family_id is null or v_catalog_version_id is null or v_organization_id is null then
    raise exception 'MICROCOURSE_FAMILY_MISSING';
  end if;

  v_normalized_name := public.normalize_teacher_microcourse_course_name(p_course_title);
  perform pg_advisory_xact_lock(hashtext(
    'teacher-microcourse-name:' || v_organization_id::text || ':' ||
    v_family_id::text || ':' || v_normalized_name
  ));
  if exists (
    select 1 from public.teacher_microcourse_catalog_courses registry
    where registry.organization_id = v_organization_id
      and registry.course_family_id = v_family_id
      and registry.normalized_name = v_normalized_name
      and registry.duplicate_of_course_id is null
      and registry.archived_at is null
  ) then raise exception 'MICROCOURSE_ALREADY_EXISTS'; end if;

  insert into public.courses(
    family_id, catalog_version_id, title, grade, term, class_type,
    status, purpose, course_kind, created_by
  ) values (
    v_family_id, v_catalog_version_id, btrim(normalize(p_course_title, NFKC)),
    p_grade, null, '', 'draft', 'production', 'microcourse', v_uid
  ) returning id into v_course_id;
  insert into public.teacher_microcourse_catalog_courses(
    course_id, organization_id, course_family_id, normalized_name, description, created_by
  ) values (
    v_course_id, v_organization_id, v_family_id, v_normalized_name, '', v_uid
  );

  select profile.display_name into v_actor_name
  from public.profiles profile where profile.id = v_uid;
  insert into public.teacher_microcourse_maintenance_branches(
    course_id, name, owner_id, created_by
  ) values (
    v_course_id, left(coalesce(nullif(btrim(v_actor_name), ''), '教师') || ' · 制作中', 120),
    v_uid, v_uid
  ) returning id into v_branch_id;
  insert into public.teacher_microcourse_branch_collaborators(branch_id, user_id, role, added_by)
  values (v_branch_id, v_uid, 'owner', v_uid);

  insert into public.course_lectures(course_id, no, name, objectives, status)
  values (v_course_id, 1, btrim(p_lecture_title), '', 'draft')
  returning id into v_lecture_id;
  insert into public.teacher_microcourses(
    source_classroom_id, source_session_id, origin_public_class_segment_id,
    author_id, course_id, lecture_id, variant_name
  ) values (
    null, null, p_segment_id, v_uid, v_course_id, v_lecture_id,
    left(coalesce(nullif(btrim(v_actor_name), ''), '教师') || ' · 活动课件', 120)
  ) returning id into v_microcourse_id;
  insert into public.teacher_microcourse_metadata_revisions(
    microcourse_id, revision_no, title, description, grade, course_season,
    class_type, primary_topic_id, keywords, created_by
  ) values (
    v_microcourse_id, 1, btrim(p_lecture_title), '', p_grade, null,
    '', v_topic_id, '{}', v_uid
  ) returning id into v_metadata_revision_id;
  update public.teacher_microcourses
  set draft_metadata_revision_id = v_metadata_revision_id
  where id = v_microcourse_id;
  insert into public.teacher_microcourse_branch_proposals(
    branch_id, catalog_lecture_id, microcourse_id
  ) values (v_branch_id, v_lecture_id, v_microcourse_id);

  update public.public_class_segments
  set microcourse_course_id = v_course_id,
      microcourse_lecture_id = v_lecture_id,
      microcourse_id = v_microcourse_id,
      teaching_snapshot = null,
      teaching_release_id = null,
      updated_by = v_uid
  where id = p_segment_id;

  perform public.emit_domain_event(
    'public_class.microcourse.created', 'public_class_segment', p_segment_id,
    jsonb_build_object(
      'courseId', v_course_id,
      'lectureId', v_lecture_id,
      'microcourseId', v_microcourse_id
    ), null, null
  );
  return jsonb_build_object(
    'courseId', v_course_id,
    'lectureId', v_lecture_id,
    'microcourseId', v_microcourse_id
  );
end;
$$;

create or replace function public.link_public_class_segment_microcourse(
  p_segment_id uuid,
  p_course_id uuid,
  p_lecture_id uuid
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_segment public.public_class_segments%rowtype;
begin
  select * into v_segment
  from public.public_class_segments segment
  where segment.id = p_segment_id for update;
  if not found then raise exception 'PUBLIC_CLASS_SEGMENT_NOT_FOUND'; end if;
  if not public.can_record_public_class(v_segment.activity_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if v_segment.teaching_started_at is not null then
    raise exception 'PUBLIC_CLASS_TEACHING_STARTED';
  end if;
  if (p_course_id is null) <> (p_lecture_id is null) then
    raise exception 'INVALID_MICROCOURSE_SELECTION';
  end if;
  if p_course_id is not null and not exists (
    select 1 from public.courses course
    join public.course_families family on family.id = course.family_id
    join public.course_lectures lecture
      on lecture.id = p_lecture_id and lecture.course_id = course.id
    where course.id = p_course_id and course.course_kind = 'microcourse'
      and course.trashed_at is null and family.slug = 'teacher-microcourses'
      and lecture.status <> 'archived'
  ) then raise exception 'INVALID_MICROCOURSE_SELECTION'; end if;
  update public.public_class_segments
  set microcourse_course_id = p_course_id,
      microcourse_lecture_id = p_lecture_id,
      microcourse_id = case
        when microcourse_course_id = p_course_id and microcourse_lecture_id = p_lecture_id
          then microcourse_id
        else null
      end,
      teaching_snapshot = null,
      teaching_release_id = null,
      updated_by = v_uid
  where id = p_segment_id;
  perform public.emit_domain_event(
    'public_class.microcourse.selected', 'public_class_segment', p_segment_id,
    jsonb_build_object('courseId', p_course_id, 'lectureId', p_lecture_id), null, null
  );
end;
$$;

create or replace function public.get_public_class_teaching_bundle(p_segment_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_segment public.public_class_segments%rowtype;
  v_snapshot jsonb;
  v_release_id uuid;
  v_pages jsonb;
  v_snapshot_count integer := 0;
  v_materialized_count integer := 0;
begin
  select * into v_segment
  from public.public_class_segments segment where segment.id = p_segment_id;
  if not found then raise exception 'PUBLIC_CLASS_SEGMENT_NOT_FOUND'; end if;
  if not public.can_record_public_class(v_segment.activity_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  v_snapshot := v_segment.teaching_snapshot;
  v_release_id := v_segment.teaching_release_id;
  if v_snapshot is null and v_segment.microcourse_id is not null then
    v_snapshot := public.build_cw_track_snapshot(v_segment.microcourse_lecture_id, 'native-16x9');
  elsif v_snapshot is null and v_segment.microcourse_lecture_id is not null then
    select coalesce(head.current_release_id, lecture.current_release_id)
      into v_release_id
    from public.course_lectures lecture
    left join public.cw_lecture_track_heads head
      on head.lecture_id = lecture.id and head.track = 'native-16x9'
    where lecture.id = v_segment.microcourse_lecture_id;
    if v_release_id is not null then
      select release.snapshot into v_snapshot
      from public.cw_lecture_releases release where release.id = v_release_id;
    end if;
  end if;
  if jsonb_typeof(v_snapshot) is distinct from 'array' then v_snapshot := '[]'::jsonb; end if;
  v_snapshot_count := jsonb_array_length(v_snapshot);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'pageDocId', page.id,
      'pageNo', entry.ordinality,
      'title', coalesce(nullif(btrim(page.title), ''), format('P%s', entry.ordinality)),
      'revisionId', revision.id,
      'aspect', page.aspect,
      'doc', revision.doc,
      'bindings', coalesce(entry.value -> 'bindings', '[]'::jsonb)
    ) order by entry.ordinality
  ), '[]'::jsonb), count(*)
  into v_pages, v_materialized_count
  from jsonb_array_elements(v_snapshot) with ordinality entry(value, ordinality)
  join public.cw_page_docs page
    on page.id = (entry.value ->> 'pageDocId')::uuid and page.deleted_at is null
  join public.cw_page_revisions revision
    on revision.id = (entry.value ->> 'revisionId')::uuid
   and revision.page_doc_id = page.id;

  return jsonb_build_object(
    'releaseId', v_release_id,
    'frozen', v_segment.teaching_snapshot is not null,
    'ready', v_snapshot_count > 0 and v_materialized_count = v_snapshot_count,
    'pages', v_pages
  );
end;
$$;

create or replace function public.start_public_class_segment_teaching(p_segment_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_segment public.public_class_segments%rowtype;
  v_snapshot jsonb;
  v_release_id uuid;
  v_snapshot_bundle jsonb;
begin
  select * into v_segment
  from public.public_class_segments segment where segment.id = p_segment_id for update;
  if not found then raise exception 'PUBLIC_CLASS_SEGMENT_NOT_FOUND'; end if;
  if not public.can_teach_public_class_segment(p_segment_id, v_uid) then raise exception 'FORBIDDEN'; end if;
  if v_segment.teaching_ended_at is not null then raise exception 'PUBLIC_CLASS_TEACHING_ENDED'; end if;
  if v_segment.teaching_started_at is not null then return; end if;
  if v_segment.microcourse_lecture_id is null then raise exception 'PUBLIC_CLASS_COURSEWARE_REQUIRED'; end if;

  if v_segment.microcourse_id is not null then
    v_snapshot_bundle := public.build_teacher_microcourse_draft_snapshot(v_segment.microcourse_id, false);
    v_snapshot := v_snapshot_bundle -> 'contentSnapshot';
  else
    select coalesce(head.current_release_id, lecture.current_release_id)
      into v_release_id
    from public.course_lectures lecture
    left join public.cw_lecture_track_heads head
      on head.lecture_id = lecture.id and head.track = 'native-16x9'
    where lecture.id = v_segment.microcourse_lecture_id;
    if v_release_id is null then raise exception 'PUBLIC_CLASS_COURSEWARE_NOT_READY'; end if;
    select release.snapshot into v_snapshot
    from public.cw_lecture_releases release where release.id = v_release_id;
  end if;
  if jsonb_typeof(v_snapshot) is distinct from 'array' or jsonb_array_length(v_snapshot) < 1 then
    raise exception 'PUBLIC_CLASS_COURSEWARE_NOT_READY';
  end if;

  update public.public_class_segments
  set teaching_snapshot = v_snapshot,
      teaching_release_id = v_release_id,
      teaching_started_at = now(),
      teaching_started_by = v_uid,
      updated_by = v_uid
  where id = p_segment_id;
  perform public.emit_domain_event(
    'public_class.teaching.started', 'public_class_segment', p_segment_id,
    jsonb_build_object('activityId', v_segment.activity_id, 'releaseId', v_release_id), null, null
  );
end;
$$;

create or replace function public.end_public_class_segment_teaching(p_segment_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_activity_id uuid;
begin
  if not public.can_teach_public_class_segment(p_segment_id, v_uid) then raise exception 'FORBIDDEN'; end if;
  update public.public_class_segments
  set teaching_ended_at = coalesce(teaching_ended_at, now()),
      teaching_ended_by = coalesce(teaching_ended_by, v_uid),
      updated_by = v_uid
  where id = p_segment_id and teaching_started_at is not null
  returning activity_id into v_activity_id;
  if v_activity_id is null then raise exception 'PUBLIC_CLASS_TEACHING_NOT_STARTED'; end if;
  perform public.emit_domain_event(
    'public_class.teaching.ended', 'public_class_segment', p_segment_id,
    jsonb_build_object('activityId', v_activity_id), null, null
  );
end;
$$;

-- Published standalone projects use their own stable catalog lecture. Class
-- proposals keep resolving through the class-session mapping.
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

  if microcourse_row.source_session_id is null then
    select proposal.catalog_lecture_id into catalog_lecture_id
    from public.teacher_microcourse_branch_proposals proposal
    where proposal.microcourse_id = microcourse_row.id
    order by proposal.linked_at desc limit 1;
    selected_microcourse_id := microcourse_row.id;
  else
    select class_lecture.lecture_id, session.selected_teacher_microcourse_id
    into catalog_lecture_id, selected_microcourse_id
    from public.teacher_microcourse_class_lectures class_lecture
    join public.class_sessions session on session.id = class_lecture.source_session_id
    where class_lecture.source_session_id = microcourse_row.source_session_id
    for update of session;
  end if;
  if catalog_lecture_id is null then raise exception 'MICROCOURSE_CATALOG_LECTURE_MISSING'; end if;
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
    and doc_version in ('microcourse-page-v1', 'courseware-composition-v1');
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
  set status = 'published', published_release_id = release_id,
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
      'originPublicClassSegmentId', microcourse_row.origin_public_class_segment_id,
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

  if microcourse_row.source_session_id is null then
    select proposal.catalog_lecture_id into catalog_lecture_id
    from public.teacher_microcourse_branch_proposals proposal
    where proposal.microcourse_id = p_microcourse_id
    order by proposal.linked_at desc limit 1;
    select catalog_release.microcourse_id into selected_microcourse_id
    from public.cw_lecture_track_heads head
    join public.teacher_microcourse_catalog_releases catalog_release
      on catalog_release.release_id = head.current_release_id
    where head.lecture_id = catalog_lecture_id and head.track = 'native-16x9';
  else
    select class_lecture.lecture_id, session.selected_teacher_microcourse_id
    into catalog_lecture_id, selected_microcourse_id
    from public.teacher_microcourse_class_lectures class_lecture
    join public.class_sessions session on session.id = class_lecture.source_session_id
    where class_lecture.source_session_id = microcourse_row.source_session_id;
  end if;
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
      'originPublicClassSegmentId', microcourse_row.origin_public_class_segment_id,
      'courseId', microcourse_row.course_id,
      'catalogLectureId', catalog_lecture_id
    ), null, null
  );
end;
$$;

revoke all on function public.can_teach_public_class_segment(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_public_class_microcourse_project(uuid, text, text, smallint)
  from public, anon, authenticated;
revoke all on function public.get_public_class_teaching_bundle(uuid)
  from public, anon, authenticated;
revoke all on function public.start_public_class_segment_teaching(uuid)
  from public, anon, authenticated;
revoke all on function public.end_public_class_segment_teaching(uuid)
  from public, anon, authenticated;

grant execute on function public.can_teach_public_class_segment(uuid, uuid) to authenticated;
grant execute on function public.create_public_class_microcourse_project(uuid, text, text, smallint)
  to authenticated;
grant execute on function public.get_public_class_teaching_bundle(uuid) to authenticated;
grant execute on function public.start_public_class_segment_teaching(uuid) to authenticated;
grant execute on function public.end_public_class_segment_teaching(uuid) to authenticated;

comment on column public.teacher_microcourses.origin_public_class_segment_id is
  'Optional authoring origin only. The reusable course survives activity deletion.';
comment on column public.public_class_segments.teaching_snapshot is
  'Exact page/revision snapshot frozen when this event segment starts teaching.';

commit;

select pg_notify('pgrst', 'reload schema');
