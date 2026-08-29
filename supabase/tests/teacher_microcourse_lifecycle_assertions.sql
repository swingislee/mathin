\set ON_ERROR_STOP on
-- DEV-TMC-1 lifecycle assertions. Every fixture write is rolled back.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as reviewer_id from public.profiles where display_name = '测试-教研' limit 1 \gset

insert into public.classrooms(id, owner_id, name, invite_code)
values (
  '00000000-0000-4000-8000-000000000921',
  :'teacher_id',
  '__DEV_TMC_LIFECYCLE_CLASS__',
  'TMC921'
);
insert into public.classroom_members(classroom_id, user_id, role)
values (
  '00000000-0000-4000-8000-000000000921',
  :'teacher_id',
  'teacher'
);
insert into public.class_sessions(id, classroom_id, title, scheduled_at, duration_min)
values (
  '00000000-0000-4000-8000-000000000922',
  '00000000-0000-4000-8000-000000000921',
  '__DEV_TMC_LIFECYCLE_SESSION__',
  now() + interval '2 days',
  60
);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.set_feature_flag(
  'teaching.teacher_microcourses_v1', null, true, now(), 'lifecycle assertion enable'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.create_teacher_microcourse(
  '00000000-0000-4000-8000-000000000922',
  '生命周期版本一', '提交版本一', 4::smallint, null::smallint, '',
  'integrated-practice', array['版本一']
) as microcourse_id \gset
select public.create_teacher_microcourse_composition_page(
  :'microcourse_id', null, '图文页', null, null, null
) as composition_page_id \gset
select public.register_teacher_microcourse_h5_artifact(
  :'microcourse_id', repeat('e', 64), 64,
  :'teacher_id' || '/' || :'microcourse_id' || '/' || repeat('e', 64) || '/index.html'
) as h5_artifact_id \gset
select public.create_teacher_microcourse_h5_page(
  :'microcourse_id', :'h5_artifact_id', :'composition_page_id', 'H5 页'
) as h5_page_id \gset

-- The originating free session freezes revision 1 before later edits.
select public.freeze_teacher_microcourse_source_session(:'microcourse_id') as frozen_resolved \gset
select public.submit_teacher_microcourse_review(:'microcourse_id', 'first submit') as first_cycle_id \gset
reset role;

select
  (select lecture_id from public.teacher_microcourses where id = :'microcourse_id') as lecture_id,
  (select course_id from public.teacher_microcourses where id = :'microcourse_id') as course_id,
  (select lecture_id from public.teacher_microcourse_class_lectures
   where source_session_id = '00000000-0000-4000-8000-000000000922') as catalog_lecture_id,
  (select metadata_revision_id from public.teacher_microcourse_review_snapshots
   where review_cycle_id = :'first_cycle_id') as first_metadata_revision_id,
  (select content_snapshot -> 0 ->> 'revisionId' from public.cw_review_cycles
   where id = :'first_cycle_id') as first_page_revision_id
\gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'reviewer_id', true);
select public.reject_teacher_microcourse_review(
  :'first_cycle_id', 'Please revise', array[1]
);
reset role;

-- Revision 2 and metadata 2 are submitted after the return.
select revision_row.doc as page_doc, revision_row.revision_no as page_revision_no
from public.cw_page_docs page_row
join public.cw_page_revisions revision_row on revision_row.id = page_row.draft_revision_id
where page_row.id = :'composition_page_id' \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.save_teacher_microcourse_page(
  :'composition_page_id', :'page_doc'::jsonb, :'page_revision_no'::integer,
  '图文页·版本二', 'revision two'
);
select public.save_teacher_microcourse_metadata(
  :'microcourse_id', '生命周期版本二', '提交版本二', 4::smallint,
  null::smallint, '', 'logic-strategy', array['版本二']
) as second_metadata_revision_id \gset
select public.submit_teacher_microcourse_review(:'microcourse_id', 'second submit') as second_cycle_id \gset
reset role;

select
  (select content_snapshot -> 0 ->> 'revisionId' from public.cw_review_cycles
   where id = :'second_cycle_id') as submitted_page_revision_id,
  (select metadata_revision_id from public.teacher_microcourse_review_snapshots
   where review_cycle_id = :'second_cycle_id') as submitted_metadata_revision_id
