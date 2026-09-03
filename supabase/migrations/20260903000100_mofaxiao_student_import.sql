-- SCHOOL-OPS-STUDENTS-MOFAXIAO-1: 魔法校学生 XLSX 的脱敏、可审计两阶段导入。
--
-- 来源「学生状态」（包括“历史”）、跟进状态和学管师不参与任何映射；所有来源行
-- 都按同一规则导入。浏览器只提交白名单字段，本函数也拒绝常见禁入字段。

alter table public.students
  add column public_school_class text not null default '',
  add column market_activity text not null default '';

alter table public.students
  add constraint students_public_school_class_length_check
    check (length(public_school_class) <= 100),
  add constraint students_market_activity_length_check
    check (length(market_activity) <= 160);

grant update (public_school_class, market_activity) on public.students to authenticated;

create or replace function public.normalize_mofaxiao_phone(value text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  with normalized as (
    select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') as digits
  )
  select case
    when digits ~ '^86[1-9][0-9]{10}$' then substring(digits from 3)
    else digits
  end
  from normalized
$$;

create or replace function public.normalize_mofaxiao_name(value text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(lower(trim(coalesce(value, ''))), '\s+', '', 'g')
$$;

create or replace function public.get_mofaxiao_student_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_rows jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id;
  if v_batch.id is null
     or v_batch.import_kind <> 'students'
     or v_batch.template_version <> 'mofaxiao-students-v1' then
    raise exception 'BATCH_NOT_FOUND';
  end if;
  if v_batch.created_by <> v_uid and not public.has_perm(v_uid, 'audit.view') then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'row', item.row_no,
    'sourceRow', coalesce(nullif(item.payload->>'sourceRow', '')::integer, item.row_no + 1),
    'sourceName', coalesce(item.payload->>'name', ''),
    'status', item.row_status,
    'errors', to_jsonb(item.error_codes),
    'targetId', item.target_id,
    'matchKind', case
      when 'DUPLICATE_SOURCE_ID' = any(item.error_codes) then 'external_id'
      when 'DUPLICATE_STUDENT_PHONE' = any(item.error_codes) then 'student_phone'
      when 'DUPLICATE_PARENT_PHONE_NAME' = any(item.error_codes) then 'parent_phone_name'
      when 'DUPLICATE_IN_BATCH' = any(item.error_codes) then 'same_batch'
      else 'new'
    end
  ) order by item.row_no), '[]'::jsonb)
    into v_rows
    from public.data_import_rows item
   where item.batch_id = v_batch.id;

  return jsonb_build_object(
    'batchId', v_batch.id,
    'status', v_batch.status,
    'templateVersion', v_batch.template_version,
    'inputHash', v_batch.input_hash,
    'fileName', coalesce(v_batch.source_file_name, ''),
    'fileHash', coalesce(v_batch.source_file_hash, ''),
    'sheetName', coalesce(v_batch.source_sheet_name, ''),
    'batchLabel', coalesce(v_batch.batch_label, ''),
    'total', v_batch.total_rows,
    'valid', v_batch.valid_rows,
    'dup', v_batch.duplicate_rows,
    'errorCount', v_batch.error_rows,
    'inserted', v_batch.inserted_rows,
    'expiresAt', v_batch.expires_at,
    'rows', v_rows
  );
end
$$;

