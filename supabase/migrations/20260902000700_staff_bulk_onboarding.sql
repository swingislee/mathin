-- DEV-STAFF-ONBOARD-1: audited, atomic bulk staff invitations.
--
-- The importer deliberately creates invitations rather than Auth users. A
-- person chooses their own password through the existing email/phone invite
-- registration flow; the approved display name and role intents are applied
-- only after that invite is accepted.

-- ---------------------------------------------------------------------------
-- 1. Extend the shared ImportBatch ledger and retain approved invite intent.
-- ---------------------------------------------------------------------------

alter table public.data_import_batches
  drop constraint data_import_batches_import_kind_check;
alter table public.data_import_batches
  add constraint data_import_batches_import_kind_check
  check (import_kind in ('students', 'staff'));

alter table public.data_import_rows
  drop constraint data_import_rows_normalized_key_check;
alter table public.data_import_rows
  add constraint data_import_rows_normalized_key_check
  check (length(normalized_key) between 1 and 320);

alter table public.staff_invitations
  add column display_name text,
  add constraint staff_invitations_display_name_check
    check (display_name is null or length(trim(display_name)) between 1 and 100);

create table public.staff_invitation_role_assignments (
  invitation_id uuid not null references public.staff_invitations(id) on delete cascade,
  role_id uuid not null references public.staff_roles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (invitation_id, role_id)
);

create index staff_invitation_role_assignments_role_idx
  on public.staff_invitation_role_assignments(role_id, invitation_id);

alter table public.staff_invitation_role_assignments enable row level security;

create policy staff_invitation_role_assignments_manager_read
  on public.staff_invitation_role_assignments
  for select to authenticated
  using (public.has_perm((select auth.uid()), 'staff.manage'));

revoke all on public.staff_invitation_role_assignments from public, anon, authenticated;
grant select on public.staff_invitation_role_assignments to authenticated;

-- Apply the approved name and roles after handle_new_user has created the
-- profile and marked the invitation accepted. A role that gained
-- permission.configure while an invitation was pending remains admin-only.
create or replace function public.apply_accepted_staff_invitation_intent()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  requested_count integer := 0;
  assigned_count integer := 0;
begin
  if new.status <> 'accepted'
     or old.status = 'accepted'
     or new.accepted_by is null
  then
    return new;
  end if;

  if nullif(trim(coalesce(new.display_name, '')), '') is not null then
    update public.profiles
       set display_name = trim(new.display_name)
     where id = new.accepted_by;
  end if;

  select count(*) into requested_count
    from public.staff_invitation_role_assignments assignment
   where assignment.invitation_id = new.id;

  insert into public.staff_role_members(user_id, role_id, granted_by)
  select new.accepted_by, assignment.role_id, assignment.assigned_by
    from public.staff_invitation_role_assignments assignment
   where assignment.invitation_id = new.id
     and (
       not exists (
         select 1 from public.role_permissions permission_row
          where permission_row.role_id = assignment.role_id
            and permission_row.perm_key = 'permission.configure'
       )
       or public.is_admin(assignment.assigned_by)
     )
  on conflict do nothing;
  get diagnostics assigned_count = row_count;

  if requested_count > 0 then
    perform public.emit_domain_event(
      'staff.invitation_roles_applied',
      'staff_invitation',
      new.id,
      jsonb_build_object(
        'userId', new.accepted_by,
        'requestedRoles', requested_count,
        'assignedRoles', assigned_count
      ),
      new.accepted_by,
      null
    );
  end if;
  return new;
end
$$;

create trigger staff_invitation_apply_intent_after_accept
after update of status, accepted_by on public.staff_invitations
for each row execute function public.apply_accepted_staff_invitation_intent();

revoke all on function public.apply_accepted_staff_invitation_intent() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Read, preview, and atomically apply a staff invitation batch.
-- ---------------------------------------------------------------------------

create or replace function public.get_staff_import_batch(p_batch_id uuid)
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
  if v_batch.import_kind <> 'staff' then raise exception 'BATCH_KIND_MISMATCH'; end if;
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
    'issued', v_batch.inserted_rows,
    'expiresAt', v_batch.expires_at,
    'rows', v_rows,
    'codesAvailable', false,
    'invitations', '[]'::jsonb
  );
end
$$;

