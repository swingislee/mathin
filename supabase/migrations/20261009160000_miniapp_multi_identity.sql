-- Participation is a relationship, independent of the account's work role.
create or replace function public.miniapp_family_ready() returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active
    and p.account_status='active' and not p.password_change_required)
    and public.has_current_required_consents(auth.uid());
$$;

-- Set only by the service-owned reservation; never inferred from a phone match.
alter table public.miniapp_intakes add column uses_existing_account boolean not null default false;

create or replace function public.miniapp_prepare_family(p_subject text,p_phone text,p_local_phone text,p_scene text,p_family jsonb,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; f public.miniapp_forms%rowtype; prior boolean; owner_id uuid;
begin
  if p_subject is null or length(p_subject) not between 3 and 200 or p_phone is null or p_phone !~ '^\+[0-9]{7,20}$'
    or p_local_phone is null or p_local_phone !~ '^[0-9]{6,18}$' or p_lease is null
    or jsonb_typeof(p_family) is distinct from 'object' or octet_length(p_family::text)>24576
    or p_family->>'consent' is distinct from 'true' then raise exception 'VALIDATION'; end if;
  if not exists(select 1 from public.consent_policies where policy_kind='privacy' and required and version=p_family->>'privacyVersion')
    or not exists(select 1 from public.consent_policies where policy_kind='children_privacy' and required and version=p_family->>'childrenPrivacyVersion') then raise exception 'FORM_CHANGED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-family-subject:'||p_subject,0));
  perform pg_advisory_xact_lock(hashtextextended('miniapp-family:'||p_phone,0));
  select * into r from public.miniapp_intakes where intake_kind='family' and (verified_phone=p_phone or wechat_subject=p_subject) for update;
  if r.id is not null and (r.wechat_subject<>p_subject or r.verified_phone<>p_phone) then raise exception 'CONFLICT'; end if;
  owner_id:=public.find_wechat_auth_user(p_subject);
  if r.id is not null and owner_id is not null and owner_id<>r.registration_user_id then raise exception 'CONFLICT'; end if;
  if owner_id is not null and not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
    where p.id=owner_id and p.is_active and p.account_status='active' and not p.password_change_required
      and (nullif(u.phone,'') is null or regexp_replace(u.phone,'[^0-9]','','g')=substring(p_phone from 2))) then raise exception 'ACCOUNT_SECURITY'; end if;
  if exists(select 1 from auth.users u where regexp_replace(u.phone,'[^0-9]','','g')=substring(p_phone from 2)
    and u.id is distinct from coalesce(r.registration_user_id,owner_id)) then raise exception 'ACCOUNT_SECURITY'; end if;
  if r.id is null then
    select * into f from public.miniapp_forms where slug=coalesce(nullif(p_scene,''),'family-onboarding') and enabled
      and purpose in ('family','promotion') for share;
    if f.slug is null then raise exception 'NOT_FOUND'; end if;
    if p_family ? 'formVersion' and (p_family->>'formVersion')::integer is distinct from f.version then raise exception 'FORM_CHANGED'; end if;
    perform public.miniapp_validate_family_answers(f.fields,p_family);
    select exists(select 1 from public.leads where phone_normalized in (p_local_phone,substring(p_phone from 2)))
      or exists(select 1 from public.contacts where phone_normalized in (p_local_phone,substring(p_phone from 2)))
      or exists(select 1 from public.students where regexp_replace(parent_phone,'[^0-9]','','g') in (p_local_phone,substring(p_phone from 2))
        or regexp_replace(phone,'[^0-9]','','g') in (p_local_phone,substring(p_phone from 2))) into prior;
    insert into public.miniapp_intakes(request_id,form_slug,form_version,form_snapshot,answers,source,intake_kind,
      registration_user_id,wechat_subject,verified_phone,local_phone,acquisition_state,uses_existing_account,profile_created_at,submitted_by)
      values(gen_random_uuid(),f.slug,f.version,to_jsonb(f),p_family,f.slug,'family',coalesce(owner_id,gen_random_uuid()),p_subject,p_phone,p_local_phone,
        case when prior then 'existing_record' else 'pending' end,owner_id is not null,
        case when owner_id is not null then now() end,owner_id) returning * into r;
  end if;
  if r.lease_until>now() then raise exception 'CONFLICT'; end if;
  -- Retries keep the saved source and account identity.
  update public.miniapp_intakes set lease_key=p_lease,lease_until=now()+interval '3 minutes' where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'userId',r.registration_user_id,'created',r.profile_created_at is not null,
    'completed',r.completed_at is not null,'family',r.answers);
