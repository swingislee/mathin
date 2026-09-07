-- 报名来源确认业务进展；单次预约的出席、成绩和原始凭据分别保留。
alter table public.activity_registrations add column source_enrollment_facts jsonb;
alter table public.course_enrollments add column source_enrollment_facts jsonb;

do $$
declare relation text;
begin
  foreach relation in array array['activity_registrations','course_enrollments'] loop
    execute format('alter table public.%I add constraint %I check (source_enrollment_facts is null or (
      source_record_id is not null and jsonb_typeof(source_enrollment_facts)=''object''
      and source_enrollment_facts @> ''{"version":1,"confirmed":true}''::jsonb
      and source_enrollment_facts ?& array[''assessmentBand'',''registeredOn'']
      and source_enrollment_facts - array[''version'',''confirmed'',''assessmentBand'',''registeredOn'']=''{}''::jsonb
      and (source_enrollment_facts->''assessmentBand''=''null''::jsonb or source_enrollment_facts->>''assessmentBand'' in (''x_plus'',''g_plus'',''a'',''a_plus'',''s'',''c''))
      and (source_enrollment_facts->''registeredOn''=''null''::jsonb or (
        source_enrollment_facts->>''registeredOn'' ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$''
        and source_enrollment_facts->>''registeredOn''=(source_enrollment_facts->>''registeredOn'')::date::text))
    ))',relation,relation||'_source_enrollment_facts_check');
    execute format('grant select(source_enrollment_facts) on public.%I to authenticated',relation);
  end loop;
end;
$$;

create function public.guard_source_enrollment_facts() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if auth.uid() is not null and old.source_enrollment_facts is distinct from new.source_enrollment_facts then
    raise exception 'SOURCE_FACTS_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger activity_registrations_source_facts_guard before update of source_enrollment_facts on public.activity_registrations
for each row execute function public.guard_source_enrollment_facts();
create trigger course_enrollments_source_facts_guard before update of source_enrollment_facts on public.course_enrollments
for each row execute function public.guard_source_enrollment_facts();
revoke all on function public.guard_source_enrollment_facts() from public,anon,authenticated,service_role;

create or replace function public.get_student_lifecycle(p_student_id uuid, p_lead_id uuid)
returns text language plpgsql security definer stable set search_path=public,pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_student_id uuid := p_student_id;
  v_lead public.leads%rowtype;
  v_lead_ids uuid[];
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.is_staff(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_lead_id is not null then
    select * into v_lead from public.leads where id=p_lead_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    if p_student_id is not null and v_lead.student_id is distinct from p_student_id then raise exception 'SUBJECT_MISMATCH'; end if;
    v_student_id:=coalesce(p_student_id,v_lead.student_id);
  end if;
  if not coalesce((
    (v_student_id is not null and public.can_access_student(v_student_id,v_uid))
    or (v_lead.id is not null and public.has_perm(v_uid,'followup.view')
      and (v_lead.owner_id is null or v_lead.owner_id=v_uid or public.has_perm(v_uid,'student.view.all')))
    or (v_lead.id is not null and v_lead.created_by=v_uid and public.has_perm(v_uid,'student.import'))
    or (v_lead.id is not null and (public.has_assigned_invitation_lead(v_uid,v_lead.id)
      or public.has_assessment_history_lead_access(v_lead.id)))
  ),false) or (v_student_id is null and v_lead.id is null) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_lead_ids from public.leads
    where id=p_lead_id or (v_student_id is not null and student_id=v_student_id);

  if (v_student_id is not null and (
    exists(select 1 from public.course_enrollments where student_id=v_student_id)
    or exists(select 1 from public.enrollments where student_id=v_student_id)))
    or exists(select 1 from public.activity_registrations r
      where (r.student_id=v_student_id or r.lead_id=any(v_lead_ids))
      and r.source_enrollment_facts @> '{"confirmed":true}'::jsonb)
  then return 'awaiting_renewal'; end if;
  if exists(select 1 from public.assessment_results a
    join public.activity_registrations r on r.id=a.activity_registration_id
    where (a.student_id=v_student_id or a.lead_id=any(v_lead_ids))
      and (a.source_record_id is null or (r.status='attended' and (
        a.assessment_band is not null or a.score is not null or r.assessment_completed_at is not null
        or a.strengths ~ '(^|[\r\n])(原测评等级|学习力测评等级)：'))))
  then return 'awaiting_enrollment'; end if;
  if exists(
    select 1 from public.lead_communications communication
    left join lateral (
      select revision.effective_patch from public.communication_record_revisions revision
      where revision.source='contact' and revision.event_id=communication.id
      order by revision.revision_no desc limit 1
    ) correction on true
    where communication.lead_id=any(v_lead_ids)
      and coalesce(correction.effective_patch->>'outcome',communication.outcome) in ('connected','declined')
  ) then return 'awaiting_assessment'; end if;
  return 'awaiting_first_contact';
end;
$$;