create or replace function public.preview_mofaxiao_student_import(
  p_template_version text,
  p_rows jsonb,
  p_idempotency_key text,
  p_input_hash text,
  p_file_hash text,
  p_source_system text,
  p_source_file_name text,
  p_source_sheet_name text,
  p_batch_label text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch_id uuid;
  v_existing public.data_import_batches%rowtype;
  v_fingerprint text;
  v_item jsonb;
  v_row_no integer;
  v_source_row integer;
  v_external_id text;
  v_external_key text;
  v_name text;
  v_name_key text;
  v_phone text;
  v_phone_key text;
  v_phone_masked boolean;
  v_phone_invalid boolean;
  v_gender text;
  v_birthday_text text;
  v_birthday_raw text;
  v_birthday date;
  v_school text;
  v_public_school_class text;
  v_grade smallint;
  v_grade_text text;
  v_grade_unmapped boolean;
  v_parent_name text;
  v_parent_relation text;
  v_parent_phone text;
  v_parent_phone_key text;
  v_parent_phone_masked boolean;
  v_parent_phone_invalid boolean;
  v_remark text;
  v_source text;
  v_market_activity text;
  v_tags jsonb;
  v_errors text[];
  v_status text;
  v_normalized_key text;
  v_target_id uuid;
  v_valid integer := 0;
  v_duplicate integer := 0;
  v_error integer := 0;
begin
  if v_uid is null or not public.has_perm(v_uid, 'student.import') then raise exception 'FORBIDDEN'; end if;
  if p_template_version is distinct from 'mofaxiao-students-v1' then raise exception 'INVALID_TEMPLATE'; end if;
  if p_source_system is distinct from 'mofaxiao' then raise exception 'INVALID_SOURCE_SYSTEM'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 1 and 200 then raise exception 'INVALID_IDEMPOTENCY'; end if;
  if p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$'
     or p_file_hash is null or p_file_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_HASH'; end if;
  if p_source_file_name is null or length(trim(p_source_file_name)) not between 1 and 255
     or p_source_sheet_name is null or length(trim(p_source_sheet_name)) not between 1 and 120
     or p_batch_label is null or length(trim(p_batch_label)) not between 1 and 160 then
    raise exception 'INVALID_SOURCE_METADATA';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'INVALID_ROWS';
  end if;

  v_fingerprint := md5(concat_ws(':', p_template_version, p_source_system, p_file_hash, p_rows::text));
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':students:' || trim(p_idempotency_key)));
  select * into v_existing
    from public.data_import_batches
   where created_by = v_uid and import_kind = 'students' and idempotency_key = trim(p_idempotency_key);
  if v_existing.id is not null then
    if v_existing.input_fingerprint <> v_fingerprint
       or v_existing.input_hash <> p_input_hash
       or v_existing.source_file_hash is distinct from p_file_hash
       or v_existing.template_version <> p_template_version then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return public.get_mofaxiao_student_import_batch(v_existing.id);
  end if;

  insert into public.data_import_batches(
    import_kind, template_version, idempotency_key, input_hash, input_fingerprint,
    total_rows, valid_rows, duplicate_rows, error_rows, created_by,
    source_system, source_file_name, source_file_hash, source_sheet_name, batch_label
  ) values (
    'students', p_template_version, trim(p_idempotency_key), p_input_hash, v_fingerprint,
    jsonb_array_length(p_rows), 0, 0, jsonb_array_length(p_rows), v_uid,
    p_source_system, trim(p_source_file_name), p_file_hash,
    trim(p_source_sheet_name), trim(p_batch_label)
  ) returning id into v_batch_id;

  for v_item, v_row_no in
    select value, ordinality::integer from jsonb_array_elements(p_rows) with ordinality
  loop
    v_errors := '{}';
    v_source_row := v_row_no + 1;
    v_external_id := '';
    v_name := '';
    v_phone := '';
    v_phone_masked := false;
    v_phone_invalid := false;
    v_gender := '';
    v_birthday_text := '';
    v_birthday_raw := '';
    v_birthday := null;
    v_school := '';
    v_public_school_class := '';
    v_grade := null;
    v_grade_text := '';
    v_grade_unmapped := false;
    v_parent_name := '';
    v_parent_relation := '';
    v_parent_phone := '';
    v_parent_phone_masked := false;
    v_parent_phone_invalid := false;
    v_remark := '';
    v_source := '';
    v_market_activity := '';
    v_tags := '[]'::jsonb;
    v_target_id := null;

    if jsonb_typeof(v_item) is distinct from 'object' then
      v_errors := array_append(v_errors, 'MALFORMED_ROW');
    else
      if v_item ?| array['studentStatus','followUpStatus','manager','idCard','身份证号码','学生状态','跟进状态','学管师'] then
        v_errors := array_append(v_errors, 'FORBIDDEN_SOURCE_FIELD');
      end if;
      v_external_id := trim(coalesce(v_item->>'externalStudentId', ''));
      v_name := trim(coalesce(v_item->>'name', ''));
      v_phone := trim(coalesce(v_item->>'phone', ''));
      v_gender := trim(coalesce(v_item->>'gender', ''));
      v_birthday_text := trim(coalesce(v_item->>'birthdayText', ''));
      v_birthday_raw := trim(coalesce(v_item->>'birthday', ''));
      v_school := trim(coalesce(v_item->>'school', ''));
      v_public_school_class := trim(coalesce(v_item->>'publicSchoolClass', ''));
      v_grade_text := trim(coalesce(v_item->>'gradeText', ''));
      v_parent_name := trim(coalesce(v_item->>'parentName', ''));
      v_parent_relation := trim(coalesce(v_item->>'parentRelation', ''));
      v_parent_phone := trim(coalesce(v_item->>'parentPhone', ''));
      v_remark := trim(coalesce(v_item->>'remark', ''));
      v_source := trim(coalesce(v_item->>'source', ''));
      v_market_activity := trim(coalesce(v_item->>'marketActivity', ''));
      v_tags := coalesce(v_item->'tags', '[]'::jsonb);

      begin
        if v_item ? 'sourceRow' then v_source_row := (v_item->>'sourceRow')::integer; end if;
      exception when others then v_errors := array_append(v_errors, 'INVALID_SOURCE_ROW'); end;
      begin v_phone_masked := coalesce((v_item->>'phoneMasked')::boolean, false);
      exception when others then v_errors := array_append(v_errors, 'INVALID_PHONE'); end;
      begin v_phone_invalid := coalesce((v_item->>'phoneInvalid')::boolean, false);
      exception when others then v_errors := array_append(v_errors, 'INVALID_PHONE'); end;
      begin v_parent_phone_masked := coalesce((v_item->>'parentPhoneMasked')::boolean, false);
      exception when others then v_errors := array_append(v_errors, 'INVALID_PARENT_PHONE'); end;
      begin v_parent_phone_invalid := coalesce((v_item->>'parentPhoneInvalid')::boolean, false);
      exception when others then v_errors := array_append(v_errors, 'INVALID_PARENT_PHONE'); end;
      begin v_grade_unmapped := coalesce((v_item->>'gradeUnmapped')::boolean, false);
      exception when others then v_errors := array_append(v_errors, 'INVALID_GRADE'); end;
      begin
        if v_item ? 'grade' and jsonb_typeof(v_item->'grade') <> 'null' then
          v_grade := (v_item->>'grade')::smallint;
        end if;
      exception when others then v_errors := array_append(v_errors, 'INVALID_GRADE'); end;
      begin
        if v_birthday_raw <> '' then v_birthday := v_birthday_raw::date; end if;
      exception when others then v_errors := array_append(v_errors, 'INVALID_BIRTHDAY'); end;

      if v_source_row not between 2 and 100000 then v_errors := array_append(v_errors, 'INVALID_SOURCE_ROW'); end if;
      if v_name = '' then v_errors := array_append(v_errors, 'EMPTY_NAME'); end if;
      if length(v_external_id) > 100 or length(v_name) > 100 or length(v_school) > 100
         or length(v_public_school_class) > 100 or length(v_parent_name) > 100
         or length(v_source) > 100 then v_errors := array_append(v_errors, 'FIELD_TOO_LONG'); end if;
      if length(v_gender) > 30 or length(v_parent_relation) > 40 or length(v_grade_text) > 40
         or length(v_birthday_text) > 40 or length(v_phone) > 40 or length(v_parent_phone) > 40
         or length(v_market_activity) > 160 or length(v_remark) > 2000 then
        v_errors := array_append(v_errors, 'FIELD_TOO_LONG');
      end if;
      if v_phone_masked and v_phone <> '' then v_errors := array_append(v_errors, 'MASKED_PHONE_NOT_CLEARED'); end if;
      if v_parent_phone_masked and v_parent_phone <> '' then v_errors := array_append(v_errors, 'MASKED_PARENT_PHONE_NOT_CLEARED'); end if;
      if v_phone_invalid or (v_phone <> '' and v_phone !~ '^\+?[0-9]{6,20}$') then v_errors := array_append(v_errors, 'INVALID_PHONE'); end if;
      if v_parent_phone_invalid or (v_parent_phone <> '' and v_parent_phone !~ '^\+?[0-9]{6,20}$') then v_errors := array_append(v_errors, 'INVALID_PARENT_PHONE'); end if;
      if v_grade_unmapped or (v_grade is not null and v_grade not between 1 and 12) then v_errors := array_append(v_errors, 'INVALID_GRADE'); end if;
      if v_birthday_text <> '' and v_birthday is null then v_errors := array_append(v_errors, 'INVALID_BIRTHDAY'); end if;
      if jsonb_typeof(v_tags) is distinct from 'array' then
        v_errors := array_append(v_errors, 'INVALID_TAGS');
      elsif jsonb_array_length(v_tags) > 3 then
        v_errors := array_append(v_errors, 'INVALID_TAGS');
      elsif exists (
           select 1 from jsonb_array_elements(v_tags) tag
            where jsonb_typeof(tag) <> 'string' or length(trim(tag #>> '{}')) not between 1 and 100
         ) then
        v_errors := array_append(v_errors, 'INVALID_TAGS');
      end if;
    end if;

    v_external_key := left(regexp_replace(lower(v_external_id), '\s+', '', 'g'), 100);
    v_name_key := left(public.normalize_mofaxiao_name(v_name), 100);
    v_phone_key := public.normalize_mofaxiao_phone(v_phone);
    v_parent_phone_key := public.normalize_mofaxiao_phone(v_parent_phone);
    v_normalized_key := case
      when v_external_key <> '' then 'mofaxiao:id:' || v_external_key
      when v_phone_key <> '' then 'mofaxiao:phone:' || v_phone_key
      when v_parent_phone_key <> '' and v_name_key <> '' then 'mofaxiao:parent:' || v_parent_phone_key || ':' || v_name_key
      else 'mofaxiao:row:' || v_row_no::text
    end;

    if cardinality(v_errors) = 0 and v_external_key <> '' then
      select prior.target_id into v_target_id
        from public.data_import_rows prior
        join public.data_import_batches prior_batch on prior_batch.id = prior.batch_id
       where prior_batch.template_version = 'mofaxiao-students-v1'
         and prior_batch.status = 'completed'
         and prior.normalized_key = 'mofaxiao:id:' || v_external_key
         and prior.target_id is not null
       order by prior_batch.completed_at
       limit 1;
      if v_target_id is not null then v_errors := array_append(v_errors, 'DUPLICATE_SOURCE_ID'); end if;
    end if;

    if cardinality(v_errors) = 0 and v_phone_key <> '' then
      select student.id into v_target_id
        from public.students student
       where student.deleted_at is null
         and public.normalize_mofaxiao_phone(student.phone) = v_phone_key
       order by student.created_at
       limit 1;
      if v_target_id is not null then v_errors := array_append(v_errors, 'DUPLICATE_STUDENT_PHONE'); end if;
    end if;

    if cardinality(v_errors) = 0 and v_parent_phone_key <> '' and v_name_key <> '' then
      select student.id into v_target_id
        from public.students student
       where student.deleted_at is null
         and public.normalize_mofaxiao_phone(student.parent_phone) = v_parent_phone_key
         and public.normalize_mofaxiao_name(student.name) = v_name_key
       order by student.created_at
       limit 1;
      if v_target_id is not null then v_errors := array_append(v_errors, 'DUPLICATE_PARENT_PHONE_NAME'); end if;
    end if;

    if cardinality(v_errors) = 0 and exists (
      select 1 from public.data_import_rows prior
       where prior.batch_id = v_batch_id and prior.row_status <> 'error'
         and (
           prior.normalized_key = v_normalized_key
           or (v_phone_key <> '' and public.normalize_mofaxiao_phone(prior.payload->>'phone') = v_phone_key)
           or (v_parent_phone_key <> '' and v_name_key <> ''
               and public.normalize_mofaxiao_phone(prior.payload->>'parentPhone') = v_parent_phone_key
               and public.normalize_mofaxiao_name(prior.payload->>'name') = v_name_key)
         )
    ) then
      v_errors := array_append(v_errors, 'DUPLICATE_IN_BATCH');
    end if;

    if cardinality(v_errors) = 0 then
      v_status := 'valid';
      v_valid := v_valid + 1;
    elsif v_errors && array['DUPLICATE_SOURCE_ID','DUPLICATE_STUDENT_PHONE','DUPLICATE_PARENT_PHONE_NAME','DUPLICATE_IN_BATCH'] then
      v_status := 'duplicate';
      v_duplicate := v_duplicate + 1;
    else
      v_status := 'error';
      v_error := v_error + 1;
    end if;

    insert into public.data_import_rows(
      batch_id, row_no, row_status, normalized_key, payload, error_codes, target_id
    ) values (
      v_batch_id,
      v_row_no,
      v_status,
      v_normalized_key,
      jsonb_build_object(
        'sourceRow', v_source_row,
        'externalStudentId', left(v_external_id, 100),
        'name', left(v_name, 100),
        'phone', left(v_phone, 40),
        'gender', left(v_gender, 30),
        'birthday', v_birthday,
        'school', left(v_school, 100),
        'publicSchoolClass', left(v_public_school_class, 100),
        'grade', v_grade,
        'parentName', left(v_parent_name, 100),
        'parentRelation', left(v_parent_relation, 40),
        'parentPhone', left(v_parent_phone, 40),
        'remark', left(v_remark, 2000),
        'source', left(v_source, 100),
        'marketActivity', left(v_market_activity, 160),
        'tags', case when jsonb_typeof(v_tags) = 'array' then v_tags else '[]'::jsonb end
      ),
      v_errors,
      v_target_id
    );
  end loop;

  update public.data_import_batches
     set valid_rows = v_valid, duplicate_rows = v_duplicate, error_rows = v_error
   where id = v_batch_id;

  perform public.emit_domain_event(
    'student_import.validated', 'data_import_batch', v_batch_id,
    jsonb_build_object(
      'kind', 'students', 'sourceSystem', 'mofaxiao', 'inputHash', p_input_hash,
      'total', jsonb_array_length(p_rows), 'valid', v_valid,
      'duplicates', v_duplicate, 'errors', v_error
    ), v_uid, null
  );
  return public.get_mofaxiao_student_import_batch(v_batch_id);
end
$$;

create or replace function public.apply_mofaxiao_student_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_row record;
  v_external_key text;
  v_phone_key text;
  v_parent_phone_key text;
  v_name_key text;
  v_target_id uuid;
  v_duplicate_code text;
  v_inserted integer := 0;
  v_duplicate integer;
  v_valid integer;
begin
  if v_uid is null or not public.has_perm(v_uid, 'student.import') then raise exception 'FORBIDDEN'; end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null
     or v_batch.import_kind <> 'students'
     or v_batch.template_version <> 'mofaxiao-students-v1'
     or v_batch.source_system is distinct from 'mofaxiao' then
    raise exception 'BATCH_NOT_FOUND';
  end if;
  if v_batch.created_by <> v_uid and not public.is_admin(v_uid) then raise exception 'FORBIDDEN'; end if;
  if v_batch.status = 'completed' then return public.get_mofaxiao_student_import_batch(v_batch.id); end if;
  if v_batch.expires_at <= now() then raise exception 'BATCH_EXPIRED'; end if;
  if v_batch.error_rows > 0 then raise exception 'BATCH_HAS_ERRORS'; end if;

  for v_row in
    select * from public.data_import_rows
     where batch_id = v_batch.id and row_status = 'valid'
     order by row_no
     for update
  loop
    v_external_key := left(regexp_replace(lower(coalesce(v_row.payload->>'externalStudentId', '')), '\s+', '', 'g'), 100);
    v_phone_key := public.normalize_mofaxiao_phone(v_row.payload->>'phone');
    v_parent_phone_key := public.normalize_mofaxiao_phone(v_row.payload->>'parentPhone');
    v_name_key := left(public.normalize_mofaxiao_name(v_row.payload->>'name'), 100);
    v_target_id := null;
    v_duplicate_code := null;
    -- 同一来源 ID、完整学生电话或「姓名 + 完整家长电话」都必须串行。
    -- 不能只锁 normalized_key：有来源 ID 时 normalized_key 会优先使用 ID，两个不同
    -- 来源 ID 但相同手机号的并发批次仍可能同时通过查重。
    if v_external_key <> '' then
      perform pg_advisory_xact_lock(hashtext('mofaxiao-student:id:' || v_external_key));
    end if;
    if v_phone_key <> '' then
      perform pg_advisory_xact_lock(hashtext('mofaxiao-student:phone:' || v_phone_key));
    end if;
    if v_parent_phone_key <> '' and v_name_key <> '' then
      perform pg_advisory_xact_lock(hashtext('mofaxiao-student:parent:' || v_parent_phone_key || ':' || v_name_key));
    end if;

    if v_external_key <> '' then
      select prior.target_id into v_target_id
        from public.data_import_rows prior
        join public.data_import_batches prior_batch on prior_batch.id = prior.batch_id
       where prior_batch.template_version = 'mofaxiao-students-v1'
         and prior_batch.status = 'completed'
         and prior.batch_id <> v_batch.id
         and prior.normalized_key = 'mofaxiao:id:' || v_external_key
         and prior.target_id is not null
       order by prior_batch.completed_at
       limit 1;
      if v_target_id is not null then v_duplicate_code := 'DUPLICATE_SOURCE_ID'; end if;
    end if;

    if v_target_id is null and v_phone_key <> '' then
      select student.id into v_target_id
        from public.students student
       where student.deleted_at is null
         and public.normalize_mofaxiao_phone(student.phone) = v_phone_key
       order by student.created_at
       limit 1;
      if v_target_id is not null then v_duplicate_code := 'DUPLICATE_STUDENT_PHONE'; end if;
    end if;

    if v_target_id is null and v_parent_phone_key <> '' and v_name_key <> '' then
      select student.id into v_target_id
        from public.students student
       where student.deleted_at is null
         and public.normalize_mofaxiao_phone(student.parent_phone) = v_parent_phone_key
         and public.normalize_mofaxiao_name(student.name) = v_name_key
       order by student.created_at
       limit 1;
      if v_target_id is not null then v_duplicate_code := 'DUPLICATE_PARENT_PHONE_NAME'; end if;
    end if;

    if v_target_id is not null then
      update public.data_import_rows
         set row_status = 'duplicate', target_id = v_target_id,
             error_codes = array_append(error_codes, v_duplicate_code)
       where batch_id = v_batch.id and row_no = v_row.row_no;
    else
      insert into public.students(
        name, gender, birthday, phone, school, public_school_class, grade,
        source, market_activity, tags, parent_name, parent_relation, parent_phone,
        remark, status, assigned_to, created_by, bind_code
      ) values (
        v_row.payload->>'name',
        coalesce(v_row.payload->>'gender', ''),
        nullif(v_row.payload->>'birthday', '')::date,
        coalesce(v_row.payload->>'phone', ''),
        coalesce(v_row.payload->>'school', ''),
        coalesce(v_row.payload->>'publicSchoolClass', ''),
        nullif(v_row.payload->>'grade', '')::smallint,
        coalesce(v_row.payload->>'source', ''),
        coalesce(v_row.payload->>'marketActivity', ''),
        array(select trim(value) from jsonb_array_elements_text(coalesce(v_row.payload->'tags', '[]'::jsonb))),
        coalesce(v_row.payload->>'parentName', ''),
        coalesce(v_row.payload->>'parentRelation', ''),
        coalesce(v_row.payload->>'parentPhone', ''),
        coalesce(v_row.payload->>'remark', ''),
        'lead', null, v_batch.created_by, public.generate_student_bind_code()
      ) returning id into v_target_id;

      update public.data_import_rows
         set row_status = 'inserted', target_id = v_target_id
       where batch_id = v_batch.id and row_no = v_row.row_no;
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  select count(*) filter (where row_status in ('valid','inserted')),
         count(*) filter (where row_status = 'duplicate')
    into v_valid, v_duplicate
    from public.data_import_rows where batch_id = v_batch.id;

  update public.data_import_batches
     set status = 'completed', valid_rows = v_valid, duplicate_rows = v_duplicate,
         inserted_rows = v_inserted, completed_at = now()
   where id = v_batch.id;
  update public.data_import_rows set payload = null where batch_id = v_batch.id;

  perform public.emit_domain_event(
    'student_import.completed', 'data_import_batch', v_batch.id,
    jsonb_build_object(
      'kind', 'students', 'sourceSystem', 'mofaxiao',
      'inputHash', v_batch.input_hash, 'inserted', v_inserted, 'duplicates', v_duplicate
    ), v_uid, null
  );
  return public.get_mofaxiao_student_import_batch(v_batch.id);
end
$$;

revoke all on function public.normalize_mofaxiao_phone(text) from public, anon, authenticated;
revoke all on function public.normalize_mofaxiao_name(text) from public, anon, authenticated;
revoke all on function public.get_mofaxiao_student_import_batch(uuid) from public, anon, authenticated;
revoke all on function public.preview_mofaxiao_student_import(text, jsonb, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_mofaxiao_student_import(uuid) from public, anon, authenticated;
grant execute on function public.get_mofaxiao_student_import_batch(uuid) to authenticated;
grant execute on function public.preview_mofaxiao_student_import(text, jsonb, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.apply_mofaxiao_student_import(uuid) to authenticated;
