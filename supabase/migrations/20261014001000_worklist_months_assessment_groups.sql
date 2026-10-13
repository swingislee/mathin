-- 多个月份在完整可见集合内合并，再计数和分页；原单月链接继续有效。
do $months$
declare routine regprocedure; definition text; changed text;
begin
  routine := 'public.school_communication_workbench_page(text,text,text,text,text,integer,integer,text,text,text[],uuid,jsonb,text,jsonb,boolean,boolean,text,text)'::regprocedure;
  select pg_get_functiondef(routine) into definition;
  if position($old$p_period !~ '^([1-9]|1[0-2])月$'$old$ in definition)=0
    or position('t.period=(select period from choice)' in definition)=0 then
    raise exception 'COMMUNICATION_MONTH_FILTER_CHANGED';
  end if;
  changed := replace(definition,$old$p_period !~ '^([1-9]|1[0-2])月$'$old$,
    $new$(length(p_period)>100 or p_period !~ '^(unknown|([1-9]|1[0-2])月)(,(unknown|([1-9]|1[0-2])月)){0,12}$')$new$);
  changed := replace(changed,'t.period=(select period from choice)',
    $new$t.period=any(string_to_array((select period from choice),','))$new$);
  execute changed;

  routine := 'public.list_assessment_workbench_page(text,text,integer,integer,jsonb,text,jsonb)'::regprocedure;
  select pg_get_functiondef(routine) into definition;
  if position($old$source_period !~ '^([1-9]|1[0-2])月$'$old$ in definition)=0
    or position('r.period=(select period from source_choice)' in definition)=0
    or position($old$'kind',coalesce(p.kind,'assessment'),$old$ in definition)=0 then
    raise exception 'ASSESSMENT_MONTH_FILTER_CHANGED';
  end if;
  changed := replace(definition,$old$source_period !~ '^([1-9]|1[0-2])月$'$old$,
    $new$(length(source_period)>100 or source_period !~ '^(unknown|([1-9]|1[0-2])月)(,(unknown|([1-9]|1[0-2])月)){0,12}$')$new$);
  changed := replace(changed,'r.period=(select period from source_choice)',
    $new$r.period=any(string_to_array((select period from source_choice),','))$new$);
  changed := replace(changed,$old$'kind',coalesce(p.kind,'assessment'),$old$,
    $new$'kind',coalesce(p.kind,'assessment'),'groupMode','lead',$new$);
  -- 测评与线索、沟通采用相同的默认月份范围。
  changed := replace(changed,$old$select coalesce(nullif(source_period,''),
      (select period from source_periods where period=(select preferred from source_preference)),
      (select period from source_periods order by rank desc limit 1),'unknown') as period$old$,
    $new$select coalesce(nullif(source_period,''),'all') as period$new$);
  if position($old$(select period from source_periods where period=(select preferred from source_preference))$old$ in changed)>0 then
    raise exception 'ASSESSMENT_DEFAULT_MONTH_CHANGED';
  end if;
  execute changed;
end;
$months$;

-- 测评仅按正式业务小组组织。保留原可见性检查，老师仍作为行内业务字段。
create or replace function public.school_visible_source_layout(p_kind text)
returns table(logical_key text,source_record_id text,student_id uuid,lead_id uuid,kind text,
  group_label text,subgroup_label text,group_rank integer,source_rank integer,periods jsonb,period_defaults jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); view_all boolean;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'review.write') or public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('acquisition','assessment','service') or p_kind is null then raise exception 'VALIDATION'; end if;
  view_all:=public.has_perm(actor,'student.view.all');
  if p_kind<>'assessment' then
    return query select w.logical_key,w.source_record_id,coalesce(l.student_id,w.student_id),w.lead_id,w.kind,
      w.group_label,w.subgroup_label,w.group_rank,w.source_rank,w.periods,w.period_defaults
      from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
      where w.kind=p_kind and (view_all or case when coalesce(l.student_id,w.student_id) is not null
        then public.can_view_school_student(coalesce(l.student_id,w.student_id),actor)
        else public.can_view_school_lead(w.lead_id,actor) end);
    return;
  end if;
  return query with business_groups as materialized (
    select b.id,b.name,case b.source_code when '1' then 1 when '2' then 2 when '3' then 3 else 1000000+b.sort_order end as rank
    from public.school_business_groups b where b.archived_at is null and b.kind='group'
  ), source_rows as materialized (
    select w.*,coalesce(l.student_id,w.student_id) as resolved_student_id,
      coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id) as subject_key
    from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
    where w.kind in ('assessment','acquisition')
  ), group_candidates as materialized (
    select coalesce('student:'||sg.student_id,'student:'||l.student_id,'lead:'||sg.lead_id) as subject_key,
      coalesce(sg.student_id,l.student_id) as student_id,sg.lead_id,b.name,b.rank,0 as priority
    from public.school_subject_groups sg join business_groups b on b.id=sg.group_id left join public.leads l on l.id=sg.lead_id
    union all
    select w.subject_key,w.resolved_student_id,w.lead_id,b.name,b.rank,1
    from source_rows w join business_groups b on b.name=w.group_label where w.kind='acquisition'
  ), subject_groups as materialized (
    select distinct on(g.subject_key) g.* from group_candidates g
    order by g.subject_key,g.priority,g.rank,g.name,g.lead_id
  ), layouts as (
    select w.logical_key,w.source_record_id,w.resolved_student_id as student_id,w.lead_id,w.kind,
      coalesce(g.name,'未分组') as group_label,''::text as subgroup_label,coalesce(g.rank,1000000) as group_rank,
      w.source_rank,w.periods,w.period_defaults
    from source_rows w left join subject_groups g on g.subject_key=w.subject_key where w.kind='assessment'
    union all
    -- 新预约尚无历史测评表时，也可延续已确认的学生／线索小组。
    select 'assessment-group:'||g.subject_key,null::text,g.student_id,g.lead_id,'assessment',g.name,''::text,g.rank,
      1000000,'{}'::jsonb,'{}'::jsonb
    from subject_groups g where not exists(select 1 from source_rows w where w.kind='assessment' and w.subject_key=g.subject_key)
  )
  select w.logical_key,w.source_record_id,w.student_id,w.lead_id,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,w.periods,w.period_defaults
    from layouts w where view_all or case when w.student_id is not null then public.can_view_school_student(w.student_id,actor)
      else public.can_view_school_lead(w.lead_id,actor) end;
end;
$$;

notify pgrst,'reload schema';
