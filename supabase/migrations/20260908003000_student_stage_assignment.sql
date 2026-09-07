-- 按人分配复用既有学生/线索分配入口；一批中的学生与有效线索在同一事务更新。
create function public.assign_student_stage_subjects(p_subjects jsonb, p_staff_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare
  actor uuid:=auth.uid(); item jsonb; snapshot jsonb; subjects jsonb:='[]'; result jsonb:='[]';
  student_id uuid; lead_id uuid; lead_ids uuid[]; keys text[]:='{}'; chunk integer;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'student.assign') then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_subjects) is distinct from 'array' then raise exception 'INVALID_INPUT'; end if;
  if jsonb_array_length(p_subjects) not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
  if p_staff_user_id is null or not public.is_staff(p_staff_user_id) or not public.has_perm(p_staff_user_id,'followup.write') then
    raise exception 'TARGET_CANNOT_FOLLOW_UP';
  end if;

  for item in select value from jsonb_array_elements(p_subjects) order by value->>'studentId',value->>'leadId' loop
    if jsonb_typeof(item) is distinct from 'object' or not item ? 'expectedOwnerId' then raise exception 'INVALID_INPUT'; end if;
    student_id:=(item->>'studentId')::uuid; lead_id:=(item->>'leadId')::uuid;
    if student_id is null and lead_id is null then raise exception 'INVALID_INPUT'; end if;
    -- 先固定身份关系和归属，再调用已有读取合同核对本人可见范围。
    perform 1 from public.students where id=student_id for update;
    perform 1 from public.leads where id=lead_id or student_id is not null and leads.student_id=student_id order by id for update;
    snapshot:=public.read_student_stage_subject(student_id,lead_id);
    if (snapshot->>'studentId')::uuid is distinct from student_id then raise exception 'ASSIGNMENT_CONFLICT'; end if;
    if snapshot->>'key'=any(keys) then raise exception 'INVALID_INPUT'; end if;
    if (snapshot->>'ownerId')::uuid is distinct from (item->>'expectedOwnerId')::uuid then raise exception 'ASSIGNMENT_CONFLICT'; end if;
    keys:=array_append(keys,snapshot->>'key');
    subjects:=subjects||jsonb_build_array(snapshot);
  end loop;

  select coalesce(array_agg(distinct l.id order by l.id),'{}'::uuid[]) into lead_ids
    from public.leads l where l.status not in ('invalid','converted') and l.owner_id is distinct from p_staff_user_id
    and exists(select 1 from jsonb_array_elements(subjects) s where l.id=(s->>'leadId')::uuid or l.student_id=(s->>'studentId')::uuid);

  for snapshot in select value from jsonb_array_elements(subjects) loop
    student_id:=(snapshot->>'studentId')::uuid;
    if student_id is not null and (snapshot->>'ownerId')::uuid is distinct from p_staff_user_id then
      perform public.assign_student(student_id,p_staff_user_id);
    elsif student_id is null and not ((snapshot->>'leadId')::uuid=any(lead_ids)) and (snapshot->>'ownerId')::uuid is distinct from p_staff_user_id then
      raise exception 'LEAD_SCOPE_MISMATCH';
    end if;
  end loop;
  if cardinality(lead_ids)>0 then
    for chunk in 0..((cardinality(lead_ids)-1)/100) loop
      perform public.assign_leads(lead_ids[(chunk*100+1):(chunk*100+100)],p_staff_user_id);
    end loop;
  end if;

  for item in select value from jsonb_array_elements(subjects) loop
    student_id:=(item->>'studentId')::uuid; lead_id:=(item->>'leadId')::uuid;
    begin
      snapshot:=public.read_student_stage_subject(student_id,case when student_id is null then lead_id else null end);
    exception when others then
      if sqlerrm<>'FORBIDDEN_SCOPE' then raise; end if;
      snapshot:=null;
    end;
    result:=result||jsonb_build_array(jsonb_build_object('key',item->>'key','subject',snapshot));
  end loop;
  return result;
end;
$$;
revoke all on function public.assign_student_stage_subjects(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.assign_student_stage_subjects(jsonb,uuid) to authenticated;
