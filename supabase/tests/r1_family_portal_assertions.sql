\set ON_ERROR_STOP on
-- R1-5 family portal: stable child identity, publication visibility, and
-- cross-family rejection. Runs against the fixed development/CI fixtures and
-- rolls every mutation back.
begin;

do $$
declare
  failures text[] := '{}';
  schedule_result text := pg_get_function_result('public.get_my_schedule(timestamptz,timestamptz)'::regprocedure);
  schedule_definition text := pg_get_functiondef('public.get_my_schedule(timestamptz,timestamptz)'::regprocedure);
  attendance_result text := pg_get_function_result('public.get_my_attendance(timestamptz,timestamptz)'::regprocedure);
  review_definition text := pg_get_functiondef('public.get_my_session_reviews(timestamptz,timestamptz)'::regprocedure);
  review_state_result text := pg_get_function_result('public.get_my_session_review_states(timestamptz,timestamptz)'::regprocedure);
  review_state_definition text := pg_get_functiondef('public.get_my_session_review_states(timestamptz,timestamptz)'::regprocedure);
  brief_definition text := pg_get_functiondef('public.get_family_session_brief(uuid)'::regprocedure);
  save_definition text := pg_get_functiondef('public.save_session_family_brief(uuid,text,text,text,text,text)'::regprocedure);
  relationship_definition text := pg_get_functiondef('public.revoke_my_guardian_relationship(uuid)'::regprocedure);
  leave_result text := pg_get_function_result('public.list_my_session_leave_requests()'::regprocedure);
  leave_definition text := pg_get_functiondef('public.list_my_session_leave_requests()'::regprocedure);
  change_definition text := pg_get_functiondef('public.record_session_change(uuid,uuid,text,uuid,text)'::regprocedure);
  orders_definition text := pg_get_functiondef('public.get_my_orders()'::regprocedure);
  account_definition text := pg_get_functiondef('public.get_my_account()'::regprocedure);
  video_upload_definition text := pg_get_functiondef('public.get_my_video_uploads()'::regprocedure);
begin
  if schedule_result not ilike '%student_id uuid%' then
    failures := array_append(failures, 'schedule projection has no student_id');
  end if;
  if attendance_result not ilike '%student_id uuid%' then
    failures := array_append(failures, 'attendance projection has no student_id');
  end if;
  if review_definition not ilike '%join public.session_family_briefs%'
     or review_definition not ilike '%published_at is not null%'
     or review_definition ilike '%coalesce(brief_row.learning_summary, session_row.knowledge_summary)%' then
    failures := array_append(failures, 'review projection can expose an unpublished summary');
  end if;
  if review_state_result not ilike '%availability_state text%'
     or review_state_definition not ilike '%family_visibility_state%'
     or review_state_definition ilike '%review_row.comment%'
     or review_state_definition ilike '%learning_summary%' then
    failures := array_append(failures, 'review availability projection leaks draft fields or omits state');
  end if;
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.session_family_briefs'::regclass
       and tgname = 'session_family_briefs_sync_visibility'
       and not tgisinternal
  ) then
    failures := array_append(failures, 'family result visibility state is not synchronized');
  end if;
  if brief_definition not ilike '%guardian_can(student_row.id, uid, ''grades''%'
     or brief_definition ilike '%family_of_student%' then
    failures := array_append(failures, 'family brief ignores guardian grades scope');
  end if;
  if save_definition not ilike '%published_at = null%' then
    failures := array_append(failures, 'saving a brief does not return it to draft');
  end if;
  if not exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.session_reviews'::regclass
       and tgname = 'session_reviews_invalidate_family_brief'
       and not tgisinternal
  ) then
    failures := array_append(failures, 'review edits do not invalidate family publication');
  end if;
  if relationship_definition not ilike '%delete from public.student_guardians%'
     or relationship_definition not ilike '%consent_records%'
     or relationship_definition not ilike '%guardian.relationship_revoked%'
     or relationship_definition not ilike '%set is_primary = true%' then
    failures := array_append(failures, 'guardian relationship revocation is incomplete');
  end if;
  if schedule_definition not ilike '%latest_makeup%'
     or schedule_definition not ilike '%session_changes%' then
    failures := array_append(failures, 'family schedule omits cross-class makeup sessions');
  end if;
  if leave_result not ilike '%makeup_session_id uuid%'
     or leave_result not ilike '%makeup_status text%'
     or leave_definition not ilike '%family_of_student(request_row.student_id, uid)%'
     or leave_definition not ilike '%to_schedule%' then
    failures := array_append(failures, 'family leave projection omits shared makeup state');
  end if;
  if change_definition not ilike '%kind = ''makeup_followup''%'
     or change_definition not ilike '%status = ''done''%' then
    failures := array_append(failures, 'makeup scheduling does not close its follow-up task');
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.session_changes'::regclass
       and tgname = 'session_changes_notify_family_makeup' and not tgisinternal
  ) then failures := array_append(failures, 'makeup scheduling has no family notification trigger'); end if;
  if orders_definition not ilike '%is_feature_enabled(''finance.enabled'')%'
     or orders_definition not ilike '%guardian_can(student_row.id, auth.uid(), ''finance'')%'
     or account_definition not ilike '%is_feature_enabled(''finance.enabled'')%'
     or account_definition not ilike '%guardian_can(student_row.id, auth.uid(), ''finance'')%' then
    failures := array_append(failures, 'family finance projection ignores feature or scope closure');
  end if;
  if video_upload_definition not ilike '%uploaded_by = auth.uid()%' then
    failures := array_append(failures, 'video upload history is not caller-scoped');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'R1-5 family portal structure assertions failed: %', array_to_string(failures, ', ');
  end if;
