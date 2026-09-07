-- 当前工作采用本期业务依据；历史事实和原始身份完整保留。
alter table public.history_workflow_scopes drop constraint history_workflow_scopes_reason_check;
alter table public.history_workflow_scopes add constraint history_workflow_scopes_reason_check
  check (reason in ('reference_only','processed_prior_period','history_review_required'));

-- 同一来源行可以同时包含本期跟进和以前发生的业务，各事实独立限定工作范围。
create table public.history_business_workflow_scopes (
  relation text not null check (relation in ('activities','activity_registrations','assessment_results','course_enrollments','course_opportunities','student_follow_ups','lead_communications')),
  record_id uuid not null,
  source_record_id text not null references public.history_import_records(id),
  reason text not null check (reason='history_review_required'),
  reviewed_at timestamptz not null default now(),
  primary key(relation,record_id)
);
alter table public.history_business_workflow_scopes enable row level security;
revoke all on public.history_business_workflow_scopes from public,anon,authenticated;
create function public.business_fact_is_current(p_relation text,p_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from public.history_business_workflow_scopes s where s.relation=p_relation and s.record_id=p_id);
$$;
revoke all on function public.business_fact_is_current(text,uuid) from public,anon;
grant execute on function public.business_fact_is_current(text,uuid) to authenticated,service_role;

do $views$
declare relation text; columns text;
begin
  foreach relation in array array['lead_communications','activities','activity_registrations','assessment_results',
    'course_enrollments','course_opportunities','student_follow_ups'] loop
    select string_agg(case when a.attname='record_state' then
      format('case when public.business_source_is_current(r.source_record_id) and public.business_fact_is_current(%L,r.id) then r.record_state else ''historical''::text end as record_state',relation)
      else format('r.%I',a.attname) end,',' order by a.attnum) into columns
      from pg_attribute a where a.attrelid=('public.'||relation)::regclass and a.attnum>0 and not a.attisdropped;
    execute format('create or replace view public.%I with (security_invoker=true) as select %s from public.%I r where public.business_source_is_authoritative(r.source_record_id)',
      'business_'||relation,columns,relation);
  end loop;
end;
$views$;

