-- 全范围办理人员可登记未分配档案；负责人快照继续反映实际分配状态。
-- 保留每个入口既有的 capability、主体范围、版本及业务状态校验。
do $migration$
declare signature text; definition text; updated text; old_guard text;
begin
  foreach signature in array array[
    'public.record_lead_contact(uuid,text,text,boolean,boolean,text,timestamp with time zone)',
    'public.record_lead_contact_v2(uuid,text,text,boolean,text,text,text,uuid,uuid,text,text)',
    'public.update_lead_invitation(uuid,text,text,uuid,uuid,text,text,text,text)',
    'public.set_lead_contact_reminder(uuid,timestamp with time zone)',
    'public.ensure_lead_student_profile(uuid)',
    'public.save_student_stage_entry(uuid,jsonb)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    old_guard:=case when signature='public.save_student_stage_entry(uuid,jsonb)'
      then 'if lead.owner_id is null then raise exception ''LEAD_UNASSIGNED''; end if;'
      else 'if v_lead.owner_id is null then raise exception ''LEAD_UNASSIGNED''; end if;' end;
    updated:=replace(definition,old_guard,case when signature='public.save_student_stage_entry(uuid,jsonb)'
      then 'if lead.owner_id is null and not public.has_perm(actor,''student.view.all'') then raise exception ''LEAD_UNASSIGNED''; end if;'
      else 'if v_lead.owner_id is null and not public.has_perm(v_uid,''student.view.all'') then raise exception ''LEAD_UNASSIGNED''; end if;' end);
    if updated=definition then raise exception 'UNASSIGNED_WRITE_GUARD_CHANGED: %',signature; end if;
    execute updated;
  end loop;

  foreach signature in array array[
    'public.read_student_stage_subject_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])',
    'public.read_student_record_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    updated:=replace(definition,
      'lead.owner_id is not null and (lead.owner_id=actor or public.has_perm(actor,''student.view.all''))',
      'lead.id is not null and (coalesce(lead.owner_id=actor,false) or public.has_perm(actor,''student.view.all''))');
    updated:=replace(updated,'lead.id is not null and lead.owner_id is not null and lead.status',
      'lead.id is not null and lead.status');
    updated:=replace(updated,'and (lead.owner_id=actor or public.has_perm(actor,''student.view.all'')))',
      'and (coalesce(lead.owner_id=actor,false) or public.has_perm(actor,''student.view.all'')))');
    if updated=definition or updated like '%lead.owner_id is not null and%' then
      raise exception 'UNASSIGNED_DETAIL_GUARD_CHANGED: %',signature; end if;
    execute updated;
  end loop;

  foreach signature in array array[
    'public.student_record_list_rows(jsonb,public.business_course_enrollment_subjects[])',
    'public.student_list_facts(text,text,text,text)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    updated:=replace(definition,'l.owner_id is not null and (l.owner_id=actor or view_all)',
      'l.id is not null and (coalesce(l.owner_id=actor,false) or view_all)');
    updated:=replace(updated,'l.id is not null and l.owner_id is not null and l.status',
      'l.id is not null and l.status');
    updated:=replace(updated,'and (l.owner_id=actor or view_all)',
      'and (coalesce(l.owner_id=actor,false) or view_all)');
    if updated=definition or updated like '%l.owner_id is not null and%' then
      raise exception 'UNASSIGNED_LIST_GUARD_CHANGED: %',signature; end if;
    execute updated;
  end loop;
end;
$migration$;
