begin;

do $$
declare
  v_actor_id uuid;
  v_role_id uuid;
  v_role_key text;
  identifier text := 'bulk-assert-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid';
  batch_key text := gen_random_uuid()::text;
  invalid_batch_key text := gen_random_uuid()::text;
  preview jsonb;
  invalid_preview jsonb;
  v_batch_id uuid;
  v_target_id uuid;
  v_reissue_id uuid;
  v_previous_hash text;
  v_next_hash text;
  prepared record;
  created_invitation_id uuid;
  auth_count_before bigint;
  auth_count_after bigint;
  denied boolean := false;
begin
  select count(*) into auth_count_before from auth.users;
  select id into v_actor_id
    from public.profiles
   where role = 'admin' and is_active
   order by created_at
   limit 1;
  if v_actor_id is null then raise exception 'STAFF_IMPORT_ADMIN_FIXTURE_REQUIRED'; end if;

  select role_row.id, role_row.key into v_role_id, v_role_key
    from public.staff_roles role_row
   where not exists (
     select 1 from public.role_permissions permission_row
      where permission_row.role_id = role_row.id
        and permission_row.perm_key = 'permission.configure'
   )
   order by role_row.created_at
   limit 1;
  if v_role_id is null then raise exception 'STAFF_IMPORT_ROLE_FIXTURE_REQUIRED'; end if;

  perform set_config('request.jwt.claim.sub', v_actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  preview := public.preview_staff_account_import(
    'mathin-staff-v1',
    jsonb_build_array(jsonb_build_object(
      'name', 'Bulk assertion staff',
      'identifier', identifier,
      'roles', jsonb_build_array(v_role_key),
      'validDays', 7
    )),
    batch_key,
    repeat('a', 64)
  );
  if preview->>'status' <> 'validated'
     or (preview->>'valid')::integer <> 1
     or (preview->>'errorCount')::integer <> 0
  then raise exception 'STAFF_IMPORT_VALID_PREVIEW_FAILED'; end if;
  v_batch_id := (preview->>'batchId')::uuid;

  begin
    perform public.apply_staff_import(v_batch_id);
    raise exception 'STAFF_IMPORT_LEGACY_APPLY_ACCEPTED';
  exception when others then
    if sqlerrm = 'STAFF_IMPORT_LEGACY_APPLY_ACCEPTED' then raise; end if;
    if position('DIRECT_PROVISIONING_REQUIRED' in sqlerrm) = 0 then raise; end if;
  end;

  select * into prepared
    from public.prepare_staff_import_account(v_batch_id, 1, md5('M!9ASSERTIONPASSWORD'));
  created_invitation_id := prepared.invitation_id;
  if created_invitation_id is null
     or prepared.identifier_normalized <> identifier
     or prepared.role_keys <> array[v_role_key]
     or not exists (
       select 1 from public.staff_invitations invitation_row
        where invitation_row.id = created_invitation_id
          and invitation_row.status = 'pending'
          and invitation_row.provisioning_mode = 'direct'
          and invitation_row.source_batch_id = v_batch_id
          and invitation_row.source_row_no = 1
     )
     or not exists (
       select 1 from public.staff_invitation_role_assignments assignment
        where assignment.invitation_id = created_invitation_id
          and assignment.role_id = v_role_id
          and assignment.assigned_by = v_actor_id
     )
  then raise exception 'STAFF_IMPORT_DIRECT_RESERVATION_FAILED'; end if;

  perform public.cancel_staff_import_account(created_invitation_id, 'AUTH_PROVIDER_FAILED');
  if not exists (
    select 1 from public.data_import_rows import_row
     where import_row.batch_id = v_batch_id
       and import_row.row_no = 1
       and import_row.row_status = 'valid'
       and import_row.error_codes = array['AUTH_PROVIDER_FAILED']
  ) then raise exception 'STAFF_IMPORT_RETRY_STATE_FAILED'; end if;

  select * into prepared
    from public.prepare_staff_import_account(v_batch_id, 1, md5('M!9ASSERTIONRETRY'));
  perform public.cancel_staff_import_account(prepared.invitation_id, 'AUTH_PROVIDER_FAILED');

  select profile_row.id into v_target_id
    from public.profiles profile_row
   where profile_row.id <> v_actor_id
     and profile_row.role in ('staff', 'admin')
     and profile_row.is_active
     and profile_row.account_status = 'active'
   order by profile_row.created_at
   limit 1;
  if v_target_id is null then raise exception 'STAFF_REISSUE_TARGET_FIXTURE_REQUIRED'; end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  update public.profiles
     set password_change_required = true,
         initial_password_set_at = now(),
         password_changed_at = null
   where id = v_target_id;
  update public.staff_invitations
     set status = 'accepted', accepted_by = v_target_id, accepted_at = now(), revoked_at = null
   where id = prepared.invitation_id;
  select code_hash into v_previous_hash
    from public.staff_invitations where id = prepared.invitation_id;

  v_next_hash := md5(gen_random_uuid()::text);
  select reissue_id into v_reissue_id
    from public.prepare_staff_initial_password_reissue(v_actor_id, v_target_id, v_next_hash);
  if not exists (
    select 1 from public.staff_initial_password_reissues request_row
     where request_row.id = v_reissue_id
       and request_row.status = 'prepared'
       and request_row.next_code_hash = v_next_hash
  ) or not exists (
    select 1 from public.staff_invitations invitation_row
     where invitation_row.id = prepared.invitation_id and invitation_row.code_hash = v_next_hash
  ) then raise exception 'STAFF_REISSUE_PREPARE_FAILED'; end if;

  begin
    perform public.prepare_staff_initial_password_reissue(
      v_actor_id, v_target_id, md5(gen_random_uuid()::text)
    );
    raise exception 'STAFF_REISSUE_CONCURRENT_CALL_ACCEPTED';
  exception when others then
    if sqlerrm = 'STAFF_REISSUE_CONCURRENT_CALL_ACCEPTED' then raise; end if;
    if position('PASSWORD_REISSUE_IN_PROGRESS' in sqlerrm) = 0 then raise; end if;
  end;

  perform public.rollback_staff_initial_password_reissue(
    v_reissue_id, v_actor_id, v_next_hash
  );
  if not exists (
    select 1 from public.staff_initial_password_reissues request_row
     where request_row.id = v_reissue_id
       and request_row.status = 'rolled_back'
       and request_row.previous_code_hash is null
       and request_row.next_code_hash is null
  ) or not exists (
    select 1 from public.staff_invitations invitation_row
     where invitation_row.id = prepared.invitation_id and invitation_row.code_hash = v_previous_hash
  ) then raise exception 'STAFF_REISSUE_ROLLBACK_FAILED'; end if;

  v_next_hash := md5(gen_random_uuid()::text);
  select reissue_id into v_reissue_id
    from public.prepare_staff_initial_password_reissue(v_actor_id, v_target_id, v_next_hash);
  perform public.complete_staff_initial_password_reissue(
    v_reissue_id, v_actor_id, v_next_hash
  );
  if not exists (
    select 1 from public.staff_initial_password_reissues request_row
     where request_row.id = v_reissue_id
       and request_row.status = 'completed'
       and request_row.previous_code_hash is null
       and request_row.next_code_hash is null
  ) then raise exception 'STAFF_REISSUE_COMPLETE_FAILED'; end if;

  v_next_hash := md5(gen_random_uuid()::text);
  select reissue_id into v_reissue_id
    from public.prepare_staff_initial_password_reissue(v_actor_id, v_target_id, v_next_hash);
  perform public.complete_initial_password_change(v_target_id);
  if exists (
    select 1 from public.profiles target_profile
     where target_profile.id = v_target_id and target_profile.password_change_required
  ) or not exists (
    select 1 from public.staff_initial_password_reissues request_row
     where request_row.id = v_reissue_id
       and request_row.status = 'completed'
       and request_row.previous_code_hash is null
       and request_row.next_code_hash is null
  ) then raise exception 'STAFF_REISSUE_PASSWORD_CHANGE_CLEANUP_FAILED'; end if;

  perform set_config('request.jwt.claim.sub', v_actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  invalid_preview := public.preview_staff_account_import(
    'mathin-staff-v1',
    jsonb_build_array(jsonb_build_object(
      'name', '', 'identifier', 'not-a-phone', 'roles', '[]'::jsonb, 'validDays', 7
    )),
    invalid_batch_key,
    repeat('b', 64)
  );
  if (invalid_preview->>'errorCount')::integer <> 1
     or invalid_preview->'rows'->0->>'status' <> 'error'
  then raise exception 'STAFF_IMPORT_INVALID_ROW_ACCEPTED'; end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.preview_staff_account_import(
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

  select count(*) into auth_count_after from auth.users;
  if auth_count_after <> auth_count_before then raise exception 'STAFF_IMPORT_ASSERTION_CREATED_AUTH_USER'; end if;
end;
$$;

do $$
declare failures text[] := '{}';
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'password_change_required' and data_type = 'boolean'
  ) then failures := array_append(failures, 'password-change flag missing'); end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and column_name in ('initial_password', 'initial_password_plaintext')
  ) then failures := array_append(failures, 'plaintext initial-password column exists'); end if;
  if to_regclass('public.staff_initial_password_reissues') is null then
    failures := array_append(failures, 'initial-password reissue ledger missing');
  end if;
  if exists (
    select 1 from auth.users
     where coalesce(raw_user_meta_data, '{}'::jsonb) ? 'registration_invite_code'
  ) then failures := array_append(failures, 'registration invite secret remains in auth metadata'); end if;
  if not exists (
    select 1
      from pg_trigger trigger_row
      join pg_class table_row on table_row.oid = trigger_row.tgrelid
      join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
     where schema_row.nspname = 'auth'
       and table_row.relname = 'users'
       and trigger_row.tgname = 'on_auth_user_invite_secret_scrubbed'
       and not trigger_row.tgisinternal
       and trigger_row.tgenabled <> 'D'
  ) then failures := array_append(failures, 'auth invite-secret scrub trigger missing'); end if;
  if not exists (
    select 1 from public.staff_roles role_row
    join public.role_permissions permission_row on permission_row.role_id = role_row.id
    where role_row.key = 'director' and permission_row.perm_key = 'staff.invite'
  ) then failures := array_append(failures, 'director invite permission missing'); end if;
  if not has_function_privilege(
    'authenticated', 'public.preview_staff_account_import(text,jsonb,text,text)', 'EXECUTE'
  ) then failures := array_append(failures, 'preview execute grant missing'); end if;
  if has_function_privilege(
    'authenticated', 'public.complete_initial_password_change(uuid)', 'EXECUTE'
  ) then failures := array_append(failures, 'password completion leaked to authenticated'); end if;
  if not has_function_privilege(
    'service_role', 'public.complete_initial_password_change(uuid)', 'EXECUTE'
  ) then failures := array_append(failures, 'service-role password completion grant missing'); end if;
  if has_function_privilege(
    'authenticated', 'public.prepare_staff_initial_password_reissue(uuid,uuid,text)', 'EXECUTE'
  ) then failures := array_append(failures, 'password reissue prepare leaked to authenticated'); end if;
  if not has_function_privilege(
    'service_role', 'public.prepare_staff_initial_password_reissue(uuid,uuid,text)', 'EXECUTE'
  ) then failures := array_append(failures, 'service-role password reissue prepare grant missing'); end if;
  if not has_function_privilege(
    'service_role', 'public.rollback_staff_initial_password_reissue(uuid,uuid,text)', 'EXECUTE'
  ) then failures := array_append(failures, 'service-role password reissue rollback grant missing'); end if;
  if not has_function_privilege(
    'service_role', 'public.complete_staff_initial_password_reissue(uuid,uuid,text)', 'EXECUTE'
  ) then failures := array_append(failures, 'service-role password reissue completion grant missing'); end if;
  if cardinality(failures) > 0 then
    raise exception 'STAFF_DIRECT_PROVISIONING_STRUCTURE_FAILED: %', array_to_string(failures, ', ');
  end if;
end
$$;

rollback;