-- 办理动作复用当前范围检查，历史修订继续使用独立的修订接口。
create or replace function public.require_current_business_record(p_relation text,p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare state text; parent_id uuid;
begin
  if p_relation not in ('activities','activity_registrations','assessment_results','course_opportunities','course_enrollments','course_enrollment_assignments','student_follow_ups') then raise exception 'VALIDATION';end if;
  if p_id is null then return;end if;
  if p_relation='course_enrollment_assignments' then
    select e.record_state into state from public.course_enrollment_assignments a join public.business_course_enrollments e on e.id=a.course_enrollment_id where a.id=p_id;
  else
    execute format('select record_state from public.%I where id=$1','business_'||p_relation) into state using p_id;
  end if;
  if state is null then raise exception 'NOT_FOUND';end if;
  if state<>'current' then raise exception 'HISTORICAL_RECORD_READ_ONLY';end if;
  if p_relation='activity_registrations' then
    select activity_id into parent_id from public.activity_registrations where id=p_id;
    perform public.require_current_business_record('activities',parent_id);
  elsif p_relation='assessment_results' then
    select activity_registration_id into parent_id from public.assessment_results where id=p_id;
    perform public.require_current_business_record('activity_registrations',parent_id);
  end if;
end;
$$;

create or replace function public.resume_history_workflow_subject()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare payload jsonb:=to_jsonb(new); v_student_id uuid; v_lead_id uuid; event_date text;
begin
  if payload->>'source_record_id' is not null or payload->>'record_state'='historical' then return new;end if;
  if tg_table_name='lead_next_actions' and (payload->>'status'<>'open' or payload->>'kind'='initial_contact') then return new;end if;
  if tg_table_name='enrollments' and (payload->>'status'<>'active' or payload->>'left_at' is not null) then return new;end if;
  event_date:=coalesce(payload->>'occurred_on',payload->>'occurred_at',payload->>'registered_on');
  if event_date is not null and left(event_date,7)<to_char(now() at time zone public.get_organization_timezone_v2(),'YYYY-MM') then return new;end if;
  v_student_id:=(payload->>'student_id')::uuid; v_lead_id:=(payload->>'lead_id')::uuid;
  if v_lead_id is not null then select coalesce(v_student_id,l.student_id) into v_student_id from public.leads l where l.id=v_lead_id;end if;
  update public.history_workflow_scopes s set resumed_at=clock_timestamp()
    where s.resumed_at is null and (s.student_id=v_student_id or s.lead_id=v_lead_id);
  return new;
end;
$$;


CREATE OR REPLACE FUNCTION public.student_stage_workspace_index(p_scope text, p_search text)
 RETURNS TABLE(student_id uuid, lead_id uuid, key text, stage text, detail text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); view_all boolean; view_followup boolean; today date;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  view_all:=public.has_perm(actor,'student.view.all');
  view_followup:=public.has_perm(actor,'followup.view');
  today:=(now() at time zone public.get_organization_timezone_v2())::date;
  return query with
  subjects as materialized (
    select s.id as student_id,null::uuid as lead_id,'student:'||s.id as key,s.created_at,s.assigned_to as owner_id
      from public.students s where s.deleted_at is null and public.business_subject_is_current(s.id,null) and (view_all or public.can_access_student(s.id,actor))
        and (p_scope='all' or (p_scope='mine' and s.assigned_to=actor) or (p_scope='unassigned' and s.assigned_to is null))
        and (coalesce(p_search,'')='' or s.id::text=p_search
          or position(lower(p_search) in lower(s.name||' '||s.school||' '||s.phone||' '||s.parent_phone))>0
          or (length(regexp_replace(p_search,'\D','','g'))>=3 and
            position(regexp_replace(p_search,'\D','','g') in regexp_replace(s.phone||' '||s.parent_phone,'\D','','g'))>0))
    union all
    select null,l.id,'lead:'||l.id,l.created_at,l.owner_id from public.leads l
      where l.student_id is null and public.business_subject_is_current(null,l.id) and view_followup and (l.owner_id is null or l.owner_id=actor or view_all)
        and (p_scope='all' or (p_scope='mine' and l.owner_id=actor) or (p_scope='unassigned' and l.owner_id is null))
        and (coalesce(p_search,'')='' or l.id::text=p_search
          or position(lower(p_search) in lower(l.provisional_student_name||' '||l.phone))>0
          or (length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in l.phone_normalized)>0))
  ), lead_refs as materialized (
    select l.*,coalesce('student:'||l.student_id,'lead:'||l.id) as key from public.leads l
  ), selected_leads as materialized (
    select distinct on(l.key) l.key,l.id,l.status,l.owner_id from lead_refs l
      where view_followup and (l.owner_id is null or l.owner_id=actor or view_all)
      order by l.key,(l.status not in ('invalid','converted')) desc,l.created_at desc,l.id
  ), contacts as materialized (
    select l.key,c.id,c.occurred_at,coalesce(r.effective_patch->>'outcome',c.outcome) as outcome,
      view_followup and (l.owner_id is null or l.owner_id=actor or view_all) as visible
      from public.business_lead_communications c join lead_refs l on l.id=c.lead_id
      left join lateral (select r.effective_patch from public.communication_record_revisions r
        where r.source='contact' and r.event_id=c.id order by r.revision_no desc limit 1) r on true
      where public.business_source_is_current(c.source_record_id) and public.business_fact_is_current('lead_communications',c.id)
  ), contact_flags as (select c.key from contacts c where c.outcome in ('connected','declined') group by c.key),
  latest_contacts as (select distinct on(c.key) c.key,c.outcome from contacts c where c.visible order by c.key,c.occurred_at desc,c.id),
  registration_refs as materialized (
    select 'student:'||r.student_id as key,r.id from public.business_activity_registrations r where r.student_id is not null and r.record_state='current'
    union select l.key,r.id from public.business_activity_registrations r join lead_refs l on l.id=r.lead_id where r.record_state='current'
  ), enrollment_facts as (
    select e.subject_key as key,
      e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today) as active,
      false as membership from public.business_course_enrollment_subjects e left join public.school_terms t on t.id=e.term_id where e.record_state='current'
    union all
    select 'student:'||e.student_id,
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today),
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today)
      from public.enrollments e join public.classrooms c on c.id=e.classroom_id left join public.school_terms t on t.id=c.term_id
      where e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today)
    union all
    select ref.key,r.record_state='current' and not exists(select 1 from public.business_course_enrollment_subjects e where e.subject_key=ref.key and e.record_state='current'),false
      from registration_refs ref join public.business_activity_registrations r on r.id=ref.id where r.source_enrollment_facts @> '{"confirmed":true}'::jsonb
  ), enrollment_flags as (
    select f.key,bool_or(f.active) as active,bool_or(f.membership) as membership from enrollment_facts f group by f.key
  ), latest_enrollments as (
    select distinct on(e.subject_key) e.subject_key,e.status from public.business_course_enrollment_subjects e where e.record_state='current'
      order by e.subject_key,(e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id
  ), assessments as materialized (
    select distinct on(ref.key) ref.key,r.id as registration_id
      from registration_refs ref join public.business_activity_registrations r on r.id=ref.id
      join public.business_assessment_results a on a.activity_registration_id=r.id
      where r.record_state='current' and a.record_state='current' and r.status not in ('no_show','cancelled') and (r.assessment_completed_at is not null or a.result_finalized_at is not null
        or (a.result_source='legacy' and (a.score is not null or a.assessment_band is not null
          or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：')))
      order by ref.key,coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id
  ), appointments as (
    select distinct on(ref.key) ref.key,r.status,r.assessment_started_at
      from registration_refs ref join public.business_activity_registrations r on r.id=ref.id join public.business_activities a on a.id=r.activity_id
      where r.record_state='current' and a.record_state='current' and a.deleted_at is null and a.kind in ('assessment_1v1','assessment')
      order by ref.key,coalesce(a.scheduled_at,r.created_at) desc,r.id
  ), opportunity_refs as (
    select 'student:'||o.student_id as key,o.id from public.business_course_opportunities o where o.student_id is not null
    union select l.key,o.id from public.business_course_opportunities o join lead_refs l on l.id=o.lead_id
  ), opportunities as (
    select distinct on(ref.key) ref.key,o.stage,o.opportunity_type from opportunity_refs ref
      join public.business_course_opportunities o on o.id=ref.id left join public.courses c on c.id=o.course_id left join public.school_terms t on t.id=o.term_id
      where o.record_state='current' order by ref.key,o.updated_at desc,o.id
  ), stages as (
    select s.*,case when e.active then 'awaiting_renewal' when e.key is not null then 'former_student'
      when a.key is not null then 'awaiting_enrollment' when c.key is not null then 'awaiting_assessment' else 'awaiting_first_contact' end as stage,
      coalesce(e.membership,false) as membership,a.registration_id
      from subjects s left join enrollment_flags e on e.key=s.key left join assessments a on a.key=s.key left join contact_flags c on c.key=s.key
  ) select s.student_id,l.id,s.key,s.stage,
    case s.stage
      when 'awaiting_first_contact' then case when l.status='invalid' then 'invalid_number'
        when coalesce(s.owner_id,l.owner_id) is null then 'unassigned' when c.outcome='unreachable' then 'unreachable' else 'not_contacted' end
      when 'awaiting_assessment' then case when i.kind='assessment_1v1' and i.state='confirmed' then 'booked'
        when i.kind='assessment_1v1' then 'coordinating' when a.status='no_show' then 'no_show' when a.status='cancelled' then 'cancelled'
        when a.status='attended' or a.assessment_started_at is not null then 'in_progress' when a.status='booked' then 'booked' else 'not_booked' end
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


CREATE OR REPLACE FUNCTION public.read_student_stage_subject(p_student_id uuid, p_lead_id uuid)
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
  has_assessment boolean;
  has_membership boolean;
  stage text;
  detail text;
  owner_id uuid;
  owner_name text;
  next_at timestamptz;
  can_followup boolean;
  today date;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  today:=(now() at time zone public.get_organization_timezone_v2())::date;
  if p_student_id is not null then
    select * into student from public.students s where s.id=p_student_id and s.deleted_at is null;
    if student.id is null or not public.can_access_student(student.id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
  end if;
  if p_lead_id is not null then
    select * into lead from public.leads l where l.id=p_lead_id;
    if lead.id is null then raise exception 'NOT_FOUND'; end if;
    if p_student_id is not null and lead.student_id is distinct from p_student_id then raise exception 'SUBJECT_MISMATCH'; end if;
    if not (public.has_perm(actor,'followup.view') and
      (lead.owner_id is null or lead.owner_id=actor or public.has_perm(actor,'student.view.all'))) then raise exception 'FORBIDDEN_SCOPE'; end if;
    if student.id is null and lead.student_id is not null then
      select * into student from public.students s where s.id=lead.student_id and s.deleted_at is null;
      if student.id is null or not public.can_access_student(student.id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    end if;
  elsif student.id is not null and public.has_perm(actor,'followup.view') then
    select * into lead from public.leads l where l.student_id=student.id
      and (l.owner_id=actor or l.owner_id is null or public.has_perm(actor,'student.view.all'))
      order by (l.status not in ('invalid','converted')) desc, l.created_at desc, l.id limit 1;
  end if;
  if student.id is null and lead.id is null then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(l.id),'{}'::uuid[]) into lead_ids from public.leads l
    where l.id=lead.id or (student.id is not null and l.student_id=student.id);
  select coalesce(array_agg(l.id),'{}'::uuid[]) into visible_lead_ids from public.leads l
    where l.id=any(lead_ids) and public.has_perm(actor,'followup.view')
      and (l.owner_id is null or l.owner_id=actor or public.has_perm(actor,'student.view.all'));
  owner_id := coalesce(student.assigned_to,lead.owner_id);
  select display_name into owner_name from public.profiles where id=owner_id;
  can_followup := public.has_perm(actor,'followup.view');

  select c.*, coalesce(r.effective_patch->>'outcome',c.outcome) as effective_outcome,
    coalesce(r.effective_patch->>'note',c.note) as effective_note into contact
    from public.business_lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.lead_id=any(visible_lead_ids) and public.business_source_is_current(c.source_record_id) and public.business_fact_is_current('lead_communications',c.id)
    order by c.occurred_at desc,c.id limit 1;
  select exists(select 1 from public.business_lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.lead_id=any(lead_ids) and public.business_source_is_current(c.source_record_id) and public.business_fact_is_current('lead_communications',c.id)
      and coalesce(r.effective_patch->>'outcome',c.outcome) in ('connected','declined')) into has_contact;

  select exists(select 1 from public.business_activity_registrations r
      where (r.student_id=student.id or r.lead_id=any(lead_ids)) and r.record_state='current'
        and r.source_enrollment_facts @> '{"confirmed":true}'::jsonb),
    exists(select 1 from public.business_activity_registrations r
      where (r.student_id=student.id or r.lead_id=any(lead_ids)) and r.record_state='current'
        and r.source_enrollment_facts @> '{"confirmed":true}'::jsonb)
    into has_source_enrollment,has_current_source_enrollment;
  select exists(select 1 from public.business_course_enrollment_subjects e where e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) and e.record_state='current')
      or exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id left join public.school_terms t on t.id=c.term_id
        where e.student_id=student.id and e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today))
      or has_source_enrollment,
    exists(select 1 from public.business_course_enrollment_subjects e left join public.school_terms t on t.id=e.term_id
      where e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) and e.status='active' and e.record_state='current'
        and (t.ends_on is null or t.ends_on >= today))
      or exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
        left join public.school_terms t on t.id=c.term_id
        where e.student_id=student.id and e.status='active' and e.left_at is null
          and (t.ends_on is null or t.ends_on >= today))
      or (has_current_source_enrollment and not exists(select 1 from public.business_course_enrollment_subjects e where e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) and e.record_state='current'))
    into has_enrollment,has_active_enrollment;
  select exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
    left join public.school_terms t on t.id=c.term_id
    where e.student_id=student.id and e.status='active' and e.left_at is null
      and (t.ends_on is null or t.ends_on >= today)) into has_membership;

  -- 空记录和未到场均不代表测评完成；专业结果仍采用现有定稿事实。
  select a.score,a.assessment_band,a.teacher_recommendation,r.id as registration_id,
    coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) as completed_at into assessment
    from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
    where (r.student_id=student.id or r.lead_id=any(lead_ids)) and r.record_state='current' and a.record_state='current' and r.status not in ('no_show','cancelled')
      and (r.assessment_completed_at is not null or a.result_finalized_at is not null
        or (a.result_source='legacy' and (a.score is not null or a.assessment_band is not null
          or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：')))
    order by coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id limit 1;
  has_assessment := assessment.registration_id is not null;
  select r.id,r.status,r.assessment_started_at,a.scheduled_at into appointment
    from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
    where (r.student_id=student.id or r.lead_id=any(lead_ids)) and r.record_state='current' and a.record_state='current' and a.deleted_at is null
      and a.kind in ('assessment_1v1','assessment')
    order by coalesce(a.scheduled_at,r.created_at) desc,r.id limit 1;
  select * into invitation from public.lead_invitation_threads i
    where i.lead_id=lead.id and i.state not in ('completed','cancelled')
    order by i.updated_at desc,i.id limit 1;
  select e.id,e.status,c.title,t.name as term_name,e.course_id,e.term_id into enrollment
    from public.business_course_enrollment_subjects e left join public.courses c on c.id=e.course_id left join public.school_terms t on t.id=e.term_id
    where e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) and e.record_state='current' order by (e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id limit 1;
  select o.id,o.stage,o.opportunity_type,c.title,t.name as term_name,o.course_id,o.term_id into opportunity
    from public.business_course_opportunities o left join public.courses c on c.id=o.course_id left join public.school_terms t on t.id=o.term_id
    where (o.student_id=student.id or o.lead_id=any(lead_ids)) and o.record_state='current'
    order by o.updated_at desc,o.id limit 1;

  stage := case when has_active_enrollment then 'awaiting_renewal'
    when has_enrollment then 'former_student' when has_assessment then 'awaiting_enrollment'
    when has_contact then 'awaiting_assessment' else 'awaiting_first_contact' end;
  detail := case stage
    when 'awaiting_first_contact' then case when lead.status='invalid' then 'invalid_number'
      when owner_id is null then 'unassigned' when contact.effective_outcome='unreachable' then 'unreachable' else 'not_contacted' end
    when 'awaiting_assessment' then case
      when invitation.kind='assessment_1v1' and invitation.state='confirmed' then 'booked'
      when invitation.kind='assessment_1v1' then 'coordinating'
      when appointment.status='no_show' then 'no_show' when appointment.status='cancelled' then 'cancelled'
      when appointment.status='attended' or appointment.assessment_started_at is not null then 'in_progress'
      when appointment.status='booked' then 'booked' else 'not_booked' end
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
      where f.student_id=student.id and f.record_state='current'
    union all select contact.effective_note,contact.occurred_at,contact.id,0 where contact.id is not null
  ) n where nullif(trim(n.content),'') is not null order by n.occurred_at desc,n.priority desc,n.id limit 1;
  select min(a.due_at) into next_at from public.lead_next_actions a
    where a.lead_id=any(visible_lead_ids) and a.status='open' and a.kind<>'initial_contact';
  next_at := least(student.next_follow_up_at,next_at);
  return jsonb_build_object(
    'key',case when student.id is not null then 'student:'||student.id else 'lead:'||lead.id end,
    'studentId',student.id,'leadId',lead.id,'name',coalesce(student.name,lead.provisional_student_name),
    'phone',coalesce(nullif(student.parent_phone,''),nullif(student.phone,''),lead.phone,''),
    'grade',coalesce(student.grade,lead.grade_hint),'gradeText',coalesce(lead.grade_text,''),
    'ownerId',owner_id,'ownerName',coalesce(owner_name,''),'stage',stage,'detail',detail,
    'note',case when can_followup then coalesce(latest_note.content,'') else '' end,
    'lastContactAt',case when can_followup then latest_note.occurred_at else null end,
    'nextContactAt',case when can_followup then next_at else null end,
    'score',assessment.score,'assessmentBand',assessment.assessment_band,'assessmentAt',assessment.completed_at,
    'registrationId',assessment.registration_id,'courseTitle',coalesce(enrollment.title,opportunity.title,''),'termName',coalesce(enrollment.term_name,opportunity.term_name,''),
    'courseId',coalesce(enrollment.course_id,opportunity.course_id),'termId',coalesce(enrollment.term_id,opportunity.term_id),
    'createdAt',coalesce(student.created_at,lead.created_at),
    'canWrite',public.has_perm(actor,'followup.write') and
      ((student.id is not null and public.can_access_student(student.id,actor))
        or (lead.owner_id is not null and (lead.owner_id=actor or public.has_perm(actor,'student.view.all')))),
    'canContact',public.has_perm(actor,'followup.write') and
      ((lead.id is not null and lead.owner_id is not null and lead.status not in ('invalid','converted')
        and (lead.owner_id=actor or public.has_perm(actor,'student.view.all')))
        or (lead.id is null and student.id is not null and (student.assigned_to=actor or public.has_perm(actor,'student.view.all')))),
    'invitation',case when can_followup and invitation.id is not null then jsonb_build_object(
      'id',invitation.id,'leadId',invitation.lead_id,'kind',invitation.kind,'state',invitation.state,
      'activityId',invitation.activity_id,'assessorId',invitation.assessor_id,'parentTimeOptions',invitation.parent_time_options,
      'assessorTimeOptions',invitation.assessor_time_options,'scheduledAt',invitation.scheduled_at,
      'locationText',invitation.location_text,'nextContactAt',next_at,'updatedAt',invitation.updated_at)
      else null end);
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_activity_enrollment_context(p_registration_id uuid, p_invitation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid := p_registration_id;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if num_nonnulls(p_registration_id,p_invitation_id) <> 1 then raise exception 'VALIDATION'; end if;
  if not (public.has_perm(v_uid,'followup.view') or public.has_perm(v_uid,'followup.write')
    or public.has_perm(v_uid,'enrollment.manage')) then raise exception 'FORBIDDEN'; end if;
  if p_invitation_id is not null then
    select r.id into v_id from public.business_activities a join public.business_activity_registrations r on r.activity_id=a.id
      where a.source_invitation_id=p_invitation_id and a.deleted_at is null limit 1;
  end if;
  if not public.can_follow_up_participation(v_id,v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select jsonb_build_object(
    'registrationId',r.id,'studentId',r.student_id,'leadId',r.lead_id,
    'name',coalesce(s.name,l.provisional_student_name,''),'phone',coalesce(s.phone,l.phone,''),
    'grade',coalesce(s.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),
    'ownerId',coalesce(s.assigned_to,l.owner_id),'leadStatus',l.status,
    'activityId',a.id,'activityTitle',a.title,'activityAt',coalesce(a.scheduled_at::text,a.occurred_on::text,''),
    'canContactBeforeCompletion',r.record_state='current' and a.record_state='current' and a.kind='assessment_1v1' and r.status not in ('cancelled','no_show'),
    'eligible',r.record_state='current' and a.record_state='current' and r.status <> 'cancelled' and case when a.kind='assessment_1v1'
      then r.assessment_completed_at is not null or ar.result_finalized_at is not null
      or (ar.result_source='legacy' and r.assessment_started_at is null and ar.id is not null and r.status='attended' and (ar.source_record_id is null or ar.assessment_band is not null or ar.score is not null or ar.strengths ~ '(原测评等级|学习力测评等级)：'))
      else r.status='attended' or exists (select 1 from public.public_class_participant_records pr
        where pr.registration_id=r.id and pr.student_presence in ('attended','late')) end,
    'recommendation',coalesce(nullif(ar.teacher_recommendation,''),(
      select nullif(pr.recommendation,'') from public.public_class_participant_records pr
      where pr.registration_id=r.id and pr.recommendation<>'' order by pr.updated_at desc limit 1),''),
    'assessmentBand',ar.assessment_band,'route',route.route,
    'routeNote',coalesce(route.note,''),'enrollmentId',case when ce.status='active' then ce.id end,
    'courseTitle',c.title,'termName',st.name,'classroomName',cl.name,'termId',ce.term_id,
    'canContact',r.record_state='current' and a.record_state='current' and public.has_perm(v_uid,'followup.write'),
    'canEnroll',r.record_state='current' and a.record_state='current' and public.has_perm(v_uid,'enrollment.manage'),
    'contacts',coalesce((select jsonb_agg(item order by item->>'recordedAt' desc,item->>'id' desc) from (
      select jsonb_build_object('id',ct.id,'channel',ct.channel,'outcome',ct.outcome,'route',ct.route,
        'note',ct.note,'nextContactAt',ct.next_contact_at,'occurredAt',ct.occurred_at,'recordedAt',ct.original_occurred_at,
        'recordedByName',coalesce(p.display_name,'')) item
      from public.effective_activity_followup_contacts ct left join public.profiles p on p.id=ct.recorded_by
      where ct.registration_id=r.id order by ct.original_occurred_at desc,ct.id desc limit 30
    ) history),'[]'::jsonb)
  ) into v_result
  from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
  left join public.students s on s.id=r.student_id left join public.leads l on l.id=r.lead_id
  left join public.business_assessment_results ar on ar.activity_registration_id=r.id
  left join public.activity_routes route on route.activity_registration_id=r.id
  left join public.business_course_enrollments ce on ce.id=route.course_enrollment_id
  left join public.courses c on c.id=ce.course_id left join public.school_terms st on st.id=ce.term_id
  left join public.course_enrollment_assignments ca on ca.course_enrollment_id=ce.id and ca.status='active'
  left join public.classrooms cl on cl.id=ca.classroom_id where r.id=v_id;
  return v_result;
end $function$;


CREATE OR REPLACE FUNCTION public.get_post_activity_followups()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid,'followup.view') then raise exception 'FORBIDDEN'; end if;
  return coalesce((select jsonb_agg(public.get_activity_enrollment_context(r.activity_registration_id,null)
    order by r.updated_at desc,r.id) from public.activity_routes r
    join public.business_activity_registrations registration on registration.id=r.activity_registration_id
    join public.business_activities activity on activity.id=registration.activity_id
    where registration.record_state='current' and activity.record_state='current' and public.can_follow_up_participation(r.activity_registration_id,v_uid)), '[]'::jsonb);
end $function$;


CREATE OR REPLACE FUNCTION public.get_course_enrollment_workbench()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'enrollment.manage') then raise exception 'FORBIDDEN'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', enrollment.id,
      'opportunityId', enrollment.opportunity_id,
      'studentId', enrollment.student_id,
      'studentName', student.name,
      'studentPhone', student.phone,
      'courseId', enrollment.course_id,
      'courseTitle', course.title,
      'termId', enrollment.term_id,
      'termName', term.name,
      'status', enrollment.status,
      'note', enrollment.note,
      'confirmedAt', enrollment.confirmed_at,
      'confirmedByName', confirmer.display_name,
      'cancelledAt', enrollment.cancelled_at,
      'cancelledByName', canceller.display_name,
      'assignmentId', assignment.id,
      'classroomId', assignment.classroom_id,
      'classroomName', assignment.classroom_name,
      'membershipId', assignment.classroom_membership_id,
      'assignedAt', assignment.assigned_at,
      'claimableClassroomIds', claimable.classroom_ids,
      'updatedAt', enrollment.updated_at
    ) order by enrollment.confirmed_at desc, enrollment.id)
      from (select * from public.business_course_enrollments where record_state='current') enrollment
      join public.students student on student.id = enrollment.student_id
      join public.courses course on course.id = enrollment.course_id
      join public.school_terms term on term.id = enrollment.term_id
      join public.profiles confirmer on confirmer.id = enrollment.confirmed_by
      left join public.profiles canceller on canceller.id = enrollment.cancelled_by
      left join lateral (
        select bridge.id, bridge.classroom_id, bridge.classroom_membership_id,
               bridge.assigned_at, classroom.name as classroom_name
          from public.course_enrollment_assignments bridge
          join public.classrooms classroom on classroom.id = bridge.classroom_id
         where bridge.course_enrollment_id = enrollment.id
           and bridge.status = 'active'
         limit 1
      ) assignment on true
      left join lateral (
        select coalesce(
          jsonb_agg(roster.classroom_id order by roster.classroom_id),
          '[]'::jsonb
        ) as classroom_ids
          from public.enrollments roster
          join public.classrooms classroom on classroom.id = roster.classroom_id
          left join public.course_enrollment_assignments linked
            on linked.classroom_membership_id = roster.id
         where roster.student_id = enrollment.student_id
           and roster.status = 'active'
           and roster.term_id is not distinct from enrollment.term_id
           and classroom.course_id = enrollment.course_id
           and classroom.term_id is not distinct from enrollment.term_id
           and linked.id is null
      ) claimable on true
  ), '[]'::jsonb);
