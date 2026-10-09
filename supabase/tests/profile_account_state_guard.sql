\set ON_ERROR_STOP on
-- Run only through the explicit isolated SQL runner after target identification.
-- Creates new random identities; no existing profile is changed. All writes,
-- including normal registration and staff lifecycle side effects, roll back.
begin;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);
select set_config('request.jwt.claims', '{}', true);
select set_config('profile_state_test.admin', gen_random_uuid()::text, true);
select set_config('profile_state_test.inactive', gen_random_uuid()::text, true);
select set_config('profile_state_test.locked', gen_random_uuid()::text, true);
select set_config('profile_state_test.pending_password', gen_random_uuid()::text, true);
select set_config('profile_state_test.staff', gen_random_uuid()::text, true);

do $$
declare fixture text; user_id uuid; invite_code text;
begin
  select code into invite_code from public.registration_invite_settings where id = 1 and is_active;
  if invite_code is null then raise exception 'ISOLATED_REGISTRATION_FIXTURE_REQUIRED'; end if;
  foreach fixture in array array['admin','inactive','locked','pending_password','staff'] loop
    user_id := current_setting('profile_state_test.' || fixture)::uuid;
    insert into auth.users(id, email, raw_user_meta_data)
    values(user_id, 'profile-state-' || user_id::text || '@example.invalid', jsonb_build_object(
      'display_name', '测试-账户状态-' || fixture,
      'registration_invite_code', invite_code,
      'privacy_consent', true, 'children_privacy_consent', true
    ));
    if fixture <> 'staff' then
      update public.profiles set role = 'admin' where id = user_id;
    end if;
  end loop;
  update public.profiles set is_active = false where id = current_setting('profile_state_test.inactive')::uuid;
  update public.profiles set account_status = 'locked' where id = current_setting('profile_state_test.locked')::uuid;
  update public.profiles set password_change_required = true, initial_password_set_at = now(), password_changed_at = null
    where id = current_setting('profile_state_test.pending_password')::uuid;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

-- A still-valid authenticated token must not retain administrator authority
-- after suspension, locking, or a required password change.
do $$
declare fixture text; actor uuid; target uuid := current_setting('profile_state_test.staff')::uuid;
begin
  foreach fixture in array array['inactive','locked','pending_password'] loop
    actor := current_setting('profile_state_test.' || fixture)::uuid;
    perform set_config('request.jwt.claim.sub', actor::text, true);
    if public.is_admin(actor) then raise exception 'UNREADY_ADMIN_RETAINED_AUTHORITY: %', fixture; end if;
    begin
      perform public.admin_set_identity(target, 'admin');
      raise exception 'UNREADY_ADMIN_CHANGED_IDENTITY: %', fixture;
    exception when others then
      if sqlerrm <> 'FORBIDDEN' then raise; end if;
    end;
    begin
      perform public.deactivate_staff(current_setting('profile_state_test.admin')::uuid, null);
      raise exception 'UNREADY_ADMIN_DEACTIVATED_STAFF: %', fixture;
    exception when others then
      if sqlerrm <> 'FORBIDDEN' then raise; end if;
    end;
  end loop;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('profile_state_test.admin'), true);
do $$
declare actor uuid := auth.uid(); target uuid := current_setting('profile_state_test.staff')::uuid;
begin
  if not public.is_admin(actor) then raise exception 'ACTIVE_ADMIN_REJECTED'; end if;
  if public.is_admin(current_setting('profile_state_test.inactive')::uuid)
    or public.is_admin(current_setting('profile_state_test.locked')::uuid) then
    raise exception 'UNAVAILABLE_ADMIN_TARGET_ACCEPTED';
  end if;
  if not public.is_admin(current_setting('profile_state_test.pending_password')::uuid) then
    raise exception 'PENDING_PASSWORD_TARGET_SEMANTICS_CHANGED';
  end if;

  -- Ordinary profile edits and the existing trusted identity RPC still work.
  update public.profiles set display_name = '测试-账户状态-已编辑', is_active = true where id = actor;
  perform public.admin_set_identity(target, 'staff');
  if (select role from public.profiles where id = target) <> 'staff' then
    raise exception 'INITIAL_STAFF_IDENTITY_CONFIGURATION_FAILED';
  end if;
  perform set_config('app.allow_profile_role_update', '', true);

  -- Even an active administrator cannot change activation through a direct
  -- self-profile write, including with the unrelated role-update flag present.
  perform set_config('app.allow_profile_role_update', '1', true);
  begin
    update public.profiles set is_active = false where id = actor;
    raise exception 'DIRECT_ADMIN_ACTIVATION_WRITE_ACCEPTED';
  exception when others then
    if sqlerrm <> 'PROFILE_ACTIVE_STATE_TRUSTED_OPERATION_REQUIRED' then raise; end if;
  end;
  perform set_config('app.allow_profile_role_update', '', true);

  perform public.deactivate_staff(target, null);
  if (select is_active from public.profiles where id = target) is distinct from false then
    raise exception 'TRUSTED_STAFF_DEACTIVATION_FAILED';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('profile_state_test.staff'), true);
do $$
begin
  if public.is_staff(auth.uid()) then raise exception 'DEACTIVATED_STAFF_RETAINED_AUTHORITY'; end if;
  begin
    update public.profiles set is_active = true where id = auth.uid();
    raise exception 'DEACTIVATED_STAFF_SELF_REACTIVATED';
  exception when others then
    if sqlerrm <> 'PROFILE_ACTIVE_STATE_TRUSTED_OPERATION_REQUIRED' then raise; end if;
  end;
  if (select is_active from public.profiles where id = auth.uid()) is distinct from false then
    raise exception 'FAILED_REACTIVATION_CHANGED_STATE';
  end if;
end;
$$;
reset role;

-- Trusted service maintenance can restore activation without a new bypass
-- flag. Existing account/role/password field protections remain unchanged.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set is_active = true where id = current_setting('profile_state_test.staff')::uuid;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', current_setting('profile_state_test.staff'), true);
do $$
begin
  if not public.is_staff(auth.uid()) then raise exception 'SERVICE_REACTIVATION_FAILED'; end if;
  begin
    update public.profiles set account_status = 'locked' where id = auth.uid();
    raise exception 'EXISTING_ACCOUNT_STATUS_PROTECTION_LOST';
  exception when others then
    if sqlerrm <> 'protected profile fields can only be changed by a trusted operation' then raise; end if;
  end;
end;
$$;
reset role;

rollback;
