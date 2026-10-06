-- Derived evidence never replaces a communication, assessment, or enrollment record.
-- A changed source payload invalidates its projection until the importer refreshes it.
create table public.school_source_status_evidence (
  source_record_id text primary key references public.history_import_records(id) on delete cascade,
  payload_sha256 text not null,
  facts jsonb not null check(jsonb_typeof(facts)='array'),
  extracted_at timestamptz not null default now()
);
alter table public.school_source_status_evidence enable row level security;
revoke all on public.school_source_status_evidence from public,anon,authenticated;
grant all on public.school_source_status_evidence to service_role;

create view public.school_source_status_subjects with (security_invoker=true) as
select coalesce('student:'||coalesce(l.student_id,h.student_id),'lead:'||h.lead_id) as key,
  h.id as source_id,f.value as fact
from public.school_source_status_evidence e join public.history_import_records h
  on h.id=e.source_record_id and h.payload_sha256=e.payload_sha256
left join public.leads l on l.id=h.lead_id
cross join lateral jsonb_array_elements(e.facts) f
where coalesce(l.student_id,h.student_id,h.lead_id) is not null;
revoke all on public.school_source_status_subjects from public,anon,authenticated;

create function public.school_source_completed_assessments() returns table(key text)
language sql stable security definer set search_path=public,pg_temp as $$
  select distinct s.key from public.school_source_status_subjects s
  where s.fact->>'type'='assessment' and s.fact->>'value'='complete' and s.fact->>'certainty'='confirmed'
    and not exists(select 1 from public.assessment_results a where a.source_record_id=s.source_id and a.history_revision>0)
$$;
revoke all on function public.school_source_completed_assessments() from public,anon,authenticated;
grant execute on function public.school_source_completed_assessments() to postgres;