end
$function$;


CREATE OR REPLACE FUNCTION public.get_course_opportunity_workbench()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (
    public.has_perm(v_uid, 'followup.view')
    or public.has_perm(v_uid, 'enrollment.manage')
  ) then raise exception 'FORBIDDEN'; end if;

  return jsonb_build_object(
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', source.id,
        'registrationId', source.registration_id,
        'route', source.route,
        'routeNote', source.route_note,
        'studentId', source.student_id,
        'leadId', source.lead_id,
        'name', source.subject_name,
        'phone', source.subject_phone,
        'grade', source.subject_grade,
        'gradeText', source.grade_text,
        'activityTitle', source.activity_title,
        'activityAt', source.activity_at,
        'suggestedStudentId', source.suggested_student_id,
        'suggestedStudentName', source.suggested_student_name,
        'updatedAt', source.updated_at
      ) order by source.updated_at desc, source.id)
      from (
        select route.id,
               route.activity_registration_id as registration_id,
               route.route,
               route.note as route_note,
               student.id as student_id,
               case when student.id is null then route.lead_id end as lead_id,
               coalesce(student.name, lead.provisional_student_name) as subject_name,
               coalesce(student.phone, lead.phone, '') as subject_phone,
               coalesce(student.grade, lead.grade_hint) as subject_grade,
               coalesce(nullif(lead.grade_text, ''), '') as grade_text,
               activity.title as activity_title,
               activity.scheduled_at as activity_at,
               lead.suggested_student_id,
               suggested.name as suggested_student_name,
               route.updated_at
          from public.activity_routes route
          join public.business_activity_registrations registration
            on registration.id = route.activity_registration_id
          join public.business_activities activity on activity.id = registration.activity_id
          left join public.leads lead on lead.id = route.lead_id
          left join public.students student
            on student.id = coalesce(route.student_id, lead.student_id)
          left join public.students suggested
            on suggested.id = lead.suggested_student_id and suggested.deleted_at is null
         where route.route <> 'closed'
           and activity.deleted_at is null and activity.record_state='current' and registration.record_state='current'
           and public.can_access_course_opportunity_subject(
             student.id, case when student.id is null then route.lead_id end,
             coalesce(student.assigned_to, lead.owner_id, route.routed_by), v_uid
           )
      ) source
    ), '[]'::jsonb),
    'opportunities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', opportunity.id,
        'sourceActivityRouteId', opportunity.source_activity_route_id,
        'studentId', opportunity.student_id,
        'leadId', opportunity.lead_id,
        'originLeadId', opportunity.origin_lead_id,
        'name', coalesce(student.name, lead.provisional_student_name),
        'phone', coalesce(student.phone, lead.phone, ''),
        'grade', coalesce(student.grade, lead.grade_hint),
        'gradeText', coalesce(nullif(lead.grade_text, ''), ''),
        'suggestedStudentId', lead.suggested_student_id,
        'suggestedStudentName', suggested.name,
        'sourceActivityTitle', source_activity.title,
        'teacherRecommendation', coalesce(source_assessment.teacher_recommendation, ''),
        'opportunityType', opportunity.opportunity_type,
        'courseId', opportunity.course_id,
        'courseTitle', course.title,
        'termId', opportunity.term_id,
        'termName', term.name,
        'stage', opportunity.stage,
        'ownerId', opportunity.owner_id,
        'ownerName', owner.display_name,
        'nextAction', opportunity.next_action,
        'nextActionAt', opportunity.next_action_at,
        'note', opportunity.note,
        'courseEnrollmentId', enrollment.id,
        'courseEnrollmentStatus', enrollment.status,
        'createdAt', opportunity.created_at,
        'updatedAt', opportunity.updated_at
      ) order by opportunity.updated_at desc, opportunity.id)
        from (select * from public.business_course_opportunities where record_state='current' and record_state='current') opportunity
        join public.courses course on course.id = opportunity.course_id
        join public.school_terms term on term.id = opportunity.term_id
        join public.profiles owner on owner.id = opportunity.owner_id
        left join public.students student on student.id = opportunity.student_id
        left join public.leads lead on lead.id = opportunity.lead_id
        left join public.students suggested
          on suggested.id = lead.suggested_student_id and suggested.deleted_at is null
        left join public.activity_routes source_route
          on source_route.id = opportunity.source_activity_route_id
        left join public.business_activity_registrations source_registration
          on source_registration.id = source_route.activity_registration_id
        left join public.business_activities source_activity
          on source_activity.id = source_registration.activity_id
        left join public.assessment_results source_assessment
          on source_assessment.activity_registration_id = source_registration.id
        left join public.business_course_enrollments enrollment
          on enrollment.opportunity_id = opportunity.id
       where public.can_access_course_opportunity_subject(
         opportunity.student_id, opportunity.lead_id,
         opportunity.owner_id, v_uid
       )
    ), '[]'::jsonb)
  );
