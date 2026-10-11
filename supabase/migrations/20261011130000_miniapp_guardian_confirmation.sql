-- A staff-issued capability is redeemed only after an explicit guardian confirmation.
-- Scanning, phone verification and ordinary login do not create a student relationship.
alter table public.guardian_bind_invitations add column revoked_at timestamptz;
alter table public.guardian_bind_invitations drop constraint guardian_invitation_scope;
alter table public.guardian_bind_invitations add constraint guardian_invitation_scope
  check(scope <@ array['grades','video','finance','activities']::text[]);
alter table public.miniapp_intakes drop constraint miniapp_intakes_intake_kind_check;
alter table public.miniapp_intakes add constraint miniapp_intakes_intake_kind_check
  check(intake_kind in ('generic','family','touch','family_update','guardian'));
alter table public.miniapp_intakes add column guardian_invitation_id uuid references public.guardian_bind_invitations(id);
create unique index miniapp_guardian_invitation_once on public.miniapp_intakes(guardian_invitation_id) where intake_kind='guardian';

create function public.issue_miniapp_guardian_invite(p_student_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); invitation public.guardian_bind_invitations%rowtype;
begin
  if uid is null or not public.has_perm(uid,'student.edit') or not public.can_access_student(p_student_id,uid)
    or not exists(select 1 from public.students where id=p_student_id and deleted_at is null) then raise exception 'FORBIDDEN'; end if;
  insert into public.guardian_bind_invitations(student_id,code,scope,issued_by)
    values(p_student_id,encode(extensions.gen_random_bytes(16),'hex'),array['grades','activities'],uid) returning * into invitation;
  return jsonb_build_object('id',invitation.id,'code',invitation.code,'expiresAt',invitation.expires_at);
end $$;

