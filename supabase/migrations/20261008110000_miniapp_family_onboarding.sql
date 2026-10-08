-- Extend the existing forms/intake ledger. No parallel account, child or acquisition tables.
-- Runtime activation is separate; this migration neither imports people nor grants staff roles.
alter table public.miniapp_forms
  add column purpose text not null default 'generic' check(purpose in ('generic','family','promotion')),
  add column promoter_name text check(promoter_name is null or length(btrim(promoter_name)) between 1 and 100),
  add column created_by uuid references public.profiles(id);
alter table public.miniapp_intakes
  add column intake_kind text not null default 'generic' check(intake_kind in ('generic','family','touch')),
  add column registration_user_id uuid,
  add column wechat_subject text,
  add column verified_phone text check(verified_phone is null or verified_phone ~ '^\+[0-9]{7,20}$'),
  add column local_phone text check(local_phone is null or local_phone ~ '^[0-9]{6,18}$'),
  add column acquisition_state text check(acquisition_state in ('pending','new','existing_record','registered')),
  add column lease_key uuid,
  add column lease_until timestamptz,
  add column profile_created_at timestamptz,
  add column completed_at timestamptz,
  add column family_id uuid references public.families(id),
  add column student_id uuid references public.students(id),
  add column lead_id uuid references public.leads(id);
create unique index miniapp_family_phone_once on public.miniapp_intakes(verified_phone) where intake_kind='family';
create unique index miniapp_family_wechat_once on public.miniapp_intakes(wechat_subject) where intake_kind='family';
create unique index miniapp_family_user_once on public.miniapp_intakes(registration_user_id) where intake_kind='family';
create index miniapp_promotion_intakes on public.miniapp_intakes(form_slug,created_at desc) where intake_kind in ('family','touch');
alter table public.account_identifier_assurances drop constraint account_identifier_assurances_attestation_source_check;
alter table public.account_identifier_assurances add constraint account_identifier_assurances_attestation_source_check
  check(attestation_source in ('global_invite','staff_invite','wechat_phone'));

-- Promotion administration and private onboarding material are read through permission-checked RPCs.
drop policy miniapp_forms_read on public.miniapp_forms;
create policy miniapp_forms_read on public.miniapp_forms for select using((enabled and purpose='generic') or public.is_admin((select auth.uid())));
drop policy miniapp_intakes_read on public.miniapp_intakes;
create policy miniapp_intakes_read on public.miniapp_intakes for select to authenticated
  using(public.is_admin((select auth.uid())) or (intake_kind='generic' and submitted_by=(select auth.uid())));

insert into public.miniapp_forms(slug,title,description,privacy_notice,fields,enabled,purpose) values
 ('family-onboarding','{"zh":"家庭信息","en":"Family details"}',
  '{"zh":"建立家长账号，查看适合孩子的活动","en":"Create your parent account and discover activities"}',
  '{"zh":"手机号用于账号识别与活动联系，家庭信息用于提供服务；仅经授权记录本次定位。","en":"Your phone identifies your account and supports activity contact. Location is recorded only with permission."}',
  '[{"id":"parentName","type":"text","label":{"zh":"家长姓名","en":"Parent name"},"required":true},{"id":"childName","type":"text","label":{"zh":"孩子姓名","en":"Child name"},"required":true}]',true,'family');

