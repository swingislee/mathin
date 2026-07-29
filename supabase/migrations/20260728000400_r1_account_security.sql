-- R1-3: account lifecycle, versioned consent, rights requests, MFA posture,
-- staff invitations, and audited administrator support.

-- ---------------------------------------------------------------------------
-- 1. Permission catalogue and account gate.
-- ---------------------------------------------------------------------------

create or replace function public.school_permission_keys()
returns text[] language sql immutable
as $$
  select array[
    'student.view.all','student.view.assigned','student.edit','student.create','student.assign','student.import','student.delete',
    'followup.view','followup.write','activity.manage','activity.register','review.write','video.review',
    'course.view','course.manage','course.view.all','course.product.create','course.assignment.manage',
    'courseware.template.edit','courseware.overlay.edit','courseware.page.edit','courseware.asset.manage',
    'courseware.release.publish','courseware.review','courseware.emergency_publish',
    'class.view.all','class.view.mine','class.create','class.manage','enrollment.manage',
    'schedule.view.all','schedule.manage','attendance.mark','grading.write','report.view.all','session.void','session.postwork.manage',
    'finance.order.view','finance.order.create','finance.payment.record','finance.refund.request','finance.refund.approve',
    'finance.coupon.manage','finance.scholarship.grant','finance.account.adjust','finance.report.view',
    'staff.manage','permission.configure','registration.invite.manage','organization.settings.manage',
    'system.operations.manage','account.support.manage','audit.view','testdata.purge'
  ]::text[]
$$;

insert into public.role_permissions(role_id, perm_key)
select role_row.id, 'account.support.manage'
  from public.staff_roles role_row where role_row.key = 'principal'
on conflict do nothing;

alter table public.profiles
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active','locked')),
  add column if not exists account_locked_at timestamptz,
  add column if not exists account_locked_by uuid references public.profiles(id) on delete set null,
  add column if not exists account_lock_reason text;

create or replace function public.protect_profile_role()
returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and (
    new.role is distinct from old.role
    or new.privacy_consented_at is distinct from old.privacy_consented_at
    or new.children_privacy_consented_at is distinct from old.children_privacy_consented_at
    or new.account_status is distinct from old.account_status
    or new.account_locked_at is distinct from old.account_locked_at
    or new.account_locked_by is distinct from old.account_locked_by
    or new.account_lock_reason is distinct from old.account_lock_reason
  ) then
    raise exception 'protected profile fields can only be changed by a trusted operation';
  end if;
  return new;
end
$$;

create or replace function public.is_staff(uid uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.profiles
     where id = uid and role in ('staff','admin') and is_active and account_status = 'active'
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Versioned policies and append-only consent ledger.
-- ---------------------------------------------------------------------------

create table public.consent_policies (
  id uuid primary key default gen_random_uuid(),
  policy_kind text not null check (policy_kind in ('privacy','children_privacy')),
  version text not null check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([.][0-9]+)?$'),
  effective_at timestamptz not null,
  required boolean not null default true,
  document_path text not null check (document_path like '/%'),
  created_at timestamptz not null default now(),
  unique(policy_kind, version)
);
create unique index consent_policies_one_current_idx
  on public.consent_policies(policy_kind) where required;

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id),
  subject_user_id uuid references public.profiles(id),
  student_id uuid references public.students(id),
  policy_kind text not null check (policy_kind in ('privacy','children_privacy')),
  policy_version text not null,
  scope text not null check (scope in ('account','profile','learning','video')),
  decision text not null check (decision in ('granted','withdrawn')),
  source text not null check (source in ('registration','account_center','guardian_binding','migration')),
  recorded_at timestamptz not null default now(),
  constraint consent_records_subject check (subject_user_id is not null or student_id is not null),
  foreign key(policy_kind, policy_version) references public.consent_policies(policy_kind, version)
);
create index consent_records_subject_idx on public.consent_records(subject_user_id, policy_kind, recorded_at desc);
create index consent_records_student_idx on public.consent_records(student_id, policy_kind, scope, recorded_at desc);

