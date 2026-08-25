-- R1-Live P0: allow invited staff to register and sign in with either an
-- email address or a phone number plus password. Phone accounts are created
-- by the trusted application action without enabling fake SMS verification.

-- ---------------------------------------------------------------------------
-- 1. Canonical login identifiers and compatible staff invitations.
-- ---------------------------------------------------------------------------

create or replace function public.normalize_login_identifier(
  p_identifier_type text,
  p_identifier text
) returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  clean_type text := lower(trim(coalesce(p_identifier_type, '')));
  clean_identifier text := trim(coalesce(p_identifier, ''));
begin
  if clean_type = 'email' then
    clean_identifier := lower(clean_identifier);
    if length(clean_identifier) not between 3 and 254
       or clean_identifier !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    then raise exception 'INVALID_EMAIL'; end if;
    return clean_identifier;
  end if;

  if clean_type = 'phone' then
    clean_identifier := regexp_replace(clean_identifier, '[[:space:]().-]', '', 'g');
    if clean_identifier ~ '^00[1-9][0-9]{7,14}$' then
      clean_identifier := '+' || substring(clean_identifier from 3);
    elsif clean_identifier ~ '^1[3-9][0-9]{9}$' then
      clean_identifier := '+86' || clean_identifier;
    elsif clean_identifier ~ '^861[3-9][0-9]{9}$' then
      clean_identifier := '+' || clean_identifier;
    end if;
    if clean_identifier !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'INVALID_PHONE'; end if;
    return clean_identifier;
  end if;

  raise exception 'INVALID_IDENTIFIER_TYPE';
end
$$;

alter table public.staff_invitations
  add column identifier_type text not null default 'email',
  add column identifier_normalized text;

update public.staff_invitations
   set identifier_type = 'email',
       identifier_normalized = lower(trim(email));

alter table public.staff_invitations
  alter column identifier_normalized set not null,
  alter column email drop not null,
  add constraint staff_invitations_identifier_type_check
    check (identifier_type in ('email', 'phone')),
  add constraint staff_invitations_identifier_shape_check check (
    (identifier_type = 'email' and email = identifier_normalized
      and identifier_normalized = lower(identifier_normalized)
      and length(identifier_normalized) between 3 and 254)
    or
    (identifier_type = 'phone' and email is null
      and identifier_normalized ~ '^\+[1-9][0-9]{7,14}$')
  );

drop index if exists public.staff_invitations_one_pending_email_idx;
create unique index staff_invitations_one_pending_identifier_idx
  on public.staff_invitations(identifier_type, identifier_normalized)
  where status = 'pending';

create or replace function public.issue_staff_identity_invitation(
  p_identifier_type text,
  p_identifier text,
  p_valid_days integer default 7
) returns table(
  invitation_id uuid,
  invite_code text,
  expires_at timestamptz,
  identifier_type text,
  identifier_normalized text
)
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_type text := lower(trim(coalesce(p_identifier_type, '')));
  clean_identifier text;
  raw_code text;
  new_id uuid;
  expiry timestamptz;
begin
  if uid is null or not public.has_perm(uid, 'staff.manage') then raise exception 'FORBIDDEN'; end if;
  clean_identifier := public.normalize_login_identifier(clean_type, p_identifier);
  if p_valid_days not between 1 and 30 then raise exception 'INVALID_EXPIRY'; end if;

  if exists(
    select 1 from auth.users user_row
     where (clean_type = 'email' and lower(user_row.email) = clean_identifier)
        or (clean_type = 'phone' and user_row.phone = clean_identifier)
  ) then raise exception 'ACCOUNT_EXISTS'; end if;

  update public.staff_invitations invitation_row
     set status = 'expired'
   where invitation_row.identifier_type = clean_type
     and invitation_row.identifier_normalized = clean_identifier
     and invitation_row.status = 'pending'
     and invitation_row.expires_at <= now();

  if exists(
    select 1 from public.staff_invitations invitation_row
     where invitation_row.identifier_type = clean_type
       and invitation_row.identifier_normalized = clean_identifier
       and invitation_row.status = 'pending'
  ) then raise exception 'INVITATION_ALREADY_PENDING'; end if;

  raw_code := upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 18));
  expiry := now() + make_interval(days => p_valid_days);
  insert into public.staff_invitations(
    email, identifier_type, identifier_normalized, code_hash, invited_by, expires_at
  ) values(
    case when clean_type = 'email' then clean_identifier else null end,
    clean_type,
    clean_identifier,
    md5(raw_code),
    uid,
    expiry
  ) returning id into new_id;

  perform public.emit_domain_event(
    'staff.invited',
    'staff_invitation',
    new_id,
    jsonb_build_object('expiresAt', expiry, 'identifierType', clean_type),
    null,
    null
  );
  return query select new_id, raw_code, expiry, clean_type, clean_identifier;
