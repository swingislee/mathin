\set ON_ERROR_STOP on
-- DEV-TMC-4: browser v2 rollout contracts. Every fixture write is rolled back.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as collaborator_id from public.profiles
where id <> :'teacher_id' and public.is_staff(id)
order by display_name, id limit 1 \gset
select id as family_id from public.course_families
where slug = 'teacher-microcourses' and status = 'enabled' limit 1 \gset
select id as organization_id from public.organizations where singleton_key = 1 \gset

\if :{?admin_id}
\else
  \echo DEV-TMC-4 fixtures missing: admin
  select 1 / 0;
\endif
\if :{?teacher_id}
\else
  \echo DEV-TMC-4 fixtures missing: teacher
  select 1 / 0;
\endif
\if :{?collaborator_id}
\else
  \echo DEV-TMC-4 fixtures missing: collaborator
  select 1 / 0;
\endif
\if :{?family_id}
\else
  \echo DEV-TMC-4 fixtures missing: teacher-microcourses family
  select 1 / 0;
\endif

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', :'admin_id', true);
select public.create_teacher_microcourse_catalog_course(
  :'family_id', '__DEV_TMC_BROWSER_V2_ROLLOUT__', 'rollback fixture'
) as created \gset
select :'created'::jsonb ->> 'courseId' as canonical_course_id,
       :'created'::jsonb ->> 'branchId' as branch_id \gset
select set_config('dev_tmc.browser.canonical_course_id', :'canonical_course_id', true);
select set_config('dev_tmc.browser.family_id', :'family_id', true);
select set_config('dev_tmc.browser.teacher_id', :'teacher_id', true);
select set_config('dev_tmc.browser.collaborator_id', :'collaborator_id', true);

do $$
declare preview jsonb;
begin
  preview := public.get_teacher_microcourse_quick_preview(
    current_setting('dev_tmc.browser.canonical_course_id')::uuid
  );
  if preview ->> 'courseId' <> current_setting('dev_tmc.browser.canonical_course_id')
     or jsonb_array_length(preview -> 'lectures') <> 0 then
    raise exception 'BOUNDED_EMPTY_PREVIEW_FAILED';
  end if;
end;
$$;

select public.add_teacher_microcourse_catalog_lecture(
  :'canonical_course_id', '按需新增的一讲', '验证单课程预览'
) as lecture_id \gset
select set_config('dev_tmc.browser.lecture_id', :'lecture_id', true);

do $$
declare preview jsonb;
begin
  preview := public.get_teacher_microcourse_quick_preview(
    current_setting('dev_tmc.browser.canonical_course_id')::uuid
  );
  if jsonb_array_length(preview -> 'lectures') <> 1
     or preview #>> '{lectures,0,id}' <> current_setting('dev_tmc.browser.lecture_id') then
    raise exception 'BOUNDED_PREVIEW_LECTURE_FAILED';
  end if;
end;
$$;

select public.set_teacher_microcourse_branch_members(
  :'branch_id', :'teacher_id', array[:'collaborator_id'::uuid]
);

do $$
declare members jsonb;
begin
  members := public.get_teacher_microcourse_branch_members(
    current_setting('dev_tmc.browser.canonical_course_id')::uuid
  );
  if not (members ->> 'canManage')::boolean
     or members #>> '{branches,0,ownerId}' <> current_setting('dev_tmc.browser.teacher_id')
     or members #>> '{branches,0,collaboratorIds,0}' <> current_setting('dev_tmc.browser.collaborator_id') then
    raise exception 'BRANCH_MEMBER_ASSIGNMENT_FAILED';
  end if;
end;
$$;

reset role;
insert into public.courses(
  family_id, catalog_version_id, title, grade, term, class_type,
  status, purpose, course_kind, created_by
)
select family_id, catalog_version_id, title, grade, term, class_type,
       status, purpose, course_kind, :'admin_id'
from public.courses where id = :'canonical_course_id'
returning id as duplicate_course_id \gset
insert into public.teacher_microcourse_catalog_courses(
  course_id, organization_id, course_family_id, normalized_name,
  description, duplicate_of_course_id, created_by
)
select :'duplicate_course_id', :'organization_id', :'family_id', normalized_name,
       'historical duplicate retained by rollback assertion', :'canonical_course_id', :'admin_id'
from public.teacher_microcourse_catalog_courses where course_id = :'canonical_course_id';
select set_config('dev_tmc.browser.duplicate_course_id', :'duplicate_course_id', true);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', :'admin_id', true);

do $$
declare report jsonb;
begin
  report := public.list_teacher_microcourse_duplicate_report(
    current_setting('dev_tmc.browser.family_id')::uuid
  );
  if not (report ->> 'canManage')::boolean
     or jsonb_array_length(report -> 'groups') < 1
     or not exists (
       select 1
       from jsonb_array_elements(report -> 'groups') grouped
       where grouped ->> 'canonicalCourseId' = current_setting('dev_tmc.browser.canonical_course_id')
         and jsonb_array_length(grouped -> 'courses') = 2
     ) then
    raise exception 'DUPLICATE_REPORT_FAILED';
  end if;
end;
$$;

select public.select_teacher_microcourse_duplicate_canonical(:'duplicate_course_id');

reset role;
do $$
begin
  if (select count(*) from public.teacher_microcourse_catalog_courses
      where course_id in (
        current_setting('dev_tmc.browser.canonical_course_id')::uuid,
        current_setting('dev_tmc.browser.duplicate_course_id')::uuid
      )) <> 2
     or not exists (
       select 1 from public.teacher_microcourse_catalog_courses
       where course_id = current_setting('dev_tmc.browser.duplicate_course_id')::uuid
         and duplicate_of_course_id is null
     )
     or not exists (
       select 1 from public.teacher_microcourse_catalog_courses
       where course_id = current_setting('dev_tmc.browser.canonical_course_id')::uuid
         and duplicate_of_course_id = current_setting('dev_tmc.browser.duplicate_course_id')::uuid
     ) then
    raise exception 'NON_DESTRUCTIVE_CANONICAL_SWITCH_FAILED';
  end if;
end;
$$;

rollback;
\echo DEV-TMC-4 browser v2 rollback assertions passed