create or replace function public.reject_immutable_security_row()
returns trigger language plpgsql as $$
begin
  raise exception 'SECURITY_LEDGER_APPEND_ONLY';
end
$$;

create trigger consent_policies_immutable before update or delete on public.consent_policies
  for each row execute function public.reject_immutable_security_row();
create trigger consent_records_immutable before update or delete on public.consent_records
  for each row execute function public.reject_immutable_security_row();

insert into public.consent_policies(policy_kind, version, effective_at, required, document_path)
values
  ('privacy','2026-07-28','2026-07-28 00:00:00+08',true,'/privacy'),
  ('children_privacy','2026-07-28','2026-07-28 00:00:00+08',true,'/children-privacy')
on conflict do nothing;

insert into public.consent_records(actor_user_id, subject_user_id, policy_kind, policy_version, scope, decision, source, recorded_at)
select profile_row.id, profile_row.id, policy_row.policy_kind, policy_row.version, 'account', 'granted', 'migration',
       case policy_row.policy_kind
         when 'privacy' then profile_row.privacy_consented_at
         else profile_row.children_privacy_consented_at
       end
  from public.profiles profile_row
  join public.consent_policies policy_row on policy_row.required
 where (policy_row.policy_kind = 'privacy' and profile_row.privacy_consented_at is not null)
    or (policy_row.policy_kind = 'children_privacy' and profile_row.children_privacy_consented_at is not null);

insert into public.consent_records(actor_user_id, student_id, policy_kind, policy_version, scope, decision, source, recorded_at)
select old_row.guardian_id, old_row.student_id, 'children_privacy', policy_row.version, old_row.scope,
       case when old_row.consented then 'granted' else 'withdrawn' end, 'migration', old_row.consented_at
  from public.guardian_consents old_row
  join public.consent_policies policy_row on policy_row.policy_kind = 'children_privacy' and policy_row.required;

create or replace function public.has_current_required_consents(p_user_id uuid)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select (p_user_id = auth.uid() or public.has_perm(auth.uid(),'account.support.manage')) and not exists (
    select 1
      from public.consent_policies policy_row
     where policy_row.required
       and coalesce((
         select record_row.decision = 'granted'
           from public.consent_records record_row
          where record_row.subject_user_id = p_user_id
            and record_row.policy_kind = policy_row.policy_kind
            and record_row.policy_version = policy_row.version
            and record_row.scope = 'account'
          order by record_row.recorded_at desc, record_row.id desc
          limit 1
       ), false) is false
  )
$$;

