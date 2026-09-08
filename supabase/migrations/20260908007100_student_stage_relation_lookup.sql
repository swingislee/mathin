-- 缩小逐人查询的输入，并在阶段计算中复用报名与来源关系；权限和返回合同保持原样。
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
  ), stage_enrollments as materialized (
    select * from public.business_course_enrollment_subjects where record_state='current'
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
  registration_refs as materialized (
    select 'student:'||r.student_id as key,r.id from public.business_activity_registrations r where r.student_id is not null and r.record_state='current'
    union select l.key,r.id from public.business_activity_registrations r join lead_refs l on l.id=r.lead_id where r.record_state='current'
    union select l.key,r.id from public.business_activity_registrations r join source_lead_refs l on l.source_record_id=r.source_record_id where r.record_state='current'
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
      from registration_refs ref join public.business_activity_registrations r on r.id=ref.id where r.source_enrollment_facts @> '{"confirmed":true}'::jsonb
  ), enrollment_flags as (
    select f.key,bool_or(f.active) as active,bool_or(f.membership) as membership from enrollment_facts f group by f.key
  ), latest_enrollments as (
    select distinct on(e.subject_key) e.subject_key,e.status from stage_enrollments e where e.record_state='current'
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

CREATE OR REPLACE FUNCTION public.read_student_stage_subject_with_enrollments(p_student_id uuid, p_lead_id uuid, p_enrollments business_course_enrollment_subjects[])
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
  background jsonb;
  subject_source_ids text[];
  subject_registration_ids uuid[];
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
  -- 先以身份与来源索引收窄到本人的记录，再执行现有业务范围判断。
  select coalesce(array_agg(distinct h.id),'{}'::text[]) into subject_source_ids from public.history_import_records h
    where h.lead_id=any(lead_ids) or h.id=any(array(select l.source_record_id from public.leads l where l.id=any(lead_ids)));
  select coalesce(array_agg(r.id),'{}'::uuid[]) into subject_registration_ids from public.activity_registrations r
    where r.student_id=student.id or r.lead_id=any(lead_ids) or r.source_record_id=any(subject_source_ids);
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
      where r.id=any(subject_registration_ids) and r.record_state='current'
        and r.source_enrollment_facts @> '{"confirmed":true}'::jsonb),
    exists(select 1 from public.business_activity_registrations r
      where r.id=any(subject_registration_ids) and r.record_state='current'
        and r.source_enrollment_facts @> '{"confirmed":true}'::jsonb)
    into has_source_enrollment,has_current_source_enrollment;
  select exists(select 1 from unnest(p_enrollments) e where (e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) or e.source_record_id=any(subject_source_ids)) and e.record_state='current')
      or exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id left join public.school_terms t on t.id=c.term_id
        where e.student_id=student.id and e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today))
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
    where r.id=any(subject_registration_ids) and r.record_state='current' and a.record_state='current' and r.status not in ('no_show','cancelled')
      and (r.assessment_completed_at is not null or a.result_finalized_at is not null
        or (a.result_source='legacy' and (a.score is not null or a.assessment_band is not null
          or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：')))
    order by coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id limit 1;
  has_assessment := assessment.registration_id is not null;
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
    where (e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) or e.source_record_id=any(subject_source_ids)) and e.record_state='current' order by (e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id limit 1;
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
  background:=public.student_stage_learning_background(student.id,lead.id,stage,
    case when stage='awaiting_assessment' then contact.source_record_id else assessment.source_record_id end);
  return jsonb_build_object(
    'key',case when student.id is not null then 'student:'||student.id else 'lead:'||lead.id end,
    'studentId',student.id,'leadId',lead.id,'name',coalesce(student.name,lead.provisional_student_name),
    'phone',coalesce(nullif(student.parent_phone,''),nullif(student.phone,''),lead.phone,''),
    'grade',coalesce(student.grade,lead.grade_hint),'gradeText',coalesce(lead.grade_text,''),
    'ownerId',owner_id,'ownerName',coalesce(owner_name,background->>'ownerName',''),'stage',stage,'detail',detail,
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
      else null end) || (background - 'ownerName' - 'score' - 'assessmentBand' - 'assessmentAt')
    || case when background->>'assessmentSource' is not null then jsonb_build_object(
      'score',background->'score','assessmentBand',background->'assessmentBand','assessmentAt',background->'assessmentAt') else '{}'::jsonb end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.student_stage_learning_background(p_student_id uuid, p_lead_id uuid, p_stage text, p_preferred_source_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_variable
declare
  lead_ids uuid[]; source_ids text[]; sources jsonb; person public.students%rowtype;
  actual_assessment record; class_fact record; source_fact record;
  owner_name text; teacher_name text; teacher_id uuid;
  band text; learning_band text; class_band text; background_source text;
  candidate_count integer:=0;
  candidate_assessment_ids uuid[];
  background_assessment_ids uuid[];
begin
  select * into person from public.students where id=p_student_id;
  select coalesce(array_agg(l.id),'{}'::uuid[]) into lead_ids from public.leads l
    where l.id=p_lead_id or p_student_id is not null and l.student_id=p_student_id;
  select coalesce(array_agg(distinct record_id) filter(where record_id is not null),'{}'::text[]) into source_ids from (
    select h.id as record_id from public.history_import_records h where h.student_id=p_student_id or h.lead_id=any(lead_ids)
    union all select a.record_id from public.history_import_associations a where a.student_id=p_student_id
    union all select l.source_record_id from public.leads l where l.id=any(lead_ids)
    union all select c.source_record_id from public.lead_communications c where c.lead_id=any(lead_ids)
    union all select r.source_record_id from public.activity_registrations r where r.student_id=p_student_id or r.lead_id=any(lead_ids)
    union all select a.source_record_id from public.assessment_results a where a.student_id=p_student_id or a.lead_id=any(lead_ids)
    union all select e.source_record_id from public.course_enrollments e where e.student_id=p_student_id
  ) refs;
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'table',h.record_data->>'tableName',
    'current',public.business_source_is_current(h.id),'fields',f.fields)),'[]'::jsonb) into sources
    from public.history_import_records h cross join lateral (
      select jsonb_object_agg(c->>'fieldName',btrim(c->>'text')) as fields from jsonb_array_elements(h.record_data->'cells') c
      where c->>'fieldName' in ('学服老师','确认人员','学科老师','报名服务老师','授课学科老师','思维测评等级','学习力测评等级','班型')
        and nullif(btrim(c->>'text'),'') is not null
    ) f where h.id=any(source_ids) and h.source_data->>'format'='feishu-base';

  -- 正式班级提供当前任课老师和实际班型；班型仅作参考，不补造测评完成事件。
  select string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='primary_teacher') as teacher_name,
    string_agg(distinct p.display_name,'、' order by p.display_name) filter(where a.responsibility='learning_support') as owner_name,
    string_agg(distinct (regexp_match(c.name,'(?:春季|暑期|暑假|秋季|寒假)(X[+＋]|G[+＋]|A[+＋]?|S|C|培优|基础)(?:[|｜班]|$)'))[1],'、') as class_band
    into class_fact from public.enrollments e join public.classrooms c on c.id=e.classroom_id
      left join public.school_terms t on t.id=c.term_id
      left join public.classroom_staff_assignments a on a.classroom_id=c.id
      left join public.profiles p on p.id=a.user_id
    where e.student_id=p_student_id and e.status='active' and e.left_at is null and c.archived_at is null and c.trashed_at is null
      and (t.ends_on is null or t.ends_on >= (now() at time zone public.get_organization_timezone_v2())::date);

  select coalesce(nullif(s->'fields'->>'报名服务老师',''),nullif(s->'fields'->>'学服老师',''),nullif(s->'fields'->>'确认人员','')) as name
    into source_fact from jsonb_array_elements(sources) s
    where coalesce(s->'fields'->>'报名服务老师',s->'fields'->>'学服老师',s->'fields'->>'确认人员') is not null
    order by case when p_stage='awaiting_renewal' and s->>'table'='2026秋季在读学员表格' then 0
      when s->>'id'=p_preferred_source_id then 1 when (s->>'current')::boolean then 2 else 3 end,s->>'id' limit 1;
  owner_name:=coalesce(class_fact.owner_name,source_fact.name);
  select coalesce(nullif(s->'fields'->>'授课学科老师',''),nullif(s->'fields'->>'学科老师','')) as name
    into source_fact from jsonb_array_elements(sources) s
    where coalesce(s->'fields'->>'授课学科老师',s->'fields'->>'学科老师') is not null
    order by case when p_stage='awaiting_renewal' and s->>'table'='2026秋季在读学员表格' then 0
      when s->>'id'=p_preferred_source_id then 1 when (s->>'current')::boolean then 2 else 3 end,s->>'id' limit 1;
  teacher_name:=coalesce(case when p_stage='awaiting_renewal' then class_fact.teacher_name end,source_fact.name);

  -- 批次读取仅处理本人关联及候选；推定状态与人工修订仍由原关联记录表达。
  select coalesce(array_agg(a.id),'{}'::uuid[]) into background_assessment_ids
    from public.assessment_results a join public.activity_registrations r on r.id=a.activity_registration_id where (a.student_id=p_student_id or r.student_id=p_student_id or a.lead_id=any(lead_ids) or r.lead_id=any(lead_ids)
      or a.source_record_id=any(source_ids) or r.source_record_id=any(source_ids));
  select coalesce(array_agg(a.id),'{}'::uuid[]) into candidate_assessment_ids from public.assessment_results a
    where a.source_record_id=any(array(select ic.record_id from public.history_import_identity_candidates ic where ic.student_id=p_student_id));
  select count(distinct h.id)::integer into candidate_count from public.history_import_identity_candidates ic
    join public.history_import_records h on h.id=ic.record_id
    where ic.student_id=p_student_id and h.source_data->>'format'='feishu-base' and not h.id=any(source_ids)
      and exists(select 1 from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
        where a.id=any(candidate_assessment_ids) and a.source_record_id=h.id and r.status not in ('no_show','cancelled') and
          (r.assessment_completed_at is not null or a.result_finalized_at is not null or a.result_source='legacy' and
            (a.score is not null or a.assessment_band is not null or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：')));

  select a.id,a.score,a.assessment_band,a.assessed_by,r.id as registration_id,a.source_record_id,
    coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone public.get_organization_timezone_v2())::date,
      act.occurred_on,(act.scheduled_at at time zone public.get_organization_timezone_v2())::date) as assessed_on,
    nullif(substring(a.strengths from '(?:^|[\r\n])学习力测评等级：([^\r\n]+)'),'') as learning_band
    into actual_assessment from public.business_assessment_results a
      join public.business_activity_registrations r on r.id=a.activity_registration_id
      join public.business_activities act on act.id=r.activity_id
    where a.id=any(background_assessment_ids)
      and act.deleted_at is null and r.status not in ('no_show','cancelled') and
      (r.assessment_completed_at is not null or a.result_finalized_at is not null or a.result_source='legacy' and
        (a.score is not null or a.assessment_band is not null or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：'))
    order by coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone public.get_organization_timezone_v2())::date,
      act.occurred_on,(act.scheduled_at at time zone public.get_organization_timezone_v2())::date) desc nulls last,a.updated_at desc,a.id limit 1;

  if actual_assessment.id is not null then
    band:=public.student_learning_band(actual_assessment.assessment_band);
    learning_band:=actual_assessment.learning_band;
    background_source:='assessment';
    if teacher_name is null then select display_name into teacher_name from public.profiles where id=actual_assessment.assessed_by;end if;
  end if;
  if p_stage='awaiting_renewal' and actual_assessment.id is null then
    select s->'fields'->>'班型' as class_band into source_fact from jsonb_array_elements(sources) s
      where nullif(s->'fields'->>'班型','') is not null and s->>'table'='2026秋季在读学员表格'
      order by (s->>'table'='2026秋季在读学员表格') desc,(s->>'current')::boolean desc,s->>'id' limit 1;
    class_band:=coalesce(class_fact.class_band,source_fact.class_band);
    if class_band is not null then band:=public.student_learning_band(class_band);background_source:='class_band';end if;
  end if;
  select case when count(*)=1 then (array_agg(p.id))[1] end into teacher_id from public.profiles p
    where p.display_name=teacher_name and p.is_active and p.role in ('staff','admin');
  return jsonb_build_object('ownerName',coalesce(owner_name,''),'teacherName',coalesce(teacher_name,''),'teacherId',teacher_id,
    'assessmentSource',background_source,'assessmentBand',band,'score',actual_assessment.score,
    'assessmentAt',actual_assessment.assessed_on,'assessmentRecordId',actual_assessment.id,
    'learningBand',case when learning_band='未达A' then 'X+' else learning_band end,'classBandLabel',coalesce(class_band,''),'assessmentCandidateCount',candidate_count,'inferredSourceIds',(select coalesce(jsonb_agg(a.record_id),'[]'::jsonb) from public.history_import_associations a where a.record_id=any(source_ids) and a.match_state='inferred'));
end;
$function$;
