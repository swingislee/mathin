-- Mini Program registrations are lead sources, with the original intake retained.
alter table public.miniapp_intakes add column child_leads jsonb not null default '{}' check(jsonb_typeof(child_leads)='object');
alter table public.lead_source_records
  add column miniapp_intake_id uuid references public.miniapp_intakes(id),
  add column miniapp_child_key text,
  alter column batch_id drop not null,
  alter column row_no drop not null,
  alter column source_row drop not null,
  add constraint lead_source_origin_check check(
    (miniapp_intake_id is null and miniapp_child_key is null and batch_id is not null and row_no is not null and source_row is not null)
    or (miniapp_intake_id is not null and miniapp_child_key ~ '^[a-zA-Z0-9_-]{1,50}$' and miniapp_child_key is not null
      and batch_id is null and row_no is null and source_row is null)),
  add constraint lead_source_miniapp_unique unique(miniapp_intake_id,miniapp_child_key);
alter table public.school_source_worklist_entries
  add column miniapp_intake_id uuid references public.miniapp_intakes(id),
  alter column source_record_id drop not null,
  add constraint source_worklist_origin_check check(num_nonnulls(source_record_id,miniapp_intake_id)=1);

create function public.miniapp_promotion_settings() returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
begin
  if not public.has_perm(auth.uid(),'registration.invite.manage') then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(row_data order by row_data->>'updatedAt' desc) from (
    select jsonb_build_object('scene',f.slug,'name',f.promoter_name,'enabled',f.enabled,'updatedAt',f.updated_at,
      'newCount',count(i.id) filter(where i.acquisition_state='new' and i.completed_at is not null),
      'repeatCount',count(i.id) filter(where i.acquisition_state in ('registered','existing_record') and i.completed_at is not null)) row_data
    from public.miniapp_forms f left join public.miniapp_intakes i on i.form_slug=f.slug and i.intake_kind in ('family','touch')
    where f.purpose='promotion' group by f.slug) q),'[]'::jsonb);
end $$;
revoke all on function public.miniapp_promotion_settings() from public,anon;
grant execute on function public.miniapp_promotion_settings() to authenticated;

create or replace function public.miniapp_attach_family_child(p_intake uuid,p_child jsonb,p_parent_name text,p_relation text,p_staff boolean default false)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; sid uuid; v_contact uuid; v_lead uuid; actor uuid; relation_text text;
begin
  select * into r from public.miniapp_intakes where id=p_intake and intake_kind='family' for update;
  if r.id is null or r.family_id is null or r.registration_user_id is null then raise exception 'NOT_FOUND'; end if;
  sid:=(r.child_participants->>(p_child->>'key'))::uuid;
  if sid is not null then return sid; end if;
  if nullif(btrim(p_child->>'childName'),'') is null then return null; end if;
  actor:=case when p_staff then auth.uid() else r.registration_user_id end;
  relation_text:=case p_relation when 'mother' then '妈妈' when 'father' then '爸爸' else '监护人' end;
  select fc.contact_id into v_contact from public.family_contacts fc join public.contacts c on c.id=fc.contact_id
    where fc.family_id=r.family_id and c.profile_id=r.registration_user_id and fc.is_primary;
  if v_contact is null or actor is null then raise exception 'FORBIDDEN'; end if;
  insert into public.students(name,gender,grade,school,parent_name,parent_relation,parent_phone,bind_code,source,assigned_to,created_by)
    values(btrim(p_child->>'childName'),coalesce(p_child->>'gender',''),case when (p_child->>'grade')::integer>0 then (p_child->>'grade')::smallint end,
      coalesce(p_child->>'school',''),coalesce(p_parent_name,''),relation_text,r.verified_phone,public.generate_student_bind_code(),
      '微信自助登记',case when p_staff then actor end,actor) returning id into sid;
  insert into public.family_students(family_id,student_id,created_by) values(r.family_id,sid,actor);
  insert into public.student_contacts(student_id,contact_id,relation,is_primary,is_decision_maker,created_by) values(sid,v_contact,relation_text,true,true,actor);
  insert into public.student_guardians(student_id,guardian_id,relation,scope,is_primary) values(sid,r.registration_user_id,relation_text,array['activities'],true);
  -- A registration with no child name already has a pending lead. Complete that same lead.
  v_lead:=(r.child_leads->>(p_child->>'key'))::uuid;
  if v_lead is not null then
    update public.leads set student_id=sid,identity_confirmed_by=actor,identity_confirmed_at=now(),manual_identity_pending=false,
      provisional_student_name=btrim(p_child->>'childName'),normalized_name=public.normalize_lead_name(p_child->>'childName'),
      grade_hint=case when (p_child->>'grade')::integer>0 then (p_child->>'grade')::smallint end,
      grade_text=coalesce(p_child->>'grade','')
      where id=v_lead and student_id is null and created_by=r.registration_user_id;
    if not found then raise exception 'CONFLICT'; end if;
  else
    select id into v_lead from public.leads where phone_normalized in(r.local_phone,substring(r.verified_phone from 2))
      and normalized_name=public.normalize_lead_name(p_child->>'childName') order by created_at limit 1;
    if v_lead is null then
      -- Family/guardian links live above; the lead continues through first contact.
      insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,grade_text,status,student_id,identity_confirmed_by,identity_confirmed_at,created_by)
        values(p_child->>'childName',public.normalize_lead_name(p_child->>'childName'),r.verified_phone,r.local_phone,
          case when (p_child->>'grade')::integer>0 then (p_child->>'grade')::smallint end,coalesce(p_child->>'grade',''),
          'uncontacted',sid,actor,now(),actor) returning id into v_lead;
    end if;
  end if;
  update public.miniapp_intakes set child_participants=child_participants||jsonb_build_object(p_child->>'key',sid),
    child_leads=child_leads||jsonb_build_object(p_child->>'key',v_lead),
    student_id=coalesce(student_id,sid),lead_id=coalesce(miniapp_intakes.lead_id,v_lead) where id=r.id;
  return sid;
