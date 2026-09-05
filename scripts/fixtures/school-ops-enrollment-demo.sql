-- 仅供本机隔离开发库的报名分班人工验收，新增对象统一标记为“报名验收”。
-- 主体和报名流转使用现有 RPC；班级只新增本批对象，课程和学期只读复用。
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local timezone = 'Asia/Shanghai';
select set_config('mathin.seed_expected_db', :'expected_database_id', true) as seed_expected_db \gset
select set_config('request.jwt.claim.sub', :'actor_id', true) as seed_actor \gset
select set_config('request.jwt.claim.role', 'authenticated', true) as seed_role \gset

do $seed$
declare
  seed_key constant text := 'DEMO-ENROLLMENT-20260905';
  class_a constant uuid := 'f3300000-0000-4000-8000-202609050001';
  class_b constant uuid := 'f3300000-0000-4000-8000-202609050002';
  class_c constant uuid := 'f3300000-0000-4000-8000-202609050003';
  actor uuid := auth.uid();
  course_four uuid;
  course_five uuid;
  target_term uuid;
  target_course uuid;
  student_id uuid;
  opportunity_id uuid;
  enrollment_id uuid;
  student_grade smallint;
  seed_count integer;
  before_students bigint;
  before_classes bigint;
  before_memberships bigint;
  before_enrollments bigint;
  before_accounts bigint;
  ordinal integer;
  demo_note text;
begin
  if (select system_identifier::text from pg_control_system())
    <> current_setting('mathin.seed_expected_db') then
    raise exception 'LOCAL_DATABASE_FINGERPRINT_MISMATCH';
  end if;
  perform pg_advisory_xact_lock(hashtext(seed_key));
  if actor is null or not public.has_perm(actor, 'student.create')
    or not public.has_perm(actor, 'followup.write')
    or not public.has_perm(actor, 'enrollment.manage') then
    raise exception 'FIXED_STAFF_PERMISSIONS_REQUIRED';
  end if;

  select count(*) into seed_count from public.students where source=seed_key;
  if seed_count > 0 then
    if seed_count <> 12 or (select count(*) from public.classrooms
      where id in (class_a,class_b,class_c) and name like '报名验收%') <> 3 then
      raise exception 'EXISTING_DEMO_REQUIRES_REVIEW';
    end if;
    -- 用户后续分班、调班和取消的结果保持原样；重跑仅复用已建数据。
    return;
  end if;
  if exists(select 1 from public.classrooms where id in (class_a,class_b,class_c)) then
    raise exception 'DEMO_CLASS_ID_CONFLICT';
  end if;
  select id into course_four from public.courses
    where grade=4 and status='enabled' and purpose='production'
      and course_kind='curriculum' and trashed_at is null and title like '%秋%'
    order by (class_type='A') desc,title,id limit 1;
  select id into course_five from public.courses
    where grade=5 and status='enabled' and purpose='production'
      and course_kind='curriculum' and trashed_at is null and title like '%秋%'
    order by (class_type='A') desc,title,id limit 1;
  select id into target_term from public.school_terms
    where starts_on <= current_date and ends_on >= current_date
    order by starts_on desc,id limit 1;
  if course_four is null or course_five is null or target_term is null then
    raise exception 'AUTUMN_COURSE_AND_TERM_REQUIRED';
  end if;
  select count(*) into before_students from public.students;
  select count(*) into before_classes from public.classrooms;
  select count(*) into before_memberships from public.enrollments;
  select count(*) into before_enrollments from public.course_enrollments;
  select count(*) into before_accounts from auth.users;

  -- 当前报名 RPC 只接受 purpose=production 的正式课程／班级语义。
  -- 执行目标由外层主机、origin、Docker 项目与数据库指纹约束在本机隔离环境。
  insert into public.classrooms(id,owner_id,name,invite_code,course_id,term_id,
    grade,capacity,purpose,offering_type,operational_status)
  values
    (class_a,actor,'报名验收 · 四年级 A 班','d3s905a1',course_four,target_term,4,12,'production','long_term_formal','active'),
    (class_b,actor,'报名验收 · 四年级 B 班','d3s905b1',course_four,target_term,4,12,'production','long_term_formal','active'),
    (class_c,actor,'报名验收 · 五年级 A 班','d3s905c1',course_five,target_term,5,12,'production','long_term_formal','active');

  for ordinal in 1..12 loop
    student_grade := case when ordinal <= 6 or ordinal in (9,10) then 4 else 5 end;
    target_course := case when student_grade=4 then course_four else course_five end;
    demo_note := case
      when ordinal <= 6 then '人工验收种子：同课程、同学期，可连续选择并批量分入四年级 A 班或 B 班。'
      when ordinal <= 8 then '人工验收种子：五年级待分班，用于课程与年级筛选、单人分班。'
      when ordinal=9 then '人工验收种子：已分入四年级 A 班，可试用调班。'
      when ordinal=10 then '人工验收种子：已从四年级 A 班转入 B 班，保留原班历史。'
      when ordinal=11 then '人工验收种子：已分入五年级 A 班。'
      else '人工验收种子：家长调整学习安排，报名取消，保留报名记录。' end;
    student_id := public.create_student(
      '报名验收 · ' || case when student_grade=4 then '四年级' else '五年级' end
        || ' ' || lpad(ordinal::text,2,'0'),
      student_grade,'','',seed_key,'','',demo_note);
    opportunity_id := public.save_course_opportunity(
      null,null,student_id,null,'new',target_course,target_term,'committed',actor,
      '确认报名后安排班级',null,demo_note);
    enrollment_id := public.confirm_course_enrollment(opportunity_id,demo_note);
    if ordinal in (9,10) then
      perform public.assign_course_enrollment(enrollment_id,class_a,'报名验收：首次分班',clock_timestamp());
    elsif ordinal=11 then
      perform public.assign_course_enrollment(enrollment_id,class_c,'报名验收：首次分班',clock_timestamp());
    elsif ordinal=12 then
      perform public.cancel_course_enrollment(enrollment_id,'报名验收：家长调整学习安排，取消本次报名',clock_timestamp());
    end if;
    if ordinal=10 then
      perform public.transfer_course_enrollment(enrollment_id,class_b,'报名验收：由四年级 A 班转入 B 班',clock_timestamp());
    end if;
  end loop;
  if (select count(*) from public.students) <> before_students+12
    or (select count(*) from public.classrooms) <> before_classes+3
    or (select count(*) from public.enrollments) <> before_memberships+4
    or (select count(*) from public.course_enrollments) <> before_enrollments+12
    or (select count(*) from auth.users) <> before_accounts then
    raise exception 'DEMO_COUNT_INVARIANT_FAILED';
  end if;
end;
$seed$;
commit;
