-- P4I-11：讲次工作区。
-- 1) get_lecture_workspace_detail：聚合讲次身份、双轨道校对状态机头（cw_lecture_workflows）、
--    当前 release（cw_lecture_track_heads/cw_lecture_releases）、讲次层直接责任
--    （course_staff_assignments）与就近继承的有效责任（resolve_course_assignments，
--    P4I-2 建好后零消费者）、使用班级课次（class_sessions/classrooms）、
--    校对历史（cw_review_cycles，P4I-3 建好后零消费者）。只读聚合，不改动任何既有 RPC。
-- 2) assign_course_owner / add_course_collaborator：scope_type 从 family/variant
--    扩展到 lecture（course_staff_assignments 表与唯一索引早已支持 lecture scope，
--    只是这两个 RPC 之前的校验白名单没跟上）。

create or replace function public.get_lecture_workspace_detail(p_lecture_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  can_manage boolean;
  lecture_row public.course_lectures%rowtype;
  course_row public.courses%rowtype;
  family_row public.course_families%rowtype;
  policy_row public.cw_workflow_policies;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.view') then raise exception 'FORBIDDEN'; end if;
  can_manage := public.has_perm(uid, 'course.manage');

  select * into lecture_row from public.course_lectures where id = p_lecture_id;
  if not found then raise exception 'LECTURE_NOT_FOUND'; end if;
  select * into course_row from public.courses where id = lecture_row.course_id;
  select * into family_row from public.course_families where id = course_row.family_id;

  if not can_manage and (course_row.trashed_at is not null or course_row.status <> 'enabled') then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  policy_row := public.resolve_cw_workflow_policy(p_lecture_id);

  return jsonb_build_object(
    'policy', jsonb_build_object(
      'requiredReviewRounds', policy_row.required_review_rounds,
      'allowCreatorAsReviewer', policy_row.allow_creator_as_reviewer,
      'emergencyPublishEnabled', policy_row.emergency_publish_enabled
    ),
    'lecture', jsonb_build_object(
      'id', lecture_row.id,
      'no', lecture_row.no,
      'name', lecture_row.name,
      'objectives', lecture_row.objectives,
      'status', lecture_row.status,
      'archivedAt', lecture_row.archived_at,
      'pageCount', (select count(*) from public.cw_page_docs page_row where page_row.lecture_id = p_lecture_id and page_row.deleted_at is null)
    ),
    'family', jsonb_build_object('id', family_row.id, 'title', family_row.title),
    'variant', jsonb_build_object(
      'id', course_row.id,
      'title', course_row.title,
      'grade', course_row.grade,
      'courseSeason', course_row.term,
      'classType', course_row.class_type
    ),
    'tracks', (
      select jsonb_agg(jsonb_build_object(
        'track', track_name,
        'stage', coalesce(workflow_row.stage, 'idle'),
        'currentReviewRound', workflow_row.current_review_round,
        'requiredReviewRounds', workflow_row.required_review_rounds_snapshot,
        'internalDueAt', workflow_row.internal_due_at,
        'currentReleaseNo', release_row.release_no,
        'hasUnpublishedChanges', (
          coalesce(workflow_row.stage, 'idle') = 'idle'
          and track_head_row.current_release_id is not null
          and exists (
            select 1
            from public.cw_page_track_heads head_row
            join public.cw_page_docs page_row on page_row.id = head_row.page_doc_id
            where page_row.lecture_id = p_lecture_id
              and head_row.track = track_name
              and page_row.deleted_at is null
              and head_row.draft_revision_id is not null
          )
        ),
        'activeReviewCycle', case when workflow_row.active_review_cycle_id is not null then (
          select jsonb_build_object(
            'id', cycle_row.id,
            'creatorId', cycle_row.creator_id,
            'creatorName', creator_profile.display_name,
            'submittedAt', cycle_row.submitted_at,
            'submissionNote', cycle_row.submission_note
          )
          from public.cw_review_cycles cycle_row
          join public.profiles creator_profile on creator_profile.id = cycle_row.creator_id
          where cycle_row.id = workflow_row.active_review_cycle_id
        ) else null end
      ))
      from unnest(array['native-16x9', 'adapted-4x3']) as track_name
      left join public.cw_lecture_workflows workflow_row on workflow_row.lecture_id = p_lecture_id and workflow_row.track = track_name
      left join public.cw_lecture_track_heads track_head_row on track_head_row.lecture_id = p_lecture_id and track_head_row.track = track_name
      left join public.cw_lecture_releases release_row on release_row.id = track_head_row.current_release_id
    ),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment_row.id,
        'userId', assignment_row.user_id,
        'userName', profile_row.display_name,
        'responsibility', assignment_row.responsibility,
        'createdAt', assignment_row.created_at,
        'archivedAt', assignment_row.archived_at
      ) order by (assignment_row.archived_at is not null), assignment_row.created_at desc)
      from public.course_staff_assignments assignment_row
      join public.profiles profile_row on profile_row.id = assignment_row.user_id
      where assignment_row.scope_type = 'lecture' and assignment_row.lecture_id = p_lecture_id
    ), '[]'::jsonb),
    'effectiveAssignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'responsibility', resolved_row.responsibility,
        'userId', resolved_row.user_id,
        'userName', profile_row.display_name,
        'sourceScopeType', resolved_row.scope_type,
        'sourceLabel', case resolved_row.scope_type
          when 'variant' then course_row.title
          when 'family' then family_row.title
          else null
        end
      ))
      from public.resolve_course_assignments(p_lecture_id) resolved_row
      join public.profiles profile_row on profile_row.id = resolved_row.user_id
    ), '[]'::jsonb),
    'usage', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', session_row.id,
        'classroomId', classroom_row.id,
        'classroomName', classroom_row.name,
        'scheduledAt', session_row.scheduled_at,
        'endedAt', session_row.ended_at
      ) order by session_row.scheduled_at desc)
      from (
        select * from public.class_sessions session_inner
        where session_inner.lecture_id = p_lecture_id and session_inner.deleted_at is null
        order by session_inner.scheduled_at desc
        limit 50
      ) session_row
      join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cycle_row.id,
        'track', cycle_row.track,
        'workflowCycleNo', cycle_row.workflow_cycle_no,
        'reviewRoundNo', cycle_row.review_round_no,
        'status', cycle_row.status,
        'creatorName', creator_profile.display_name,
        'reviewerName', reviewer_profile.display_name,
        'selfReview', cycle_row.self_review,
        'submissionNote', cycle_row.submission_note,
        'submittedAt', cycle_row.submitted_at,
        'reviewNote', cycle_row.review_note,
        'reviewedAt', cycle_row.reviewed_at,
        'publishedReleaseId', cycle_row.published_release_id
      ) order by cycle_row.submitted_at desc)
      from public.cw_review_cycles cycle_row
      join public.profiles creator_profile on creator_profile.id = cycle_row.creator_id
      left join public.profiles reviewer_profile on reviewer_profile.id = cycle_row.reviewer_id
      where cycle_row.lecture_id = p_lecture_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_lecture_workspace_detail(uuid) from public, anon, authenticated;
