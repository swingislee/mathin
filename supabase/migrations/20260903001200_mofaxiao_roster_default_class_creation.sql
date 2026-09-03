-- DATA-IMPORT-CLASS-ROSTER-3: an unmatched source class is a default-class
-- creation decision, not a batch-wide blocker. Preview remains read-only;
-- apply creates planning classroom shells and enrollments in one transaction.
-- Course, teacher, room, and generated sessions may be completed afterwards.

begin;

create schema if not exists mathin_internal;
revoke all on schema mathin_internal from public, anon, authenticated;

create or replace function mathin_internal.build_mofaxiao_roster_class_name(p_default jsonb)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_system text := regexp_replace(btrim(coalesce(p_default->>'system', '')), '\s+', '', 'g');
  v_grade text := regexp_replace(btrim(coalesce(p_default->>'gradeText', '')), '\s+', '', 'g');
  v_season text := regexp_replace(btrim(coalesce(p_default->>'seasonText', '')), '\s+', '', 'g');
  v_class_type text := regexp_replace(btrim(coalesce(p_default->>'classType', '')), '\s+', '', 'g');
  v_campus text := regexp_replace(btrim(coalesce(p_default->>'campusName', '')), '\s+', '', 'g');
  v_teacher text := regexp_replace(btrim(coalesce(p_default->>'teacherName', '')), '\s+', '', 'g');
  v_weekday text := regexp_replace(btrim(coalesce(p_default->>'weekday', '')), '\s+', '', 'g');
  v_time text := regexp_replace(btrim(coalesce(p_default->>'time', '')), '\s+', '', 'g');
begin
  v_system := regexp_replace(v_system, '体系$', '');
  if v_system = '' then v_system := '待定系列'; end if;
  if public.normalize_mofaxiao_class_text(v_system) like '%贯通%' then v_system := '贯通思维'; end if;
  if public.normalize_mofaxiao_class_text(v_system) like '%培优%' then v_system := '培优思维'; end if;
  if public.normalize_mofaxiao_class_text(v_system) like '%科学%' then v_system := '科学思维'; end if;
  if v_grade = '' then v_grade := '待定年级'; end if;
  if v_season = '' then v_season := '待定季节'; end if;
  if v_class_type = '' then v_class_type := '待定班型'; end if;
  if public.normalize_mofaxiao_class_text(v_campus) like '%紫辰%' then v_campus := '紫辰阁'; end if;
  if v_campus = '' then v_campus := '待定校区'; end if;
  if v_teacher = '' then v_teacher := '待定老师'; end if;
  if v_weekday = '' then v_weekday := '待定星期'; end if;
  if v_time = '' then v_time := '待定时间'; end if;
  return left('【' || v_system || '】' || v_grade || v_season || v_class_type ||
    '｜' || v_campus || v_teacher || v_weekday || v_time, 100);
end
$$;

revoke all on function mathin_internal.build_mofaxiao_roster_class_name(jsonb)
  from public, anon, authenticated;

-- Preserve the already-deployed reader and apply implementation as private
-- bases. The public reader adds a de-identified list of classes created by
-- this batch; the public apply provisions default classes before delegating.
alter function public.get_mofaxiao_class_roster_import_batch(uuid)
  rename to get_mofaxiao_class_roster_import_batch_base;
alter function public.get_mofaxiao_class_roster_import_batch_base(uuid)
  set schema mathin_internal;

alter function public.apply_mofaxiao_class_roster_import(uuid)
  rename to apply_mofaxiao_class_roster_import_base;
alter function public.apply_mofaxiao_class_roster_import_base(uuid)
  set schema mathin_internal;

revoke all on function mathin_internal.get_mofaxiao_class_roster_import_batch_base(uuid)
  from public, anon, authenticated;
revoke all on function mathin_internal.apply_mofaxiao_class_roster_import_base(uuid)
  from public, anon, authenticated;

