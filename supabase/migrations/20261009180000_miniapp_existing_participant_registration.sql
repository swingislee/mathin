-- An existing account can complete its first form with a participant it already owns.
-- Keep the participant, guardian scopes and primary household unchanged.
create or replace function public.miniapp_attach_family_child(p_intake uuid,p_child jsonb,p_parent_name text,p_relation text,p_staff boolean default false)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.miniapp_intakes%rowtype; sid uuid; contact_id uuid; v_lead uuid; actor uuid; relation_text text;
begin
  select * into r from public.miniapp_intakes where id=p_intake and intake_kind='family' for update;
  if r.id is null or r.family_id is null or r.registration_user_id is null then raise exception 'NOT_FOUND'; end if;
  sid:=(r.child_participants->>(p_child->>'key'))::uuid;
  if sid is not null then return sid; end if;
  if p_child ? 'participantId' then
    sid:=(p_child->>'participantId')::uuid;
    if not r.uses_existing_account or not exists(select 1 from public.students s where s.id=sid and s.deleted_at is null
      and (s.user_id=r.registration_user_id or exists(select 1 from public.student_guardians g
        where g.student_id=s.id and g.guardian_id=r.registration_user_id))) then raise exception 'FORBIDDEN'; end if;
    insert into public.family_students(family_id,student_id,is_primary,created_by)
      values(r.family_id,sid,false,r.registration_user_id) on conflict(family_id,student_id) do nothing;
    update public.miniapp_intakes set child_participants=child_participants||jsonb_build_object(p_child->>'key',sid),
      student_id=coalesce(student_id,sid),acquisition_state='existing_record' where id=r.id;
    return sid;
  end if;
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
revoke all on function public.miniapp_attach_family_child(uuid,jsonb,text,text,boolean) from public,anon,authenticated,service_role;
