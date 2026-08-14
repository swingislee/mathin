-- P6-AIX-3：爱学习课程包收敛与教学计划缺口。
--
-- 1. 仅清理两个明确命名的 QA 测试课程产品、其全部测试班及依赖历史，生产课程族不参与。
-- 2. A+/G+/X+ 共用一个课程族和一个默认目录版本；class_type 继续承载难度标签，
--    界面层按 X+ < G+ < A+ 展示。
-- 3. 源站没有第 7/15 讲课件的版本补齐教学计划占位；占位讲次不创建 release，
--    因而在课件准备状态中保持“未发布”。

-- ---------------------------------------------------------------------------
-- 1. 精确清理 QA 课程产品
-- ---------------------------------------------------------------------------
do $$
declare
  qa_family_ids uuid[];
  qa_classroom_ids uuid[];
  qa_classroom_row record;
  qa_family_row record;
begin
  select coalesce(array_agg(family_row.id order by family_row.slug), '{}'::uuid[])
    into qa_family_ids
    from public.course_families family_row
   where family_row.slug in (
     'qa-20260803-manual-course-02',
     'qa-20260803-manual-acceptance'
   )
     and family_row.purpose = 'test';

  if exists (
    select 1
      from public.course_families family_row
     where family_row.slug in (
       'qa-20260803-manual-course-02',
       'qa-20260803-manual-acceptance'
     )
       and (
         family_row.purpose <> 'test'
         or (family_row.slug = 'qa-20260803-manual-course-02'
             and family_row.title <> 'QA-20260803-manual-COURSE-02 课程产品')
         or (family_row.slug = 'qa-20260803-manual-acceptance'
             and family_row.title <> 'QA-20260803-人工验收课程')
       )
  ) then
    raise exception 'QA_COURSE_CLEANUP_TARGET_MISMATCH';
  end if;

  if coalesce(array_length(qa_family_ids, 1), 0) = 0 then
    return;
  end if;

  select coalesce(array_agg(classroom_row.id order by classroom_row.id), '{}'::uuid[])
    into qa_classroom_ids
    from public.classrooms classroom_row
    join public.courses course_row on course_row.id = classroom_row.course_id
   where course_row.family_id = any(qa_family_ids);

  if exists (
    select 1
      from public.classrooms classroom_row
      join public.courses course_row on course_row.id = classroom_row.course_id
     where course_row.family_id = any(qa_family_ids)
       and (
         classroom_row.purpose <> 'test'
         or classroom_row.name not like 'QA-20260803-%'
       )
  ) then
    raise exception 'QA_COURSE_CLEANUP_CLASSROOM_MISMATCH';
  end if;

  if exists (
    select 1 from public.orders order_row
     where order_row.classroom_id = any(qa_classroom_ids)
  ) then
    raise exception 'QA_COURSE_CLEANUP_ORDER_HISTORY';
  end if;

  -- 这些历史只允许来自本次精确命中的 QA 班。先清掉 RESTRICT 外键依赖，随后删除
  -- 测试班及其级联数据；学生档案按既有 purge_test_classroom 语义保留。
  delete from public.session_changes change_row
   where change_row.session_id in (
      select session_row.id
        from public.class_sessions session_row
       where session_row.classroom_id = any(qa_classroom_ids)
    )
      or change_row.from_session in (
      select session_row.id
        from public.class_sessions session_row
       where session_row.classroom_id = any(qa_classroom_ids)
    )
      or change_row.to_session in (
      select session_row.id
        from public.class_sessions session_row
       where session_row.classroom_id = any(qa_classroom_ids)
    );

  delete from public.lesson_ledger ledger_row
   where ledger_row.session_id in (
      select session_row.id
        from public.class_sessions session_row
       where session_row.classroom_id = any(qa_classroom_ids)
    );

  for qa_classroom_row in
    select classroom_row.id, classroom_row.name
      from public.classrooms classroom_row
     where classroom_row.id = any(qa_classroom_ids)
  loop
    perform public.emit_domain_event(
      'classroom.lifecycle.purged',
      'classroom',
      qa_classroom_row.id,
      jsonb_build_object('name', qa_classroom_row.name, 'reason', 'qa_course_product_cleanup'),
      null,
      null
    );
  end loop;
  delete from public.classrooms where id = any(qa_classroom_ids);

  for qa_family_row in
    select family_row.id, family_row.title
      from public.course_families family_row
     where family_row.id = any(qa_family_ids)
  loop
    perform public.emit_domain_event(
      'course_family.lifecycle.purged',
      'course_family',
      qa_family_row.id,
      jsonb_build_object('title', qa_family_row.title, 'reason', 'qa_course_product_cleanup'),
      null,
      null
    );
  end loop;

  delete from public.courses where family_id = any(qa_family_ids);
  delete from public.course_catalog_versions where family_id = any(qa_family_ids);
  delete from public.course_families where id = any(qa_family_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A+/G+/X+ 合并为一个课程包
-- ---------------------------------------------------------------------------
do $$
declare
  canonical_family_id uuid;
  canonical_version_id uuid;
  aixuexi_family_ids uuid[];
  old_family_ids uuid[];
begin
  select family_row.id
    into canonical_family_id
    from public.course_families family_row
   where family_row.slug = 'aixuexi-gplus-primary-math-sujiao';
  if canonical_family_id is null then
    raise exception 'AIXUEXI_CANONICAL_FAMILY_MISSING';
  end if;

  if exists (
    select 1
      from public.course_families family_row
     where family_row.slug = 'aixuexi-primary-math'
       and family_row.id <> canonical_family_id
  ) then
    raise exception 'AIXUEXI_CANONICAL_SLUG_TAKEN';
  end if;

  select coalesce(array_agg(family_row.id order by family_row.slug), '{}'::uuid[])
    into aixuexi_family_ids
    from public.course_families family_row
   where family_row.slug in (
     'aixuexi-gplus-primary-math-sujiao',
     'aixuexi-xplus-primary-math-sujiao',
     'aixuexi-aplus-primary-math-quanguo'
   )
     and family_row.purpose = 'production';

  if coalesce(array_length(aixuexi_family_ids, 1), 0) <> 3 then
    raise exception 'AIXUEXI_FAMILY_SET_INCOMPLETE';
  end if;

  select version_row.id
    into canonical_version_id
    from public.course_catalog_versions version_row
   where version_row.family_id = canonical_family_id
     and version_row.slug = 'default';
  if canonical_version_id is null then
    raise exception 'AIXUEXI_CANONICAL_VERSION_MISSING';
  end if;

  if exists (
    select 1
      from public.course_catalog_versions version_row
     where version_row.family_id = any(aixuexi_family_ids)
       and version_row.slug <> 'default'
  ) then
    raise exception 'AIXUEXI_UNEXPECTED_CATALOG_VERSION';
  end if;

  old_family_ids := array(
    select old_family.family_id
      from unnest(aixuexi_family_ids) as old_family(family_id)
     where old_family.family_id <> canonical_family_id
  );

  -- 课程级责任/工作流随课程族迁移；家庭级历史责任若存在则停止，避免静默合并
  -- 两个不同责任边界。
  if exists (
    select 1 from public.course_staff_assignments assignment_row
     where assignment_row.family_id = any(old_family_ids)
       and assignment_row.scope_type = 'family'
  ) or exists (
    select 1 from public.cw_workflow_policies policy_row
     where policy_row.family_id = any(old_family_ids)
       and policy_row.course_id is null
  ) then
    raise exception 'AIXUEXI_FAMILY_LEVEL_ASSIGNMENT_CONFLICT';
  end if;

  update public.courses course_row
     set family_id = canonical_family_id,
         catalog_version_id = canonical_version_id
   where course_row.family_id = any(old_family_ids);

  update public.course_staff_assignments assignment_row
     set family_id = canonical_family_id
   where assignment_row.family_id = any(old_family_ids);

  update public.cw_workflow_policies policy_row
     set family_id = canonical_family_id
   where policy_row.family_id = any(old_family_ids);

  delete from public.course_catalog_versions version_row
   where version_row.family_id = any(old_family_ids);

  update public.course_families
     set slug = 'aixuexi-primary-math',
         title = '爱学习小学数学',
         publisher = '爱学习',
         stage = '小学',
         subject = '数学',
         edition = '全国版 / 苏教版',
         description = '爱学习 2026 秋季小学数学课程包；难度由低到高为 X+、G+、A+。A+ 使用全国版，G+/X+ 使用苏教版。',
         purpose = 'production',
         status = 'enabled'
   where id = canonical_family_id;

  delete from public.course_families family_row
   where family_row.id = any(old_family_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. 补齐缺少源站课件的第 7/15 讲计划占位
-- ---------------------------------------------------------------------------
with placeholder_specs(lecture_no, lecture_title) as (
  values
    (7::smallint, '期中复习'),
    (15::smallint, '期末复习')
), target_courses as (
  select course_row.id
    from public.courses course_row
    join public.course_families family_row on family_row.id = course_row.family_id
   where family_row.slug = 'aixuexi-primary-math'
     and (
       (course_row.class_type = 'G+' and course_row.grade in (5, 6))
       or (course_row.class_type = 'X+' and course_row.grade in (2, 5, 6))
     )
), missing_plan_rows as (
  select target_course.id as course_id, placeholder.lecture_no,
         format('第%s讲 %s（计划补充占位）', placeholder.lecture_no, placeholder.lecture_title) as name
    from target_courses target_course
    cross join placeholder_specs placeholder
   where not exists (
     select 1
       from public.course_lectures lecture_row
      where lecture_row.course_id = target_course.id
        and lecture_row.no = placeholder.lecture_no
   )
)
insert into public.course_lectures(course_id, no, name, objectives, status)
select missing_plan_rows.course_id,
       missing_plan_rows.lecture_no,
       missing_plan_rows.name,
       '源站未提供本讲课件，保留教学计划补充占位。',
       'active'
  from missing_plan_rows;

do $$
declare
  placeholder_count integer;
  aixuexi_course_count integer;
  aixuexi_lecture_count integer;
begin
  select count(*)
    into placeholder_count
    from public.course_lectures lecture_row
    join public.courses course_row on course_row.id = lecture_row.course_id
    join public.course_families family_row on family_row.id = course_row.family_id
   where family_row.slug = 'aixuexi-primary-math'
     and lecture_row.name in (
       '第7讲 期中复习（计划补充占位）',
       '第15讲 期末复习（计划补充占位）'
     );
  if placeholder_count <> 10 then
    raise exception 'AIXUEXI_PLACEHOLDER_COUNT_MISMATCH: %', placeholder_count;
  end if;

  if exists (
    select 1
      from public.course_lectures lecture_row
      join public.courses course_row on course_row.id = lecture_row.course_id
      join public.course_families family_row on family_row.id = course_row.family_id
     where family_row.slug = 'aixuexi-primary-math'
       and lecture_row.name in (
         '第7讲 期中复习（计划补充占位）',
         '第15讲 期末复习（计划补充占位）'
       )
       and (
         lecture_row.status <> 'active'
         or lecture_row.current_release_id is not null
         or lecture_row.courseware_template <> '[]'::jsonb
       )
  ) then
    raise exception 'AIXUEXI_PLACEHOLDER_MUST_BE_UNPUBLISHED';
  end if;

  select count(*) into aixuexi_course_count
    from public.courses course_row
    join public.course_families family_row on family_row.id = course_row.family_id
   where family_row.slug = 'aixuexi-primary-math';
  select count(*) into aixuexi_lecture_count
    from public.course_lectures lecture_row
    join public.courses course_row on course_row.id = lecture_row.course_id
    join public.course_families family_row on family_row.id = course_row.family_id
   where family_row.slug = 'aixuexi-primary-math';
  if aixuexi_course_count <> 12 or aixuexi_lecture_count <> 180 then
    raise exception 'AIXUEXI_MERGED_CATALOG_COUNT_MISMATCH: courses=% lectures=%',
      aixuexi_course_count, aixuexi_lecture_count;
  end if;
end;
$$;