create function public.revoke_miniapp_guardian_invite(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation public.guardian_bind_invitations%rowtype;
begin
  select * into invitation from public.guardian_bind_invitations where id=p_id and length(code)=32 for update;
  if invitation.id is null or auth.uid() is null or not public.has_perm(auth.uid(),'student.edit')
    or not public.can_access_student(invitation.student_id,auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if invitation.used_at is not null then raise exception 'CONFLICT'; end if;
  update public.guardian_bind_invitations set revoked_at=now(),expires_at=least(expires_at,now()) where id=p_id;
end $$;

-- Never expose the full name, student ID, phone, school or existing records before confirmation.
create function public.miniapp_guardian_preview(p_code text) returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select jsonb_build_object('maskedName',case when length(btrim(s.name))>1 then left(btrim(s.name),1)||'＊' else '＊' end,'expiresAt',i.expires_at)
  from public.guardian_bind_invitations i join public.students s on s.id=i.student_id
  where i.code=p_code and length(i.code)=32 and i.used_at is null and i.revoked_at is null and i.expires_at>now()
    and s.deleted_at is null and public.has_perm(i.issued_by,'student.edit') and public.can_access_student(s.id,i.issued_by);
$$;

create function public.miniapp_prepare_guardian(p_code text,p_subject text,p_phone text,p_local_phone text,p_answers jsonb,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation public.guardian_bind_invitations%rowtype; r public.miniapp_intakes%rowtype; owner_id uuid;
begin
  if p_code is null or p_code !~ '^[a-f0-9]{32}$' or p_subject is null or length(p_subject) not between 3 and 200
    or p_phone is null or p_phone !~ '^\+[0-9]{7,20}$' or p_local_phone is null or p_local_phone !~ '^[0-9]{6,18}$'
    or p_lease is null or jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text)>4096
    or p_answers->>'consent' is distinct from 'true'
    or coalesce(length(btrim(p_answers->>'parentName')),0) not between 1 and 100
    or coalesce(p_answers->>'relation','') not in ('mother','father','guardian') then raise exception 'VALIDATION'; end if;
  if not exists(select 1 from public.consent_policies where policy_kind='privacy' and required and version=p_answers->>'privacyVersion')
    or not exists(select 1 from public.consent_policies where policy_kind='children_privacy' and required and version=p_answers->>'childrenPrivacyVersion') then raise exception 'FORM_CHANGED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-family-subject:'||p_subject,0));
  perform pg_advisory_xact_lock(hashtextextended('miniapp-family:'||p_phone,0));
  select * into invitation from public.guardian_bind_invitations where code=p_code for update;
  if invitation.id is null then raise exception 'NOT_FOUND'; end if;
  select * into r from public.miniapp_intakes where intake_kind='guardian' and guardian_invitation_id=invitation.id for update;
  owner_id:=public.find_wechat_auth_user(p_subject);
  if r.id is not null and (r.wechat_subject<>p_subject or r.verified_phone<>p_phone
    or (owner_id is not null and owner_id<>r.registration_user_id)) then raise exception 'CONFLICT'; end if;
  -- A lost success response is replayable only by the same verified WeChat identity.
  if r.completed_at is null and (invitation.used_at is not null or invitation.revoked_at is not null or invitation.expires_at<=now()
    or not exists(select 1 from public.students where id=invitation.student_id and deleted_at is null)
    or not public.has_perm(invitation.issued_by,'student.edit') or not public.can_access_student(invitation.student_id,invitation.issued_by)) then raise exception 'NOT_FOUND'; end if;
  if owner_id is not null and not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=owner_id and p.is_active and p.account_status='active' and not p.password_change_required
      and (nullif(u.phone,'') is null or regexp_replace(u.phone,'[^0-9]','','g')=substring(p_phone from 2))) then raise exception 'ACCOUNT_SECURITY'; end if;
  if exists(select 1 from auth.users u where regexp_replace(u.phone,'[^0-9]','','g')=substring(p_phone from 2)
    and u.id is distinct from coalesce(r.registration_user_id,owner_id)) then raise exception 'ACCOUNT_SECURITY'; end if;
  -- Do not create a second account while another explicitly submitted registration is in flight.
  if r.id is null and owner_id is null and exists(select 1 from public.miniapp_intakes where intake_kind in ('family','guardian')
    and (wechat_subject=p_subject or verified_phone=p_phone) and completed_at is null) then raise exception 'CONFLICT'; end if;
  if r.id is null then
    insert into public.miniapp_intakes(request_id,form_slug,form_version,form_snapshot,answers,source,intake_kind,
      registration_user_id,wechat_subject,verified_phone,local_phone,acquisition_state,uses_existing_account,profile_created_at,submitted_by,guardian_invitation_id)
      values(gen_random_uuid(),'family-onboarding',1,'{"title":{"zh":"关联已有孩子","en":"Link an existing child"}}',p_answers,'guardian-invitation','guardian',
        coalesce(owner_id,gen_random_uuid()),p_subject,p_phone,p_local_phone,'existing_record',owner_id is not null,
        case when owner_id is not null then now() end,owner_id,invitation.id) returning * into r;
  end if;
  if r.lease_until>now() then raise exception 'CONFLICT'; end if;
  update public.miniapp_intakes set lease_key=p_lease,lease_until=now()+interval '3 minutes',
    answers=case when completed_at is null then p_answers else answers end where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'userId',r.registration_user_id,'created',r.profile_created_at is not null,'completed',r.completed_at is not null);
end $$;

