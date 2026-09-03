begin;

do $$
declare
  actor_id uuid;
  batch_key text := gen_random_uuid()::text;
  forbidden_batch_key text := gen_random_uuid()::text;
  external_id text := replace(gen_random_uuid()::text, '-', '');
  phone_value text := '199' || lpad((floor(random() * 100000000))::bigint::text, 8, '0');
  rows_value jsonb;
  preview_result jsonb;
  applied_result jsonb;
  forbidden_result jsonb;
  v_batch_id uuid;
  student_id uuid;
  auth_count_before bigint;
  auth_count_after bigint;
begin
  select id into actor_id
    from public.profiles
   where role = 'admin' and is_active
   order by created_at
   limit 1;
  if actor_id is null then raise exception 'MOFAXIAO_IMPORT_ADMIN_FIXTURE_REQUIRED'; end if;
  if exists (select 1 from public.students where phone = phone_value) then
    raise exception 'MOFAXIAO_IMPORT_PHONE_COLLISION';
  end if;
  if public.normalize_mofaxiao_phone('+86 138-0013-8000') <> '13800138000' then
    raise exception 'MOFAXIAO_IMPORT_PHONE_NORMALIZATION_WRONG';
  end if;

  select count(*) into auth_count_before from auth.users;
  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  rows_value := jsonb_build_array(
    jsonb_build_object(
      'sourceRow', 2,
      'externalStudentId', external_id,
      'name', '魔法校导入断言学生',
      'phone', phone_value,
      'phoneMasked', false,
      'phoneInvalid', false,
      'gender', '男',
      'birthday', '2014-09-01',
      'birthdayText', '2014-09-01',
      'school', '断言公立校',
      'publicSchoolClass', '六(2)班',
      'grade', 6,
      'gradeText', '六年级',
      'gradeUnmapped', false,
      'parentName', '断言家长',
      'parentRelation', '母亲',
      'parentPhone', '',
      'parentPhoneMasked', true,
      'parentPhoneInvalid', false,
      'remark', '来源状态不进入载荷',
      'source', '机构微官网',
      'marketActivity', '秋季开放日',
      'tags', jsonb_build_array('重点', '英语')
    ),
    jsonb_build_object(
      'sourceRow', 3,
      'externalStudentId', external_id || '-duplicate',
      'name', '魔法校同批重复',
      'phone', phone_value,
      'phoneMasked', false,
      'phoneInvalid', false,
      'gender', '',
      'birthday', null,
      'birthdayText', '',
      'school', '',
      'publicSchoolClass', '',
      'grade', null,
      'gradeText', '无年级',
      'gradeUnmapped', false,
      'parentName', '',
      'parentRelation', '',
      'parentPhone', '',
      'parentPhoneMasked', false,
      'parentPhoneInvalid', false,
      'remark', '',
      'source', '',
      'marketActivity', '',
      'tags', '[]'::jsonb
    )
  );

  preview_result := public.preview_mofaxiao_student_import(
    'mofaxiao-students-v1', rows_value, batch_key,
    repeat('a', 64), repeat('b', 64), 'mofaxiao',
    'assertion.xlsx', 'Worksheet', '魔法校断言批次'
  );
  if preview_result->>'status' <> 'validated'
     or (preview_result->>'valid')::integer <> 1
     or (preview_result->>'dup')::integer <> 1
     or (preview_result->>'errorCount')::integer <> 0 then
    raise exception 'MOFAXIAO_IMPORT_PREVIEW_COUNTS_WRONG: %', preview_result;
  end if;
  v_batch_id := (preview_result->>'batchId')::uuid;

  forbidden_result := public.preview_mofaxiao_student_import(
    'mofaxiao-students-v1',
    jsonb_build_array((rows_value->0) || jsonb_build_object(
      'sourceRow', 4, 'externalStudentId', external_id || '-forbidden',
      'phone', '', 'studentStatus', '历史', 'idCard', '110101200001010011'
    )),
    forbidden_batch_key, repeat('c', 64), repeat('d', 64), 'mofaxiao',
    'forbidden.xlsx', 'Worksheet', '禁入字段断言'
  );
  if (forbidden_result->>'errorCount')::integer <> 1
     or forbidden_result->'rows'->0->>'status' <> 'error'
     or not (forbidden_result->'rows'->0->'errors' ? 'FORBIDDEN_SOURCE_FIELD') then
    raise exception 'MOFAXIAO_IMPORT_FORBIDDEN_FIELDS_ACCEPTED: %', forbidden_result;
  end if;

  applied_result := public.apply_mofaxiao_student_import(v_batch_id);
  if applied_result->>'status' <> 'completed'
     or (applied_result->>'inserted')::integer <> 1
     or (applied_result->>'dup')::integer <> 1 then
    raise exception 'MOFAXIAO_IMPORT_APPLY_COUNTS_WRONG: %', applied_result;
  end if;

  select id into student_id
    from public.students
   where phone = phone_value and name = '魔法校导入断言学生';
  if student_id is null then raise exception 'MOFAXIAO_IMPORT_STUDENT_NOT_CREATED'; end if;
  if not exists (
    select 1 from public.students student
     where student.id = student_id
       and student.public_school_class = '六(2)班'
       and student.market_activity = '秋季开放日'
       and student.tags = array['重点', '英语']
       and student.status = 'lead'
       and student.assigned_to is null
       and student.user_id is null
  ) then raise exception 'MOFAXIAO_IMPORT_PROFILE_MAPPING_WRONG'; end if;
  if exists (
    select 1 from public.data_import_rows import_row
     where import_row.batch_id = v_batch_id and import_row.payload is not null
  ) then raise exception 'MOFAXIAO_IMPORT_RETAINED_ROW_PAYLOAD'; end if;
  if not exists (
    select 1 from public.data_import_rows import_row
     where import_row.batch_id = v_batch_id
       and import_row.normalized_key = 'mofaxiao:id:' || external_id
       and import_row.target_id = student_id
  ) then raise exception 'MOFAXIAO_IMPORT_SOURCE_ID_PROVENANCE_MISSING'; end if;

  select count(*) into auth_count_after from auth.users;
  if auth_count_after <> auth_count_before then raise exception 'MOFAXIAO_IMPORT_CREATED_AUTH_USER'; end if;
end
$$;

rollback;
