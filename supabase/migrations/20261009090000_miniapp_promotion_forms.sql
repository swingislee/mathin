-- Promotion-specific forms and entry location reuse the existing form/intake ledger.
-- Self-reported names remain in answers. Staff verification never rewrites that source.
alter table public.miniapp_intakes
  add column child_participants jsonb not null default '{}' check(jsonb_typeof(child_participants)='object'),
  add column verified_details jsonb check(verified_details is null or jsonb_typeof(verified_details)='object'),
  add column verified_by uuid references public.profiles(id),
  add column verified_at timestamptz;
update public.miniapp_intakes set child_participants=jsonb_build_object('child-1',student_id)
  where intake_kind='family' and student_id is not null;

update public.miniapp_forms set
  title='{"zh":"认识你的家庭","en":"Your family"}',
  description='{"zh":"称呼或昵称都可以，方便我们与你联系。","en":"A preferred name or nickname helps us keep in touch."}',
  fields='[
    {"id":"parentName","mode":"optional","label":{"zh":"家长怎么称呼","en":"Parent’s preferred name"}},
    {"id":"relation","mode":"required","label":{"zh":"与孩子的关系","en":"Relationship"}},
    {"id":"childName","mode":"required","label":{"zh":"孩子怎么称呼","en":"Child’s preferred name"}},
    {"id":"grade","mode":"required","label":{"zh":"孩子年级","en":"Child’s grade"}},
    {"id":"school","mode":"optional","label":{"zh":"就读学校","en":"School"}},
    {"id":"gender","mode":"optional","label":{"zh":"孩子性别","en":"Child’s gender"}},
    {"id":"interests","mode":"required","label":{"zh":"感兴趣的内容","en":"Interests"},"options":[
      {"id":"math","label":{"zh":"数学思维","en":"Math thinking"}},
      {"id":"science","label":{"zh":"科学探索","en":"Science"}},
      {"id":"activities","label":{"zh":"公益活动","en":"Community activities"}}
    ]}
  ]'
where purpose in ('family','promotion');

