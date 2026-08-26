-- DEV-TMC-1: immutable review submissions, atomic publication, draft-session
-- freezing, withdrawal, and the school microcourse catalog projection.

begin;

-- ---------------------------------------------------------------------------
-- 1. exact draft snapshot and submission validation
-- ---------------------------------------------------------------------------

create function public.build_teacher_microcourse_draft_snapshot(
  p_microcourse_id uuid,
  p_require_publishable boolean default false
)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  microcourse_row public.teacher_microcourses%rowtype;
  snapshot jsonb;
  h5_hashes jsonb;
begin
  select * into microcourse_row
  from public.teacher_microcourses
  where id = p_microcourse_id;
  if not found then raise exception 'MICROCOURSE_NOT_FOUND'; end if;
  if not public.cw_track_is_ready(microcourse_row.lecture_id, 'native-16x9') then
    raise exception 'PAGE_TRACK_NOT_READY';
  end if;
  snapshot := public.build_cw_track_snapshot(microcourse_row.lecture_id, 'native-16x9');
  if jsonb_typeof(snapshot) <> 'array' or jsonb_array_length(snapshot) < 1 then
    raise exception 'MICROCOURSE_REQUIRES_PAGE';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    where revision_row.doc_version <> 'microcourse-page-v1'
      or not public.cw_microcourse_page_doc_is_valid(revision_row.doc)
  ) then raise exception 'INVALID_MICROCOURSE_PAGE'; end if;
  if coalesce(p_require_publishable, false) and exists (
    select 1
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    where revision_row.doc ->> 'mode' = 'sudoku'
      and (
        revision_row.doc #>> '{analysis,status}' <> 'unique'
        or public.teacher_microcourse_sudoku_analysis(revision_row.doc -> 'puzzle')
          ->> 'status' <> 'unique'
      )
  ) then raise exception 'SUDOKU_UNIQUE_SOLUTION_REQUIRED'; end if;
  if exists (
    select 1
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    left join public.teacher_microcourse_h5_artifacts artifact
      on artifact.id = case
        when coalesce(revision_row.doc ->> 'artifactId', '')
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (revision_row.doc ->> 'artifactId')::uuid else null end
     and artifact.microcourse_id = p_microcourse_id
    where revision_row.doc ->> 'mode' = 'h5'
      and (
        artifact.id is null
        or artifact.sha256 <> revision_row.doc ->> 'sha256'
        or artifact.byte_count::text <> revision_row.doc ->> 'byteCount'
      )
  ) then raise exception 'H5_ARTIFACT_SNAPSHOT_MISMATCH'; end if;
  select coalesce(jsonb_agg(to_jsonb(hash_value) order by hash_value), '[]'::jsonb)
  into h5_hashes
  from (
    select distinct revision_row.doc ->> 'sha256' as hash_value
    from jsonb_array_elements(snapshot) item
    join public.cw_page_revisions revision_row
      on revision_row.id = (item.value ->> 'revisionId')::uuid
    where revision_row.doc ->> 'mode' = 'h5'
  ) hashes;
  return jsonb_build_object(
    'contentSnapshot', snapshot,
    'h5Hashes', h5_hashes
  );
end;
$$;