create function public.miniapp_prepare_family(p_subject text,p_phone text,p_local_phone text,p_scene text,p_family jsonb,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; f public.miniapp_forms%rowtype; prior boolean;
begin
  if p_subject is null or length(p_subject) not between 3 and 200 or p_phone is null or p_phone !~ '^\+[0-9]{7,20}$'
    or p_local_phone is null or p_local_phone !~ '^[0-9]{6,18}$' or p_lease is null
    or jsonb_typeof(p_family) is distinct from 'object' or octet_length(p_family::text)>8192
    or p_family->>'consent' is distinct from 'true'
    or coalesce(length(btrim(p_family->>'parentName')),0) not between 1 and 100
    or coalesce(length(btrim(p_family->>'childName')),0) not between 1 and 100
    or coalesce(p_family->>'relation','') not in ('mother','father','guardian')
    or coalesce((p_family->>'grade')::integer,-99) not between -1 and 12 then raise exception 'VALIDATION'; end if;
  if not exists(select 1 from public.consent_policies where policy_kind='privacy' and required and version=p_family->>'privacyVersion')
    or not exists(select 1 from public.consent_policies where policy_kind='children_privacy' and required and version=p_family->>'childrenPrivacyVersion') then raise exception 'FORM_CHANGED'; end if;
  select * into f from public.miniapp_forms where slug=coalesce(nullif(p_scene,''),'family-onboarding') and enabled
    and purpose in ('family','promotion') for share;
  if f.slug is null then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-family:'||p_phone,0));
  select * into r from public.miniapp_intakes where intake_kind='family' and (verified_phone=p_phone or wechat_subject=p_subject) for update;
  if r.id is not null and (r.wechat_subject<>p_subject or r.verified_phone<>p_phone) then raise exception 'CONFLICT'; end if;
  if exists(select 1 from auth.users u where regexp_replace(u.phone,'[^0-9]','','g')=substring(p_phone from 2) and u.id is distinct from r.registration_user_id) then raise exception 'ACCOUNT_SECURITY'; end if;
  if r.id is null then
    select exists(select 1 from public.leads where phone_normalized in (p_local_phone,substring(p_phone from 2)))
      or exists(select 1 from public.contacts where phone_normalized in (p_local_phone,substring(p_phone from 2)))
      or exists(select 1 from public.students where regexp_replace(parent_phone,'[^0-9]','','g') in (p_local_phone,substring(p_phone from 2))
        or regexp_replace(phone,'[^0-9]','','g') in (p_local_phone,substring(p_phone from 2))) into prior;
    insert into public.miniapp_intakes(request_id,form_slug,form_version,form_snapshot,answers,source,intake_kind,
      registration_user_id,wechat_subject,verified_phone,local_phone,acquisition_state)
      values(gen_random_uuid(),f.slug,f.version,to_jsonb(f),p_family,f.slug,'family',gen_random_uuid(),p_subject,p_phone,p_local_phone,
        case when prior then 'existing_record' else 'pending' end) returning * into r;
  end if;
  if r.lease_until>now() then raise exception 'CONFLICT'; end if;
  update public.miniapp_intakes set lease_key=p_lease,lease_until=now()+interval '3 minutes',
    answers=case when profile_created_at is null then p_family else answers end where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'userId',r.registration_user_id,'created',r.profile_created_at is not null,
    'completed',r.completed_at is not null,'family',r.answers);
end $$;