create or replace function public.get_mofaxiao_class_roster_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_created_classes jsonb;
begin
  v_result := mathin_internal.get_mofaxiao_class_roster_import_batch_base(p_batch_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', created.classroom_id,
    'name', created.classroom_name,
    'sourceClassKey', created.source_class_key,
    'reviewIssues', to_jsonb(created.review_issues)
  ) order by created.classroom_name, created.classroom_id), '[]'::jsonb)
  into v_created_classes
  from (
    select
      nullif(item.payload->>'classroomId', '')::uuid as classroom_id,
      classroom.name as classroom_name,
      item.payload->>'sourceClassKey' as source_class_key,
      array_remove(array[
        case when bool_or('CLASS_NEEDS_COURSE' = any(item.error_codes)) then 'course' end,
        case when bool_or('CLASS_NEEDS_TEACHER' = any(item.error_codes)) then 'teacher' end,
        case when bool_or('CLASS_NEEDS_ROOM' = any(item.error_codes)) then 'room' end,
        case when bool_or('CLASS_NEEDS_SCHEDULE' = any(item.error_codes)) then 'schedule' end
      ], null)::text[] as review_issues
    from public.data_import_rows item
    join public.classrooms classroom
      on classroom.id = nullif(item.payload->>'classroomId', '')::uuid
    where item.batch_id = p_batch_id
      and 'CREATED_DEFAULT_CLASS' = any(item.error_codes)
    group by nullif(item.payload->>'classroomId', '')::uuid,
      classroom.name, item.payload->>'sourceClassKey'
  ) created;
  return v_result || jsonb_build_object('createdClasses', v_created_classes);
end
$$;

