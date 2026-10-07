-- Join the source worklist once per page request. Stage counts still use the
-- complete authorized population; grouping only needs the requested stage.
do $migration$
declare definition text; previous text; replacement text;
begin
  select pg_get_functiondef('public.school_communication_page(text,text,text,text,text,integer,integer,text,text,text[])'::regprocedure)
    into definition;
  previous := $old$  ), entries as materialized (
    select v.*,coalesce(w.logical_key,v.key) as logical_key,w.kind,
$old$;
  replacement := $new$  ), worklist as materialized (
    select w.*,coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id) as subject_key
    from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
  ), entries as materialized (
    select distinct on(v.key) v.*,coalesce(w.logical_key,v.key) as logical_key,w.kind,
$new$;
  if position(previous in definition)=0 then raise exception 'COMMUNICATION_ENTRIES_ANCHOR_MISSING'; end if;
  definition := replace(definition,previous,replacement);
  previous := $old$    from visible v left join lateral (
      select w.* from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
      where v.key=coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id)
      order by case when w.kind=case v.stage when 'awaiting_first_contact' then 'acquisition' when 'awaiting_assessment' then 'acquisition' when 'awaiting_enrollment' then 'assessment' else 'service' end then 0 else 1 end,
        w.group_rank,w.source_rank,w.logical_key limit 1
    ) w on true
$old$;
  replacement := $new$    from visible v left join worklist w on w.subject_key=v.key
    where v.stage=p_stage
    order by v.key,
      case when w.kind=case v.stage when 'awaiting_first_contact' then 'acquisition' when 'awaiting_assessment' then 'acquisition' when 'awaiting_enrollment' then 'assessment' else 'service' end then 0 else 1 end,
      w.group_rank,w.source_rank,w.logical_key
$new$;
  if position(previous in definition)=0 then raise exception 'COMMUNICATION_WORKLIST_ANCHOR_MISSING'; end if;
  definition := replace(definition,previous,replacement);
  execute definition;

  -- A single-person read must filter the evidence before expanding its facts.
  -- The directory retains the existing all-person assessment calculation.
  select pg_get_functiondef('public.read_student_record_with_enrollments(uuid,uuid,public.business_course_enrollment_subjects[])'::regprocedure)
    into definition;
  previous := $old$exists(select 1 from public.school_source_completed_assessments() x where x.key=coalesce('student:'||student.id,'lead:'||lead.id))$old$;
  replacement := $new$exists(
    select 1 from public.school_source_status_subjects x
    where x.key=coalesce('student:'||student.id,'lead:'||lead.id)
      and x.fact->>'type'='assessment' and x.fact->>'value'='complete' and x.fact->>'certainty'='confirmed'
      and not exists(select 1 from public.assessment_results a where a.source_record_id=x.source_id and a.history_revision>0)
  )$new$;
  if position(previous in definition)=0 then raise exception 'COMMUNICATION_ASSESSMENT_ANCHOR_MISSING'; end if;
  execute replace(definition,previous,replacement);
end;
$migration$;
