-- 测评小状态读取实际业务事实；沟通持续追加，体验意向与预约安排分别记录。
alter table public.assessment_workflow_states
  add column trial_intent boolean not null default false,
  add column contacted_at timestamptz;
comment on column public.assessment_workflow_states.trial_intent is 'Confirmed trial interest; no scheduled activity is required.';
-- 专业结果的修订边界独立于当前家长意向，保留已有定稿时间。
do $$ declare v_name text; begin
  for v_name in select conname from pg_constraint where conrelid='public.assessment_workflow_states'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%finalized_at IS NULL%classification IS NOT NULL%'
  loop execute format('alter table public.assessment_workflow_states drop constraint %I',v_name); end loop;
end $$;

alter table public.lead_invitation_threads add column rescheduled_at timestamptz;
alter table public.activities add column rescheduled_at timestamptz;
create function public.stamp_assessment_reschedule() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if old.scheduled_at is not null and new.scheduled_at is not null and old.scheduled_at is distinct from new.scheduled_at then
    new.rescheduled_at:=clock_timestamp();
  end if;
  return new;
end $$;
create trigger lead_invitation_rescheduled before update of scheduled_at on public.lead_invitation_threads
  for each row execute function public.stamp_assessment_reschedule();
create trigger activity_rescheduled before update of scheduled_at on public.activities
  for each row execute function public.stamp_assessment_reschedule();
revoke all on function public.stamp_assessment_reschedule() from public,anon,authenticated;

