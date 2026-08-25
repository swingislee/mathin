\set ON_ERROR_STOP on
-- R1-3: Auth, RLS, Storage, consent, rights, support, and administrator invariants.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as teacher_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as student_id from public.profiles where display_name = '测试-学生' limit 1 \gset
select code as general_invite_code from public.registration_invite_settings where id = 1 \gset
\if :{?admin_id}
\else
  \echo R1 fixtures missing: 测试-管理员
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}';
begin
  if not exists(select 1 from unnest(public.school_permission_keys()) key where key='account.support.manage') then failures:=array_append(failures,'account support permission missing'); end if;
  if (select count(*) from public.consent_policies where required) <> 2 then failures:=array_append(failures,'required consent policies incomplete'); end if;
  if exists(select 1 from unnest(array['consent_policies','consent_records','staff_invitations','account_support_audits']) table_name
    where not (select relrowsecurity from pg_class where oid=('public.'||table_name)::regclass)) then failures:=array_append(failures,'R1-3 table without RLS'); end if;
  if has_table_privilege('authenticated','public.consent_records','INSERT') then failures:=array_append(failures,'consent ledger accepts direct insert'); end if;
  if has_table_privilege('authenticated','public.staff_invitations','INSERT') then failures:=array_append(failures,'staff invitation accepts direct insert'); end if;
  if has_table_privilege('authenticated','public.account_support_audits','INSERT') then failures:=array_append(failures,'support audit accepts direct insert'); end if;
  if not has_function_privilege('authenticated','public.get_my_account_security_snapshot()','EXECUTE') then failures:=array_append(failures,'self security snapshot unavailable'); end if;
  if cardinality(failures)>0 then raise exception 'R1-3 structure assertions failed: %',array_to_string(failures,', '); end if;
end
$$;

-- Auth registration gate rejects a bypass that omits required consent.
do $$
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data)
    values('00000000-0000-4000-8000-000000000099','r1-invalid@mathin.local','{}'::jsonb);
    raise exception 'R1_AUTH_REGISTRATION_WITHOUT_CONSENT_WAS_ACCEPTED';
  exception when others then
    if SQLERRM not like '%REGISTRATION_CONSENT_REQUIRED%' then raise; end if;
  end;
end
$$;

insert into storage.objects(id,bucket_id,name,owner_id)
values('00000000-0000-4000-8000-000000000901','session-videos',:'admin_id'||'/r1-private.mp4',:'admin_id');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'student_id', true);

select public.record_account_consent('privacy','granted');
select public.record_account_consent('children_privacy','granted');
select public.has_current_required_consents(:'student_id'::uuid) as student_consents_current \gset
\if :student_consents_current
\else
  \echo R1-3 exact-version consent ledger is not current
  select 1 / 0;
\endif

do $$
begin
  begin
    perform public.issue_staff_invitation('blocked@example.invalid',7);
    raise exception 'R1_NON_MANAGER_STAFF_INVITE_WAS_ACCEPTED';
  exception when others then if SQLERRM <> 'FORBIDDEN' then raise; end if; end;
  begin
    perform public.lookup_account_support_target('ci-admin@mathin.local');
    raise exception 'R1_NON_SUPPORT_LOOKUP_WAS_ACCEPTED';
  exception when others then if SQLERRM <> 'FORBIDDEN' then raise; end if; end;
  begin
    insert into public.consent_records(actor_user_id,subject_user_id,policy_kind,policy_version,scope,decision,source)
    values(auth.uid(),auth.uid(),'privacy','2026-07-28','account','granted','account_center');
    raise exception 'R1_DIRECT_CONSENT_WRITE_WAS_ACCEPTED';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.account_requests where user_id<>auth.uid()) then
    raise exception 'R1_CROSS_USER_RIGHTS_REQUEST_WAS_VISIBLE';
  end if;
  if exists(select 1 from storage.objects where id='00000000-0000-4000-8000-000000000901') then
    raise exception 'R1_CROSS_USER_PRIVATE_STORAGE_WAS_VISIBLE';
  end if;
end
$$;

select public.request_account_action('export','R1 assertion','account') as request_id \gset
do $$
begin
  begin
    perform public.request_account_action('export','duplicate','account');
    raise exception 'R1_DUPLICATE_RIGHTS_REQUEST_WAS_ACCEPTED';
  exception when others then if SQLERRM <> 'REQUEST_ALREADY_OPEN' then raise; end if; end;
end
$$;
reset role;
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000902',:'student_id');
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at)
values('00000000-0000-4000-8000-000000000903',:'admin_id','totp','verified',now(),now());


-- Admin support: invitation is email-bound, last-admin lock is rejected, and
-- rights completion requires verified identity; R1-7E export completion also requires a generated artifact.
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- The trusted identity RPC may change only role. A direct authenticated update
-- remains blocked, and the role bypass must not expose the other protected fields.
do $$
declare
  actor_id uuid := auth.uid();
  target_id uuid;
begin
  select id into target_id from public.profiles where display_name = '测试-学生' limit 1;

  perform set_config('app.allow_profile_role_update', '', true);
  begin
    update public.profiles set role = 'staff' where id = actor_id;
    raise exception 'R1_DIRECT_PROFILE_ROLE_UPDATE_WAS_ACCEPTED';
  exception when others then
    if SQLERRM <> 'protected profile fields can only be changed by a trusted operation' then raise; end if;
  end;

  perform set_config('app.allow_profile_role_update', '1', true);
  begin
    update public.profiles
       set role = 'staff', account_status = 'locked'
     where id = actor_id;
    raise exception 'R1_ROLE_BYPASS_CHANGED_ACCOUNT_STATUS';
  exception when others then
    if SQLERRM <> 'protected profile fields can only be changed by a trusted operation' then raise; end if;
  end;
  perform set_config('app.allow_profile_role_update', '', true);

  perform public.admin_set_identity(target_id, 'staff');
  if (select role from public.profiles where id = target_id) <> 'staff' then
    raise exception 'R1_ADMIN_SET_IDENTITY_ROLE_UPDATE_FAILED';
  end if;
  perform public.admin_set_identity(target_id, 'student');
  perform set_config('app.allow_profile_role_update', '', true);