end
$function$;


create or replace function public.prepare_source_enrollment(p_enrollment_id uuid,p_student_id uuid,p_classroom_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare enrollment public.course_enrollments;classroom public.classrooms;target uuid;opportunity uuid;membership uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED';end if;
  if not public.has_perm(auth.uid(),'enrollment.manage') or not public.can_access_student(p_student_id,auth.uid()) then raise exception 'FORBIDDEN';end if;
  perform public.require_current_business_record('course_enrollments',p_enrollment_id);
  select * into enrollment from public.course_enrollments where id=p_enrollment_id for update;
  if enrollment.id is null or enrollment.source_record_id is null or enrollment.status<>'active' then raise exception 'ENROLLMENT_NOT_ACTIVE';end if;
  select coalesce(a.student_id,h.student_id) into target from public.history_import_records h left join public.history_import_associations a on a.record_id=h.id where h.id=enrollment.source_record_id;
  if target is distinct from p_student_id or (enrollment.student_id is not null and enrollment.student_id<>p_student_id) then raise exception 'SOURCE_ASSOCIATION_REQUIRED';end if;
  select * into classroom from public.classrooms where id=p_classroom_id for update;
  if classroom.id is null or classroom.trashed_at is not null or classroom.archived_at is not null or classroom.purpose<>'production'
    or classroom.offering_type<>'long_term_formal' or classroom.operational_status not in ('planning','active') then raise exception 'CLASS_NOT_AVAILABLE';end if;
  if not public.can_manage_classroom(classroom.id,auth.uid()) then raise exception 'FORBIDDEN_SCOPE';end if;
  if exists(select 1 from public.course_enrollments e where e.student_id=p_student_id and e.course_id=classroom.course_id and e.term_id=classroom.term_id and e.status='active' and e.id<>enrollment.id) then raise exception 'ALREADY_ENROLLED_FOR_COURSE';end if;
  if enrollment.course_id is not null and (enrollment.course_id<>classroom.course_id or enrollment.term_id<>classroom.term_id) then raise exception 'CLASS_TARGET_MISMATCH';end if;
  opportunity:=enrollment.opportunity_id;
  if opportunity is null then
    select id into opportunity from public.course_opportunities where student_id=p_student_id and opportunity_type='new' and course_id=classroom.course_id and term_id=classroom.term_id for update;
    if opportunity is null then
      insert into public.course_opportunities(student_id,opportunity_type,course_id,term_id,stage,owner_id,created_by,updated_by,note)
        values(p_student_id,'new',classroom.course_id,classroom.term_id,'enrolled',auth.uid(),auth.uid(),auth.uid(),'确认已有报名的学生与课程安排。') returning id into opportunity;
    else raise exception 'ALREADY_ENROLLED_FOR_COURSE';end if;
  end if;
  update public.course_enrollments set student_id=p_student_id,opportunity_id=opportunity,course_id=classroom.course_id,term_id=classroom.term_id,
    confirmed_by=coalesce(confirmed_by,auth.uid()),confirmed_at=coalesce(confirmed_at,clock_timestamp()) where id=enrollment.id;
  membership:=public.assign_course_enrollment(enrollment.id,classroom.id,'确认已有报名的分班安排。',clock_timestamp());
  return membership;
end;
$$;

notify pgrst, 'reload schema';