end
$$;

select profile_row.id as parent_id
  from public.profiles profile_row
 where profile_row.display_name = '测试-家长'
 limit 1 \gset
select profile_row.id as teacher_id
  from public.profiles profile_row
 where profile_row.display_name = '测试-教师'
 limit 1 \gset

select profile_row.id as admin_id from public.profiles profile_row
 where profile_row.display_name = '测试-管理员' limit 1 \gset

\if :{?parent_id}
\else
  \echo R1-5 fixtures missing: 测试-家长
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo R1-5 fixtures missing: 测试-教师
  select 1 / 0;
\endif

\if :{?admin_id}
\else
  \echo R1-5 fixtures missing: 测试-管理员
  select 1 / 0;
\endif

select guardian_row.student_id as family_student_id
  from public.student_guardians guardian_row
 where guardian_row.guardian_id = :'parent_id'::uuid
   and 'grades' = any(guardian_row.scope)
 limit 1 \gset

\if :{?family_student_id}
\else
  \echo R1-5 fixtures missing: 测试-家长 has no grades-scoped child
  select 1 / 0;
\endif

select session_row.id as family_session_id
  from public.class_sessions session_row
  join public.enrollments enrollment_row
    on enrollment_row.classroom_id = session_row.classroom_id
   and enrollment_row.student_id = :'family_student_id'::uuid
   and enrollment_row.status = 'active'
 where session_row.deleted_at is null
   and session_row.scheduled_at is not null
 limit 1 \gset

\if :{?family_session_id}
\else
  \echo R1-5 fixtures missing: linked child has no scheduled active-class session
  select 1 / 0;
\endif

select student_row.id as foreign_student_id
  from public.students student_row
 where student_row.deleted_at is null
   and student_row.id <> :'family_student_id'::uuid
   and student_row.user_id is distinct from :'parent_id'::uuid
   and not exists (
     select 1
       from public.student_guardians guardian_row
      where guardian_row.student_id = student_row.id
        and guardian_row.guardian_id = :'parent_id'::uuid
   )
 limit 1 \gset

\if :{?foreign_student_id}
\else
  \echo R1-5 fixtures missing: no foreign student
  select 1 / 0;
\endif

insert into public.classrooms(owner_id, name, invite_code, purpose)
values (
  :'teacher_id'::uuid, '__R1_FOREIGN_CLASSROOM__',
  'r1' || replace(gen_random_uuid()::text, '-', ''), 'test'
)
returning id as foreign_classroom_id \gset

insert into public.class_sessions(classroom_id, title, scheduled_at, duration_min)
values (:'foreign_classroom_id'::uuid, '__R1_FOREIGN_SESSION__', now() - interval '1 day', 90)
returning id as foreign_session_id \gset