create or replace function public.preview_staff_import(
  p_template_version text,
  p_rows jsonb,
  p_idempotency_key text,
  p_input_hash text
) returns jsonb
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch_id uuid;
  v_existing public.data_import_batches%rowtype;
  v_fingerprint text;
  v_item jsonb;
  v_row_no integer;
  v_name text;
  v_identifier text;
  v_identifier_type text;
  v_identifier_normalized text;
  v_normalized_key text;
  v_role_keys text[];
  v_valid_days integer;
  v_errors text[];
  v_status text;
  v_target_id uuid;
  v_valid integer := 0;
  v_duplicate integer := 0;
  v_error integer := 0;
begin
  if v_uid is null or not public.has_perm(v_uid, 'staff.manage') then raise exception 'FORBIDDEN'; end if;
  if p_template_version is distinct from 'mathin-staff-v1' then raise exception 'INVALID_TEMPLATE'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'INVALID_IDEMPOTENCY';
  end if;
  if p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_HASH'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'INVALID_ROWS';
  end if;

  v_fingerprint := md5(p_template_version || ':' || p_rows::text);
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':staff:' || trim(p_idempotency_key)));
  select * into v_existing
    from public.data_import_batches
   where created_by = v_uid
     and import_kind = 'staff'
     and idempotency_key = trim(p_idempotency_key);
  if v_existing.id is not null then
    if v_existing.input_fingerprint <> v_fingerprint
       or v_existing.input_hash <> p_input_hash
       or v_existing.template_version <> p_template_version
    then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return public.get_staff_import_batch(v_existing.id);
  end if;

  insert into public.data_import_batches(
    import_kind, template_version, idempotency_key, input_hash, input_fingerprint,
    total_rows, valid_rows, duplicate_rows, error_rows, created_by
  ) values (
    'staff', p_template_version, trim(p_idempotency_key), p_input_hash, v_fingerprint,
    jsonb_array_length(p_rows), 0, 0, jsonb_array_length(p_rows), v_uid
  ) returning id into v_batch_id;

  for v_item, v_row_no in
    select value, ordinality::integer
      from jsonb_array_elements(p_rows) with ordinality
  loop
    v_errors := '{}';
    v_target_id := null;
    v_identifier_normalized := null;
    v_role_keys := '{}';

    if jsonb_typeof(v_item) is distinct from 'object' then
      v_name := '';
      v_identifier := '';
      v_identifier_type := 'email';
      v_valid_days := 7;
      v_errors := array_append(v_errors, 'MALFORMED_ROW');
    else
      v_name := trim(coalesce(v_item->>'name', ''));
      v_identifier := trim(coalesce(v_item->>'identifier', ''));
      v_identifier_type := case when position('@' in v_identifier) > 0 then 'email' else 'phone' end;

      if v_name = '' then v_errors := array_append(v_errors, 'EMPTY_NAME'); end if;
      if length(v_name) > 100 then v_errors := array_append(v_errors, 'NAME_TOO_LONG'); end if;
      if v_identifier = '' then v_errors := array_append(v_errors, 'EMPTY_IDENTIFIER'); end if;
      if length(v_identifier) > 254 then v_errors := array_append(v_errors, 'IDENTIFIER_TOO_LONG'); end if;

      if jsonb_typeof(v_item->'roles') is distinct from 'array' then
        v_errors := array_append(v_errors, 'INVALID_ROLES');
      else
        select coalesce(array_agg(distinct lower(trim(role_key)) order by lower(trim(role_key))), '{}')
          into v_role_keys
          from jsonb_array_elements_text(v_item->'roles') role_value(role_key)
         where trim(role_key) <> '';
        if cardinality(v_role_keys) = 0 then
          v_errors := array_append(v_errors, 'EMPTY_ROLES');
        elsif cardinality(v_role_keys) > 20
           or exists(select 1 from unnest(v_role_keys) role_key where length(role_key) > 80)
        then
          v_errors := array_append(v_errors, 'INVALID_ROLES');
        elsif exists(
          select 1
            from unnest(v_role_keys) role_key
            left join public.staff_roles role_row on role_row.key = role_key
           where role_row.id is null
        ) then
          v_errors := array_append(v_errors, 'ROLE_NOT_FOUND');
        elsif not public.is_admin(v_uid) and exists(
          select 1
            from public.staff_roles role_row
            join public.role_permissions permission_row on permission_row.role_id = role_row.id
           where role_row.key = any(v_role_keys)
             and permission_row.perm_key = 'permission.configure'
        ) then
          v_errors := array_append(v_errors, 'ROLE_REQUIRES_ADMIN');
        end if;
      end if;

      begin
        v_valid_days := (v_item->>'validDays')::integer;
        if v_valid_days not between 1 and 30 then
          v_errors := array_append(v_errors, 'INVALID_EXPIRY');
        end if;
      exception when others then
        v_valid_days := 7;
        v_errors := array_append(v_errors, 'INVALID_EXPIRY');
      end;

      if v_identifier <> '' and length(v_identifier) <= 254 then
        begin
          v_identifier_normalized := public.normalize_login_identifier(v_identifier_type, v_identifier);
        exception when others then
          v_identifier_normalized := null;
          v_errors := array_append(v_errors, 'INVALID_IDENTIFIER');
        end;
      end if;
    end if;

    v_normalized_key := case
      when v_identifier_normalized is null then 'row:' || v_row_no::text
      else 'identifier:' || v_identifier_type || ':' || v_identifier_normalized
    end;

    if cardinality(v_errors) > 0 then
      v_status := 'error';
      v_error := v_error + 1;
    else
      select user_row.id into v_target_id
        from auth.users user_row
       where (v_identifier_type = 'email' and lower(user_row.email) = v_identifier_normalized)
          or (v_identifier_type = 'phone' and user_row.phone = v_identifier_normalized)
       order by user_row.created_at
       limit 1;

      if v_target_id is not null then
        v_status := 'duplicate';
        v_errors := array_append(v_errors, 'ACCOUNT_EXISTS');
        v_duplicate := v_duplicate + 1;
      else
        select invitation_row.id into v_target_id
          from public.staff_invitations invitation_row
         where invitation_row.identifier_type = v_identifier_type
           and invitation_row.identifier_normalized = v_identifier_normalized
           and invitation_row.status = 'pending'
           and invitation_row.expires_at > now()
         limit 1;

        if v_target_id is not null then
          v_status := 'duplicate';
          v_errors := array_append(v_errors, 'INVITATION_ALREADY_PENDING');
          v_duplicate := v_duplicate + 1;
        elsif exists (
          select 1 from public.data_import_rows prior
           where prior.batch_id = v_batch_id
             and prior.normalized_key = v_normalized_key
             and prior.row_status <> 'error'
        ) then
          v_status := 'duplicate';
          v_errors := array_append(v_errors, 'DUPLICATE_IDENTIFIER');
          v_duplicate := v_duplicate + 1;
        else
          v_status := 'valid';
          v_valid := v_valid + 1;
        end if;
      end if;
    end if;

    insert into public.data_import_rows(
      batch_id, row_no, row_status, normalized_key, payload, error_codes, target_id
    ) values (
      v_batch_id,
      v_row_no,
      v_status,
      v_normalized_key,
      jsonb_build_object(
        'name', left(v_name, 100),
        'identifier', left(v_identifier, 254),
        'identifierType', v_identifier_type,
        'identifierNormalized', v_identifier_normalized,
        'roleKeys', to_jsonb(v_role_keys),
        'validDays', v_valid_days
      ),
      v_errors,
      v_target_id
    );
  end loop;

  update public.data_import_batches
     set valid_rows = v_valid,
         duplicate_rows = v_duplicate,
         error_rows = v_error
   where id = v_batch_id;

  perform public.emit_domain_event(
    'data_import.validated',
    'data_import_batch',
    v_batch_id,
    jsonb_build_object(
      'kind', 'staff',
      'templateVersion', p_template_version,
      'inputHash', p_input_hash,
      'total', jsonb_array_length(p_rows),
      'valid', v_valid,
      'duplicates', v_duplicate,
      'errors', v_error
    ),
    v_uid,
    null
  );
  return public.get_staff_import_batch(v_batch_id);
