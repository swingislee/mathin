-- 学习背景跨当前/历史读取；办理阶段仍由原阶段合同计算。
create index if not exists history_import_base_table_filename_idx on public.history_import_records
  ((record_data->>'tableName'),(source_data->>'filename')) where source_data->>'format'='feishu-base';

create function public.student_learning_band(p_value text) returns text
language sql immutable set search_path=public,pg_temp as $$
  select case upper(regexp_replace(coalesce(p_value,''),'\s','','g'))
    when '未达A' then 'x_plus' when 'BELOW_A' then 'x_plus' when 'X+' then 'x_plus' when 'X＋' then 'x_plus' when 'X_PLUS' then 'x_plus'
    when 'G+' then 'g_plus' when 'G＋' then 'g_plus' when 'G_PLUS' then 'g_plus'
    when 'A' then 'a' when 'A+' then 'a_plus' when 'A＋' then 'a_plus' when 'A_PLUS' then 'a_plus'
    when 'S' then 's' when 'C' then 'c' else null end;
$$;
revoke all on function public.student_learning_band(text) from public,anon,authenticated,service_role;
grant execute on function public.student_learning_band(text) to postgres;

-- 只由已完成学员权限核对的读取函数调用；来源署名不会自动授予账号权限。
create function public.student_stage_learning_background(p_student_id uuid,p_lead_id uuid,p_stage text,p_preferred_source_id text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_variable
declare
  lead_ids uuid[]; source_ids text[]; sources jsonb; person public.students%rowtype;
  actual_assessment record; class_fact record; source_fact record;
  owner_name text; teacher_name text; teacher_id uuid;
  band text; learning_band text; class_band text; background_source text;
  candidate_count integer:=0;
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

  -- 原始候选保留给人工确认；同名资料不在读取时自动绑定学员。
  select count(distinct h.id)::integer into candidate_count from public.history_import_identity_candidates ic
    join public.history_import_records h on h.id=ic.record_id
    where ic.student_id=p_student_id and h.source_data->>'format'='feishu-base' and not h.id=any(source_ids)
      and exists(select 1 from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
        where a.source_record_id=h.id and r.status not in ('no_show','cancelled') and
          (r.assessment_completed_at is not null or a.result_finalized_at is not null or a.result_source='legacy' and
            (a.score is not null or a.assessment_band is not null or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：')));

  select a.id,a.score,a.assessment_band,a.assessed_by,r.id as registration_id,a.source_record_id,
    coalesce(a.assessed_on,(coalesce(r.assessment_completed_at,a.result_finalized_at) at time zone public.get_organization_timezone_v2())::date,
      act.occurred_on,(act.scheduled_at at time zone public.get_organization_timezone_v2())::date) as assessed_on,
    nullif(substring(a.strengths from '(?:^|[\r\n])学习力测评等级：([^\r\n]+)'),'') as learning_band
    into actual_assessment from public.business_assessment_results a
      join public.business_activity_registrations r on r.id=a.activity_registration_id
      join public.business_activities act on act.id=r.activity_id
    where (a.student_id=p_student_id or r.student_id=p_student_id or a.lead_id=any(lead_ids) or r.lead_id=any(lead_ids)
      or a.source_record_id=any(source_ids) or r.source_record_id=any(source_ids))
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
    'learningBand',learning_band,'classBandLabel',coalesce(class_band,''),'assessmentCandidateCount',candidate_count);
end;
$$;
revoke all on function public.student_stage_learning_background(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.student_stage_learning_background(uuid,uuid,text,text) to postgres;

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
  select exists(select 1 from unnest(p_enrollments) e where e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) and e.record_state='current')
      or exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id left join public.school_terms t on t.id=c.term_id
        where e.student_id=student.id and e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today))
      or has_source_enrollment,
    exists(select 1 from unnest(p_enrollments) e left join public.school_terms t on t.id=e.term_id
      where e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) and e.status='active' and e.record_state='current'
        and (t.ends_on is null or t.ends_on >= today))
      or exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
        left join public.school_terms t on t.id=c.term_id
        where e.student_id=student.id and e.status='active' and e.left_at is null
          and (t.ends_on is null or t.ends_on >= today))
      or (has_current_source_enrollment and not exists(select 1 from unnest(p_enrollments) e where e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) and e.record_state='current'))
    into has_enrollment,has_active_enrollment;
  select exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
    left join public.school_terms t on t.id=c.term_id
    where e.student_id=student.id and e.status='active' and e.left_at is null
      and (t.ends_on is null or t.ends_on >= today)) into has_membership;

  -- 空记录和未到场均不代表测评完成；专业结果仍采用现有定稿事实。
  select a.score,a.assessment_band,a.teacher_recommendation,a.source_record_id,r.id as registration_id,
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
    from unnest(p_enrollments) e left join public.courses c on c.id=e.course_id left join public.school_terms t on t.id=e.term_id
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
$function$
;