insert into public.enrollments(classroom_id, student_id, status, operated_by)
values (:'foreign_classroom_id'::uuid, :'foreign_student_id'::uuid, 'active', :'admin_id'::uuid);

-- Prepare a draft result for an authorized child. The transaction rollback
-- restores any prior fixture values.
insert into public.session_reviews (
  session_id, student_id, comment, created_by
)
values (
  :'family_session_id'::uuid, :'family_student_id'::uuid,
  '__R1_FAMILY_DRAFT_REVIEW__', :'teacher_id'::uuid
)
on conflict (session_id, student_id) do update
set comment = excluded.comment, updated_at = now();

delete from public.session_family_briefs
 where session_id = :'family_session_id'::uuid;

insert into public.session_family_briefs (
  session_id, lesson_title, learning_summary, teacher_public_comment,
  published_by, published_at
)
values (
  :'family_session_id'::uuid, '__R1_FAMILY_DRAFT__',
  '__R1_FAMILY_DRAFT_SUMMARY__', '__R1_FAMILY_PUBLIC_COMMENT__',
  null, null
)
on conflict (session_id) do update
set lesson_title = excluded.lesson_title,
    learning_summary = excluded.learning_summary,
    teacher_public_comment = excluded.teacher_public_comment,
    published_by = null,
    published_at = null,
    updated_at = now();

insert into public.session_family_briefs (
  session_id, lesson_title, learning_summary, teacher_public_comment,
  published_by, published_at
) values (
  :'foreign_session_id'::uuid, '__R1_FOREIGN_BRIEF__',
  '__R1_FOREIGN_SUMMARY__', '__R1_FOREIGN_COMMENT__',
  :'teacher_id'::uuid, now()
)
on conflict (session_id) do update
set lesson_title = excluded.lesson_title,
    learning_summary = excluded.learning_summary,
    teacher_public_comment = excluded.teacher_public_comment,
    published_by = excluded.published_by,
    published_at = excluded.published_at,
    updated_at = now();

insert into public.assignments(classroom_id, title, content, created_by)
values (:'foreign_classroom_id'::uuid, '__R1_FOREIGN_ASSIGNMENT__', '{"text":"foreign"}'::jsonb, :'teacher_id'::uuid)
returning id as foreign_assignment_id \gset

select set_config('test.family_session_id', :'family_session_id', true);
select set_config('test.family_student_id', :'family_student_id', true);
select set_config('test.foreign_student_id', :'foreign_student_id', true);
select set_config('test.matrix_foreign_student_id', :'foreign_student_id', true);
select set_config('test.foreign_session_id', :'foreign_session_id', true);
select set_config('test.foreign_assignment_id', :'foreign_assignment_id', true);
select set_config('test.parent_id', :'parent_id', true);
select set_config('test.admin_id', :'admin_id', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);