end
$$;

-- Keep the email-only RPC working while an older application release is the
-- rollback target during the database-first deployment.
create or replace function public.issue_staff_invitation(
  p_email text,
  p_valid_days integer default 7
) returns table(invitation_id uuid, invite_code text, expires_at timestamptz)
language sql security definer
set search_path = public, pg_temp
as $$
  select invitation_id, invite_code, expires_at
    from public.issue_staff_identity_invitation('email', p_email, p_valid_days)
$$;

create or replace function public.validate_registration_access_v2(
  p_code text,
  p_identifier_type text,
  p_identifier text
) returns boolean
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  clean_type text := lower(trim(coalesce(p_identifier_type, '')));
  clean_identifier text := public.normalize_login_identifier(clean_type, p_identifier);
  supplied_code text := upper(trim(coalesce(p_code, '')));
begin
  -- General invite codes remain email-only. A phone account must be bound to
  -- a specific one-time staff invitation while no SMS provider is configured.
  return (
    clean_type = 'email' and exists(
      select 1 from public.registration_invite_settings setting_row
       where setting_row.id = 1
         and setting_row.is_active
         and setting_row.code = supplied_code
    )
  ) or exists(
    select 1 from public.staff_invitations invitation_row
     where invitation_row.status = 'pending'
       and invitation_row.expires_at > now()
       and invitation_row.identifier_type = clean_type
       and invitation_row.identifier_normalized = clean_identifier
       and invitation_row.code_hash = md5(supplied_code)
  );
end
$$;

create or replace function public.validate_registration_access(p_code text, p_email text)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.validate_registration_access_v2(p_code, 'email', p_email)
$$;

-- ---------------------------------------------------------------------------
-- 2. Preserve the difference between an invite-attested contact and one that
-- has actually been verified by an email/SMS provider.
-- ---------------------------------------------------------------------------

create table public.account_identifier_assurances (
  user_id uuid not null references public.profiles(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('email', 'phone')),
  identifier_hash text not null check (identifier_hash ~ '^[a-f0-9]{64}$'),
  attestation_source text not null check (attestation_source in ('global_invite', 'staff_invite')),
  provider_verified boolean not null default false,
  provider_verified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(user_id, identifier_type),
  check ((provider_verified and provider_verified_at is not null)
      or (not provider_verified and provider_verified_at is null))
);

alter table public.account_identifier_assurances enable row level security;
create policy account_identifier_assurances_scope_read
  on public.account_identifier_assurances for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_perm((select auth.uid()), 'account.support.manage')
  );
revoke all on public.account_identifier_assurances from public, anon, authenticated;
grant select on public.account_identifier_assurances to authenticated;

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
  privacy_version text;
  children_version text;
begin
  if new.raw_user_meta_data ->> 'privacy_consent' is distinct from 'true'
     or new.raw_user_meta_data ->> 'children_privacy_consent' is distinct from 'true'
  then raise exception 'REGISTRATION_CONSENT_REQUIRED'; end if;

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
       where setting_row.id = 1
         and setting_row.is_active
         and setting_row.code = supplied_code
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

  if not is_general_invite and staff_invite.id is null then
    raise exception 'INVALID_REGISTRATION_INVITE';
  end if;

  insert into public.profiles(
    id, display_name, role, privacy_consented_at, children_privacy_consented_at
  ) values(
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      case when clean_type = 'email' then split_part(clean_identifier, '@', 1)
           else 'user-' || right(clean_identifier, 4) end
    ),
    case when staff_invite.id is null then 'student' else 'staff' end,
    now(),
    now()
  ) on conflict(id) do nothing;

  select version into privacy_version
    from public.consent_policies where policy_kind = 'privacy' and required;
  select version into children_version
    from public.consent_policies where policy_kind = 'children_privacy' and required;
  insert into public.consent_records(
    actor_user_id, subject_user_id, policy_kind, policy_version, scope, decision, source
  ) values
    (new.id, new.id, 'privacy', privacy_version, 'account', 'granted', 'registration'),
    (new.id, new.id, 'children_privacy', children_version, 'account', 'granted', 'registration');

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
    perform public.emit_domain_event(
      'staff.invitation_accepted',
      'staff_invitation',
      staff_invite.id,
      jsonb_build_object('userId', new.id, 'identifierType', clean_type),
      new.id,
      null
    );
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Account support reads both invitation kinds without exposing identifiers
-- to unauthenticated callers.
-- ---------------------------------------------------------------------------