-- Only an Auth insert with service-controlled app_metadata and a current reserved ID can take this branch.
create function public.miniapp_create_parent_profile(p_id uuid,p_phone text,p_registration text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype;
begin
  if p_registration is null then return false; end if;
  select * into r from public.miniapp_intakes where intake_kind='family' and registration_user_id=p_id and id::text=p_registration
    and substring(verified_phone from 2)=regexp_replace(p_phone,'[^0-9]','','g') and profile_created_at is null and lease_until>now() for update;
  if r.id is null then raise exception 'INVALID_REGISTRATION'; end if;
  if not exists(select 1 from public.consent_policies where policy_kind='privacy' and required and version=r.answers->>'privacyVersion')
    or not exists(select 1 from public.consent_policies where policy_kind='children_privacy' and required and version=r.answers->>'childrenPrivacyVersion') then raise exception 'FORM_CHANGED'; end if;
  insert into public.profiles(id,display_name,role,privacy_consented_at,children_privacy_consented_at)
    values(p_id,r.answers->>'parentName','parent',now(),now());
  insert into public.consent_records(actor_user_id,subject_user_id,policy_kind,policy_version,scope,decision,source) values
    (p_id,p_id,'privacy',r.answers->>'privacyVersion','account','granted','registration'),
    (p_id,p_id,'children_privacy',r.answers->>'childrenPrivacyVersion','account','granted','registration');
  insert into public.account_identifier_assurances(user_id,identifier_type,identifier_hash,attestation_source,provider_verified,provider_verified_at)
    values(p_id,'phone',encode(extensions.digest(public.normalize_login_identifier('phone',p_phone),'sha256'),'hex'),'wechat_phone',true,now());
  update public.miniapp_intakes set profile_created_at=now(),submitted_by=p_id where id=r.id;
  return true;
end $$;

create function public.miniapp_complete_family(p_id uuid,p_subject text,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; f uuid; c uuid; s uuid; l uuid; relation_text text; uid uuid;
begin
  select * into r from public.miniapp_intakes where id=p_id and intake_kind='family' and wechat_subject=p_subject and lease_key=p_lease and lease_until>now() for update;
  uid:=r.registration_user_id;
  if r.id is null or public.find_wechat_auth_user(p_subject) is distinct from uid then raise exception 'FORBIDDEN'; end if;
  if r.completed_at is not null then return jsonb_build_object('studentId',r.student_id,'grade',(r.answers->>'grade')::integer); end if;
  if not exists(select 1 from public.profiles where id=uid and role='parent' and is_active and account_status='active') then raise exception 'FORBIDDEN'; end if;
  relation_text:=case r.answers->>'relation' when 'mother' then '妈妈' when 'father' then '爸爸' else '监护人' end;
  insert into public.families(display_name,created_by) values((r.answers->>'childName')||'的家庭',uid) returning id into f;
  insert into public.contacts(display_name,phone,phone_normalized,profile_id,created_by)
    values(r.answers->>'parentName',r.verified_phone,substring(r.verified_phone from 2),uid,uid) returning id into c;
  insert into public.family_contacts(family_id,contact_id,is_primary,created_by) values(f,c,true,uid);
  insert into public.students(name,gender,grade,school,parent_name,parent_relation,parent_phone,bind_code,source,created_by)
    values(r.answers->>'childName',coalesce(r.answers->>'gender',''),case when (r.answers->>'grade')::integer>0 then (r.answers->>'grade')::smallint end,
      coalesce(r.answers->>'school',''),r.answers->>'parentName',relation_text,r.verified_phone,public.generate_student_bind_code(),'微信自助登记',uid) returning id into s;
  insert into public.family_students(family_id,student_id,created_by) values(f,s,uid);
  insert into public.student_contacts(student_id,contact_id,relation,is_primary,is_decision_maker,created_by) values(s,c,relation_text,true,true,uid);
  -- Initial self-service accounts can register for activities only. Existing learning, video and finance scopes are not granted.
  insert into public.student_guardians(student_id,guardian_id,relation,scope,is_primary) values(s,uid,relation_text,array['activities'],true);
  select id into l from public.leads where phone_normalized in(r.local_phone,substring(r.verified_phone from 2))
    and normalized_name=public.normalize_lead_name(r.answers->>'childName') order by created_at limit 1;
  if l is null then
    insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,grade_text,status,student_id,family_id,contact_id,identity_confirmed_by,identity_confirmed_at,created_by)
      values(r.answers->>'childName',public.normalize_lead_name(r.answers->>'childName'),r.verified_phone,r.local_phone,
        case when (r.answers->>'grade')::integer>0 then (r.answers->>'grade')::smallint end,r.answers->>'grade',
        'converted',s,f,c,uid,now(),uid) returning id into l;
  end if;
  update public.miniapp_intakes set family_id=f,student_id=s,lead_id=l,completed_at=now(),
    acquisition_state=case when acquisition_state='existing_record' then 'existing_record' else 'new' end where id=r.id;
  return jsonb_build_object('studentId',s,'grade',(r.answers->>'grade')::integer);
end $$;

create function public.miniapp_record_promotion_touch(p_scene text,p_user uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.miniapp_forms%rowtype; r public.miniapp_intakes%rowtype;
begin
  select * into f from public.miniapp_forms where slug=p_scene and enabled and purpose='promotion';
  if f.slug is null then return; end if;
  select * into r from public.miniapp_intakes where intake_kind='family' and registration_user_id=p_user and completed_at is not null;
  insert into public.miniapp_intakes(request_id,form_slug,form_version,form_snapshot,answers,source,submitted_by,intake_kind,
    registration_user_id,verified_phone,acquisition_state,completed_at,student_id,lead_id)
    select gen_random_uuid(),f.slug,f.version,to_jsonb(f),coalesce(r.answers,jsonb_build_object('parentName',p.display_name)),f.slug,p_user,'touch',
      p_user,coalesce(r.verified_phone,case when nullif(u.phone,'') is not null then '+'||regexp_replace(u.phone,'[^0-9]','','g') end),'registered',now(),r.student_id,r.lead_id
    from public.profiles p join auth.users u on u.id=p.id where p.id=p_user;
end $$;

revoke all on function public.miniapp_prepare_family(text,text,text,text,jsonb,uuid),public.miniapp_create_parent_profile(uuid,text,text),
 public.miniapp_complete_family(uuid,text,uuid),public.miniapp_record_promotion_touch(text,uuid) from public,anon,authenticated;
grant execute on function public.miniapp_prepare_family(text,text,text,text,jsonb,uuid),public.miniapp_complete_family(uuid,text,uuid),
 public.miniapp_record_promotion_touch(text,uuid) to service_role;

create function public.miniapp_manage_promotion(p_scene text,p_name text,p_enabled boolean default true)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare result text; f public.miniapp_forms%rowtype;
begin
  if not public.has_perm(auth.uid(),'registration.invite.manage') then raise exception 'FORBIDDEN'; end if;
  if p_enabled is null or coalesce(length(btrim(p_name)),0) not between 1 and 100 then raise exception 'VALIDATION'; end if;
  if p_scene is null then
    result:=encode(extensions.gen_random_bytes(12),'hex');
    select * into f from public.miniapp_forms where slug='family-onboarding';
    insert into public.miniapp_forms(slug,title,description,privacy_notice,fields,enabled,purpose,promoter_name,created_by)
      values(result,f.title,f.description,f.privacy_notice,f.fields,p_enabled,'promotion',btrim(p_name),auth.uid());
  else
    update public.miniapp_forms set enabled=p_enabled where slug=p_scene and purpose='promotion' returning slug into result;
    if result is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return result;
end $$;

create function public.miniapp_promotion_dashboard(p_scene text default null,p_page integer default 1)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
begin
  if not public.has_perm(auth.uid(),'registration.invite.manage') then raise exception 'FORBIDDEN'; end if;
  if p_page<1 or p_page>100000 then raise exception 'VALIDATION'; end if;
  return jsonb_build_object('promotions',coalesce((select jsonb_agg(row_data order by row_data->>'updatedAt' desc) from (
    select jsonb_build_object('scene',f.slug,'name',f.promoter_name,'enabled',f.enabled,'updatedAt',f.updated_at,
      'newCount',count(i.id) filter(where i.acquisition_state='new' and i.completed_at is not null),
      'repeatCount',count(i.id) filter(where i.acquisition_state in ('registered','existing_record') and i.completed_at is not null)) row_data
    from public.miniapp_forms f left join public.miniapp_intakes i on i.form_slug=f.slug and i.intake_kind in ('family','touch')
    where f.purpose='promotion' group by f.slug) q),'[]'::jsonb),
    'total',(select count(*) from public.miniapp_intakes where intake_kind in ('family','touch') and completed_at is not null and (p_scene is null or form_slug=p_scene)),
    'records',coalesce((select jsonb_agg(row_data) from (
      select jsonb_build_object('id',i.id,'at',i.completed_at,'promoter',coalesce(i.form_snapshot->>'promoter_name',''),
        'state',i.acquisition_state,'phone',i.verified_phone,'parentName',i.answers->>'parentName',
        'childName',i.answers->>'childName','grade',i.answers->>'grade','school',i.answers->>'school','interests',i.answers->'interests',
        'location',case when i.intake_kind='family' then i.answers->'location' else null end,
        'studentId',i.student_id,'leadId',i.lead_id) row_data
      from public.miniapp_intakes i where i.intake_kind in ('family','touch') and i.completed_at is not null
        and (p_scene is null or i.form_slug=p_scene) order by i.completed_at desc,i.id offset (p_page-1)*30 limit 30) q),'[]'::jsonb));
end $$;
revoke all on function public.miniapp_manage_promotion(text,text,boolean),public.miniapp_promotion_dashboard(text,integer) from public,anon;
grant execute on function public.miniapp_manage_promotion(text,text,boolean),public.miniapp_promotion_dashboard(text,integer) to authenticated;

create function public.miniapp_can_register(p_student uuid,p_kind text) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select public.miniapp_can_participate(p_student) or (
    p_kind='activity' and public.miniapp_family_ready()
    and exists(select 1 from public.students s join public.student_guardians g on g.student_id=s.id
      where s.id=p_student and s.deleted_at is null and g.guardian_id=auth.uid() and 'activities'=any(g.scope))
  );
$$;
revoke all on function public.miniapp_can_register(uuid,text) from public,anon;
grant execute on function public.miniapp_can_register(uuid,text) to authenticated;

-- Preserve the existing invitation paths while adding the verified family branch.
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
  if new.raw_app_meta_data ? 'miniapp_registration_id' then
    if nullif(btrim(coalesce(new.email,'')),'') is not null or new.phone_confirmed_at is null then
      raise exception 'INVALID_REGISTRATION';
    end if;
    if public.miniapp_create_parent_profile(new.id,new.phone,new.raw_app_meta_data->>'miniapp_registration_id') then return new; end if;
  end if;
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

-- Permit the dedicated activities scope without expanding learning or finance access.
create or replace function public.miniapp_apply_registration(p_id uuid,p_kind text,p_target_id uuid,p_revision integer,p_student_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_offer jsonb; v_row parent_registration_applications;
begin
  if not public.miniapp_can_register(p_student_id,p_kind) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_kind is null or p_kind not in ('class','activity') then raise exception 'VALIDATION'; end if;
  if exists(select 1 from parent_course_applications where id=p_id) then raise exception 'CONFLICT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text,6843));
  select * into v_row from parent_registration_applications where id=p_id;
  if found then
    if v_row.applicant_id<>auth.uid() or v_row.student_id<>p_student_id or v_row.kind<>p_kind
      or coalesce(v_row.classroom_id,v_row.activity_id) is distinct from p_target_id
      or (v_row.snapshot->>'revision')::integer is distinct from p_revision then raise exception 'CONFLICT'; end if;
    return v_row.id;
  end if;
  -- Serialize publication changes with submission; pre-registration does not consume capacity.
  if p_kind='class' then
    perform 1 from classrooms where id=p_target_id for share;
  else perform 1 from activities where id=p_target_id for share; end if;
  select x into v_offer from jsonb_array_elements(public.miniapp_registration_catalog()) x where x->>'kind'=p_kind and x->>'id'=p_target_id::text;
  if v_offer is null then raise exception 'BOOKING_CLOSED'; end if;
  if (v_offer->>'revision')::integer is distinct from p_revision then raise exception 'FORM_CHANGED'; end if;
  if exists(select 1 from parent_registration_applications where student_id=p_student_id and kind=p_kind and coalesce(classroom_id,activity_id)=p_target_id and status='pending') then raise exception 'CONFLICT'; end if;
  insert into parent_registration_applications(id,kind,classroom_id,activity_id,applicant_id,student_id,snapshot)
    values(p_id,p_kind,case when p_kind='class' then p_target_id end,case when p_kind='activity' then p_target_id end,auth.uid(),p_student_id,v_offer);
  return p_id;
end $$;

-- Permit the dedicated activities scope without expanding learning or finance access.
create or replace function public.miniapp_registration_applications() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.miniapp_family_ready() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(item order by created_at desc),'[]'::jsonb) from (
    select a.created_at,mathin_internal.parent_registration_application_json(a,s.name) item
      from parent_registration_applications a join students s on s.id=a.student_id
      where a.applicant_id=auth.uid() and public.miniapp_can_register(a.student_id,a.kind)
    union all
    select a.created_at,jsonb_build_object('id',a.id,'kind','class','participantId',a.student_id,'participantName',s.name,
      'publicationId',a.publication_id,'classroomId',a.classroom_id,'activityId',null,'title',a.offer_snapshot->>'title',
      'className',a.offer_snapshot#>>'{class,name}','priceCents',a.offer_snapshot->'priceCents',
      'status',a.status,'createdAt',a.created_at,'resolvedAt',a.resolved_at,'reply',a.reply)
      from parent_course_applications a join students s on s.id=a.student_id
      where a.applicant_id=auth.uid() and public.miniapp_can_participate(a.student_id)
  ) records);
end $$;

-- Permit the dedicated activities scope without expanding learning or finance access.
create or replace function public.miniapp_cancel_registration(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row parent_registration_applications;
begin
  select * into v_row from parent_registration_applications where id=p_id for update;
  if not found then perform public.miniapp_cancel_course_application(p_id); return; end if;
  if v_row.applicant_id<>auth.uid() or not public.miniapp_can_register(v_row.student_id,v_row.kind) then raise exception 'FORBIDDEN'; end if;
  if v_row.status='cancelled' then return; end if;
  if v_row.status<>'pending' then raise exception 'CONFLICT'; end if;
  update parent_registration_applications set status='cancelled',resolved_at=now(),resolved_by=auth.uid() where id=p_id;
end $$;
