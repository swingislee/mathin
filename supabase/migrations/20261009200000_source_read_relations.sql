-- Keep source coordinates as indexed relational fields. PostgreSQL maintains
-- these fields in the same write as the original JSON; historical payloads stay
-- authoritative. Current identity and human revisions are joined at read time.
alter table public.history_import_records
  add column source_format text generated always as (source_data->>'format') stored,
  add column source_table_key text generated always as (record_data->>'tableId') stored,
  add column source_row_key text generated always as (record_data->>'sourceRecordId') stored,
  add column source_snapshot_date text generated always as (coalesce(left(source_data->>'filename',10),'')) stored;

create index history_import_records_source_version_idx
  on public.history_import_records(source_table_key,source_row_key,source_snapshot_date desc,imported_at desc,id desc)
  where source_format='feishu-base';

-- One current version per logical source row, independent of the requested
-- person or date filter. Older versions continue to contribute identity links.
create view public.school_source_current_records with (security_invoker=true) as
select distinct on (h.source_table_key,h.source_row_key)
  h.id,h.source_table_key,h.source_row_key,h.payload_sha256
from public.history_import_records h
where h.source_format='feishu-base' and h.source_table_key is not null and h.source_row_key is not null
order by h.source_table_key,h.source_row_key,h.source_snapshot_date desc,h.imported_at desc,h.id desc;

-- These are the existing formal relations, expressed once as rows rather than
-- repeated inside each evidence/assessment function. A lead conversion or an
-- association correction is immediately visible through its original relation.
create view public.school_source_subject_links with (security_invoker=true) as
select h.id as source_id,coalesce('student:'||coalesce(l.student_id,h.student_id),'lead:'||h.lead_id) as subject_key,1 as priority
  from public.history_import_records h left join public.leads l on l.id=h.lead_id
union all
select l.source_record_id,coalesce('student:'||l.student_id,'lead:'||l.id),1 from public.leads l
union all
select a.record_id,'student:'||a.student_id,0 from public.history_import_associations a where a.match_state='confirmed'
union all
select c.source_record_id,coalesce('student:'||l.student_id,'lead:'||l.id),1
  from public.lead_communications c join public.leads l on l.id=c.lead_id
union all
select r.source_record_id,coalesce('student:'||coalesce(r.student_id,l.student_id),'lead:'||r.lead_id),1
  from public.activity_registrations r left join public.leads l on l.id=r.lead_id
union all
select a.source_record_id,coalesce('student:'||coalesce(a.student_id,l.student_id),'lead:'||a.lead_id),1
  from public.assessment_results a left join public.leads l on l.id=a.lead_id
union all
select e.source_record_id,'student:'||e.student_id,1 from public.course_enrollments e
union all
select o.source_record_id,coalesce('student:'||coalesce(o.student_id,l.student_id),'lead:'||o.lead_id),1
  from public.course_opportunities o left join public.leads l on l.id=o.lead_id
union all
select f.source_record_id,'student:'||f.student_id,1 from public.student_follow_ups f;

create view public.school_source_current_subjects with (security_invoker=true) as
with candidates as materialized (
  select h.source_table_key,h.source_row_key,l.subject_key,l.priority
  from public.school_source_subject_links l join public.history_import_records h on h.id=l.source_id
  where h.source_format='feishu-base' and h.source_table_key is not null and h.source_row_key is not null
    and l.subject_key is not null
), resolved as (
  select source_table_key,source_row_key,
    case when count(distinct subject_key) filter(where priority=0)=1
      then min(subject_key) filter(where priority=0)
      when count(*) filter(where priority=0)=0 and count(distinct subject_key)=1
      then min(subject_key) end as subject_key
  from candidates group by source_table_key,source_row_key
), manual_sources as materialized (
  select h.id,h.source_table_key,h.source_row_key
  from public.assessment_results a join public.history_import_records h on h.id=a.source_record_id
  where a.history_revision>0
)
select r.subject_key as key,h.id as source_id,h.payload_sha256,
  exists(select 1 from manual_sources m where m.id=h.id
    or (m.source_table_key=h.source_table_key and m.source_row_key=h.source_row_key)) as manual_assessment
from public.school_source_current_records h join resolved r using(source_table_key,source_row_key)
where r.subject_key is not null;

create or replace view public.school_source_status_subjects with (security_invoker=true) as
select s.key,s.source_id,
  case when s.manual_assessment and f.value->>'type' in ('assessment','assessment_band','assessment_score','learning_band')
    then f.value||jsonb_build_object('certainty','review','priority',20) else f.value end as fact