create function public.school_record_status_evidence(p_student_id uuid,p_lead_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); subject_key text; v_student_id uuid:=p_student_id; lead_ids uuid[]; result jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then return '[]'::jsonb; end if;
  if p_lead_id is not null then
    if not public.can_view_school_lead(p_lead_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    select coalesce(v_student_id,l.student_id) into v_student_id from public.leads l where l.id=p_lead_id;
    if p_student_id is not null and exists(select 1 from public.leads l where l.id=p_lead_id and l.student_id is distinct from p_student_id) then raise exception 'SUBJECT_MISMATCH'; end if;
  end if;
  if v_student_id is not null and not public.can_view_school_student(v_student_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if v_student_id is null and p_lead_id is null then raise exception 'NOT_FOUND'; end if;
  subject_key:=coalesce('student:'||v_student_id,'lead:'||p_lead_id);
  select coalesce(array_agg(l.id),'{}'::uuid[]) into lead_ids from public.leads l
    where (l.id=p_lead_id or l.student_id=v_student_id) and public.can_view_school_lead(l.id,actor);
  with source_facts as (
    select s.fact||jsonb_build_object('sourceId',s.source_id,'recordId',s.source_id)
      ||case when s.fact->>'type' in ('assessment','assessment_band','assessment_score','learning_band')
        and exists(select 1 from public.assessment_results a where a.source_record_id=s.source_id and a.history_revision>0)
        then jsonb_build_object('certainty','review','priority',20) else '{}'::jsonb end as fact
    from public.school_source_status_subjects s join public.history_import_records h on h.id=s.source_id
    where s.key=subject_key and (h.lead_id is null or h.lead_id=any(lead_ids))
  ), contacts as (
    select c.id,
      case when r.effective_patch?'occurredAt' then r.effective_patch->>'occurredAt' else coalesce(c.occurred_on::text,c.occurred_at::text) end as effective_date,
      to_jsonb(c)||coalesce(r.effective_patch,'{}'::jsonb)
        ||case when r.effective_patch?'wechatAdded' then jsonb_build_object('wechat_added',r.effective_patch->'wechatAdded') else '{}'::jsonb end
        ||case when r.effective_patch?'interestLevel' then jsonb_build_object('interest_level',r.effective_patch->'interestLevel') else '{}'::jsonb end
        ||case when r.effective_patch?'visitCommitted' then jsonb_build_object('visit_committed',r.effective_patch->'visitCommitted') else '{}'::jsonb end as data,
      r.effective_patch as patch,400 as priority
    from public.business_lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions r where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.lead_id=any(lead_ids) and (c.source_record_id is null or r.effective_patch is not null)
  ), contact_facts as (
    select jsonb_build_object('type',f.type,'value',f.value,'field',f.field,'excerpt',coalesce(nullif(c.data->>'note',''),f.field),
      'priority',c.priority,'certainty','confirmed','date',c.effective_date,'recordId',c.id::text) as fact
    from contacts c cross join lateral (values
      ('wechat',case c.data->>'wechat_added' when 'true' then 'yes' when 'false' then 'no' else case when c.patch?'wechatAdded' then 'unknown' end end,'沟通登记 · 微信'),
      ('interest',coalesce(nullif(c.data->>'interest_level',''),case when c.patch?'interestLevel' then 'unknown' end),'沟通登记 · 意向'),
      ('visit',case c.data->>'visit_committed' when 'true' then 'promised' when 'false' then 'not_promised' else case when c.patch?'visitCommitted' then 'unknown' end end,'沟通登记 · 到访'),
      ('contact',case when c.data->>'outcome' in ('connected','declined') then 'reached' end,'沟通登记 · 联系结果')
    ) f(type,value,field) where f.value is not null
  ), assessment_facts as (
    select jsonb_build_object('type',f.type,'value',f.value,'field',f.field,
      'excerpt',concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation),
      'priority',case when a.source_record_id is null or a.history_revision>0 then 400 else 140 end,
      'certainty','confirmed','date',coalesce(a.assessed_on::text,r.assessment_completed_at::text,a.result_finalized_at::text),
      'sourceId',a.source_record_id,'recordId',a.id::text) as fact
    from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
    cross join lateral (values ('assessment','complete','测评记录 · 已完成'),('assessment_band',a.assessment_band,'测评记录 · 思维等级'),
      ('assessment_score',a.score::text,'测评记录 · 分数')) f(type,value,field)
    where (a.student_id=v_student_id or r.student_id=v_student_id or a.lead_id=any(lead_ids) or r.lead_id=any(lead_ids))
      and f.value is not null and public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
  ) select coalesce(jsonb_agg(fact order by (fact->>'priority')::integer desc,fact->>'date' desc nulls last),'[]'::jsonb) into result
    from (select fact from source_facts union all select fact from contact_facts union all select fact from assessment_facts) f;
  return result;
end;
$$;
revoke all on function public.school_record_status_evidence(uuid,uuid) from public,anon;
grant execute on function public.school_record_status_evidence(uuid,uuid) to authenticated;


-- Canonical stage readers share the same confirmed source completion evidence.
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
      where h.source_data->>'format'='feishu-base'
  ), directory_historical_facts as materialized (
    select distinct s.relation,s.record_id from public.history_business_workflow_scopes s
      left join public.history_workflow_decisions d on d.key='record:'||s.source_record_id
      where coalesce(d.decision,'archive')<>'continue'
  ), directory_business_lead_communications as not materialized (
    select r.id,r.lead_id,r.occurred_at,r.occurred_on,r.outcome,r.source_key,r.source_metric_facts,r.wechat_added,r.visit_committed from public.business_lead_communications r
      where r.source_record_id is null or r.source_record_id in(select id from directory_sources)
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
  ), stages as (
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

CREATE OR REPLACE FUNCTION public.student_list_query_facts(p_scope text, p_search text, p_population text, p_stage text, p_subjects jsonb)
 RETURNS TABLE(row_data jsonb, index_stage text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); view_all boolean; view_followup boolean; write_followup boolean; today date; zone text;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'student.view.all') or public.has_perm(actor,'student.view.assigned')
    or public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_scope is null or p_scope not in ('all','mine','unassigned','group') or p_population is null or p_population not in ('work','records')
    or p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student')
    or length(coalesce(p_search,''))>80 then raise exception 'VALIDATION'; end if;
  view_all:=public.has_perm(actor,'student.view.all'); view_followup:=public.has_perm(actor,'followup.view');
  write_followup:=public.has_perm(actor,'followup.write'); zone:=public.get_organization_timezone_v2(); today:=(now() at time zone zone)::date;
  if p_scope in ('mine','group') and not exists(select 1 from public.school_list_scope_keys(actor,p_scope)) then return; end if;
  if p_subjects is not null and jsonb_array_length(p_subjects)=0 then return; end if;
  return query with visibility as materialized (select key,can_view from public.school_list_visibility(actor)),
  wanted as materialized (select w->>'key' as key,w from jsonb_array_elements(coalesce(p_subjects,'[]'::jsonb)) w),
  scope_keys as materialized (select scoped.key from public.school_list_scope_keys(actor,p_scope) scoped),
  paused_scopes as materialized (
    select s.student_id,s.lead_id from public.history_workflow_scopes s
      left join public.history_workflow_decisions d on d.key=s.scope_key
      where p_population='work' and (d.decision='archive' or s.resumed_at is null and coalesce(d.decision,'archive')<>'continue')
  ), paused_subjects as materialized (
    select 'student:'||student_id as key from paused_scopes where student_id is not null
    union select 'lead:'||lead_id from paused_scopes where lead_id is not null
  ), scheduled_subjects as materialized (
    select distinct key from public.communication_worklists w join public.communication_worklist_items i on i.worklist_id=w.id
      join public.leads l on i.row_key='lead:'||l.id
      cross join lateral unnest(array['student:'||l.student_id,'lead:'||l.id]) subject(key)
      where p_population='work' and to_jsonb(w)->>'is_scheduled'='true' and w.closed_at is null and i.completed_at is null and key is not null
  ),
  student_candidates as materialized (
    select s.* from public.students s where s.deleted_at is null and s.purpose<>'test' and (p_subjects is null or exists(select 1 from wanted w where w.key='student:'||s.id)) and (p_scope<>'unassigned' or s.assigned_to is null) and (
      p_population='records'
      or not exists(select 1 from paused_subjects p where p.key='student:'||s.id)
      or exists(select 1 from scheduled_subjects w where w.key='student:'||s.id)
      or exists(select 1 from public.leads l join scheduled_subjects w on w.key='lead:'||l.id where l.student_id=s.id)
    )
  ), lead_candidates as materialized (
    select l.* from public.leads l where l.student_id is null and l.purpose<>'test' and (p_subjects is null or exists(select 1 from wanted w where w.key='lead:'||l.id)) and (p_scope<>'unassigned' or l.owner_id is null) and (
      p_population='records'
      or not exists(select 1 from paused_subjects p where p.key='lead:'||l.id)
      or exists(select 1 from scheduled_subjects w where w.key='lead:'||l.id)
    )
  ), identities as materialized (
    select 'student:'||s.id as key,s.id as student_id,null::uuid as original_lead_id,s.created_at,s.assigned_to as owner_id
    from student_candidates s where (view_all or exists(select 1 from visibility v where v.key='student:'||s.id and v.can_view))
      and (p_scope='all' or p_scope='mine' and exists(select 1 from scope_keys k where k.key='student:'||s.id) or p_scope='unassigned' or p_scope='group' and exists(select 1 from scope_keys k where k.key='student:'||s.id))
      and (coalesce(p_search,'')='' or s.id::text=p_search or position(lower(p_search) in lower(s.name||' '||s.school||' '||s.phone||' '||s.parent_phone))>0
        or length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in regexp_replace(s.phone||' '||s.parent_phone,'\D','','g'))>0)
    union all
    select 'lead:'||l.id,null,l.id,l.created_at,l.owner_id from lead_candidates l
    where view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end
      and (p_scope='all' or p_scope='mine' and exists(select 1 from scope_keys k where k.key=coalesce('student:'||l.student_id,'lead:'||l.id)) or p_scope='unassigned' or p_scope='group' and exists(select 1 from scope_keys k where k.key=coalesce('student:'||l.student_id,'lead:'||l.id)))
      and (coalesce(p_search,'')='' or l.id::text=p_search or position(lower(p_search) in lower(l.provisional_student_name||' '||l.phone))>0
        or length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in l.phone_normalized)>0)
  ), lead_refs as materialized (
    select s.key,l.*,view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else exists(select 1 from visibility v where v.key='lead:'||l.id and v.can_view) end as visible
      from identities s join public.leads l on l.student_id=s.student_id
    union all select s.key,l.*,true from identities s join public.leads l on l.id=s.original_lead_id
  ), selected_leads as materialized (
    select distinct on(key) key,id,status,owner_id from lead_refs where visible
      order by key,(status not in ('invalid','converted')) desc,created_at desc,id
  ), subjects as materialized (
    select s.*,l.id as lead_id from identities s left join selected_leads l using(key)
      where p_population='records'
        or not exists(select 1 from paused_subjects ps where ps.key=s.key)
          and not exists(select 1 from paused_subjects pl where pl.key='lead:'||l.id)
        or exists(select 1 from scheduled_subjects ss where ss.key=s.key)
        or exists(select 1 from scheduled_subjects sl where sl.key='lead:'||l.id)
  ), subject_sources as materialized (
    select l.key,h.id from lead_refs l join subjects s using(key) join public.history_import_records h on h.lead_id=l.id
    union select l.key,h.id from lead_refs l join subjects s using(key) join public.history_import_records h on h.id=l.source_record_id
  ), registrations as materialized (
    select id,student_id,lead_id,source_record_id,record_state,source_enrollment_facts,status,activity_id,created_at,assessment_completed_at,assessment_started_at
      from public.business_activity_registrations
  ), registration_refs as materialized (
    select s.key,r.id from subjects s join registrations r on r.student_id=s.student_id
    union select l.key,r.id from lead_refs l join subjects s using(key) join registrations r on r.lead_id=l.id
    union select s.key,r.id from subject_sources s join registrations r on r.source_record_id=s.id
  ), enrollment_input as materialized (
    select id,student_id,source_record_id,opportunity_id,course_id,term_id,status,record_state,confirmed_at from public.business_course_enrollments
  ), enrollment_source_ids as materialized (select distinct source_record_id as id from enrollment_input where source_record_id is not null),
  -- 收窄的是来源编号；这些来源的全部身份归属仍参与冲突判断。
  enrollment_source_refs as (
    select record_id,count(distinct key) as subject_count,min(key) as subject_key from (
      select a.record_id,'student:'||a.student_id as key from public.history_import_associations a join enrollment_source_ids s on s.id=a.record_id
      union all select l.source_record_id,coalesce('student:'||l.student_id,'lead:'||l.id) from public.leads l join enrollment_source_ids s on s.id=l.source_record_id
      union all select o.source_record_id,coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id)
        from public.course_opportunities o join enrollment_source_ids s on s.id=o.source_record_id left join public.leads l on l.id=o.lead_id
      union all select r.source_record_id,coalesce('student:'||r.student_id,'student:'||l.student_id,'lead:'||r.lead_id)
        from public.activity_registrations r join enrollment_source_ids s on s.id=r.source_record_id left join public.leads l on l.id=r.lead_id
    ) refs where key is not null group by record_id
  ), enrollment_facts as materialized (
    select e.*,coalesce('student:'||e.student_id,case when coalesce(refs.subject_count,0)<=1
      and coalesce(refs.subject_key,coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id))
        =coalesce(coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id),refs.subject_key)
      then coalesce(refs.subject_key,'student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id) end) as subject_key,
      e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today) as active
    from enrollment_input e left join enrollment_source_refs refs on refs.record_id=e.source_record_id
      left join public.course_opportunities o on o.id=e.opportunity_id left join public.leads l on l.id=o.lead_id left join public.school_terms t on t.id=e.term_id
  ), enrollment_refs as materialized (
    select s.key,e.id from subjects s join enrollment_facts e on e.subject_key=s.key
    union select s.key,e.id from subject_sources s join enrollment_facts e on e.source_record_id=s.id
  ), enrollment_flags as (
    select ref.key,bool_or(e.active) as active,bool_or(e.record_state='current') as has_current from enrollment_refs ref join enrollment_facts e on e.id=ref.id group by ref.key
  ), latest_enrollments as (
    select distinct on(ref.key) ref.key,e.status,e.course_id,e.term_id from enrollment_refs ref join enrollment_facts e on e.id=ref.id
      order by ref.key,(e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id
  ), source_enrollment_flags as (
    select ref.key,bool_or(r.record_state='current') as active from registration_refs ref join registrations r on r.id=ref.id
      where false /* 到访表报名由独立正式报名和入班事实交叉验证 */ group by ref.key
  ), memberships as materialized (
    select s.key,e.classroom_id,e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today) as active
      from subjects s join public.enrollments e on e.student_id=s.student_id join public.classrooms c on c.id=e.classroom_id
      left join public.school_terms t on t.id=c.term_id
  ), membership_flags as (select key,bool_or(active) as active from memberships group by key),
  contacts as materialized (
    select l.key,l.visible,c.id,c.source_record_id,c.occurred_at,coalesce(r.effective_patch->>'note',c.note) as note,
      coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,public.school_contact_is_effective(to_jsonb(c),r.effective_patch) as effective_contact,public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) as contact_order from lead_refs l join subjects s using(key)
      join public.business_lead_communications c on c.lead_id=l.id left join lateral (
        select effective_patch from public.communication_record_revisions r where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
      ) r on true
  ), attendance_flags as (
    select ref.key from registration_refs ref join registrations r on r.id=ref.id
      join public.business_activities a on a.id=r.activity_id where r.status='attended' and a.deleted_at is null group by ref.key
  ), contact_flags as (select key from contacts where effective_contact group by key union select key from attendance_flags union select other_contact.key from public.school_other_contact_subjects() other_contact),
  latest_contacts as (select distinct on(key) key,id,source_record_id,occurred_at,note,outcome from contacts where visible order by key,occurred_at desc nulls last,contact_order desc,id),
  completed_assessments as materialized (
    select a.id,a.student_id,a.lead_id,a.source_record_id,a.activity_registration_id,a.score,a.assessment_band,a.assessed_by,a.updated_at,
      r.student_id as registration_student_id,r.lead_id as registration_lead_id,r.source_record_id as registration_source_id,
      coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) as completed_at,
      coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone zone)::date,
        act.occurred_on,(act.scheduled_at at time zone zone)::date) as assessed_on,
      nullif(substring(a.strengths from '(?:^|[\r\n])学习力测评等级：([^\r\n]+)'),'') as learning_band,act.deleted_at,act.id as activity_id
    from public.business_assessment_results a join registrations r on r.id=a.activity_registration_id
      left join public.business_activities act on act.id=r.activity_id
    where public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
  ), latest_assessments as materialized (
    select distinct on(ref.key) ref.key,a.id,a.activity_registration_id,a.source_record_id,a.completed_at,a.score,a.assessment_band
      from registration_refs ref join completed_assessments a on a.activity_registration_id=ref.id order by ref.key,a.completed_at desc,a.id
  ), stages as materialized (
    select s.*,case when e.active or m.active or se.active and not coalesce(e.has_current,false) then 'awaiting_renewal'
      when e.key is not null or m.key is not null or se.key is not null then 'former_student'
      when a.key is not null or s.key in (select evidence.key from public.school_source_completed_assessments() evidence) then 'awaiting_enrollment' when c.key is not null then 'awaiting_assessment' else 'awaiting_first_contact' end as stage,
      coalesce(m.active,false) as membership,a.activity_registration_id as registration_id,
      a.source_record_id as preferred_source_id,lc.source_record_id as contact_source_id
    from subjects s left join enrollment_flags e using(key) left join membership_flags m using(key) left join source_enrollment_flags se using(key)
      left join latest_assessments a using(key) left join contact_flags c using(key) left join latest_contacts lc using(key)
  ), listed as materialized (select * from stages where p_subjects is not null or coalesce(p_search,'')<>'' or stage=p_stage),
  appointments as (
    select distinct on(ref.key) ref.key,r.status,r.assessment_started_at from registration_refs ref join listed s using(key)
      join registrations r on r.id=ref.id join public.business_activities a on a.id=r.activity_id
    where s.stage='awaiting_assessment' and r.record_state='current' and a.record_state='current' and a.deleted_at is null and a.kind in ('assessment_1v1','assessment')
      order by ref.key,coalesce(a.scheduled_at,r.created_at) desc,r.id
  ), invitations as (
    select distinct on(s.key) s.key,i.kind,i.state from listed s join public.lead_invitation_threads i on i.lead_id=s.lead_id
      where s.stage='awaiting_assessment' and i.state not in ('completed','cancelled') order by s.key,i.updated_at desc,i.id
  ), opportunity_refs as (
    select s.key,o.id from listed s join public.course_opportunities o on o.student_id=s.student_id
    union select l.key,o.id from lead_refs l join listed s using(key) join public.course_opportunities o on o.lead_id=l.id
  ), opportunities as (
    select distinct on(ref.key) ref.key,o.stage,o.opportunity_type,o.course_id,o.term_id from opportunity_refs ref
      join public.business_course_opportunities o on o.id=ref.id where o.record_state='current' order by ref.key,o.updated_at desc,o.id
  ), note_refs as (
    select s.key,f.id,f.content,f.created_at as occurred_at,1 as priority from listed s join public.business_student_follow_ups f on f.student_id=s.student_id where view_followup
    union all select c.key,c.id,c.note,c.occurred_at,0 from contacts c join listed s using(key)
      where c.visible and (s.stage in ('awaiting_first_contact','awaiting_assessment')
        or c.id=(select latest.id from latest_contacts latest where latest.key=c.key))
  ), notes as (select distinct on(key) key,content,occurred_at from note_refs where nullif(btrim(content),'') is not null order by key,occurred_at desc,priority desc,id),
  background_sources as materialized (
    select s.key,h.id from listed s join public.history_import_records h on h.student_id=s.student_id
    union select l.key,h.id from lead_refs l join listed s using(key) join public.history_import_records h on h.lead_id=l.id where l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.record_id from listed s join public.history_import_associations a on a.student_id=s.student_id
    union select l.key,l.source_record_id from lead_refs l join listed s using(key) where l.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select l.key,c.source_record_id from lead_refs l join listed s using(key) join public.lead_communications c on c.lead_id=l.id where c.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select s.key,r.source_record_id from listed s join public.activity_registrations r on r.student_id=s.student_id where r.source_record_id is not null
    union select l.key,r.source_record_id from lead_refs l join listed s using(key) join public.activity_registrations r on r.lead_id=l.id where r.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select s.key,a.source_record_id from listed s join public.assessment_results a on a.student_id=s.student_id where a.source_record_id is not null
    union select l.key,a.source_record_id from lead_refs l join listed s using(key) join public.assessment_results a on a.lead_id=l.id where a.source_record_id is not null and (l.visible or s.stage not in ('awaiting_first_contact','awaiting_assessment'))
    union select s.key,e.source_record_id from listed s join public.course_enrollments e on e.student_id=s.student_id where e.source_record_id is not null
  ), source_fields as materialized (
    select h.id,h.record_data->>'tableName' as table_name,public.business_source_is_current(h.id) as current_source,f.fields
      from public.history_import_records h join (select distinct id from background_sources) ref on ref.id=h.id
      cross join lateral (select jsonb_object_agg(c->>'fieldName',btrim(c->>'text')) as fields from jsonb_array_elements(h.record_data->'cells') c
        where c->>'fieldName' in ('学服老师','确认人员','学科老师','报名服务老师','授课学科老师','班型') and nullif(btrim(c->>'text'),'') is not null) f
      where h.source_data->>'format'='feishu-base'
  ), source_names as materialized (
    select ref.key,h.id,h.table_name,h.current_source,coalesce(h.fields->>'报名服务老师',h.fields->>'学服老师',h.fields->>'确认人员') as owner_name,
      coalesce(h.fields->>'授课学科老师',h.fields->>'学科老师') as teacher_name,h.fields->>'班型' as class_band,
      case when s.stage='awaiting_renewal' and h.table_name='2026秋季在读学员表格' then 0
        when h.id=case when s.stage='awaiting_assessment' then s.contact_source_id else s.preferred_source_id end then 1 when h.current_source then 2 else 3 end as priority
      from background_sources ref join source_fields h on h.id=ref.id join listed s using(key)
  ), source_owners as (select distinct on(key) key,owner_name from source_names where owner_name is not null order by key,priority,id),
  source_teachers as (select distinct on(key) key,teacher_name from source_names where teacher_name is not null order by key,priority,id),
  source_bands as (select distinct on(key) key,class_band from source_names where class_band is not null and table_name='2026秋季在读学员表格' order by key,current_source desc,id),
  class_facts as (
    select m.key,string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='primary_teacher') as teacher_name,
      string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='learning_support') as owner_name,
      string_agg(distinct (regexp_match(c.name,'(?:春季|暑期|暑假|秋季|寒假)(X[+＋]|G[+＋]|A[+＋]?|S|C|培优|基础)(?:[|｜班]|$)'))[1],'、') as class_band
      from memberships m join listed s using(key) join public.classrooms c on c.id=m.classroom_id
      left join public.classroom_staff_assignments a on a.classroom_id=c.id left join public.profiles p on p.id=a.user_id
      where m.active and c.archived_at is null and c.trashed_at is null group by m.key
  ), background_assessment_refs as materialized (
    select s.key,a.id from listed s join completed_assessments a on a.student_id=s.student_id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.id from listed s join completed_assessments a on a.registration_student_id=s.student_id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select l.key,a.id from lead_refs l join listed s using(key) join completed_assessments a on a.lead_id=l.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select l.key,a.id from lead_refs l join listed s using(key) join completed_assessments a on a.registration_lead_id=l.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.id from background_sources s join completed_assessments a on a.source_record_id=s.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
    union select s.key,a.id from background_sources s join completed_assessments a on a.registration_source_id=s.id where p_stage not in ('awaiting_first_contact','awaiting_assessment')
  ), background_assessments as (
    select distinct on(ref.key) ref.key,a.* from background_assessment_refs ref join completed_assessments a on a.id=ref.id
      where a.activity_id is not null and a.deleted_at is null order by ref.key,a.assessed_on desc nulls last,a.updated_at desc,a.id
  ), candidate_counts as (
    select s.key,count(distinct ic.record_id)::integer as count from listed s join public.history_import_identity_candidates ic on ic.student_id=s.student_id
      join public.history_import_records h on h.id=ic.record_id join completed_assessments a on a.source_record_id=ic.record_id
      where p_stage not in ('awaiting_first_contact','awaiting_assessment') and h.source_data->>'format'='feishu-base'
        and not exists(select 1 from background_sources r where r.key=s.key and r.id=ic.record_id) group by s.key
  ), inferred as (
    select r.key,jsonb_agg(a.record_id) as ids from background_sources r join public.history_import_associations a on a.record_id=r.id and a.match_state='inferred'
      where p_stage not in ('awaiting_first_contact','awaiting_assessment') group by r.key
  ), backgrounds as (
    select s.key,coalesce(cf.owner_name,so.owner_name) as owner_name,
      coalesce(case when s.stage='awaiting_renewal' then cf.teacher_name end,st.teacher_name,ap.display_name) as teacher_name,
      case when a.id is not null then 'assessment' when s.stage='awaiting_renewal' and coalesce(cf.class_band,sb.class_band) is not null then 'class_band' end as source,
      case when a.id is not null then public.student_learning_band(a.assessment_band)
        when s.stage='awaiting_renewal' then public.student_learning_band(coalesce(cf.class_band,sb.class_band)) end as band,
      a.score,a.assessed_on,a.id as assessment_id,case when a.learning_band='未达A' then 'X+' else a.learning_band end as learning_band,
      case when a.id is null and s.stage='awaiting_renewal' then coalesce(cf.class_band,sb.class_band,'') else '' end as class_band
    from listed s left join class_facts cf using(key) left join source_owners so using(key) left join source_teachers st using(key)
      left join source_bands sb using(key) left join background_assessments a using(key) left join public.profiles ap on ap.id=a.assessed_by
  ), teacher_ids as (select display_name,case when count(*)=1 then (array_agg(id))[1] end as id from public.profiles
    where is_active and role in ('staff','admin') group by display_name),
  rows as (
    select s.stage,s.created_at,s.key,jsonb_build_object(
      'key',s.key,'studentId',s.student_id,'leadId',s.lead_id,'name',coalesce(st.name,l.provisional_student_name),
      'phone',coalesce(nullif(st.parent_phone,''),nullif(st.phone,''),l.phone,''),'grade',coalesce(st.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),
      'ownerId',coalesce(st.assigned_to,l.owner_id),'ownerName',coalesce(p.display_name,b.owner_name,''),'teacherId',ti.id,'teacherName',coalesce(b.teacher_name,''),
      'stage',s.stage,'detail',case s.stage when 'awaiting_first_contact' then public.student_first_contact_detail(coalesce(st.assigned_to,l.owner_id),coalesce(p.display_name,b.owner_name),l.status,lc.outcome)
        when 'awaiting_assessment' then case when i.kind='assessment_1v1' and i.state='confirmed' then 'booked' when i.kind='assessment_1v1' then 'coordinating'
          when a.status='no_show' then 'no_show' when a.status='cancelled' then 'cancelled' when a.assessment_started_at is not null then 'in_progress' when a.status='attended' then 'attended_without_result'
          when a.status='booked' then 'booked' when exists(select 1 from attendance_flags reached where reached.key=s.key) then 'attended_without_result' else 'not_booked' end
        when 'awaiting_enrollment' then case o.stage when 'committed' then 'ready_to_enroll' when 'not_enrolled' then 'not_enrolling'
          when 'considering' then 'considering' when 'payment_pending' then 'payment_pending' when 'nurturing' then 'nurturing' else coalesce(w.classification,'assessed') end
        when 'awaiting_renewal' then case when o.opportunity_type='renewal' and o.stage='not_enrolled' then 'not_renewing'
          when o.opportunity_type='renewal' and o.stage='considering' then 'renewal_considering' when o.opportunity_type='renewal' and o.stage='committed' then 'renewal_committed'
          when o.opportunity_type='renewal' and o.stage='enrolled' then 'renewal_confirmed' when s.membership then 'attending' else 'awaiting_class' end
        else case when e.status='cancelled' then 'withdrawn' else 'ended' end end,
      'note',case when view_followup then coalesce(n.content,'') else '' end,
      'lastContactAt',case when view_followup then case when s.stage in ('awaiting_first_contact','awaiting_assessment') then coalesce(n.occurred_at,lc.occurred_at) else n.occurred_at end end,
      'nextContactAt',null,'invitation',null,'detailLoaded',false,
      'score',case when b.source is not null then b.score else ca.score end,
      'assessmentBand',case when b.source is not null then b.band else ca.assessment_band end,
      'assessmentAt',case when b.source is not null then to_jsonb(b.assessed_on) else to_jsonb(ca.completed_at) end,
      'assessmentSource',b.source,'assessmentRecordId',b.assessment_id,'learningBand',b.learning_band,'classBandLabel',b.class_band,
      'assessmentCandidateCount',coalesce(cc.count,0),'inferredSourceIds',coalesce(inf.ids,'[]'::jsonb),'registrationId',s.registration_id,
      'courseId',coalesce(e.course_id,o.course_id),'termId',coalesce(e.term_id,o.term_id),'courseTitle',coalesce(ec.title,oc.title,''),'termName',coalesce(et.name,ot.name,''),
      'createdAt',s.created_at) as payload
    from listed s left join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id
      left join public.profiles p on p.id=coalesce(st.assigned_to,l.owner_id) left join backgrounds b using(key) left join teacher_ids ti on ti.display_name=b.teacher_name
      left join latest_contacts lc using(key) left join notes n using(key) left join latest_enrollments e using(key) left join opportunities o using(key)
      left join appointments a using(key) left join invitations i using(key) left join latest_assessments ca using(key)
      left join public.assessment_workflow_states w on w.registration_id=s.registration_id
      left join public.courses ec on ec.id=e.course_id left join public.courses oc on oc.id=o.course_id
      left join public.school_terms et on et.id=e.term_id left join public.school_terms ot on ot.id=o.term_id
      left join candidate_counts cc using(key) left join inferred inf using(key)
  ) select public.school_list_apply_collaboration(r.payload||coalesce(source_status.status,'{}'::jsonb)||case when p_subjects is not null then
      jsonb_build_object('phone',w.w->'phone','lastContactAt',w.w->'last_contact_at')||
      case when r.stage in ('awaiting_first_contact','awaiting_assessment') then
        jsonb_build_object('teacherId',null,'teacherName','','courseId',null,'termId',null,'courseTitle','','termName','','assessmentBand',null,'assessmentAt',null)
        else '{}'::jsonb end else '{}'::jsonb end,c.projection),r.stage from rows r left join wanted w on w.key=r.key
    left join public.school_source_statuses(coalesce((select jsonb_agg(payload) from rows),'[]'::jsonb)) source_status on source_status.key=r.key
    join public.school_list_collaboration(coalesce((select jsonb_agg(jsonb_build_object('key',payload->>'key','student_id',payload->>'studentId','lead_id',payload->>'leadId')) from rows),'[]'::jsonb),actor) c on c.key=r.key
    union all select null::jsonb,s.stage from stages s where p_subjects is null and not (coalesce(p_search,'')<>'' or s.stage=p_stage);