create function public.submit_teacher_microcourse_review(
  p_microcourse_id uuid,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  microcourse_row public.teacher_microcourses%rowtype;
  workflow_row public.cw_lecture_workflows%rowtype;
  policy_row public.cw_workflow_policies;
  snapshot_bundle jsonb;
  next_cycle_no smallint;
  next_round_no smallint;
  required_snapshot smallint;
  new_cycle_id uuid;
  due_value timestamptz;
begin
  perform public.assert_teacher_microcourse_author(p_microcourse_id);
  select * into microcourse_row from public.teacher_microcourses
  where id = p_microcourse_id for update;
  if microcourse_row.draft_metadata_revision_id is null then
    raise exception 'MICROCOURSE_METADATA_REQUIRED';
  end if;
  snapshot_bundle := public.build_teacher_microcourse_draft_snapshot(
    p_microcourse_id, true
  );
  insert into public.cw_lecture_workflows(lecture_id, track, stage, updated_by)
  values (microcourse_row.lecture_id, 'native-16x9', 'idle', uid)
  on conflict(lecture_id, track) do nothing;
  select * into workflow_row from public.cw_lecture_workflows
  where lecture_id = microcourse_row.lecture_id and track = 'native-16x9'
  for update;
  if workflow_row.stage not in ('idle', 'editing', 'changes_requested') then
    raise exception 'INVALID_STAGE_FOR_SUBMIT';
  end if;
  policy_row := public.resolve_cw_workflow_policy(microcourse_row.lecture_id);
  if workflow_row.stage = 'changes_requested'
     and workflow_row.active_review_cycle_id is not null then
    select workflow_cycle_no into next_cycle_no
    from public.cw_review_cycles where id = workflow_row.active_review_cycle_id;
    next_round_no := workflow_row.current_review_round;
    required_snapshot := workflow_row.required_review_rounds_snapshot;
  else
    select coalesce(max(workflow_cycle_no), 0) + 1 into next_cycle_no
    from public.cw_review_cycles
    where lecture_id = microcourse_row.lecture_id and track = 'native-16x9';
    next_round_no := 1;
    required_snapshot := policy_row.required_review_rounds;
  end if;
  insert into public.cw_review_cycles(
    lecture_id, track, workflow_cycle_no, review_round_no, status,
    creator_id, reviewer_id, self_review, policy_snapshot,
    content_snapshot, submission_note, submitted_at, delivery_mode
  ) values (
    microcourse_row.lecture_id, 'native-16x9', next_cycle_no, next_round_no,
    'submitted', uid, null, false,
    jsonb_build_object(
      'policyId', policy_row.id,
      'scopeType', policy_row.scope_type,
      'requiredReviewRounds', policy_row.required_review_rounds,
      'allowCreatorAsReviewer', policy_row.allow_creator_as_reviewer,
      'emergencyPublishEnabled', false,
      'defaultReviewSlaHours', policy_row.default_review_sla_hours,
      'microcourseReviewVersion', 'teacher-microcourse-review-v1'
    ),
    snapshot_bundle -> 'contentSnapshot',
    left(btrim(coalesce(p_note, '')), 1000), now(), 'legacy-single-track'
  ) returning id into new_cycle_id;
  insert into public.teacher_microcourse_review_snapshots(
    microcourse_id, review_cycle_id, metadata_revision_id, h5_hashes
  ) values (
    p_microcourse_id, new_cycle_id, microcourse_row.draft_metadata_revision_id,
    snapshot_bundle -> 'h5Hashes'
  );
  if policy_row.default_review_sla_hours is not null then
    due_value := now() + make_interval(hours => policy_row.default_review_sla_hours);
  end if;
  update public.cw_lecture_workflows
  set stage = 'in_review',
      current_review_round = next_round_no,
      required_review_rounds_snapshot = required_snapshot,
      active_review_cycle_id = new_cycle_id,
      internal_due_at = due_value,
      updated_by = uid,
      updated_at = now()
  where lecture_id = microcourse_row.lecture_id and track = 'native-16x9';
  perform public.emit_domain_event(
    'teacher_microcourse.review_submitted', 'teacher_microcourse', p_microcourse_id,
    jsonb_build_object(
      'reviewCycleId', new_cycle_id,
      'metadataRevisionId', microcourse_row.draft_metadata_revision_id,
      'pageCount', jsonb_array_length(snapshot_bundle -> 'contentSnapshot')
    ), null, null
  );
  return new_cycle_id;
end;
$$;

create function public.withdraw_teacher_microcourse_review(p_review_cycle_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare cycle_row public.cw_review_cycles%rowtype; microcourse_id uuid;
begin
  select cycle.* into cycle_row
  from public.cw_review_cycles cycle
  join public.teacher_microcourse_review_snapshots snapshot_row
    on snapshot_row.review_cycle_id = cycle.id
  where cycle.id = p_review_cycle_id
  for update of cycle;
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  select snapshot_row.microcourse_id into microcourse_id
  from public.teacher_microcourse_review_snapshots snapshot_row
  where snapshot_row.review_cycle_id = p_review_cycle_id;
  perform public.assert_teacher_microcourse_author(microcourse_id);
  if cycle_row.creator_id <> auth.uid() then raise exception 'FORBIDDEN'; end if;
  if cycle_row.status <> 'submitted' then raise exception 'INVALID_CYCLE_STATUS'; end if;
  update public.cw_review_cycles
  set status = 'withdrawn', closed_at = now()
  where id = p_review_cycle_id;
  update public.cw_lecture_workflows
  set stage = 'editing', active_review_cycle_id = null,
      updated_by = auth.uid(), updated_at = now()
  where lecture_id = cycle_row.lecture_id and track = cycle_row.track;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. research review and atomic publication projection
-- ---------------------------------------------------------------------------

create function public.prepare_teacher_microcourse_review_publish(p_review_cycle_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare snapshot_row public.teacher_microcourse_review_snapshots%rowtype;
begin
  if auth.uid() is null or not (
    public.is_admin(auth.uid()) or public.has_perm(auth.uid(), 'courseware.review')
  ) then raise exception 'FORBIDDEN'; end if;
  select micro_snapshot.* into snapshot_row
  from public.teacher_microcourse_review_snapshots micro_snapshot
  join public.cw_review_cycles cycle_row
    on cycle_row.id = micro_snapshot.review_cycle_id
  where micro_snapshot.review_cycle_id = p_review_cycle_id
    and cycle_row.status = 'submitted';
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  return jsonb_build_object(
    'microcourseId', snapshot_row.microcourse_id,
    'artifacts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'artifactId', artifact.id,
        'sha256', artifact.sha256,
        'privatePath', artifact.private_path,
        'publicPath', 'packages/' || artifact.sha256 || '/index.html'
      ) order by artifact.sha256), '[]'::jsonb)
      from jsonb_array_elements_text(snapshot_row.h5_hashes) hash_item
      join public.teacher_microcourse_h5_artifacts artifact
        on artifact.microcourse_id = snapshot_row.microcourse_id
       and artifact.sha256 = hash_item.value
    )
  );
