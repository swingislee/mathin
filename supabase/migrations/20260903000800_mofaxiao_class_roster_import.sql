-- DATA-IMPORT-CLASS-ROSTER-1: import the current Mofaxiao horizontal roster
-- as student profiles (only when explicitly requested) and active enrollment
-- facts. The batch never creates classes, sessions, orders, fees or attendance.

-- ---------------------------------------------------------------------------
-- 1. Shared import ledger: enrollments are a first-class import kind and a
-- user-reviewed source row may be explicitly skipped without pretending that
-- it is an error or duplicate.
-- ---------------------------------------------------------------------------

alter table public.data_import_batches
  drop constraint if exists data_import_batches_import_kind_check;
alter table public.data_import_batches
  add constraint data_import_batches_import_kind_check
  check (import_kind in ('students', 'staff', 'leads', 'classes', 'enrollments'));

alter table public.data_import_batches
  add column if not exists skipped_rows integer not null default 0;
alter table public.data_import_batches
  drop constraint if exists data_import_batches_skipped_rows_check;
alter table public.data_import_batches
  add constraint data_import_batches_skipped_rows_check check (skipped_rows >= 0);
alter table public.data_import_batches
  drop constraint if exists data_import_batches_counts_check;
alter table public.data_import_batches
  add constraint data_import_batches_counts_check
  check (valid_rows + duplicate_rows + error_rows + skipped_rows = total_rows);

alter table public.data_import_rows
  drop constraint if exists data_import_rows_row_status_check;
alter table public.data_import_rows
  add constraint data_import_rows_row_status_check
  check (row_status in ('valid', 'duplicate', 'error', 'inserted', 'skipped'));

-- A roster sheet has no class ID. Preserve the user-confirmed class fingerprint
-- mapping so the next workbook can reuse it, while still revalidating the live
-- target class during every dry run and apply.
create table public.class_roster_source_mappings (
  source_system text not null check (length(trim(source_system)) between 1 and 80),
  source_class_key text not null check (length(source_class_key) between 1 and 200),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  source_label text not null default '' check (length(source_label) <= 500),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_system, source_class_key)
);

create index class_roster_source_mappings_classroom_idx
  on public.class_roster_source_mappings(classroom_id);

alter table public.class_roster_source_mappings enable row level security;
create policy class_roster_source_mappings_select_scope
  on public.class_roster_source_mappings for select to authenticated
  using (
    public.is_admin((select auth.uid()))
    or public.has_perm((select auth.uid()), 'enrollment.manage')
    or public.has_perm((select auth.uid()), 'audit.view')
  );
revoke all on public.class_roster_source_mappings from anon, authenticated;
grant select on public.class_roster_source_mappings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Read one roster import batch.
-- ---------------------------------------------------------------------------

create or replace function public.get_mofaxiao_class_roster_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_rows jsonb;
  v_created_students integer;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id;
  if v_batch.id is null
     or v_batch.import_kind <> 'enrollments'
     or v_batch.template_version <> 'mofaxiao-class-roster-v1' then
    raise exception 'BATCH_NOT_FOUND';
  end if;
  if v_batch.created_by <> v_uid and not public.has_perm(v_uid, 'audit.view') then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'row', item.row_no,
    'sourceRow', coalesce(nullif(item.payload->>'sourceRow', '')::integer, item.row_no),
    'sourceCell', coalesce(item.payload->>'sourceCell', ''),
    'sourceName', coalesce(item.payload->>'rawName', ''),
    'classroomId', nullif(item.payload->>'classroomId', ''),
    'classroomName', coalesce((
      select classroom.name from public.classrooms classroom
       where classroom.id::text = item.payload->>'classroomId'
    ), ''),
    'decision', coalesce(item.payload->>'decision', 'skip'),
    'studentId', nullif(item.payload->>'studentId', ''),
    'status', item.row_status,
    'errors', to_jsonb(item.error_codes),
    'targetId', item.target_id,
    'matchKind', case
      when item.row_status = 'skipped' then 'skipped'
      when 'CREATED_MINIMAL_STUDENT' = any(item.error_codes) then 'created_student'
      when 'ALREADY_ENROLLED' = any(item.error_codes) then 'already_enrolled'
      when 'DUPLICATE_IN_BATCH' = any(item.error_codes) then 'same_batch'
      else 'existing_student'
    end
  ) order by item.row_no), '[]'::jsonb),
  count(*) filter (where 'CREATED_MINIMAL_STUDENT' = any(item.error_codes))::integer
    into v_rows, v_created_students
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
    'skipped', v_batch.skipped_rows,
    'errorCount', v_batch.error_rows,
    'inserted', v_batch.inserted_rows,
    'createdStudents', coalesce(v_created_students, 0),
    'expiresAt', v_batch.expires_at,
    'rows', v_rows
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Dry run. Rows already enrolled are duplicates; a deliberate user skip is
-- retained as skipped; every other unresolved identity or class is an error.
-- ---------------------------------------------------------------------------

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
    v_classroom_name := '';
    v_classroom_capacity := null;
    v_classroom_term_id := null;
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
    end if;

    if v_decision = 'skip' then
      v_normalized_key := left('skip:' || v_source_class_key || ':' || v_source_cell, 320);
    else
      if v_classroom_id is null then
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
        'class:' || coalesce(v_classroom_id::text, 'missing') || ':' ||
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

      if cardinality(v_errors) = 0 and v_student_id is not null then
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
        'decision', v_decision,
        'studentId', v_student_id,
        'sourceNote', left(v_source_note, 500)
      ),
      v_errors,
      v_existing_enrollment_id
    );
  end loop;

  -- Capacity is checked against all valid incoming memberships for each class,
  -- not row-by-row, so a dry run cannot appear safe and then partially fail.
  for v_capacity_row in
    select (item.payload->>'classroomId')::uuid as classroom_id, count(*)::integer as incoming
      from public.data_import_rows item
     where item.batch_id = v_batch_id and item.row_status = 'valid'
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
      'duplicates', v_duplicate, 'skipped', v_skipped, 'errors', v_error
    ), v_uid, null
  );
  return public.get_mofaxiao_class_roster_import_batch(v_batch_id);
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Apply. One transaction creates only explicitly requested minimal student
-- profiles and active enrollments. Exact name + phone is the only automatic
-- identity reuse; a shared family phone never merges different child names.
-- ---------------------------------------------------------------------------