grant execute on function public.get_lecture_workspace_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 责任写入 RPC 扩展 scope_type 到 lecture（course_staff_assignments 表结构与
-- 唯一索引 course_staff_assignments_one_owner_lecture_idx 在 P4I-2 就已支持，
-- 这两个函数的校验白名单此前没跟上）。
-- ---------------------------------------------------------------------------

create or replace function public.assign_course_owner(
  p_scope_type text,
  p_scope_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  assignment_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.assignment.manage') then raise exception 'FORBIDDEN'; end if;
  if p_scope_type not in ('family', 'variant', 'lecture') then raise exception 'INVALID_SCOPE'; end if;
  if p_scope_type = 'family' and not exists (select 1 from public.course_families where id = p_scope_id) then
    raise exception 'COURSE_FAMILY_NOT_FOUND';
  end if;
  if p_scope_type = 'variant' and not exists (select 1 from public.courses where id = p_scope_id) then
    raise exception 'COURSE_NOT_FOUND';
  end if;
  if p_scope_type = 'lecture' and not exists (select 1 from public.course_lectures where id = p_scope_id) then
    raise exception 'LECTURE_NOT_FOUND';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'INVALID_STAFF'; end if;

  update public.course_staff_assignments
  set archived_at = now()
  where responsibility = 'owner'
    and archived_at is null
    and scope_type = p_scope_type
    and (
      (p_scope_type = 'family' and family_id = p_scope_id)
      or (p_scope_type = 'variant' and course_id = p_scope_id)
      or (p_scope_type = 'lecture' and lecture_id = p_scope_id)
    );

  insert into public.course_staff_assignments (user_id, scope_type, family_id, course_id, lecture_id, responsibility, created_by)
  values (
    p_user_id,
    p_scope_type,
    case when p_scope_type = 'family' then p_scope_id else null end,
    case when p_scope_type = 'variant' then p_scope_id else null end,
    case when p_scope_type = 'lecture' then p_scope_id else null end,
    'owner',
    uid
  )
  returning id into assignment_id;

  return assignment_id;
end;
$$;

create or replace function public.add_course_collaborator(
  p_scope_type text,
  p_scope_id uuid,
  p_user_id uuid,
  p_responsibility text
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  assignment_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(uid, 'course.assignment.manage') then raise exception 'FORBIDDEN'; end if;
  if p_scope_type not in ('family', 'variant', 'lecture') then raise exception 'INVALID_SCOPE'; end if;
  if p_responsibility not in ('editor', 'reviewer') then raise exception 'INVALID_RESPONSIBILITY'; end if;
  if p_scope_type = 'family' and not exists (select 1 from public.course_families where id = p_scope_id) then
    raise exception 'COURSE_FAMILY_NOT_FOUND';
  end if;
  if p_scope_type = 'variant' and not exists (select 1 from public.courses where id = p_scope_id) then
    raise exception 'COURSE_NOT_FOUND';
  end if;
  if p_scope_type = 'lecture' and not exists (select 1 from public.course_lectures where id = p_scope_id) then
    raise exception 'LECTURE_NOT_FOUND';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'INVALID_STAFF'; end if;

  begin
    insert into public.course_staff_assignments (user_id, scope_type, family_id, course_id, lecture_id, responsibility, created_by)
    values (
      p_user_id,
      p_scope_type,
      case when p_scope_type = 'family' then p_scope_id else null end,
      case when p_scope_type = 'variant' then p_scope_id else null end,
      case when p_scope_type = 'lecture' then p_scope_id else null end,
      p_responsibility,
      uid
    )
    returning id into assignment_id;
  exception when unique_violation then
    raise exception 'ASSIGNMENT_ALREADY_EXISTS';
  end;

  return assignment_id;
end;
$$;