end;
$$;

create function public.teacher_microcourse_h5_promotions_are_ready(
  p_review_cycle_id uuid
)
returns boolean
language sql security definer stable
set search_path = public, storage, pg_temp
as $$
  select coalesce(not exists (
    select 1
    from public.teacher_microcourse_review_snapshots snapshot_row
    cross join lateral jsonb_array_elements_text(snapshot_row.h5_hashes) hash_item
    where snapshot_row.review_cycle_id = p_review_cycle_id
      and not exists (
        select 1 from storage.objects object_row
        where object_row.bucket_id = 'cw-h5'
          and object_row.name = 'packages/' || hash_item.value || '/index.html'
      )
  ), false)
$$;

create function public.publish_teacher_microcourse_review_internal(
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
  update public.courses
  set title = metadata_row.title,
      grade = metadata_row.grade,
      term = metadata_row.course_season,
      class_type = metadata_row.class_type,
      status = 'enabled',
      updated_at = now()
  where id = microcourse_row.course_id;
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
      'reviewCycleId', p_review_cycle_id,
      'releaseId', release_id,
      'metadataRevisionId', micro_snapshot.metadata_revision_id
    ), null, null
  );
  return release_id;
end;
$$;

create function public.approve_teacher_microcourse_review(
  p_review_cycle_id uuid,
  p_note text default '',
  p_reviewed_pages integer[] default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  source_snapshot public.teacher_microcourse_review_snapshots%rowtype;
  result_cycle_id uuid;
  release_id uuid;
begin
  if auth.uid() is null or not (
    public.is_admin(auth.uid()) or public.has_perm(auth.uid(), 'courseware.review')
  ) then raise exception 'FORBIDDEN'; end if;
  select * into source_snapshot
  from public.teacher_microcourse_review_snapshots
  where review_cycle_id = p_review_cycle_id;
  if not found then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  result_cycle_id := public.approve_cw_review_pre_sml0_impl(
    p_review_cycle_id, p_note, p_reviewed_pages
  );
  if result_cycle_id <> p_review_cycle_id then
    insert into public.teacher_microcourse_review_snapshots(
      microcourse_id, review_cycle_id, metadata_revision_id, h5_hashes
    ) values (
      source_snapshot.microcourse_id, result_cycle_id,
      source_snapshot.metadata_revision_id, source_snapshot.h5_hashes
    );
    return jsonb_build_object(
      'status', 'in_review', 'reviewCycleId', result_cycle_id, 'releaseId', null
    );
  end if;
  release_id := public.publish_teacher_microcourse_review_internal(
    p_review_cycle_id, p_note, auth.uid()
  );
  return jsonb_build_object(
    'status', 'published', 'reviewCycleId', p_review_cycle_id,
    'releaseId', release_id
  );
end;
$$;

create function public.reject_teacher_microcourse_review(
  p_review_cycle_id uuid,
  p_note text,
  p_reviewed_pages integer[] default null
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not (
    public.is_admin(auth.uid()) or public.has_perm(auth.uid(), 'courseware.review')
  ) then raise exception 'FORBIDDEN'; end if;
  if not exists (
    select 1 from public.teacher_microcourse_review_snapshots
    where review_cycle_id = p_review_cycle_id
  ) then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  perform public.reject_cw_review_pre_sml0_impl(
    p_review_cycle_id, p_note, p_reviewed_pages
  );
end;
$$;

create function public.withdraw_teacher_microcourse(p_microcourse_id uuid)
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
  update public.courses set status = 'disabled', updated_at = now()
  where id = microcourse_row.course_id;
  update public.teacher_microcourses set withdrawn_at = now()
  where id = p_microcourse_id;
  perform public.emit_domain_event(
    'teacher_microcourse.withdrawn', 'teacher_microcourse', p_microcourse_id,
    jsonb_build_object('courseId', microcourse_row.course_id), null, null
  );
end;
$$;

create function public.list_teacher_microcourse_review_queue()
returns table(
  review_cycle_id uuid,
  microcourse_id uuid,
  title text,
  author_id uuid,
  author_name text,
  grade smallint,
  course_season smallint,
  class_type text,
  primary_topic_slug text,
  primary_topic_title_zh text,
  primary_topic_title_en text,
  keywords text[],
  review_round_no smallint,
  required_review_rounds smallint,
  submitted_at timestamptz,
  submission_note text
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not (
    public.is_admin(auth.uid()) or public.has_perm(auth.uid(), 'courseware.review')
  ) then raise exception 'FORBIDDEN'; end if;
  return query
  select
    cycle_row.id,
    microcourse_row.id,
    metadata_row.title,
    microcourse_row.author_id,
    profile_row.display_name,
    metadata_row.grade,
    metadata_row.course_season,
    metadata_row.class_type,
    topic_row.slug,
    topic_row.title_zh,
    topic_row.title_en,
    metadata_row.keywords,
    cycle_row.review_round_no,
    workflow_row.required_review_rounds_snapshot,
    cycle_row.submitted_at,
    cycle_row.submission_note
  from public.cw_review_cycles cycle_row
  join public.teacher_microcourse_review_snapshots snapshot_row
    on snapshot_row.review_cycle_id = cycle_row.id
  join public.teacher_microcourses microcourse_row
    on microcourse_row.id = snapshot_row.microcourse_id
  join public.teacher_microcourse_metadata_revisions metadata_row
    on metadata_row.id = snapshot_row.metadata_revision_id
  join public.teacher_microcourse_topics topic_row
    on topic_row.id = metadata_row.primary_topic_id
  join public.profiles profile_row on profile_row.id = microcourse_row.author_id
  join public.cw_lecture_workflows workflow_row
    on workflow_row.active_review_cycle_id = cycle_row.id
  where cycle_row.status = 'submitted'
  order by cycle_row.submitted_at, cycle_row.id;
end;
$$;

create function public.get_teacher_microcourse_review(p_review_cycle_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if auth.uid() is null or not (
    public.is_admin(auth.uid()) or public.has_perm(auth.uid(), 'courseware.review')
  ) then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object(
    'reviewCycleId', cycle_row.id,
    'microcourseId', microcourse_row.id,
    'authorId', microcourse_row.author_id,
    'authorName', profile_row.display_name,
    'status', cycle_row.status,
    'reviewRoundNo', cycle_row.review_round_no,
    'requiredReviewRounds', workflow_row.required_review_rounds_snapshot,
    'submissionNote', cycle_row.submission_note,
    'submittedAt', cycle_row.submitted_at,
    'metadata', jsonb_build_object(
      'revisionId', metadata_row.id,
      'revisionNo', metadata_row.revision_no,
      'title', metadata_row.title,
      'description', metadata_row.description,
      'grade', metadata_row.grade,
      'courseSeason', metadata_row.course_season,
      'classType', metadata_row.class_type,
      'primaryTopicSlug', topic_row.slug,
      'primaryTopicTitleZh', topic_row.title_zh,
      'primaryTopicTitleEn', topic_row.title_en,
      'keywords', metadata_row.keywords
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'pageDocId', page_row.id,
        'pageNo', page_item.ordinality,
        'title', page_row.title,
        'revisionId', revision_row.id,
        'revisionNo', revision_row.revision_no,
        'doc', revision_row.doc,
        'bindings', page_item.value -> 'bindings'
      ) order by page_item.ordinality), '[]'::jsonb)
      from jsonb_array_elements(cycle_row.content_snapshot)
        with ordinality page_item(value, ordinality)
      join public.cw_page_docs page_row
        on page_row.id = (page_item.value ->> 'pageDocId')::uuid
      join public.cw_page_revisions revision_row
        on revision_row.id = (page_item.value ->> 'revisionId')::uuid
       and revision_row.page_doc_id = page_row.id
    )
  ) into result
  from public.cw_review_cycles cycle_row
  join public.teacher_microcourse_review_snapshots snapshot_row
    on snapshot_row.review_cycle_id = cycle_row.id
  join public.teacher_microcourses microcourse_row
    on microcourse_row.id = snapshot_row.microcourse_id
  join public.teacher_microcourse_metadata_revisions metadata_row
    on metadata_row.id = snapshot_row.metadata_revision_id
  join public.teacher_microcourse_topics topic_row
    on topic_row.id = metadata_row.primary_topic_id
  join public.profiles profile_row on profile_row.id = microcourse_row.author_id
  left join public.cw_lecture_workflows workflow_row
    on workflow_row.lecture_id = cycle_row.lecture_id
   and workflow_row.track = cycle_row.track
  where cycle_row.id = p_review_cycle_id;
  if result is null then raise exception 'REVIEW_CYCLE_NOT_FOUND'; end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. source free-session freeze and exact runtime read
-- ---------------------------------------------------------------------------

create function public.freeze_teacher_microcourse_source_session(p_microcourse_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  microcourse_row public.teacher_microcourses%rowtype;
  session_row public.class_sessions%rowtype;
  track_value text;
  snapshot_bundle jsonb;
  resolved_value jsonb;
  courseware_value jsonb;
begin
  perform public.assert_teacher_microcourse_author(p_microcourse_id);
  select * into microcourse_row from public.teacher_microcourses
  where id = p_microcourse_id for update;
  select session.* into session_row
  from public.class_sessions session
  join public.classrooms classroom on classroom.id = session.classroom_id
  where session.id = microcourse_row.source_session_id
    and session.deleted_at is null
  for update of session;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  select coalesce(session.courseware_track_override, classroom.courseware_track)
  into track_value
  from public.class_sessions session
  join public.classrooms classroom on classroom.id = session.classroom_id
  where session.id = microcourse_row.source_session_id;
  snapshot_bundle := public.build_teacher_microcourse_draft_snapshot(
    p_microcourse_id, false
  );
  resolved_value := jsonb_build_object(
    'version', 'cw-session-resolved-v1',
    'track', track_value,
    'releaseId', null,
    'microcourseDraft', jsonb_build_object(
      'microcourseId', p_microcourse_id,
      'metadataRevisionId', microcourse_row.draft_metadata_revision_id,
      'pages', snapshot_bundle -> 'contentSnapshot'
    ),
    'bindings', coalesce((
      select jsonb_agg(binding.value order by page_item.ordinality, binding.value ->> 'bindingKey')
      from jsonb_array_elements(snapshot_bundle -> 'contentSnapshot')
        with ordinality page_item(value, ordinality)
      cross join lateral jsonb_array_elements(page_item.value -> 'bindings') binding
    ), '[]'::jsonb)
  );
  courseware_value := case
    when jsonb_typeof(session_row.courseware) = 'array' then session_row.courseware
    else '[]'::jsonb
  end;
  perform public.freeze_session_courseware(
    microcourse_row.source_session_id, courseware_value, resolved_value
  );
  return resolved_value;
end;
$$;

create or replace function public.get_session_page_docs(p_session_id uuid)
returns table(page_doc_id uuid, page_no integer, doc jsonb, bindings jsonb)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  context record;
  release_snapshot jsonb;
  resolved_value jsonb;
  draft_snapshot jsonb;
  microcourse_id uuid;
begin
  if uid is null or not public.is_session_member(p_session_id, uid) then
    raise exception 'FORBIDDEN';
  end if;
  select session.courseware_resolved into resolved_value
  from public.class_sessions session
  where session.id = p_session_id and session.deleted_at is null;
  if jsonb_typeof(resolved_value #> '{microcourseDraft,pages}') = 'array' then
    microcourse_id := (resolved_value #>> '{microcourseDraft,microcourseId}')::uuid;
    if not public.can_read_teacher_microcourse_draft(microcourse_id, uid) then
      raise exception 'FORBIDDEN';
    end if;
    draft_snapshot := resolved_value #> '{microcourseDraft,pages}';
    return query
    select page_row.id,
           entry.ordinality::integer,
           revision_row.doc,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'bindingKey', binding.value ->> 'bindingKey',
               'objectHash', object_row.sha256,
               'kind', object_row.kind,
               'launchQuery', page_binding.launch_query
             ) order by binding.value ->> 'bindingKey')
             from jsonb_array_elements(entry.value -> 'bindings') binding
             join public.cw_asset_revisions asset_revision
               on asset_revision.id = (binding.value ->> 'assetRevisionId')::uuid
             join public.cw_asset_objects object_row
               on object_row.id = asset_revision.object_id
             left join public.cw_page_asset_bindings page_binding
               on page_binding.page_doc_id = page_row.id
              and page_binding.binding_key = binding.value ->> 'bindingKey'
              and page_binding.track = 'native-16x9'
           ), '[]'::jsonb)
    from jsonb_array_elements(draft_snapshot) with ordinality entry(value, ordinality)
    join public.cw_page_docs page_row
      on page_row.id = (entry.value ->> 'pageDocId')::uuid
    join public.cw_page_revisions revision_row
      on revision_row.id = (entry.value ->> 'revisionId')::uuid
     and revision_row.page_doc_id = page_row.id
    order by entry.ordinality;
    return;
  end if;
  select * into context from public.resolve_cw_session_release_context(p_session_id);
  if context.release_id is null then return; end if;
  select release.snapshot into release_snapshot
  from public.cw_lecture_releases release
  where release.id = context.release_id
    and release.lecture_id = context.lecture_id
    and release.track = context.track;
  if release_snapshot is null then raise exception 'RELEASE_NOT_FOUND'; end if;
  return query
  select page_row.id,
         entry.ordinality::integer,
         revision_row.doc,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'bindingKey', binding.value ->> 'bindingKey',
             'objectHash', object_row.sha256,
             'kind', object_row.kind,
             'launchQuery', page_binding.launch_query
           ) order by binding.value ->> 'bindingKey')
           from jsonb_array_elements(entry.value -> 'bindings') binding
           join public.cw_asset_revisions asset_revision
             on asset_revision.id = (binding.value ->> 'assetRevisionId')::uuid
           join public.cw_asset_objects object_row
             on object_row.id = asset_revision.object_id
           left join public.cw_page_asset_bindings page_binding
             on page_binding.page_doc_id = page_row.id
            and page_binding.binding_key = binding.value ->> 'bindingKey'
            and page_binding.track = context.track
         ), '[]'::jsonb)
  from jsonb_array_elements(release_snapshot) with ordinality entry(value, ordinality)
  join public.cw_page_docs page_row
    on page_row.id = (entry.value ->> 'pageDocId')::uuid
  join public.cw_page_revisions revision_row
    on revision_row.id = (entry.value ->> 'revisionId')::uuid
   and revision_row.page_doc_id = page_row.id
  order by entry.ordinality;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. class-builder catalog: curriculum and published teacher microcourses