do $$
begin
  if exists (
    select 1
      from public.get_my_session_reviews('2000-01-01'::timestamptz, '2100-01-01'::timestamptz)
     where session_id = current_setting('test.family_session_id', true)::uuid
  ) then
    raise exception 'R1_DRAFT_REVIEW_WAS_VISIBLE';
  end if;
  if not exists (
    select 1
      from public.get_my_session_review_states('2000-01-01'::timestamptz, '2100-01-01'::timestamptz)
     where session_id = current_setting('test.family_session_id', true)::uuid
       and availability_state = 'pending'
  ) then raise exception 'R1_DRAFT_REVIEW_STATE_WAS_NOT_PENDING'; end if;
  if exists (
    select 1
      from public.get_family_session_brief(current_setting('test.foreign_session_id', true)::uuid)
     where lesson_title = '__R1_FOREIGN_BRIEF__'
  ) then raise exception 'R1_FOREIGN_FAMILY_BRIEF_WAS_VISIBLE'; end if;
  begin
    perform 1 from public.get_customer_assignment(
      current_setting('test.foreign_assignment_id', true)::uuid,
      current_setting('test.matrix_foreign_student_id', true)::uuid
    );
    raise exception 'R1_FOREIGN_ASSIGNMENT_WAS_VISIBLE';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform 1 from public.get_customer_submission(
      current_setting('test.foreign_assignment_id', true)::uuid,
      current_setting('test.matrix_foreign_student_id', true)::uuid
    );
    raise exception 'R1_FOREIGN_SUBMISSION_WAS_VISIBLE';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.submit_assignment_for_student(
      current_setting('test.foreign_assignment_id', true)::uuid,
      current_setting('test.matrix_foreign_student_id', true)::uuid,
      '{"text":"cross-family probe","attachments":[]}'::jsonb
    );
    raise exception 'R1_FOREIGN_ASSIGNMENT_WRITE_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.record_guardian_consent(
      current_setting('test.matrix_foreign_student_id', true)::uuid,
      'learning', true
    );
    raise exception 'R1_FOREIGN_CONSENT_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform 1 from public.list_student_guardians(
      current_setting('test.matrix_foreign_student_id', true)::uuid
    );
    raise exception 'R1_FOREIGN_GUARDIAN_LIST_WAS_VISIBLE';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.set_guardian_scope(
      current_setting('test.matrix_foreign_student_id', true)::uuid,
      current_setting('test.parent_id', true)::uuid,
      array['grades']::text[]
    );
    raise exception 'R1_FOREIGN_GUARDIAN_SCOPE_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.issue_guardian_invite(
      current_setting('test.matrix_foreign_student_id', true)::uuid,
      'probe', array['grades']::text[]
    );
    raise exception 'R1_FOREIGN_GUARDIAN_INVITE_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
  begin
    perform public.submit_session_leave_request(
      gen_random_uuid(),
      current_setting('test.foreign_student_id', true)::uuid,
      'cross-family probe'
    );
    raise exception 'R1_CROSS_FAMILY_LEAVE_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
end
$$;

-- Every customer projection row must carry an id from the caller's own child
-- set. This also catches accidental name-based joins for same-name children.
do $$
begin
  if exists (
    select 1
      from public.get_my_schedule('2000-01-01'::timestamptz, '2100-01-01'::timestamptz) schedule_row
     where not exists (
       select 1 from public.get_my_students() student_row where student_row.id = schedule_row.student_id
     )
  ) then raise exception 'R1_SCHEDULE_CROSSED_CHILD_SCOPE'; end if;
  if exists (
    select 1
      from public.get_my_attendance('2000-01-01'::timestamptz, '2100-01-01'::timestamptz) attendance_row
     where not exists (
       select 1 from public.get_my_students() student_row where student_row.id = attendance_row.student_id
     )
  ) then raise exception 'R1_ATTENDANCE_CROSSED_CHILD_SCOPE'; end if;
  if exists (
    select 1
      from public.get_my_session_review_states('2000-01-01'::timestamptz, '2100-01-01'::timestamptz) state_row
     where not exists (
       select 1 from public.get_my_students() student_row where student_row.id = state_row.student_id
     )
  ) then raise exception 'R1_REVIEW_STATE_CROSSED_CHILD_SCOPE'; end if;
  if exists (
    select 1 from public.get_my_learning_summary() scoped_row
     where not exists (select 1 from public.get_my_students() own_row where own_row.id = scoped_row.student_id)
  ) then raise exception 'R1_LEARNING_SUMMARY_CROSSED_CHILD_SCOPE'; end if;
  if exists (
    select 1 from public.get_my_account() scoped_row
     where not exists (select 1 from public.get_my_students() own_row where own_row.id = scoped_row.student_id)
  ) then raise exception 'R1_ACCOUNT_CROSSED_CHILD_SCOPE'; end if;
  if exists (
    select 1 from public.get_my_pending_assignments() scoped_row
     where not exists (select 1 from public.get_my_students() own_row where own_row.id = scoped_row.student_id)
  ) then raise exception 'R1_PENDING_ASSIGNMENT_CROSSED_CHILD_SCOPE'; end if;
  if exists (
    select 1
      from public.get_my_session_reviews('2000-01-01'::timestamptz, '2100-01-01'::timestamptz) scoped_row
     where not exists (select 1 from public.get_my_students() own_row where own_row.id = scoped_row.student_id)
  ) then raise exception 'R1_REVIEW_CROSSED_CHILD_SCOPE'; end if;
  if exists (
    select 1 from public.get_my_reviewed_videos() scoped_row
     where not exists (select 1 from public.get_my_students() own_row where own_row.id = scoped_row.student_id)
  ) then raise exception 'R1_REVIEWED_VIDEO_CROSSED_CHILD_SCOPE'; end if;
  if exists (
    select 1 from public.get_my_published_video_tasks() scoped_row
     where not exists (select 1 from public.get_my_students() own_row where own_row.id = scoped_row.student_id)
  ) then raise exception 'R1_VIDEO_TASK_CROSSED_CHILD_SCOPE'; end if;
  if exists (
    select 1 from public.get_my_video_sessions() scoped_row
     where not exists (select 1 from public.get_my_students() own_row where own_row.id = scoped_row.student_id)
  ) then raise exception 'R1_VIDEO_SESSION_CROSSED_CHILD_SCOPE'; end if;
  if exists (
    select 1 from public.list_my_session_leave_requests() scoped_row
     where not exists (select 1 from public.get_my_students() own_row where own_row.id = scoped_row.student_id)
  ) then raise exception 'R1_LEAVE_REQUEST_CROSSED_CHILD_SCOPE'; end if;
