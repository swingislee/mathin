-- DEV-STAFF-ONBOARD-1 follow-up: direct staff account provisioning.
--
-- A supervisor or above creates the Auth account, profile, and approved staff
-- roles immediately. The generated handoff secret is the initial password.
-- Until that password is replaced, the account remains schedulable as a staff
-- target but cannot exercise staff permissions or staff-wide RLS reads.

-- ---------------------------------------------------------------------------
-- 1. Narrow onboarding permission and first-login state.
-- ---------------------------------------------------------------------------

create or replace function public.school_permission_keys()
returns text[] language sql immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','course.view.all','course.product.create','course.assignment.manage',
    'subject.microcourse.scene.manage','subject.microcourse.scope.manage','subject.microcourse.maintainer.assign',
    'subject.microcourse.course.create','subject.microcourse.branch.create','subject.microcourse.commit.create',
    'subject.microcourse.default.select',
    'courseware.template.edit','courseware.overlay.edit','courseware.microcourse.author','courseware.page.edit','courseware.asset.manage',
    'courseware.release.publish','courseware.review','courseware.emergency_publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage',
    'schedule.view.all','schedule.manage','attendance.mark','grading.write','report.view.all','session.void','session.postwork.manage',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view',
    'staff.invite','staff.manage','permission.configure','registration.invite.manage','organization.settings.manage','organization.profile.manage',
    'location.manage','system.operations.manage','account.support.manage','work_item.manage','approval.manage','audit.view','testdata.purge'
  ]::text[]
$$;

insert into public.role_permissions(role_id, perm_key)
select role_row.id, 'staff.invite'
  from public.staff_roles role_row
 where role_row.key = 'director'
    or exists(
      select 1 from public.role_permissions existing
       where existing.role_id = role_row.id and existing.perm_key = 'staff.manage'
    )
on conflict do nothing;

alter table public.profiles
  add column password_change_required boolean not null default false,
  add column initial_password_set_at timestamptz,
  add column password_changed_at timestamptz,
  add constraint profiles_initial_password_state_check check (
    not password_change_required
    or (initial_password_set_at is not null and password_changed_at is null)
  );

comment on column public.profiles.password_change_required is
  'True only for directly provisioned staff until the trusted forced-password action succeeds.';

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
as $$
declare
  role_update_allowed boolean :=
    coalesce(current_setting('app.allow_profile_role_update', true), '') = '1';
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if new.role is distinct from old.role and not role_update_allowed then
      raise exception 'protected profile fields can only be changed by a trusted operation';
    end if;

    if new.privacy_consented_at is distinct from old.privacy_consented_at
       or new.children_privacy_consented_at is distinct from old.children_privacy_consented_at
       or new.account_status is distinct from old.account_status
       or new.account_locked_at is distinct from old.account_locked_at
       or new.account_locked_by is distinct from old.account_locked_by
       or new.account_lock_reason is distinct from old.account_lock_reason
       or new.password_change_required is distinct from old.password_change_required
       or new.initial_password_set_at is distinct from old.initial_password_set_at
       or new.password_changed_at is distinct from old.password_changed_at then
      raise exception 'protected profile fields can only be changed by a trusted operation';
    end if;
  end if;

  return new;
end
$$;

-- is_staff is used both for the current actor and for assignment targets. A
-- directly provisioned employee must remain a valid scheduling target, while
-- calls made as that same employee remain closed until the password changes.
create or replace function public.is_staff(uid uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.profiles profile_row
     where profile_row.id = uid
       and profile_row.role in ('staff','admin')
       and profile_row.is_active
       and profile_row.account_status = 'active'
       and (uid is distinct from auth.uid() or not profile_row.password_change_required)
  )
$$;

create or replace function public.has_perm(uid uuid, p_key text)
returns boolean
language sql security definer stable set search_path = public, pg_temp
as $$
  select (p_key not like 'finance.%' or public.is_feature_enabled('finance.enabled'))
    and exists(
      select 1
        from public.profiles profile_row
       where profile_row.id = uid
         and profile_row.role in ('staff','admin')
         and profile_row.is_active
         and profile_row.account_status = 'active'
         and (uid is distinct from auth.uid() or not profile_row.password_change_required)
         and (
           profile_row.role = 'admin'
           or exists(
             select 1
               from public.staff_role_members member_row
               join public.role_permissions permission_row on permission_row.role_id = member_row.role_id
              where member_row.user_id = uid and permission_row.perm_key = p_key
           )
           or (
             p_key = 'staff.manage'
             and current_setting('app.staff_invite_preview_actor', true) = uid::text
             and exists(
               select 1
                 from public.staff_role_members member_row
                 join public.role_permissions permission_row on permission_row.role_id = member_row.role_id
                where member_row.user_id = uid and permission_row.perm_key = 'staff.invite'
             )
           )
         )
    )
