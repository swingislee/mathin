-- DATA-IMPORT-CLASSES-2: provision missing rooms as an explicit class-import
-- mapping decision. Dry runs only validate and retain the decision. Apply
-- creates the room and class in one transaction, reusing a room that appeared
-- after the dry run and never treating placeholder text as a physical room.

begin;

create schema if not exists mathin_internal;
revoke all on schema mathin_internal from public, anon, authenticated;

alter function public.preview_mofaxiao_class_import(text, jsonb, text, text, text, text, text, text, text)
  rename to preview_mofaxiao_class_import_base;
alter function public.preview_mofaxiao_class_import_base(text, jsonb, text, text, text, text, text, text, text)
  set schema mathin_internal;

alter function public.apply_mofaxiao_class_import(uuid)
  rename to apply_mofaxiao_class_import_base;
alter function public.apply_mofaxiao_class_import_base(uuid)
  set schema mathin_internal;

revoke all on function mathin_internal.preview_mofaxiao_class_import_base(text, jsonb, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function mathin_internal.apply_mofaxiao_class_import_base(uuid)
  from public, anon, authenticated;

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
  v_result jsonb;
  v_batch_id uuid;
  v_item jsonb;
  v_row_no integer;
  v_import_row public.data_import_rows%rowtype;
  v_payload jsonb;
  v_errors text[];
  v_create_campus_text text;
  v_create_campus_id uuid;
  v_room_name text;
  v_room_key text;
  v_effective_room_id uuid;
  v_existing_room_id uuid;
  v_existing_room_status text;
  v_target_id uuid;
  v_teacher_id uuid;
  v_school_term_id uuid;
  v_course_id uuid;
  v_name_key text;
  v_creation_valid boolean;
  v_non_duplicate_errors integer;
  v_has_duplicate boolean;
  v_valid integer;
  v_duplicate integer;
  v_error integer;
begin
  v_result := mathin_internal.preview_mofaxiao_class_import_base(
    p_template_version, p_rows, p_idempotency_key, p_input_hash, p_file_hash,
    p_source_system, p_source_file_name, p_source_sheet_name, p_batch_label
  );
  if v_result->>'status' = 'completed' then return v_result; end if;

  v_batch_id := (v_result->>'batchId')::uuid;

  for v_item, v_row_no in
    select value, ordinality::integer
      from jsonb_array_elements(p_rows) with ordinality
  loop
    v_create_campus_text := nullif(btrim(coalesce(v_item->>'createRoomCampusId', '')), '');
    if v_create_campus_text is null then continue; end if;

    select * into v_import_row
      from public.data_import_rows
     where batch_id = v_batch_id and row_no = v_row_no
     for update;
    if v_import_row.batch_id is null then continue; end if;

    v_payload := coalesce(v_import_row.payload, '{}'::jsonb);
    v_errors := coalesce(v_import_row.error_codes, '{}'::text[]);
    v_target_id := v_import_row.target_id;
    v_effective_room_id := null;
    v_existing_room_id := null;
    v_existing_room_status := null;
    v_creation_valid := true;
    v_room_name := btrim(coalesce(v_item->>'roomName', ''));
    v_room_key := public.normalize_mofaxiao_class_text(v_room_name);

    begin
      v_create_campus_id := v_create_campus_text::uuid;
    exception when others then
      v_create_campus_id := null;
      v_creation_valid := false;
      if not ('INVALID_ROOM_CREATION' = any(v_errors)) then
        v_errors := array_append(v_errors, 'INVALID_ROOM_CREATION');
      end if;
    end;

    if nullif(btrim(coalesce(v_item->>'roomId', '')), '') is not null then
      v_creation_valid := false;
      if not ('INVALID_ROOM_CREATION' = any(v_errors)) then
        v_errors := array_append(v_errors, 'INVALID_ROOM_CREATION');
      end if;
    end if;
    if char_length(v_room_name) not between 1 and 100
       or v_room_key in ('', '-', '—', '无', '暂无', '待定', '未分配', '待分配', '待分发', '待分配教室', '待分发教室') then
      v_creation_valid := false;
      if not ('INVALID_ROOM_CREATION' = any(v_errors)) then
        v_errors := array_append(v_errors, 'INVALID_ROOM_CREATION');
      end if;
    end if;
    if not public.has_perm(v_uid, 'location.manage') then
      v_creation_valid := false;
      if not ('LOCATION_PERMISSION_REQUIRED' = any(v_errors)) then
        v_errors := array_append(v_errors, 'LOCATION_PERMISSION_REQUIRED');
      end if;
    end if;
    if v_create_campus_id is null or not exists (
      select 1 from public.campuses campus
       where campus.id = v_create_campus_id and campus.status = 'active'
    ) then
      v_creation_valid := false;
      if not ('INVALID_ROOM_CREATION' = any(v_errors)) then
        v_errors := array_append(v_errors, 'INVALID_ROOM_CREATION');
      end if;
    end if;

    -- The base validator sees a pending room as null. Remove only that
    -- provisional no-room duplicate and recompute it with the resolved room.
    v_errors := array_remove(v_errors, 'DUPLICATE_EXISTING_CLASS');
    if not ('DUPLICATE_SOURCE_ID' = any(v_errors)) then v_target_id := null; end if;
    if 'DUPLICATE_SAME_BATCH' = any(v_errors) then v_target_id := null; end if;

    if v_creation_valid then
      select room.id, room.status
        into v_existing_room_id, v_existing_room_status
        from public.campus_rooms room
       where room.campus_id = v_create_campus_id
         and lower(btrim(room.name)) = lower(v_room_name)
       limit 1;

      if v_existing_room_id is not null and v_existing_room_status = 'active' then
        v_effective_room_id := v_existing_room_id;
        v_payload := v_payload || jsonb_build_object(
          'roomId', v_effective_room_id,
          'createRoomCampusId', null
        );
      elsif v_existing_room_id is not null then
        if not ('ROOM_NAME_EXISTS_INACTIVE' = any(v_errors)) then
          v_errors := array_append(v_errors, 'ROOM_NAME_EXISTS_INACTIVE');
        end if;
      else
        v_payload := v_payload || jsonb_build_object(
          'roomId', null,
          'createRoomCampusId', v_create_campus_id
        );
      end if;
    else
      v_payload := v_payload || jsonb_build_object(
        'roomId', null,
        'createRoomCampusId', v_create_campus_id
      );
    end if;

    select count(*) into v_non_duplicate_errors
      from unnest(v_errors) code
     where code not in ('DUPLICATE_SAME_BATCH', 'DUPLICATE_SOURCE_ID', 'DUPLICATE_EXISTING_CLASS');

    if v_non_duplicate_errors = 0
       and not ('DUPLICATE_SOURCE_ID' = any(v_errors))
       and not ('DUPLICATE_SAME_BATCH' = any(v_errors))
       and v_effective_room_id is not null then
      begin
        v_teacher_id := nullif(v_payload->>'primaryTeacherId', '')::uuid;
        v_school_term_id := nullif(v_payload->>'schoolTermId', '')::uuid;
        v_course_id := nullif(v_payload->>'courseId', '')::uuid;
        v_name_key := public.normalize_mofaxiao_class_text(v_payload->>'name');

        select classroom.id into v_target_id
          from public.classrooms classroom
         where classroom.trashed_at is null
           and classroom.owner_id = v_teacher_id
           and classroom.term_id = v_school_term_id
           and classroom.course_id is not distinct from v_course_id
           and classroom.default_room_id = v_effective_room_id
           and public.normalize_mofaxiao_class_text(classroom.name) = v_name_key
         order by classroom.created_at
         limit 1;
        if found then v_errors := array_append(v_errors, 'DUPLICATE_EXISTING_CLASS'); end if;
      exception when others then
        if not ('MALFORMED_ROW' = any(v_errors)) then
          v_errors := array_append(v_errors, 'MALFORMED_ROW');
        end if;
        v_target_id := null;
      end;
    end if;

    select count(*) into v_non_duplicate_errors
      from unnest(v_errors) code
     where code not in ('DUPLICATE_SAME_BATCH', 'DUPLICATE_SOURCE_ID', 'DUPLICATE_EXISTING_CLASS');
    select exists (
      select 1 from unnest(v_errors) code
       where code in ('DUPLICATE_SAME_BATCH', 'DUPLICATE_SOURCE_ID', 'DUPLICATE_EXISTING_CLASS')
    ) into v_has_duplicate;

    update public.data_import_rows
       set payload = v_payload,
           error_codes = v_errors,
           target_id = case when v_non_duplicate_errors > 0 then null else v_target_id end,
           row_status = case
             when v_non_duplicate_errors > 0 then 'error'
             when v_has_duplicate then 'duplicate'
             else 'valid'
           end
     where batch_id = v_batch_id and row_no = v_row_no;
  end loop;

  select count(*) filter (where row_status = 'valid'),
         count(*) filter (where row_status = 'duplicate'),
         count(*) filter (where row_status = 'error')
    into v_valid, v_duplicate, v_error
    from public.data_import_rows
   where batch_id = v_batch_id;

  update public.data_import_batches
     set valid_rows = v_valid, duplicate_rows = v_duplicate, error_rows = v_error
   where id = v_batch_id;

  perform public.emit_domain_event(
    'class_import.room_mappings.validated', 'data_import_batch', v_batch_id,
    jsonb_build_object(
      'valid', v_valid,
      'duplicates', v_duplicate,
      'errors', v_error,
      'requestedRoomCreations', (
        select count(*)
          from public.data_import_rows import_row
         where import_row.batch_id = v_batch_id
           and nullif(import_row.payload->>'createRoomCampusId', '') is not null
      )
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
  v_create_campus_id uuid;
  v_room_name text;
  v_room_key text;
  v_room_id uuid;
  v_room_status text;
  v_prior_target_id uuid;
  v_created_rooms integer := 0;
  v_result jsonb;
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
  if exists (
    select 1 from public.data_import_rows import_row
     where import_row.batch_id = v_batch.id
       and import_row.row_status = 'valid'
       and nullif(import_row.payload->>'createRoomCampusId', '') is not null
  ) and not public.has_perm(v_uid, 'location.manage') then
    raise exception 'LOCATION_PERMISSION_REQUIRED';
  end if;

  -- Acquire the class-import apply lock before provisioning rooms so another
  -- import cannot make the source row duplicate between the check and insert.
  perform pg_advisory_xact_lock(hashtext('mofaxiao-class-import:apply'));

  for v_row in
    select * from public.data_import_rows
     where batch_id = v_batch.id
       and row_status = 'valid'
       and nullif(payload->>'createRoomCampusId', '') is not null
     order by row_no
     for update
  loop
    v_prior_target_id := null;
    select prior.target_id into v_prior_target_id
      from public.data_import_rows prior
      join public.data_import_batches prior_batch on prior_batch.id = prior.batch_id
     where prior.batch_id <> v_batch.id
       and prior_batch.import_kind = 'classes'
       and prior_batch.template_version = 'mofaxiao-classes-v1'
       and prior_batch.source_system = 'mofaxiao'
       and prior.normalized_key = v_row.normalized_key
       and prior.target_id is not null
       and prior.row_status in ('inserted', 'duplicate')
     order by prior.created_at
     limit 1;
    if v_prior_target_id is not null then
      update public.data_import_rows
         set row_status = 'duplicate', target_id = v_prior_target_id,
             error_codes = array['DUPLICATE_SOURCE_ID']::text[]
       where batch_id = v_batch.id and row_no = v_row.row_no;
      continue;
    end if;

    begin
      v_create_campus_id := (v_row.payload->>'createRoomCampusId')::uuid;
    exception when others then
      raise exception 'INVALID_ROOM_CREATION';
    end;
    v_room_name := btrim(coalesce(v_row.payload->>'roomName', ''));
    v_room_key := public.normalize_mofaxiao_class_text(v_room_name);
    if char_length(v_room_name) not between 1 and 100
       or v_room_key in ('', '-', '—', '无', '暂无', '待定', '未分配', '待分配', '待分发', '待分配教室', '待分发教室')
       or not exists (
         select 1 from public.campuses campus
          where campus.id = v_create_campus_id and campus.status = 'active'
       ) then
      raise exception 'INVALID_ROOM_CREATION';
    end if;

    v_room_id := null;
    v_room_status := null;
    select room.id, room.status into v_room_id, v_room_status
      from public.campus_rooms room
     where room.campus_id = v_create_campus_id
       and lower(btrim(room.name)) = lower(v_room_name)
     limit 1;

    if v_room_id is not null and v_room_status <> 'active' then
      raise exception 'ROOM_NAME_EXISTS_INACTIVE';
    elsif v_room_id is null then
      v_room_id := public.create_campus_room_v2(v_create_campus_id, v_room_name, null);
      v_created_rooms := v_created_rooms + 1;
    end if;

    update public.data_import_rows
       set payload = payload || jsonb_build_object(
         'roomId', v_room_id,
         'createRoomCampusId', null
       )
     where batch_id = v_batch.id and row_no = v_row.row_no;
  end loop;

  v_result := mathin_internal.apply_mofaxiao_class_import_base(v_batch.id);
  if v_created_rooms > 0 then
    perform public.emit_domain_event(
      'class_import.rooms.created', 'data_import_batch', v_batch.id,
      jsonb_build_object('createdRooms', v_created_rooms), v_uid, null
    );
  end if;
  return v_result;
end
$$;

revoke all on function public.preview_mofaxiao_class_import(text, jsonb, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.apply_mofaxiao_class_import(uuid)
  from public, anon, authenticated;
grant execute on function public.preview_mofaxiao_class_import(text, jsonb, text, text, text, text, text, text, text)
  to authenticated;
grant execute on function public.apply_mofaxiao_class_import(uuid)
  to authenticated;

commit;