end
$$;
select set_config('request.jwt.claim.role', '', true);

select invitation_id,invite_code,expires_at
  from public.issue_staff_invitation('new-staff@example.invalid',7) \gset
select public.validate_registration_access(:'invite_code','new-staff@example.invalid') as invite_correct_email \gset
select public.validate_registration_access(:'invite_code','wrong@example.invalid') as invite_wrong_email \gset
\if :invite_correct_email
\else
  \echo R1-3 staff invite rejected its bound email
  select 1 / 0;
\endif
\if :invite_wrong_email
  \echo R1-3 staff invite accepted a different email
  select 1 / 0;
\endif

select invitation_id,invite_code,expires_at,identifier_type,identifier_normalized
  from public.issue_staff_identity_invitation('phone','139 0000 0098',7) \gset phone_invite_
select public.validate_registration_access_v2(
  :'phone_invite_invite_code','phone','+86 139 0000 0098'
) as phone_invite_correct \gset
select public.validate_registration_access_v2(
  :'phone_invite_invite_code','phone','13800000098'
) as phone_invite_wrong \gset
select public.validate_registration_access_v2(
  :'general_invite_code','phone','+8613800000098'
) as general_phone_invite_accepted \gset
\if :phone_invite_correct
\else
  \echo R1-Live phone staff invite rejected its normalized bound phone
  select 1 / 0;
\endif
\if :phone_invite_wrong
  \echo R1-Live phone staff invite accepted a different phone
  select 1 / 0;
\endif
\if :general_phone_invite_accepted
  \echo R1-Live general invite incorrectly opened phone signup
  select 1 / 0;
\endif

reset role;
insert into auth.users(id,phone,raw_user_meta_data)
values(
  '00000000-0000-4000-8000-000000000098',
  '+8613900000098',
  jsonb_build_object(
    'display_name','测试-手机教师',
    'registration_invite_code',:'phone_invite_invite_code',
    'privacy_consent',true,
    'children_privacy_consent',true
  )
);
do $$
begin
  if not exists(
    select 1 from public.profiles
     where id='00000000-0000-4000-8000-000000000098' and role='staff'
  ) then raise exception 'R1_PHONE_INVITE_DID_NOT_CREATE_STAFF_PROFILE'; end if;
  if not exists(
    select 1 from public.account_identifier_assurances
     where user_id='00000000-0000-4000-8000-000000000098'
       and identifier_type='phone'
       and attestation_source='staff_invite'
       and not provider_verified
  ) then raise exception 'R1_PHONE_INVITE_ASSURANCE_MISSING'; end if;
end
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);
select set_config('request.jwt.claim.role', '', true);

do $$
declare request_id uuid;
begin
  select id into request_id from public.account_requests where kind='export' and status='submitted' limit 1;
  begin
    perform public.assert_account_support_target(auth.uid(),true);
    raise exception 'R1_LAST_ADMIN_LOCK_WAS_ACCEPTED';
  exception when others then if SQLERRM <> 'FORBIDDEN' then raise; end if; end;
  begin
    perform public.manage_account_request(request_id,'completed','pending',null,'done',repeat('a',64));
    raise exception 'R1_UNVERIFIED_RIGHTS_COMPLETION_WAS_ACCEPTED';
  exception when others then if SQLERRM <> 'IDENTITY_NOT_VERIFIED' then raise; end if; end;
end
$$;

select public.manage_account_request(:'request_id'::uuid,'approved','verified','verified in R1 assertion',null,null);
select artifact_id,artifact_hash
  from public.prepare_user_rights_export(:'request_id'::uuid) \gset rights_export_
select (
  select request_row.status='completed' and request_row.evidence_hash=:'rights_export_artifact_hash'
  from public.account_requests request_row where request_row.id=:'request_id'::uuid
) as rights_export_completed \gset
\if :rights_export_completed
\else
  \echo R1-7E artifact did not complete the verified export request
  select 1 / 0;
\endif

select public.revoke_user_sessions(:'student_id'::uuid,'R1 assertion') as revoked_sessions \gset
select (:'revoked_sessions'::bigint>=1) as sessions_revoked \gset
\if :sessions_revoked
\else
  \echo R1-3 support session revocation failed
  select 1 / 0;
\endif

select public.record_account_support_action(:'student_id'::uuid,'ban','R1 assertion','succeeded',repeat('b',64));
select (select account_status='locked' from public.profiles where id=:'student_id'::uuid) as account_locked \gset
\if :account_locked
\else
  \echo R1-3 account lock did not fail closed
  select 1 / 0;
\endif
select public.record_account_support_action(:'student_id'::uuid,'restore','R1 assertion','succeeded',repeat('c',64));

select ((public.get_account_support_snapshot()->>'adminsWithoutMfa')::integer=0) as admin_mfa_complete \gset
\if :admin_mfa_complete
\else
  \echo R1-3 admin MFA posture is not measurable
  select 1 / 0;
\endif

reset role;
rollback;
\echo R1-3 account security assertions passed
