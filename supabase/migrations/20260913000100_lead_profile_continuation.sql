-- 首联建档和历史线索补入共用同一身份写入；历史业务范围独立保留。
create function mathin_internal.create_lead_student_profile(p_lead_id uuid,p_source text,p_allow_duplicate boolean default false)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); l public.leads%rowtype; sid uuid;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.school_support_subject_access(null,p_lead_id,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into l from public.leads where id=p_lead_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if l.student_id is not null then return l.student_id; end if;
  if l.status in ('invalid','converted') then raise exception 'LEAD_CLOSED'; end if;
  if nullif(btrim(l.provisional_student_name),'') is null then raise exception 'IDENTITY_NOT_CONFIRMED'; end if;
  perform pg_advisory_xact_lock(hashtext('lead-identity-student:'||public.normalize_lead_name(l.provisional_student_name)||':'||coalesce(l.phone_normalized,'')));
  if not p_allow_duplicate and (l.suggested_student_id is not null or exists(
    select 1 from public.students s where s.deleted_at is null
      and public.normalize_lead_name(s.name)=l.normalized_name
      and (l.phone_normalized in(public.normalize_school_ops_phone(s.phone),public.normalize_school_ops_phone(s.parent_phone))
        or nullif(public.normalize_school_ops_phone(l.manual_profile->>'parentPhone'),'') in(public.normalize_school_ops_phone(s.phone),public.normalize_school_ops_phone(s.parent_phone)))
  )) then raise exception 'POSSIBLE_DUPLICATE'; end if;
  insert into public.students(name,grade,phone,parent_phone,parent_name,school,wechat,remark,source,assigned_to,created_by,bind_code)
    values(l.provisional_student_name,l.grade_hint,l.phone,coalesce(nullif(l.manual_profile->>'parentPhone',''),l.phone),
      coalesce(l.manual_profile->>'parentName',''),coalesce(l.manual_profile->>'school',''),coalesce(l.manual_profile->>'wechat',''),
      l.note,p_source,l.owner_id,actor,public.generate_student_bind_code()) returning id into sid;
  update public.leads set student_id=sid,manual_identity_pending=false,identity_confirmed_by=actor,identity_confirmed_at=now() where id=l.id;
  perform public.emit_domain_event('lead.student_profile.created','lead',l.id,jsonb_build_object('studentId',sid,'source',p_source),actor,null);
  return sid;
end;
$$;
revoke all on function mathin_internal.create_lead_student_profile(uuid,text,boolean) from public,anon,authenticated,service_role;

create or replace function public.ensure_lead_student_profile(p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); l public.leads%rowtype; sid uuid;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(actor,'followup.write') then raise exception 'FORBIDDEN'; end if;
  if not public.school_support_subject_access(null,p_lead_id,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into l from public.leads where id=p_lead_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if l.student_id is not null then return jsonb_build_object('studentId',l.student_id,'studentProfileStatus','existing'); end if;
  if l.status in ('invalid','converted') then return jsonb_build_object('studentId',null,'studentProfileStatus','pending_contact'); end if;
  -- 使用修订后的有效联系事实，历史记录同样可证明电话有效。
  if not exists(select 1 from public.business_lead_communications c
    left join lateral(select r.effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by r.revision_no desc limit 1) revision on true
    where c.lead_id=l.id and coalesce(revision.effective_patch->>'outcome',c.outcome) in ('connected','declined')) then
    return jsonb_build_object('studentId',null,'studentProfileStatus','pending_contact');
  end if;
  if nullif(btrim(l.provisional_student_name),'') is null or coalesce(l.phone_normalized,'') !~ '^[0-9]{6,20}$' then
    return jsonb_build_object('studentId',null,'studentProfileStatus','needs_review');
  end if;
  begin
    sid:=mathin_internal.create_lead_student_profile(l.id,'Lead first contact',false);
  exception when raise_exception then
    if sqlerrm<>'POSSIBLE_DUPLICATE' then raise; end if;
    return jsonb_build_object('studentId',null,'studentProfileStatus','needs_review');
  end;
  return jsonb_build_object('studentId',sid,'studentProfileStatus','created');
end;
$$;

-- Student 建档后继续继承原 Lead 的历史范围；恢复办理由新的业务事实触发。
create or replace function public.business_subject_is_current(p_student_id uuid,p_lead_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from public.history_workflow_scopes s
    left join public.history_workflow_decisions d on d.key=s.scope_key
    where (s.student_id=p_student_id or s.lead_id=p_lead_id
      or exists(select 1 from public.leads l where l.id=s.lead_id and l.student_id=p_student_id))
      and (d.decision='archive' or s.resumed_at is null and coalesce(d.decision,'archive')<>'continue'));
$$;

do $continuation$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.resume_history_workflow_subject()'::regprocedure);
  anchor:=$old$(s.student_id=v_student_id or s.lead_id=v_lead_id)$old$;
  if position(anchor in definition)=0 then raise exception 'HISTORY_RESUME_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,$new$(s.student_id=v_student_id or s.lead_id=v_lead_id
      or exists(select 1 from public.leads l where l.id=s.lead_id and l.student_id=v_student_id))$new$);

  definition:=pg_get_functiondef('public.search_school_support_subjects(text)'::regprocedure);
  anchor:=$old$'canWrite',public.school_support_subject_access(m.student_id,m.lead_id,true)$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_SEARCH_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,$new$'historical',not public.business_subject_is_current(m.student_id,m.lead_id),
      'canWrite',public.school_support_subject_access(m.student_id,m.lead_id,true)$new$);

  -- 补入时显式选择原线索，资料修订、建档和入班在既有幂等事务中一起提交。
  definition:=pg_get_functiondef('public.add_school_support_work_item(uuid,jsonb)'::regprocedure);
  anchor:=$old$  if target_class is not null and student_id is null then raise exception 'IDENTITY_NOT_CONFIRMED'; end if;$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_SEAT_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,$new$  if student_id is null and lead_id is not null and coalesce((p_payload->>'confirmLeadProfile')::boolean,false) then
    if not public.has_perm(actor,'student.create') then raise exception 'FORBIDDEN'; end if;
    student_id:=mathin_internal.create_lead_student_profile(lead_id,'Lead identity confirmation',coalesce((p_payload->>'acknowledgeDuplicate')::boolean,false));
  end if;
  if target_class is not null and student_id is null then raise exception 'IDENTITY_NOT_CONFIRMED'; end if;$new$);

  -- 导入线索也保存本次更正的家长、学校、微信字段，原始 Base 凭据保持原值。
  definition:=pg_get_functiondef('public.read_school_support_profile(uuid,uuid)'::regprocedure);
  anchor:=$old$if l.manual_entry then$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_PROFILE_READ_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,$new$if l.id is not null then$new$);
  definition:=pg_get_functiondef('public.update_school_support_profile(uuid,uuid,text,jsonb)'::regprocedure);
  anchor:=$old$manual_profile=case when l.manual_entry then jsonb_build_object$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_PROFILE_EDIT_CONTRACT_CHANGED'; end if;
  execute replace(definition,anchor,$new$manual_profile=case when l.id is not null then jsonb_build_object$new$);
end;
$continuation$;

notify pgrst,'reload schema';