\gset

-- Edits during review create revision 3 / metadata 3 but cannot replace cycle 2.
select revision_row.doc as submitted_doc, revision_row.revision_no as submitted_revision_no
from public.cw_page_docs page_row
join public.cw_page_revisions revision_row on revision_row.id = page_row.draft_revision_id
where page_row.id = :'composition_page_id' \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.save_teacher_microcourse_page(
  :'composition_page_id', :'submitted_doc'::jsonb, :'submitted_revision_no'::integer,
  '图文页·审核后草稿', 'edit during review'
);
select public.save_teacher_microcourse_metadata(
  :'microcourse_id', '审核期间新草稿', '不得偷换已提交元数据', 4::smallint,
  null::smallint, '', 'geometry', array['未发布']
) as third_metadata_revision_id \gset
reset role;

select (
  :'first_metadata_revision_id'::uuid <> :'submitted_metadata_revision_id'::uuid
  and :'submitted_metadata_revision_id'::uuid = :'second_metadata_revision_id'::uuid
  and (select metadata_revision_id = :'submitted_metadata_revision_id'::uuid
       from public.teacher_microcourse_review_snapshots
       where review_cycle_id = :'second_cycle_id')
  and (select content_snapshot -> 0 ->> 'revisionId' = :'submitted_page_revision_id'
       from public.cw_review_cycles where id = :'second_cycle_id')
) as submission_snapshots_pinned \gset
\if :submission_snapshots_pinned
\else
  \echo DEV-TMC-1 failed: submitted metadata/page snapshot changed
  select 1 / 0;
\endif

-- An intermediate review round must not authorize public H5 promotion.
update public.cw_lecture_workflows
set required_review_rounds_snapshot = current_review_round + 1
where active_review_cycle_id = :'second_cycle_id';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'reviewer_id', true);
select (
  public.prepare_teacher_microcourse_review_publish(:'second_cycle_id')
    ->> 'finalApproval'
) = 'false' as intermediate_h5_private \gset
reset role;
\if :intermediate_h5_private
\else
  \echo DEV-TMC-1 failed: intermediate review exposed H5 promotion
  select 1 / 0;
\endif
update public.cw_lecture_workflows
set required_review_rounds_snapshot = current_review_round
where active_review_cycle_id = :'second_cycle_id';

-- The content-addressed public object is promoted before final approval.
insert into storage.objects(id, bucket_id, name, owner_id)
values (
  '00000000-0000-4000-8000-000000000923',
  'cw-h5',
  'packages/' || repeat('e', 64) || '/index.html',
  :'reviewer_id'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'reviewer_id', true);
select public.prepare_teacher_microcourse_review_publish(:'second_cycle_id') as promotion_plan \gset
select public.approve_teacher_microcourse_review(
  :'second_cycle_id', 'Approved', array[1, 2]
) as approval_result \gset
reset role;

select current_release_id as published_release_id
from public.course_lectures where id = :'catalog_lecture_id' \gset

