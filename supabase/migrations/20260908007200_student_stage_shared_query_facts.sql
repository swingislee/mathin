-- 同次读取复用报名集合与当前预约；内部工作函数只供原有授权入口调用。
CREATE OR REPLACE FUNCTION public.student_stage_index_with_enrollments(p_scope text, p_search text, p_enrollments public.business_course_enrollment_subjects[])
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
  ), stage_enrollments as materialized (
    select * from unnest(p_enrollments) where record_state='current'
  ), source_lead_refs as materialized (
    select l.key,h.id as source_record_id from lead_refs l join public.history_import_records h on h.lead_id=l.id
    union select l.key,h.id from lead_refs l join public.history_import_records h on h.id=l.source_record_id
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
  stage_registrations as materialized (
    select * from public.business_activity_registrations where record_state='current'
  ), registration_refs as materialized (
    select 'student:'||r.student_id as key,r.id from stage_registrations r where r.student_id is not null and r.record_state='current'
    union select l.key,r.id from stage_registrations r join lead_refs l on l.id=r.lead_id where r.record_state='current'
    union select l.key,r.id from stage_registrations r join source_lead_refs l on l.source_record_id=r.source_record_id where r.record_state='current'
  ), enrollment_facts as (
    select e.subject_key as key,
      e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today) as active,
      false as membership from stage_enrollments e left join public.school_terms t on t.id=e.term_id where e.record_state='current'
    union all select l.key,e.status='active' and (t.ends_on is null or t.ends_on>=today),false
      from stage_enrollments e join source_lead_refs l on l.source_record_id=e.source_record_id left join public.school_terms t on t.id=e.term_id where e.record_state='current'
    union all
    select 'student:'||e.student_id,
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today),
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today)
      from public.enrollments e join public.classrooms c on c.id=e.classroom_id left join public.school_terms t on t.id=c.term_id
      where e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today)
    union all
    select ref.key,r.record_state='current' and not exists(select 1 from stage_enrollments e where e.subject_key=ref.key and e.record_state='current'),false
      from registration_refs ref join stage_registrations r on r.id=ref.id where r.source_enrollment_facts @> '{"confirmed":true}'::jsonb
  ), enrollment_flags as (
    select f.key,bool_or(f.active) as active,bool_or(f.membership) as membership from enrollment_facts f group by f.key
  ), latest_enrollments as (
    select distinct on(e.subject_key) e.subject_key,e.status from stage_enrollments e where e.record_state='current'
      order by e.subject_key,(e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id
  ), assessments as materialized (
    select distinct on(ref.key) ref.key,r.id as registration_id
      from registration_refs ref join stage_registrations r on r.id=ref.id
      join public.business_assessment_results a on a.activity_registration_id=r.id
      where r.record_state='current' and a.record_state='current' and r.status not in ('no_show','cancelled') and (r.assessment_completed_at is not null or a.result_finalized_at is not null
        or (a.result_source='legacy' and (a.score is not null or a.assessment_band is not null
          or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：')))
      order by ref.key,coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id
  ), appointments as (
    select distinct on(ref.key) ref.key,r.status,r.assessment_started_at
      from registration_refs ref join stage_registrations r on r.id=ref.id join public.business_activities a on a.id=r.activity_id
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
REVOKE ALL ON FUNCTION public.student_stage_index_with_enrollments(text,text,public.business_course_enrollment_subjects[]) FROM public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.student_stage_workspace_index(p_scope text, p_search text)
 RETURNS TABLE(student_id uuid, lead_id uuid, key text, stage text, detail text, created_at timestamptz)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare actor uuid:=auth.uid(); enrollment_facts public.business_course_enrollment_subjects[];
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) then raise exception 'FORBIDDEN'; end if;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into enrollment_facts
    from public.business_course_enrollment_subjects e where e.record_state='current';
  return query select * from public.student_stage_index_with_enrollments(p_scope,p_search,enrollment_facts);
end;
$function$;
CREATE OR REPLACE FUNCTION public.list_student_stage_workspace(p_stage text, p_scope text, p_search text, p_page integer, p_page_size integer, p_detail text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); result jsonb; enrollment_facts public.business_course_enrollment_subjects[];
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'student.view.all')
    or public.has_perm(actor,'student.view.assigned') or public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student')
    or p_scope is null or p_scope not in ('mine','all','unassigned') or p_page is null or p_page<1
    or p_page_size is null or p_page_size not in (20,50,100) or length(coalesce(p_search,''))>80 then raise exception 'VALIDATION'; end if;
  select coalesce(array_agg(e),'{}'::public.business_course_enrollment_subjects[]) into enrollment_facts
    from public.business_course_enrollment_subjects e where e.record_state='current';
  with subjects as materialized (select * from public.student_stage_index_with_enrollments(p_scope,p_search,enrollment_facts)),
  filtered as materialized (select * from subjects s where (coalesce(p_search,'')<>'' or s.stage=p_stage)
    and (coalesce(p_detail,'')='' or s.detail=p_detail)),
  totals as (select count(*)::integer as count,greatest(1,ceil(count(*)::numeric/p_page_size)::integer) as pages from filtered),
  page_rows as materialized (select * from filtered f order by f.created_at desc,f.key
    limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(public.read_student_stage_subject_with_enrollments(r.student_id,r.lead_id,enrollment_facts)
      order by r.created_at desc,r.key) from page_rows r),'[]'::jsonb),
    'count',count,'page',least(p_page,pages),'pageSize',p_page_size,'totalPages',pages,
    'counts',coalesce((select jsonb_object_agg(stage,n) from (select s.stage,count(*) as n from subjects s group by s.stage) c),'{}'::jsonb))
    into result from totals;
  return result;
end;
$function$;
NOTIFY pgrst,'reload schema';