create function public.miniapp_validate_family_form(p_config jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
declare f jsonb; o jsonb; ids text[]:='{}'; options text[]; field_id text;
begin
  if jsonb_typeof(p_config) is distinct from 'object' or octet_length(p_config::text)>16384
    or exists(select 1 from jsonb_object_keys(p_config) k where k not in ('title','description','fields'))
    or jsonb_typeof(p_config->'title') is distinct from 'object' or jsonb_typeof(p_config->'description') is distinct from 'object'
    or jsonb_typeof(p_config#>'{title,zh}') is distinct from 'string' or jsonb_typeof(p_config#>'{title,en}') is distinct from 'string'
    or jsonb_typeof(p_config#>'{description,zh}') is distinct from 'string' or jsonb_typeof(p_config#>'{description,en}') is distinct from 'string'
    or exists(select 1 from jsonb_object_keys(p_config->'title') k where k not in ('zh','en'))
    or exists(select 1 from jsonb_object_keys(p_config->'description') k where k not in ('zh','en'))
    or jsonb_typeof(p_config->'fields') is distinct from 'array'
    or jsonb_array_length(p_config->'fields')<>7
    or coalesce(length(btrim(p_config#>>'{title,zh}')),0) not between 1 and 100
    or coalesce(length(p_config#>>'{title,en}'),0)>160
    or coalesce(length(p_config#>>'{description,zh}'),0)>400
    or coalesce(length(p_config#>>'{description,en}'),0)>600 then raise exception 'VALIDATION'; end if;
  for f in select value from jsonb_array_elements(p_config->'fields') loop
    field_id:=f->>'id';
    if jsonb_typeof(f) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(f) k where k not in ('id','mode','label','options'))
      or jsonb_typeof(f->'label') is distinct from 'object'
      or jsonb_typeof(f#>'{label,zh}') is distinct from 'string' or jsonb_typeof(f#>'{label,en}') is distinct from 'string'
      or exists(select 1 from jsonb_object_keys(f->'label') k where k not in ('zh','en'))
      or field_id is null or field_id<>all(array['parentName','relation','childName','grade','school','gender','interests'])
      or field_id=any(ids) or coalesce(f->>'mode','') not in ('required','optional','hidden')
      or coalesce(length(btrim(f#>>'{label,zh}')),0) not between 1 and 100
      or coalesce(length(f#>>'{label,en}'),0)>160 then raise exception 'VALIDATION'; end if;
    ids:=array_append(ids,field_id);
    if field_id='interests' then
      if jsonb_typeof(f->'options') is distinct from 'array' or jsonb_array_length(f->'options') not between 1 and 20 then raise exception 'VALIDATION'; end if;
      options:='{}';
      for o in select value from jsonb_array_elements(f->'options') loop
        if jsonb_typeof(o) is distinct from 'object' or jsonb_typeof(o->'label') is distinct from 'object'
          or exists(select 1 from jsonb_object_keys(o) k where k not in ('id','label'))
          or jsonb_typeof(o#>'{label,zh}') is distinct from 'string' or jsonb_typeof(o#>'{label,en}') is distinct from 'string'
          or exists(select 1 from jsonb_object_keys(o->'label') k where k not in ('zh','en'))
          or o->>'id' is null or o->>'id' !~ '^[a-z][a-z0-9_-]{0,39}$' or o->>'id'=any(options)
          or coalesce(length(btrim(o#>>'{label,zh}')),0) not between 1 and 100
          or coalesce(length(o#>>'{label,en}'),0)>160 then raise exception 'VALIDATION'; end if;
        options:=array_append(options,o->>'id');
      end loop;
    elsif f ? 'options' then raise exception 'VALIDATION'; end if;
  end loop;
end $$;

-- Called only by the protected completion/verification functions below.
create function public.miniapp_attach_family_child(p_intake uuid,p_child jsonb,p_parent_name text,p_relation text,p_staff boolean default false)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; sid uuid; contact_id uuid; v_lead uuid; actor uuid; relation_text text;
begin
  select * into r from public.miniapp_intakes where id=p_intake and intake_kind='family' for update;
  if r.id is null or r.family_id is null or r.registration_user_id is null then raise exception 'NOT_FOUND'; end if;
  sid:=(r.child_participants->>(p_child->>'key'))::uuid;
  if sid is not null then return sid; end if;
  if nullif(btrim(p_child->>'childName'),'') is null then return null; end if;
  actor:=case when p_staff then auth.uid() else r.registration_user_id end;
  relation_text:=case p_relation when 'mother' then '妈妈' when 'father' then '爸爸' else '监护人' end;
  select fc.contact_id into contact_id from public.family_contacts fc join public.contacts c on c.id=fc.contact_id
    where fc.family_id=r.family_id and c.profile_id=r.registration_user_id and fc.is_primary;
  if contact_id is null or actor is null then raise exception 'FORBIDDEN'; end if;
  insert into public.students(name,gender,grade,school,parent_name,parent_relation,parent_phone,bind_code,source,assigned_to,created_by)
    values(btrim(p_child->>'childName'),coalesce(p_child->>'gender',''),case when (p_child->>'grade')::integer>0 then (p_child->>'grade')::smallint end,
      coalesce(p_child->>'school',''),coalesce(p_parent_name,''),relation_text,r.verified_phone,public.generate_student_bind_code(),
      '微信自助登记',case when p_staff then actor end,actor) returning id into sid;
  insert into public.family_students(family_id,student_id,created_by) values(r.family_id,sid,actor);
  insert into public.student_contacts(student_id,contact_id,relation,is_primary,is_decision_maker,created_by) values(sid,contact_id,relation_text,true,true,actor);
  insert into public.student_guardians(student_id,guardian_id,relation,scope,is_primary) values(sid,r.registration_user_id,relation_text,array['activities'],true);
  select id into v_lead from public.leads where phone_normalized in(r.local_phone,substring(r.verified_phone from 2))
    and normalized_name=public.normalize_lead_name(p_child->>'childName') order by created_at limit 1;
  if v_lead is null then
    insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,grade_text,status,student_id,family_id,contact_id,identity_confirmed_by,identity_confirmed_at,created_by)
      values(p_child->>'childName',public.normalize_lead_name(p_child->>'childName'),r.verified_phone,r.local_phone,
        case when (p_child->>'grade')::integer>0 then (p_child->>'grade')::smallint end,p_child->>'grade',
        'converted',sid,r.family_id,contact_id,actor,now(),actor) returning id into v_lead;
  end if;
  update public.miniapp_intakes set child_participants=child_participants||jsonb_build_object(p_child->>'key',sid),
    student_id=coalesce(student_id,sid),lead_id=coalesce(miniapp_intakes.lead_id,v_lead) where id=r.id;
  return sid;
end $$;

create function public.miniapp_read_family_form(p_scene text default null) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare f public.miniapp_forms%rowtype;
begin
  if not public.has_perm(auth.uid(),'registration.invite.manage') then raise exception 'FORBIDDEN'; end if;
  select * into f from public.miniapp_forms where slug=coalesce(p_scene,'family-onboarding') and purpose in ('family','promotion');
  if f.slug is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object('slug',f.slug,'version',f.version,'title',f.title,'description',f.description,'fields',f.fields);
end $$;

create function public.miniapp_save_family_form(p_scene text,p_version integer,p_config jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result text;
begin
  if not public.has_perm(auth.uid(),'registration.invite.manage') then raise exception 'FORBIDDEN'; end if;
  perform public.miniapp_validate_family_form(p_config);
  update public.miniapp_forms set title=p_config->'title',description=p_config->'description',fields=p_config->'fields'
    where slug=coalesce(p_scene,'family-onboarding') and purpose in ('family','promotion') and version=p_version returning slug into result;
  if result is null then raise exception 'FORM_CHANGED'; end if;
  return public.miniapp_read_family_form(p_scene);
end $$;

create function public.miniapp_family_children(p_family jsonb) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
  select coalesce(p_family->'children',jsonb_build_array(jsonb_build_object('key','child-1',
    'childName',p_family->'childName','grade',p_family->'grade','school',p_family->'school',
    'gender',p_family->'gender','interests',p_family->'interests')));
$$;

create function public.miniapp_validate_family_answers(p_fields jsonb,p_family jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
declare children jsonb; child jsonb; field jsonb; answer jsonb; selected jsonb; empty_answer boolean; keys text[]:='{}';
begin
  children:=public.miniapp_family_children(p_family);
  if jsonb_typeof(children) is distinct from 'array' or jsonb_array_length(children) not between 1 and 10
    or coalesce(length(p_family->>'parentName'),0)>100 or coalesce(p_family->>'relation','') not in ('','mother','father','guardian') then raise exception 'VALIDATION'; end if;
  for child in select value from jsonb_array_elements(children) loop
    if jsonb_typeof(child) is distinct from 'object' or child->>'key' is null or child->>'key' !~ '^[a-zA-Z0-9_-]{1,50}$'
      or child->>'key'=any(keys) or coalesce(length(child->>'childName'),0)>100 or coalesce(length(child->>'school'),0)>120
      or coalesce(child->>'gender','') not in ('','female','male')
      or (child->>'grade' is not null and ((child->>'grade')::integer not between -1 and 12))
      or jsonb_typeof(child->'interests') is distinct from 'array' or jsonb_array_length(child->'interests')>20 then raise exception 'VALIDATION'; end if;
    keys:=array_append(keys,child->>'key');
    for field in select value from jsonb_array_elements(p_fields) loop
      answer:=case when field->>'id' in ('parentName','relation') then p_family->(field->>'id') else child->(field->>'id') end;
      empty_answer:=answer is null or answer='null'::jsonb or answer='""'::jsonb or answer='[]'::jsonb;
      if (field->>'mode'='required' and empty_answer) or (field->>'mode'='hidden' and not empty_answer) then raise exception 'VALIDATION'; end if;
      if field->>'id'='interests' then
        for selected in select value from jsonb_array_elements(child->'interests') loop
          if not exists(select 1 from jsonb_array_elements(field->'options') o where o->'id'=selected) then raise exception 'VALIDATION'; end if;
        end loop;
      end if;
    end loop;
  end loop;
end $$;

create or replace function public.miniapp_prepare_family(p_subject text,p_phone text,p_local_phone text,p_scene text,p_family jsonb,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; f public.miniapp_forms%rowtype; prior boolean;
begin
  if p_subject is null or length(p_subject) not between 3 and 200 or p_phone is null or p_phone !~ '^\+[0-9]{7,20}$'
    or p_local_phone is null or p_local_phone !~ '^[0-9]{6,18}$' or p_lease is null
    or jsonb_typeof(p_family) is distinct from 'object' or octet_length(p_family::text)>24576
    or p_family->>'consent' is distinct from 'true' then raise exception 'VALIDATION'; end if;
  if not exists(select 1 from public.consent_policies where policy_kind='privacy' and required and version=p_family->>'privacyVersion')
    or not exists(select 1 from public.consent_policies where policy_kind='children_privacy' and required and version=p_family->>'childrenPrivacyVersion') then raise exception 'FORM_CHANGED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('miniapp-family:'||p_phone,0));
  select * into r from public.miniapp_intakes where intake_kind='family' and (verified_phone=p_phone or wechat_subject=p_subject) for update;
  if r.id is not null and (r.wechat_subject<>p_subject or r.verified_phone<>p_phone) then raise exception 'CONFLICT'; end if;
  if exists(select 1 from auth.users u where regexp_replace(u.phone,'[^0-9]','','g')=substring(p_phone from 2) and u.id is distinct from r.registration_user_id) then raise exception 'ACCOUNT_SECURITY'; end if;
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
      registration_user_id,wechat_subject,verified_phone,local_phone,acquisition_state)
      values(gen_random_uuid(),f.slug,f.version,to_jsonb(f),p_family,f.slug,'family',gen_random_uuid(),p_subject,p_phone,p_local_phone,
        case when prior then 'existing_record' else 'pending' end) returning * into r;
  end if;
  if r.lease_until>now() then raise exception 'CONFLICT'; end if;
  -- Once a registration has been reserved, retries use its saved source and cannot change attribution.
  update public.miniapp_intakes set lease_key=p_lease,lease_until=now()+interval '3 minutes' where id=r.id returning * into r;
  return jsonb_build_object('id',r.id,'userId',r.registration_user_id,'created',r.profile_created_at is not null,
    'completed',r.completed_at is not null,'family',r.answers);
end $$;

create or replace function public.miniapp_create_parent_profile(p_id uuid,p_phone text,p_registration text)
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
    values(p_id,coalesce(nullif(r.answers->>'parentName',''),'家长'),'parent',now(),now());
  insert into public.consent_records(actor_user_id,subject_user_id,policy_kind,policy_version,scope,decision,source) values
    (p_id,p_id,'privacy',r.answers->>'privacyVersion','account','granted','registration'),
    (p_id,p_id,'children_privacy',r.answers->>'childrenPrivacyVersion','account','granted','registration');
  insert into public.account_identifier_assurances(user_id,identifier_type,identifier_hash,attestation_source,provider_verified,provider_verified_at)
    values(p_id,'phone',encode(extensions.digest(public.normalize_login_identifier('phone',p_phone),'sha256'),'hex'),'wechat_phone',true,now());
  update public.miniapp_intakes set profile_created_at=now(),submitted_by=p_id where id=r.id;
  return true;
end $$;

create or replace function public.miniapp_complete_family(p_id uuid,p_subject text,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; f uuid; c uuid; child jsonb; uid uuid;
begin
  select * into r from public.miniapp_intakes where id=p_id and intake_kind='family' and wechat_subject=p_subject and lease_key=p_lease and lease_until>now() for update;
  uid:=r.registration_user_id;
  if r.id is null or public.find_wechat_auth_user(p_subject) is distinct from uid then raise exception 'FORBIDDEN'; end if;
  if r.completed_at is null then
    if not exists(select 1 from public.profiles where id=uid and role='parent' and is_active and account_status='active') then raise exception 'FORBIDDEN'; end if;
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

create function public.miniapp_verify_family(p_id uuid,p_expected_at timestamptz,p_details jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; child jsonb; sid uuid; keys text[]:='{}'; v_parent_name text; actor uuid:=auth.uid();
begin
  if not public.has_perm(actor,'registration.invite.manage') or not public.has_perm(actor,'student.edit') then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>16384
    or jsonb_typeof(p_details->'children') is distinct from 'array' or jsonb_array_length(p_details->'children') not between 1 and 10
    or coalesce(length(p_details->>'parentName'),0)>100 then raise exception 'VALIDATION'; end if;
  select * into r from public.miniapp_intakes where id=p_id and intake_kind='family' and completed_at is not null for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.verified_at is distinct from p_expected_at then raise exception 'CONFLICT'; end if;
  -- Editing a household must respect the scope of every existing child in that household.
  if exists(select 1 from jsonb_each_text(r.child_participants) item where not public.can_access_student(item.value::uuid,actor)) then raise exception 'FORBIDDEN'; end if;
  v_parent_name:=btrim(coalesce(p_details->>'parentName',''));
  for child in select value from jsonb_array_elements(p_details->'children') loop
    if child->>'key' is null or child->>'key' !~ '^[a-zA-Z0-9_-]{1,50}$' or child->>'key'=any(keys)
      or coalesce(length(btrim(child->>'childName')),0) not between 1 and 100
      or coalesce(length(child->>'school'),0)>120 or coalesce(child->>'gender','') not in ('','female','male')
      or (child->>'grade' is not null and (child->>'grade')::integer not between -1 and 12) then raise exception 'VALIDATION'; end if;
    keys:=array_append(keys,child->>'key');
    sid:=(r.child_participants->>(child->>'key'))::uuid;
    if sid is null then
      if not public.has_perm(actor,'student.create') then raise exception 'FORBIDDEN'; end if;
      sid:=public.miniapp_attach_family_child(r.id,child,v_parent_name,r.answers->>'relation',true);
    end if;
    if not exists(select 1 from public.students where id=sid and deleted_at is null) then raise exception 'NOT_FOUND'; end if;
    update public.students set name=btrim(child->>'childName'),grade=case when (child->>'grade')::integer>0 then (child->>'grade')::smallint end,
      school=coalesce(child->>'school',''),gender=coalesce(child->>'gender',''),parent_name=v_parent_name where id=sid;
  end loop;
  -- Omission cannot remove or silently hide a previously linked child.
  if exists(select 1 from jsonb_each_text(r.child_participants) item where item.key<>all(keys)) then raise exception 'VALIDATION'; end if;
  if v_parent_name<>'' then
    update public.contacts set display_name=v_parent_name where profile_id=r.registration_user_id
      and id in(select contact_id from public.family_contacts where family_id=r.family_id);
  end if;
  update public.miniapp_intakes set verified_details=p_details,verified_by=actor,verified_at=clock_timestamp() where id=r.id;
  perform public.emit_domain_event('miniapp.family_verified','miniapp_intake',r.id,
    jsonb_build_object('childCount',jsonb_array_length(p_details->'children')),actor,null);
end $$;

create function public.miniapp_record_promotion_touch(p_scene text,p_user uuid,p_location jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.miniapp_forms%rowtype; r public.miniapp_intakes%rowtype;
begin
  if jsonb_typeof(p_location) is distinct from 'object' or octet_length(p_location::text)>1024
    or coalesce(p_location->>'status','') not in ('granted','declined','unavailable') then raise exception 'VALIDATION'; end if;
  if p_location->>'status'='granted' and ((p_location->>'latitude')::numeric not between -90 and 90
    or (p_location->>'longitude')::numeric not between -180 and 180
    or p_location->>'latitude' is null or p_location->>'longitude' is null) then raise exception 'VALIDATION'; end if;
  select * into f from public.miniapp_forms where slug=p_scene and enabled and purpose='promotion';
  if f.slug is null then return; end if;
  select * into r from public.miniapp_intakes where intake_kind='family' and registration_user_id=p_user and completed_at is not null;
  insert into public.miniapp_intakes(request_id,form_slug,form_version,form_snapshot,answers,source,submitted_by,intake_kind,
    registration_user_id,verified_phone,acquisition_state,completed_at,student_id,lead_id)
    select gen_random_uuid(),f.slug,f.version,to_jsonb(f),coalesce(r.answers,jsonb_build_object('parentName',p.display_name))||jsonb_build_object('location',p_location),
      f.slug,p_user,'touch',p_user,coalesce(r.verified_phone,case when nullif(u.phone,'') is not null then '+'||regexp_replace(u.phone,'[^0-9]','','g') end),
      'registered',now(),r.student_id,r.lead_id
    from public.profiles p join auth.users u on u.id=p.id where p.id=p_user;
end $$;
create or replace function public.miniapp_record_promotion_touch(p_scene text,p_user uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  select public.miniapp_record_promotion_touch(p_scene,p_user,'{"status":"unavailable"}'::jsonb);
$$;

revoke all on function public.miniapp_validate_family_form(jsonb),public.miniapp_family_children(jsonb),public.miniapp_validate_family_answers(jsonb,jsonb),
  public.miniapp_attach_family_child(uuid,jsonb,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.miniapp_read_family_form(text),public.miniapp_save_family_form(text,integer,jsonb),public.miniapp_verify_family(uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.miniapp_read_family_form(text),public.miniapp_save_family_form(text,integer,jsonb),public.miniapp_verify_family(uuid,timestamptz,jsonb) to authenticated;
revoke all on function public.miniapp_record_promotion_touch(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.miniapp_record_promotion_touch(text,uuid,jsonb) to service_role;

create or replace function public.miniapp_promotion_dashboard(p_scene text default null,p_page integer default 1)
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
        'location',i.answers->'location','studentId',i.student_id,'leadId',i.lead_id,
        'registrationId',r.id,'children',case when r.id is not null then public.miniapp_family_children(r.answers) else '[]'::jsonb end,
        'interestOptions',coalesce((select field->'options' from jsonb_array_elements(coalesce(r.form_snapshot,i.form_snapshot)->'fields') field where field->>'id'='interests'),'[]'::jsonb),
        'participants',coalesce((select jsonb_agg(jsonb_build_object('key',item.key,'studentId',s.id,'name',s.name,
          'grade',coalesce(s.grade,(select (child->>'grade')::integer from jsonb_array_elements(
            case when r.verified_at is not null then r.verified_details->'children' else public.miniapp_family_children(r.answers) end) child where child->>'key'=item.key)),
          'school',s.school,'gender',s.gender,'parentName',s.parent_name))
          from jsonb_each_text(r.child_participants) item join public.students s on s.id=item.value::uuid where s.deleted_at is null and public.can_access_student(s.id,auth.uid())),'[]'::jsonb),
        'verifiedAt',r.verified_at,'verifiedBy',(select display_name from public.profiles where id=r.verified_by),
        'canVerify',r.id is not null and public.has_perm(auth.uid(),'student.edit')
          and not exists(select 1 from jsonb_each_text(r.child_participants) item where not public.can_access_student(item.value::uuid,auth.uid())),
        'canAddChild',public.has_perm(auth.uid(),'student.create')) row_data
      from public.miniapp_intakes i left join public.miniapp_intakes r on r.intake_kind='family' and r.registration_user_id=i.registration_user_id and r.completed_at is not null
      where i.intake_kind in ('family','touch') and i.completed_at is not null and (p_scene is null or i.form_slug=p_scene)
      order by i.completed_at desc,i.id offset (p_page-1)*30 limit 30) q),'[]'::jsonb));
end $$;