create or replace function public.record_account_consent(p_policy_kind text, p_decision text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  policy_row public.consent_policies%rowtype;
  record_id uuid;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_decision not in ('granted','withdrawn') then raise exception 'INVALID_DECISION'; end if;
  select * into policy_row from public.consent_policies
   where policy_kind = p_policy_kind and required;
  if policy_row.id is null then raise exception 'POLICY_NOT_FOUND'; end if;
  insert into public.consent_records(actor_user_id, subject_user_id, policy_kind, policy_version, scope, decision, source)
  values(uid, uid, policy_row.policy_kind, policy_row.version, 'account', p_decision, 'account_center')
  returning id into record_id;
  perform public.emit_domain_event('consent.' || p_decision, 'profile', uid,
    jsonb_build_object('policyKind', policy_row.policy_kind, 'policyVersion', policy_row.version), uid, null);
  return record_id;
end
$$;

create or replace function public.record_guardian_consent(p_student_id uuid, p_scope text, p_consented boolean)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  consent_id uuid;
  policy_version text;
begin
  if uid is null or not exists(
    select 1 from public.student_guardians where student_id = p_student_id and guardian_id = uid
  ) then raise exception 'FORBIDDEN'; end if;
  if p_scope not in ('profile','learning','video') then raise exception 'INVALID_SCOPE'; end if;
  select version into policy_version from public.consent_policies
   where policy_kind = 'children_privacy' and required;
  insert into public.guardian_consents(student_id, guardian_id, scope, consented)
  values(p_student_id, uid, p_scope, p_consented) returning id into consent_id;
  insert into public.consent_records(actor_user_id, student_id, policy_kind, policy_version, scope, decision, source)
  values(uid, p_student_id, 'children_privacy', policy_version, p_scope,
    case when p_consented then 'granted' else 'withdrawn' end, 'guardian_binding');
  if not p_consented then
    update public.student_guardians
       set scope = array_remove(scope, case p_scope when 'learning' then 'grades' else p_scope end)
     where student_id = p_student_id and guardian_id = uid;
  end if;
  perform public.emit_domain_event('consent.recorded', 'student', p_student_id,
    jsonb_build_object('scope', p_scope, 'consented', p_consented, 'policyVersion', policy_version), uid, null);
  return consent_id;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. User rights requests with identity verification and evidence.
-- ---------------------------------------------------------------------------

alter table public.account_requests drop constraint if exists account_requests_kind_check;
alter table public.account_requests drop constraint if exists account_requests_status_check;
alter table public.account_requests
  add column if not exists data_scope text not null default 'account',
  add column if not exists identity_verification text not null default 'pending'
    check (identity_verification in ('pending','verified','rejected')),
  add column if not exists due_at timestamptz,
  add column if not exists decision_reason text,
  add column if not exists result_summary text,
  add column if not exists evidence_hash text
    check (evidence_hash is null or evidence_hash ~ '^[a-f0-9]{64}$'),
  add column if not exists updated_at timestamptz not null default now();

update public.account_requests
   set status = case status when 'pending' then 'submitted' when 'done' then 'completed' else status end,
       due_at = coalesce(due_at, created_at + interval '30 days');

alter table public.account_requests
  add constraint account_requests_kind_check check (kind in ('access','correct','export','restrict','delete')),
  add constraint account_requests_status_check check (status in ('submitted','identity_verified','approved','processing','completed','rejected','cancelled'));

drop trigger if exists account_requests_set_updated_at on public.account_requests;
create trigger account_requests_set_updated_at before update on public.account_requests
  for each row execute function public.set_updated_at();

create or replace function public.request_account_action(p_kind text, p_reason text default '', p_data_scope text default 'account')
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare rid uuid; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_kind not in ('access','correct','export','restrict','delete') then raise exception 'INVALID_KIND'; end if;
  if length(trim(coalesce(p_data_scope,''))) not between 1 and 200 then raise exception 'INVALID_SCOPE'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text || ':' || p_kind));
  if exists(select 1 from public.account_requests
    where user_id=uid and kind=p_kind and status in ('submitted','identity_verified','approved','processing'))
  then raise exception 'REQUEST_ALREADY_OPEN'; end if;

  insert into public.account_requests(user_id, kind, reason, data_scope, status, due_at)
  values(uid, p_kind, left(trim(coalesce(p_reason,'')),1000), left(trim(p_data_scope),200), 'submitted', now() + interval '30 days')
  returning id into rid;
  perform public.emit_domain_event('account_request.submitted', 'account_request', rid,
    jsonb_build_object('kind', p_kind, 'dataScope', left(trim(p_data_scope),200)), uid, null);
  return rid;
end
$$;

