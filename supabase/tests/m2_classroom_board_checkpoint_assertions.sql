\set ON_ERROR_STOP on

-- Development-target assertion: uses one existing fixed-account classroom and rolls back.
-- It creates no users and leaves no checkpoint or business event behind.
begin;

do $$
declare
  session_uuid uuid;
  teacher_uuid uuid;
  board_key_value text := gen_random_uuid()::text;
  first_checkpoint uuid := gen_random_uuid();
  second_checkpoint uuid := gen_random_uuid();
  result jsonb;
  restored jsonb;
  legacy_count integer;
  chunk_payload jsonb := jsonb_build_array(jsonb_build_array(jsonb_build_object(
    'id', 'm2-db-stroke',
    'mode', 'ink',
    'color', 'ink',
    'wNorm', 0.004,
    'points', jsonb_build_array(jsonb_build_array(0.1, 0.1), jsonb_build_array(0.9, 0.9))
  )));
begin
  select session_row.id, candidate.user_id
    into session_uuid, teacher_uuid
    from public.class_sessions session_row
    cross join lateral (
      select session_row.teacher_override as user_id
       where session_row.teacher_override is not null
      union all
      select member_row.user_id
        from public.classroom_members member_row
       where member_row.classroom_id = session_row.classroom_id
         and member_row.role = 'teacher'
    ) candidate
    join public.profiles profile_row on profile_row.id = candidate.user_id and profile_row.is_active
   where public.is_session_teacher(session_row.id, candidate.user_id)
   order by session_row.scheduled_at desc nulls last
   limit 1;

  if session_uuid is null or teacher_uuid is null then
    raise exception 'M2_FIXED_TEACHER_SESSION_MISSING';
  end if;
  perform set_config('request.jwt.claim.sub', teacher_uuid::text, true);

  result := public.save_session_board_checkpoint(
    session_uuid, board_key_value, first_checkpoint, 'm2-writer-a', 1, 0, 1, chunk_payload
  );
  if result ->> 'status' <> 'saved' or (result ->> 'version')::bigint <> 1 then
    raise exception 'M2_FIRST_SAVE_FAILED: %', result;
  end if;

  result := public.save_session_board_checkpoint(
    session_uuid, board_key_value, first_checkpoint, 'm2-writer-a', 1, 0, 1, chunk_payload
  );
  if result ->> 'status' <> 'idempotent' or (result ->> 'version')::bigint <> 1 then
    raise exception 'M2_IDEMPOTENCE_FAILED: %', result;
  end if;

  result := public.save_session_board_checkpoint(
    session_uuid, board_key_value, gen_random_uuid(), 'm2-writer-a', 1, 1, 1, chunk_payload
  );
  if result ->> 'status' <> 'stale' or (result ->> 'accepted')::boolean then
    raise exception 'M2_STALE_WRITER_ACCEPTED: %', result;
  end if;

  result := public.save_session_board_checkpoint(
    session_uuid, board_key_value, gen_random_uuid(), 'm2-writer-b', 1, 0, 1, chunk_payload
  );
  if result ->> 'status' <> 'conflict' or (result ->> 'accepted')::boolean then
    raise exception 'M2_CONFLICT_WRITER_ACCEPTED: %', result;
  end if;

  result := public.save_session_board_checkpoint(
    session_uuid, board_key_value, second_checkpoint, 'm2-writer-b', 1, 1, 1, chunk_payload
  );
  if result ->> 'status' <> 'saved' or (result ->> 'version')::bigint <> 2 then
    raise exception 'M2_REBASED_SAVE_FAILED: %', result;
  end if;

  if (select count(*) from public.session_board_checkpoint_versions
       where session_id = session_uuid and board_key = board_key_value) <> 1 then
    raise exception 'M2_LATEST_ONLY_FAILED';
  end if;

  restored := public.get_session_board_checkpoints(session_uuid, board_key_value);
  if jsonb_array_length(restored) <> 1
     or restored #>> '{0,checkpointId}' <> second_checkpoint::text
     or nullif(restored #>> '{0,createdAt}', '') is null
     or (restored #>> '{0,itemCount}')::integer <> 1
     or jsonb_array_length(restored #> '{0,items}') <> 1 then
    raise exception 'M2_RESTORE_FAILED: %', restored;
  end if;

  begin
    perform public.save_session_board_checkpoint(
      session_uuid, board_key_value, gen_random_uuid(), 'm2-writer-b', 2, 2, 4001, chunk_payload
    );
    raise exception 'M2_ITEM_LIMIT_NOT_ENFORCED';
  exception when others then
    if sqlerrm = 'M2_ITEM_LIMIT_NOT_ENFORCED' or sqlerrm not like '%VALIDATION%' then
      raise;
    end if;
  end;

  if coalesce((
    select flag_row.enabled
      from public.feature_flag_versions flag_row
     where flag_row.flag_key = 'teaching.classroom_board_checkpoint_v2'
       and flag_row.effective_until is null
     order by flag_row.version desc
     limit 1
  ), true) then
    raise exception 'M2_WRITER_FLAG_NOT_FAIL_CLOSED';
  end if;

  -- Authenticated non-members receive an empty reader result so an invalid URL can resolve to not-found.
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  if public.get_session_board_checkpoints(session_uuid, board_key_value) <> '[]'::jsonb then
    raise exception 'M2_NON_MEMBER_CHECKPOINT_LEAK';
  end if;
  select count(*) into legacy_count from public.get_session_legacy_board_snapshots(session_uuid);
  if legacy_count <> 0 then
    raise exception 'M2_NON_MEMBER_LEGACY_LEAK';
  end if;
end;
$$;

rollback;