$$;

create or replace function public.staff_has_perm(uid uuid, p_key text)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$ select public.has_perm(uid, p_key) $$;

-- The legacy preview implementation is mature and remains the single parser.
-- This wrapper grants its staff.manage check only for this nested transaction
-- and only to the exact staff.invite actor.
create or replace function public.preview_staff_account_import(
  p_template_version text,
  p_rows jsonb,
  p_idempotency_key text,
  p_input_hash text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'staff.invite') then raise exception 'FORBIDDEN'; end if;
  perform set_config('app.staff_invite_preview_actor', uid::text, true);
  return public.preview_staff_import(p_template_version, p_rows, p_idempotency_key, p_input_hash);
end
$$;

revoke all on function public.preview_staff_account_import(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.preview_staff_account_import(text, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Direct-provisioning reservation and resumable ImportBatch rows.
-- ---------------------------------------------------------------------------

alter table public.staff_invitations
  add column provisioning_mode text not null default 'claim',
  add column source_batch_id uuid references public.data_import_batches(id) on delete set null,
  add column source_row_no integer,
  add constraint staff_invitations_provisioning_mode_check
    check (provisioning_mode in ('claim','direct')),
  add constraint staff_invitations_direct_source_check check (
    (provisioning_mode = 'claim' and source_batch_id is null and source_row_no is null)
    or
    (provisioning_mode = 'direct' and source_batch_id is not null and source_row_no between 1 and 500)
  );

create unique index staff_invitations_one_pending_source_row_idx
  on public.staff_invitations(source_batch_id, source_row_no)
  where status = 'pending' and source_batch_id is not null;

create or replace function public.complete_staff_import_batch_if_ready(p_batch_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count integer;
begin
  if exists(
    select 1 from public.data_import_batches batch_row
     where batch_row.id = p_batch_id and batch_row.import_kind = 'staff'
       and batch_row.status = 'validated' and batch_row.error_rows = 0
  ) and not exists(
    select 1 from public.data_import_rows row_item
     where row_item.batch_id = p_batch_id and row_item.row_status = 'valid'
  ) then
    select count(*)::integer into inserted_count
      from public.data_import_rows row_item
     where row_item.batch_id = p_batch_id and row_item.row_status = 'inserted';

    update public.data_import_batches
       set status = 'completed', inserted_rows = inserted_count, completed_at = now()
     where id = p_batch_id and status = 'validated';

    if found then
      update public.data_import_rows set payload = null where batch_id = p_batch_id;
      perform public.emit_domain_event(
        'data_import.completed', 'data_import_batch', p_batch_id,
        jsonb_build_object('kind', 'staff', 'created', inserted_count),
        auth.uid(), null
      );
    end if;
  end if;
end
$$;

create or replace function public.complete_staff_import_row(
  p_batch_id uuid,
  p_row_no integer,
  p_user_id uuid
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.data_import_rows
     set row_status = 'inserted', target_id = p_user_id, error_codes = '{}'
   where batch_id = p_batch_id and row_no = p_row_no and row_status in ('valid','inserted');
  perform public.complete_staff_import_batch_if_ready(p_batch_id);
end
$$;

revoke all on function public.complete_staff_import_batch_if_ready(uuid) from public, anon, authenticated;
revoke all on function public.complete_staff_import_row(uuid, integer, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Auth trigger: direct accounts do not forge employee consent.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  supplied_code text := upper(trim(coalesce(new.raw_user_meta_data ->> 'registration_invite_code', '')));
  clean_type text;
  clean_identifier text;
  staff_invite public.staff_invitations%rowtype;
  is_general_invite boolean := false;
  is_direct boolean := false;
  privacy_version text;
  children_version text;
begin
  if nullif(trim(coalesce(new.email, '')), '') is not null
     and nullif(trim(coalesce(new.phone, '')), '') is not null
  then raise exception 'MULTIPLE_PRIMARY_IDENTIFIERS'; end if;

  if nullif(trim(coalesce(new.phone, '')), '') is not null then
    clean_type := 'phone';
    clean_identifier := public.normalize_login_identifier(clean_type, new.phone);
  elsif nullif(trim(coalesce(new.email, '')), '') is not null then
    clean_type := 'email';
    clean_identifier := public.normalize_login_identifier(clean_type, new.email);
  else
    raise exception 'LOGIN_IDENTIFIER_REQUIRED';
  end if;

  if clean_type = 'email' then
    select exists(
      select 1 from public.registration_invite_settings setting_row
       where setting_row.id = 1 and setting_row.is_active and setting_row.code = supplied_code
    ) into is_general_invite;
  end if;

  select * into staff_invite
    from public.staff_invitations invitation_row
   where invitation_row.status = 'pending'
     and invitation_row.expires_at > now()
     and invitation_row.identifier_type = clean_type
     and invitation_row.identifier_normalized = clean_identifier
     and invitation_row.code_hash = md5(supplied_code)
   for update;

  is_direct := staff_invite.id is not null and staff_invite.provisioning_mode = 'direct';
  if not is_general_invite and staff_invite.id is null then
    raise exception 'INVALID_REGISTRATION_INVITE';
  end if;
  if not is_direct and (
    new.raw_user_meta_data ->> 'privacy_consent' is distinct from 'true'
    or new.raw_user_meta_data ->> 'children_privacy_consent' is distinct from 'true'
  ) then
    raise exception 'REGISTRATION_CONSENT_REQUIRED';
  end if;

  insert into public.profiles(
    id, display_name, role, privacy_consented_at, children_privacy_consented_at,
    password_change_required, initial_password_set_at
  ) values(
    new.id,
    coalesce(
      case when is_direct then nullif(trim(staff_invite.display_name), '') end,
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      case when clean_type = 'email' then split_part(clean_identifier, '@', 1)
           else 'user-' || right(clean_identifier, 4) end
    ),
    case when staff_invite.id is null then 'student' else 'staff' end,
    case when is_direct then null else now() end,
    case when is_direct then null else now() end,
    is_direct,
    case when is_direct then now() else null end
  ) on conflict(id) do nothing;

  if not is_direct then
    select version into privacy_version
      from public.consent_policies where policy_kind = 'privacy' and required;
    select version into children_version
      from public.consent_policies where policy_kind = 'children_privacy' and required;
    insert into public.consent_records(
      actor_user_id, subject_user_id, policy_kind, policy_version, scope, decision, source
    ) values
      (new.id, new.id, 'privacy', privacy_version, 'account', 'granted', 'registration'),
      (new.id, new.id, 'children_privacy', children_version, 'account', 'granted', 'registration');
  end if;

  insert into public.account_identifier_assurances(
    user_id, identifier_type, identifier_hash, attestation_source,
    provider_verified, provider_verified_at
  ) values(
    new.id,
    clean_type,
    encode(extensions.digest(clean_identifier, 'sha256'), 'hex'),
    case when staff_invite.id is null then 'global_invite' else 'staff_invite' end,
    false,
    null
  ) on conflict(user_id, identifier_type) do nothing;

  if staff_invite.id is not null then
    update public.staff_invitations
       set status = 'accepted', accepted_by = new.id, accepted_at = now()
     where id = staff_invite.id;

    if is_direct then
      perform public.complete_staff_import_row(staff_invite.source_batch_id, staff_invite.source_row_no, new.id);
    end if;

    perform public.emit_domain_event(
      case when is_direct then 'staff.account_provisioned' else 'staff.invitation_accepted' end,
      'staff_invitation', staff_invite.id,
      jsonb_build_object('userId', new.id, 'identifierType', clean_type, 'direct', is_direct),
      new.id, null
    );
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Per-row reservation, failure recording, and finalization RPCs.
-- ---------------------------------------------------------------------------

create or replace function public.get_staff_import_provisioning_rows(p_batch_id uuid)
returns table(
  row_no integer,
  display_name text,
  identifier_type text,
  identifier_normalized text,
  role_keys text[]
)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  batch_row public.data_import_batches%rowtype;
begin
  if uid is null or not public.has_perm(uid, 'staff.invite') then raise exception 'FORBIDDEN'; end if;
  select * into batch_row from public.data_import_batches where id = p_batch_id;
  if batch_row.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if batch_row.import_kind <> 'staff' then raise exception 'BATCH_KIND_MISMATCH'; end if;
  if batch_row.created_by <> uid and not public.is_admin(uid) then raise exception 'FORBIDDEN'; end if;
  if batch_row.expires_at <= now() then raise exception 'BATCH_EXPIRED'; end if;
  if batch_row.error_rows > 0 then raise exception 'BATCH_HAS_ERRORS'; end if;

  perform public.complete_staff_import_batch_if_ready(p_batch_id);
  return query
    select item.row_no,
           item.payload->>'name',
           item.payload->>'identifierType',
           item.payload->>'identifierNormalized',
           array(select jsonb_array_elements_text(item.payload->'roleKeys'))
      from public.data_import_rows item
     where item.batch_id = p_batch_id and item.row_status = 'valid'
     order by item.row_no;
end
$$;

create or replace function public.prepare_staff_import_account(
  p_batch_id uuid,
  p_row_no integer,
  p_code_hash text
) returns table(
  invitation_id uuid,
  display_name text,
  identifier_type text,
  identifier_normalized text,
  role_keys text[],
  expires_at timestamptz
)
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  uid uuid := auth.uid();
  batch_row public.data_import_batches%rowtype;
  item public.data_import_rows%rowtype;
  roles text[];
  new_invitation_id uuid;
  expiry timestamptz := now() + interval '15 minutes';
begin
  if uid is null or not public.has_perm(uid, 'staff.invite') then raise exception 'FORBIDDEN'; end if;
  if p_code_hash is null or p_code_hash !~ '^[a-f0-9]{32}$' then raise exception 'INVALID_INITIAL_PASSWORD_HASH'; end if;
  perform pg_advisory_xact_lock(hashtext(p_batch_id::text || ':' || p_row_no::text));

  select * into batch_row from public.data_import_batches where id = p_batch_id for update;
  if batch_row.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if batch_row.import_kind <> 'staff' then raise exception 'BATCH_KIND_MISMATCH'; end if;
  if batch_row.created_by <> uid and not public.is_admin(uid) then raise exception 'FORBIDDEN'; end if;
  if batch_row.status = 'completed' then raise exception 'BATCH_ALREADY_COMPLETED'; end if;
  if batch_row.expires_at <= now() then raise exception 'BATCH_EXPIRED'; end if;
  if batch_row.error_rows > 0 then raise exception 'BATCH_HAS_ERRORS'; end if;

  select * into item
    from public.data_import_rows
   where batch_id = p_batch_id and row_no = p_row_no
   for update;
  if item.batch_id is null then raise exception 'ROW_NOT_FOUND'; end if;
  if item.row_status <> 'valid' or item.payload is null then raise exception 'ROW_NOT_READY'; end if;

  select coalesce(array_agg(role_key order by role_key), '{}') into roles
    from jsonb_array_elements_text(item.payload->'roleKeys') role_value(role_key);
  if cardinality(roles) = 0
     or exists(
       select 1 from unnest(roles) role_key
       left join public.staff_roles role_row on role_row.key = role_key
       where role_row.id is null
     )
     or (
       not public.is_admin(uid)
       and exists(
         select 1 from public.staff_roles role_row
         join public.role_permissions permission_row on permission_row.role_id = role_row.id
         where role_row.key = any(roles) and permission_row.perm_key = 'permission.configure'
       )
     ) then raise exception 'BATCH_STALE'; end if;

  if exists(
    select 1 from auth.users user_row
     where (item.payload->>'identifierType' = 'email' and lower(user_row.email) = item.payload->>'identifierNormalized')
        or (item.payload->>'identifierType' = 'phone' and user_row.phone = item.payload->>'identifierNormalized')
  ) then raise exception 'ACCOUNT_EXISTS'; end if;

  update public.staff_invitations invitation_row
     set status = 'expired'
   where invitation_row.source_batch_id = p_batch_id
     and invitation_row.source_row_no = p_row_no
     and invitation_row.status = 'pending'
     and invitation_row.expires_at <= now();
  if exists(
    select 1 from public.staff_invitations invitation_row
     where invitation_row.source_batch_id = p_batch_id
       and invitation_row.source_row_no = p_row_no
       and invitation_row.status = 'pending'
  ) then raise exception 'PROVISION_IN_PROGRESS'; end if;
  if exists(
    select 1 from public.staff_invitations invitation_row
     where invitation_row.identifier_type = item.payload->>'identifierType'
       and invitation_row.identifier_normalized = item.payload->>'identifierNormalized'
       and invitation_row.status = 'pending'
  ) then raise exception 'BATCH_STALE'; end if;

  insert into public.staff_invitations(
    email, identifier_type, identifier_normalized, code_hash, invited_by,
    expires_at, display_name, provisioning_mode, source_batch_id, source_row_no
  ) values(
    case when item.payload->>'identifierType' = 'email' then item.payload->>'identifierNormalized' else null end,
    item.payload->>'identifierType', item.payload->>'identifierNormalized', p_code_hash, uid,
    expiry, item.payload->>'name', 'direct', p_batch_id, p_row_no
  ) returning id into new_invitation_id;

  insert into public.staff_invitation_role_assignments(invitation_id, role_id, assigned_by)
  select new_invitation_id, role_row.id, uid
    from public.staff_roles role_row where role_row.key = any(roles);

  update public.data_import_rows set error_codes = '{}'
   where batch_id = p_batch_id and row_no = p_row_no;

  perform public.emit_domain_event(
    'staff.account_provisioning_prepared', 'staff_invitation', new_invitation_id,
    jsonb_build_object('batchId', p_batch_id, 'row', p_row_no, 'identifierType', item.payload->>'identifierType'),
    uid, null
  );

  return query select new_invitation_id, item.payload->>'name', item.payload->>'identifierType',
    item.payload->>'identifierNormalized', roles, expiry;
end
$$;

create or replace function public.record_staff_import_provision_failure(
  p_batch_id uuid,
  p_row_no integer,
  p_code text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'staff.invite') then raise exception 'FORBIDDEN'; end if;
  if p_code not in ('ACCOUNT_EXISTS','PROVISION_IN_PROGRESS','AUTH_PROVIDER_FAILED','PROVISION_FINALIZE_FAILED','BATCH_STALE') then
    raise exception 'INVALID_FAILURE_CODE';
  end if;
  update public.data_import_rows item
     set error_codes = array[p_code]
   where item.batch_id = p_batch_id and item.row_no = p_row_no and item.row_status = 'valid'
     and exists(
       select 1 from public.data_import_batches batch_row
        where batch_row.id = item.batch_id
          and (batch_row.created_by = uid or public.is_admin(uid))
      );
end
$$;

create or replace function public.cancel_staff_import_account(
  p_invitation_id uuid,
  p_failure_code text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); invitation_row public.staff_invitations%rowtype;
begin
  if uid is null or not public.has_perm(uid, 'staff.invite') then raise exception 'FORBIDDEN'; end if;
  select * into invitation_row from public.staff_invitations where id = p_invitation_id for update;
  if invitation_row.id is null or invitation_row.invited_by <> uid or invitation_row.provisioning_mode <> 'direct' then
    raise exception 'FORBIDDEN';
  end if;
  update public.staff_invitations set status = 'revoked', revoked_at = now()
   where id = p_invitation_id and status = 'pending';
  if found then
    perform public.record_staff_import_provision_failure(
      invitation_row.source_batch_id, invitation_row.source_row_no, p_failure_code
    );
  end if;
end
$$;

create or replace function public.finalize_staff_import_account(
  p_invitation_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); invitation_row public.staff_invitations%rowtype;
begin
  if uid is null or not public.has_perm(uid, 'staff.invite') then raise exception 'FORBIDDEN'; end if;
  select * into invitation_row from public.staff_invitations where id = p_invitation_id;
  if invitation_row.id is null
     or invitation_row.invited_by <> uid
     or invitation_row.provisioning_mode <> 'direct'
     or invitation_row.status <> 'accepted'
     or invitation_row.accepted_by <> p_user_id then raise exception 'PROVISION_FINALIZE_FAILED'; end if;
  perform public.complete_staff_import_row(invitation_row.source_batch_id, invitation_row.source_row_no, p_user_id);
end
$$;

revoke all on function public.get_staff_import_provisioning_rows(uuid) from public, anon, authenticated;
revoke all on function public.prepare_staff_import_account(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.record_staff_import_provision_failure(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.cancel_staff_import_account(uuid, text) from public, anon, authenticated;
revoke all on function public.finalize_staff_import_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_staff_import_provisioning_rows(uuid) to authenticated;
grant execute on function public.prepare_staff_import_account(uuid, integer, text) to authenticated;
grant execute on function public.record_staff_import_provision_failure(uuid, integer, text) to authenticated;
grant execute on function public.cancel_staff_import_account(uuid, text) to authenticated;
grant execute on function public.finalize_staff_import_account(uuid, uuid) to authenticated;

-- Keep the established response contract while reporting durable progress for
-- a partially provisioned batch. Initial passwords are intentionally never
-- reconstructed by this getter; they exist only in the action response that
-- created the corresponding Auth user.
create or replace function public.get_staff_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  batch_row public.data_import_batches%rowtype;
  rows_json jsonb;
  inserted_count integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into batch_row from public.data_import_batches where id = p_batch_id;
  if batch_row.id is null then raise exception 'BATCH_NOT_FOUND'; end if;
  if batch_row.import_kind <> 'staff' then raise exception 'BATCH_KIND_MISMATCH'; end if;
  if batch_row.created_by <> uid and not public.has_perm(uid, 'audit.view') then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'row', item.row_no,
    'status', item.row_status,
    'errors', to_jsonb(item.error_codes),
    'targetId', item.target_id
  ) order by item.row_no), '[]'::jsonb),
  count(*) filter(where item.row_status = 'inserted')::integer
    into rows_json, inserted_count
    from public.data_import_rows item
   where item.batch_id = batch_row.id;

  return jsonb_build_object(
    'batchId', batch_row.id,
    'status', batch_row.status,
    'templateVersion', batch_row.template_version,
    'inputHash', batch_row.input_hash,
    'total', batch_row.total_rows,
    'valid', batch_row.valid_rows,
    'dup', batch_row.duplicate_rows,
    'errorCount', batch_row.error_rows,
    'issued', inserted_count,
    'expiresAt', batch_row.expires_at,
    'rows', rows_json,
    'codesAvailable', false,
    'invitations', '[]'::jsonb
  );
end
$$;

-- The old all-database apply issued claim invitations and must not remain a
-- bypass once the application switches to trusted direct provisioning.
create or replace function public.apply_staff_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'DIRECT_PROVISIONING_REQUIRED';
end
$$;

-- ---------------------------------------------------------------------------
-- 5. First-password completion and staff list status.
-- ---------------------------------------------------------------------------

create or replace function public.complete_initial_password_change(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  update public.profiles
     set password_change_required = false, password_changed_at = now()
   where id = p_user_id and password_change_required;
  if found then
    perform public.emit_domain_event(
      'account.initial_password_changed', 'profile', p_user_id,
      jsonb_build_object('completed', true), p_user_id, null
    );
  end if;
end
$$;

revoke all on function public.complete_initial_password_change(uuid) from public, anon, authenticated;
grant execute on function public.complete_initial_password_change(uuid) to service_role;

drop function if exists public.list_staff_members();
create function public.list_staff_members()
returns table(
  user_id uuid,
  display_name text,
  email text,
  identity text,
  role_ids uuid[],
  role_names text[],
  can_follow_up boolean,
  is_active boolean,
  password_change_required boolean
)
language sql security definer stable set search_path = public, pg_temp
as $$
  select profile_row.id,
         profile_row.display_name,
         coalesce(user_row.email, user_row.phone, '')::text,
         profile_row.role,
         coalesce(roles.role_ids, '{}'),
         coalesce(roles.role_names, '{}'),
         profile_row.is_active and public.has_perm(profile_row.id, 'followup.write'),
         profile_row.is_active,
         profile_row.password_change_required
    from public.profiles profile_row
    join auth.users user_row on user_row.id = profile_row.id
    left join lateral(
      select array_agg(role_row.id order by role_row.created_at) role_ids,
             array_agg(role_row.name order by role_row.created_at) role_names
        from public.staff_role_members member_row
        join public.staff_roles role_row on role_row.id = member_row.role_id
       where member_row.user_id = profile_row.id
    ) roles on true
   where profile_row.role in ('staff','admin')
     and (
       public.has_perm(auth.uid(), 'staff.invite')
       or (
         public.has_perm(auth.uid(), 'student.assign')
         and profile_row.is_active
         and public.has_perm(profile_row.id, 'followup.write')
       )
     )
   order by profile_row.is_active desc, profile_row.role desc, profile_row.display_name
$$;

revoke all on function public.list_staff_members() from public, anon, authenticated;
grant execute on function public.list_staff_members() to authenticated;
