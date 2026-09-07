-- 导入资料的当前工作范围独立于学生身份、原始状态和历史业务事实。
create table public.history_workflow_scopes (
  student_id uuid references public.students(id),
  lead_id uuid references public.leads(id),
  record_id text references public.history_import_records(id),
  scope_key text generated always as (coalesce('student:'||student_id,'lead:'||lead_id,'record:'||record_id)) stored primary key,
  reason text not null check (reason in ('reference_only','processed_prior_period')),
  current_period text not null check (current_period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  latest_period text,
  source_ids text[] not null,
  source_filename text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_at timestamptz not null default now(),
  resumed_at timestamptz,
  check (num_nonnulls(student_id,lead_id,record_id)=1)
);
alter table public.history_workflow_scopes enable row level security;
revoke all on public.history_workflow_scopes from public,anon,authenticated;
create unique index history_workflow_scope_student on public.history_workflow_scopes(student_id) where resumed_at is null;
create unique index history_workflow_scope_lead on public.history_workflow_scopes(lead_id) where resumed_at is null;
create unique index history_workflow_scope_record on public.history_workflow_scopes(record_id) where resumed_at is null;

create function public.business_source_is_authoritative(p_record_id text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_record_id is null or exists(select 1 from public.history_import_records r
    where r.id=p_record_id and r.source_data->>'format'='feishu-base');
$$;
create function public.business_source_is_current(p_record_id text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from public.history_workflow_scopes s
    where s.record_id=p_record_id and s.resumed_at is null);
$$;
create function public.business_subject_is_current(p_student_id uuid,p_lead_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select not exists(select 1 from public.history_workflow_scopes s where s.resumed_at is null
    and (s.student_id=p_student_id or s.lead_id=p_lead_id));
$$;
revoke all on function public.business_source_is_authoritative(text),public.business_source_is_current(text),
  public.business_subject_is_current(uuid,uuid) from public,anon;
grant execute on function public.business_source_is_authoritative(text),public.business_source_is_current(text),
  public.business_subject_is_current(uuid,uuid) to authenticated,service_role;

create view public.operational_leads with (security_invoker=true) as
  select l.* from public.leads l where public.business_subject_is_current(l.student_id,l.id);
grant select on public.operational_leads to authenticated,service_role;
create view public.operational_students with (security_invoker=true) as
  select s.* from public.students s where public.business_subject_is_current(s.id,null);
grant select on public.operational_students to authenticated,service_role;

-- 业务读取保留原表 RLS。参考表仍可在来源档案核对；旧月资料使用已有历史状态展示。
do $views$
declare relation text; columns text;
begin
  foreach relation in array array['lead_communications','activities','activity_registrations','assessment_results',
    'course_enrollments','course_opportunities','student_follow_ups'] loop
    select string_agg(case when a.attname='record_state' then
      'case when public.business_source_is_current(r.source_record_id) then r.record_state else ''historical''::text end as record_state'
      else format('r.%I',a.attname) end,',' order by a.attnum) into columns
      from pg_attribute a where a.attrelid=('public.'||relation)::regclass and a.attnum>0 and not a.attisdropped;
    execute format('create view public.%I with (security_invoker=true) as select %s from public.%I r where public.business_source_is_authoritative(r.source_record_id)',
      'business_'||relation,columns,relation);
    execute format('grant select on public.%I to authenticated,service_role','business_'||relation);
  end loop;
end;
$views$;

-- 报名可沿明确的同一来源行找到业务主体；姓名相似不建立关联。
create view public.business_course_enrollment_subjects with (security_invoker=true) as
select e.*,coalesce('student:'||e.student_id,refs.subject_key) as subject_key
from public.business_course_enrollments e
left join lateral (
  select case when count(distinct key)=1 then min(key) end as subject_key from (
    select 'student:'||a.student_id as key from public.history_import_associations a where a.record_id=e.source_record_id
    union all select coalesce('student:'||l.student_id,'lead:'||l.id) from public.leads l where l.source_record_id=e.source_record_id
    union all select coalesce('student:'||o.student_id,'student:'||l.student_id,'lead:'||o.lead_id)
      from public.course_opportunities o left join public.leads l on l.id=o.lead_id
      where o.id=e.opportunity_id or o.source_record_id=e.source_record_id
    union all select coalesce('student:'||r.student_id,'student:'||l.student_id,'lead:'||r.lead_id)
      from public.activity_registrations r left join public.leads l on l.id=r.lead_id where r.source_record_id=e.source_record_id
  ) candidates where key is not null
) refs on e.student_id is null;
grant select on public.business_course_enrollment_subjects to authenticated,service_role;

-- 新登记的业务会恢复该人的当前工作范围；导入重跑和历史更正保留归档决定。
create function public.resume_history_workflow_subject()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare payload jsonb:=to_jsonb(new); v_student_id uuid; v_lead_id uuid;
begin
  if payload->>'source_record_id' is not null then return new; end if;
  if tg_table_name='lead_next_actions' and (payload->>'status'<>'open' or payload->>'kind'='initial_contact') then return new; end if;
  v_student_id:=(payload->>'student_id')::uuid; v_lead_id:=(payload->>'lead_id')::uuid;
  if v_lead_id is not null then select coalesce(v_student_id,l.student_id) into v_student_id from public.leads l where l.id=v_lead_id; end if;
  update public.history_workflow_scopes s set resumed_at=clock_timestamp()
    where s.resumed_at is null and (s.student_id=v_student_id or s.lead_id=v_lead_id);
  return new;
end;
$$;
revoke all on function public.resume_history_workflow_subject() from public,anon,authenticated;
do $triggers$
declare relation text;
begin
  foreach relation in array array['lead_communications','activity_registrations','course_enrollments',
    'course_opportunities','student_follow_ups','lead_next_actions'] loop
    execute format('create trigger resume_history_workflow_subject after insert on public.%I for each row execute function public.resume_history_workflow_subject()',relation);
  end loop;
end;
$triggers$;

-- 批量归类用于计数和分页；完整个人快照只读取当前页。
create or replace function public.student_stage_workspace_index(p_scope text,p_search text)
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
  ), contact_flags as (select c.key from contacts c where c.outcome in ('connected','declined') group by c.key),
  latest_contacts as (select distinct on(c.key) c.key,c.outcome from contacts c where c.visible order by c.key,c.occurred_at desc,c.id),
  registration_refs as materialized (
    select 'student:'||r.student_id as key,r.id from public.business_activity_registrations r where r.student_id is not null
    union select l.key,r.id from public.business_activity_registrations r join lead_refs l on l.id=r.lead_id
  ), enrollment_facts as (
    select e.subject_key as key,
      e.status='active' and e.record_state='current' and (t.ends_on is null or t.ends_on>=today) as active,
      false as membership from public.business_course_enrollment_subjects e left join public.school_terms t on t.id=e.term_id
    union all
    select 'student:'||e.student_id,
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today),
      e.status='active' and e.left_at is null and (t.ends_on is null or t.ends_on>=today)
      from public.enrollments e join public.classrooms c on c.id=e.classroom_id left join public.school_terms t on t.id=c.term_id
    union all
    select ref.key,r.record_state='current' and not exists(select 1 from public.business_course_enrollment_subjects e where e.subject_key=ref.key),false
      from registration_refs ref join public.business_activity_registrations r on r.id=ref.id where r.source_enrollment_facts @> '{"confirmed":true}'::jsonb
  ), enrollment_flags as (
    select f.key,bool_or(f.active) as active,bool_or(f.membership) as membership from enrollment_facts f group by f.key
  ), latest_enrollments as (
    select distinct on(e.subject_key) e.subject_key,e.status from public.business_course_enrollment_subjects e
      order by e.subject_key,(e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id
  ), assessments as materialized (
    select distinct on(ref.key) ref.key,r.id as registration_id
      from registration_refs ref join public.business_activity_registrations r on r.id=ref.id
      join public.business_assessment_results a on a.activity_registration_id=r.id
      where r.status not in ('no_show','cancelled') and (r.assessment_completed_at is not null or a.result_finalized_at is not null
        or (a.result_source='legacy' and (a.score is not null or a.assessment_band is not null
          or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：')))
      order by ref.key,coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id
  ), appointments as (
    select distinct on(ref.key) ref.key,r.status,r.assessment_started_at
      from registration_refs ref join public.business_activity_registrations r on r.id=ref.id join public.business_activities a on a.id=r.activity_id
      where a.deleted_at is null and a.kind in ('assessment_1v1','assessment')
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
$$;

-- 学生名单按人归类；预约、沟通、测评与课程关系继续保存在各自业务表。
create or replace function public.read_student_stage_subject(p_student_id uuid, p_lead_id uuid)
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
    from public.business_lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.lead_id=any(visible_lead_ids)
    order by c.occurred_at desc,c.id limit 1;
  select exists(select 1 from public.business_lead_communications c left join lateral (
      select effective_patch from public.communication_record_revisions r
      where r.source='contact' and r.event_id=c.id order by revision_no desc limit 1
    ) r on true where c.lead_id=any(lead_ids)
      and coalesce(r.effective_patch->>'outcome',c.outcome) in ('connected','declined')) into has_contact;

  select exists(select 1 from public.business_activity_registrations r
      where (r.student_id=student.id or r.lead_id=any(lead_ids))
        and r.source_enrollment_facts @> '{"confirmed":true}'::jsonb),
    exists(select 1 from public.business_activity_registrations r
      where (r.student_id=student.id or r.lead_id=any(lead_ids)) and r.record_state='current'
        and r.source_enrollment_facts @> '{"confirmed":true}'::jsonb)
    into has_source_enrollment,has_current_source_enrollment;
  select exists(select 1 from public.business_course_enrollment_subjects e where e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id))
      or exists(select 1 from public.enrollments e where e.student_id=student.id)
      or has_source_enrollment,
    exists(select 1 from public.business_course_enrollment_subjects e left join public.school_terms t on t.id=e.term_id
      where e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) and e.status='active' and e.record_state='current'
        and (t.ends_on is null or t.ends_on >= today))
      or exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
        left join public.school_terms t on t.id=c.term_id
        where e.student_id=student.id and e.status='active' and e.left_at is null
          and (t.ends_on is null or t.ends_on >= today))
      or (has_current_source_enrollment and not exists(select 1 from public.business_course_enrollment_subjects e where e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id)))
    into has_enrollment,has_active_enrollment;
  select exists(select 1 from public.enrollments e join public.classrooms c on c.id=e.classroom_id
    left join public.school_terms t on t.id=c.term_id
    where e.student_id=student.id and e.status='active' and e.left_at is null
      and (t.ends_on is null or t.ends_on >= today)) into has_membership;

  -- 空记录和未到场均不代表测评完成；专业结果仍采用现有定稿事实。
  select a.score,a.assessment_band,a.teacher_recommendation,r.id as registration_id,
    coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) as completed_at into assessment
    from public.business_assessment_results a join public.business_activity_registrations r on r.id=a.activity_registration_id
    where (r.student_id=student.id or r.lead_id=any(lead_ids)) and r.status not in ('no_show','cancelled')
      and (r.assessment_completed_at is not null or a.result_finalized_at is not null
        or (a.result_source='legacy' and (a.score is not null or a.assessment_band is not null
          or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：')))
    order by coalesce(r.assessment_completed_at,a.result_finalized_at,a.updated_at) desc,a.id limit 1;
  has_assessment := assessment.registration_id is not null;
  select r.id,r.status,r.assessment_started_at,a.scheduled_at into appointment
    from public.business_activity_registrations r join public.business_activities a on a.id=r.activity_id
    where (r.student_id=student.id or r.lead_id=any(lead_ids)) and a.deleted_at is null
      and a.kind in ('assessment_1v1','assessment')
    order by coalesce(a.scheduled_at,r.created_at) desc,r.id limit 1;
  select * into invitation from public.lead_invitation_threads i
    where i.lead_id=lead.id and i.state not in ('completed','cancelled')
    order by i.updated_at desc,i.id limit 1;
  select e.id,e.status,c.title,t.name as term_name,e.course_id,e.term_id into enrollment
    from public.business_course_enrollment_subjects e left join public.courses c on c.id=e.course_id left join public.school_terms t on t.id=e.term_id
    where e.subject_key=coalesce('student:'||student.id,'lead:'||lead.id) order by (e.status='active' and e.record_state='current') desc,e.confirmed_at desc,e.id limit 1;
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
$$;


-- 既有只读业务 RPC 采用同一来源边界及历史状态，保持其鉴权与返回合同。
do $readers$
declare f record; definition text; relation text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('get_student_lifecycle','get_post_activity_followups','get_enrollment_placement_board','get_activity_enrollment_context') loop
    definition:=pg_get_functiondef(f.oid);
    foreach relation in array array['lead_communications','activities','activity_registrations','assessment_results','course_enrollments','course_opportunities','student_follow_ups'] loop
      definition:=replace(definition,'public.'||relation||' ','public.business_'||relation||' ');
    end loop;
    execute definition;
  end loop;
end;
$readers$;
notify pgrst,'reload schema';
