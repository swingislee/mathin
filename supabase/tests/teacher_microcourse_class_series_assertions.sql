\set ON_ERROR_STOP on
-- DEV-TMC-3: one free classroom becomes one multi-lecture teacher course.
-- Fixture writes are isolated by the surrounding rollback.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as reviewer_id from public.profiles where display_name = '测试-教研' limit 1 \gset
select id as autumn_term_id from public.school_terms where term = 2 order by starts_on desc nulls last limit 1 \gset

\if :{?admin_id}
\else
  \echo DEV-TMC-3 fixtures missing: admin
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo DEV-TMC-3 fixtures missing: teacher
  select 1 / 0;
\endif
\if :{?reviewer_id}
\else
  \echo DEV-TMC-3 fixtures missing: reviewer
  select 1 / 0;
\endif
\if :{?autumn_term_id}
\else
  \echo DEV-TMC-3 fixtures missing: autumn school term
  select 1 / 0;
\endif

insert into public.classrooms(id, owner_id, name, invite_code, grade, term_id)
values (
  '00000000-0000-4000-8000-000000000951',
  :'teacher_id',
  '__DEV_TMC_CLASS_SERIES__',
  'TMC951',
  5,
  :'autumn_term_id'
);
insert into public.classroom_members(classroom_id, user_id, role)
values ('00000000-0000-4000-8000-000000000951', :'teacher_id', 'teacher');
insert into public.class_sessions(id, classroom_id, title, scheduled_at, duration_min)
values
  ('00000000-0000-4000-8000-000000000952', '00000000-0000-4000-8000-000000000951', '第一课', now() + interval '1 day', 60),
  ('00000000-0000-4000-8000-000000000953', '00000000-0000-4000-8000-000000000951', '第二课', now() + interval '2 days', 60),
  ('00000000-0000-4000-8000-000000000954', '00000000-0000-4000-8000-000000000951', '第三课', now() + interval '3 days', 60);

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.set_feature_flag(
  'teaching.teacher_microcourses_v1', null, true, now(), 'DEV-TMC-3 assertion enable'
);

select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.create_teacher_microcourse_variant(
  '00000000-0000-4000-8000-000000000952'::uuid, '第一课主方案', '第一课课件', '', 5::smallint, null::smallint, '', 'integrated-practice', '{}'::text[]
) as first_lesson_id \gset
select public.create_teacher_microcourse_variant(
  '00000000-0000-4000-8000-000000000953'::uuid, '第二课主方案', '第二课课件', '', 5::smallint, null::smallint, '', 'integrated-practice', '{}'::text[]
) as second_lesson_id \gset
select public.create_teacher_microcourse_variant(
  '00000000-0000-4000-8000-000000000954'::uuid, '第三课主方案', '第三课课件', '', 5::smallint, null::smallint, '', 'integrated-practice', '{}'::text[]
) as third_lesson_id \gset
select public.create_teacher_microcourse_variant(
  '00000000-0000-4000-8000-000000000952'::uuid, '第一课备选方案', '第一课备选课件', '', 5::smallint, null::smallint, '', 'integrated-practice', '{}'::text[]
) as alternate_lesson_id \gset
select public.create_teacher_microcourse_composition_page(
  :'first_lesson_id', null, '第一课主方案页面', null, null, null
) as first_page_id \gset
select public.create_teacher_microcourse_composition_page(
  :'alternate_lesson_id', null, '第一课备选方案页面', null, null, null
) as alternate_page_id \gset

-- Publish two alternatives sequentially. They must become release 1/2 of the
-- same catalog lecture; publishing a non-selected alternative must not replace
-- the current release until the session teacher selects it.
select public.submit_teacher_microcourse_review(
  :'first_lesson_id', 'DEV-TMC-3 first proposal'
) as first_cycle_id \gset
reset role;
update public.cw_lecture_workflows
set required_review_rounds_snapshot = current_review_round
where active_review_cycle_id = :'first_cycle_id';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'reviewer_id', true);
select public.approve_teacher_microcourse_review(
  :'first_cycle_id', 'DEV-TMC-3 approve first', array[1]
) as first_approval \gset

