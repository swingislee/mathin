\set ON_ERROR_STOP on
-- R1-6: immutable results, published-only customer projections, and replayable lifecycle.
begin;

do $$
declare
  failures text[] := '{}';
  review_definition text := pg_get_functiondef('public.get_my_session_reviews(timestamptz,timestamptz)'::regprocedure);
  knowledge_definition text := pg_get_functiondef('public.get_my_knowledge_summaries(timestamptz,timestamptz)'::regprocedure);
  knowledge_v2_definition text := pg_get_functiondef('public.get_my_knowledge_summaries_v2(timestamptz,timestamptz)'::regprocedure);
  summary_draft_definition text := pg_get_functiondef('public.save_session_knowledge_summary(uuid,text,jsonb,text,integer,text)'::regprocedure);
  stage_auto_definition text := pg_get_functiondef('public.save_stage_report_autodraft(uuid,uuid,date,date,text,text,text,timestamptz,uuid)'::regprocedure);
  stage_definition text := pg_get_functiondef('public.save_stage_report_draft(uuid,uuid,date,date,text,text,text,timestamptz,uuid)'::regprocedure);
  transition_definition text := pg_get_functiondef('public.record_learning_result_transition(uuid,uuid,text,text,text,uuid,boolean)'::regprocedure);
  notification_definition text := pg_get_functiondef('public.stage_notification_for_domain_event()'::regprocedure);
  review_policy text;
  video_policy text;
begin
  select qual into review_policy from pg_policies
   where schemaname = 'public' and tablename = 'session_reviews' and policyname = 'session_reviews_select_scope';
  select qual into video_policy from pg_policies
   where schemaname = 'public' and tablename = 'session_videos' and policyname = 'session_videos_select_scope';
  if to_regclass('public.learning_result_heads') is null
     or to_regclass('public.learning_result_revisions') is null
     or to_regclass('public.learning_result_events') is null then
    failures := array_append(failures, 'learning result tables missing');
  end if;
  if has_table_privilege('authenticated', 'public.learning_result_revisions', 'SELECT')
     or has_table_privilege('authenticated', 'public.learning_result_events', 'SELECT') then
    failures := array_append(failures, 'customer role can read immutable history tables directly');
  end if;
  if not exists(select 1 from pg_trigger where tgrelid = 'public.learning_result_revisions'::regclass and tgname = 'learning_result_revisions_immutable' and not tgisinternal)
     or not exists(select 1 from pg_trigger where tgrelid = 'public.learning_result_events'::regclass and tgname = 'learning_result_events_immutable' and not tgisinternal) then
    failures := array_append(failures, 'immutable history trigger missing');
  end if;
  if review_policy not ilike '%can_review_session%'
     or review_policy ilike '%can_access_student%'
     or video_policy not ilike '%can_review_video_session%'
     or video_policy ilike '%can_access_student%' then
    failures := array_append(failures, 'raw review tables remain customer-readable');
  end if;
  if review_definition not ilike '%learning_result_revisions%'
     or review_definition not ilike '%head_row.status = ''published''%' then
    failures := array_append(failures, 'session customer projection does not use published revisions');
  end if;
  if stage_definition not ilike '%mathin-learning-report-v1%'
     or stage_definition not ilike '%data_cutoff_at%'
     or stage_definition not ilike '%report_timezone%'
     or stage_definition not ilike '%session_attendance%' then
    failures := array_append(failures, 'stage report snapshot metadata or dataset is incomplete');
  end if;
  if to_regclass('public.stage_report_drafts') is null
     or stage_auto_definition not ilike '%stage_report_drafts%'
     or stage_auto_definition ilike '%append_learning_result_revision%' then
    failures := array_append(failures, 'stage report autosave is missing or mutates immutable revisions');
  end if;
  if knowledge_v2_definition not ilike '%revision_row.content -> ''document''%'
     or summary_draft_definition not ilike '%VERSION_CONFLICT%'
     or summary_draft_definition not ilike '%mark_session_result_kind_changed%' then
    failures := array_append(failures, 'BlockNote knowledge summary draft or projection contract is incomplete');
  end if;
  if transition_definition not ilike '%insert into public.domain_events%'
     or transition_definition not ilike '%target_user_id%'
     or transition_definition not ilike '%learning_result.review_submitted%'
     or transition_definition not ilike '%learning_result.changes_requested%'
     or transition_definition not ilike '%''title'', title_value%'
     or notification_definition not ilike '%enqueue_job%'
     or notification_definition not ilike '%notification_deliveries%' then
    failures := array_append(failures, 'result notifications do not enter the durable delivery pipeline');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'R1-6 learning-result structure assertions failed: %', array_to_string(failures, ', ');
  end if;
