-- R1-7A: versioned student CSV imports with server-side dry-run, row audit,
-- all-error blocking, and idempotent application.

create table public.data_import_batches (
  id uuid primary key default gen_random_uuid(),
  import_kind text not null check (import_kind in ('students')),
  template_version text not null check (length(template_version) between 1 and 80),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  input_fingerprint text not null check (input_fingerprint ~ '^[a-f0-9]{32}$'),
  status text not null default 'validated' check (status in ('validated','completed')),
  total_rows integer not null check (total_rows between 1 and 500),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  error_rows integer not null default 0 check (error_rows >= 0),
  inserted_rows integer not null default 0 check (inserted_rows >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  constraint data_import_batches_counts_check check (valid_rows + duplicate_rows + error_rows = total_rows),
  constraint data_import_batches_inserted_check check (inserted_rows <= valid_rows),
  constraint data_import_batches_completion_check check (
    (status = 'validated' and completed_at is null and inserted_rows = 0)
    or (status = 'completed' and completed_at is not null)
  ),
  constraint data_import_batches_expiry_check check (expires_at > created_at),
  unique(created_by, import_kind, idempotency_key)
);

create index data_import_batches_creator_idx
  on public.data_import_batches(created_by, created_at desc);
create index data_import_batches_expiry_idx
  on public.data_import_batches(expires_at)
  where status = 'validated';

create table public.data_import_rows (
  batch_id uuid not null references public.data_import_batches(id) on delete cascade,
  row_no integer not null check (row_no between 1 and 500),
  row_status text not null check (row_status in ('valid','duplicate','error','inserted')),
  normalized_key text not null check (length(normalized_key) between 1 and 160),
  payload jsonb,
  error_codes text[] not null default '{}',
  target_id uuid,
  created_at timestamptz not null default now(),
  primary key(batch_id, row_no),
  constraint data_import_rows_error_check check (
    (row_status = 'error' and cardinality(error_codes) > 0)
    or (row_status <> 'error')
  ),
  constraint data_import_rows_inserted_check check (row_status <> 'inserted' or target_id is not null)
);

create index data_import_rows_key_idx on public.data_import_rows(batch_id, normalized_key);

alter table public.data_import_batches enable row level security;
alter table public.data_import_rows enable row level security;

create policy data_import_batches_select_owner_or_audit on public.data_import_batches
  for select to authenticated using (
    created_by = (select auth.uid())
    or public.has_perm((select auth.uid()), 'audit.view')
  );

create policy data_import_rows_select_owner_or_audit on public.data_import_rows
  for select to authenticated using (
    exists (
      select 1 from public.data_import_batches batch
       where batch.id = data_import_rows.batch_id
         and (batch.created_by = (select auth.uid()) or public.has_perm((select auth.uid()), 'audit.view'))
    )
  );

revoke all on public.data_import_batches, public.data_import_rows from anon, authenticated;
grant select on public.data_import_batches, public.data_import_rows to authenticated;

create or replace function public.get_student_import_batch(p_batch_id uuid)
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
  if v_batch.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.created_by <> v_uid and not public.has_perm(v_uid, 'audit.view') then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'row', item.row_no,
    'status', item.row_status,
    'errors', to_jsonb(item.error_codes),
    'targetId', item.target_id
  ) order by item.row_no), '[]'::jsonb)
    into v_rows
    from public.data_import_rows item
   where item.batch_id = v_batch.id;

  return jsonb_build_object(
    'batchId', v_batch.id,
    'status', v_batch.status,
    'templateVersion', v_batch.template_version,
    'inputHash', v_batch.input_hash,
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

create or replace function public.preview_student_import(
  p_template_version text,
  p_rows jsonb,
  p_idempotency_key text,
  p_input_hash text
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
  v_name text;
  v_phone text;
  v_phone_key text;
  v_grade_text text;
  v_grade smallint;
  v_region text;
  v_source text;
  v_remark text;
  v_errors text[];
  v_status text;
  v_target_id uuid;
  v_valid integer := 0;
  v_duplicate integer := 0;
  v_error integer := 0;
begin
  if v_uid is null or not public.has_perm(v_uid, 'student.import') then raise exception 'FORBIDDEN'; end if;
  if p_template_version is distinct from 'mathin-students-v1' then raise exception 'INVALID_TEMPLATE'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 1 and 200 then raise exception 'INVALID_IDEMPOTENCY'; end if;
  if p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_HASH'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'INVALID_ROWS';
  end if;

  v_fingerprint := md5(p_template_version || ':' || p_rows::text);
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':students:' || trim(p_idempotency_key)));
  select * into v_existing
    from public.data_import_batches
   where created_by = v_uid and import_kind = 'students' and idempotency_key = trim(p_idempotency_key);
  if v_existing.id is not null then
    if v_existing.input_fingerprint <> v_fingerprint or v_existing.input_hash <> p_input_hash
       or v_existing.template_version <> p_template_version then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return public.get_student_import_batch(v_existing.id);
  end if;

  insert into public.data_import_batches(
    import_kind, template_version, idempotency_key, input_hash, input_fingerprint,
    total_rows, valid_rows, duplicate_rows, error_rows, created_by
  ) values (
    'students', p_template_version, trim(p_idempotency_key), p_input_hash, v_fingerprint,
    jsonb_array_length(p_rows), 0, 0, jsonb_array_length(p_rows), v_uid
  ) returning id into v_batch_id;

  for v_item, v_row_no in
    select value, ordinality::integer from jsonb_array_elements(p_rows) with ordinality
  loop
    v_errors := '{}';
    v_target_id := null;
    v_grade := null;
    if jsonb_typeof(v_item) is distinct from 'object' then
      v_name := '';
      v_phone := '';
      v_grade_text := '';
      v_region := '';
      v_source := '';
      v_remark := '';
      v_errors := array_append(v_errors, 'MALFORMED_ROW');
    else
      v_name := trim(coalesce(v_item->>'name', ''));
      v_phone := trim(coalesce(v_item->>'phone', ''));
      v_grade_text := trim(coalesce(v_item->>'grade', ''));
      v_region := trim(coalesce(v_item->>'region', ''));
      v_source := trim(coalesce(v_item->>'source', ''));
      v_remark := trim(coalesce(v_item->>'remark', ''));
      if v_name = '' then v_errors := array_append(v_errors, 'EMPTY_NAME'); end if;
      if length(v_name) > 100 then v_errors := array_append(v_errors, 'NAME_TOO_LONG'); end if;
      if length(v_phone) > 40 then v_errors := array_append(v_errors, 'PHONE_TOO_LONG'); end if;
      if length(v_region) > 100 then v_errors := array_append(v_errors, 'REGION_TOO_LONG'); end if;
      if length(v_source) > 100 then v_errors := array_append(v_errors, 'SOURCE_TOO_LONG'); end if;
      if length(v_remark) > 2000 then v_errors := array_append(v_errors, 'REMARK_TOO_LONG'); end if;
      if v_grade_text <> '' then
        if v_grade_text !~ '^[0-9]{1,2}$' or v_grade_text::integer not between 1 and 12 then
          v_errors := array_append(v_errors, 'INVALID_GRADE');
        else
          v_grade := v_grade_text::smallint;
        end if;
      end if;
    end if;

    v_phone_key := regexp_replace(v_phone, '[^0-9+]', '', 'g');
    if cardinality(v_errors) > 0 then
      v_status := 'error';
      v_error := v_error + 1;
    elsif v_phone_key <> '' then
      select student.id into v_target_id
        from public.students student
       where student.deleted_at is null
         and regexp_replace(trim(student.phone), '[^0-9+]', '', 'g') = v_phone_key
       order by student.created_at
       limit 1;
      if v_target_id is null then
        select prior.target_id into v_target_id
          from public.data_import_rows prior
         where prior.batch_id = v_batch_id
           and prior.normalized_key = 'phone:' || v_phone_key
           and prior.row_status <> 'error'
         order by prior.row_no
         limit 1;
      end if;
      if found or exists (
        select 1 from public.data_import_rows prior
         where prior.batch_id = v_batch_id
           and prior.normalized_key = 'phone:' || v_phone_key
           and prior.row_status <> 'error'
      ) then
        v_status := 'duplicate';
        v_errors := array_append(v_errors, 'DUPLICATE_PHONE');
        v_duplicate := v_duplicate + 1;
      else
        v_status := 'valid';
        v_valid := v_valid + 1;
      end if;
    else
      v_status := 'valid';
      v_valid := v_valid + 1;
    end if;

    insert into public.data_import_rows(batch_id, row_no, row_status, normalized_key, payload, error_codes, target_id)
    values(
      v_batch_id,
      v_row_no,
      v_status,
      case when v_phone_key = '' then 'row:' || v_row_no::text else 'phone:' || v_phone_key end,
      jsonb_build_object(
        'name', left(v_name, 100),
        'phone', left(v_phone, 40),
        'grade', v_grade,
        'region', left(v_region, 100),
        'source', left(v_source, 100),
        'remark', left(v_remark, 2000)
      ),
      v_errors,
      v_target_id
    );
  end loop;

  update public.data_import_batches
     set valid_rows = v_valid, duplicate_rows = v_duplicate, error_rows = v_error
   where id = v_batch_id;
  perform public.emit_domain_event(
    'data_import.validated', 'data_import_batch', v_batch_id,
    jsonb_build_object(
      'kind', 'students', 'templateVersion', p_template_version, 'inputHash', p_input_hash,
      'total', jsonb_array_length(p_rows), 'valid', v_valid, 'duplicates', v_duplicate, 'errors', v_error
    ), v_uid, null
  );
  return public.get_student_import_batch(v_batch_id);