create or replace function public.save_assessment_workflow(
  p_registration_id uuid default null,p_invitation_id uuid default null,p_command text default 'visit',
  p_expected_revision integer default 0,p_values jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_id uuid:=p_registration_id; v_state public.assessment_workflow_states%rowtype;
  v_registration public.activity_registrations%rowtype; v_report uuid; v_classification text:=p_values->>'classification';
  v_route text; v_reasons text[]; v_trial boolean; v_shared uuid; v_complete boolean;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  -- 兼容旧客户端的安全边界：导航不能物化预约、签到或确认报告发送。
  if p_command='visit' then raise exception 'ASSESSMENT_NAVIGATION_READ_ONLY'; end if;
  if num_nonnulls(p_registration_id,p_invitation_id)<>1 or p_expected_revision is null or p_expected_revision<0
    or p_command is null or p_command not in ('report','classify','revise') or p_values is null or jsonb_typeof(p_values)<>'object'
    then raise exception 'VALIDATION'; end if;
  if p_invitation_id is not null then v_id:=public.ensure_quick_assessment_registration(null,p_invitation_id); end if;
  select r.* into v_registration from public.activity_registrations r join public.activities a on a.id=r.activity_id
    where r.id=v_id and a.deleted_at is null and a.record_state='current' for update of r;
  if not found or v_registration.status in ('cancelled','no_show') then raise exception 'PARTICIPATION_UNAVAILABLE'; end if;
  perform public.require_current_business_record('activity_registrations',v_id);
  if not (public.can_record_teacher_assessment(v_id,v_uid)
    or ((public.has_perm(v_uid,'review.write') or public.has_perm(v_uid,'followup.write')) and public.can_follow_up_participation(v_id,v_uid)))
    then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into v_state from public.assessment_workflow_states where registration_id=v_id for update;
  if coalesce(v_state.revision,0)<>p_expected_revision then raise exception 'ASSESSMENT_WORKFLOW_CONFLICT'; end if;
  v_complete:=v_registration.assessment_completed_at is not null or exists(
    select 1 from public.assessment_results where activity_registration_id=v_id and
      (result_finalized_at is not null or (result_source='legacy' and v_registration.assessment_started_at is null)))
    or exists(select 1 from public.public_class_participant_records where registration_id=v_id and btrim(assessment_summary)<>'');
  if v_state.id is null then
    insert into public.assessment_workflow_states(registration_id,stage,arrived_at,updated_by)
      values(v_id,case when v_complete then 'feedback' when v_registration.status='attended' then 'in_progress' else 'pending' end,
        case when v_registration.status='attended' then clock_timestamp() end,v_uid) returning * into v_state;
  end if;
  if p_command='revise' then
    if v_state.finalized_at is null or nullif(btrim(p_values->>'reason'),'') is null or length(p_values->>'reason')>500
      or (p_values-'reason')<>'{}'::jsonb then raise exception 'VALIDATION'; end if;
    update public.assessment_workflow_states set finalized_at=null,revision_reason=btrim(p_values->>'reason'),last_action='revise'
      where registration_id=v_id returning * into v_state;
  elsif p_command='report' then
    if p_values<>'{}'::jsonb then raise exception 'VALIDATION'; end if;
    v_report:=public.ensure_assessment_report(v_id);
    if v_report is null then raise exception 'ASSESSMENT_REPORT_NOT_READY'; end if;
    update public.assessment_workflow_states set report_id=v_report,last_action='report'
      where registration_id=v_id returning * into v_state;
  else
    if (v_classification is not null and v_classification not in ('awaiting_reply','considering','ready_to_enroll','awaiting_class','not_enrolling'))
      or jsonb_typeof(p_values->'parentResponse') is distinct from 'string' or length(p_values->>'parentResponse')>2000
      or jsonb_typeof(p_values->'reasons') is distinct from 'array'
      or (p_values ? 'trialIntent' and jsonb_typeof(p_values->'trialIntent') is distinct from 'boolean')
      or (p_values-array['classification','parentResponse','reasons','nextContactAt','trialIntent','sharedReportId'])<>'{}'::jsonb
      then raise exception 'VALIDATION'; end if;
    select coalesce(array_agg(distinct value),'{}'::text[]) into v_reasons from jsonb_array_elements_text(p_values->'reasons');
    if not v_reasons <@ array['price','schedule','distance','child_preference','other']::text[] then raise exception 'VALIDATION'; end if;
    v_trial:=coalesce((p_values->>'trialIntent')::boolean,v_state.trial_intent);
    v_shared:=(p_values->>'sharedReportId')::uuid;
    if v_shared is not null and (v_state.report_id is distinct from v_shared or not v_complete) then
      raise exception 'ASSESSMENT_WORKFLOW_CONFLICT'; end if;
    if v_classification is null and btrim(p_values->>'parentResponse')='' and not v_trial and v_shared is null
      and v_state.contacted_at is null and v_state.classification is null then raise exception 'VALIDATION'; end if;
    v_route:=case when v_classification='not_enrolling' then 'closed' when v_classification='awaiting_class' then 'await_product' else 'continue_follow_up' end;
    if public.has_perm(v_uid,'followup.write') and public.can_follow_up_participation(v_id,v_uid) then
      if exists(select 1 from public.activity_routes ar join public.course_enrollments e on e.id=ar.course_enrollment_id
        where ar.activity_registration_id=v_id and e.status='active') then v_route:='enrollment_pending'; end if;
      perform public.save_post_activity_contact(v_id,gen_random_uuid(),'other',case when v_classification='awaiting_reply' then 'unreachable' else 'connected' end,
        v_route,btrim(p_values->>'parentResponse'),(p_values->>'nextContactAt')::timestamptz);
    end if;
    update public.assessment_workflow_states set
      stage=case when v_complete then case when (v_classification is not null and v_classification<>'awaiting_reply') or v_trial then 'handled' else 'feedback' end
        when v_registration.status='attended' or v_registration.assessment_started_at is not null then 'in_progress' else 'pending' end,
      classification=v_classification,trial_intent=v_trial,contacted_at=clock_timestamp(),parent_response=btrim(p_values->>'parentResponse'),
      reasons=v_reasons,next_contact_at=(p_values->>'nextContactAt')::timestamptz,
      finalized_at=case when v_complete then coalesce(finalized_at,clock_timestamp()) else finalized_at end,
      sent_report_id=coalesce(v_shared,sent_report_id),
      sent_at=case when v_shared is not null and sent_report_id is distinct from v_shared then clock_timestamp() else sent_at end,
      sent_by=case when v_shared is not null then v_uid else sent_by end,
      last_action='classify' where registration_id=v_id returning * into v_state;
  end if;
  return jsonb_build_object('registrationId',v_id,'activityId',v_registration.activity_id,'participationStatus',v_registration.status,'state',to_jsonb(v_state));
end $$;
revoke all on function public.save_assessment_workflow(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_assessment_workflow(uuid,uuid,text,integer,jsonb) to authenticated;
select pg_notify('pgrst','reload schema');
