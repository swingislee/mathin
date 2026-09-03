begin;

do $$
declare
  actor_id uuid;
  term_id_value uuid;
  classroom_id_value uuid;
  existing_student_id uuid;
  shared_phone_student_id uuid;
  created_student_id uuid;
  batch_key text := gen_random_uuid()::text;
  duplicate_batch_key text := gen_random_uuid()::text;
  suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  existing_phone text := '197' || lpad((floor(random() * 100000000))::bigint::text, 8, '0');
  shared_phone text := '198' || lpad((floor(random() * 100000000))::bigint::text, 8, '0');
  source_key text;
  rows_value jsonb;
  preview_result jsonb;
  applied_result jsonb;
  duplicate_result jsonb;
  batch_id_value uuid;
  auth_count_before bigint;
  classroom_count_before bigint;
  session_count_before bigint;
  order_count_before bigint;
  payment_count_before bigint;
  attendance_count_before bigint;
begin
  select id into actor_id
    from public.profiles
   where role = 'admin' and is_active
   order by created_at
   limit 1;
  if actor_id is null then raise exception 'ROSTER_IMPORT_ADMIN_FIXTURE_REQUIRED'; end if;

  select id into term_id_value
    from public.school_terms
   where year = 2026 and term = 2
   order by starts_on
   limit 1;
  if term_id_value is null then raise exception 'ROSTER_IMPORT_2026_AUTUMN_TERM_REQUIRED'; end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  classroom_id_value := public.create_class_v2(
    p_name => '__班级学员导入回滚断言_' || suffix,
    p_course_id => null::uuid,
    p_capacity => 8::smallint,
    p_room_id => null::uuid,
    p_primary_teacher_id => actor_id,
    p_learning_support_id => null::uuid,
    p_term_id => term_id_value,
    p_purpose => 'production',
    p_sessions => '[]'::jsonb,
    p_activate => true,
    p_offering_type => 'long_term_formal'
  );

  insert into public.students(name, phone, grade, status, source, created_by, bind_code)
  values ('花名册已有学员_' || suffix, existing_phone, 3, 'lead', '断言', actor_id, public.generate_student_bind_code())
  returning id into existing_student_id;

  -- A different child may legitimately share a guardian phone. The import must
  -- not reuse this profile when the incoming name differs.
  insert into public.students(name, phone, grade, status, source, created_by, bind_code)
  values ('共享电话另一名孩子_' || suffix, shared_phone, 3, 'lead', '断言', actor_id, public.generate_student_bind_code())
  returning id into shared_phone_student_id;

  select count(*) into auth_count_before from auth.users;
  select count(*) into classroom_count_before from public.classrooms;
  select count(*) into session_count_before from public.class_sessions;
  select count(*) into order_count_before from public.orders;
  select count(*) into payment_count_before from public.payments;
  select count(*) into attendance_count_before from public.session_attendance;

  source_key := '2026::autumn::assertion::' || suffix;
  rows_value := jsonb_build_array(
    jsonb_build_object(
      'sourceRow', 30, 'sourceCell', 'AO30',
      'sourceClassKey', source_key, 'sourceClassLabel', '三年级 · 秋季 · 断言班',
      'rawName', '花名册已有学员_' || suffix, 'studentName', '花名册已有学员_' || suffix,
      'sourcePhone', existing_phone, 'grade', 3, 'classroomId', classroom_id_value,
      'decision', 'link_existing', 'studentId', existing_student_id, 'sourceNote', ''
    ),
    jsonb_build_object(
      'sourceRow', 30, 'sourceCell', 'AP30',
      'sourceClassKey', source_key, 'sourceClassLabel', '三年级 · 秋季 · 断言班',
      'rawName', '共享电话待建学员_' || suffix, 'studentName', '共享电话待建学员_' || suffix,
      'sourcePhone', shared_phone, 'grade', 3, 'classroomId', classroom_id_value,
      'decision', 'create_student', 'studentId', null, 'sourceNote', ''
    ),
    jsonb_build_object(
      'sourceRow', 30, 'sourceCell', 'AQ30',
      'sourceClassKey', source_key, 'sourceClassLabel', '三年级 · 秋季 · 断言班',
      'rawName', '待定学员_' || suffix, 'studentName', '待定学员_' || suffix,
      'sourcePhone', '', 'grade', 3, 'classroomId', null,
      'decision', 'skip', 'studentId', null, 'sourceNote', '待定'
    )
  );

  preview_result := public.preview_mofaxiao_class_roster_import(
    'mofaxiao-class-roster-v1', rows_value, batch_key,
    repeat('a', 64), repeat('b', 64), 'mofaxiao',
    'roster-assertion.xlsx', '26年暑秋在读学员', '班级学员导入断言'
  );
  if preview_result->>'status' <> 'validated'
     or (preview_result->>'total')::integer <> 3
     or (preview_result->>'valid')::integer <> 2
     or (preview_result->>'dup')::integer <> 0
     or (preview_result->>'skipped')::integer <> 1
     or (preview_result->>'errorCount')::integer <> 0 then
    raise exception 'ROSTER_IMPORT_PREVIEW_COUNTS_WRONG: %', preview_result;
  end if;
  batch_id_value := (preview_result->>'batchId')::uuid;

  applied_result := public.apply_mofaxiao_class_roster_import(batch_id_value);
  if applied_result->>'status' <> 'completed'
     or (applied_result->>'inserted')::integer <> 2
     or (applied_result->>'createdStudents')::integer <> 1
     or (applied_result->>'dup')::integer <> 0
     or (applied_result->>'skipped')::integer <> 1
     or (applied_result->>'errorCount')::integer <> 0 then
    raise exception 'ROSTER_IMPORT_APPLY_COUNTS_WRONG: %', applied_result;
  end if;

  select id into created_student_id
    from public.students
   where name = '共享电话待建学员_' || suffix and phone = shared_phone;
  if created_student_id is null or created_student_id = shared_phone_student_id then
    raise exception 'ROSTER_IMPORT_SHARED_PHONE_MERGED_CHILDREN';
  end if;
  if not exists (
    select 1 from public.students student
     where student.id = created_student_id
       and student.grade = 3
       and student.status = 'enrolled'
       and student.source = '班级学员导入'
       and student.assigned_to is null
       and student.user_id is null
  ) then raise exception 'ROSTER_IMPORT_MINIMAL_PROFILE_WRONG'; end if;
  if not exists (
    select 1 from public.students student
     where student.id = existing_student_id and student.status = 'enrolled'
  ) then raise exception 'ROSTER_IMPORT_EXISTING_STUDENT_STATUS_WRONG'; end if;
  if not exists (
    select 1 from public.students student
     where student.id = shared_phone_student_id and student.status = 'lead'
  ) then raise exception 'ROSTER_IMPORT_SHARED_PHONE_SIBLING_MUTATED'; end if;
  if (select count(*) from public.enrollments where classroom_id = classroom_id_value and status = 'active') <> 2 then
    raise exception 'ROSTER_IMPORT_ACTIVE_ENROLLMENTS_WRONG';
  end if;
  if exists (
    select 1 from public.enrollments enrollment
     where enrollment.classroom_id = classroom_id_value and enrollment.term_id is distinct from term_id_value
  ) then raise exception 'ROSTER_IMPORT_TERM_PROVENANCE_WRONG'; end if;
  if not exists (
    select 1 from public.class_roster_source_mappings mapping
     where mapping.source_system = 'mofaxiao'
       and mapping.source_class_key = source_key
       and mapping.classroom_id = classroom_id_value
  ) then raise exception 'ROSTER_IMPORT_CLASS_MAPPING_MISSING'; end if;
  if exists (
    select 1 from public.data_import_rows import_row
     where import_row.batch_id = batch_id_value
       and import_row.payload ?| array['rawName', 'studentName', 'sourcePhone', 'sourceNote']
  ) then raise exception 'ROSTER_IMPORT_RETAINED_SENSITIVE_PAYLOAD'; end if;

  -- Reapplying is idempotent, and a new dry run recognizes both active
  -- memberships as duplicates rather than attempting another write.
  applied_result := public.apply_mofaxiao_class_roster_import(batch_id_value);
  if (applied_result->>'inserted')::integer <> 2
     or (select count(*) from public.enrollments where classroom_id = classroom_id_value and status = 'active') <> 2 then
    raise exception 'ROSTER_IMPORT_REAPPLY_NOT_IDEMPOTENT';
  end if;
  duplicate_result := public.preview_mofaxiao_class_roster_import(
    'mofaxiao-class-roster-v1', rows_value, duplicate_batch_key,
    repeat('c', 64), repeat('d', 64), 'mofaxiao',
    'roster-duplicate-assertion.xlsx', '26年暑秋在读学员', '班级学员重复断言'
  );
  if (duplicate_result->>'valid')::integer <> 0
     or (duplicate_result->>'dup')::integer <> 2
     or (duplicate_result->>'skipped')::integer <> 1
     or (duplicate_result->>'errorCount')::integer <> 0 then
    raise exception 'ROSTER_IMPORT_EXISTING_DUPLICATES_WRONG: %', duplicate_result;
  end if;

  if (select count(*) from auth.users) <> auth_count_before then raise exception 'ROSTER_IMPORT_CREATED_AUTH_USER'; end if;
  if (select count(*) from public.classrooms) <> classroom_count_before then raise exception 'ROSTER_IMPORT_CREATED_CLASS'; end if;
  if (select count(*) from public.class_sessions) <> session_count_before then raise exception 'ROSTER_IMPORT_CREATED_SESSION'; end if;
  if (select count(*) from public.orders) <> order_count_before then raise exception 'ROSTER_IMPORT_CREATED_ORDER'; end if;
  if (select count(*) from public.payments) <> payment_count_before then raise exception 'ROSTER_IMPORT_CREATED_PAYMENT'; end if;
  if (select count(*) from public.session_attendance) <> attendance_count_before then raise exception 'ROSTER_IMPORT_CREATED_ATTENDANCE'; end if;
end
$$;

rollback;