create or replace function public.manage_account_request(
  p_request_id uuid, p_status text, p_identity_verification text,
  p_decision_reason text default null, p_result_summary text default null, p_evidence_hash text default null
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); request_row public.account_requests%rowtype;
begin
  if uid is null or not public.has_perm(uid, 'account.support.manage') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('submitted','identity_verified','approved','processing','completed','rejected','cancelled')
     or p_identity_verification not in ('pending','verified','rejected') then raise exception 'INVALID_STATUS'; end if;
  if p_status in ('approved','processing','completed') and p_identity_verification <> 'verified'
  then raise exception 'IDENTITY_NOT_VERIFIED'; end if;
  if p_status = 'completed' and coalesce(p_evidence_hash,'') !~ '^[a-f0-9]{64}$'
  then raise exception 'EVIDENCE_REQUIRED'; end if;
  select * into request_row from public.account_requests where id = p_request_id for update;
  if request_row.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if request_row.status in ('completed','rejected','cancelled') then raise exception 'REQUEST_TERMINAL'; end if;
  update public.account_requests
     set status = p_status,
         identity_verification = p_identity_verification,
         decision_reason = left(trim(coalesce(p_decision_reason,'')),1000),
         result_summary = left(trim(coalesce(p_result_summary,'')),2000),
         evidence_hash = p_evidence_hash,
         handled_by = uid,
         handled_at = case when p_status in ('completed','rejected','cancelled') then now() else handled_at end
   where id = p_request_id;
  perform public.emit_domain_event('account_request.' || p_status, 'account_request', p_request_id,
    jsonb_build_object('identityVerification', p_identity_verification, 'evidenceHash', p_evidence_hash), request_row.user_id, null);
end
$$;

-- ---------------------------------------------------------------------------
-- 4. One-time, email-bound staff invitations. Delivery is intentionally
-- out-of-band until an external provider is selected in R1-2 configuration.
-- ---------------------------------------------------------------------------

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and length(email) between 3 and 254),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{32}$'),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_by uuid not null references public.profiles(id),
  accepted_by uuid references public.profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index staff_invitations_one_pending_email_idx
  on public.staff_invitations(email) where status = 'pending';

create or replace function public.issue_staff_invitation(p_email text, p_valid_days integer default 7)
returns table(invitation_id uuid, invite_code text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); clean_email text := lower(trim(coalesce(p_email,''))); raw_code text; new_id uuid; expiry timestamptz;
begin
  if uid is null or not public.has_perm(uid, 'staff.manage') then raise exception 'FORBIDDEN'; end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'INVALID_EMAIL'; end if;
  if p_valid_days not between 1 and 30 then raise exception 'INVALID_EXPIRY'; end if;
  if exists(select 1 from auth.users where lower(email) = clean_email) then raise exception 'ACCOUNT_EXISTS'; end if;
  update public.staff_invitations invitation_row set status = 'expired'
   where invitation_row.email = clean_email and invitation_row.status = 'pending' and invitation_row.expires_at <= now();
  if exists(select 1 from public.staff_invitations invitation_row where invitation_row.email = clean_email and invitation_row.status = 'pending')
  then raise exception 'INVITATION_ALREADY_PENDING'; end if;
  raw_code := upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text),1,18));
  expiry := now() + make_interval(days => p_valid_days);
  insert into public.staff_invitations(email, code_hash, invited_by, expires_at)
  values(clean_email, md5(raw_code), uid, expiry)
  returning id into new_id;
  perform public.emit_domain_event('staff.invited', 'staff_invitation', new_id,
    jsonb_build_object('expiresAt', expiry), null, null);
  return query select new_id, raw_code, expiry;
end
$$;

create or replace function public.revoke_staff_invitation(p_invitation_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.has_perm(uid, 'staff.manage') then raise exception 'FORBIDDEN'; end if;
  if length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'INVALID_REASON'; end if;
  update public.staff_invitations set status = 'revoked', revoked_at = now()
   where id = p_invitation_id and status = 'pending';
  if not found then raise exception 'INVITATION_NOT_PENDING'; end if;
  perform public.emit_domain_event('staff.invitation_revoked', 'staff_invitation', p_invitation_id,
    jsonb_build_object('reason', left(trim(p_reason),500)), null, null);
end
$$;

create or replace function public.validate_registration_access(p_code text, p_email text)
returns boolean language sql security definer stable set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.registration_invite_settings setting_row
     where setting_row.id = 1 and setting_row.is_active
       and setting_row.code = upper(trim(coalesce(p_code,'')))
  ) or exists(
    select 1 from public.staff_invitations invitation_row
     where invitation_row.status = 'pending' and invitation_row.expires_at > now()
       and invitation_row.email = lower(trim(coalesce(p_email,'')))
       and invitation_row.code_hash = md5(upper(trim(coalesce(p_code,''))))
  )
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  supplied_code text := upper(trim(coalesce(new.raw_user_meta_data ->> 'registration_invite_code','')));
  clean_email text := lower(trim(coalesce(new.email,'')));
  staff_invite public.staff_invitations%rowtype;
  is_general_invite boolean;
  privacy_version text;
  children_version text;