end
$$;

create or replace function public.apply_student_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_row record;
  v_target_id uuid;
  v_inserted integer := 0;
  v_duplicate integer;
  v_valid integer;
begin
  if v_uid is null or not public.has_perm(v_uid, 'student.import') then raise exception 'FORBIDDEN'; end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.created_by <> v_uid and not public.is_admin(v_uid) then raise exception 'FORBIDDEN'; end if;
  if v_batch.status = 'completed' then return public.get_student_import_batch(v_batch.id); end if;
  if v_batch.expires_at <= now() then raise exception 'BATCH_EXPIRED'; end if;
  if v_batch.error_rows > 0 then raise exception 'BATCH_HAS_ERRORS'; end if;

  for v_row in
    select * from public.data_import_rows
     where batch_id = v_batch.id and row_status = 'valid'
     order by row_no
     for update
  loop
    v_target_id := null;
    if v_row.normalized_key like 'phone:%' then
      perform pg_advisory_xact_lock(hashtext('student-import:' || v_row.normalized_key));
      select student.id into v_target_id
        from public.students student
       where student.deleted_at is null
         and regexp_replace(trim(student.phone), '[^0-9+]', '', 'g') = substring(v_row.normalized_key from 7)
       order by student.created_at
       limit 1;
    end if;

    if v_target_id is not null then
      update public.data_import_rows
         set row_status = 'duplicate', target_id = v_target_id,
             error_codes = array_append(error_codes, 'DUPLICATE_PHONE')
       where batch_id = v_batch.id and row_no = v_row.row_no;
    else
      insert into public.students(
        name, phone, grade, region, source, remark, status,
        assigned_to, created_by, bind_code
      ) values (
        v_row.payload->>'name',
        v_row.payload->>'phone',
        nullif(v_row.payload->>'grade', '')::smallint,
        v_row.payload->>'region',
        v_row.payload->>'source',
        v_row.payload->>'remark',
        'lead', v_batch.created_by, v_batch.created_by, public.generate_student_bind_code()
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
    'data_import.completed', 'data_import_batch', v_batch.id,
    jsonb_build_object(
      'kind', 'students', 'templateVersion', v_batch.template_version,
      'inputHash', v_batch.input_hash, 'inserted', v_inserted, 'duplicates', v_duplicate
    ), v_uid, null
  );
  return public.get_student_import_batch(v_batch.id);