-- ---------------------------------------------------------------------------

drop function public.list_class_build_course_variants(
  text, smallint, smallint, text, text, integer, boolean
);

create function public.list_class_build_course_variants(
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
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
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
    microcourse_row.author_id,
    author_profile.display_name,
    topic_row.slug,
    topic_row.title_zh,
    topic_row.title_en,
    metadata_row.keywords
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
  left join public.teacher_microcourses microcourse_row
    on microcourse_row.course_id = course_row.id
  left join public.teacher_microcourse_metadata_revisions metadata_row
    on metadata_row.id = microcourse_row.published_metadata_revision_id
  left join public.teacher_microcourse_topics topic_row
    on topic_row.id = metadata_row.primary_topic_id
  left join public.profiles author_profile on author_profile.id = microcourse_row.author_id
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
    and (p_author_id is null or microcourse_row.author_id = p_author_id)
    and (p_primary_topic_slug is null or topic_row.slug = p_primary_topic_slug)
    and (
      normalized_keyword is null
      or exists (
        select 1 from unnest(coalesce(metadata_row.keywords, '{}'::text[])) keyword_value
        where lower(keyword_value) like '%' || normalized_keyword || '%'
      )
    )
    and (
      course_row.course_kind = 'curriculum'
      or (
        microcourse_row.published_metadata_revision_id is not null
        and microcourse_row.withdrawn_at is null
        and counts.lecture_count = 1
        and counts.released_lecture_count = 1
      )
    )
    and (
      normalized_query = ''
      or lower(family_row.title) like '%' || normalized_query || '%'
      or lower(course_row.title) like '%' || normalized_query || '%'
      or lower(coalesce(course_row.product_code, '')) like '%' || normalized_query || '%'
      or lower(coalesce(author_profile.display_name, '')) like '%' || normalized_query || '%'
      or lower(coalesce(topic_row.title_zh, '')) like '%' || normalized_query || '%'
      or lower(coalesce(topic_row.title_en, '')) like '%' || normalized_query || '%'
      or exists (
        select 1 from public.course_lectures lecture_match
        where lecture_match.course_id = course_row.id
          and lecture_match.status = 'active'
          and lower(lecture_match.name) like '%' || normalized_query || '%'
      )
      or exists (
        select 1 from unnest(coalesce(metadata_row.keywords, '{}'::text[])) keyword_value
        where lower(keyword_value) like '%' || normalized_query || '%'
      )
    )
  order by
    case when course_row.course_kind = 'microcourse' then 0 else 1 end,
    coalesce(microcourse_row.last_published_at, course_row.updated_at) desc,
    family_row.title, version_row.sort_order desc,
    course_row.grade, course_row.term nulls last, course_row.class_type, course_row.title
  limit bounded_limit;
end;
$$;

create or replace function public.get_class_build_course_detail(
  p_course_id uuid, p_purpose text default 'production'
)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
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
    'authorId', microcourse_row.author_id,
    'authorName', author_profile.display_name,
    'primaryTopicSlug', topic_row.slug,
    'primaryTopicTitleZh', topic_row.title_zh,
    'primaryTopicTitleEn', topic_row.title_en,
    'keywords', metadata_row.keywords,
    'lectures', coalesce(lectures.rows, '[]'::jsonb)
  ) into result
  from public.courses course_row
  join public.course_families family_row on family_row.id = course_row.family_id
  join public.course_catalog_versions version_row on version_row.id = course_row.catalog_version_id
  left join public.teacher_microcourses microcourse_row
    on microcourse_row.course_id = course_row.id
  left join public.teacher_microcourse_metadata_revisions metadata_row
    on metadata_row.id = microcourse_row.published_metadata_revision_id
  left join public.teacher_microcourse_topics topic_row
    on topic_row.id = metadata_row.primary_topic_id
  left join public.profiles author_profile on author_profile.id = microcourse_row.author_id
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
    and (
      course_row.course_kind = 'curriculum'
      or (
        microcourse_row.published_metadata_revision_id is not null
        and microcourse_row.withdrawn_at is null
        and counts.lecture_count = 1
        and counts.released_lecture_count = 1
      )
    );
  if result is null then raise exception 'COURSE_NOT_AVAILABLE'; end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. grants and audit boundary