-- Preview validates a default-class plan without creating it. Missing course,
-- teacher, room, or generated sessions are follow-up work rather than row
-- errors. A missing campus/operating term remains a hard error because an
-- enrollment must belong to a real operating term.
create or replace function public.preview_mofaxiao_class_roster_import(
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
  v_source_cell text;
  v_source_class_key text;
  v_source_class_label text;
  v_raw_name text;
  v_student_name text;
  v_source_phone text;
  v_phone_key text;
  v_grade smallint;
  v_classroom_id uuid;
  v_classroom_name text;
  v_classroom_capacity smallint;
  v_classroom_term_id uuid;
  v_default_class jsonb;
  v_default_name text;
  v_default_campus_id uuid;
  v_default_match_count integer;
  v_default_year smallint;
  v_default_season smallint;
  v_default_grade smallint;
  v_decision text;
  v_student_id uuid;
  v_source_note text;
  v_errors text[];
  v_status text;
  v_normalized_key text;
  v_existing_enrollment_id uuid;
  v_valid integer := 0;
  v_duplicate integer := 0;
  v_skipped integer := 0;
  v_error integer := 0;
  v_capacity_row record;
  v_active_count integer;
  v_affected integer;
begin
  if v_uid is null or not public.has_perm(v_uid, 'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if p_template_version is distinct from 'mofaxiao-class-roster-v1' then raise exception 'INVALID_TEMPLATE'; end if;
  if p_source_system is distinct from 'mofaxiao' then raise exception 'INVALID_SOURCE_SYSTEM'; end if;
  if length(trim(coalesce(p_idempotency_key, ''))) not between 1 and 200 then raise exception 'INVALID_IDEMPOTENCY'; end if;
  if coalesce(p_input_hash, '') !~ '^[a-f0-9]{64}$' or coalesce(p_file_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_HASH';
  end if;
  if length(trim(coalesce(p_source_file_name, ''))) not between 1 and 255
     or length(trim(coalesce(p_source_sheet_name, ''))) not between 1 and 120
     or length(trim(coalesce(p_batch_label, ''))) not between 1 and 160 then
    raise exception 'INVALID_SOURCE_METADATA';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then
    raise exception 'INVALID_ROWS';
  end if;

  v_fingerprint := md5(concat_ws(':', p_template_version, p_source_system, p_file_hash, p_rows::text));
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':class-roster:' || trim(p_idempotency_key)));
  select * into v_existing
    from public.data_import_batches
   where created_by = v_uid and import_kind = 'enrollments' and idempotency_key = trim(p_idempotency_key);
  if v_existing.id is not null then
    if v_existing.input_fingerprint <> v_fingerprint or v_existing.input_hash <> p_input_hash
       or v_existing.template_version <> p_template_version then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return public.get_mofaxiao_class_roster_import_batch(v_existing.id);
  end if;

  insert into public.data_import_batches(
    import_kind, template_version, idempotency_key, input_hash, input_fingerprint,
    total_rows, valid_rows, duplicate_rows, skipped_rows, error_rows, created_by,
    source_system, source_file_name, source_file_hash, source_sheet_name, batch_label
  ) values (
    'enrollments', p_template_version, trim(p_idempotency_key), p_input_hash, v_fingerprint,
    jsonb_array_length(p_rows), 0, 0, 0, jsonb_array_length(p_rows), v_uid,
    p_source_system, trim(p_source_file_name), p_file_hash, trim(p_source_sheet_name), trim(p_batch_label)
  ) returning id into v_batch_id;

  for v_item, v_row_no in
    select value, ordinality::integer from jsonb_array_elements(p_rows) with ordinality
  loop
    v_errors := '{}';
    v_existing_enrollment_id := null;
    v_classroom_id := null;
    v_student_id := null;
    v_grade := null;
    v_classroom_name := null;
    v_classroom_capacity := null;
    v_classroom_term_id := null;
    v_default_class := null;
    if jsonb_typeof(v_item) is distinct from 'object' then
      v_source_row := v_row_no;
      v_source_cell := '';
      v_source_class_key := 'row-' || v_row_no::text;
      v_source_class_label := '';
      v_raw_name := '';
      v_student_name := '';
      v_source_phone := '';
      v_phone_key := '';
      v_decision := 'skip';
      v_source_note := '';
      v_errors := array_append(v_errors, 'MALFORMED_ROW');
    else
      v_source_row := coalesce(nullif(v_item->>'sourceRow', '')::integer, v_row_no);
      v_source_cell := trim(coalesce(v_item->>'sourceCell', ''));
      v_source_class_key := trim(coalesce(v_item->>'sourceClassKey', ''));
      v_source_class_label := trim(coalesce(v_item->>'sourceClassLabel', ''));
      v_raw_name := trim(coalesce(v_item->>'rawName', ''));
      v_student_name := trim(coalesce(v_item->>'studentName', ''));
      v_source_phone := trim(coalesce(v_item->>'sourcePhone', ''));
      v_phone_key := public.normalize_mofaxiao_phone(v_source_phone);
      v_grade := nullif(v_item->>'grade', '')::smallint;
      v_classroom_id := nullif(v_item->>'classroomId', '')::uuid;
      v_default_class := v_item->'defaultClass';
      if v_default_class = 'null'::jsonb then v_default_class := null; end if;
      v_decision := trim(coalesce(v_item->>'decision', ''));
      v_student_id := nullif(v_item->>'studentId', '')::uuid;
      v_source_note := trim(coalesce(v_item->>'sourceNote', ''));

      if v_source_row not between 1 and 100000 or v_source_cell = '' or length(v_source_cell) > 20
         or v_source_class_key = '' or length(v_source_class_key) > 200
         or v_source_class_label = '' or length(v_source_class_label) > 500
         or v_raw_name = '' or length(v_raw_name) > 500
         or v_student_name = '' or length(v_student_name) > 100
         or length(v_source_phone) > 40 or length(v_source_note) > 500 then
        v_errors := array_append(v_errors, 'MALFORMED_ROW');
      end if;
      if v_phone_key <> '' and v_phone_key !~ '^[0-9]{6,20}$' then v_errors := array_append(v_errors, 'INVALID_PHONE'); end if;
      if v_grade is not null and v_grade not between 1 and 12 then v_errors := array_append(v_errors, 'INVALID_GRADE'); end if;
      if v_decision not in ('link_existing', 'create_student', 'skip') then
        v_errors := array_append(v_errors, 'MALFORMED_ROW');
      end if;
      if v_classroom_id is not null and v_default_class is not null then
        v_errors := array_append(v_errors, 'INVALID_DEFAULT_CLASS');
        v_default_class := null;
      end if;
    end if;

    -- A mapping may have been created after the browser loaded its options.
    if v_classroom_id is null and jsonb_typeof(v_default_class) = 'object' then
      select mapping.classroom_id into v_classroom_id
        from public.class_roster_source_mappings mapping
        join public.classrooms classroom on classroom.id = mapping.classroom_id
       where mapping.source_system = 'mofaxiao'
         and mapping.source_class_key = v_source_class_key
         and classroom.archived_at is null
         and classroom.trashed_at is null
         and classroom.operational_status in ('planning', 'active')
         and public.can_manage_classroom(classroom.id, v_uid);
      if v_classroom_id is not null then v_default_class := null; end if;
    end if;

    if v_decision = 'skip' then
      v_normalized_key := left('skip:' || v_source_class_key || ':' || v_source_cell, 320);
    else
      if v_classroom_id is null and jsonb_typeof(v_default_class) = 'object' then
        if not public.has_perm(v_uid, 'class.create') then
          v_errors := array_append(v_errors, 'CLASS_CREATION_FORBIDDEN');
        end if;
        v_default_name := mathin_internal.build_mofaxiao_roster_class_name(v_default_class);
        v_default_class := jsonb_set(v_default_class, '{name}', to_jsonb(v_default_name), true);
        if length(v_default_name) not between 1 and 100
           or length(trim(coalesce(v_default_class->>'system', ''))) not between 1 and 100
           or length(trim(coalesce(v_default_class->>'seasonText', ''))) not between 1 and 40
           or length(trim(coalesce(v_default_class->>'gradeText', ''))) not between 1 and 40
           or length(trim(coalesce(v_default_class->>'classType', ''))) not between 1 and 40
           or length(trim(coalesce(v_default_class->>'campusName', ''))) not between 1 and 100
           or length(coalesce(v_default_class->>'roomName', '')) > 100
           or length(coalesce(v_default_class->>'teacherName', '')) > 100
           or length(coalesce(v_default_class->>'weekday', '')) > 40
           or length(coalesce(v_default_class->>'time', '')) > 80
           or coalesce(v_default_class->>'schoolYear', '') !~ '^[0-9]{4}$'
           or coalesce(v_default_class->>'season', '') !~ '^[1-4]$'
           or (v_default_class->>'grade') is not null
             and coalesce(v_default_class->>'grade', '') !~ '^[0-9]{1,2}$' then
          v_errors := array_append(v_errors, 'INVALID_DEFAULT_CLASS');
        else
          v_default_year := (v_default_class->>'schoolYear')::smallint;
          v_default_season := (v_default_class->>'season')::smallint;
          v_default_grade := nullif(v_default_class->>'grade', '')::smallint;
          if v_default_year not between 2000 and 2200
             or v_default_grade is not null and v_default_grade not between 1 and 12 then
            v_errors := array_append(v_errors, 'INVALID_DEFAULT_CLASS');
          else
            select count(*), min(campus.id::text)::uuid
              into v_default_match_count, v_default_campus_id
              from public.campuses campus
             where campus.status = 'active'
               and public.normalize_mofaxiao_class_text(campus.name) =
                 case
                   when public.normalize_mofaxiao_class_text(v_default_class->>'campusName') like '%紫辰%' then
                     public.normalize_mofaxiao_class_text('紫辰阁')
                   else public.normalize_mofaxiao_class_text(v_default_class->>'campusName')
                 end;
            if v_default_match_count <> 1 then
              v_errors := array_append(v_errors, 'CLASS_TERM_NOT_FOUND');
            else
              select term.id into v_classroom_term_id
                from public.school_terms term
               where term.campus_id = v_default_campus_id
                 and term.year = v_default_year
                 and term.term = v_default_season;
              if v_classroom_term_id is null then
                v_errors := array_append(v_errors, 'CLASS_TERM_NOT_FOUND');
              end if;
            end if;
            v_classroom_name := v_default_name;
          end if;
        end if;
      elsif v_classroom_id is null then
        v_errors := array_append(v_errors, 'MISSING_CLASSROOM_MAPPING');
      else
        select classroom.name, classroom.capacity, classroom.term_id
          into v_classroom_name, v_classroom_capacity, v_classroom_term_id
          from public.classrooms classroom
         where classroom.id = v_classroom_id
           and classroom.archived_at is null
           and classroom.trashed_at is null
           and classroom.operational_status in ('planning', 'active')
           and public.can_manage_classroom(classroom.id, v_uid);
        if v_classroom_name is null then v_errors := array_append(v_errors, 'INVALID_CLASSROOM'); end if;
        if v_classroom_name is not null and v_classroom_term_id is null then v_errors := array_append(v_errors, 'CLASS_TERM_MISSING'); end if;
      end if;

      if v_decision = 'link_existing' then
        if v_student_id is null then
          v_errors := array_append(v_errors, 'MISSING_STUDENT_MAPPING');
        elsif not exists (
          select 1 from public.students student
           where student.id = v_student_id and student.deleted_at is null
        ) then
          v_errors := array_append(v_errors, 'INVALID_STUDENT');
        end if;
      elsif v_decision = 'create_student' then
        if not public.has_perm(v_uid, 'student.import') then
          v_errors := array_append(v_errors, 'STUDENT_IMPORT_FORBIDDEN');
        elsif v_phone_key <> '' then
          select student.id into v_student_id
            from public.students student
           where student.deleted_at is null
             and public.normalize_mofaxiao_name(student.name) = public.normalize_mofaxiao_name(v_student_name)
             and (
               public.normalize_mofaxiao_phone(student.phone) = v_phone_key
               or public.normalize_mofaxiao_phone(student.parent_phone) = v_phone_key
             )
           order by student.created_at
           limit 1;
          if v_student_id is not null then v_decision := 'link_existing'; end if;
        end if;
      end if;

      v_normalized_key := left(
        'class:' || coalesce(v_classroom_id::text, 'source:' || v_source_class_key) || ':' ||
        case when v_student_id is not null then 'student:' || v_student_id::text
          else 'new:' || public.normalize_mofaxiao_name(v_student_name) || ':' || v_phone_key end,
        320
      );

      if cardinality(v_errors) = 0 and exists (
        select 1 from public.data_import_rows prior
         where prior.batch_id = v_batch_id
           and prior.normalized_key = v_normalized_key
           and prior.row_status not in ('error', 'skipped')
      ) then
        v_errors := array_append(v_errors, 'DUPLICATE_IN_BATCH');
      end if;

      if cardinality(v_errors) = 0 and v_student_id is not null and v_classroom_id is not null then
        select enrollment.id into v_existing_enrollment_id
          from public.enrollments enrollment
         where enrollment.classroom_id = v_classroom_id
           and enrollment.student_id = v_student_id
           and enrollment.status = 'active'
         order by enrollment.created_at
         limit 1;
        if v_existing_enrollment_id is not null then v_errors := array_append(v_errors, 'ALREADY_ENROLLED'); end if;
      end if;
    end if;

    if cardinality(v_errors) > 0
       and v_errors <@ array['DUPLICATE_IN_BATCH', 'ALREADY_ENROLLED']::text[] then
      v_status := 'duplicate';
      v_duplicate := v_duplicate + 1;
    elsif cardinality(v_errors) > 0 then
      v_status := 'error';
      v_error := v_error + 1;
    elsif v_decision = 'skip' then
      v_status := 'skipped';
      v_skipped := v_skipped + 1;
    else
      v_status := 'valid';
      v_valid := v_valid + 1;
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
        'sourceCell', left(v_source_cell, 20),
        'sourceClassKey', left(v_source_class_key, 200),
        'sourceClassLabel', left(v_source_class_label, 500),
        'rawName', left(v_raw_name, 500),
        'studentName', left(v_student_name, 100),
        'sourcePhone', left(v_source_phone, 40),
        'grade', v_grade,
        'classroomId', v_classroom_id,
        'defaultClass', v_default_class,
        'decision', v_decision,
        'studentId', v_student_id,
        'sourceNote', left(v_source_note, 500)
      ),
      v_errors,
      v_existing_enrollment_id
    );
  end loop;

  for v_capacity_row in
    select (item.payload->>'classroomId')::uuid as classroom_id, count(*)::integer as incoming
      from public.data_import_rows item
     where item.batch_id = v_batch_id and item.row_status = 'valid'
       and nullif(item.payload->>'classroomId', '') is not null
     group by (item.payload->>'classroomId')::uuid
  loop
    select capacity into v_classroom_capacity from public.classrooms where id = v_capacity_row.classroom_id;
    if v_classroom_capacity is not null then
      select count(*)::integer into v_active_count
        from public.enrollments
       where classroom_id = v_capacity_row.classroom_id and status = 'active';
      if v_active_count + v_capacity_row.incoming > v_classroom_capacity then
        update public.data_import_rows
           set row_status = 'error', error_codes = array_append(error_codes, 'CLASS_CAPACITY_EXCEEDED')
         where batch_id = v_batch_id and row_status = 'valid'
           and payload->>'classroomId' = v_capacity_row.classroom_id::text;
        get diagnostics v_affected = row_count;
        v_valid := v_valid - v_affected;
        v_error := v_error + v_affected;
      end if;
    end if;
  end loop;

  update public.data_import_batches
     set valid_rows = v_valid,
         duplicate_rows = v_duplicate,
         skipped_rows = v_skipped,
         error_rows = v_error
   where id = v_batch_id;

  perform public.emit_domain_event(
    'class_roster_import.validated', 'data_import_batch', v_batch_id,
    jsonb_build_object(
      'kind', 'enrollments', 'sourceSystem', 'mofaxiao', 'inputHash', p_input_hash,
      'total', jsonb_array_length(p_rows), 'valid', v_valid,
      'duplicates', v_duplicate, 'skipped', v_skipped, 'errors', v_error,
      'defaultClasses', (
        select count(distinct item.payload->>'sourceClassKey')
          from public.data_import_rows item
         where item.batch_id = v_batch_id and jsonb_typeof(item.payload->'defaultClass') = 'object'
      )
    ), v_uid, null
  );
  return public.get_mofaxiao_class_roster_import_batch(v_batch_id);
