\set ON_ERROR_STOP on
-- DEV-TMC-1 core assertions. All fixture writes are rolled back.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as other_teacher_id from public.profiles where display_name = '测试-学辅' limit 1 \gset
select id as reviewer_id from public.profiles where display_name = '测试-教务' limit 1 \gset

\if :{?admin_id}
\else
  \echo DEV-TMC-1 fixtures missing: admin
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo DEV-TMC-1 fixtures missing: teacher
  select 1 / 0;
\endif
\if :{?other_teacher_id}
\else
  \echo DEV-TMC-1 fixtures missing: second staff actor
  select 1 / 0;
\endif
\if :{?reviewer_id}
\else
  \echo DEV-TMC-1 fixtures missing: reviewer
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}';
begin
  if not ('courseware.microcourse.author' = any(public.school_permission_keys())) then
    failures := array_append(failures, 'permission key missing');
  end if;
  if not ('teaching.teacher_microcourses_v1' = any(public.organization_feature_keys())) then
    failures := array_append(failures, 'feature key missing');
  end if;
  if public.is_feature_enabled('teaching.teacher_microcourses_v1') then
    failures := array_append(failures, 'feature must default disabled');
  end if;
  if (select count(*) from public.teacher_microcourse_topics where enabled) <> 5 then
    failures := array_append(failures, 'controlled topic seed mismatch');
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.create_teacher_microcourse(uuid,text,text,smallint,smallint,text,text,text[])',
    'EXECUTE'
  ) then
    failures := array_append(failures, 'author RPC grant missing');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'DEV_TMC_CORE_STRUCTURE_FAILED: %', array_to_string(failures, ', ');
  end if;
end
$$;

-- Give the second staff fixture the ordinary teacher role without assigning it
-- to the source classroom. This isolates "has capability" from "owns session".
insert into public.staff_role_members(user_id, role_id)
select :'other_teacher_id', role_row.id
from public.staff_roles role_row
where role_row.key = 'teacher'
on conflict do nothing;