end
$$;

reset role;
update public.session_family_briefs
   set published_by = :'teacher_id'::uuid, published_at = now()
 where session_id = :'family_session_id'::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
select exists (
  select 1
    from public.get_my_session_reviews('2000-01-01'::timestamptz, '2100-01-01'::timestamptz)
   where session_id = :'family_session_id'::uuid
     and student_id = :'family_student_id'::uuid
     and knowledge_summary = '__R1_FAMILY_DRAFT_SUMMARY__'
) as published_result_visible \gset
\if :published_result_visible
\else
  \echo R1-5 published family result was not visible
  select 1 / 0;
\endif

select exists (
  select 1
    from public.get_my_session_review_states('2000-01-01'::timestamptz, '2100-01-01'::timestamptz)
   where session_id = :'family_session_id'::uuid
     and student_id = :'family_student_id'::uuid
     and availability_state = 'published'
) as published_state_visible \gset
\if :published_state_visible
\else
  \echo R1-5 published family result state was not visible
  select 1 / 0;
\endif

reset role;
update public.session_reviews
   set comment = '__R1_FAMILY_REVISED_REVIEW__', updated_at = now()
 where session_id = :'family_session_id'::uuid
   and student_id = :'family_student_id'::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
select not exists (
  select 1
    from public.get_my_session_reviews('2000-01-01'::timestamptz, '2100-01-01'::timestamptz)
   where session_id = :'family_session_id'::uuid
) as revised_result_hidden \gset
\if :revised_result_hidden
\else
  \echo R1-5 revised family result stayed visible without republish
  select 1 / 0;
\endif

select exists (
  select 1
    from public.get_my_session_review_states('2000-01-01'::timestamptz, '2100-01-01'::timestamptz)
   where session_id = :'family_session_id'::uuid
     and student_id = :'family_student_id'::uuid
     and availability_state = 'withdrawn'
) as withdrawn_state_visible \gset
\if :withdrawn_state_visible
\else
  \echo R1-5 withdrawn family result state was not visible
  select 1 / 0;
\endif

-- Close a real leave -> approval -> makeup chain inside the rollback-only
-- fixture. The target session is deliberately in the same classroom so the
-- admin-authorized scheduling contract remains deterministic.
reset role;
insert into public.class_sessions(classroom_id, title, scheduled_at, duration_min)
select source_row.classroom_id, '__R1_MAKEUP_TARGET__',
       now() + interval '14 days', coalesce(source_row.duration_min, 90::smallint)
  from public.class_sessions source_row
 where source_row.id = :'family_session_id'::uuid
returning id as makeup_target_id \gset

delete from public.class_support_tasks
 where session_id = :'family_session_id'::uuid
   and student_id = :'family_student_id'::uuid
   and kind = 'makeup_followup';

insert into public.session_leave_requests(
  session_id, student_id, requested_by, reason
) values (
  :'family_session_id'::uuid, :'family_student_id'::uuid,
  :'parent_id'::uuid, '__R1_MAKEUP_JOURNEY__'
) returning id as makeup_leave_request_id \gset