end
$$;

create or replace function public.apply_mofaxiao_class_roster_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_source record;
  v_source_key text;
  v_default jsonb;
  v_classroom_id uuid;
  v_class_name text;
  v_campus_id uuid;
  v_term_id uuid;
  v_teacher_id uuid;
  v_course_id uuid;
  v_room_id uuid;
  v_match_count integer;
  v_system_key text;
  v_class_type text;
  v_grade smallint;
  v_school_year smallint;
  v_season smallint;
  v_review_codes text[];
  v_created boolean;
  v_created_count integer := 0;
  v_result jsonb;
begin
  if v_uid is null or not public.has_perm(v_uid, 'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null
     or v_batch.import_kind <> 'enrollments'
     or v_batch.template_version <> 'mofaxiao-class-roster-v1'
     or v_batch.source_system is distinct from 'mofaxiao' then
    raise exception 'BATCH_NOT_FOUND';
  end if;
  if v_batch.created_by <> v_uid and not public.is_admin(v_uid) then raise exception 'FORBIDDEN'; end if;
  if v_batch.status = 'completed' then return public.get_mofaxiao_class_roster_import_batch(v_batch.id); end if;
  if v_batch.expires_at <= now() then raise exception 'BATCH_EXPIRED'; end if;
  if v_batch.error_rows > 0 then raise exception 'BATCH_HAS_ERRORS'; end if;
  if exists (
    select 1 from public.data_import_rows item
     where item.batch_id = v_batch.id and item.row_status = 'valid'
       and jsonb_typeof(item.payload->'defaultClass') = 'object'
  ) and not public.has_perm(v_uid, 'class.create') then
    raise exception 'CLASS_CREATION_FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtext('mofaxiao-class-roster:default-classes'));

  for v_source in
    select distinct on (item.payload->>'sourceClassKey') item.payload
      from public.data_import_rows item
     where item.batch_id = v_batch.id and item.row_status = 'valid'
       and nullif(item.payload->>'classroomId', '') is null
       and jsonb_typeof(item.payload->'defaultClass') = 'object'
     order by item.payload->>'sourceClassKey', item.row_no
  loop
    v_source_key := v_source.payload->>'sourceClassKey';
    v_default := v_source.payload->'defaultClass';
    v_class_name := mathin_internal.build_mofaxiao_roster_class_name(v_default);
    v_classroom_id := null;
    v_campus_id := null;
    v_term_id := null;
    v_teacher_id := null;
    v_course_id := null;
    v_room_id := null;
    v_created := false;
    v_review_codes := array['CLASS_NEEDS_SCHEDULE']::text[];
    v_grade := nullif(v_default->>'grade', '')::smallint;
    v_school_year := (v_default->>'schoolYear')::smallint;
    v_season := (v_default->>'season')::smallint;
    v_system_key := public.normalize_mofaxiao_class_text(v_default->>'system');
    v_class_type := upper(btrim(v_default->>'classType'));

    select mapping.classroom_id into v_classroom_id
      from public.class_roster_source_mappings mapping
      join public.classrooms classroom on classroom.id = mapping.classroom_id
     where mapping.source_system = 'mofaxiao'
       and mapping.source_class_key = v_source_key
       and classroom.archived_at is null
       and classroom.trashed_at is null
       and classroom.operational_status in ('planning', 'active')
       and classroom.term_id is not null
       and public.can_manage_classroom(classroom.id, v_uid);

    if v_classroom_id is null then
      select count(*), min(campus.id::text)::uuid
        into v_match_count, v_campus_id
        from public.campuses campus
       where campus.status = 'active'
         and public.normalize_mofaxiao_class_text(campus.name) =
           case
             when public.normalize_mofaxiao_class_text(v_default->>'campusName') like '%紫辰%' then
               public.normalize_mofaxiao_class_text('紫辰阁')
             else public.normalize_mofaxiao_class_text(v_default->>'campusName')
           end;
      if v_match_count <> 1 then raise exception 'CLASS_TERM_NOT_FOUND'; end if;

      select term.id into v_term_id
        from public.school_terms term
       where term.campus_id = v_campus_id and term.year = v_school_year and term.term = v_season;
      if v_term_id is null then raise exception 'CLASS_TERM_NOT_FOUND'; end if;

      select count(*), min(classroom.id::text)::uuid
        into v_match_count, v_classroom_id
        from public.classrooms classroom
       where classroom.archived_at is null
         and classroom.trashed_at is null
         and classroom.operational_status in ('planning', 'active')
         and classroom.term_id = v_term_id
         and (v_grade is null or classroom.grade is null or classroom.grade = v_grade)
         and public.normalize_mofaxiao_class_text(classroom.name) =
           public.normalize_mofaxiao_class_text(v_class_name)
         and public.can_manage_classroom(classroom.id, v_uid);
      if v_match_count <> 1 then v_classroom_id := null; end if;
    end if;

    if v_classroom_id is null then
      select count(*), min(profile.id::text)::uuid
        into v_match_count, v_teacher_id
        from public.profiles profile
       where profile.is_active and profile.role in ('staff', 'admin')
         and public.normalize_mofaxiao_class_text(profile.display_name) =
           public.normalize_mofaxiao_class_text(v_default->>'teacherName');
      if v_match_count <> 1 then
        v_teacher_id := v_uid;
        v_review_codes := array_append(v_review_codes, 'CLASS_NEEDS_TEACHER');
      end if;

      if v_system_key like '%贯通%' then
        select count(*), min(course.id::text)::uuid
          into v_match_count, v_course_id
          from public.courses course
          join public.course_families family on family.id = course.family_id
          join public.course_catalog_versions version on version.id = course.catalog_version_id
         where family.slug = 'aixuexi-primary-math'
           and family.status = 'enabled' and family.purpose = 'production'
           and version.is_current
           and course.status = 'enabled' and course.trashed_at is null and course.purpose = 'production'
           and course.grade = v_grade and course.term = v_season
           and upper(btrim(course.class_type)) = v_class_type
           and v_class_type in ('G+', 'A+');
      elsif v_system_key like '%培优%' or v_system_key like '%科学%' then
        select count(*), min(course.id::text)::uuid
          into v_match_count, v_course_id
          from public.courses course
          join public.course_families family on family.id = course.family_id
          join public.course_catalog_versions version on version.id = course.catalog_version_id
         where family.slug = 'xueersi-e-primary-math-cn'
           and family.status = 'enabled' and family.purpose = 'production'
           and version.is_current
           and course.status = 'enabled' and course.trashed_at is null and course.purpose = 'production'
           and course.grade = v_grade and course.term = v_season
           and upper(btrim(course.class_type)) = v_class_type;
      else
        v_match_count := 0;
      end if;
      if v_match_count <> 1 then
        v_course_id := null;
        v_review_codes := array_append(v_review_codes, 'CLASS_NEEDS_COURSE');
      end if;

      select count(*), min(room.id::text)::uuid
        into v_match_count, v_room_id
        from public.campus_rooms room
       where room.campus_id = v_campus_id and room.status = 'active'
         and public.normalize_mofaxiao_class_text(room.name) =
           public.normalize_mofaxiao_class_text(v_default->>'roomName');
      if v_match_count <> 1 then
        v_room_id := null;
        v_review_codes := array_append(v_review_codes, 'CLASS_NEEDS_ROOM');
      end if;

      v_classroom_id := public.create_class_v2(
        p_name => v_class_name,
        p_course_id => v_course_id,
        p_capacity => null,
        p_room_id => v_room_id,
        p_primary_teacher_id => v_teacher_id,
        p_learning_support_id => null,
        p_term_id => v_term_id,
        p_purpose => 'production',
        p_sessions => '[]'::jsonb,
        p_activate => false,
        p_offering_type => 'long_term_formal'
      );
      if v_course_id is null and v_grade is not null then
        update public.classrooms set grade = v_grade where id = v_classroom_id;
      end if;
      v_created := true;
      v_created_count := v_created_count + 1;
      perform public.emit_domain_event(
        'class_roster_import.default_class_created', 'classroom', v_classroom_id,
        jsonb_build_object(
          'batchId', v_batch.id, 'sourceClassKey', v_source_key,
          'name', v_class_name, 'reviewIssues', to_jsonb(v_review_codes)
        ), v_uid, null
      );
    end if;

    update public.data_import_rows item
       set payload = item.payload || jsonb_build_object(
             'classroomId', v_classroom_id,
             'defaultClass', null
           ),
           error_codes = item.error_codes
             || case when v_created then array['CREATED_DEFAULT_CLASS']::text[] else '{}'::text[] end
             || case when v_created then v_review_codes else '{}'::text[] end
     where item.batch_id = v_batch.id
       and item.payload->>'sourceClassKey' = v_source_key;
  end loop;

  v_result := mathin_internal.apply_mofaxiao_class_roster_import_base(v_batch.id);
  if v_created_count > 0 then
    perform public.emit_domain_event(
      'class_roster_import.default_classes_created', 'data_import_batch', v_batch.id,
      jsonb_build_object('createdClasses', v_created_count), v_uid, null
    );
  end if;
  return v_result;
end
$$;

revoke all on function public.get_mofaxiao_class_roster_import_batch(uuid)
  from public, anon, authenticated;
revoke all on function public.preview_mofaxiao_class_roster_import(text, jsonb, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.apply_mofaxiao_class_roster_import(uuid)
  from public, anon, authenticated;
grant execute on function public.get_mofaxiao_class_roster_import_batch(uuid) to authenticated;
grant execute on function public.preview_mofaxiao_class_roster_import(text, jsonb, text, text, text, text, text, text, text)
  to authenticated;
grant execute on function public.apply_mofaxiao_class_roster_import(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
