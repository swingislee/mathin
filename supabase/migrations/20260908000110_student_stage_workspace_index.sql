-- 批量归类用于计数和分页；完整个人快照只读取当前页。
create function public.student_stage_workspace_index(p_scope text,p_search text)
returns table(student_id uuid,lead_id uuid,key text,stage text,detail text,created_at timestamptz)
language plpgsql security definer stable set search_path=public,pg_temp as $$
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
      from public.students s where s.deleted_at is null and (view_all or public.can_access_student(s.id,actor))
        and (p_scope='all' or (p_scope='mine' and s.assigned_to=actor) or (p_scope='unassigned' and s.assigned_to is null))
        and (coalesce(p_search,'')='' or s.id::text=p_search
          or position(lower(p_search) in lower(s.name||' '||s.school||' '||s.phone||' '||s.parent_phone))>0
          or (length(regexp_replace(p_search,'\D','','g'))>=3 and
            position(regexp_replace(p_search,'\D','','g') in regexp_replace(s.phone||' '||s.parent_phone,'\D','','g'))>0))
    union all
    select null,l.id,'lead:'||l.id,l.created_at,l.owner_id from public.leads l
      where l.student_id is null and view_followup and (l.owner_id is null or l.owner_id=actor or view_all)
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
      from public.lead_communications c join lead_refs l on l.id=c.lead_id
      left join lateral (select r.effective_patch from public.communication_record_revisions r
        where r.source='contact' and r.event_id=c.id order by r.revision_no desc limit 1) r on true
  ), contact_flags as (select c.key from contacts c where c.outcome in ('connected','declined') group by c.key),
  latest_contacts as (select distinct on(c.key) c.key,c.outcome from contacts c where c.visible order by c.key,c.occurred_at desc,c.id),
  registration_refs as materialized (
    select 'student:'||r.student_id as key,r.id from public.activity_registrations r where r.student_id is not null
    union select l.key,r.id from public.activity_registrations r join lead_refs l on l.id=r.lead_id
  ), enrollment_facts as (
    select 'student:'||e.student_id as key,
      e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today) as active,
      false as membership from public.course_enrollments e join public.school_terms t on t.id=e.term_id
    union all
    select 'student:'||e.student_id,
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today),
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today)
      from public.enrollments e join public.classrooms c on c.id=e.classroom_id left join public.school_terms t on t.id=c.term_id
    union all
    select ref.key,r.record_state='current' and not exists(select 1 from public.course_enrollments e where 'student:'||e.student_id=ref.key),false
      from registration_refs ref join public.activity_registrations r on r.id=ref.id where r.source_enrollment_facts @> '{"confirmed":true}'::jsonb
  ), enrollment_flags as (
    select f.key,bool_or(f.active) as active,bool_or(f.membership) as membership from enrollment_facts f group by f.key
  ), latest_enrollments as (
    select distinct on(e.student_id) e.student_id,e.status from public.course_enrollments e
      order by e.student_id,(e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id
  ), assessments as materialized (
    select distinct on(ref.key) ref.key,r.id as registration_id
      from registration_refs ref join public.activity_registrations r on r.id=ref.id
      join public.assessment_results a on a.activity_registration_id=r.id
      where r.status not in ('no_show','cancelled') and (r.assessment_completed_at is not null or a.result_finalized_at is not null
        or (a.result_source='legacy' and (a.score is not null or a.assessment_band is not null
          or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：')))
      order by ref.key,coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id
  ), appointments as (
    select distinct on(ref.key) ref.key,r.status,r.assessment_started_at
      from registration_refs ref join public.activity_registrations r on r.id=ref.id join public.activities a on a.id=r.activity_id
      where a.deleted_at is null and a.kind in ('assessment_1v1','assessment')
      order by ref.key,coalesce(a.scheduled_at,r.created_at) desc,r.id
  ), opportunity_refs as (
    select 'student:'||o.student_id as key,o.id from public.course_opportunities o where o.student_id is not null
    union select l.key,o.id from public.course_opportunities o join lead_refs l on l.id=o.lead_id
  ), opportunities as (
    select distinct on(ref.key) ref.key,o.stage,o.opportunity_type from opportunity_refs ref
      join public.course_opportunities o on o.id=ref.id join public.courses c on c.id=o.course_id join public.school_terms t on t.id=o.term_id
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
    left join latest_enrollments e on e.student_id=s.student_id;
end;
$$;
revoke all on function public.student_stage_workspace_index(text,text) from public,anon,authenticated;

create or replace function public.list_student_stage_workspace(
  p_stage text,p_scope text,p_search text,p_page integer,p_page_size integer,p_detail text
) returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare actor uuid:=auth.uid(); result jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'student.view.all')
    or public.has_perm(actor,'student.view.assigned') or public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student')
    or p_scope is null or p_scope not in ('mine','all','unassigned') or p_page is null or p_page<1
    or p_page_size is null or p_page_size not in (20,50,100) or length(coalesce(p_search,''))>80 then raise exception 'VALIDATION'; end if;
  with subjects as materialized (select * from public.student_stage_workspace_index(p_scope,p_search)),
  filtered as materialized (select * from subjects s where (coalesce(p_search,'')<>'' or s.stage=p_stage)
    and (coalesce(p_detail,'')='' or s.detail=p_detail)),
  totals as (select count(*)::integer as count,greatest(1,ceil(count(*)::numeric/p_page_size)::integer) as pages from filtered),
  page_rows as materialized (select * from filtered f order by f.created_at desc,f.key
    limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(public.read_student_stage_subject(r.student_id,r.lead_id)
      order by r.created_at desc,r.key) from page_rows r),'[]'::jsonb),
    'count',count,'page',least(p_page,pages),'pageSize',p_page_size,'totalPages',pages,
    'counts',coalesce((select jsonb_object_agg(stage,n) from (select s.stage,count(*) as n from subjects s group by s.stage) c),'{}'::jsonb))
    into result from totals;
  return result;
end;
$$;