end
$$;

create or replace function public.purge_expired_data_import_payloads(p_limit integer default 1000)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if auth.role() <> 'service_role'
     and (v_uid is null or not public.has_perm(v_uid, 'system.operations.manage')) then
    raise exception 'FORBIDDEN';
  end if;
  if p_limit not between 1 and 10000 then raise exception 'INVALID_LIMIT'; end if;
  with due as (
    select item.batch_id, item.row_no
      from public.data_import_rows item
      join public.data_import_batches batch on batch.id = item.batch_id
     where batch.expires_at <= now() and item.payload is not null
     order by batch.expires_at, item.batch_id, item.row_no
     limit p_limit
     for update of item skip locked
  ), cleared as (
    update public.data_import_rows item
       set payload = null
      from due
     where item.batch_id = due.batch_id and item.row_no = due.row_no
    returning 1
  ) select count(*) into v_count from cleared;
  return v_count;
end
$$;

revoke all on function public.get_student_import_batch(uuid) from public, anon, authenticated;
revoke all on function public.preview_student_import(text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.apply_student_import(uuid) from public, anon, authenticated;
revoke all on function public.purge_expired_data_import_payloads(integer) from public, anon, authenticated;
grant execute on function public.get_student_import_batch(uuid) to authenticated;
grant execute on function public.preview_student_import(text, jsonb, text, text) to authenticated;
grant execute on function public.apply_student_import(uuid) to authenticated;
grant execute on function public.purge_expired_data_import_payloads(integer) to authenticated, service_role;
