-- Resolve only source rows connected to the requested people. Every version and
-- competing identity for those logical rows still participates in resolution.
-- The existing private helper boundary and public subject permission checks stay
-- in place; no business data or stored stage changes.
create or replace function public.school_source_status_facts_for_subjects(p_subject_keys text[])
returns table(key text,source_id text,fact jsonb)
language sql stable security definer
set search_path=public,pg_temp
set plan_cache_mode=force_custom_plan
as $function$
  with requested_rows as materialized (
    select distinct h.source_table_key,h.source_row_key
    from public.school_source_subject_links l
    join public.history_import_records h on h.id=l.source_id
    where l.subject_key=any(p_subject_keys)
      and h.source_format='feishu-base'
      and h.source_table_key is not null and h.source_row_key is not null
  ), versions as materialized (
    select h.id,h.source_table_key,h.source_row_key
    from requested_rows r join public.history_import_records h
      on h.source_table_key=r.source_table_key and h.source_row_key=r.source_row_key
    where h.source_format='feishu-base'
  ), candidates as materialized (
    select h.source_table_key,h.source_row_key,l.subject_key,l.priority
    from versions h join public.school_source_subject_links l on l.source_id=h.id
    where l.subject_key is not null
  ), resolved as (
    select source_table_key,source_row_key,
      case when count(distinct subject_key) filter(where priority=0)=1
        then min(subject_key) filter(where priority=0)
        when count(*) filter(where priority=0)=0 and count(distinct subject_key)=1
        then min(subject_key) end as subject_key
    from candidates group by source_table_key,source_row_key
  ), current_sources as materialized (
    select r.subject_key,h.id,h.payload_sha256,
      exists(select 1 from public.history_import_records v join public.assessment_results a on a.source_record_id=v.id
        where v.source_table_key=r.source_table_key and v.source_row_key=r.source_row_key
          and a.history_revision>0) as manual_assessment
    from resolved r
    cross join lateral (
      select h.id,h.payload_sha256 from public.history_import_records h
      where h.source_format='feishu-base'
        and h.source_table_key=r.source_table_key and h.source_row_key=r.source_row_key
      order by h.source_snapshot_date desc,h.imported_at desc,h.id desc limit 1
    ) h
    where r.subject_key=any(p_subject_keys)
  )
  select s.subject_key,s.id,
    case when s.manual_assessment and f.value->>'type' in ('assessment','assessment_band','assessment_score','learning_band')
      then f.value||jsonb_build_object('certainty','review','priority',20) else f.value end
  from current_sources s join public.school_source_status_evidence e
    on e.source_record_id=s.id and e.payload_sha256=s.payload_sha256
  cross join lateral jsonb_array_elements(e.facts) f
$function$;

create or replace function public.school_source_status_facts_for_subject(p_subject_key text)
returns table(key text,source_id text,fact jsonb)
language sql stable security definer set search_path=public,pg_temp
as $function$
  select * from public.school_source_status_facts_for_subjects(array[p_subject_key])
$function$;

-- Find the current page's assessment IDs before evaluating completion or
-- constructing evidence text. Keep all four existing identity relationships.
do $migration$
declare original text; updated text;
begin
  select pg_get_functiondef('public.school_record_read_context(jsonb)'::regprocedure) into original;
  updated := replace(original,
    $old$  ), assessments as materialized (
    select a.*,r.student_id as registration_student_id,r.lead_id as registration_lead_id,r.assessment_completed_at
    from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
    where public.student_assessment_is_complete$old$,
    $new$  ), assessment_ids as materialized (
    select a.id from subjects s join public.assessment_results a on a.student_id=s.student_id
    union select a.id from subjects s join public.activity_registrations r on r.student_id=s.student_id
      join public.assessment_results a on a.activity_registration_id=r.id
    union select a.id from lead_refs ref join public.assessment_results a on a.lead_id=ref.id
    union select a.id from lead_refs ref join public.activity_registrations r on r.lead_id=ref.id
      join public.assessment_results a on a.activity_registration_id=r.id
  ), assessments as materialized (
    select a.*,r.student_id as registration_student_id,r.lead_id as registration_lead_id,r.assessment_completed_at
    from assessment_ids ids join public.business_assessment_results a on a.id=ids.id
    join public.business_activity_registrations r on r.id=a.activity_registration_id
    where public.student_assessment_is_complete$new$);
  if updated=original then raise exception 'STATUS_EVIDENCE_ASSESSMENT_ANCHOR_CHANGED'; end if;
  execute updated;
end
$migration$;