insert into public.classrooms(id, owner_id, name, invite_code)
values (
  '00000000-0000-4000-8000-000000000901',
  :'teacher_id',
  '__DEV_TMC_FREE_CLASS__',
  'TMC901'
);
insert into public.classroom_members(classroom_id, user_id, role)
values (
  '00000000-0000-4000-8000-000000000901',
  :'teacher_id',
  'teacher'
);
insert into public.class_sessions(id, classroom_id, title, scheduled_at, duration_min)
values
  (
    '00000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000000901',
    '__DEV_TMC_FREE_SESSION_A__',
    now() + interval '2 days',
    60
  ),
  (
    '00000000-0000-4000-8000-000000000903',
    '00000000-0000-4000-8000-000000000901',
    '__DEV_TMC_FREE_SESSION_B__',
    now() + interval '3 days',
    60
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.set_feature_flag(
  'teaching.teacher_microcourses_v1',
  null,
  true,
  now(),
  'DEV-TMC-1 assertion enable'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select public.create_teacher_microcourse(
  '00000000-0000-4000-8000-000000000902',
  '同年级作品甲',
  '第一份微课',
  3::smallint,
  null::smallint,
  '',
  'logic-strategy',
  array['数独', '策略']
) as microcourse_a \gset
select public.create_teacher_microcourse(
  '00000000-0000-4000-8000-000000000903',
  '同年级作品乙',
  '第二份微课',
  3::smallint,
  null::smallint,
  '',
  'logic-strategy',
  array['数独', '策略']
) as microcourse_b \gset
reset role;

select course_id as course_a, lecture_id as lecture_a
from public.teacher_microcourses where id = :'microcourse_a' \gset
select course_id as course_b, lecture_id as lecture_b
from public.teacher_microcourses where id = :'microcourse_b' \gset

select (
  :'microcourse_a'::uuid <> :'microcourse_b'::uuid
  and (select count(*) = 2 from public.courses
       where id in (:'course_a'::uuid, :'course_b'::uuid)
         and course_kind = 'microcourse'
         and grade = 3
         and term is null
         and class_type = ''
         and status = 'draft')
  and (select count(*) = 2 from public.course_lectures
       where id in (:'lecture_a'::uuid, :'lecture_b'::uuid)
         and no = 1)
) as same_dimension_microcourses_ok \gset
\if :same_dimension_microcourses_ok
\else
  \echo DEV-TMC-1 failed: same-dimension microcourses
  select 1 / 0;
\endif

-- Existing curriculum variants remain unique in their family/catalog version.
do $$
declare source_course public.courses%rowtype;
begin
  select * into source_course from public.courses where product_code = 'CI-DOC26';
  begin
    insert into public.courses(
      family_id, catalog_version_id, title, grade, term, class_type,
      status, purpose, course_kind
    ) values (
      source_course.family_id, source_course.catalog_version_id,
      '__DEV_TMC_DUPLICATE_CURRICULUM__', source_course.grade, source_course.term,
      source_course.class_type, 'draft', 'production', 'curriculum'
    );
    raise exception 'CURRICULUM_DUPLICATE_ACCEPTED';
  exception when unique_violation then null;
  end;
end
$$;

-- Heads and kinds are immutable; a microcourse course cannot acquire lesson 2.
select set_config('dev_tmc.course_a', :'course_a', true);
select set_config('dev_tmc.microcourse_a', :'microcourse_a', true);
do $$
begin
  begin
    update public.courses set course_kind = 'curriculum'
    where id = current_setting('dev_tmc.course_a')::uuid;
    raise exception 'COURSE_KIND_MUTATION_ACCEPTED';
  exception when others then
    if sqlerrm <> 'COURSE_KIND_IMMUTABLE' then raise; end if;
  end;
  begin
    insert into public.course_lectures(course_id, no, name)
    values (current_setting('dev_tmc.course_a')::uuid, 2, '__SECOND_LECTURE__');
    raise exception 'SECOND_MICROCOURSE_LECTURE_ACCEPTED';
  exception when others then
    if sqlerrm <> 'MICROCOURSE_REQUIRES_ONE_LECTURE' then raise; end if;
  end;
  begin
    update public.teacher_microcourse_metadata_revisions
    set title = '__MUTATED__'
    where microcourse_id = current_setting('dev_tmc.microcourse_a')::uuid;
    raise exception 'METADATA_REVISION_MUTATION_ACCEPTED';
  exception when others then
    if sqlerrm <> 'MICROCOURSE_REVISION_IMMUTABLE' then raise; end if;
  end;
end
$$;

-- The author sees its draft; another teacher with the same capability does not.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'teacher_id', true);
select (
  (select count(*) from public.teacher_microcourses where id = :'microcourse_a') = 1
  and (select count(*) from public.teacher_microcourse_metadata_revisions
       where microcourse_id = :'microcourse_a') = 1
  and (select count(*) from public.courses where id = :'course_a') = 1
) as author_reads_draft \gset
reset role;
\if :author_reads_draft
\else
  \echo DEV-TMC-1 failed: author draft read
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'other_teacher_id', true);
select (
  (select count(*) from public.teacher_microcourses where id = :'microcourse_a') = 0
  and (select count(*) from public.teacher_microcourse_metadata_revisions
       where microcourse_id = :'microcourse_a') = 0
  and (select count(*) from public.courses where id = :'course_a') = 0
) as other_teacher_cannot_read_draft \gset
reset role;
\if :other_teacher_cannot_read_draft
\else
  \echo DEV-TMC-1 failed: other teacher draft isolation
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.sub', :'reviewer_id', true);
select (
  (select count(*) from public.teacher_microcourses where id = :'microcourse_a') = 1
  and (select count(*) from public.teacher_microcourse_metadata_revisions
       where microcourse_id = :'microcourse_a') = 1
) as reviewer_reads_draft \gset
reset role;
\if :reviewer_reads_draft
\else
  \echo DEV-TMC-1 failed: reviewer draft read
  select 1 / 0;
\endif

rollback;