-- ---------------------------------------------------------------------------

revoke all on function public.build_teacher_microcourse_draft_snapshot(uuid, boolean) from public, anon, authenticated;
revoke all on function public.teacher_microcourse_h5_promotions_are_ready(uuid) from public, anon, authenticated;
revoke all on function public.publish_teacher_microcourse_review_internal(uuid, text, uuid) from public, anon, authenticated;

revoke all on function public.submit_teacher_microcourse_review(uuid, text) from public, anon, authenticated;
revoke all on function public.withdraw_teacher_microcourse_review(uuid) from public, anon, authenticated;
revoke all on function public.prepare_teacher_microcourse_review_publish(uuid) from public, anon, authenticated;
revoke all on function public.approve_teacher_microcourse_review(uuid, text, integer[]) from public, anon, authenticated;
revoke all on function public.reject_teacher_microcourse_review(uuid, text, integer[]) from public, anon, authenticated;
revoke all on function public.withdraw_teacher_microcourse(uuid) from public, anon, authenticated;
revoke all on function public.list_teacher_microcourse_review_queue() from public, anon, authenticated;
revoke all on function public.get_teacher_microcourse_review(uuid) from public, anon, authenticated;
revoke all on function public.freeze_teacher_microcourse_source_session(uuid) from public, anon, authenticated;
revoke all on function public.list_class_build_course_variants(text, smallint, smallint, text, text, integer, boolean, text, uuid, text, text) from public, anon, authenticated;