select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.submit_teacher_microcourse_review(
  :'alternate_lesson_id', 'DEV-TMC-3 alternate proposal'
) as alternate_cycle_id \gset
reset role;
update public.cw_lecture_workflows
set required_review_rounds_snapshot = current_review_round
where active_review_cycle_id = :'alternate_cycle_id';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'reviewer_id', true);
select public.approve_teacher_microcourse_review(
  :'alternate_cycle_id', 'DEV-TMC-3 approve alternate', array[1]
) as alternate_approval \gset

reset role;

select course_id as first_course_id, source_classroom_id as first_classroom_id
from public.teacher_microcourses where id = :'first_lesson_id' \gset
select course_id as second_course_id from public.teacher_microcourses where id = :'second_lesson_id' \gset
select course_id as third_course_id from public.teacher_microcourses where id = :'third_lesson_id' \gset
select course_id as alternate_course_id from public.teacher_microcourses where id = :'alternate_lesson_id' \gset
select lecture_id as first_catalog_lecture_id
from public.teacher_microcourse_class_lectures
where source_session_id = '00000000-0000-4000-8000-000000000952' \gset
select current_release_id as preselection_release_id
from public.course_lectures where id = :'first_catalog_lecture_id' \gset

select (
  :'first_classroom_id' = '00000000-0000-4000-8000-000000000951'
  and :'first_course_id' = :'second_course_id'
  and :'first_course_id' = :'third_course_id'
  and :'alternate_course_id' = :'first_course_id'
  and (select count(*) = 4 from public.course_lectures where course_id = :'first_course_id')
  and (select count(*) = 3
       from public.course_lectures lecture
       join public.teacher_microcourse_class_lectures class_lecture
         on class_lecture.lecture_id = lecture.id
       where lecture.course_id = :'first_course_id' and lecture.status = 'active')
  and (select array_agg(no order by no) = array[1,2,3,4]::smallint[]
       from public.course_lectures where course_id = :'first_course_id')
  and (select title = '__DEV_TMC_CLASS_SERIES__' and grade = 5 and term = 2
       from public.courses where id = :'first_course_id')
  and (select count(*) = 4
       from public.teacher_microcourses
       where course_id = :'first_course_id'
         and source_classroom_id = '00000000-0000-4000-8000-000000000951')
  and (select course_id = :'first_course_id'
       from public.teacher_microcourse_class_courses
       where source_classroom_id = '00000000-0000-4000-8000-000000000951')
) as class_series_ok \gset
\if :class_series_ok
\else
  \echo teacher microcourse class series did not share one multi-lecture course
  select 1 / 0;
\endif

select (
  (:'first_approval'::jsonb ->> 'status') = 'published'
  and (:'alternate_approval'::jsonb ->> 'status') = 'published'
  and (select count(*) = 2
       from public.cw_lecture_releases
       where lecture_id = :'first_catalog_lecture_id'
         and track = 'native-16x9')
  and (select array_agg(release_no order by release_no) = array[1,2]
       from public.cw_lecture_releases
       where lecture_id = :'first_catalog_lecture_id'
         and track = 'native-16x9')
  and (select count(*) = 2
       from public.teacher_microcourse_catalog_releases
       where catalog_lecture_id = :'first_catalog_lecture_id'
         and microcourse_id in (:'first_lesson_id', :'alternate_lesson_id'))
  and :'preselection_release_id'::uuid =
      (:'first_approval'::jsonb ->> 'releaseId')::uuid
) as release_versions_ok \gset
\if :release_versions_ok
\else
  \echo same-session proposals did not become release versions of one lecture
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.select_teacher_microcourse_variant(
  '00000000-0000-4000-8000-000000000952', :'alternate_lesson_id'
);
reset role;
select (
  (select selected_teacher_microcourse_id = :'alternate_lesson_id'
   from public.class_sessions
   where id = '00000000-0000-4000-8000-000000000952')
  and (select current_release_id =
         (:'alternate_approval'::jsonb ->> 'releaseId')::uuid
       from public.course_lectures where id = :'first_catalog_lecture_id')
) as release_selection_ok \gset
\if :release_selection_ok
\else
  \echo selecting a proposal did not switch the catalog lecture release
  select 1 / 0;
\endif

-- A partially published/entirely draft series must not enter the shared class
-- builder catalog even though its lesson proposals remain editable.
select not public.teacher_microcourse_course_is_publishable(:'first_course_id') as draft_hidden_ok \gset
\if :draft_hidden_ok
\else
  \echo draft teacher microcourse series unexpectedly became catalog-publishable
  select 1 / 0;
\endif

rollback;