end
$$;

create or replace function public.apply_staff_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_row record;
  v_role_keys text[];
  v_invitation record;
  v_invitations jsonb := '[]'::jsonb;
  v_issued integer := 0;
begin
  if v_uid is null or not public.has_perm(v_uid, 'staff.manage') then raise exception 'FORBIDDEN'; end if;
  select * into v_batch
    from public.data_import_batches
   where id = p_batch_id
   for update;
  if v_batch.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if v_batch.import_kind <> 'staff' then raise exception 'BATCH_KIND_MISMATCH'; end if;
  if v_batch.created_by <> v_uid and not public.is_admin(v_uid) then raise exception 'FORBIDDEN'; end if;
  if v_batch.status = 'completed' then return public.get_staff_import_batch(v_batch.id); end if;
  if v_batch.expires_at <= now() then raise exception 'BATCH_EXPIRED'; end if;
  if v_batch.error_rows > 0 then raise exception 'BATCH_HAS_ERRORS'; end if;

  -- Lock and revalidate every target before creating the first invitation so a
  -- stale batch fails atomically rather than producing a partial handoff list.
  for v_row in
    select * from public.data_import_rows
     where batch_id = v_batch.id and row_status = 'valid'
     order by row_no
     for update
  loop
    perform pg_advisory_xact_lock(hashtext('staff-invite:' || v_row.normalized_key));
    select coalesce(array_agg(role_key order by role_key), '{}') into v_role_keys
      from jsonb_array_elements_text(v_row.payload->'roleKeys') role_value(role_key);

    if cardinality(v_role_keys) = 0
       or exists(
         select 1 from unnest(v_role_keys) role_key
         left join public.staff_roles role_row on role_row.key = role_key
         where role_row.id is null
       )
       or (
         not public.is_admin(v_uid)
         and exists(
           select 1
             from public.staff_roles role_row
             join public.role_permissions permission_row on permission_row.role_id = role_row.id
            where role_row.key = any(v_role_keys)
              and permission_row.perm_key = 'permission.configure'
         )
       )
    then
      raise exception 'BATCH_STALE';
    end if;

    if exists(
      select 1 from auth.users user_row
       where (v_row.payload->>'identifierType' = 'email'
              and lower(user_row.email) = v_row.payload->>'identifierNormalized')
          or (v_row.payload->>'identifierType' = 'phone'
              and user_row.phone = v_row.payload->>'identifierNormalized')
    ) or exists(
      select 1 from public.staff_invitations invitation_row
       where invitation_row.identifier_type = v_row.payload->>'identifierType'
         and invitation_row.identifier_normalized = v_row.payload->>'identifierNormalized'
         and invitation_row.status = 'pending'
         and invitation_row.expires_at > now()
    ) then
      raise exception 'BATCH_STALE';
    end if;
  end loop;

  for v_row in
    select * from public.data_import_rows
     where batch_id = v_batch.id and row_status = 'valid'
     order by row_no
     for update
  loop
    select * into v_invitation
      from public.issue_staff_identity_invitation(
        v_row.payload->>'identifierType',
        v_row.payload->>'identifierNormalized',
        (v_row.payload->>'validDays')::integer
      );

    update public.staff_invitations
       set display_name = v_row.payload->>'name'
     where id = v_invitation.invitation_id;

    insert into public.staff_invitation_role_assignments(invitation_id, role_id, assigned_by)
    select v_invitation.invitation_id, role_row.id, v_uid
      from public.staff_roles role_row
     where role_row.key in (
       select role_key from jsonb_array_elements_text(v_row.payload->'roleKeys') role_value(role_key)
     );

    update public.data_import_rows
       set row_status = 'inserted', target_id = v_invitation.invitation_id
     where batch_id = v_batch.id and row_no = v_row.row_no;

    v_invitations := v_invitations || jsonb_build_array(jsonb_build_object(
      'row', v_row.row_no,
      'name', v_row.payload->>'name',
      'identifierType', v_invitation.identifier_type,
      'identifier', v_invitation.identifier_normalized,
      'roleKeys', v_row.payload->'roleKeys',
      'inviteCode', v_invitation.invite_code,
      'expiresAt', v_invitation.expires_at
    ));
    v_issued := v_issued + 1;
  end loop;

  update public.data_import_batches
     set status = 'completed',
         inserted_rows = v_issued,
         completed_at = now()
   where id = v_batch.id;

  -- Names/contact identifiers no longer need to remain in the generic batch
  -- payload after the durable invitation and role intent have been created.
  update public.data_import_rows
     set payload = null
   where batch_id = v_batch.id;

  perform public.emit_domain_event(
    'data_import.completed',
    'data_import_batch',
    v_batch.id,
    jsonb_build_object(
      'kind', 'staff',
      'templateVersion', v_batch.template_version,
      'inputHash', v_batch.input_hash,
      'issued', v_issued,
      'duplicates', v_batch.duplicate_rows
    ),
    v_uid,
    null
  );

  return public.get_staff_import_batch(v_batch.id) || jsonb_build_object(
    'codesAvailable', true,
    'invitations', v_invitations
  );
end
$$;

revoke all on function public.get_staff_import_batch(uuid) from public, anon, authenticated;
revoke all on function public.preview_staff_import(text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.apply_staff_import(uuid) from public, anon, authenticated;
grant execute on function public.get_staff_import_batch(uuid) to authenticated;
grant execute on function public.preview_staff_import(text, jsonb, text, text) to authenticated;
grant execute on function public.apply_staff_import(uuid) to authenticated;