create function public.miniapp_complete_guardian(p_id uuid,p_subject text,p_lease uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; invitation public.guardian_bind_invitations%rowtype; uid uuid; relation_text text;
begin
  -- Keep the same invitation -> intake lock order as preparation and revocation.
  select i.* into invitation from public.guardian_bind_invitations i join public.miniapp_intakes m on m.guardian_invitation_id=i.id
    where m.id=p_id and m.intake_kind='guardian' for update of i;
  select * into r from public.miniapp_intakes where id=p_id and intake_kind='guardian' and wechat_subject=p_subject
    and lease_key=p_lease and lease_until>now() for update;
  uid:=r.registration_user_id;
  if r.id is null or invitation.id is null or public.find_wechat_auth_user(p_subject) is distinct from uid then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.profiles where id=uid and is_active and account_status='active' and not password_change_required)
    or not exists(select 1 from auth.users u where u.id=uid and (r.uses_existing_account or
      (u.phone_confirmed_at is not null and nullif(btrim(coalesce(u.email,'')),'') is null
        and u.raw_app_meta_data->>'miniapp_registration_id'=r.id::text))
      and (nullif(u.phone,'') is null or regexp_replace(u.phone,'[^0-9]','','g')=substring(r.verified_phone from 2))) then raise exception 'FORBIDDEN'; end if;
  if r.completed_at is null then
    if invitation.used_at is not null or invitation.revoked_at is not null or invitation.expires_at<=now()
      or not exists(select 1 from public.students where id=invitation.student_id and deleted_at is null)
      or not public.has_perm(invitation.issued_by,'student.edit') or not public.can_access_student(invitation.student_id,invitation.issued_by) then raise exception 'NOT_FOUND'; end if;
    if not exists(select 1 from public.consent_policies where policy_kind='privacy' and required and version=r.answers->>'privacyVersion')
      or not exists(select 1 from public.consent_policies where policy_kind='children_privacy' and required and version=r.answers->>'childrenPrivacyVersion') then raise exception 'FORM_CHANGED'; end if;
    relation_text:=case r.answers->>'relation' when 'mother' then '妈妈' when 'father' then '爸爸' else '监护人' end;
    insert into public.student_guardians(student_id,guardian_id,relation,scope)
      values(invitation.student_id,uid,relation_text,invitation.scope)
      on conflict(student_id,guardian_id) do update set relation=excluded.relation,
        scope=array(select distinct value from unnest(student_guardians.scope||excluded.scope) value);
    insert into public.guardian_consents(student_id,guardian_id,scope,consented) values
      (invitation.student_id,uid,'profile',true),(invitation.student_id,uid,'learning',true);
    insert into public.consent_records(actor_user_id,subject_user_id,policy_kind,policy_version,scope,decision,source) values
      (uid,uid,'privacy',r.answers->>'privacyVersion','account','granted','registration'),
      (uid,uid,'children_privacy',r.answers->>'childrenPrivacyVersion','account','granted','registration');
    update public.guardian_bind_invitations set used_by=uid,used_at=now() where id=invitation.id;
    update public.miniapp_intakes set student_id=invitation.student_id,completed_at=now() where id=r.id returning * into r;
  end if;
  return (select jsonb_build_object('studentId',s.id,'grade',s.grade,'participantIds',jsonb_build_array(s.id))
    from public.students s where s.id=r.student_id and s.deleted_at is null);
end $$;

-- Reuse the existing service-reserved account bootstrap; guardian intakes never run the child-creation helper.
do $$ declare definition text; anchor text; begin
  definition:=pg_get_functiondef('public.miniapp_create_parent_profile(uuid,text,text)'::regprocedure);
  anchor:='intake_kind=''family'' and registration_user_id=p_id';
  if position(anchor in definition)=0 then raise exception 'GUARDIAN_PROFILE_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,'intake_kind in (''family'',''guardian'') and registration_user_id=p_id');
  definition:=pg_get_functiondef('public.bind_guardian(text,text)'::regprocedure);
  anchor:='perform public.assert_bind_claim_rate(uid,''guardian'');';
  if position(anchor in definition)=0 then raise exception 'GUARDIAN_LEGACY_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,'if length(normalized)<>12 then return null; end if; '||anchor);
end $$;

revoke all on function public.issue_miniapp_guardian_invite(uuid),public.revoke_miniapp_guardian_invite(uuid),
  public.miniapp_guardian_preview(text),public.miniapp_prepare_guardian(text,text,text,text,jsonb,uuid),
  public.miniapp_complete_guardian(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.issue_miniapp_guardian_invite(uuid),public.revoke_miniapp_guardian_invite(uuid) to authenticated;
grant execute on function public.miniapp_guardian_preview(text),public.miniapp_prepare_guardian(text,text,text,text,jsonb,uuid),
  public.miniapp_complete_guardian(uuid,text,uuid) to service_role;
