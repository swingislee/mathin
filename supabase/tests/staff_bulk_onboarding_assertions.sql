begin;

do $$
declare
  v_actor_id uuid;
  v_target_staff_id uuid;
  v_role_id uuid;
  v_role_key text;
  valid_identifier text := 'bulk-assert-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid';
  invalid_identifier text := 'not-a-phone';
  valid_batch_key text := gen_random_uuid()::text;
  invalid_batch_key text := gen_random_uuid()::text;
  valid_preview jsonb;
  invalid_preview jsonb;
  applied jsonb;
  retried jsonb;
  created_batch_id uuid;
  v_invitation_id uuid;
  denied boolean := false;
begin
  select id into v_actor_id
    from public.profiles
   where role = 'admin' and is_active
   order by created_at
   limit 1;
  if v_actor_id is null then raise exception 'STAFF_IMPORT_ADMIN_FIXTURE_REQUIRED'; end if;

  select id into v_target_staff_id
    from public.profiles
   where role = 'staff' and is_active
   order by created_at
   limit 1;
  if v_target_staff_id is null then raise exception 'STAFF_IMPORT_STAFF_FIXTURE_REQUIRED'; end if;

  select role_row.id, role_row.key into v_role_id, v_role_key
    from public.staff_roles role_row
   where not exists (
       select 1 from public.role_permissions permission_row
        where permission_row.role_id = role_row.id
          and permission_row.perm_key = 'permission.configure'
     )
     and not exists (
       select 1 from public.staff_role_members member_row
        where member_row.user_id = v_target_staff_id
          and member_row.role_id = role_row.id
     )
   order by role_row.created_at
   limit 1;
  if v_role_id is null then raise exception 'STAFF_IMPORT_UNASSIGNED_ROLE_FIXTURE_REQUIRED'; end if;

  perform set_config('request.jwt.claim.sub', v_actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  valid_preview := public.preview_staff_import(
    'mathin-staff-v1',
    jsonb_build_array(jsonb_build_object(
      'name', 'Bulk assertion staff',
      'identifier', valid_identifier,
      'roles', jsonb_build_array(v_role_key),
      'validDays', 1
    )),
    valid_batch_key,
    repeat('a', 64)
  );
  if valid_preview->>'status' <> 'validated'
     or (valid_preview->>'valid')::integer <> 1
     or (valid_preview->>'errorCount')::integer <> 0
  then
    raise exception 'STAFF_IMPORT_VALID_PREVIEW_FAILED';
  end if;

  created_batch_id := (valid_preview->>'batchId')::uuid;
  applied := public.apply_staff_import(created_batch_id);
  if applied->>'status' <> 'completed'
     or (applied->>'issued')::integer <> 1
     or (applied->>'codesAvailable')::boolean is not true
     or jsonb_array_length(applied->'invitations') <> 1
     or length(applied->'invitations'->0->>'inviteCode') <> 18
  then
    raise exception 'STAFF_IMPORT_APPLY_FAILED';
  end if;

  select import_row.target_id into v_invitation_id
    from public.data_import_rows import_row
   where import_row.batch_id = created_batch_id and import_row.row_no = 1;
  if v_invitation_id is null
     or not exists (
       select 1 from public.staff_invitations invitation_row
        where invitation_row.id = v_invitation_id
          and invitation_row.status = 'pending'
          and invitation_row.identifier_normalized = valid_identifier
          and invitation_row.display_name = 'Bulk assertion staff'
     )
     or not exists (
       select 1 from public.staff_invitation_role_assignments assignment
        where assignment.invitation_id = v_invitation_id
          and assignment.role_id = v_role_id
          and assignment.assigned_by = v_actor_id
     )
     or exists (
       select 1 from public.data_import_rows import_row
        where import_row.batch_id = created_batch_id and import_row.payload is not null
     )
  then
    raise exception 'STAFF_IMPORT_DURABLE_INTENT_FAILED';
  end if;

  retried := public.apply_staff_import(created_batch_id);
  if (retried->>'codesAvailable')::boolean is not false
     or jsonb_array_length(retried->'invitations') <> 0
  then
    raise exception 'STAFF_IMPORT_CODE_REEXPOSED';
  end if;

  update public.staff_invitations
     set status = 'accepted', accepted_by = v_target_staff_id, accepted_at = now()
   where id = v_invitation_id;
  if not exists (
    select 1 from public.staff_role_members member_row
     where member_row.user_id = v_target_staff_id and member_row.role_id = v_role_id
  ) or not exists (
    select 1 from public.profiles profile_row
     where profile_row.id = v_target_staff_id and profile_row.display_name = 'Bulk assertion staff'
  ) then
    raise exception 'STAFF_IMPORT_ACCEPTANCE_INTENT_FAILED';
  end if;

  invalid_preview := public.preview_staff_import(
    'mathin-staff-v1',
    jsonb_build_array(jsonb_build_object(
      'name', '',
      'identifier', invalid_identifier,
      'roles', '[]'::jsonb,
      'validDays', 7
    )),
    invalid_batch_key,
    repeat('b', 64)
  );
  if (invalid_preview->>'errorCount')::integer <> 1
     or invalid_preview->'rows'->0->>'status' <> 'error'
  then
    raise exception 'STAFF_IMPORT_INVALID_ROW_ACCEPTED';
  end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.preview_staff_import(
      'mathin-staff-v1',
      jsonb_build_array(jsonb_build_object(
        'name', 'Denied', 'identifier', 'denied@example.invalid',
        'roles', jsonb_build_array(v_role_key), 'validDays', 7
      )),
      gen_random_uuid()::text,
      repeat('c', 64)
    );
    raise exception 'STAFF_IMPORT_UNAUTHORIZED_CALL_ACCEPTED';
  exception when others then
    if sqlerrm = 'STAFF_IMPORT_UNAUTHORIZED_CALL_ACCEPTED' then raise; end if;
    if position('FORBIDDEN' in sqlerrm) = 0 then raise; end if;
    denied := true;
  end;
  if not denied then raise exception 'STAFF_IMPORT_UNAUTHORIZED_CALL_NOT_DENIED'; end if;

  if not exists (
    select 1 from pg_class
     where oid = 'public.staff_invitation_role_assignments'::regclass and relrowsecurity
  ) then
    raise exception 'STAFF_IMPORT_ROLE_INTENT_RLS_DISABLED';
  end if;
end;
$$;

rollback;
