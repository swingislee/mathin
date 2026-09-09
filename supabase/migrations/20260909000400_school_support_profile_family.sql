-- 同一事务办理资料修订、补入和老师明确确认的家庭关系。
create function public.preview_school_support_family_link(p_student_id uuid,p_other_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); other_student public.students%rowtype; graph jsonb; family_ids uuid[]; target_family public.families%rowtype;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.school_support_subject_access(p_other_student_id,null,true)
    or p_student_id is not null and not public.school_support_subject_access(p_student_id,null,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if p_student_id=p_other_student_id then raise exception 'VALIDATION'; end if;
  select * into other_student from public.students where id=p_other_student_id;
  select coalesce(jsonb_agg(jsonb_build_object('membership',to_jsonb(m),'family',to_jsonb(f)) order by m.family_id,m.student_id),'[]'),
    array_agg(distinct m.family_id) into graph,family_ids
    from public.family_students m join public.families f on f.id=m.family_id
    where m.student_id in(p_student_id,p_other_student_id) and f.status='active';
  if cardinality(family_ids)=1 then select * into target_family from public.families where id=family_ids[1]; end if;
  return jsonb_build_object('otherStudentId',other_student.id,'otherName',other_student.name,
    'otherPhone',concat_ws(' / ',nullif(other_student.phone,''),case when other_student.parent_phone is distinct from other_student.phone then nullif(other_student.parent_phone,'') end),
    'otherVersion',md5(to_jsonb(other_student)::text),
    'version',md5(graph::text),'familyId',target_family.id,'familyName',coalesce(target_family.display_name,other_student.name||' · 家庭'),
    'alreadyLinked',exists(select 1 from public.family_students a join public.family_students b using(family_id)
      join public.families f on f.id=a.family_id where a.student_id=p_student_id and b.student_id=p_other_student_id and f.status='active'),
    'blocker',case when cardinality(family_ids)>1 then 'FAMILY_REVIEW_REQUIRED' end);
end;
$$;
revoke all on function public.preview_school_support_family_link(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_school_support_family_link(uuid,uuid) to authenticated;

create function mathin_internal.link_school_support_family(p_student_id uuid,p_link jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); other_id uuid:=(p_link->>'otherStudentId')::uuid; preview jsonb; target_family uuid;
  student_row public.students%rowtype; other_row public.students%rowtype; before_memberships jsonb; created_family boolean:=false;
begin
  if p_student_id is null then raise exception 'IDENTITY_NOT_CONFIRMED'; end if;
  if jsonb_typeof(p_link) is distinct from 'object' or (p_link->>'confirmed')::boolean is distinct from true
    or p_link-array['otherStudentId','otherVersion','version','confirmed']<>'{}' then raise exception 'VALIDATION'; end if;
  if not public.school_support_subject_access(p_student_id,null,true)
    or not public.school_support_subject_access(other_id,null,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if p_student_id=other_id then raise exception 'VALIDATION'; end if;
  perform 1 from public.students where id in(p_student_id,other_id) order by id for update;
  perform 1 from public.families where id in(select family_id from public.family_students where student_id in(p_student_id,other_id)) order by id for update;
  preview:=public.preview_school_support_family_link(p_student_id,other_id);
  if preview->>'otherVersion' is distinct from p_link->>'otherVersion' or preview->>'version' is distinct from p_link->>'version' then raise exception 'FAMILY_CHANGED'; end if;
  if preview->>'blocker' is not null then raise exception 'FAMILY_REVIEW_REQUIRED'; end if;
  select * into student_row from public.students where id=p_student_id;
  select * into other_row from public.students where id=other_id;
  if not exists(select 1 from unnest(array[student_row.phone,student_row.parent_phone]) a(phone)
    cross join unnest(array[other_row.phone,other_row.parent_phone]) b(phone)
    where nullif(public.normalize_school_ops_phone(a.phone),'')=nullif(public.normalize_school_ops_phone(b.phone),'')) then raise exception 'FAMILY_PHONE_MISMATCH'; end if;
  target_family:=(preview->>'familyId')::uuid;
  if (preview->>'alreadyLinked')::boolean then return target_family; end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by family_id,student_id),'[]') into before_memberships
    from public.family_students m where student_id in(p_student_id,other_id);
  if target_family is null then
    insert into public.families(display_name,owner_id,created_by) values(left(other_row.name||' · 家庭',120),actor,actor) returning id into target_family;
    created_family:=true;
  end if;
  insert into public.family_students(family_id,student_id,is_primary,created_by)
    select target_family,member_id,not exists(select 1 from public.family_students where student_id=member_id and is_primary),actor
    from unnest(array[p_student_id,other_id]) member(member_id) on conflict(family_id,student_id) do nothing;
  perform public.emit_domain_event('school_support.family_linked','family',target_family,
    jsonb_build_object('studentIds',jsonb_build_array(p_student_id,other_id),'createdFamily',created_family,'beforeMemberships',before_memberships),actor,null);
  return target_family;
end;
$$;
revoke all on function mathin_internal.link_school_support_family(uuid,jsonb) from public,anon,authenticated,service_role;

do $intake$
declare definition text; anchor text;
begin
  -- 基础资料更正沿用学服办理范围；完整学生管理与档案合并继续使用各自权限。
  definition:=pg_get_functiondef('public.read_school_support_profile(uuid,uuid)'::regprocedure);
  anchor:=$old$public.has_perm(auth.uid(),'student.edit') and public.school_support_subject_access(p_student_id,p_lead_id,true)$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_PROFILE_READ_SCOPE_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$public.school_support_subject_access(p_student_id,p_lead_id,true)$new$);
  anchor:=$old$'identityPending',coalesce(l.manual_identity_pending,false),'changes',changes)$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_IDENTITY_SCOPE_CHANGED'; end if;
  execute replace(definition,anchor,$new$'identityPending',coalesce(l.manual_identity_pending,false),'changes',changes,
    'canResolveIdentity',public.has_perm(auth.uid(),'student.edit') and public.school_support_subject_access(p_student_id,p_lead_id,true))$new$);
  definition:=pg_get_functiondef('public.update_school_support_profile(uuid,uuid,text,jsonb)'::regprocedure);
  anchor:=$old$not public.has_perm(actor,'student.edit') or not public.school_support_subject_access(p_student_id,p_lead_id,true)$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_PROFILE_WRITE_SCOPE_CHANGED'; end if;
  execute replace(definition,anchor,$new$not public.school_support_subject_access(p_student_id,p_lead_id,true)$new$);
  definition:=replace(pg_get_functiondef('public.add_school_support_work_item(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$  if subject is not null then
    student_id:=$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_SUBJECT_CONTRACT_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$  if nullif(p_payload->'familyLink','null'::jsonb) is not null then
    if not public.school_support_subject_access((p_payload->'familyLink'->>'otherStudentId')::uuid,null,true) then raise exception 'FORBIDDEN_SCOPE'; end if;
    perform 1 from public.students where id in((subject->>'studentId')::uuid,(p_payload->'familyLink'->>'otherStudentId')::uuid) order by id for update;
  end if;
  if nullif(p_payload->'profileEdit','null'::jsonb) is not null and subject is null then raise exception 'VALIDATION'; end if;
  if subject is not null then
    student_id:=$new$);
  anchor:=$old$  else
    if not public.has_perm(actor,'student.create') then raise exception 'FORBIDDEN'; end if;$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_PROFILE_CONTRACT_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$    if nullif(p_payload->'profileEdit','null'::jsonb) is not null then
      if jsonb_typeof(p_payload->'profileEdit') is distinct from 'object'
        or (p_payload->'profileEdit')-array['version','values']<>'{}' then raise exception 'VALIDATION'; end if;
      if p_payload->'profileEdit'->>'version' is distinct from public.read_school_support_profile(student_id,lead_id)->>'version' then raise exception 'PROFILE_CONFLICT'; end if;
      if p_payload->'profileEdit'->'values' is distinct from public.read_school_support_profile(student_id,lead_id)->'values' then
        perform public.update_school_support_profile(student_id,lead_id,p_payload->'profileEdit'->>'version',p_payload->'profileEdit'->'values');
      end if;
    end if;
  else
    if not public.has_perm(actor,'student.create') then raise exception 'FORBIDDEN'; end if;$new$);
  anchor:=$old$  insert into public.school_support_entry_receipts(actor_id,request_id,fingerprint,work_item_id)$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_RECEIPT_CONTRACT_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$  if nullif(p_payload->'familyLink','null'::jsonb) is not null then
    perform mathin_internal.link_school_support_family(student_id,p_payload->'familyLink');
  end if;
  insert into public.school_support_entry_receipts(actor_id,request_id,fingerprint,work_item_id)$new$);
  anchor:=$old$where w.workspace=workspace and w.context_key=context_key and w.closed_at is null$old$;
  if position(anchor in definition)=0 then raise exception 'SUPPORT_WORK_SCOPE_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$where w.workspace=workspace and w.context_key=context_key and w.closed_at is null
      and public.school_support_subject_access(w.student_id,w.lead_id,true)$new$);
  execute definition;
end $intake$;

notify pgrst,'reload schema';