select (
  (:'approval_result'::jsonb ->> 'status') = 'published'
  and (:'approval_result'::jsonb ->> 'releaseId')::uuid = :'published_release_id'::uuid
  and (select status = 'enabled' and title = '__DEV_TMC_LIFECYCLE_CLASS__'
       and term is not distinct from (
         select school_term.term
         from public.classrooms classroom
         left join public.school_terms school_term on school_term.id = classroom.term_id
         where classroom.id = '00000000-0000-4000-8000-000000000921'
       )
       and course_kind = 'microcourse'
       from public.courses where id = :'course_id')
  and (select published_metadata_revision_id = :'submitted_metadata_revision_id'::uuid
       and draft_metadata_revision_id = :'third_metadata_revision_id'::uuid
       from public.teacher_microcourses where id = :'microcourse_id')
  and (select snapshot -> 0 ->> 'revisionId' = :'submitted_page_revision_id'
       from public.cw_lecture_releases where id = :'published_release_id')
  and (select lecture_id = :'catalog_lecture_id'
       from public.cw_lecture_releases where id = :'published_release_id')
  and (select microcourse_id = :'microcourse_id'
       and catalog_lecture_id = :'catalog_lecture_id'
       from public.teacher_microcourse_catalog_releases
       where release_id = :'published_release_id')
  and (select status = 'published'
       and public_path = 'packages/' || repeat('e', 64) || '/index.html'
       from public.teacher_microcourse_h5_artifacts where id = :'h5_artifact_id')
  and (select lecture_id is null from public.class_sessions
       where id = '00000000-0000-4000-8000-000000000922')
) as atomic_publish_ok \gset
\if :atomic_publish_ok
\else
  \echo DEV-TMC-1 failed: atomic publication projection
  select
    (:'approval_result'::jsonb ->> 'status') = 'published' as approval_published,
    (:'approval_result'::jsonb ->> 'releaseId')::uuid = :'published_release_id'::uuid
      as approval_release_matches_current,
    (select status = 'enabled' and title = '__DEV_TMC_LIFECYCLE_CLASS__'
       and term is not distinct from (
         select school_term.term
         from public.classrooms classroom
         left join public.school_terms school_term on school_term.id = classroom.term_id
         where classroom.id = '00000000-0000-4000-8000-000000000921'
       )
       and course_kind = 'microcourse'
     from public.courses where id = :'course_id') as course_projection,
    (select published_metadata_revision_id = :'submitted_metadata_revision_id'::uuid
       and draft_metadata_revision_id = :'third_metadata_revision_id'::uuid
     from public.teacher_microcourses where id = :'microcourse_id') as metadata_projection,
    (select snapshot -> 0 ->> 'revisionId' = :'submitted_page_revision_id'
     from public.cw_lecture_releases where id = :'published_release_id') as release_snapshot,
    (select lecture_id = :'catalog_lecture_id'
     from public.cw_lecture_releases where id = :'published_release_id') as stable_lecture,
    (select microcourse_id = :'microcourse_id'
       and catalog_lecture_id = :'catalog_lecture_id'
     from public.teacher_microcourse_catalog_releases
     where release_id = :'published_release_id') as proposal_release_mapping,
    (select status = 'published'
       and public_path = 'packages/' || repeat('e', 64) || '/index.html'
     from public.teacher_microcourse_h5_artifacts where id = :'h5_artifact_id') as h5_projection,
    (select lecture_id is null from public.class_sessions
     where id = '00000000-0000-4000-8000-000000000922') as source_session_unchanged;
  select id, title, term, status, course_kind
  from public.courses where id = :'course_id';
  select 1 / 0;
\endif

-- The already-frozen free session still points at revision 1.
select (
  (select courseware_resolved #>> '{microcourseDraft,pages,0,revisionId}'
   from public.class_sessions
   where id = '00000000-0000-4000-8000-000000000922') = :'first_page_revision_id'
) as frozen_session_stayed_old \gset
\if :frozen_session_stayed_old
\else
  \echo DEV-TMC-1 failed: free-session draft freeze drifted
  select 1 / 0;
\endif

-- Enabled released microcourse is discoverable, then withdrawal hides it
-- without deleting its immutable release.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select count(*) as catalog_count
from public.list_class_build_course_variants(
  p_query => '生命周期版本二', p_course_kind => 'microcourse'
) where course_id = :'course_id' \gset
reset role;
\if :catalog_count
\else
  \echo DEV-TMC-1 failed: published microcourse missing from class builder
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (
  count(*) >= 5
  and bool_and(enabled)
  and count(*) filter (where slug = 'number-algebra') = 1
) as topic_read_model_ok
from public.list_teacher_microcourse_topics() \gset

\if :topic_read_model_ok
\else
  \echo DEV-TMC-1 failed: controlled topic read model
  select 1 / 0;
\endif

select public.withdraw_teacher_microcourse(:'microcourse_id');
reset role;

select (
  (select status = 'draft' from public.courses where id = :'course_id')
  and (select current_release_id is null
       from public.course_lectures where id = :'catalog_lecture_id')
  and (select count(*) = 1 from public.cw_lecture_releases
       where id = :'published_release_id')
) as withdrawal_preserved_history \gset
\if :withdrawal_preserved_history
\else
  \echo DEV-TMC-1 failed: withdrawal damaged published history
  select 1 / 0;
\endif

rollback;