create or replace function public.get_account_support_snapshot()
returns jsonb language plpgsql security definer stable set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(),'account.support.manage') then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'activeAdmins', (select count(*) from public.profiles where role='admin' and is_active and account_status='active'),
    'adminsWithoutMfa', (select count(*) from public.profiles profile_row where profile_row.role='admin' and profile_row.is_active and profile_row.account_status='active'
      and not exists(select 1 from auth.mfa_factors factor_row where factor_row.user_id=profile_row.id and factor_row.status='verified')),
    'openRequests', coalesce((select jsonb_agg(jsonb_build_object(
      'id',request_row.id,'userId',request_row.user_id,'kind',request_row.kind,'status',request_row.status,
      'identityVerification',request_row.identity_verification,'dataScope',request_row.data_scope,
      'dueAt',request_row.due_at,'createdAt',request_row.created_at
    ) order by request_row.created_at desc) from public.account_requests request_row
      where request_row.status in ('submitted','identity_verified','approved','processing')), '[]'::jsonb),
    'recentExports', coalesce((select jsonb_agg(jsonb_build_object(
      'id', export_row.id,
      'requestId', export_row.request_id,
      'userId', export_row.user_id,
      'subjectRole', export_row.subject_role,
      'dataScope', export_row.data_scope,
      'artifactHash', export_row.artifact_hash,
      'sizeBytes', export_row.size_bytes,
      'expiresAt', export_row.expires_at,
      'createdAt', export_row.created_at,
      'status', case
        when export_row.purged_at is not null then 'purged'
        when export_row.expires_at <= now() then 'expired'
        else 'ready'
      end,
      'downloadCount', (select count(*) from public.export_download_events event_row where event_row.artifact_id = export_row.id)
    ) order by export_row.created_at desc) from (
      select * from public.user_rights_export_artifacts order by created_at desc limit 50
    ) export_row), '[]'::jsonb),
    'recentOperationalExports', case when public.has_perm(auth.uid(), 'audit.view') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', event_row.id,
        'exportKind', event_row.export_kind,
        'resourceId', event_row.resource_id,
        'actorUserId', event_row.actor_user_id,
        'artifactHash', event_row.artifact_hash,
        'sizeBytes', event_row.size_bytes,
        'downloadedAt', event_row.downloaded_at
      ) order by event_row.downloaded_at desc)
      from (select * from public.export_download_events where export_category = 'operational'
        order by downloaded_at desc limit 50) event_row
    ), '[]'::jsonb) else '[]'::jsonb end,
    'recentAudits', coalesce((select jsonb_agg(jsonb_build_object(
      'id',audit_row.id,'actorUserId',audit_row.actor_user_id,'targetUserId',audit_row.target_user_id,
      'actionType',audit_row.action_type,'result',audit_row.result,'createdAt',audit_row.created_at
    ) order by audit_row.created_at desc) from (select * from public.account_support_audits order by created_at desc limit 50) audit_row), '[]'::jsonb),
    'pendingInvitations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', invitation_row.id,
      'identifierType', invitation_row.identifier_type,
      'identifier', invitation_row.identifier_normalized,
      'expiresAt', invitation_row.expires_at,
      'createdAt', invitation_row.created_at
    ) order by invitation_row.created_at desc) from public.staff_invitations invitation_row
      where invitation_row.status='pending' and invitation_row.expires_at>now()), '[]'::jsonb)
  );
end
$$;

revoke all on function public.normalize_login_identifier(text, text) from public, anon, authenticated;
revoke all on function public.issue_staff_identity_invitation(text, text, integer) from public, anon, authenticated;
revoke all on function public.validate_registration_access_v2(text, text, text) from public, anon, authenticated;
grant execute on function public.issue_staff_identity_invitation(text, text, integer) to authenticated;
grant execute on function public.validate_registration_access_v2(text, text, text) to anon, authenticated;

comment on table public.account_identifier_assurances is
  'Hashed assurance metadata only; auth.users/auth.identities remain the login identity authority.';