end
$$;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as parent_id from public.profiles where display_name = '测试-家长' limit 1 \gset
select guardian_row.student_id as student_id
  from public.student_guardians guardian_row
 where guardian_row.guardian_id = :'parent_id'::uuid and 'grades' = any(guardian_row.scope)
 limit 1 \gset
select term_row.id as term_id, term_row.starts_on as term_start,
       least(term_row.ends_on, current_date) as report_end
  from public.school_terms term_row where term_row.is_current limit 1 \gset

\if :{?admin_id}
\else
  \echo R1-6 fixture missing: admin
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo R1-6 fixture missing: teacher
  select 1 / 0;
\endif
\if :{?parent_id}
\else
  \echo R1-6 fixture missing: parent
  select 1 / 0;
\endif
\if :{?student_id}
\else
  \echo R1-6 fixture missing: grades-scoped child
  select 1 / 0;
\endif

update public.student_guardians
   set scope = case when 'video' = any(scope) then scope else array_append(scope, 'video') end
 where student_id = :'student_id'::uuid and guardian_id = :'parent_id'::uuid;

insert into public.classrooms(owner_id, name, invite_code, purpose, term_id)
values(
  :'teacher_id'::uuid, '__R1_6_RESULTS_CLASS__',
  'r16' || left(replace(gen_random_uuid()::text, '-', ''), 20), 'test', :'term_id'::uuid
) returning id as classroom_id \gset
insert into public.classroom_members(classroom_id, user_id, role)
values(:'classroom_id'::uuid, :'teacher_id'::uuid, 'teacher');
insert into public.enrollments(classroom_id, student_id, status, term_id, operated_by)
values(:'classroom_id'::uuid, :'student_id'::uuid, 'active', :'term_id'::uuid, :'admin_id'::uuid);
insert into public.class_sessions(classroom_id, title, scheduled_at, duration_min, term_id)
values(:'classroom_id'::uuid, '__R1_6_RESULTS_SESSION__', :'report_end'::date::timestamptz, 90, :'term_id'::uuid)
returning id as session_id \gset