end;
$function$;

CREATE OR REPLACE FUNCTION public.read_student_record_with_enrollments(p_student_id uuid, p_lead_id uuid, p_enrollments business_course_enrollment_subjects[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_variable
declare
  actor uuid := auth.uid();
  student public.students%rowtype;
  lead public.leads%rowtype;
  lead_ids uuid[];
  visible_lead_ids uuid[];
  contact record;
  assessment record;
  appointment record;
  invitation public.lead_invitation_threads%rowtype;
  enrollment record;
  opportunity record;
  latest_note record;
  has_enrollment boolean;
  has_active_enrollment boolean;
  has_source_enrollment boolean;
  has_current_source_enrollment boolean;
  has_contact boolean;
  has_attendance boolean;
  has_assessment boolean;
  has_membership boolean;
  stage text;
  detail text;
  owner_id uuid;
  owner_name text;
  next_at timestamptz;
  can_followup boolean;
  today date;
  background jsonb;
  subject_source_ids text[];
  subject_registration_ids uuid[];
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  today:=(now() at time zone public.get_organization_timezone_v2())::date;
  if p_student_id is not null then
    select * into student from public.students s where s.id=p_student_id and s.deleted_at is null;
    if student.id is null or not public.can_view_school_student(student.id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
  end if;
  if p_lead_id is not null then
    select * into lead from public.leads l where l.id=p_lead_id;
    if lead.id is null then raise exception 'NOT_FOUND'; end if;
    if p_student_id is not null and lead.student_id is distinct from p_student_id then raise exception 'SUBJECT_MISMATCH'; end if;
    if not (public.has_perm(actor,'followup.view') and
      public.can_view_school_lead(lead.id,actor)) then raise exception 'FORBIDDEN_SCOPE'; end if;
    if student.id is null and lead.student_id is not null then
      select * into student from public.students s where s.id=lead.student_id and s.deleted_at is null;
      if student.id is null or not public.can_view_school_student(student.id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    end if;
  elsif student.id is not null and public.has_perm(actor,'followup.view') then
    select * into lead from public.leads l where l.student_id=student.id
      and public.can_view_school_lead(l.id,actor)
      order by (l.status not in ('invalid','converted')) desc, l.created_at desc, l.id limit 1;
  end if;
  if student.id is null and lead.id is null then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(l.id),'{}'::uuid[]) into lead_ids from public.leads l
    where l.id=lead.id or (student.id is not null and l.student_id=student.id);
  select coalesce(array_agg(l.id),'{}'::uuid[]) into visible_lead_ids from public.leads l
    where l.id=any(lead_ids) and public.has_perm(actor,'followup.view')
      and public.can_view_school_lead(l.id,actor);
  -- 以稳定身份与来源索引读取此人的全部经历；在读和待办继续采用实际有效事实。
  select coalesce(array_agg(distinct h.id),'{}'::text[]) into subject_source_ids from public.history_import_records h
    where h.lead_id=any(lead_ids) or h.id=any(array(select l.source_record_id from public.leads l where l.id=any(lead_ids)));
  select coalesce(array_agg(r.id),'{}'::uuid[]) into subject_registration_ids from public.activity_registrations r
    where r.student_id=student.id or r.lead_id=any(lead_ids) or r.source_record_id=any(subject_source_ids);
  select exists(select 1 from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
    where r.id=any(subject_registration_ids) and r.status='attended' and a.deleted_at is null) into has_attendance;
  owner_id := coalesce(student.assigned_to,lead.owner_id);
  select display_name into owner_name from public.profiles where id=owner_id;
  can_followup := public.has_perm(actor,'followup.view');

  select c.*, coalesce(r.effective_patch->>'outcome',c.outcome) as effective_outcome,
    coalesce(r.effective_patch->>'note',c.note) as effective_note into contact
    from public.business_lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.lead_id=any(visible_lead_ids)
    order by c.occurred_at desc nulls last,public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) desc,c.id limit 1;
  select exists(select 1 from public.business_lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.lead_id=any(lead_ids)
      and public.school_contact_is_effective(to_jsonb(c),r.effective_patch)) into has_contact;
  has_contact:=has_contact or exists(select 1 from public.school_other_contact_subjects() x where x.key=coalesce('student:'||student.id,'lead:'||lead.id));

  select exists(select 1 from public.business_activity_registrations r
      where r.id=any(subject_registration_ids)
        and false /* 到访表报名由独立正式报名和入班事实交叉验证 */),
    exists(select 1 from public.business_activity_registrations r
      where r.id=any(subject_registration_ids) and r.record_state='current'
        and false /* 到访表报名由独立正式报名和入班事实交叉验证 */)
    into has_source_enrollment,has_current_source_enrollment;
  select exists(select 1 from unnest(p_enrollments) e where (e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) or e.source_record_id=any(subject_source_ids)))
      or exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id left join public.school_terms t on t.id=c.term_id
        where e.student_id=student.id)
      or has_source_enrollment,
    exists(select 1 from unnest(p_enrollments) e left join public.school_terms t on t.id=e.term_id
      where (e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) or e.source_record_id=any(subject_source_ids)) and e.status='active' and e.record_state='current'
        and (t.ends_on is null or t.ends_on >= today))
      or exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
        left join public.school_terms t on t.id=c.term_id
        where e.student_id=student.id and e.status='active' and e.left_at is null
          and (t.ends_on is null or t.ends_on >= today))
      or (has_current_source_enrollment and not exists(select 1 from unnest(p_enrollments) e where (e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) or e.source_record_id=any(subject_source_ids)) and e.record_state='current'))
    into has_enrollment,has_active_enrollment;
  select exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
    left join public.school_terms t on t.id=c.term_id
    where e.student_id=student.id and e.status='active' and e.left_at is null
      and (t.ends_on is null or t.ends_on >= today)) into has_membership;

  -- 空记录和未到场均不代表测评完成；专业结果仍采用现有定稿事实。
  select a.score,a.assessment_band,a.teacher_recommendation,a.source_record_id,r.id as registration_id,
    coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) as completed_at into assessment
    from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
    where r.id=any(subject_registration_ids) and public.student_assessment_is_complete(r.status,r.assessment_completed_at,a.result_finalized_at,
        a.result_source,a.score,a.assessment_band,a.strengths,
        concat_ws(E'\n',a.strengths,a.focus_areas,a.parent_concerns,a.teacher_recommendation,a.teacher_observation))
    order by coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id limit 1;
  has_assessment := assessment.registration_id is not null or exists(select 1 from public.school_source_completed_assessments() x where x.key=coalesce('student:'||student.id,'lead:'||lead.id));
  select r.id,r.status,r.assessment_started_at,a.scheduled_at into appointment
    from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
    where r.id=any(subject_registration_ids) and r.record_state='current' and a.record_state='current' and a.deleted_at is null
      and a.kind in ('assessment_1v1','assessment')
    order by coalesce(a.scheduled_at,r.created_at) desc,r.id limit 1;
  select * into invitation from public.lead_invitation_threads i
    where i.lead_id=lead.id and i.state not in ('completed','cancelled')
    order by i.updated_at desc,i.id limit 1;
  select e.id,e.status,c.title,t.name as term_name,e.course_id,e.term_id into enrollment
    from unnest(p_enrollments) e left join public.courses c on c.id=e.course_id left join public.school_terms t on t.id=e.term_id
    where (e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) or e.source_record_id=any(subject_source_ids)) order by (e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id limit 1;
  select o.id,o.stage,o.opportunity_type,c.title,t.name as term_name,o.course_id,o.term_id into opportunity
    from public.business_course_opportunities o left join public.courses c on c.id=o.course_id left join public.school_terms t on t.id=o.term_id
    where (o.student_id=student.id or o.lead_id=any(lead_ids)) and o.record_state='current'
    order by o.updated_at desc,o.id limit 1;

  stage := case when has_active_enrollment then 'awaiting_renewal'
    when has_enrollment then 'former_student' when has_assessment then 'awaiting_enrollment'
    when has_contact or has_attendance then 'awaiting_assessment' else 'awaiting_first_contact' end;
  detail := case stage
    when 'awaiting_first_contact' then case when lead.status='invalid' then 'invalid_number'
      when owner_id is null then 'unassigned' when contact.effective_outcome='unreachable' then 'unreachable' else 'not_contacted' end
    when 'awaiting_assessment' then case
      when invitation.kind='assessment_1v1' and invitation.state='confirmed' then 'booked'
      when invitation.kind='assessment_1v1' then 'coordinating'
      when appointment.status='no_show' then 'no_show' when appointment.status='cancelled' then 'cancelled'
      when appointment.assessment_started_at is not null then 'in_progress' when appointment.status='attended' then 'attended_without_result'
      when appointment.status='booked' then 'booked' when has_attendance then 'attended_without_result' else 'not_booked' end
    when 'awaiting_enrollment' then 'assessed'
    when 'awaiting_renewal' then case when has_membership then 'attending' else 'awaiting_class' end
    else case when enrollment.status='cancelled' then 'withdrawn' else 'ended' end end;
  if stage='awaiting_enrollment' then
    select coalesce(w.classification,'assessed') into detail from public.assessment_workflow_states w
      where w.registration_id=assessment.registration_id;
    detail := coalesce(detail,'assessed');
    if opportunity.id is not null and opportunity.stage<>'enrolled' then
      detail:=case opportunity.stage when 'committed' then 'ready_to_enroll' when 'not_enrolled' then 'not_enrolling'
        when 'considering' then 'considering' when 'payment_pending' then 'payment_pending' when 'nurturing' then 'nurturing' else detail end;
    end if;
  elsif stage='awaiting_renewal' and opportunity.opportunity_type='renewal' then
    detail:=case opportunity.stage when 'not_enrolled' then 'not_renewing' when 'considering' then 'renewal_considering'
      when 'committed' then 'renewal_committed' when 'enrolled' then 'renewal_confirmed' else detail end;
  end if;

  select n.content,n.occurred_at into latest_note from (
    select f.content,f.created_at as occurred_at,f.id,1 as priority from public.business_student_follow_ups f
      where f.student_id=student.id
    union all select contact.effective_note,contact.occurred_at,contact.id,0 where contact.id is not null
  ) n where nullif(trim(n.content),'') is not null order by n.occurred_at desc,n.priority desc,n.id limit 1;
  select min(a.due_at) into next_at from public.lead_next_actions a
    where a.lead_id=any(visible_lead_ids) and a.status='open' and a.kind<>'initial_contact';
  next_at := least(student.next_follow_up_at,next_at);
  background:=public.student_stage_learning_background(student.id,lead.id,stage,
    case when stage='awaiting_assessment' then contact.source_record_id else assessment.source_record_id end);
  return public.school_collaboration_row(jsonb_build_object(
    'statusEvidence',public.school_record_status_evidence(student.id,lead.id),
    'key',case when student.id is not null then 'student:'||student.id else 'lead:'||lead.id end,
    'studentId',student.id,'leadId',lead.id,'name',coalesce(student.name,lead.provisional_student_name),
    'phone',coalesce(nullif(student.parent_phone,''),nullif(student.phone,''),lead.phone,''),
    'grade',coalesce(student.grade,lead.grade_hint),'gradeText',coalesce(lead.grade_text,''),
    'ownerId',owner_id,'ownerName',coalesce(owner_name,background->>'ownerName',''),'stage',stage,'detail',case when stage='awaiting_first_contact' then public.student_first_contact_detail(owner_id,coalesce(owner_name,background->>'ownerName'),lead.status,contact.effective_outcome) else detail end,
    'note',case when can_followup then coalesce(latest_note.content,'') else '' end,
    'lastContactAt',case when can_followup then latest_note.occurred_at else null end,
    'nextContactAt',case when can_followup then next_at else null end,
    'score',assessment.score,'assessmentBand',assessment.assessment_band,'assessmentAt',assessment.completed_at,
    'registrationId',assessment.registration_id,'courseTitle',coalesce(enrollment.title,opportunity.title,''),'termName',coalesce(enrollment.term_name,opportunity.term_name,''),
    'courseId',coalesce(enrollment.course_id,opportunity.course_id),'termId',coalesce(enrollment.term_id,opportunity.term_id),
    'createdAt',coalesce(student.created_at,lead.created_at),
    'canWrite',public.has_perm(actor,'followup.write') and
      ((student.id is not null and public.can_access_student(student.id,actor))
        or (lead.id is not null and public.can_edit_school_lead(lead.id,actor))),
    'canContact',public.has_perm(actor,'followup.write') and
      ((lead.id is not null and lead.status not in ('invalid','converted')
        and public.can_edit_school_lead(lead.id,actor))
        or (lead.id is null and student.id is not null and public.can_access_student(student.id,actor))),
    'invitation',case when can_followup and invitation.id is not null then jsonb_build_object(
      'id',invitation.id,'leadId',invitation.lead_id,'kind',invitation.kind,'state',invitation.state,
      'assessmentSlotId',invitation.assessment_slot_id,'activityId',invitation.activity_id,'assessorId',invitation.assessor_id,'parentTimeOptions',invitation.parent_time_options,
      'assessorTimeOptions',invitation.assessor_time_options,'scheduledAt',invitation.scheduled_at,
      'locationText',invitation.location_text,'nextContactAt',next_at,'updatedAt',invitation.updated_at)
      else null end) || (background - 'ownerName' - 'score' - 'assessmentBand' - 'assessmentAt')
    || case when background->>'assessmentSource' is not null then jsonb_build_object(
      'score',background->'score','assessmentBand',background->'assessmentBand','assessmentAt',background->'assessmentAt') else '{}'::jsonb end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_record_list_rows(p_subjects jsonb, p_enrollments business_course_enrollment_subjects[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare actor uuid:=auth.uid(); view_followup boolean:=public.has_perm(auth.uid(),'followup.view');
  write_followup boolean:=public.has_perm(auth.uid(),'followup.write'); view_all boolean:=public.has_perm(auth.uid(),'student.view.all'); result jsonb;
begin
  if actor is null or not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  with subjects as materialized (select * from jsonb_to_recordset(p_subjects)
    as s(student_id uuid,lead_id uuid,key text,stage text,detail text,created_at timestamptz)),
  lead_refs as materialized (select l.id,s.key from public.leads l join subjects s on
    l.id=s.lead_id or s.student_id is not null and l.student_id=s.student_id
    where view_followup and case when view_all or l.owner_id is null or l.owner_id=actor then true else public.can_view_school_lead(l.id,actor) end),
  contacts as materialized (select ref.key,c.id,c.source_record_id,c.occurred_at,coalesce(r.effective_patch->>'note',c.note) as note,coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,public.school_contact_is_effective(to_jsonb(c),r.effective_patch) as effective_contact,public.school_contact_sort_key(c.occurred_at,c.occurred_on,c.source_metric_facts,c.source_key) as contact_order
    from public.business_lead_communications c join lead_refs ref on ref.id=c.lead_id
    left join lateral (select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by r.revision_no desc limit 1) r on true),
  recent_contact as (select distinct on(key) key,source_record_id,occurred_at,outcome from contacts order by key,occurred_at desc nulls last,contact_order desc,id),
  source_refs as materialized (
    select s.key,h.id from subjects s join public.history_import_records h on h.student_id=s.student_id
    union select l.key,h.id from lead_refs l join public.history_import_records h on h.lead_id=l.id
    union select s.key,a.record_id from subjects s join public.history_import_associations a on a.student_id=s.student_id
    union select ref.key,l.source_record_id from lead_refs ref join public.leads l on l.id=ref.id
    union select ref.key,c.source_record_id from lead_refs ref join public.lead_communications c on c.lead_id=ref.id
    union select s.key,r.source_record_id from subjects s join public.activity_registrations r on r.student_id=s.student_id
    union select ref.key,r.source_record_id from lead_refs ref join public.activity_registrations r on r.lead_id=ref.id
    union select s.key,a.source_record_id from subjects s join public.assessment_results a on a.student_id=s.student_id
    union select ref.key,a.source_record_id from lead_refs ref join public.assessment_results a on a.lead_id=ref.id
    union select s.key,e.source_record_id from subjects s join public.course_enrollments e on e.student_id=s.student_id
  ), source_names as materialized (
    select h.id,public.business_source_is_current(h.id) as current_source,
      coalesce(f.fields->>'报名服务老师',f.fields->>'学服老师',f.fields->>'确认人员') as owner_name
    from public.history_import_records h cross join lateral (
      select jsonb_object_agg(c->>'fieldName',btrim(c->>'text')) as fields from jsonb_array_elements(h.record_data->'cells') c
      where c->>'fieldName' in ('报名服务老师','学服老师','确认人员') and nullif(btrim(c->>'text'),'') is not null
    ) f where h.source_data->>'format'='feishu-base' and exists(select 1 from source_refs ref where ref.id=h.id)
  ), source_owners as (
    select distinct on(ref.key) ref.key,n.owner_name from source_refs ref join source_names n on n.id=ref.id
      join subjects s on s.key=ref.key left join recent_contact c on c.key=ref.key where n.owner_name is not null
      order by ref.key,case when s.stage='awaiting_assessment' and c.source_record_id=ref.id then 1 when n.current_source then 2 else 3 end,ref.id
  ),
  notes as (select s.key,f.id,f.content,f.created_at as occurred_at,1 as priority
      from public.business_student_follow_ups f join subjects s on s.student_id=f.student_id where view_followup
    union all select key,id,note,occurred_at,0 from contacts),
  recent_note as (select distinct on(key) key,content,occurred_at from notes where nullif(btrim(content),'') is not null
    order by key,occurred_at desc,priority desc,id),
  reminders as (select ref.key,min(a.due_at) as due_at from public.lead_next_actions a join lead_refs ref on ref.id=a.lead_id
    where a.status='open' and a.kind<>'initial_contact' group by ref.key)
  select coalesce(jsonb_agg(case when s.stage not in ('awaiting_first_contact','awaiting_assessment')
      or exists(select 1 from public.lead_invitation_threads i where i.lead_id=s.lead_id and i.state not in ('completed','cancelled')) then
      public.read_student_record_with_enrollments(s.student_id,s.lead_id,p_enrollments)
    else jsonb_build_object(
      'statusEvidence',public.school_record_status_evidence(s.student_id,s.lead_id),
      'key',s.key,'studentId',s.student_id,'leadId',s.lead_id,'name',coalesce(st.name,l.provisional_student_name),
      'phone',coalesce(nullif(st.parent_phone,''),nullif(st.phone,''),l.phone,''),'grade',coalesce(st.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),
      'ownerId',coalesce(st.assigned_to,l.owner_id),'ownerName',coalesce(p.display_name,so.owner_name,''),'stage',s.stage,'detail',case when s.stage='awaiting_first_contact' then public.student_first_contact_detail(coalesce(st.assigned_to,l.owner_id),coalesce(p.display_name,so.owner_name),l.status,c.outcome) else s.detail end,
      'note',coalesce(n.content,''),'lastContactAt',coalesce(n.occurred_at,c.occurred_at),
      'nextContactAt',case when view_followup then least(st.next_follow_up_at,a.due_at) else null end,
      'score',null,'assessmentBand',null,'assessmentAt',null,'registrationId',null,
      'courseTitle','','termName','','courseId',null,'termId',null,'createdAt',s.created_at,
      'canWrite',write_followup and ((s.student_id is not null and case when view_all then true else public.can_access_student(s.student_id,actor) end)
        or (l.id is not null and case when view_all or l.owner_id=actor then true else public.can_edit_school_lead(l.id,actor) end)),
      'canContact',write_followup and ((l.id is not null and l.status not in ('invalid','converted') and case when view_all or l.owner_id=actor then true else public.can_edit_school_lead(l.id,actor) end)
        or (l.id is null and st.id is not null and case when view_all then true else public.can_access_student(st.id,actor) end)),
      'invitation',null)
    end order by s.created_at desc,s.key),'[]'::jsonb) into result
    from subjects s left join public.students st on st.id=s.student_id left join public.leads l on l.id=s.lead_id
    left join public.profiles p on p.id=coalesce(st.assigned_to,l.owner_id)
    left join recent_note n on n.key=s.key left join recent_contact c on c.key=s.key left join reminders a on a.key=s.key
    left join source_owners so on so.key=s.key;
  return (select coalesce(jsonb_agg(public.school_list_apply_collaboration(r.value,c.projection) order by r.ordinal),'[]'::jsonb)
    from jsonb_array_elements(result) with ordinality r(value,ordinal)
    join public.school_list_collaboration(coalesce((select jsonb_agg(jsonb_build_object('key',v->>'key','student_id',v->>'studentId','lead_id',v->>'leadId')) from jsonb_array_elements(result) v),'[]'::jsonb),actor) c on c.key=r.value->>'key');
end;
$function$;

create function public.school_communication_page(
  p_stage text default 'awaiting_assessment', p_scope text default 'mine', p_search text default '',
  p_group text default '', p_marker text default '', p_page integer default 1, p_page_size integer default 50,
  p_period_field text default '', p_period text default '', p_subjects text[] default null
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
set plan_cache_mode=force_custom_plan as $$
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
  ), entries as materialized (
    select v.*,coalesce(w.logical_key,v.key) as logical_key,w.kind,
      coalesce(w.group_label,'未分组') as group_label,coalesce(w.subgroup_label,'') as subgroup_label,
      coalesce(w.group_rank,1000000) as group_rank,coalesce(w.source_rank,1000000) as source_rank,
      coalesce(w.markers,'[]'::jsonb) as markers,coalesce(w.context,'[]'::jsonb) as context,
      coalesce(w.periods,'{}'::jsonb) as periods,coalesce(w.period_defaults,'{}'::jsonb) as period_defaults,
      coalesce(w.group_label,'未分组')||' / '||coalesce(w.subgroup_label,'') as group_key
    from visible v left join lateral (
      select w.* from public.school_source_worklist_entries w left join public.leads l on l.id=w.lead_id
      where v.key=coalesce('student:'||coalesce(l.student_id,w.student_id),'lead:'||w.lead_id)
      order by case when w.kind=case v.stage when 'awaiting_first_contact' then 'acquisition' when 'awaiting_assessment' then 'acquisition' when 'awaiting_enrollment' then 'assessment' else 'service' end then 0 else 1 end,
        w.group_rank,w.source_rank,w.logical_key limit 1
    ) w on true
  ), task_entries as materialized (
    select *,coalesce(nullif(periods->>period_field,''),'unknown') as period
    from entries where stage=p_stage and (p_subjects is null or key=any(p_subjects))
  ), defaults as (
    select coalesce(max(period_defaults->>'month'),'12月') as preferred,max(period_defaults->>'group') as preferred_group from task_entries
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
    select * from filtered order by period_rank desc,group_rank,source_rank,logical_key
      offset (least(p_page,greatest(1,(select ceil(n::numeric/p_page_size)::integer from totals)))-1)*p_page_size limit p_page_size
  ), details as materialized (
    select r from jsonb_array_elements(public.student_record_list_rows(
      coalesce((select jsonb_agg(jsonb_build_object('key',key,'student_id',student_id,'lead_id',lead_id,
        'stage',stage,'detail',detail,'created_at',created_at)) from selected),'[]'::jsonb),facts)) r
  ) select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(d.r||jsonb_build_object('worklist',jsonb_build_object(
      'id',s.logical_key,'group',s.group_label,'subgroup',s.subgroup_label,'groupKey',s.group_key,
      'rank',s.source_rank,'markers',s.markers,'context',s.context,'period',s.period,'periods',s.periods))
      order by s.period_rank desc,s.group_rank,s.source_rank,s.logical_key)
      from selected s join details d on d.r->>'key'=s.key),'[]'::jsonb),
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
$$;
revoke all on function public.school_communication_page(text,text,text,text,text,integer,integer,text,text,text[]) from public,anon;
grant execute on function public.school_communication_page(text,text,text,text,text,integer,integer,text,text,text[]) to authenticated;
notify pgrst,'reload schema';