create or replace function public.apply_mofaxiao_class_roster_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_row record;
  v_classroom_id uuid;
  v_classroom public.classrooms%rowtype;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_decision text;
  v_student_name text;
  v_source_phone text;
  v_phone_key text;
  v_grade smallint;
  v_created_students integer := 0;
  v_inserted integer := 0;
  v_duplicate integer;
  v_valid integer;
  v_skipped integer;
  v_error integer;
  v_active_count integer;
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

  -- Keep the class mapping even when every student was already enrolled.
  insert into public.class_roster_source_mappings(
    source_system, source_class_key, classroom_id, source_label,
    created_by, updated_by
  )
  select distinct
    'mofaxiao',
    item.payload->>'sourceClassKey',
    (item.payload->>'classroomId')::uuid,
    coalesce(item.payload->>'sourceClassLabel', ''),
    v_uid, v_uid
  from public.data_import_rows item
  where item.batch_id = v_batch.id
    and item.row_status in ('valid', 'duplicate')
    and coalesce(item.payload->>'sourceClassKey', '') <> ''
    and coalesce(item.payload->>'classroomId', '') <> ''
  on conflict (source_system, source_class_key) do update
    set classroom_id = excluded.classroom_id,
        source_label = excluded.source_label,
        updated_by = excluded.updated_by,
        updated_at = now();

  for v_row in
    select * from public.data_import_rows
     where batch_id = v_batch.id and row_status = 'valid'
     order by row_no
     for update
  loop
    v_classroom_id := (v_row.payload->>'classroomId')::uuid;
    v_decision := v_row.payload->>'decision';
    v_student_id := nullif(v_row.payload->>'studentId', '')::uuid;
    v_student_name := trim(v_row.payload->>'studentName');
    v_source_phone := trim(coalesce(v_row.payload->>'sourcePhone', ''));
    v_phone_key := public.normalize_mofaxiao_phone(v_source_phone);
    v_grade := nullif(v_row.payload->>'grade', '')::smallint;

    perform pg_advisory_xact_lock(hashtext('class-roster:class:' || v_classroom_id::text));
    select * into v_classroom
      from public.classrooms classroom
     where classroom.id = v_classroom_id
       and classroom.archived_at is null
       and classroom.trashed_at is null
       and classroom.operational_status in ('planning', 'active')
       and public.can_manage_classroom(classroom.id, v_uid)
     for update;
    if v_classroom.id is null then raise exception 'INVALID_CLASSROOM'; end if;
    if v_classroom.term_id is null then raise exception 'CLASS_TERM_MISSING'; end if;

    if v_decision = 'create_student' then
      if not public.has_perm(v_uid, 'student.import') then raise exception 'STUDENT_IMPORT_FORBIDDEN'; end if;
      perform pg_advisory_xact_lock(hashtext(
        'class-roster:student:' || public.normalize_mofaxiao_name(v_student_name) || ':' || v_phone_key
      ));
      if v_phone_key <> '' then
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
      end if;
      if v_student_id is null then
        insert into public.students(
          name, phone, grade, source, remark, status,
          assigned_to, created_by, bind_code
        ) values (
          v_student_name,
          v_source_phone,
          v_grade,
          '班级学员导入',
          left('来源：' || coalesce(v_batch.source_file_name, '') || ' · ' ||
            coalesce(v_batch.source_sheet_name, '') || ' · ' ||
            coalesce(v_row.payload->>'sourceCell', ''), 2000),
          'lead', null, v_uid, public.generate_student_bind_code()
        ) returning id into v_student_id;
        v_created_students := v_created_students + 1;
        update public.data_import_rows
           set error_codes = array_append(error_codes, 'CREATED_MINIMAL_STUDENT')
         where batch_id = v_batch.id and row_no = v_row.row_no;
      else
        update public.data_import_rows
           set error_codes = array_append(error_codes, 'MATCHED_EXISTING_STUDENT')
         where batch_id = v_batch.id and row_no = v_row.row_no;
      end if;
    end if;

    if v_student_id is null or not exists (
      select 1 from public.students student where student.id = v_student_id and student.deleted_at is null
    ) then raise exception 'INVALID_STUDENT'; end if;

    select enrollment.id into v_enrollment_id
      from public.enrollments enrollment
     where enrollment.classroom_id = v_classroom_id
       and enrollment.student_id = v_student_id
       and enrollment.status = 'active'
     order by enrollment.created_at
     limit 1;
    if v_enrollment_id is not null then
      update public.data_import_rows
         set row_status = 'duplicate', target_id = v_enrollment_id,
             error_codes = array_append(error_codes, 'ALREADY_ENROLLED')
       where batch_id = v_batch.id and row_no = v_row.row_no;
      continue;
    end if;

    if v_classroom.capacity is not null then
      select count(*)::integer into v_active_count
        from public.enrollments
       where classroom_id = v_classroom_id and status = 'active';
      if v_active_count >= v_classroom.capacity then raise exception 'CLASS_CAPACITY_EXCEEDED'; end if;
    end if;

    insert into public.enrollments(
      classroom_id, student_id, status, joined_at, term_id, remark, operated_by
    ) values (
      v_classroom_id, v_student_id, 'active', now(), v_classroom.term_id,
      left('班级学员导入：' || coalesce(v_batch.source_file_name, '') || ' · ' ||
        coalesce(v_batch.source_sheet_name, '') || ' · ' ||
        coalesce(v_row.payload->>'sourceCell', ''), 2000),
      v_uid
    ) returning id into v_enrollment_id;

    update public.students set status = 'enrolled'
     where id = v_student_id and status in ('lead', 'trialing');
    update public.data_import_rows
       set row_status = 'inserted', target_id = v_enrollment_id,
           payload = jsonb_set(payload, '{studentId}', to_jsonb(v_student_id::text), true)
     where batch_id = v_batch.id and row_no = v_row.row_no;
    v_inserted := v_inserted + 1;
  end loop;

  -- Link a same-batch duplicate to the enrollment produced by its canonical
  -- row, so the completed audit does not retain an unexplained null target.
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
     and 'DUPLICATE_IN_BATCH' = any(repeated.error_codes);

  select count(*) filter (where row_status in ('valid', 'inserted'))::integer,
         count(*) filter (where row_status = 'duplicate')::integer,
         count(*) filter (where row_status = 'skipped')::integer,
         count(*) filter (where row_status = 'error')::integer
    into v_valid, v_duplicate, v_skipped, v_error
    from public.data_import_rows where batch_id = v_batch.id;

  update public.data_import_batches
     set status = 'completed', valid_rows = v_valid, duplicate_rows = v_duplicate,
         skipped_rows = v_skipped, error_rows = v_error, inserted_rows = v_inserted,
         completed_at = now()
   where id = v_batch.id;

  -- Remove names and phone numbers after application while preserving the
  -- source class mapping and source-cell audit coordinates.
  update public.data_import_rows item
     set payload = jsonb_build_object(
       'sourceRow', item.payload->>'sourceRow',
       'sourceCell', item.payload->>'sourceCell',
       'sourceClassKey', item.payload->>'sourceClassKey',
       'sourceClassLabel', item.payload->>'sourceClassLabel',
       'classroomId', item.payload->>'classroomId',
       'decision', item.payload->>'decision',
       'studentId', item.payload->>'studentId'
     )
   where item.batch_id = v_batch.id;

  perform public.emit_domain_event(
    'class_roster_import.completed', 'data_import_batch', v_batch.id,
    jsonb_build_object(
      'kind', 'enrollments', 'sourceSystem', 'mofaxiao',
      'inputHash', v_batch.input_hash, 'inserted', v_inserted,
      'createdStudents', v_created_students, 'duplicates', v_duplicate,
      'skipped', v_skipped
    ), v_uid, null
  );
  return public.get_mofaxiao_class_roster_import_batch(v_batch.id);
end
$$;

revoke all on function public.get_mofaxiao_class_roster_import_batch(uuid) from public, anon, authenticated;
revoke all on function public.preview_mofaxiao_class_roster_import(text, jsonb, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.apply_mofaxiao_class_roster_import(uuid) from public, anon, authenticated;
grant execute on function public.get_mofaxiao_class_roster_import_batch(uuid) to authenticated;
grant execute on function public.preview_mofaxiao_class_roster_import(text, jsonb, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.apply_mofaxiao_class_roster_import(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