begin
  if new.raw_user_meta_data ->> 'privacy_consent' is distinct from 'true'
     or new.raw_user_meta_data ->> 'children_privacy_consent' is distinct from 'true'
  then raise exception 'REGISTRATION_CONSENT_REQUIRED'; end if;

  select exists(
    select 1 from public.registration_invite_settings setting_row
     where setting_row.id = 1 and setting_row.is_active and setting_row.code = supplied_code
  ) into is_general_invite;
  select * into staff_invite from public.staff_invitations invitation_row
   where invitation_row.status = 'pending' and invitation_row.expires_at > now()
     and invitation_row.email = clean_email
     and invitation_row.code_hash = md5(supplied_code)
   for update;
  if not is_general_invite and staff_invite.id is null then raise exception 'INVALID_REGISTRATION_INVITE'; end if;

  insert into public.profiles(id, display_name, role, privacy_consented_at, children_privacy_consented_at)
  values(new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'),''), split_part(new.email,'@',1),''),
    case when staff_invite.id is null then 'student' else 'staff' end, now(), now())
  on conflict(id) do nothing;

  select version into privacy_version from public.consent_policies where policy_kind = 'privacy' and required;
  select version into children_version from public.consent_policies where policy_kind = 'children_privacy' and required;
  insert into public.consent_records(actor_user_id, subject_user_id, policy_kind, policy_version, scope, decision, source)
  values
    (new.id,new.id,'privacy',privacy_version,'account','granted','registration'),
    (new.id,new.id,'children_privacy',children_version,'account','granted','registration');

  if staff_invite.id is not null then
    update public.staff_invitations set status = 'accepted', accepted_by = new.id, accepted_at = now()
     where id = staff_invite.id;
    perform public.emit_domain_event('staff.invitation_accepted', 'staff_invitation', staff_invite.id,
      jsonb_build_object('userId',new.id), new.id, null);
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Audited account support, lock/restore, and session revocation.
-- ---------------------------------------------------------------------------

