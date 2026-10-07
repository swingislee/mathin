-- A failed attempt never becomes a successful contact merely through source metadata.
create or replace function public.school_contact_is_effective(p_row jsonb,p_patch jsonb default null)
returns boolean language sql immutable set search_path=public,pg_temp as $$
  select case when coalesce(p_row->'source_metric_facts'->'supersededProjection'='true'::jsonb,false) then false
    when coalesce(p_patch->>'outcome',p_row->>'outcome') in ('unreachable','invalid_number') then false
    else coalesce(coalesce(p_patch->>'outcome',p_row->>'outcome') in ('connected','declined')
      or coalesce(p_patch->'wechatAdded',p_row->'wechat_added')='true'::jsonb
      or coalesce(p_patch->'visitCommitted',p_row->'visit_committed')='true'::jsonb
      or not coalesce(p_patch?'outcome',false) and p_row->'source_metric_facts'->'effectiveContact'='true'::jsonb,false)
  end;
$$;

-- One row per recorded contact, with revisions applied and source labels kept out of the note.
create function public.school_record_contact_events(p_student_id uuid,p_lead_id uuid)
returns table(id uuid,lead_id uuid,channel text,outcome text,note text,wechat_added boolean,
  visit_committed boolean,interest_level text,recorded_by uuid,recorded_by_name text,
  occurred_at timestamptz,occurred_on date,source_date_label text,sort_key text,effective_contact boolean)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); v_student_id uuid:=p_student_id; visible_lead_ids uuid[];
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not public.has_perm(actor,'followup.view') then return; end if;
  if p_lead_id is not null then
    if not public.can_view_school_lead(p_lead_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
    select coalesce(v_student_id,l.student_id) into v_student_id from public.leads l where l.id=p_lead_id;
    if p_student_id is not null and exists(select 1 from public.leads l where l.id=p_lead_id and l.student_id is distinct from p_student_id) then raise exception 'SUBJECT_MISMATCH'; end if;
  end if;
  if v_student_id is not null and not public.can_view_school_student(v_student_id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if v_student_id is null and p_lead_id is null then raise exception 'NOT_FOUND'; end if;
  select coalesce(array_agg(l.id),'{}'::uuid[]) into visible_lead_ids from public.leads l
    where (l.id=p_lead_id or l.student_id=v_student_id) and public.can_view_school_lead(l.id,actor);
  return query
    select c.id,c.lead_id,coalesce(r.effective_patch->>'channel',c.channel),coalesce(r.effective_patch->>'outcome',c.outcome),
      coalesce(r.effective_patch->>'note',c.source_metric_facts->>'communicationNote',c.note,''),
      case when r.effective_patch?'wechatAdded' then (r.effective_patch->>'wechatAdded')::boolean else c.wechat_added end,
      case when r.effective_patch?'visitCommitted' then (r.effective_patch->>'visitCommitted')::boolean else c.visit_committed end,
      case when r.effective_patch?'interestLevel' then r.effective_patch->>'interestLevel' else c.interest_level end,
      c.recorded_by,coalesce(p.display_name,nullif(c.source_metric_facts->'staff'->>'contacts',''),''),
      coalesce((r.effective_patch->>'occurredAt')::timestamptz,c.occurred_at),c.occurred_on,
      c.source_metric_facts->>'communicationDate',
      public.school_contact_sort_key(coalesce((r.effective_patch->>'occurredAt')::timestamptz,c.occurred_at),c.occurred_on,c.source_metric_facts,c.source_key),
      public.school_contact_is_effective(to_jsonb(c),r.effective_patch)
    from public.business_lead_communications c left join lateral (
      select cr.effective_patch from public.communication_record_revisions cr
        where cr.source='contact' and cr.event_id=c.id order by cr.revision_no desc limit 1
    ) r on true left join public.profiles p on p.id=c.recorded_by
    where c.lead_id=any(visible_lead_ids)
      and (c.source_metric_facts->'contactAttempt' is distinct from 'false'::jsonb or r.effective_patch is not null);
end;
$$;
revoke all on function public.school_record_contact_events(uuid,uuid) from public,anon;
grant execute on function public.school_record_contact_events(uuid,uuid) to authenticated;
alter function public.school_record_contact_events(uuid,uuid) owner to postgres;

create function public.school_record_communication_summary(p_student_id uuid,p_lead_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  with contacts as materialized (select * from public.school_record_contact_events(p_student_id,p_lead_id)),
  latest as (select * from contacts order by sort_key desc,id desc limit 1)
  select jsonb_build_object('count',(select count(*) from contacts),'effectiveCount',(select count(*) from contacts where effective_contact),
    'latestNote',coalesce(l.note,''),'latestOutcome',l.outcome,'latestAt',coalesce(l.occurred_at::text,l.occurred_on::text),
    'latestDateLabel',l.source_date_label,'latestActor',coalesce(l.recorded_by_name,''))
  from (select 1) anchor left join latest l on true;
$$;
revoke all on function public.school_record_communication_summary(uuid,uuid) from public,anon;
grant execute on function public.school_record_communication_summary(uuid,uuid) to authenticated;
alter function public.school_record_communication_summary(uuid,uuid) owner to postgres;

-- The row payload and save response use the same contact summary.
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
    'communication',public.school_record_communication_summary(student.id,lead.id),
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
      'communication',public.school_record_communication_summary(s.student_id,s.lead_id),
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
