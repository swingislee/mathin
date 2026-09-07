-- 学生名单按人归类；预约、沟通、测评与课程关系继续保存在各自业务表。
create function public.read_student_stage_subject(p_student_id uuid, p_lead_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
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
    from public.lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.lead_id=any(visible_lead_ids)
    order by c.occurred_at desc,c.id limit 1;
  select exists(select 1 from public.lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.lead_id=any(lead_ids)
      and coalesce(r.effective_patch->>'outcome',c.outcome) in ('connected','declined')) into has_contact;

  select exists(select 1 from public.activity_registrations r
      where (r.student_id=student.id or r.lead_id=any(lead_ids))
        and r.source_enrollment_facts @> '{"confirmed":true}'::jsonb),
    exists(select 1 from public.activity_registrations r
      where (r.student_id=student.id or r.lead_id=any(lead_ids)) and r.record_state='current'
        and r.source_enrollment_facts @> '{"confirmed":true}'::jsonb)
    into has_source_enrollment,has_current_source_enrollment;
  select exists(select 1 from public.course_enrollments e where e.student_id=student.id)
      or exists(select 1 from public.enrollments e where e.student_id=student.id)
      or has_source_enrollment,
    exists(select 1 from public.course_enrollments e join public.school_terms t on t.id=e.term_id
      where e.student_id=student.id and e.status='active' and e.record_state='current'
        and (t.ends_on is null or t.ends_on >= today))
      or exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
        left join public.school_terms t on t.id=c.term_id
        where e.student_id=student.id and e.status='active' and e.left_at is null
          and (t.ends_on is null or t.ends_on >= today))
      or (has_current_source_enrollment and not exists(select 1 from public.course_enrollments e where e.student_id=student.id))
    into has_enrollment,has_active_enrollment;
  select exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
    left join public.school_terms t on t.id=c.term_id
    where e.student_id=student.id and e.status='active' and e.left_at is null
      and (t.ends_on is null or t.ends_on >= today)) into has_membership;

  -- 空记录和未到场均不代表测评完成；专业结果仍采用现有定稿事实。
  select a.score,a.assessment_band,a.teacher_recommendation,r.id as registration_id,
    coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) as completed_at into assessment
    from public.assessment_results a join public.activity_registrations r on r.id=a.activity_registration_id
    where (r.student_id=student.id or r.lead_id=any(lead_ids)) and r.status not in ('no_show','cancelled')
      and (r.assessment_completed_at is not null or a.result_finalized_at is not null
        or (a.result_source='legacy' and (a.score is not null or a.assessment_band is not null
          or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：')))
    order by coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id limit 1;
  has_assessment := assessment.registration_id is not null;
  select r.id,r.status,r.assessment_started_at,a.scheduled_at into appointment
    from public.activity_registrations r join public.activities a on a.id=r.activity_id
    where (r.student_id=student.id or r.lead_id=any(lead_ids)) and a.deleted_at is null
      and a.kind in ('assessment_1v1','assessment')
    order by coalesce(a.scheduled_at,r.created_at) desc,r.id limit 1;
  select * into invitation from public.lead_invitation_threads i
    where i.lead_id=lead.id and i.state not in ('completed','cancelled')
    order by i.updated_at desc,i.id limit 1;
  select e.id,e.status,c.title,t.name as term_name,e.course_id,e.term_id into enrollment
    from public.course_enrollments e join public.courses c on c.id=e.course_id join public.school_terms t on t.id=e.term_id
    where e.student_id=student.id order by (e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id limit 1;
  select o.id,o.stage,o.opportunity_type,c.title,t.name as term_name,o.course_id,o.term_id into opportunity
    from public.course_opportunities o join public.courses c on c.id=o.course_id join public.school_terms t on t.id=o.term_id
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
    select f.content,f.created_at as occurred_at,f.id,1 as priority from public.student_follow_ups f
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
$$;

create function public.list_student_stage_workspace(
  p_stage text,p_scope text,p_search text,p_page integer,p_page_size integer,p_detail text
) returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare actor uuid := auth.uid(); result jsonb;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(actor) or not (public.has_perm(actor,'student.view.all')
    or public.has_perm(actor,'student.view.assigned') or public.has_perm(actor,'followup.view')) then raise exception 'FORBIDDEN'; end if;
  if p_stage is null or p_stage not in ('awaiting_first_contact','awaiting_assessment','awaiting_enrollment','awaiting_renewal','former_student')
    or p_scope is null or p_scope not in ('mine','all','unassigned') or p_page is null or p_page<1
    or p_page_size is null or p_page_size not in (20,50,100) or length(coalesce(p_search,''))>80 then raise exception 'VALIDATION'; end if;
  with subjects as materialized (
    select s.id as student_id,null::uuid as lead_id from public.students s
      where s.deleted_at is null and public.can_access_student(s.id,actor)
        and (p_scope='all' or (p_scope='mine' and s.assigned_to=actor) or (p_scope='unassigned' and s.assigned_to is null))
        and (coalesce(p_search,'')='' or s.id::text=p_search
          or position(lower(p_search) in lower(s.name||' '||s.school||' '||s.phone||' '||s.parent_phone))>0
          or (length(regexp_replace(p_search,'\D','','g'))>=3 and
            position(regexp_replace(p_search,'\D','','g') in regexp_replace(s.phone||' '||s.parent_phone,'\D','','g'))>0))
    union all
    select null,l.id from public.leads l where l.student_id is null and public.has_perm(actor,'followup.view')
      and (l.owner_id is null or l.owner_id=actor or public.has_perm(actor,'student.view.all'))
      and (p_scope='all' or (p_scope='mine' and l.owner_id=actor) or (p_scope='unassigned' and l.owner_id is null))
      and (coalesce(p_search,'')='' or l.id::text=p_search
        or position(lower(p_search) in lower(l.provisional_student_name||' '||l.phone))>0
        or (length(regexp_replace(p_search,'\D','','g'))>=3 and position(regexp_replace(p_search,'\D','','g') in l.phone_normalized)>0))
  ), snapshots as materialized (
    select public.read_student_stage_subject(student_id,lead_id) as row from subjects
  ), filtered as materialized (
    select row from snapshots where (coalesce(p_search,'')<>'' or row->>'stage'=p_stage)
      and (coalesce(p_detail,'')='' or row->>'detail'=p_detail)
  ), totals as (
    select count(*)::integer as count,greatest(1,ceil(count(*)::numeric/p_page_size)::integer) as pages from filtered
  ), page_rows as (
    select row from filtered order by (row->>'createdAt')::timestamptz desc,row->>'key'
      limit p_page_size offset (least(p_page,(select pages from totals))-1)*p_page_size
  ) select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(row) from page_rows),'[]'::jsonb),
    'count',count,'page',least(p_page,pages),'pageSize',p_page_size,'totalPages',pages,
    'counts',coalesce((select jsonb_object_agg(stage,n) from (select row->>'stage' as stage,count(*) as n from snapshots group by 1) c),'{}'::jsonb)
  ) into result from totals;
  return result;
end;
$$;

-- 幂等回执保留首次保存的响应快照；仅原操作者在仍有主体权限时可重放。
create table public.student_stage_entry_receipts (
  actor_id uuid not null references public.profiles(id),request_id uuid not null,
  fingerprint text not null,result jsonb not null,created_at timestamptz not null default now(),
  primary key(actor_id,request_id)
);
alter table public.student_stage_entry_receipts enable row level security;
revoke all on public.student_stage_entry_receipts from public,anon,authenticated;

create function public.save_student_stage_entry(p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare
  actor uuid:=auth.uid(); student_id uuid; lead_id uuid; student public.students%rowtype; lead public.leads%rowtype;
  invitation jsonb; active_invitation public.lead_invitation_threads%rowtype;
  opportunity jsonb; opportunity_id uuid; enrollment_id uuid;
  note text; next_at timestamptz; outcome text; mode text; result jsonb; receipt public.student_stage_entry_receipts%rowtype;
  contact_result jsonb; effective_phone text; opportunity_note text;
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(actor,'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('student-stage-entry:'||actor||':'||p_request_id,0));
  select * into receipt from public.student_stage_entry_receipts where actor_id=actor and request_id=p_request_id;
  if found then
    if receipt.fingerprint<>md5(p_payload::text) then raise exception 'REQUEST_CONFLICT'; end if;
    perform public.read_student_stage_subject((receipt.result->'subject'->>'studentId')::uuid,(receipt.result->'subject'->>'leadId')::uuid);
    return receipt.result;
  end if;
  student_id:=(p_payload->>'studentId')::uuid; lead_id:=(p_payload->>'leadId')::uuid;
  mode:=p_payload->>'mode'; note:=trim(coalesce(p_payload->>'note','')); next_at:=(p_payload->>'nextContactAt')::timestamptz;
  if mode is null or mode not in ('note','contact','invitation','enrollment') or length(note)>2000
    or (mode='note' and note='') then raise exception 'VALIDATION'; end if;
  -- 先验证主体，权限通过后才建立业务关系；学生与线索 ID 必须指向同一个人。
  perform public.read_student_stage_subject(student_id,lead_id);
  if lead_id is not null then
    select * into lead from public.leads where id=lead_id for update;
    student_id:=coalesce(student_id,lead.student_id);
  end if;
  if student_id is not null then
    select * into student from public.students where id=student_id and deleted_at is null for update;
    if student.id is null or not public.can_access_student(student.id,actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
  end if;

  if mode in ('contact','invitation') then
    if next_at is not null and next_at<=now() then raise exception 'REMINDER_NOT_FUTURE'; end if;
    if lead_id is null then
      effective_phone:=coalesce(nullif(student.parent_phone,''),nullif(student.phone,''));
      if effective_phone is null or public.normalize_school_ops_phone(effective_phone) !~ '^[0-9]{6,20}$' then raise exception 'STUDENT_PHONE_REQUIRED'; end if;
      if not (student.assigned_to=actor or public.has_perm(actor,'student.view.all')) then raise exception 'FORBIDDEN_SCOPE'; end if;
      -- 只为本次明确登记补齐既有学生的线索关联，不按姓名或电话合并身份。
      insert into public.leads(provisional_student_name,normalized_name,phone,phone_normalized,grade_hint,
        status,owner_id,student_id,identity_confirmed_by,identity_confirmed_at,created_by)
      values(student.name,public.normalize_lead_name(student.name),effective_phone,public.normalize_school_ops_phone(effective_phone),student.grade,
        'uncontacted',coalesce(student.assigned_to,actor),student.id,actor,now(),actor) returning id into lead_id;
      select * into lead from public.leads where id=lead_id;
    end if;
    if lead.owner_id is null then raise exception 'LEAD_UNASSIGNED'; end if;
    if lead.owner_id<>actor and not public.has_perm(actor,'student.view.all') then raise exception 'FORBIDDEN_SCOPE'; end if;
    invitation:=nullif(p_payload->'invitation','null'::jsonb);
    if mode='invitation' and invitation is null then raise exception 'VALIDATION'; end if;
    outcome:=case when mode='invitation' then 'connected' else p_payload->>'outcome' end;
    if invitation is not null then
      select * into active_invitation from public.lead_invitation_threads i where i.lead_id=lead_id
        and i.state not in ('completed','cancelled') for update;
      if active_invitation.id is distinct from (p_payload->>'expectedInvitationId')::uuid
        or (active_invitation.id is not null and active_invitation.updated_at is distinct from (p_payload->>'expectedInvitationUpdatedAt')::timestamptz)
        then raise exception 'INVITATION_CONFLICT'; end if;
      if active_invitation.id is not null and active_invitation.kind is distinct from invitation->>'kind' then raise exception 'ACTIVE_INVITATION_EXISTS'; end if;
    end if;
    contact_result:=public.record_lead_contact_v4(lead_id,outcome,note,(p_payload->>'wechatAdded')::boolean,p_payload->>'interestLevel',
      invitation->>'kind',invitation->>'state',(invitation->>'activityId')::uuid,(invitation->>'assessorId')::uuid,
      array(select jsonb_array_elements_text(coalesce(invitation->'parentTimeOptions','[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(invitation->'assessorTimeOptions','[]'::jsonb))),
      (invitation->>'scheduledAt')::timestamptz,coalesce(invitation->>'locationText',''),next_at);
    student_id:=coalesce((contact_result->>'studentId')::uuid,student_id);
  elsif mode='enrollment' then
    if student_id is null then raise exception 'IDENTITY_NOT_CONFIRMED'; end if;
    opportunity:=p_payload->'enrollment';
    if jsonb_typeof(opportunity) is distinct from 'object' then raise exception 'VALIDATION'; end if;
    if (opportunity->>'confirm')::boolean and (not public.has_perm(actor,'enrollment.manage')
      or length(trim(coalesce(opportunity->>'paymentEvidence','')))<1) then raise exception 'PAYMENT_CONFIRMATION_REQUIRED'; end if;
    select o.id into opportunity_id from public.course_opportunities o
      where o.student_id=student_id and o.course_id=(opportunity->>'courseId')::uuid
        and o.term_id=(opportunity->>'termId')::uuid and o.opportunity_type=opportunity->>'type' for update;
    if opportunity_id is distinct from (opportunity->>'expectedOpportunityId')::uuid then raise exception 'OPPORTUNITY_CONFLICT'; end if;
    opportunity_note:=concat_ws(E'\n',nullif(note,''),nullif(trim(opportunity->>'paymentEvidence'),''));
    if length(opportunity_note)>2000 then raise exception 'VALIDATION'; end if;
    opportunity_id:=public.save_course_opportunity(opportunity_id,null,
      case when opportunity_id is null then student_id end,null,opportunity->>'type',
      (opportunity->>'courseId')::uuid,(opportunity->>'termId')::uuid,
      case when (opportunity->>'confirm')::boolean then 'committed' else opportunity->>'stage' end,
      null,'',next_at,opportunity_note);
    if (opportunity->>'confirm')::boolean then
      enrollment_id:=public.confirm_course_enrollment(opportunity_id,opportunity_note);
    end if;
    if note<>'' then insert into public.student_follow_ups(student_id,author_id,content,kind,next_follow_up_at)
      values(student_id,actor,note,'note',next_at); end if;
  else
    if student_id is null then raise exception 'CONTACT_RESULT_REQUIRED'; end if;
    insert into public.student_follow_ups(student_id,author_id,content,kind,next_follow_up_at)
      values(student_id,actor,note,'note',next_at);
  end if;
  result:=jsonb_build_object('subject',public.read_student_stage_subject(student_id,lead_id),
    'opportunityId',opportunity_id,'enrollmentId',enrollment_id,'savedAt',now());
  insert into public.student_stage_entry_receipts(actor_id,request_id,fingerprint,result)
    values(actor,p_request_id,md5(p_payload::text),result);
  return result;
end;
$$;

revoke all on function public.read_student_stage_subject(uuid,uuid) from public,anon,authenticated;
revoke all on function public.list_student_stage_workspace(text,text,text,integer,integer,text) from public,anon,authenticated;
revoke all on function public.save_student_stage_entry(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.read_student_stage_subject(uuid,uuid) to authenticated;
grant execute on function public.list_student_stage_workspace(text,text,text,integer,integer,text) to authenticated;
grant execute on function public.save_student_stage_entry(uuid,jsonb) to authenticated;