create table public.account_support_audits (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id),
  target_user_id uuid not null references public.profiles(id),
  action_type text not null check (action_type in ('revoke_sessions','recovery_requested','ban','restore')),
  reason text not null check (length(reason) between 1 and 500),
  result text not null check (result in ('succeeded','failed')),
  correlation_hash text check (correlation_hash is null or correlation_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
create trigger account_support_audits_immutable before update or delete on public.account_support_audits
  for each row execute function public.reject_immutable_security_row();

create or replace function public.assert_account_support_target(p_target uuid, p_locking boolean default false)
returns void language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target_role text;
begin
  if uid is null or not public.has_perm(uid, 'account.support.manage') or uid = p_target then raise exception 'FORBIDDEN'; end if;
  select role into target_role from public.profiles where id = p_target;
  if target_role is null then raise exception 'TARGET_NOT_FOUND'; end if;
  if p_locking and target_role = 'admin' and (
    select count(*) from public.profiles where role = 'admin' and is_active and account_status = 'active'
  ) <= 1 then raise exception 'LAST_ACTIVE_ADMIN'; end if;
end
$$;

create or replace function public.record_account_support_action(
  p_target uuid, p_action_type text, p_reason text, p_result text, p_correlation_hash text default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); audit_id uuid;
begin
  perform public.assert_account_support_target(p_target, p_action_type = 'ban');
  if p_action_type not in ('revoke_sessions','recovery_requested','ban','restore') then raise exception 'INVALID_ACTION'; end if;
  if length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'INVALID_REASON'; end if;
  if p_result not in ('succeeded','failed') then raise exception 'INVALID_RESULT'; end if;
  if p_correlation_hash is not null and p_correlation_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_HASH'; end if;
  if p_result = 'succeeded' and p_action_type in ('ban','restore') then
    update public.profiles
       set account_status = case p_action_type when 'ban' then 'locked' else 'active' end,
           account_locked_at = case p_action_type when 'ban' then now() else null end,
           account_locked_by = case p_action_type when 'ban' then uid else null end,
           account_lock_reason = case p_action_type when 'ban' then left(trim(p_reason),500) else null end
     where id = p_target;
  end if;
  insert into public.account_support_audits(actor_user_id,target_user_id,action_type,reason,result,correlation_hash)
  values(uid,p_target,p_action_type,left(trim(p_reason),500),p_result,p_correlation_hash)
  returning id into audit_id;
  perform public.emit_domain_event('account_support.' || p_action_type, 'profile', p_target,
    jsonb_build_object('result',p_result,'auditId',audit_id,'correlationHash',p_correlation_hash), p_target, null);
  return audit_id;
end
$$;

create or replace function public.revoke_user_sessions(p_target uuid, p_reason text)
returns bigint language plpgsql security definer set search_path = public, auth, pg_temp
as $$
declare removed bigint; audit_id uuid;
begin
  perform public.assert_account_support_target(p_target, false);
  if length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception 'INVALID_REASON'; end if;
  delete from auth.sessions where user_id = p_target;
  get diagnostics removed = row_count;
  audit_id := public.record_account_support_action(p_target,'revoke_sessions',p_reason,'succeeded',
    md5(p_target::text || ':' || clock_timestamp()::text) || md5('r1:' || p_target::text || ':' || clock_timestamp()::text));
  return removed;
end
$$;

create or replace function public.get_my_account_security_snapshot()
returns jsonb language sql security definer stable set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'accountStatus', profile_row.account_status,
    'hasCurrentRequiredConsents', public.has_current_required_consents(auth.uid()),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', policy_row.policy_kind,
        'version', policy_row.version,
        'effectiveAt', policy_row.effective_at,
        'documentPath', policy_row.document_path,
        'decision', (
          select record_row.decision from public.consent_records record_row
           where record_row.subject_user_id = auth.uid()
             and record_row.policy_kind = policy_row.policy_kind
             and record_row.policy_version = policy_row.version
             and record_row.scope = 'account'
           order by record_row.recorded_at desc, record_row.id desc limit 1
        )
      ) order by policy_row.policy_kind)
      from public.consent_policies policy_row where policy_row.required
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request_row.id, 'kind', request_row.kind, 'status', request_row.status,
        'identityVerification', request_row.identity_verification, 'dataScope', request_row.data_scope,
        'dueAt', request_row.due_at, 'createdAt', request_row.created_at
      ) order by request_row.created_at desc)
      from public.account_requests request_row where request_row.user_id = auth.uid()
    ), '[]'::jsonb)
  ) from public.profiles profile_row where profile_row.id = auth.uid()
$$;

create or replace function public.lookup_account_support_target(p_email text)
returns table(user_id uuid, display_name text, email text, identity text, account_status text, mfa_verified boolean)
language plpgsql security definer stable set search_path = public, auth, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(),'account.support.manage') then raise exception 'FORBIDDEN'; end if;
  return query
  select profile_row.id, profile_row.display_name, user_row.email::text, profile_row.role, profile_row.account_status,
    exists(select 1 from auth.mfa_factors factor_row where factor_row.user_id = profile_row.id and factor_row.status = 'verified')
    from public.profiles profile_row join auth.users user_row on user_row.id = profile_row.id
   where lower(user_row.email) = lower(trim(coalesce(p_email,'')));