end $$;

create function public.miniapp_sync_lead_sources(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.miniapp_intakes%rowtype; r public.miniapp_intakes%rowtype; child jsonb; original_children jsonb;
  sid uuid; linked_student uuid; lid uuid; source_id uuid; child_key text; pending_name text;
  labels jsonb; location_text text; source_at timestamptz; promoter text; acquired_month text; position integer:=0; from_parent boolean;
begin
  select * into i from public.miniapp_intakes where id=p_id and intake_kind in ('family','touch') and completed_at is not null;
  if i.id is null then return; end if;
  select * into r from public.miniapp_intakes where intake_kind='family' and registration_user_id=i.registration_user_id and completed_at is not null for update;
  if r.id is null then return; end if;
  original_children:=public.miniapp_family_children(r.answers);
  promoter:=coalesce(nullif(i.form_snapshot->>'promoter_name',''),'直接进入');
  location_text:=case when i.answers#>>'{location,status}'='granted'
    then concat(i.answers#>>'{location,latitude}',', ',i.answers#>>'{location,longitude}') else '' end;
  for child in
    select value from jsonb_array_elements(original_children)
    union all
    select jsonb_build_object('key',item.key,'childName',s.name,'grade',s.grade,'school',s.school,'gender',s.gender,'interests','[]'::jsonb)
    from jsonb_each_text(r.child_participants) item join public.students s on s.id=item.value::uuid
    where not exists(select 1 from jsonb_array_elements(original_children) value where value->>'key'=item.key)
  loop
    position:=position+1; child_key:=child->>'key'; sid:=(r.child_participants->>child_key)::uuid;
    from_parent:=exists(select 1 from jsonb_array_elements(original_children) value where value->>'key'=child_key);
    lid:=(r.child_leads->>child_key)::uuid;
    if lid is null and sid is not null then select id into lid from public.leads where student_id=sid order by created_at,id limit 1; end if;
    if lid is null and child_key=original_children->0->>'key' then lid:=r.lead_id; end if;
    if lid is null then
      -- This is a lead awaiting a child's name, not a fabricated student profile.
      pending_name:=coalesce(nullif(child->>'childName',''),'待补充孩子称呼'||case when jsonb_array_length(original_children)>1 then ' '||position else '' end);
      insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,grade_text,status,manual_identity_pending,created_by)
        values(pending_name,public.normalize_lead_name(pending_name),
          r.verified_phone,r.local_phone,case when (child->>'grade')::integer>0 then (child->>'grade')::smallint end,coalesce(child->>'grade',''),
          'uncontacted',nullif(child->>'childName','') is null,r.registration_user_id) returning id into lid;
    end if;
    update public.miniapp_intakes set child_leads=child_leads||jsonb_build_object(child_key,lid),lead_id=coalesce(lead_id,lid) where id=r.id;
    select student_id into linked_student from public.leads where id=lid;
    select coalesce(jsonb_agg(option->'label'->>'zh'),'[]'::jsonb) into labels
      from jsonb_array_elements(r.form_snapshot->'fields') field cross join lateral jsonb_array_elements(coalesce(field->'options','[]')) option
      where field->>'id'='interests' and child->'interests' ? (option->>'id');
    source_at:=case when from_parent then i.completed_at else coalesce((select created_at from public.students where id=sid),i.completed_at) end;
    insert into public.lead_source_records(lead_id,miniapp_intake_id,miniapp_child_key,source_system,batch_label,submitted_at,
      acquisition_method,promoter,location_text,raw_grade_text,raw_interest_text,remark,source_marked_duplicate)
      values(lid,i.id,child_key,'mathin-miniapp',promoter,source_at,
        case when from_parent then '微信扫码登记' else '微信登记家庭后续补充' end,promoter,location_text,coalesce(child->>'grade',''),
        left(coalesce((select string_agg(value,'、') from jsonb_array_elements_text(labels)),''),2000),
        concat_ws('；',case when nullif(r.answers->>'parentName','') is not null then '家长原填称呼：'||(r.answers->>'parentName') end,
          case when from_parent and nullif(child->>'childName','') is not null then '孩子原填称呼：'||(child->>'childName') end,
          case when nullif(child->>'school','') is not null then '学校：'||(child->>'school') end),i.intake_kind='touch')
      on conflict(miniapp_intake_id,miniapp_child_key) do nothing returning id into source_id;
    if source_id is null then select id into source_id from public.lead_source_records where miniapp_intake_id=i.id and miniapp_child_key=child_key; end if;
    insert into public.lead_interest_selections(lead_id,source_record_id,label,normalized_key,category)
      select lid,source_id,value,public.normalize_lead_name(value),'product_interest' from jsonb_array_elements_text(labels)
      on conflict(source_record_id,normalized_key) do nothing;
    -- Repeated scans remain source events; they do not move the lead to a different acquisition group.
    if i.intake_kind='family' then
      acquired_month:=extract(month from source_at at time zone public.get_organization_timezone_v2())::integer||'月';
      insert into public.school_source_worklist_entries(logical_key,miniapp_intake_id,student_id,lead_id,kind,group_label,subgroup_label,
        group_rank,source_rank,context,periods,period_defaults)
        values('miniapp:'||r.id||':'||child_key,r.id,linked_student,lid,'acquisition','微信扫码',promoter,900000,position,
          jsonb_build_array(jsonb_build_object('label','登记来源','value',case when from_parent then '家长自填' else '工作人员补充' end)),
          jsonb_build_object('acquired',acquired_month),jsonb_build_object('month',acquired_month))
        on conflict(logical_key) do update set student_id=excluded.student_id,lead_id=excluded.lead_id;
    end if;
  end loop;
end $$;

create function public.miniapp_sync_lead_sources_trigger() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.completed_at is not null then perform public.miniapp_sync_lead_sources(new.id); end if;
  return new;
end $$;
create trigger miniapp_intake_lead_sources after insert or update of completed_at,child_participants,verified_at on public.miniapp_intakes
  for each row execute function public.miniapp_sync_lead_sources_trigger();
revoke all on function public.miniapp_sync_lead_sources(uuid),public.miniapp_sync_lead_sources_trigger() from public,anon,authenticated,service_role;

-- A phone conversation can be saved while a child's name is still pending.
-- Retain the existing pending-identity flag instead of creating a placeholder Student.
do $$ declare definition text; anchor text; begin
  definition:=pg_get_functiondef('public.ensure_lead_student_profile(uuid)'::regprocedure);
  anchor:=$old$if nullif(btrim(l.provisional_student_name),'') is null or$old$;
  if position(anchor in definition)=0 then raise exception 'LEAD_PROFILE_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,$new$if l.manual_identity_pending or nullif(btrim(l.provisional_student_name),'') is null or$new$);
end $$;

-- Existing registrations retain their identities and original attribution.
do $$ declare intake_id uuid; begin
  for intake_id in select id from public.miniapp_intakes where intake_kind in ('family','touch') and completed_at is not null order by completed_at,intake_kind loop
    perform public.miniapp_sync_lead_sources(intake_id);
  end loop;
end $$;

create function public.miniapp_family_for_subject(p_student uuid,p_lead uuid) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; actor uuid:=auth.uid(); children jsonb; first_child jsonb;
begin
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_student is null and p_lead is null then raise exception 'VALIDATION'; end if;
  if (p_student is not null and not public.can_view_school_student(p_student,actor))
    or (p_lead is not null and not public.can_view_school_lead(p_lead,actor)) then raise exception 'FORBIDDEN'; end if;
  if p_student is not null and p_lead is not null and not exists(select 1 from public.leads where id=p_lead and student_id=p_student) then raise exception 'FORBIDDEN'; end if;
  select * into r from public.miniapp_intakes i where i.intake_kind='family' and i.completed_at is not null and (
    exists(select 1 from public.lead_source_records source join public.leads l on l.id=source.lead_id where source.miniapp_intake_id=i.id
      and (l.id=p_lead or l.student_id=p_student))
    or p_student is not null and exists(select 1 from jsonb_each_text(i.child_participants) item where item.value=p_student::text))
    order by i.completed_at,i.id limit 1;
  if r.id is null then return null; end if;
  select coalesce(jsonb_agg(child),'[]'::jsonb) into children from jsonb_array_elements(public.miniapp_family_children(r.answers)) child
    where public.can_view_school_student((r.child_participants->>(child->>'key'))::uuid,actor)
      or (r.child_leads->>(child->>'key'))::uuid=p_lead;
  first_child:=children->0;
  return jsonb_build_object('id',r.id,'at',r.completed_at,'promoter',coalesce(r.form_snapshot->>'promoter_name',''),
    'state',r.acquisition_state,'phone',r.verified_phone,'parentName',r.answers->>'parentName',
    'childName',first_child->>'childName','grade',first_child->>'grade','school',first_child->>'school','interests',first_child->'interests',
    'location',r.answers->'location','studentId',p_student,'leadId',p_lead,'registrationId',r.id,'children',children,
    'interestOptions',coalesce((select field->'options' from jsonb_array_elements(r.form_snapshot->'fields') field where field->>'id'='interests'),'[]'::jsonb),
    'participants',coalesce((select jsonb_agg(jsonb_build_object('key',item.key,'studentId',s.id,'name',s.name,
      'grade',coalesce(s.grade,(select (child->>'grade')::integer from jsonb_array_elements(
        case when r.verified_at is not null then r.verified_details->'children' else public.miniapp_family_children(r.answers) end) child where child->>'key'=item.key)),
      'school',s.school,'gender',s.gender,'parentName',s.parent_name))
      from jsonb_each_text(r.child_participants) item join public.students s on s.id=item.value::uuid
      where s.deleted_at is null and public.can_view_school_student(s.id,actor)),'[]'::jsonb),
    'verifiedAt',r.verified_at,'verifiedBy',(select display_name from public.profiles where id=r.verified_by),
    'canVerify',public.has_perm(actor,'registration.invite.manage') and public.has_perm(actor,'student.edit')
      and not exists(select 1 from jsonb_each_text(r.child_participants) item where not public.can_access_student(item.value::uuid,actor)),
    'canAddChild',public.has_perm(actor,'student.create'));
end $$;
revoke all on function public.miniapp_family_for_subject(uuid,uuid) from public,anon;
grant execute on function public.miniapp_family_for_subject(uuid,uuid) to authenticated;
