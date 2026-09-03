-- DATA-IMPORT-CLASSES-1: import legacy Mofaxiao class exports as classroom shells.
--
-- The source workbook is a class summary, not a session roster or an exact
-- schedule.  Applying a batch creates classrooms and primary-teacher links,
-- but never creates class_sessions, enrollments, activities, orders or fees.

alter table public.data_import_batches
  drop constraint if exists data_import_batches_import_kind_check;
alter table public.data_import_batches
  add constraint data_import_batches_import_kind_check
  check (import_kind in ('students', 'staff', 'leads', 'classes'));

create or replace function public.normalize_mofaxiao_class_text(value text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(lower(trim(coalesce(value, ''))), '\s+', '', 'g')
$$;

create or replace function public.get_mofaxiao_class_import_batch(p_batch_id uuid)
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
     or v_batch.import_kind <> 'classes'
     or v_batch.template_version <> 'mofaxiao-classes-v1' then
    raise exception 'BATCH_NOT_FOUND';
  end if;
  if v_batch.created_by <> v_uid and not public.has_perm(v_uid, 'audit.view') then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'row', item.row_no,
    'sourceRow', coalesce(nullif(item.payload->>'sourceRow', '')::integer, item.row_no + 1),
    'sourceClassId', coalesce(item.payload->>'externalClassId', ''),
    'sourceName', coalesce(item.payload->>'name', ''),
    'status', item.row_status,
    'errors', to_jsonb(item.error_codes),
    'targetId', item.target_id,
    'matchKind', case
      when 'DUPLICATE_SOURCE_ID' = any(item.error_codes) then 'source_id'
      when 'DUPLICATE_EXISTING_CLASS' = any(item.error_codes) then 'existing_class'
      when 'DUPLICATE_SAME_BATCH' = any(item.error_codes) then 'same_batch'
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

create or replace function public.preview_mofaxiao_class_import(
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
  v_teaching_mode text;
  v_course_name text;
  v_course_type text;
  v_progress_text text;
  v_subject text;
  v_grade smallint;
  v_grade_text text;
  v_grade_unmapped boolean;
  v_season smallint;
  v_season_text text;
  v_class_type text;
  v_assessment_difficulty text;
  v_teacher_name text;
  v_campus_name text;
  v_room_name text;
  v_fee_text text;
  v_current_student_count integer;
  v_enrolled_count integer;
  v_capacity smallint;
  v_capacity_invalid boolean;
  v_source_status text;
  v_start_date text;
  v_start_date_text text;
  v_start_date_value date;
  v_end_date text;
  v_end_date_text text;
  v_end_date_value date;
  v_session_time text;
  v_purchased_text text;
  v_course_id uuid;
  v_import_as_free boolean;
  v_teacher_id uuid;
  v_room_id uuid;
  v_school_term_id uuid;
  v_term_period smallint;
  v_course_row public.courses%rowtype;
  v_errors text[];
  v_status text;
  v_target_id uuid;
  v_match_kind text;
  v_valid integer := 0;
  v_duplicate integer := 0;
  v_error integer := 0;
begin
  if v_uid is null or not public.has_perm(v_uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
  if p_template_version is distinct from 'mofaxiao-classes-v1' then raise exception 'INVALID_TEMPLATE'; end if;
  if p_source_system is distinct from 'mofaxiao' then raise exception 'INVALID_SOURCE_SYSTEM'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 1 and 200 then raise exception 'INVALID_IDEMPOTENCY'; end if;
  if p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$'
     or p_file_hash is null or p_file_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_HASH'; end if;
  if length(trim(coalesce(p_source_file_name, ''))) not between 1 and 255
     or length(trim(coalesce(p_source_sheet_name, ''))) not between 1 and 120
     or length(trim(coalesce(p_batch_label, ''))) not between 1 and 160 then
    raise exception 'INVALID_SOURCE_METADATA';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'INVALID_ROWS';
  end if;

  v_fingerprint := md5(concat_ws(':', p_template_version, p_source_system, p_file_hash, p_rows::text));
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':classes:' || trim(p_idempotency_key)));
  select * into v_existing
    from public.data_import_batches
   where created_by = v_uid and import_kind = 'classes' and idempotency_key = trim(p_idempotency_key);
  if v_existing.id is not null then
    if v_existing.input_fingerprint <> v_fingerprint or v_existing.input_hash <> p_input_hash
       or v_existing.template_version <> p_template_version then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return public.get_mofaxiao_class_import_batch(v_existing.id);
  end if;

  insert into public.data_import_batches(
    import_kind, template_version, idempotency_key, input_hash, input_fingerprint,
    total_rows, valid_rows, duplicate_rows, error_rows, created_by,
    source_system, source_file_name, source_file_hash, source_sheet_name, batch_label
  ) values (
    'classes', p_template_version, trim(p_idempotency_key), p_input_hash, v_fingerprint,
    jsonb_array_length(p_rows), 0, 0, jsonb_array_length(p_rows), v_uid,
    p_source_system, trim(p_source_file_name), p_file_hash, trim(p_source_sheet_name), trim(p_batch_label)
  ) returning id into v_batch_id;

  for v_item, v_row_no in
    select value, ordinality::integer from jsonb_array_elements(p_rows) with ordinality
  loop
    v_errors := '{}';
    v_target_id := null;
    v_match_kind := 'new';
    v_source_row := v_row_no + 1;
    v_external_id := '';
    v_name := '';
    v_teaching_mode := '';
    v_course_name := '';
    v_course_type := '';
    v_progress_text := '';
    v_subject := '';
    v_grade := null;
    v_grade_text := '';
    v_grade_unmapped := false;
    v_season := null;
    v_season_text := '';
    v_class_type := '';
    v_assessment_difficulty := '';
    v_teacher_name := '';
    v_campus_name := '';
    v_room_name := '';
    v_fee_text := '';
    v_current_student_count := null;
    v_enrolled_count := null;
    v_capacity := null;
    v_capacity_invalid := false;
    v_source_status := '';
    v_start_date := '';
    v_start_date_text := '';
    v_start_date_value := null;
    v_end_date := '';
    v_end_date_text := '';
    v_end_date_value := null;
    v_session_time := '';
    v_purchased_text := '';
    v_course_id := null;
    v_import_as_free := false;
    v_teacher_id := null;
    v_room_id := null;
    v_school_term_id := null;

    if jsonb_typeof(v_item) is distinct from 'object' then
      v_errors := array_append(v_errors, 'MALFORMED_ROW');
    else
      if v_item ?| array['sessions','studentIds','enrollmentIds','orders','payments','feeAmount'] then
        v_errors := array_append(v_errors, 'FORBIDDEN_SOURCE_FIELD');
      end if;
      begin
        v_source_row := coalesce((v_item->>'sourceRow')::integer, v_row_no + 1);
        v_external_id := trim(coalesce(v_item->>'externalClassId', ''));
        v_name := trim(coalesce(v_item->>'name', ''));
        v_teaching_mode := trim(coalesce(v_item->>'teachingMode', ''));
        v_course_name := trim(coalesce(v_item->>'courseName', ''));
        v_course_type := trim(coalesce(v_item->>'courseType', ''));
        v_progress_text := trim(coalesce(v_item->>'progressText', ''));
        v_subject := trim(coalesce(v_item->>'subject', ''));
        v_grade := nullif(v_item->>'grade', '')::smallint;
        v_grade_text := trim(coalesce(v_item->>'gradeText', ''));
        v_grade_unmapped := coalesce((v_item->>'gradeUnmapped')::boolean, false);
        v_season := nullif(v_item->>'season', '')::smallint;
        v_season_text := trim(coalesce(v_item->>'seasonText', ''));
        v_class_type := trim(coalesce(v_item->>'classType', ''));
        v_assessment_difficulty := trim(coalesce(v_item->>'assessmentDifficulty', ''));
        v_teacher_name := trim(coalesce(v_item->>'teacherName', ''));
        v_campus_name := trim(coalesce(v_item->>'campusName', ''));
        v_room_name := trim(coalesce(v_item->>'roomName', ''));
        v_fee_text := trim(coalesce(v_item->>'feeText', ''));
        v_current_student_count := nullif(v_item->>'currentStudentCount', '')::integer;
        v_enrolled_count := nullif(v_item->>'enrolledCount', '')::integer;
        v_capacity := nullif(v_item->>'capacity', '')::smallint;
        v_capacity_invalid := coalesce((v_item->>'capacityInvalid')::boolean, false);
        v_source_status := trim(coalesce(v_item->>'sourceStatus', ''));
        v_start_date := coalesce(v_item->>'startDate', '');
        v_start_date_text := trim(coalesce(v_item->>'startDateText', ''));
        v_end_date := coalesce(v_item->>'endDate', '');
        v_end_date_text := trim(coalesce(v_item->>'endDateText', ''));
        v_session_time := trim(coalesce(v_item->>'sessionTime', ''));
        v_purchased_text := trim(coalesce(v_item->>'purchasedText', ''));
        v_course_id := nullif(v_item->>'courseId', '')::uuid;
        v_import_as_free := coalesce((v_item->>'importAsFreeClass')::boolean, false);
        v_teacher_id := nullif(v_item->>'primaryTeacherId', '')::uuid;
        v_room_id := nullif(v_item->>'roomId', '')::uuid;
        v_school_term_id := nullif(v_item->>'schoolTermId', '')::uuid;
      exception when others then
        v_errors := array_append(v_errors, 'MALFORMED_ROW');
      end;
    end if;

    if v_external_id = '' then v_errors := array_append(v_errors, 'EMPTY_SOURCE_ID'); end if;
    if length(v_external_id) > 100 then v_errors := array_append(v_errors, 'SOURCE_ID_TOO_LONG'); end if;
    if v_name = '' then v_errors := array_append(v_errors, 'EMPTY_NAME'); end if;
    if length(v_name) > 100 then v_errors := array_append(v_errors, 'NAME_TOO_LONG'); end if;
    if length(v_course_name) > 160 or length(v_teacher_name) > 100
       or length(v_campus_name) > 100 or length(v_room_name) > 100 then
      v_errors := array_append(v_errors, 'SOURCE_TEXT_TOO_LONG');
    end if;
    if v_teaching_mode <> '面授' then v_errors := array_append(v_errors, 'UNSUPPORTED_TEACHING_MODE'); end if;
    if v_course_type not in ('长期班', '短期班') then v_errors := array_append(v_errors, 'UNSUPPORTED_CLASS_TYPE'); end if;
    if v_grade_unmapped or (v_grade is not null and v_grade not between 1 and 12) then
      v_errors := array_append(v_errors, 'INVALID_GRADE');
    end if;
    if v_season is null or v_season not between 1 and 4 then v_errors := array_append(v_errors, 'INVALID_SEASON'); end if;
    if v_capacity_invalid or (v_capacity is not null and v_capacity not between 1 and 500) then
      v_errors := array_append(v_errors, 'INVALID_CAPACITY');
    end if;
    if v_source_status not in ('未开课', '开课中') then v_errors := array_append(v_errors, 'UNSUPPORTED_CLASS_STATUS'); end if;
    if v_start_date = '' then
      if v_start_date_text <> '' then v_errors := array_append(v_errors, 'INVALID_START_DATE'); end if;
    else
      begin
        if v_start_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid date shape'; end if;
        v_start_date_value := v_start_date::date;
      exception when others then
        v_errors := array_append(v_errors, 'INVALID_START_DATE');
      end;
    end if;
    if v_end_date = '' then
      if v_end_date_text <> '' then v_errors := array_append(v_errors, 'INVALID_END_DATE'); end if;
    else
      begin
        if v_end_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid date shape'; end if;
        v_end_date_value := v_end_date::date;
      exception when others then
        v_errors := array_append(v_errors, 'INVALID_END_DATE');
      end;
    end if;
    if v_start_date_value is not null and v_end_date_value is not null and v_end_date_value < v_start_date_value then
      v_errors := array_append(v_errors, 'INVALID_DATE_RANGE');
    end if;

    if v_teacher_id is null then
      v_errors := array_append(v_errors, 'MISSING_TEACHER_MAPPING');
    elsif not exists (
      select 1 from public.profiles profile
       where profile.id = v_teacher_id and profile.is_active and profile.role in ('staff', 'admin')
    ) then
      v_errors := array_append(v_errors, 'INVALID_STAFF');
    end if;

    if v_school_term_id is null then
      v_errors := array_append(v_errors, 'MISSING_SCHOOL_TERM_MAPPING');
    else
      select term_row.term into v_term_period from public.school_terms term_row where term_row.id = v_school_term_id;
      if not found then
        v_errors := array_append(v_errors, 'INVALID_SCHOOL_TERM');
      elsif v_season is not null and v_term_period <> v_season then
        v_errors := array_append(v_errors, 'SCHOOL_TERM_MISMATCH');
      end if;
    end if;

    if v_import_as_free and v_course_id is not null then
      v_errors := array_append(v_errors, 'INVALID_COURSE_MAPPING');
    elsif not v_import_as_free and v_course_id is null then
      v_errors := array_append(v_errors, 'MISSING_COURSE_MAPPING');
    elsif v_course_id is not null then
      select course_row.* into v_course_row
        from public.courses course_row
        join public.course_families family_row on family_row.id = course_row.family_id
       where course_row.id = v_course_id
         and course_row.status = 'enabled' and course_row.trashed_at is null
         and course_row.purpose = 'production'
         and family_row.status = 'enabled' and family_row.purpose = 'production';
      if not found then
        v_errors := array_append(v_errors, 'COURSE_NOT_AVAILABLE');
      else
        if v_grade is not null and v_course_row.grade <> v_grade then
          v_errors := array_append(v_errors, 'COURSE_GRADE_MISMATCH');
        end if;
        if v_course_row.term is not null and v_season is not null and v_course_row.term <> v_season then
          v_errors := array_append(v_errors, 'COURSE_SEASON_MISMATCH');
        end if;
      end if;
    end if;

    if v_room_id is not null and not exists (
      select 1 from public.campus_rooms room_row
      join public.campuses campus_row on campus_row.id = room_row.campus_id
      where room_row.id = v_room_id and room_row.status = 'active' and campus_row.status = 'active'
    ) then
      v_errors := array_append(v_errors, 'INVALID_ROOM');
    end if;

    v_external_key := left(public.normalize_mofaxiao_class_text(v_external_id), 100);
    v_name_key := left(public.normalize_mofaxiao_class_text(v_name), 100);

    if cardinality(v_errors) = 0 then
      select prior.target_id into v_target_id
        from public.data_import_rows prior
       where prior.batch_id = v_batch_id
         and prior.normalized_key = 'mofaxiao:class:id:' || v_external_key
         and prior.row_status <> 'error'
       order by prior.row_no limit 1;
      if found then
        v_match_kind := 'same_batch';
        v_errors := array_append(v_errors, 'DUPLICATE_SAME_BATCH');
      else
        select prior.target_id into v_target_id
          from public.data_import_rows prior
          join public.data_import_batches prior_batch on prior_batch.id = prior.batch_id
         where prior_batch.import_kind = 'classes'
           and prior_batch.template_version = 'mofaxiao-classes-v1'
           and prior_batch.source_system = 'mofaxiao'
           and prior.normalized_key = 'mofaxiao:class:id:' || v_external_key
           and prior.target_id is not null
           and prior.row_status in ('inserted', 'duplicate')
         order by prior.created_at limit 1;
        if found then
          v_match_kind := 'source_id';
          v_errors := array_append(v_errors, 'DUPLICATE_SOURCE_ID');
        elsif v_teacher_id is not null and v_school_term_id is not null then
          select classroom.id into v_target_id
            from public.classrooms classroom
           where classroom.trashed_at is null
             and classroom.owner_id = v_teacher_id
             and classroom.term_id = v_school_term_id
             and classroom.course_id is not distinct from v_course_id
             and classroom.default_room_id is not distinct from v_room_id
             and public.normalize_mofaxiao_class_text(classroom.name) = v_name_key
           order by classroom.created_at limit 1;
          if found then
            v_match_kind := 'existing_class';
            v_errors := array_append(v_errors, 'DUPLICATE_EXISTING_CLASS');
          end if;
        end if;
      end if;
    end if;

    if cardinality(v_errors) > 0 and not (
      'DUPLICATE_SAME_BATCH' = any(v_errors)
      or 'DUPLICATE_SOURCE_ID' = any(v_errors)
      or 'DUPLICATE_EXISTING_CLASS' = any(v_errors)
    ) then
      v_status := 'error';
      v_error := v_error + 1;
    elsif v_match_kind <> 'new' then
      v_status := 'duplicate';
      v_duplicate := v_duplicate + 1;
    else
      v_status := 'valid';
      v_valid := v_valid + 1;
    end if;

    insert into public.data_import_rows(batch_id, row_no, row_status, normalized_key, payload, error_codes, target_id)
    values (
      v_batch_id, v_row_no, v_status,
      'mofaxiao:class:id:' || case when v_external_key = '' then 'row-' || v_row_no::text else v_external_key end,
      jsonb_build_object(
        'sourceRow', v_source_row,
        'externalClassId', left(v_external_id, 100),
        'name', left(v_name, 100),
        'teachingMode', left(v_teaching_mode, 40),
        'courseName', left(v_course_name, 160),
        'courseType', left(v_course_type, 40),
        'progressText', left(v_progress_text, 40),
        'subject', left(v_subject, 40),
        'grade', v_grade,
        'gradeText', left(v_grade_text, 40),
        'season', v_season,
        'seasonText', left(v_season_text, 40),
        'classType', left(v_class_type, 40),
        'assessmentDifficulty', left(v_assessment_difficulty, 40),
        'teacherName', left(v_teacher_name, 100),
        'campusName', left(v_campus_name, 100),
        'roomName', left(v_room_name, 100),
        'feeText', left(v_fee_text, 80),
        'currentStudentCount', v_current_student_count,
        'enrolledCount', v_enrolled_count,
        'capacity', v_capacity,
        'sourceStatus', left(v_source_status, 40),
        'startDate', nullif(v_start_date, ''),
        'startDateText', left(v_start_date_text, 40),
        'endDate', nullif(v_end_date, ''),
        'endDateText', left(v_end_date_text, 40),
        'sessionTime', left(v_session_time, 40),
        'purchasedText', left(v_purchased_text, 40),
        'courseId', v_course_id,
        'importAsFreeClass', v_import_as_free,
        'primaryTeacherId', v_teacher_id,
        'roomId', v_room_id,
        'schoolTermId', v_school_term_id
      ),
      v_errors,
      v_target_id
    );
  end loop;

  update public.data_import_batches
     set valid_rows = v_valid, duplicate_rows = v_duplicate, error_rows = v_error
   where id = v_batch_id;

  perform public.emit_domain_event(
    'class_import.validated', 'data_import_batch', v_batch_id,
    jsonb_build_object(
      'kind', 'classes', 'sourceSystem', 'mofaxiao', 'inputHash', p_input_hash,
      'fileHash', p_file_hash, 'total', jsonb_array_length(p_rows),
      'valid', v_valid, 'duplicates', v_duplicate, 'errors', v_error,
      'createsSessions', false, 'createsEnrollments', false
    ), v_uid, null
  );
  return public.get_mofaxiao_class_import_batch(v_batch_id);
end
$$;

create or replace function public.apply_mofaxiao_class_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_row public.data_import_rows%rowtype;
  v_target_id uuid;
  v_source_key text;
  v_name_key text;
  v_course_id uuid;
  v_teacher_id uuid;
  v_room_id uuid;
  v_school_term_id uuid;
  v_grade smallint;
  v_capacity smallint;
  v_offering_type text;
  v_effective_end_date date;
  v_target_operational_status text;
  v_duplicate_code text;
  v_inserted integer := 0;
  v_valid integer;
  v_duplicate integer;
begin
  if v_uid is null or not public.has_perm(v_uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null
     or v_batch.import_kind <> 'classes'
     or v_batch.template_version <> 'mofaxiao-classes-v1'
     or v_batch.source_system is distinct from 'mofaxiao' then
    raise exception 'BATCH_KIND_MISMATCH';
  end if;
  if v_batch.created_by <> v_uid and not public.is_admin(v_uid) then raise exception 'FORBIDDEN'; end if;
  if v_batch.status = 'completed' then return public.get_mofaxiao_class_import_batch(v_batch.id); end if;
  if v_batch.expires_at <= now() then raise exception 'BATCH_EXPIRED'; end if;
  if v_batch.error_rows > 0 then raise exception 'BATCH_HAS_ERRORS'; end if;

  -- Serialise class-import applies so two files cannot create the same source
  -- class (or the same teacher/term/name shell) between lookup and insert.
  perform pg_advisory_xact_lock(hashtext('mofaxiao-class-import:apply'));

  for v_row in
    select * from public.data_import_rows
     where batch_id = v_batch.id and row_status = 'valid'
     order by row_no
     for update
  loop
    v_target_id := null;
    v_duplicate_code := null;
    v_source_key := v_row.normalized_key;
    v_name_key := public.normalize_mofaxiao_class_text(v_row.payload->>'name');
    v_course_id := nullif(v_row.payload->>'courseId', '')::uuid;
    v_teacher_id := nullif(v_row.payload->>'primaryTeacherId', '')::uuid;
    v_room_id := nullif(v_row.payload->>'roomId', '')::uuid;
    v_school_term_id := nullif(v_row.payload->>'schoolTermId', '')::uuid;
    v_grade := nullif(v_row.payload->>'grade', '')::smallint;
    v_capacity := nullif(v_row.payload->>'capacity', '')::smallint;
    v_offering_type := case v_row.payload->>'courseType'
      when '长期班' then 'long_term_formal'
      when '短期班' then 'short_term_topic'
      else null
    end;
    v_effective_end_date := null;
    select term_row.ends_on into v_effective_end_date
      from public.school_terms term_row
     where term_row.id = v_school_term_id;
    v_effective_end_date := coalesce(nullif(v_row.payload->>'endDate', '')::date, v_effective_end_date);
    v_target_operational_status := case
      when v_row.payload->>'sourceStatus' is distinct from '开课中' then 'planning'
      when v_effective_end_date is not null and v_effective_end_date < current_date then 'completed'
      else 'active'
    end;

    select prior.target_id into v_target_id
      from public.data_import_rows prior
      join public.data_import_batches prior_batch on prior_batch.id = prior.batch_id
     where prior.batch_id <> v_batch.id
       and prior_batch.import_kind = 'classes'
       and prior_batch.template_version = 'mofaxiao-classes-v1'
       and prior_batch.source_system = 'mofaxiao'
       and prior.normalized_key = v_source_key
       and prior.target_id is not null
       and prior.row_status in ('inserted', 'duplicate')
     order by prior.created_at limit 1;

    if found then
      v_duplicate_code := 'DUPLICATE_SOURCE_ID';
    end if;

    if v_target_id is null then
      select classroom.id into v_target_id
        from public.classrooms classroom
       where classroom.trashed_at is null
         and classroom.owner_id = v_teacher_id
         and classroom.term_id = v_school_term_id
         and classroom.course_id is not distinct from v_course_id
         and classroom.default_room_id is not distinct from v_room_id
         and public.normalize_mofaxiao_class_text(classroom.name) = v_name_key
       order by classroom.created_at limit 1;
      if found then
        v_duplicate_code := 'DUPLICATE_EXISTING_CLASS';
      end if;
    end if;

    if v_target_id is not null then
      update public.data_import_rows
         set row_status = 'duplicate', target_id = v_target_id,
             error_codes = case
               when cardinality(error_codes) = 0 then array[v_duplicate_code]::text[]
               else error_codes
             end
       where batch_id = v_batch.id and row_no = v_row.row_no;
    else
      v_target_id := public.create_class_v2(
        p_name => v_row.payload->>'name',
        p_course_id => v_course_id,
        p_capacity => v_capacity,
        p_room_id => v_room_id,
        p_primary_teacher_id => v_teacher_id,
        p_learning_support_id => null,
        p_term_id => v_school_term_id,
        p_purpose => 'production',
        p_sessions => '[]'::jsonb,
        p_activate => v_target_operational_status = 'active',
        p_offering_type => v_offering_type
      );

      if v_course_id is null and v_grade is not null then
        update public.classrooms set grade = v_grade where id = v_target_id;
      end if;
      if v_target_operational_status = 'completed' then
        update public.classrooms set operational_status = 'completed' where id = v_target_id;
        perform public.emit_domain_event(
          'classroom.lifecycle.transition', 'classroom', v_target_id,
          jsonb_build_object(
            'from', 'planning', 'to', 'completed', 'source', 'mofaxiao_class_import',
            'sourceStatus', v_row.payload->>'sourceStatus', 'effectiveEndDate', v_effective_end_date
          ), v_uid, null
        );
      end if;

      update public.data_import_rows
         set row_status = 'inserted', target_id = v_target_id
       where batch_id = v_batch.id and row_no = v_row.row_no;
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  -- Same-file repeats are skipped during creation.  Once the canonical row has
  -- a target, keep the skipped row linked to that target for a complete audit.
  update public.data_import_rows repeated
     set target_id = (
       select canonical.target_id
         from public.data_import_rows canonical
        where canonical.batch_id = repeated.batch_id
          and canonical.normalized_key = repeated.normalized_key
          and canonical.target_id is not null
        order by canonical.row_no
        limit 1
     )
   where repeated.batch_id = v_batch.id
     and repeated.row_status = 'duplicate'
     and repeated.target_id is null
     and 'DUPLICATE_SAME_BATCH' = any(repeated.error_codes);

  select count(*) filter (where row_status in ('valid', 'inserted')),
         count(*) filter (where row_status = 'duplicate')
    into v_valid, v_duplicate
    from public.data_import_rows where batch_id = v_batch.id;

  update public.data_import_batches
     set status = 'completed', valid_rows = v_valid, duplicate_rows = v_duplicate,
         inserted_rows = v_inserted, completed_at = now()
   where id = v_batch.id;
  update public.data_import_rows set payload = null where batch_id = v_batch.id;

  perform public.emit_domain_event(
    'class_import.completed', 'data_import_batch', v_batch.id,
    jsonb_build_object(
      'kind', 'classes', 'sourceSystem', 'mofaxiao',
      'inputHash', v_batch.input_hash, 'fileHash', v_batch.source_file_hash,
      'inserted', v_inserted, 'duplicates', v_duplicate,
      'createsSessions', false, 'createsEnrollments', false
    ), v_uid, null
  );
  return public.get_mofaxiao_class_import_batch(v_batch.id);
end
$$;

revoke all on function public.normalize_mofaxiao_class_text(text) from public, anon, authenticated;
revoke all on function public.get_mofaxiao_class_import_batch(uuid) from public, anon, authenticated;
revoke all on function public.preview_mofaxiao_class_import(text, jsonb, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_mofaxiao_class_import(uuid) from public, anon, authenticated;
grant execute on function public.get_mofaxiao_class_import_batch(uuid) to authenticated;
grant execute on function public.preview_mofaxiao_class_import(text, jsonb, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.apply_mofaxiao_class_import(uuid) to authenticated;