grant execute on function public.submit_teacher_microcourse_review(uuid, text) to authenticated;
grant execute on function public.withdraw_teacher_microcourse_review(uuid) to authenticated;
grant execute on function public.prepare_teacher_microcourse_review_publish(uuid) to authenticated;
grant execute on function public.approve_teacher_microcourse_review(uuid, text, integer[]) to authenticated;
grant execute on function public.reject_teacher_microcourse_review(uuid, text, integer[]) to authenticated;
grant execute on function public.withdraw_teacher_microcourse(uuid) to authenticated;
grant execute on function public.list_teacher_microcourse_review_queue() to authenticated;
grant execute on function public.get_teacher_microcourse_review(uuid) to authenticated;
grant execute on function public.freeze_teacher_microcourse_source_session(uuid) to authenticated;
grant execute on function public.list_class_build_course_variants(text, smallint, smallint, text, text, integer, boolean, text, uuid, text, text) to authenticated;

comment on function public.submit_teacher_microcourse_review(uuid, text) is
  'Freezes metadata revision, page revisions, asset revisions and H5 hashes into one immutable teacher-microcourse submission.';
comment on function public.approve_teacher_microcourse_review(uuid, text, integer[]) is
  'Final approval atomically creates the release, projects reviewed metadata, enables catalog visibility and advances future-use heads.';
comment on function public.freeze_teacher_microcourse_source_session(uuid) is
  'Pins the author draft to the originating free session without converting that class into a curriculum course class.';

notify pgrst, 'reload schema';

commit;