from public.school_source_current_subjects s join public.school_source_status_evidence e
  on e.source_record_id=s.source_id and e.payload_sha256=s.payload_sha256
cross join lateral jsonb_array_elements(e.facts) f;

create or replace function public.school_source_status_facts_for_subjects(p_subject_keys text[])
returns table(key text,source_id text,fact jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
  select s.key,s.source_id,s.fact from public.school_source_status_subjects s where s.key=any(p_subject_keys)
$$;

create or replace function public.school_source_status_facts_for_subject(p_subject_key text)
returns table(key text,source_id text,fact jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
  select s.key,s.source_id,s.fact from public.school_source_status_subjects s where s.key=p_subject_key
$$;

create or replace function public.school_source_completed_assessments()
returns table(key text)
language sql stable security definer set search_path=public,pg_temp as $$
  select distinct s.key from public.school_source_current_subjects s
  join public.school_source_status_evidence e on e.source_record_id=s.source_id and e.payload_sha256=s.payload_sha256
  where not s.manual_assessment
    and e.facts @> '[{"type":"assessment","value":"complete","certainty":"confirmed"}]'::jsonb
$$;

revoke all on public.school_source_current_records,public.school_source_subject_links,
  public.school_source_current_subjects,public.school_source_status_subjects from public,anon,authenticated;
revoke all on function public.school_source_status_facts_for_subjects(text[]),
  public.school_source_status_facts_for_subject(text),public.school_source_completed_assessments() from public,anon,authenticated;
alter function public.school_source_status_facts_for_subjects(text[]) owner to postgres;
alter function public.school_source_status_facts_for_subject(text) owner to postgres;
alter function public.school_source_completed_assessments() owner to postgres;
grant execute on function public.school_source_status_facts_for_subjects(text[]),
  public.school_source_status_facts_for_subject(text),public.school_source_completed_assessments() to postgres;

analyze public.history_import_records;

-- Runtime readers use relational keys and enrich only the selected page.
do $guard$
begin
  if md5(pg_get_functiondef('student_record_index_for_population(text,text,business_course_enrollment_subjects[],boolean)'::regprocedure))<>'c5ba2ee4d76d2c4bcc155f76e9fe8df8' then
    raise exception 'SOURCE_READER_CHANGED: student_record_index_for_population';
  end if;
  if md5(pg_get_functiondef('school_record_status_evidence_batch(jsonb)'::regprocedure))<>'9f5ad384629c895ce75263c2995be19e' then
    raise exception 'SOURCE_READER_CHANGED: school_record_status_evidence_batch';
  end if;
  if md5(pg_get_functiondef('school_communication_page(text,text,text,text,text,integer,integer,text,text,text[])'::regprocedure))<>'55fa62f250033cbbd0902e7a587919c0' then
    raise exception 'SOURCE_READER_CHANGED: school_communication_page';
  end if;
end
$guard$;

CREATE OR REPLACE FUNCTION public.student_record_index_for_population(p_scope text, p_search text, p_enrollments business_course_enrollment_subjects[], p_students_only boolean)
 RETURNS TABLE(student_id uuid, lead_id uuid, key text, stage text, detail text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); view_all boolean; view_followup boolean; today date;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  view_all:=public.has_perm(actor,'student.view.all');
  view_followup:=public.has_perm(actor,'followup.view');
  today:=(now() at time zone public.get_organization_timezone_v2())::date;
  if p_scope in ('mine','group') and not exists(select 1 from public.school_list_scope_keys(actor,p_scope)) then return; end if;
  return query with
  directory_sources as materialized (
    select h.id,coalesce(d.decision='continue',s.record_id is null) as current_source
      from public.history_import_records h
      left join public.history_workflow_decisions d on d.key='record:'||h.id
      left join (select distinct record_id from public.history_workflow_scopes where resumed_at is null) s on s.record_id=h.id
      where h.source_format='feishu-base'
  ), directory_historical_facts as materialized (
    select distinct s.relation,s.record_id from public.history_business_workflow_scopes s
      left join public.history_workflow_decisions d on d.key='record:'||s.source_record_id
      where coalesce(d.decision,'archive')<>'continue'
  ), directory_business_lead_communications as not materialized (
    select r.id,r.lead_id,r.occurred_at,r.occurred_on,r.outcome,r.source_key,r.source_metric_facts,r.wechat_added,r.visit_committed from public.lead_communications r
      where not coalesce(r.source_metric_facts->'supersededProjection'='true'::jsonb,false)
        and (r.source_record_id is null or r.source_record_id in(select id from directory_sources))
  ), directory_business_activity_registrations as not materialized (
    select r.id,r.student_id,r.lead_id,r.activity_id,r.status,r.assessment_started_at,r.assessment_completed_at,r.created_at,
      r.source_record_id,r.source_enrollment_facts,
      case when (r.source_record_id is null or r.source_record_id in(select id from directory_sources where current_source))
        and not exists(select 1 from directory_historical_facts f where f.relation='activity_registrations' and f.record_id=r.id)
        then r.record_state else 'historical'::text end as record_state
      from public.activity_registrations r where r.source_record_id is null or r.source_record_id in(select id from directory_sources)
  ), directory_business_activities as not materialized (
    select r.id,r.kind,r.scheduled_at,r.occurred_on,r.deleted_at,
      case when (r.source_record_id is null or r.source_record_id in(select id from directory_sources where current_source))
        and not exists(select 1 from directory_historical_facts f where f.relation='activities' and f.record_id=r.id)
        then r.record_state else 'historical'::text end as record_state
      from public.activities r where r.source_record_id is null or r.source_record_id in(select id from directory_sources)
  ), directory_business_assessment_results as not materialized (
    select r.id,r.activity_registration_id,r.student_id,r.lead_id,r.score,r.assessment_band,r.assessed_on,r.assessed_by,r.updated_at,
      r.result_finalized_at,r.result_source,r.strengths,r.focus_areas,r.parent_concerns,r.teacher_recommendation,r.teacher_observation
      from public.assessment_results r where r.source_record_id is null or r.source_record_id in(select id from directory_sources)
  ), directory_business_course_opportunities as not materialized (
    select r.id,r.student_id,r.lead_id,r.stage,r.opportunity_type,r.course_id,r.term_id,r.updated_at,
      case when (r.source_record_id is null or r.source_record_id in(select id from directory_sources where current_source))
        and not exists(select 1 from directory_historical_facts f where f.relation='course_opportunities' and f.record_id=r.id)
        then r.record_state else 'historical'::text end as record_state
      from public.course_opportunities r where r.source_record_id is null or r.source_record_id in(select id from directory_sources)
  ),
 visibility as materialized (select vis.key,vis.can_view from public.school_list_visibility(actor) vis where not view_all),
  scope_keys as materialized (select scoped.key from public.school_list_scope_keys(actor,p_scope) scoped),
  subjects as materialized (
    select s.id as student_id,null::uuid as lead_id,'student:'||s.id as key,s.created_at,s.assigned_to as owner_id
      from public.students s where s.deleted_at is null and s.purpose<>'test' and (view_all or exists(select 1 from visibility v where v.key='student:'||s.id and v.can_view))
        and (p_scope='all' or (p_scope='mine' and exists(select 1 from scope_keys k where k.key='student:'||s.id)) or (p_scope='unassigned' and s.assigned_to is null or p_scope='group' and exists(select 1 from scope_keys k where k.key='student:'||s.id)))
        and (coalesce(p_search,'')='' or s.id::text=p_search
          or position(lower(p_search) in lower(s.name||' '||s.school||' '||s.phone||' '||s.parent_phone))>0
          or (length(regexp_replace(p_search,'\D','','g'))>=3 and
            position(regexp_replace(p_search,'\D','','g') in regexp_replace(s.phone||' '||s.parent_phone,'\D','','g'))>0))
    union all
    select null,l.id,'lead:'||l.id,l.created_at,l.owner_id from public.leads l
      where not p_students_only and l.student_id is null and l.purpose<>'test' and view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end
        and (p_scope='all' or (p_scope='mine' and exists(select 1 from scope_keys k where k.key=coalesce('student:'||l.student_id,'lead:'||l.id))) or (p_scope='unassigned' and l.owner_id is null or p_scope='group' and exists(select 1 from scope_keys k where k.key=coalesce('student:'||l.student_id,'lead:'||l.id))))
        and (coalesce(p_search,'')='' or l.id::text=p_search
          or position(lower(p_search) in lower(l.provisional_student_name||' '||l.phone))>0
          or (length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in l.phone_normalized)>0))
  ), lead_refs as materialized (
    select l.*,coalesce('student:'||l.student_id,'lead:'||l.id) as key from public.leads l
      where exists(select 1 from subjects s where s.key=coalesce('student:'||l.student_id,'lead:'||l.id))
  ), stage_enrollments as materialized (
    select * from unnest(p_enrollments)
  ), source_lead_refs as materialized (
    select l.key,h.id as source_record_id from lead_refs l join public.history_import_records h on h.lead_id=l.id
    union select l.key,h.id from lead_refs l join public.history_import_records h on h.id=l.source_record_id
  ), selected_leads as materialized (
    select distinct on(l.key) l.key,l.id,l.status,l.owner_id from lead_refs l
      where view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end
      order by l.key,(l.status not in ('invalid','converted')) desc,l.created_at desc,l.id
  ), contacts as materialized (
    select l.key,c.id,c.occurred_at,coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,public.school_contact_is_effective(to_jsonb(c),r.effective_patch) as effective_contact,public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) as contact_order,
      view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end as visible
      from directory_business_lead_communications c join lead_refs l on l.id=c.lead_id
      left join lateral (select r.effective_patch from public.communication_record_revisions r
        where r.source='contact' and r.event_id=c.id order by r.revision_no desc limit 1) r on true
  ), contact_flags as (select c.key from contacts c where c.effective_contact group by c.key union select other_contact.key from public.school_other_contact_subjects() other_contact),
  latest_contacts as (select distinct on(c.key) c.key,c.outcome from contacts c where c.visible order by c.key,c.occurred_at desc nulls last,c.contact_order desc,c.id),
  stage_registrations as materialized (
    select r.* from directory_business_activity_registrations r where exists(select 1 from subjects s where s.student_id=r.student_id)
      or exists(select 1 from lead_refs l where l.id=r.lead_id)
      or exists(select 1 from source_lead_refs l where l.source_record_id=r.source_record_id)
  ), registration_refs as materialized (
    select 'student:'||r.student_id as key,r.id from stage_registrations r where r.student_id is not null
    union select l.key,r.id from stage_registrations r join lead_refs l on l.id=r.lead_id
    union select l.key,r.id from stage_registrations r join source_lead_refs l on l.source_record_id=r.source_record_id
  ), attendance_flags as (
    select ref.key from registration_refs ref join stage_registrations r on r.id=ref.id
      join directory_business_activities a on a.id=r.activity_id where r.status='attended' and a.deleted_at is null group by ref.key
  ), source_owner_flags as (
    select distinct ref.key from source_lead_refs ref join public.history_import_records h on h.id=ref.source_record_id
      cross join lateral jsonb_array_elements(h.record_data->'cells') c
      where c->>'fieldName' in ('报名服务老师','学服老师','确认人员') and nullif(btrim(c->>'text'),'') is not null
  ), enrollment_facts as (
    select e.subject_key as key,
      e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today) as active,
      false as membership from stage_enrollments e left join public.school_terms t on t.id=e.term_id
    union all select l.key,e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today),false
      from stage_enrollments e join source_lead_refs l on l.source_record_id=e.source_record_id left join public.school_terms t on t.id=e.term_id
    union all
    select 'student:'||e.student_id,
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today),
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today)
      from public.enrollments e join public.classrooms c on c.id=e.classroom_id left join public.school_terms t on t.id=c.term_id
    union all
    select ref.key,r.record_state='current' and not exists(select 1 from stage_enrollments e where e.subject_key=ref.key and e.record_state='current'),false
      from registration_refs ref join stage_registrations r on r.id=ref.id where false /* 到访表报名由独立正式报名和入班事实交叉验证 */
  ), enrollment_flags as (
    select f.key,bool_or(f.active) as active,bool_or(f.membership) as membership from enrollment_facts f group by f.key
  ), latest_enrollments as (
    select distinct on(e.subject_key) e.subject_key,e.status from stage_enrollments e
      order by e.subject_key,(e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id
  ), assessments as materialized (
    select distinct on(ref.key) ref.key,r.id as registration_id
      from registration_refs ref join stage_registrations r on r.id=ref.id
      join directory_business_assessment_results a on a.activity_registration_id=r.id
      where public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
      order by ref.key,coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id
  ), appointments as (
    select distinct on(ref.key) ref.key,r.status,r.assessment_started_at
      from registration_refs ref join stage_registrations r on r.id=ref.id join directory_business_activities a on a.id=r.activity_id
      where r.record_state='current' and a.record_state='current' and a.deleted_at is null and a.kind in ('assessment_1v1','assessment')
      order by ref.key,coalesce(a.scheduled_at,r.created_at) desc,r.id
  ), opportunity_refs as (
    select 'student:'||o.student_id as key,o.id from directory_business_course_opportunities o where o.student_id is not null
    union select l.key,o.id from directory_business_course_opportunities o join lead_refs l on l.id=o.lead_id
  ), opportunities as (
    select distinct on(ref.key) ref.key,o.stage,o.opportunity_type from opportunity_refs ref
      join directory_business_course_opportunities o on o.id=ref.id left join public.courses c on c.id=o.course_id left join public.school_terms t on t.id=o.term_id
      where o.record_state='current' order by ref.key,o.updated_at desc,o.id
  ), stages as materialized (
    select s.*,case when e.active then 'awaiting_renewal' when e.key is not null then 'former_student'
      when a.key is not null or s.key in (select evidence.key from public.school_source_completed_assessments() evidence) then 'awaiting_enrollment' when c.key is not null or reached.key is not null then 'awaiting_assessment' else 'awaiting_first_contact' end as stage,
      coalesce(e.membership,false) as membership,a.registration_id
      from subjects s left join enrollment_flags e on e.key=s.key left join assessments a on a.key=s.key left join contact_flags c on c.key=s.key left join attendance_flags reached on reached.key=s.key
  ) select s.student_id,l.id,s.key,s.stage,
    case s.stage
      when 'awaiting_first_contact' then public.student_first_contact_detail(coalesce(s.owner_id,l.owner_id),case when exists(select 1 from source_owner_flags owned where owned.key=s.key) then 'source' end,l.status,c.outcome)
      when 'awaiting_assessment' then case when i.kind='assessment_1v1' and i.state='confirmed' then 'booked'
        when i.kind='assessment_1v1' then 'coordinating' when a.status='no_show' then 'no_show' when a.status='cancelled' then 'cancelled'
        when a.assessment_started_at is not null then 'in_progress' when a.status='attended' then 'attended_without_result' when a.status='booked' then 'booked' when exists(select 1 from attendance_flags reached where reached.key=s.key) then 'attended_without_result' else 'not_booked' end
      when 'awaiting_enrollment' then case o.stage when 'committed' then 'ready_to_enroll' when 'not_enrolled' then 'not_enrolling'
        when 'considering' then 'considering' when 'payment_pending' then 'payment_pending' when 'nurturing' then 'nurturing' else coalesce(w.classification,'assessed') end
      when 'awaiting_renewal' then case when o.opportunity_type='renewal' and o.stage='not_enrolled' then 'not_renewing'
        when o.opportunity_type='renewal' and o.stage='considering' then 'renewal_considering'
        when o.opportunity_type='renewal' and o.stage='committed' then 'renewal_committed'
        when o.opportunity_type='renewal' and o.stage='enrolled' then 'renewal_confirmed'
        when s.membership then 'attending' else 'awaiting_class' end
      else case when e.status='cancelled' then 'withdrawn' else 'ended' end end,s.created_at
    from stages s left join selected_leads l on l.key=s.key left join latest_contacts c on c.key=s.key
    left join public.lead_invitation_threads i on i.lead_id=l.id and i.state not in ('completed','cancelled')
    left join appointments a on a.key=s.key left join opportunities o on o.key=s.key
    left join public.assessment_workflow_states w on w.registration_id=s.registration_id
    left join latest_enrollments e on e.subject_key=s.key;
end;
$function$;

CREATE OR REPLACE FUNCTION public.school_record_status_evidence_batch(p_subjects jsonb)
 RETURNS TABLE(key text, facts jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare actor uuid:=auth.uid(); subject record; v_student_id uuid; normalized jsonb:='[]'::jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then
    return query select s.key,'[]'::jsonb from jsonb_to_recordset(p_subjects) as s(key text);
    return;
  end if;
  -- 批量读取仍逐一核对身份和范围，沿用单人证据入口的权限语义。
  for subject in select * from jsonb_to_recordset(p_subjects) as s(key text,student_id uuid,lead_id uuid) loop
    v_student_id:=subject.student_id;
    if subject.lead_id is not null then
      if not public.can_view_school_lead(subject.lead_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
      select coalesce(v_student_id,l.student_id) into v_student_id from public.leads l where l.id=subject.lead_id;
      if subject.student_id is not null and exists(select 1 from public.leads l where l.id=subject.lead_id and l.student_id is distinct from subject.student_id) then raise exception 'SUBJECT_MISMATCH'; end if;
    end if;
    if v_student_id is not null and not public.can_view_school_student(v_student_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    if v_student_id is null and subject.lead_id is null then raise exception 'NOT_FOUND'; end if;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('key',subject.key,'student_id',v_student_id,
      'lead_id',subject.lead_id,'subject_key',coalesce('student:'||v_student_id,'lead:'||subject.lead_id)));
  end loop;
  if normalized='[]'::jsonb then return; end if;
  return query
  with subjects as materialized (
    select distinct * from jsonb_to_recordset(normalized) as s(key text,student_id uuid,lead_id uuid,subject_key text)
  ), lead_refs as materialized (
    select s.key,l.id from subjects s join public.leads l on l.id=s.lead_id or l.student_id=s.student_id
    where public.can_view_school_lead(l.id,actor)
  ), source_values as materialized (
    select v.* from public.school_source_status_facts_for_subjects(array(select distinct s.subject_key from subjects s)) v
  ), source_facts as (
    select s.key,v.fact||jsonb_build_object('sourceId',v.source_id,'recordId',v.source_id)
      ||case when v.fact->>'type' in ('assessment','assessment_band','assessment_score','learning_band')
        and exists(select 1 from public.assessment_results a where a.source_record_id=v.source_id and a.history_revision>0)
        then jsonb_build_object('certainty','review','priority',20) else '{}'::jsonb end as fact
    from source_values v join subjects s on s.subject_key=v.key
  ), contacts as materialized (
    select ref.key,c.id,
      case when r.effective_patch?'occurredAt' then r.effective_patch->>'occurredAt' else coalesce(c.occurred_on::text,c.occurred_at::text) end as effective_date,
      to_jsonb(c)||coalesce(r.effective_patch,'{}'::jsonb)
        ||case when r.effective_patch?'wechatAdded' then jsonb_build_object('wechat_added',r.effective_patch->'wechatAdded') else '{}'::jsonb end
        ||case when r.effective_patch?'interestLevel' then jsonb_build_object('interest_level',r.effective_patch->'interestLevel') else '{}'::jsonb end
        ||case when r.effective_patch?'visitCommitted' then jsonb_build_object('visit_committed',r.effective_patch->'visitCommitted') else '{}'::jsonb end as data,
      r.effective_patch as patch
    from public.business_lead_communications c join lead_refs ref on ref.id=c.lead_id
    left join lateral (
      select effective_patch from public.communication_record_revisions r where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.source_record_id is null or r.effective_patch is not null
  ), contact_facts as (
    select c.key,jsonb_build_object('type',f.type,'value',f.value,'field',f.field,'excerpt',coalesce(nullif(c.data->>'note',''),f.field),
      'priority',400,'certainty','confirmed','date',c.effective_date,'recordId',c.id::text) as fact
    from contacts c cross join lateral (values
      ('wechat',case c.data->>'wechat_added' when 'true' then 'yes' when 'false' then 'no' else case when c.patch?'wechatAdded' then 'unknown' end end,'沟通登记 · 微信'),
      ('interest',coalesce(nullif(c.data->>'interest_level',''),case when c.patch?'interestLevel' then 'unknown' end),'沟通登记 · 意向'),
      ('visit',case c.data->>'visit_committed' when 'true' then 'promised' when 'false' then 'not_promised' else case when c.patch?'visitCommitted' then 'unknown' end end,'沟通登记 · 到访'),
      ('contact',case when c.data->>'outcome' in ('connected','declined') then 'reached' end,'沟通登记 · 联系结果')
    ) f(type,value,field) where f.value is not null
  ), assessments as materialized (
    select a.*,r.student_id as registration_student_id,r.lead_id as registration_lead_id,r.assessment_completed_at
    from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
    where public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
      a.result_source,a.score,a.assessment_band,a.strengths,concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
  ), assessment_refs as materialized (
    select s.key,a.id from subjects s join assessments a on a.student_id=s.student_id
    union select s.key,a.id from subjects s join assessments a on a.registration_student_id=s.student_id
    union select ref.key,a.id from lead_refs ref join assessments a on a.lead_id=ref.id
    union select ref.key,a.id from lead_refs ref join assessments a on a.registration_lead_id=ref.id
  ), assessment_facts as (
    select s.key,jsonb_build_object('type',f.type,'value',f.value,'field',f.field,
      'excerpt',concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation),
      'priority',case when a.source_record_id is null or a.history_revision>0 then 400 else 140 end,
      'certainty','confirmed','date',coalesce(a.assessed_on::text,a.assessment_completed_at::text,a.result_finalized_at::text),
      'sourceId',a.source_record_id,'recordId',a.id::text) as fact
    from assessment_refs s join assessments a on a.id=s.id
    cross join lateral (values ('assessment','complete','测评记录 · 已完成'),('assessment_band',a.assessment_band,'测评记录 · 思维等级'),
      ('assessment_score',a.score::text,'测评记录 · 分数')) f(type,value,field) where f.value is not null
  ), all_facts as (
    select * from source_facts union all select * from contact_facts union all select * from assessment_facts
  ) select s.key,coalesce(jsonb_agg(f.fact order by (f.fact->>'priority')::integer desc,f.fact->>'date' desc nulls last)
      filter(where f.fact is not null),'[]'::jsonb)
    from subjects s left join all_facts f on f.key=s.key group by s.key;
end
$function$;

CREATE OR REPLACE FUNCTION public.school_communication_page(p_stage text DEFAULT 'awaiting_assessment'::text, p_scope text DEFAULT 'mine'::text, p_search text DEFAULT ''::text, p_group text DEFAULT ''::text, p_marker text DEFAULT ''::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_period_field text DEFAULT ''::text, p_period text DEFAULT ''::text, p_subjects text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare
  actor uuid:=auth.uid(); facts public.business_course_enrollment_subjects[]; result jsonb; period_field text;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then raise exception 'FORBIDDEN'; end if;
  if p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','former_student')
    or p_scope is null or p_scope not in ('mine','all','group','unassigned')
    or p_search is null or length(p_search)>80 or p_group is null or length(p_group)>320
    or p_marker is null or length(p_marker)>80 or p_page is null or p_page not between 1 and 1000000
    or p_page_size is null or p_page_size not in (20,50,100)
    or p_period_field is null or p_period_field not in ('','acquired','followed','confirmed','arrived','enrolled')
    or p_period is null or (p_period not in ('','all','unknown') and p_period !~ '^([1-9]|1[0-2])月$')
    or (p_subjects is not null and (cardinality(p_subjects)>200 or exists(select 1 from unnest(p_subjects) k where k !~ '^(student|lead):[0-9a-fA-F-]{36}$')))
    then raise exception 'VALIDATION'; end if;
  period_field:=case when p_stage='former_student' then '' when p_period_field<>'' then p_period_field
    when p_stage='awaiting_enrollment' then 'arrived' else 'acquired' end;
  if (p_stage in ('awaiting_first_contact','awaiting_assessment') and period_field not in ('acquired','followed','confirmed'))
    or (p_stage='awaiting_enrollment' and period_field not in ('arrived','confirmed','enrolled')) then raise exception 'VALIDATION'; end if;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into facts
    from public.business_course_enrollment_subjects e;
  with visible as materialized (
    select v.* from public.student_record_index_for_population(p_scope,p_search,facts,false) v where p_subjects is null or v.key=any(p_subjects)
  ), worklist as materialized (
    select w.logical_key,w.kind,w.group_label,w.subgroup_label,w.group_rank,w.source_rank,
      w.markers,w.periods,w.period_defaults,coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id) as subject_key,
      case when p_stage='awaiting_first_contact' then intake.completed_at end as miniapp_registered_at
    from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
    left join public.miniapp_intakes intake on intake.id=w.miniapp_intake_id and intake.intake_kind='family'
  ), entries as materialized (
    select distinct on(v.key) v.*,coalesce(w.logical_key,v.key) as logical_key,w.kind,
      coalesce(w.group_label,'未分组') as group_label,coalesce(w.subgroup_label,'') as subgroup_label,
      case when w.miniapp_registered_at is not null then -1 else coalesce(w.group_rank,1000000) end as group_rank,
      coalesce(w.source_rank,1000000) as source_rank,w.miniapp_registered_at,
      coalesce(w.markers,'[]'::jsonb) as markers,
      coalesce(w.periods,'{}'::jsonb) as periods,coalesce(w.period_defaults,'{}'::jsonb) as period_defaults,
      coalesce(w.group_label,'未分组')||' / '||coalesce(w.subgroup_label,'') as group_key
    from visible v left join worklist w on w.subject_key=v.key
    where v.stage=p_stage
    order by v.key,
      case when w.kind=case v.stage when 'awaiting_first_contact' then 'acquisition' when 'awaiting_assessment' then 'acquisition' when 'awaiting_enrollment' then 'assessment' else 'service' end then 0 else 1 end,
      w.group_rank,w.source_rank,w.logical_key
  ), task_entries as materialized (
    select *,coalesce(nullif(periods->>period_field,''),'unknown') as period
    from entries where stage=p_stage and (p_subjects is null or key=any(p_subjects))
  ), defaults as (
    select coalesce(
      case when p_stage='awaiting_first_contact' and period_field='acquired' then
        (select period from task_entries where miniapp_registered_at is not null and period<>'unknown'
          order by miniapp_registered_at desc,key limit 1) end,
      max(period_defaults->>'month'),'12月') as preferred,
      case when p_stage<>'awaiting_first_contact' then max(period_defaults->>'group') end as preferred_group
    from task_entries
  ), period_totals as materialized (
    select period,count(distinct key)::integer as n,
      case when period ~ '^([1-9]|1[0-2])月$' then
        (replace(period,'月','')::integer - coalesce(nullif(regexp_replace((select preferred from defaults),'[^0-9]','','g'),''),'12')::integer + 11) % 12
        else -1 end as rank
    from task_entries group by period
  ), choice as (
    select case when p_stage='former_student' then 'all' else coalesce(nullif(p_period,''),
      (select period from period_totals where period=(select preferred from defaults)),
      (select period from period_totals order by rank desc limit 1),'unknown') end as period
  ), period_entries as materialized (
    select t.*,pt.rank as period_rank from task_entries t join period_totals pt using(period)
      where (select period from choice)='all' or t.period=(select period from choice)
  ), group_choice as (
    select coalesce(nullif(p_group,''),(select group_label from period_entries where group_label=(select preferred_group from defaults) limit 1),'all') as label
  ), filtered as materialized (
    select distinct on(key) * from period_entries where ((select label from group_choice)='all' or group_label=(select label from group_choice) or group_key=(select label from group_choice))
      and (p_marker='' or exists(select 1 from jsonb_array_elements(markers) m where m->>'key'=p_marker))
    order by key,period_rank desc,group_rank,source_rank,logical_key
  ), totals as (select count(*)::integer as n from filtered),
  selected as materialized (
    select * from filtered order by period_rank desc,group_rank,miniapp_registered_at desc nulls last,source_rank,logical_key
      offset (least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)))-1)*p_page_size limit p_page_size
  ), details as materialized (
    select r from jsonb_array_elements(public.student_record_list_rows(
      coalesce((select jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,
        'stage',stage,'detail',detail,'created_at',created_at)) from selected),'[]'::jsonb),facts)) r
  ) select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(d.r||jsonb_build_object('worklist',jsonb_build_object(
      'id',s.logical_key,'kind',s.kind,'group',s.group_label,'subgroup',s.subgroup_label,'groupKey',s.group_key,
      'rank',s.source_rank,'markers',s.markers,'context',coalesce(context_row.context,'[]'::jsonb),'period',s.period,'periods',s.periods))
      order by s.period_rank desc,s.group_rank,s.miniapp_registered_at desc nulls last,s.source_rank,s.logical_key)
      from selected s join details d on d.r->>'key'=s.key
      left join public.school_source_worklist_entries context_row on context_row.logical_key=s.logical_key),'[]'::jsonb),
    'count',(select n from totals),'page',least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals))),
    'pageSize',p_page_size,'totalPages',greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)),
    'periodField',period_field,'period',(select period from choice),'group',(select label from group_choice),
    'periods',case when p_stage='former_student' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('key',period,'count',n) order by rank desc) from period_totals),'[]'::jsonb) end,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('key',group_label,'count',n,'subgroups',
      coalesce((select jsonb_agg(jsonb_build_object('key',subgroup_label,'count',n) order by rank) from
        (select subgroup_label,count(distinct key)::integer as n,min(group_rank) as rank from period_entries t where t.group_label=g.group_label group by subgroup_label) sub),'[]'::jsonb)) order by rank) from
      (select group_label,count(distinct key)::integer as n,min(group_rank) as rank from period_entries group by group_label) g),'[]'::jsonb),
    'markers',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'color',color,'count',n) order by key) from
      (select m->>'key' as key,m->>'label' as label,m->>'color' as color,count(distinct t.key) as n
        from period_entries t cross join lateral jsonb_array_elements(t.markers) m
        where (select label from group_choice)='all' or t.group_label=(select label from group_choice) or t.group_key=(select label from group_choice) group by m->>'key',m->>'label',m->>'color') m),'[]'::jsonb),
    'counts',jsonb_build_object(
      'awaiting_first_contact',(select count(distinct key) from visible where stage='awaiting_first_contact'),
      'awaiting_assessment',(select count(*) from visible where stage='awaiting_assessment'),
      'awaiting_enrollment',(select count(*) from visible where stage='awaiting_enrollment'),
      'former_student',(select count(*) from visible where stage='former_student'),
      'awaiting_renewal',(select count(*) from visible where stage='awaiting_renewal'))
  ) into result;
  return result;
end;
$function$;