end
$$;

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
    'recentAudits', coalesce((select jsonb_agg(jsonb_build_object(
      'id',audit_row.id,'actorUserId',audit_row.actor_user_id,'targetUserId',audit_row.target_user_id,
      'actionType',audit_row.action_type,'result',audit_row.result,'createdAt',audit_row.created_at
    ) order by audit_row.created_at desc) from (select * from public.account_support_audits order by created_at desc limit 50) audit_row), '[]'::jsonb),
    'pendingInvitations', coalesce((select jsonb_agg(jsonb_build_object(
      'id',invitation_row.id,'email',invitation_row.email,'expiresAt',invitation_row.expires_at,'createdAt',invitation_row.created_at
    ) order by invitation_row.created_at desc) from public.staff_invitations invitation_row
      where invitation_row.status='pending' and invitation_row.expires_at>now()), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS and grants: all mutations remain RPC-only.
-- ---------------------------------------------------------------------------

alter table public.consent_policies enable row level security;
alter table public.consent_records enable row level security;
alter table public.staff_invitations enable row level security;
alter table public.account_support_audits enable row level security;

create policy consent_policies_public_read on public.consent_policies for select to anon,authenticated using(true);
create policy consent_records_subject_read on public.consent_records for select to authenticated using(
  actor_user_id = (select auth.uid()) or subject_user_id = (select auth.uid())
  or (student_id is not null and exists(select 1 from public.student_guardians guardian_row where guardian_row.student_id=consent_records.student_id and guardian_row.guardian_id=(select auth.uid())))
  or public.has_perm((select auth.uid()),'audit.view')
);
create policy staff_invitations_manager_read on public.staff_invitations for select to authenticated using(
  public.has_perm((select auth.uid()),'staff.manage')
);
create policy account_support_audits_scope_read on public.account_support_audits for select to authenticated using(
  target_user_id = (select auth.uid()) or public.has_perm((select auth.uid()),'account.support.manage') or public.has_perm((select auth.uid()),'audit.view')
);

drop policy if exists account_requests_own on public.account_requests;
create policy account_requests_scope_read on public.account_requests for select to authenticated using(
  user_id = (select auth.uid()) or public.has_perm((select auth.uid()),'account.support.manage') or public.has_perm((select auth.uid()),'audit.view')
);

revoke all on public.consent_policies,public.consent_records,public.staff_invitations,public.account_support_audits from public,anon,authenticated;
grant select on public.consent_policies to anon,authenticated;
grant select on public.consent_records,public.staff_invitations,public.account_support_audits to authenticated;

revoke all on function public.has_current_required_consents(uuid) from public,anon,authenticated;
revoke all on function public.record_account_consent(text,text) from public,anon,authenticated;
revoke all on function public.issue_staff_invitation(text,integer) from public,anon,authenticated;
revoke all on function public.revoke_staff_invitation(uuid,text) from public,anon,authenticated;
revoke all on function public.validate_registration_access(text,text) from public,anon,authenticated;
revoke all on function public.manage_account_request(uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.assert_account_support_target(uuid,boolean) from public,anon,authenticated;
revoke all on function public.record_account_support_action(uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.revoke_user_sessions(uuid,text) from public,anon,authenticated;
revoke all on function public.get_my_account_security_snapshot() from public,anon,authenticated;
revoke all on function public.lookup_account_support_target(text) from public,anon,authenticated;
revoke all on function public.get_account_support_snapshot() from public,anon,authenticated;

grant execute on function public.record_account_consent(text,text) to authenticated;
grant execute on function public.has_current_required_consents(uuid) to authenticated;
grant execute on function public.issue_staff_invitation(text,integer) to authenticated;
grant execute on function public.revoke_staff_invitation(uuid,text) to authenticated;
grant execute on function public.validate_registration_access(text,text) to anon,authenticated;
grant execute on function public.manage_account_request(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.record_account_support_action(uuid,text,text,text,text) to authenticated;
grant execute on function public.assert_account_support_target(uuid,boolean) to authenticated;
grant execute on function public.revoke_user_sessions(uuid,text) to authenticated;
grant execute on function public.get_my_account_security_snapshot() to authenticated;
grant execute on function public.lookup_account_support_target(text) to authenticated;
grant execute on function public.get_account_support_snapshot() to authenticated;