select set_config('test.makeup_target_id', :'makeup_target_id', true);
select set_config('test.makeup_leave_request_id', :'makeup_leave_request_id', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.decide_session_leave_request(:'makeup_leave_request_id'::uuid, true);
select public.record_session_change(
  :'family_session_id'::uuid, :'family_student_id'::uuid, 'makeup',
  :'makeup_target_id'::uuid, '__R1_MAKEUP_SCHEDULED__'
);

reset role;
do $$
begin
  if not exists (
    select 1 from public.class_support_tasks task_row
     where task_row.session_id = current_setting('test.family_session_id', true)::uuid
       and task_row.student_id = current_setting('test.family_student_id', true)::uuid
       and task_row.kind = 'makeup_followup'
       and task_row.status = 'done'
  ) then raise exception 'R1_MAKEUP_FOLLOWUP_STAYED_OPEN'; end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
select exists (
  select 1 from public.list_my_session_leave_requests() request_row
   where request_row.id = :'makeup_leave_request_id'::uuid
     and request_row.makeup_session_id = :'makeup_target_id'::uuid
     and request_row.makeup_status = 'scheduled'
) as family_makeup_state_visible \gset
\if :family_makeup_state_visible
\else
  \echo R1-5 scheduled makeup state was not visible to the family
  select 1 / 0;
\endif

select exists (
  select 1 from public.get_my_schedule(now(), now() + interval '30 days') schedule_row
   where schedule_row.session_id = :'makeup_target_id'::uuid
     and schedule_row.student_id = :'family_student_id'::uuid
) as family_makeup_schedule_visible \gset
\if :family_makeup_schedule_visible
\else
  \echo R1-5 cross-class makeup session was not visible in the family schedule
  select 1 / 0;
\endif

select exists (
  select 1 from public.notifications notification_row
   where notification_row.recipient_id = :'parent_id'::uuid
     and notification_row.notification_key = 'session_change.makeup'
     and notification_row.payload ->> 'sessionId' = :'makeup_target_id'
) as family_makeup_notification_visible \gset
\if :family_makeup_notification_visible
\else
  \echo R1-5 family makeup notification was not staged
  select 1 / 0;
\endif

-- A caller cannot unlink a foreign family, but can revoke their own
-- relationship. The same transaction verifies immediate loss of access.
do $$
begin
  begin
    perform public.revoke_my_guardian_relationship(
      current_setting('test.foreign_student_id', true)::uuid
    );
    raise exception 'R1_CROSS_FAMILY_RELATIONSHIP_REVOKE_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'RELATIONSHIP_NOT_FOUND' then raise; end if;
  end;

  perform public.revoke_my_guardian_relationship(
    current_setting('test.family_student_id', true)::uuid
  );
  if exists (
    select 1 from public.student_guardians guardian_row
     where guardian_row.student_id = current_setting('test.family_student_id', true)::uuid
       and guardian_row.guardian_id = auth.uid()
  ) then raise exception 'R1_GUARDIAN_RELATIONSHIP_STAYED_ACTIVE'; end if;
  if exists (
    select 1 from public.get_my_students() student_row
     where student_row.id = current_setting('test.family_student_id', true)::uuid
  ) then raise exception 'R1_REVOKED_CHILD_STAYED_VISIBLE'; end if;
end
$$;

reset role;
do $$
declare
  sid uuid := current_setting('test.family_student_id', true)::uuid;
  parent uuid := current_setting('test.parent_id', true)::uuid;
begin
  if exists (select 1 from public.student_guardians where student_id = sid)
     and (select count(*) from public.student_guardians where student_id = sid and is_primary) <> 1 then
    raise exception 'R1_PRIMARY_GUARDIAN_WAS_NOT_PRESERVED';
  end if;
  if not exists (
    select 1 from public.domain_events event_row
     where event_row.event_type = 'guardian.relationship_revoked'
       and event_row.entity_id = sid
       and event_row.actor_id = parent
  ) then raise exception 'R1_GUARDIAN_REVOCATION_EVENT_MISSING'; end if;
end
$$;

rollback;
