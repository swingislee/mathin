-- DEV-TMC-1 runtime fixes discovered by the fixed-account browser journey.

create or replace function public.get_teacher_microcourse_for_session(p_session_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
  v_microcourse_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select microcourse_row.id into v_microcourse_id
  from public.teacher_microcourses microcourse_row
  where microcourse_row.source_session_id = p_session_id;
  if v_microcourse_id is null then
    if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
    return null;
  end if;
  if not public.can_read_teacher_microcourse_draft(v_microcourse_id, uid) then
    raise exception 'FORBIDDEN';
  end if;

  select jsonb_build_object(
    'id', microcourse_row.id,
    'sourceSessionId', microcourse_row.source_session_id,
    'authorId', microcourse_row.author_id,
    'courseId', microcourse_row.course_id,
    'lectureId', microcourse_row.lecture_id,
    'courseStatus', course_row.status,
    'currentReleaseId', lecture_row.current_release_id,
    'draftMetadataRevisionId', microcourse_row.draft_metadata_revision_id,
    'publishedMetadataRevisionId', microcourse_row.published_metadata_revision_id,
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
    'workflow', case when workflow_row.lecture_id is null then null else jsonb_build_object(
      'stage', workflow_row.stage,
      'currentReviewRound', workflow_row.current_review_round,
      'requiredReviewRounds', workflow_row.required_review_rounds_snapshot,
      'activeReviewCycleId', workflow_row.active_review_cycle_id,
      'updatedAt', workflow_row.updated_at
    ) end,
    'firstPublishedAt', microcourse_row.first_published_at,
    'lastPublishedAt', microcourse_row.last_published_at,
    'withdrawnAt', microcourse_row.withdrawn_at
  ) into result
  from public.teacher_microcourses microcourse_row
  join public.courses course_row on course_row.id = microcourse_row.course_id
  join public.course_lectures lecture_row on lecture_row.id = microcourse_row.lecture_id
  left join public.teacher_microcourse_metadata_revisions draft_revision
    on draft_revision.id = microcourse_row.draft_metadata_revision_id
  left join public.teacher_microcourse_topics draft_topic
    on draft_topic.id = draft_revision.primary_topic_id
  left join public.teacher_microcourse_metadata_revisions published_revision
    on published_revision.id = microcourse_row.published_metadata_revision_id
  left join public.teacher_microcourse_topics published_topic
    on published_topic.id = published_revision.primary_topic_id
  left join public.cw_lecture_workflows workflow_row
    on workflow_row.lecture_id = microcourse_row.lecture_id
   and workflow_row.track = 'native-16x9'
  where microcourse_row.id = v_microcourse_id;
  return result;
end;
$$;

create or replace function public.freeze_teacher_microcourse_source_session(p_microcourse_id uuid)
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
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page_row.id,
    'type', 'doc',
    'docId', page_row.id,
    'title', page_row.title
  ) order by page_item.ordinality), '[]'::jsonb)
  into courseware_value
  from jsonb_array_elements(snapshot_bundle -> 'contentSnapshot')
    with ordinality page_item(value, ordinality)
  join public.cw_page_docs page_row
    on page_row.id = (page_item.value ->> 'pageDocId')::uuid
   and page_row.lecture_id = microcourse_row.lecture_id;
  perform public.freeze_session_courseware(
    microcourse_row.source_session_id, courseware_value, resolved_value
  );
  return resolved_value;
end;
$$;
