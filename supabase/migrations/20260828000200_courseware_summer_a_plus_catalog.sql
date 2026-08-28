-- Add the production curriculum shell for the two captured 2026 summer A+
-- lectures. The source import remains responsible for pages, assets, revisions,
-- releases and source-package provenance. The other 13 lectures intentionally
-- stay empty and unpublished.

do $$
declare
  v_family_id uuid;
  v_catalog_version_id uuid;
  v_term_id uuid;
  v_course_id constant uuid := 'f73ae240-d19a-45bf-a04d-92347d011a1b';
begin
  select family.id
  into strict v_family_id
  from public.course_families family
  where family.slug = 'aixuexi-primary-math'
    and family.purpose = 'production'
    and family.status = 'enabled';

  select version.id
  into strict v_catalog_version_id
  from public.course_catalog_versions version
  where version.family_id = v_family_id
    and version.slug = 'default'
    and version.status = 'enabled';

  select course_row.term_id
  into v_term_id
  from public.courses course_row
  where course_row.id = v_course_id;

  if v_term_id is null then
    select term.id
    into strict v_term_id
    from public.school_terms term
    where term.year = 2026
      and term.term = 1;
  elsif not exists (
    select 1
    from public.school_terms term
    where term.id = v_term_id
      and term.year = 2026
      and term.term = 1
  ) then
    raise exception 'SUMMER_A_PLUS_TERM_MISMATCH';
  end if;

  if exists (
    select 1
    from public.courses course_row
    where (
      course_row.id = v_course_id
      or course_row.product_code = 'AXX26A-QG-01-SUM'
      or (
        course_row.family_id = v_family_id
        and course_row.catalog_version_id = v_catalog_version_id
        and course_row.grade = 1
        and course_row.term = 1
        and course_row.class_type = 'A+'
      )
    )
    and (
      course_row.id <> v_course_id
      or course_row.family_id <> v_family_id
      or course_row.catalog_version_id <> v_catalog_version_id
      or course_row.term_id <> v_term_id
      or course_row.title <> '爱学习 A+ 全国版数学 · 一年级暑期'
      or course_row.product_code <> 'AXX26A-QG-01-SUM'
      or course_row.grade <> 1
      or course_row.term <> 1
      or course_row.class_type <> 'A+'
      or course_row.purpose <> 'production'
      or course_row.course_kind <> 'curriculum'
      or course_row.status <> 'enabled'
    )
  ) then
    raise exception 'SUMMER_A_PLUS_COURSE_COLLISION';
  end if;

  insert into public.courses (
    id,
    family_id,
    catalog_version_id,
    term_id,
    title,
    product_code,
    grade,
    term,
    class_type,
    purpose,
    course_kind,
    status
  ) values (
    v_course_id,
    v_family_id,
    v_catalog_version_id,
    v_term_id,
    '爱学习 A+ 全国版数学 · 一年级暑期',
    'AXX26A-QG-01-SUM',
    1,
    1,
    'A+',
    'production',
    'curriculum',
    'enabled'
  ) on conflict (id) do nothing;

  if exists (
    with expected(id, no, name, objectives) as (values
      ('ac37976b-7483-4872-8f42-af75389385ce'::uuid, 1, '一个萝卜一个坑', ''),
      ('3de67e61-52a4-43c0-bfb2-cb8d49521d20'::uuid, 2, '第2讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('aca476f5-3b8d-4425-9f34-031a745e993f'::uuid, 3, '第3讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('60905f5f-60ff-47a7-9c7c-03a6f885812d'::uuid, 4, '第4讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('18aeb3f0-6d66-49fd-abcb-31846ba96e92'::uuid, 5, '第5讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('82827bb2-ef98-4d92-9064-5427aad0e6a5'::uuid, 6, '第6讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('f46e28f7-555d-494d-8dc7-953a51551b4d'::uuid, 7, '第7讲 期中复习（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('fd366065-faa6-409f-b596-17f4485a947a'::uuid, 8, '逃家的小羊', ''),
      ('b75d36a6-4365-43fb-aba1-0a5167303be7'::uuid, 9, '第9讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('434b00c0-87af-41bb-b4aa-fbb1e9ecd066'::uuid, 10, '第10讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('f9c49e2d-2ca4-478e-a7ca-557ab2bf35ad'::uuid, 11, '第11讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('233116a6-7f18-4988-b167-3cdc20f1bfae'::uuid, 12, '第12讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('ca06da7c-ba71-446b-a5d4-f5ddf414bb11'::uuid, 13, '第13讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('29dc046f-61df-4228-9818-75ade70524ce'::uuid, 14, '第14讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
      ('7a429623-e6a0-457a-b444-e53e9115e735'::uuid, 15, '第15讲 期末复习（课件留空占位）', '来源尚未捕获，保留教学计划空占位。')
    )
    select 1
    from expected
    join public.course_lectures lecture on lecture.id = expected.id
      or (lecture.course_id = v_course_id and lecture.no = expected.no)
    where lecture.id <> expected.id
      or lecture.course_id <> v_course_id
      or lecture.no <> expected.no
      or lecture.name <> expected.name
      or lecture.objectives <> expected.objectives
      or lecture.status <> 'active'
  ) then
    raise exception 'SUMMER_A_PLUS_LECTURE_COLLISION';
  end if;

  insert into public.course_lectures (
    id,
    course_id,
    no,
    name,
    objectives,
    courseware_template,
    status
  )
  select expected.id, v_course_id, expected.no, expected.name, expected.objectives, '[]'::jsonb, 'active'
  from (values
    ('ac37976b-7483-4872-8f42-af75389385ce'::uuid, 1, '一个萝卜一个坑', ''),
    ('3de67e61-52a4-43c0-bfb2-cb8d49521d20'::uuid, 2, '第2讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('aca476f5-3b8d-4425-9f34-031a745e993f'::uuid, 3, '第3讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('60905f5f-60ff-47a7-9c7c-03a6f885812d'::uuid, 4, '第4讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('18aeb3f0-6d66-49fd-abcb-31846ba96e92'::uuid, 5, '第5讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('82827bb2-ef98-4d92-9064-5427aad0e6a5'::uuid, 6, '第6讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('f46e28f7-555d-494d-8dc7-953a51551b4d'::uuid, 7, '第7讲 期中复习（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('fd366065-faa6-409f-b596-17f4485a947a'::uuid, 8, '逃家的小羊', ''),
    ('b75d36a6-4365-43fb-aba1-0a5167303be7'::uuid, 9, '第9讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('434b00c0-87af-41bb-b4aa-fbb1e9ecd066'::uuid, 10, '第10讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('f9c49e2d-2ca4-478e-a7ca-557ab2bf35ad'::uuid, 11, '第11讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('233116a6-7f18-4988-b167-3cdc20f1bfae'::uuid, 12, '第12讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('ca06da7c-ba71-446b-a5d4-f5ddf414bb11'::uuid, 13, '第13讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('29dc046f-61df-4228-9818-75ade70524ce'::uuid, 14, '第14讲（课件留空占位）', '来源尚未捕获，保留教学计划空占位。'),
    ('7a429623-e6a0-457a-b444-e53e9115e735'::uuid, 15, '第15讲 期末复习（课件留空占位）', '来源尚未捕获，保留教学计划空占位。')
  ) as expected(id, no, name, objectives)
  on conflict (id) do nothing;

  if (select count(*) from public.course_lectures where course_id = v_course_id) <> 15 then
    raise exception 'SUMMER_A_PLUS_LECTURE_COUNT_MISMATCH';
  end if;

  if exists (
    select 1
    from public.course_lectures lecture
    where lecture.course_id = v_course_id
      and lecture.no not in (1, 8)
      and (
        lecture.courseware_template <> '[]'::jsonb
        or lecture.current_release_id is not null
      )
  ) then
    raise exception 'SUMMER_A_PLUS_PLACEHOLDER_MUST_REMAIN_EMPTY';
  end if;
end
$$;