select set_config('test.r16_session_id', :'session_id', true);
select set_config('test.r16_student_id', :'student_id', true);
select set_config('test.r16_parent_id', :'parent_id', true);
select set_config('test.r16_teacher_id', :'teacher_id', true);
select set_config('test.r16_admin_id', :'admin_id', true);
select set_config('test.r16_term_id', :'term_id', true);
select set_config('test.r16_term_start', :'term_start', true);
select set_config('test.r16_report_end', :'report_end', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.save_session_reviews_v2(
  :'session_id'::uuid,
  jsonb_build_array(jsonb_build_object(
    'studentId', :'student_id', 'entryScore', 60, 'exitScore', 80,
    'focus', 4, 'participation', 5, 'mastery', 4, 'comment', '__R1_6_REVIEW_V1__'
  ))
);
select result_revision as summary_draft_revision
  from public.save_session_knowledge_summary(
    :'session_id'::uuid,
    '__R1_6_LESSON__',
    jsonb_build_array(jsonb_build_object(
      'type', 'paragraph', 'props', '{}'::jsonb,
      'content', jsonb_build_array(jsonb_build_object(
        'type', 'text', 'text', '__R1_6_PUBLIC_SUMMARY__', 'styles', '{}'::jsonb
      )),
      'children', '[]'::jsonb
    )),
    'mathin-knowledge-summary-v1', 0, '__R1_6_PUBLIC_SUMMARY__'
  ) \gset

do $$
begin
  begin
    perform public.save_session_knowledge_summary(
      current_setting('test.r16_session_id')::uuid,
      '__R1_6_CONFLICT__', '[]'::jsonb, 'mathin-knowledge-summary-v1', 0, ''
    );
    raise exception 'R1_6_SUMMARY_CONFLICT_ACCEPTED';
  exception when others then
    if SQLERRM <> 'VERSION_CONFLICT' then raise; end if;
  end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
do $$
begin
  if exists(select 1 from public.session_reviews where session_id = current_setting('test.r16_session_id')::uuid) then
    raise exception 'R1_6_PARENT_READ_RAW_REVIEW';
  end if;
  if exists(select 1 from public.learning_result_heads where session_id = current_setting('test.r16_session_id')::uuid) then
    raise exception 'R1_6_PARENT_READ_RESULT_HEAD';
  end if;
  if exists(select 1 from public.get_my_knowledge_summaries('2000-01-01', '2100-01-01') where session_id = current_setting('test.r16_session_id')::uuid)
     or exists(select 1 from public.get_my_session_reviews('2000-01-01', '2100-01-01') where session_id = current_setting('test.r16_session_id')::uuid) then
    raise exception 'R1_6_DRAFT_RESULT_VISIBLE';
  end if;
  if not exists(
    select 1 from public.get_my_session_review_states('2000-01-01', '2100-01-01')
     where session_id = current_setting('test.r16_session_id')::uuid and availability_state = 'pending'
  ) then raise exception 'R1_6_DRAFT_STATE_NOT_PENDING'; end if;
end
$$;
reset role;

-- Knowledge summary publication is independent from per-student reviews.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.publish_session_family_brief(:'session_id'::uuid);
select public.publish_session_family_brief(:'session_id'::uuid);
reset role;

select id as summary_head_id from public.learning_result_heads
 where kind = 'knowledge_summary' and session_id = :'session_id'::uuid and student_id = :'student_id'::uuid \gset
select set_config('test.r16_summary_head_id', :'summary_head_id', true);

do $$
declare failures text[] := '{}';
begin
  if (select status from public.learning_result_heads where id = current_setting('test.r16_summary_head_id')::uuid) <> 'published' then
    failures := array_append(failures, 'knowledge summary was not published');
  end if;
  if (select count(*) from public.learning_result_revisions where head_id = current_setting('test.r16_summary_head_id')::uuid) <> 1 then
    failures := array_append(failures, 'knowledge summary publication was not idempotent');
  end if;
  if (select content ->> 'learningSummary' from public.learning_result_revisions
       where head_id = current_setting('test.r16_summary_head_id')::uuid and revision_no = 1) <> '__R1_6_PUBLIC_SUMMARY__' then
    failures := array_append(failures, 'knowledge summary snapshot mismatch');
  end if;
  if exists(
    select 1 from public.learning_result_heads
     where kind = 'session_review' and session_id = current_setting('test.r16_session_id')::uuid and status = 'published'
  ) then failures := array_append(failures, 'knowledge summary publication also published reviews'); end if;
  if not exists(
    select 1 from public.notifications notification_row
    join public.domain_events event_row on event_row.id = notification_row.source_event_id
    where event_row.entity_id = current_setting('test.r16_summary_head_id')::uuid
      and notification_row.recipient_id = current_setting('test.r16_parent_id')::uuid
      and notification_row.notification_key = 'learning_result.published'
      and notification_row.deep_link like '%#learning-results'
  ) then failures := array_append(failures, 'knowledge summary notification missing or not actionable'); end if;
  if cardinality(failures) > 0 then raise exception 'R1-6 summary publish failed: %', array_to_string(failures, ', '); end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
do $$
begin
  if not exists(
    select 1 from public.get_my_knowledge_summaries_v2('2000-01-01', '2100-01-01')
     where session_id = current_setting('test.r16_session_id')::uuid
       and learning_summary = '__R1_6_PUBLIC_SUMMARY__'
       and document #>> '{0,content,0,text}' = '__R1_6_PUBLIC_SUMMARY__'
  ) then raise exception 'R1_6_SUMMARY_NOT_VISIBLE'; end if;
  if exists(
    select 1 from public.get_my_session_reviews('2000-01-01', '2100-01-01')
     where session_id = current_setting('test.r16_session_id')::uuid
  ) then raise exception 'R1_6_REVIEW_LEAKED_WITH_SUMMARY'; end if;
end
$$;
reset role;

-- Per-student reviews are published through their own action.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.publish_session_reviews(:'session_id'::uuid);
reset role;

select id as review_head_id from public.learning_result_heads
 where kind = 'session_review' and session_id = :'session_id'::uuid and student_id = :'student_id'::uuid \gset
select set_config('test.r16_review_head_id', :'review_head_id', true);

do $$
declare failures text[] := '{}';
begin
  if (select status from public.learning_result_heads where id = current_setting('test.r16_review_head_id')::uuid) <> 'published' then
    failures := array_append(failures, 'session review was not published');
  end if;
  if (select content ->> 'comment' from public.learning_result_revisions
       where head_id = current_setting('test.r16_review_head_id')::uuid and revision_no = 1) <> '__R1_6_REVIEW_V1__' then
    failures := array_append(failures, 'session review snapshot mismatch');
  end if;
  if not exists(
    select 1 from public.notifications notification_row
    join public.domain_events event_row on event_row.id = notification_row.source_event_id
    where event_row.entity_id = current_setting('test.r16_review_head_id')::uuid
      and notification_row.recipient_id = current_setting('test.r16_parent_id')::uuid
      and notification_row.notification_key = 'learning_result.published'
  ) then failures := array_append(failures, 'session review notification missing'); end if;
  if cardinality(failures) > 0 then raise exception 'R1-6 review publish failed: %', array_to_string(failures, ', '); end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
select exists(
  select 1 from public.get_my_session_reviews('2000-01-01', '2100-01-01')
   where session_id = :'session_id'::uuid and comment = '__R1_6_REVIEW_V1__'
) as r16_review_published_visible \gset
\if :r16_review_published_visible
\else
  \echo R1-6 published session review not visible
  select 1 / 0;
\endif
reset role;

-- Editing a review revises only the review projection; the summary stays visible.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.save_session_reviews_v2(
  :'session_id'::uuid,
  jsonb_build_array(jsonb_build_object(
    'studentId', :'student_id', 'entryScore', 61, 'exitScore', 88,
    'focus', 5, 'participation', 5, 'mastery', 5, 'comment', '__R1_6_REVIEW_V2__'
  ))
);
reset role;

do $$
begin
  if (select status from public.learning_result_heads where id = current_setting('test.r16_review_head_id')::uuid) <> 'revised' then
    raise exception 'R1_6_REVIEW_EDIT_DID_NOT_REVISE';
  end if;
  if (select status from public.learning_result_heads where id = current_setting('test.r16_summary_head_id')::uuid) <> 'published' then
    raise exception 'R1_6_REVIEW_EDIT_REVISED_SUMMARY';
  end if;
  if (select count(*) from public.learning_result_revisions where head_id = current_setting('test.r16_review_head_id')::uuid) <> 1 then
    raise exception 'R1_6_REVIEW_EDIT_MUTATED_HISTORY';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
do $$
begin
  if exists(select 1 from public.get_my_session_reviews('2000-01-01', '2100-01-01') where session_id = current_setting('test.r16_session_id')::uuid) then
    raise exception 'R1_6_REVISED_REVIEW_VISIBLE';
  end if;
  if not exists(select 1 from public.get_my_knowledge_summaries('2000-01-01', '2100-01-01') where session_id = current_setting('test.r16_session_id')::uuid) then
    raise exception 'R1_6_REVIEW_EDIT_HID_SUMMARY';
  end if;
  if not exists(
    select 1 from public.get_my_session_review_states('2000-01-01', '2100-01-01')
     where session_id = current_setting('test.r16_session_id')::uuid and availability_state = 'withdrawn'
  ) then raise exception 'R1_6_REVISED_REVIEW_STATE_MISSING'; end if;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.publish_session_reviews(:'session_id'::uuid);
select public.publish_session_reviews(:'session_id'::uuid);
reset role;

do $$
begin
  if (select count(*) from public.learning_result_revisions where head_id = current_setting('test.r16_review_head_id')::uuid) <> 2 then
    raise exception 'R1_6_REVIEW_REPUBLISH_NOT_IDEMPOTENT';
  end if;
  if (select content ->> 'comment' from public.learning_result_revisions
       where head_id = current_setting('test.r16_review_head_id')::uuid and revision_no = 2) <> '__R1_6_REVIEW_V2__' then
    raise exception 'R1_6_SECOND_REVIEW_REVISION_MISMATCH';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.withdraw_session_reviews(:'session_id'::uuid, '__R1_6_REVIEW_WITHDRAW__');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
do $$
begin
  if exists(select 1 from public.get_my_session_reviews('2000-01-01', '2100-01-01') where session_id = current_setting('test.r16_session_id')::uuid) then
    raise exception 'R1_6_WITHDRAWN_REVIEW_VISIBLE';
  end if;
  if not exists(select 1 from public.get_my_knowledge_summaries('2000-01-01', '2100-01-01') where session_id = current_setting('test.r16_session_id')::uuid) then
    raise exception 'R1_6_REVIEW_WITHDRAW_HID_SUMMARY';
  end if;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.withdraw_session_learning_results(:'session_id'::uuid, '__R1_6_SUMMARY_WITHDRAW__');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
select not exists(
  select 1 from public.get_my_knowledge_summaries('2000-01-01', '2100-01-01')
   where session_id = :'session_id'::uuid
) as r16_withdrawn_summary_hidden \gset
\if :r16_withdrawn_summary_hidden
\else
  \echo R1-6 withdrawn summary remained visible
  select 1 / 0;
\endif
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select result_head_id as stage_head_id
  from public.save_stage_report_autodraft(
    :'student_id'::uuid, :'term_id'::uuid, :'term_start'::date, :'report_end'::date,
    '__R1_6_STAGE_TITLE__', '__R1_6_STAGE_SUMMARY_V1__', '__R1_6_STAGE_COMMENT__', now(), null
  ) \gset
select set_config('test.r16_stage_head_id', :'stage_head_id', true);
reset role;

do $$
begin
  if exists(
    select 1 from public.learning_result_revisions revision_row
     where revision_row.head_id = current_setting('test.r16_stage_head_id')::uuid
  ) then raise exception 'R1_6_AUTODRAFT_APPENDED_IMMUTABLE_REVISION'; end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select result_revision_id as stage_revision_1
  from public.save_stage_report_draft(
    :'student_id'::uuid, :'term_id'::uuid, :'term_start'::date, :'report_end'::date,
    '__R1_6_STAGE_TITLE__', '__R1_6_STAGE_SUMMARY_V1__', '__R1_6_STAGE_COMMENT__', now(), :'stage_head_id'::uuid
  ) \gset
reset role;
select set_config('test.r16_stage_head_id', :'stage_head_id', true);

select set_config('test.r16_stage_revision_1', :'stage_revision_1', true);
do $$
declare revision_row public.learning_result_revisions%rowtype;
begin
  select * into revision_row from public.learning_result_revisions where id = current_setting('test.r16_stage_revision_1')::uuid;
  if revision_row.metric_version <> 'mathin-learning-report-v1'
     or revision_row.data_cutoff_at is null or revision_row.timezone is null
     or revision_row.period_start is null or revision_row.period_end is null then
    raise exception 'R1_6_STAGE_METADATA_NOT_FROZEN';
  end if;
  if coalesce((revision_row.dataset -> 'reviews' ->> 'count')::integer, 0) < 1 then
    raise exception 'R1_6_STAGE_DATASET_MISSING_REVIEW';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
select not exists(select 1 from public.get_my_stage_reports() where head_id = :'stage_head_id'::uuid)
  as r16_stage_draft_hidden \gset
\if :r16_stage_draft_hidden
\else
  \echo R1-6 draft stage report visible
  select 1 / 0;
\endif
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.submit_learning_result_review(:'stage_head_id'::uuid);
reset role;

do $$
begin
  if not exists(
    select 1 from public.notifications notification_row
    join public.domain_events event_row on event_row.id = notification_row.source_event_id
    where event_row.entity_id = current_setting('test.r16_stage_head_id')::uuid
      and notification_row.recipient_id = current_setting('test.r16_admin_id')::uuid
      and notification_row.notification_key = 'learning_result.review_submitted'
      and notification_row.deep_link like '/dashboard/students/%?tab=learning&report=%'
  ) then raise exception 'R1_6_REVIEW_SUBMITTED_NOTIFICATION_MISSING'; end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.decide_learning_result_review(:'stage_head_id'::uuid, 'changes_requested', '__R1_6_STAGE_CHANGES__');
reset role;

do $$
begin
  if not exists(
    select 1 from public.notifications notification_row
    join public.domain_events event_row on event_row.id = notification_row.source_event_id
    where event_row.entity_id = current_setting('test.r16_stage_head_id')::uuid
      and notification_row.recipient_id = current_setting('test.r16_teacher_id')::uuid
      and notification_row.notification_key = 'learning_result.changes_requested'
      and notification_row.deep_link like '/dashboard/students/%?tab=learning&report=%'
  ) then raise exception 'R1_6_CHANGES_REQUESTED_NOTIFICATION_MISSING'; end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.submit_learning_result_review(:'stage_head_id'::uuid);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.decide_learning_result_review(:'stage_head_id'::uuid, 'publish', '__R1_6_STAGE_APPROVED__');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
select exists(
  select 1 from public.get_my_stage_reports()
   where head_id = :'stage_head_id'::uuid and summary = '__R1_6_STAGE_SUMMARY_V1__'
) as r16_stage_published_visible \gset
\if :r16_stage_published_visible
\else
  \echo R1-6 published stage report not visible
  select 1 / 0;
\endif
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select result_revision_id as stage_revision_2
  from public.save_stage_report_draft(
    :'student_id'::uuid, :'term_id'::uuid, :'term_start'::date, :'report_end'::date,
    '__R1_6_STAGE_TITLE__', '__R1_6_STAGE_SUMMARY_V2__', '__R1_6_STAGE_COMMENT__', now(), :'stage_head_id'::uuid
  ) \gset
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
select not exists(select 1 from public.get_my_stage_reports() where head_id = :'stage_head_id'::uuid)
  as r16_stage_revised_hidden \gset
\if :r16_stage_revised_hidden
\else
  \echo R1-6 revised stage report remained visible
  select 1 / 0;
\endif
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.submit_learning_result_review(:'stage_head_id'::uuid);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.decide_learning_result_review(:'stage_head_id'::uuid, 'publish', '__R1_6_STAGE_REAPPROVED__');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.withdraw_learning_result(:'stage_head_id'::uuid, '__R1_6_STAGE_WITHDRAW__');
reset role;

do $$
begin
  if (select count(*) from public.learning_result_revisions where head_id = current_setting('test.r16_stage_head_id')::uuid) <> 2 then
    raise exception 'R1_6_STAGE_REVISION_HISTORY_MISSING';
  end if;
  if (select content ->> 'summary' from public.learning_result_revisions where id = current_setting('test.r16_stage_revision_1')::uuid) <> '__R1_6_STAGE_SUMMARY_V1__' then
    raise exception 'R1_6_STAGE_FIRST_REVISION_CHANGED';
  end if;
end
$$;

insert into public.session_videos(
  session_id, student_id, term_id, uploaded_by, storage_path,
  note, reviewed_by, reviewed_at, review_comment, review_score
) values (
  :'session_id'::uuid, :'student_id'::uuid, :'term_id'::uuid, :'teacher_id'::uuid,
  :'classroom_id' || '/' || :'session_id' || '/' || gen_random_uuid()::text || '.mp4',
  '__R1_6_VIDEO__', :'teacher_id'::uuid, now(), '__R1_6_VIDEO_REVIEW_V1__', 4
) returning id as video_id \gset
select set_config('test.r16_video_id', :'video_id', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
do $$
begin
  if exists(select 1 from public.session_videos where id = current_setting('test.r16_video_id')::uuid) then
    raise exception 'R1_6_PARENT_READ_RAW_VIDEO_REVIEW';
  end if;
  if exists(select 1 from public.get_my_reviewed_videos() where video_id = current_setting('test.r16_video_id')::uuid) then
    raise exception 'R1_6_UNPUBLISHED_VIDEO_REVIEW_VISIBLE';
  end if;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.publish_session_video_review(:'video_id'::uuid) as video_head_id \gset
reset role;
select set_config('test.r16_video_head_id', :'video_head_id', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
select exists(
  select 1 from public.get_my_reviewed_videos()
   where video_id = :'video_id'::uuid and review_comment = '__R1_6_VIDEO_REVIEW_V1__'
) as r16_video_published_visible \gset
\if :r16_video_published_visible
\else
  \echo R1-6 published video review not visible
  select 1 / 0;
\endif
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
update public.session_videos
   set review_comment = '__R1_6_VIDEO_REVIEW_V2__', review_score = 5, reviewed_at = now()
 where id = :'video_id'::uuid;
reset role;

do $$
begin
  if (select status from public.learning_result_heads where id = current_setting('test.r16_video_head_id')::uuid) <> 'revised' then
    raise exception 'R1_6_VIDEO_EDIT_DID_NOT_REVISE';
  end if;
  if (select count(*) from public.learning_result_revisions where head_id = current_setting('test.r16_video_head_id')::uuid) <> 1 then
    raise exception 'R1_6_VIDEO_EDIT_MUTATED_HISTORY';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
select not exists(select 1 from public.get_my_reviewed_videos() where video_id = :'video_id'::uuid)
  as r16_video_revised_hidden \gset
\if :r16_video_revised_hidden
\else
  \echo R1-6 revised video review remained visible
  select 1 / 0;
\endif
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.publish_session_video_review(:'video_id'::uuid);
select public.publish_session_video_review(:'video_id'::uuid);
select public.withdraw_learning_result(:'video_head_id'::uuid, '__R1_6_VIDEO_WITHDRAW__');
reset role;

do $$
begin
  if (select count(*) from public.learning_result_revisions where head_id = current_setting('test.r16_video_head_id')::uuid) <> 2 then
    raise exception 'R1_6_VIDEO_REPUBLISH_NOT_IDEMPOTENT';
  end if;
  if (select content ->> 'reviewComment' from public.learning_result_revisions where head_id = current_setting('test.r16_video_head_id')::uuid and revision_no = 1) <> '__R1_6_VIDEO_REVIEW_V1__' then
    raise exception 'R1_6_VIDEO_FIRST_REVISION_CHANGED';
  end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'parent_id', true);
do $$
begin
  if exists(select 1 from public.get_my_reviewed_videos() where video_id = current_setting('test.r16_video_id')::uuid) then
    raise exception 'R1_6_WITHDRAWN_VIDEO_VISIBLE';
  end if;
  begin
    perform public.save_stage_report_draft(
      current_setting('test.r16_student_id')::uuid,
      current_setting('test.r16_term_id')::uuid,
      current_setting('test.r16_term_start')::date,
      current_setting('test.r16_report_end')::date,
      'forbidden', 'forbidden', '',
      current_setting('test.r16_report_end')::date::timestamptz, null
    );
    raise exception 'R1_6_PARENT_STAGE_WRITE_ACCEPTED';
  exception when others then
    if SQLERRM <> 'FORBIDDEN' then raise; end if;
  end;
end
$$;
reset role;

do $$
begin
  begin
    update public.learning_result_revisions
       set content = jsonb_set(content, '{tampered}', 'true')
     where head_id = current_setting('test.r16_review_head_id')::uuid and revision_no = 1;
    raise exception 'R1_6_REVISION_UPDATE_ACCEPTED';
  exception when others then
    if SQLERRM <> 'LEARNING_RESULT_HISTORY_IMMUTABLE' then raise; end if;
  end;
  begin
    delete from public.learning_result_events
     where head_id = current_setting('test.r16_review_head_id')::uuid;
    raise exception 'R1_6_EVENT_DELETE_ACCEPTED';
  exception when others then
    if SQLERRM <> 'LEARNING_RESULT_HISTORY_IMMUTABLE' then raise; end if;
  end;
end
$$;

rollback;
\echo R1-6 learning result assertions passed