end $$;

create or replace function public.miniapp_complete_family(p_id uuid,p_subject text,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; f uuid; c uuid; child jsonb; uid uuid;
begin
  select * into r from public.miniapp_intakes where id=p_id and intake_kind='family' and wechat_subject=p_subject and lease_key=p_lease and lease_until>now() for update;
  uid:=r.registration_user_id;
  if r.id is null or public.find_wechat_auth_user(p_subject) is distinct from uid then raise exception 'FORBIDDEN'; end if;
  if r.uses_existing_account then
    -- The native WeChat session proves ownership. The newly verified phone is
    -- household contact information; no Auth identifier or password is changed.
    if not exists(select 1 from auth.users u where u.id=uid and (nullif(u.phone,'') is null
      or regexp_replace(u.phone,'[^0-9]','','g')=substring(r.verified_phone from 2)))
      or exists(select 1 from auth.users u where u.id<>uid and regexp_replace(u.phone,'[^0-9]','','g')=substring(r.verified_phone from 2)) then raise exception 'FORBIDDEN'; end if;
  elsif not exists(select 1 from auth.users u where u.id=uid and u.phone_confirmed_at is not null
    and nullif(btrim(coalesce(u.email,'')),'') is null
    and regexp_replace(u.phone,'[^0-9]','','g')=substring(r.verified_phone from 2)
    and u.raw_app_meta_data->>'miniapp_registration_id'=r.id::text) then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.profiles where id=uid and (r.uses_existing_account or role='parent')
    and is_active and account_status='active' and not password_change_required) then raise exception 'FORBIDDEN'; end if;
  if r.completed_at is null then
    if not exists(select 1 from public.consent_policies where policy_kind='privacy' and required and version=r.answers->>'privacyVersion')
      or not exists(select 1 from public.consent_policies where policy_kind='children_privacy' and required and version=r.answers->>'childrenPrivacyVersion') then raise exception 'FORM_CHANGED'; end if;
    if r.uses_existing_account then
      insert into public.consent_records(actor_user_id,subject_user_id,policy_kind,policy_version,scope,decision,source) values
        (uid,uid,'privacy',r.answers->>'privacyVersion','account','granted','registration'),
        (uid,uid,'children_privacy',r.answers->>'childrenPrivacyVersion','account','granted','registration');
    end if;
    insert into public.families(display_name,created_by)
      values(coalesce(nullif(r.answers->>'childName','')||'的家庭','微信登记家庭'),uid) returning id into f;
    insert into public.contacts(display_name,phone,phone_normalized,profile_id,created_by)
      values(coalesce(nullif(r.answers->>'parentName',''),'家长'),r.verified_phone,substring(r.verified_phone from 2),uid,uid) returning id into c;
    insert into public.family_contacts(family_id,contact_id,is_primary,created_by) values(f,c,true,uid);
    update public.miniapp_intakes set family_id=f where id=r.id;
    for child in select value from jsonb_array_elements(public.miniapp_family_children(r.answers)) loop
      perform public.miniapp_attach_family_child(r.id,child,r.answers->>'parentName',r.answers->>'relation');
    end loop;
    update public.miniapp_intakes set completed_at=now(),
      acquisition_state=case when acquisition_state='existing_record' then 'existing_record' else 'new' end where id=r.id;
  end if;
  select * into r from public.miniapp_intakes where id=p_id;
  return jsonb_build_object('studentId',r.student_id,'grade',(public.miniapp_family_children(r.answers)->0->>'grade')::integer,
    'participantIds',coalesce((select jsonb_agg(value) from jsonb_each_text(r.child_participants)),'[]'::jsonb));
end $$;
revoke all on function public.miniapp_prepare_family(text,text,text,text,jsonb,uuid),public.miniapp_complete_family(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.miniapp_prepare_family(text,text,text,text,jsonb,uuid),public.miniapp_complete_family(uuid,text,uuid) to service_role;
