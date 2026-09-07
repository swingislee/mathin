-- 四步测评：阶段登记、家长版报告快照、发送确认、家长归类与显式修订。
-- 增量建模，不回填或改写既有业务记录；既有测评/报名事实继续由原入口维护。
create table public.assessment_reports (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.activity_registrations(id) on delete restrict,
  version integer not null check(version>0),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  content_hash text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(registration_id,version), unique(registration_id,content_hash)
);
create table public.assessment_workflow_states (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.activity_registrations(id) on delete restrict,
  stage text not null check(stage in ('pending','in_progress','feedback','handled')),
  revision integer not null default 1 check(revision>0),
  arrived_at timestamptz,
  report_id uuid references public.assessment_reports(id) on delete restrict,
  sent_report_id uuid references public.assessment_reports(id) on delete restrict,
  sent_at timestamptz,
  sent_by uuid references public.profiles(id) on delete restrict,
  classification text check(classification in ('awaiting_reply','considering','ready_to_enroll','awaiting_class','not_enrolling')),
  parent_response text not null default '' check(length(parent_response)<=2000),
  reasons text[] not null default '{}' check(reasons <@ array['price','schedule','distance','child_preference','other']::text[]),
  next_contact_at timestamptz,
  finalized_at timestamptz,
  revision_reason text not null default '' check(length(revision_reason)<=500),
  last_action text not null default 'initialize',
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  check((sent_report_id is null and sent_at is null and sent_by is null) or (sent_report_id is not null and sent_at is not null and sent_by is not null)),
  check(finalized_at is null or classification is not null)
);
create table public.assessment_workflow_events (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.activity_registrations(id) on delete restrict,
  action text not null,
  previous_values jsonb,
  saved_values jsonb not null,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp()
);
create index assessment_workflow_events_registration_idx on public.assessment_workflow_events(registration_id,recorded_at desc,id);
alter table public.assessment_reports enable row level security;
alter table public.assessment_workflow_states enable row level security;
alter table public.assessment_workflow_events enable row level security;
revoke all on public.assessment_reports,public.assessment_workflow_states,public.assessment_workflow_events from public,anon,authenticated;
grant select on public.assessment_reports,public.assessment_workflow_states,public.assessment_workflow_events to authenticated;
create policy assessment_reports_read on public.assessment_reports for select to authenticated using(public.can_read_assessment_entry(registration_id));
create policy assessment_workflow_states_read on public.assessment_workflow_states for select to authenticated using(public.can_read_assessment_entry(registration_id));
create policy assessment_workflow_events_read on public.assessment_workflow_events for select to authenticated using(public.can_read_assessment_entry(registration_id));
create trigger assessment_reports_immutable before update or delete on public.assessment_reports for each row execute function public.guard_phase3_enrollment_history();
create trigger assessment_workflow_events_immutable before update or delete on public.assessment_workflow_events for each row execute function public.guard_phase3_enrollment_history();

create function public.stamp_assessment_workflow() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  new.updated_by:=auth.uid(); new.updated_at:=clock_timestamp();
  if tg_op='UPDATE' then new.revision:=old.revision+1; end if;
  return new;
end $$;
create function public.audit_assessment_workflow() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.assessment_workflow_events(registration_id,action,previous_values,saved_values,recorded_by)
    values(new.registration_id,new.last_action,case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new),auth.uid());
  return new;
end $$;
create trigger assessment_workflow_stamp before insert or update on public.assessment_workflow_states for each row execute function public.stamp_assessment_workflow();
create trigger assessment_workflow_audit after insert or update on public.assessment_workflow_states for each row execute function public.audit_assessment_workflow();

-- 报告只取专业结果白名单，不含手机号、内部家长顾虑、沟通备注或背景。
-- 同一参与者的公开课测评环节合成一份报告；签到/归类也属于该参与者。
create function public.ensure_assessment_report(p_registration_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payload jsonb; v_id uuid;
begin
  select jsonb_build_object('schemaVersion',1,'name',coalesce(s.name,l.provisional_student_name,''),
    'grade',coalesce(s.grade,l.grade_hint),'gradeText',coalesce(l.grade_text,''),'activityTitle',a.title,
    'assessedAt',coalesce(ar.result_finalized_at,r.assessment_completed_at,ar.updated_at,pr.updated_at),
    'resultSource',coalesce(ar.result_source,'activity'),'recordedByName',coalesce(p.display_name,pr.recorder_names,''),
    'score',ar.score,'totalScore',pv.total_score,'assessmentBand',ar.assessment_band,
    'strengths',coalesce(ar.strengths,''),'focusAreas',coalesce(ar.focus_areas,''),
    'teacherObservation',coalesce(nullif(ar.teacher_observation,''),pr.summary,''),
    'recommendation',coalesce(nullif(ar.teacher_recommendation,''),pr.recommendation,''),
    'recommendedClass',coalesce(ar.recommended_class,'')) into v_payload
  from public.activity_registrations r join public.activities a on a.id=r.activity_id
  left join public.students s on s.id=r.student_id left join public.leads l on l.id=r.lead_id
  left join public.assessment_results ar on ar.activity_registration_id=r.id
  left join public.profiles p on p.id=ar.assessed_by
  left join public.assessment_paper_versions pv on pv.id=r.assessment_paper_version_id
  left join lateral (select string_agg(seg.title||': '||rec.assessment_summary,E'\n' order by seg.scheduled_at,seg.id) summary,
    string_agg(nullif(rec.recommendation,''),E'\n' order by seg.scheduled_at,seg.id) recommendation,max(rec.updated_at) updated_at,
    string_agg(distinct recorder.display_name,' / ') recorder_names
    from public.public_class_participant_records rec join public.public_class_segments seg on seg.id=rec.segment_id
    left join public.profiles recorder on recorder.id=rec.updated_by
    where rec.registration_id=r.id and btrim(rec.assessment_summary)<>'') pr on true
  where r.id=p_registration_id and (ar.result_finalized_at is not null or r.assessment_completed_at is not null
    or (ar.result_source='legacy' and r.assessment_started_at is null) or pr.summary is not null);
  if v_payload is null then return null; end if;
  select id into v_id from public.assessment_reports where registration_id=p_registration_id and content_hash=md5(v_payload::text);
  if v_id is null then
    insert into public.assessment_reports(registration_id,version,payload,content_hash,created_by)
      select p_registration_id,coalesce(max(version),0)+1,v_payload,md5(v_payload::text),auth.uid()
      from public.assessment_reports where registration_id=p_registration_id returning id into v_id;
  end if;
  return v_id;
end $$;

create function public.save_assessment_workflow(
  p_registration_id uuid default null,p_invitation_id uuid default null,p_command text default 'visit',
  p_expected_revision integer default 0,p_values jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_id uuid:=p_registration_id; v_state public.assessment_workflow_states%rowtype;
  v_registration public.activity_registrations%rowtype; v_report uuid; v_stage text:=p_values->>'stage';
  v_classification text:=p_values->>'classification'; v_route text; v_reasons text[];
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if num_nonnulls(p_registration_id,p_invitation_id)<>1 or p_expected_revision is null or p_expected_revision<0
    or p_command is null or p_command not in ('visit','report','classify','revise') or p_values is null or jsonb_typeof(p_values)<>'object'
    then raise exception 'VALIDATION'; end if;
  if p_invitation_id is not null then v_id:=public.ensure_quick_assessment_registration(null,p_invitation_id); end if;
  select r.* into v_registration from public.activity_registrations r join public.activities a on a.id=r.activity_id
    where r.id=v_id and a.deleted_at is null and a.record_state='current' for update of r;
  if not found then raise exception 'PARTICIPATION_UNAVAILABLE'; end if;
  perform public.require_current_business_record('activity_registrations',v_id);
  if not (public.can_record_teacher_assessment(v_id,v_uid)
    or ((public.has_perm(v_uid,'review.write') or public.has_perm(v_uid,'followup.write')) and public.can_follow_up_participation(v_id,v_uid)))
    then raise exception 'FORBIDDEN_SCOPE'; end if;
  select * into v_state from public.assessment_workflow_states where registration_id=v_id for update;
  if coalesce(v_state.revision,0)<>p_expected_revision then raise exception 'ASSESSMENT_WORKFLOW_CONFLICT'; end if;
  -- 完成归类后，阶段点击连事件也不新增。旧客户端同样只读。
  if v_state.finalized_at is not null and p_command in ('visit','report') then
    return jsonb_build_object('registrationId',v_id,'activityId',v_registration.activity_id,'participationStatus',v_registration.status,'state',to_jsonb(v_state));
  end if;
  if v_registration.status in ('cancelled','no_show') then raise exception 'PARTICIPATION_UNAVAILABLE'; end if;
  if v_state.finalized_at is not null and p_command<>'revise' then raise exception 'ASSESSMENT_WORKFLOW_FINALIZED'; end if;
  if v_state.id is null then
    insert into public.assessment_workflow_states(registration_id,stage,arrived_at,updated_by)
      values(v_id,case when v_registration.status='attended' then 'in_progress' else 'pending' end,
        case when v_registration.status='attended' then clock_timestamp() end,v_uid) returning * into v_state;
  end if;
  if p_command='revise' then
    if v_state.finalized_at is null or nullif(btrim(p_values->>'reason'),'') is null or length(p_values->>'reason')>500
      or (p_values-'reason')<>'{}'::jsonb then raise exception 'VALIDATION'; end if;
    update public.assessment_workflow_states set finalized_at=null,revision_reason=btrim(p_values->>'reason'),last_action='revise'
      where registration_id=v_id returning * into v_state;
  elsif p_command='visit' then
    if v_stage is null or v_stage not in ('pending','in_progress','feedback','handled') or (p_values-'stage')<>'{}'::jsonb then raise exception 'VALIDATION'; end if;
    update public.activity_registrations set status=case when v_stage='pending' then 'booked' else 'attended' end,operated_by=v_uid where id=v_id;
    v_registration.status:=case when v_stage='pending' then 'booked' else 'attended' end;
    v_report:=case when v_stage in ('feedback','handled') then public.ensure_assessment_report(v_id) else v_state.report_id end;
    update public.assessment_workflow_states set stage=v_stage,arrived_at=case when v_stage='pending' then null else coalesce(arrived_at,clock_timestamp()) end,
      report_id=v_report,
      sent_report_id=case when v_stage='handled' and v_report is not null then v_report else sent_report_id end,
      sent_at=case when v_stage='handled' and v_report is not null and sent_report_id is distinct from v_report then clock_timestamp() else sent_at end,
      sent_by=case when v_stage='handled' and v_report is not null and sent_report_id is distinct from v_report then v_uid else sent_by end,
      last_action='visit' where registration_id=v_id returning * into v_state;
  elsif p_command='report' then
    if p_values<>'{}'::jsonb then raise exception 'VALIDATION'; end if;
    v_report:=public.ensure_assessment_report(v_id);
    if v_report is null then raise exception 'ASSESSMENT_REPORT_NOT_READY'; end if;
    update public.assessment_workflow_states set report_id=v_report,last_action='report' where registration_id=v_id returning * into v_state;
  else
    if v_classification is null or v_classification not in ('awaiting_reply','considering','ready_to_enroll','awaiting_class','not_enrolling')
      or jsonb_typeof(p_values->'parentResponse') is distinct from 'string' or length(p_values->>'parentResponse')>2000
      or jsonb_typeof(p_values->'reasons') is distinct from 'array'
      or (p_values-array['classification','parentResponse','reasons','nextContactAt'])<>'{}'::jsonb then raise exception 'VALIDATION'; end if;
    select coalesce(array_agg(distinct value),'{}'::text[]) into v_reasons from jsonb_array_elements_text(p_values->'reasons');
    if not v_reasons <@ array['price','schedule','distance','child_preference','other']::text[] then raise exception 'VALIDATION'; end if;
    v_route:=case when v_classification='not_enrolling' then 'closed' when v_classification='awaiting_class' then 'await_product' else 'continue_follow_up' end;
    -- 家长意向不制造报名；保留已由正式报名入口建立的报名去向。
    if public.has_perm(v_uid,'followup.write') and public.can_follow_up_participation(v_id,v_uid) then
      if exists(select 1 from public.activity_routes where activity_registration_id=v_id and course_enrollment_id is not null) then v_route:='enrollment_pending'; end if;
      perform public.save_post_activity_contact(v_id,gen_random_uuid(),'other',case when v_classification='awaiting_reply' then 'unreachable' else 'connected' end,
        v_route,btrim(p_values->>'parentResponse'),(p_values->>'nextContactAt')::timestamptz);
    end if;
    update public.assessment_workflow_states set stage='handled',classification=v_classification,parent_response=btrim(p_values->>'parentResponse'),
      reasons=v_reasons,next_contact_at=(p_values->>'nextContactAt')::timestamptz,finalized_at=clock_timestamp(),last_action='classify'
      where registration_id=v_id returning * into v_state;
  end if;
  return jsonb_build_object('registrationId',v_id,'activityId',v_registration.activity_id,'participationStatus',v_registration.status,'state',to_jsonb(v_state));
end $$;

-- 已归类的测评证据在服务端保护；再次填写前先显式修订（不影响独立报名与日常跟进）。
create function public.guard_finalized_assessment_workflow() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; v_id uuid; v_finalized timestamptz;
begin
  if tg_table_name='public_class_participant_records'
    and nullif(btrim(v_row->>'assessment_summary'),'') is null
    and (tg_op<>'UPDATE' or nullif(btrim(to_jsonb(old)->>'assessment_summary'),'') is null)
    and not exists(select 1 from public.public_class_segments where id=(v_row->>'segment_id')::uuid and kind='group_assessment') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  v_id:=coalesce(v_row->>'registration_id',v_row->>'activity_registration_id',case when tg_table_name='activity_registrations' then v_row->>'id' end)::uuid;
  if tg_table_name='lead_invitation_threads' then
    select r.id into v_id from public.activities a join public.activity_registrations r on r.activity_id=a.id
      where a.source_invitation_id=(v_row->>'id')::uuid and a.deleted_at is null limit 1;
  end if;
  select finalized_at into v_finalized from public.assessment_workflow_states where registration_id=v_id for update;
  if v_finalized is not null then raise exception 'ASSESSMENT_WORKFLOW_FINALIZED'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger assessment_workflow_result_guard before insert or update or delete on public.assessment_results for each row execute function public.guard_finalized_assessment_workflow();
create trigger assessment_workflow_quick_guard before insert or update or delete on public.assessment_quick_entries for each row execute function public.guard_finalized_assessment_workflow();
create trigger assessment_workflow_question_guard before insert or update or delete on public.assessment_question_results for each row execute function public.guard_finalized_assessment_workflow();
create trigger assessment_workflow_registration_guard before update of status,assessment_started_at,assessment_completed_at,assessment_paper_version_id on public.activity_registrations for each row execute function public.guard_finalized_assessment_workflow();
create trigger assessment_workflow_public_class_guard before insert or update or delete on public.public_class_participant_records for each row execute function public.guard_finalized_assessment_workflow();
create trigger assessment_workflow_assessor_guard before update of assessor_id on public.lead_invitation_threads for each row
  when (old.assessor_id is distinct from new.assessor_id) execute function public.guard_finalized_assessment_workflow();

-- 新的专业结果使本次报告进入待反馈；旧报告及发送证据继续留在快照/事件中。
create function public.assessment_workflow_result_changed() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row jsonb:=to_jsonb(new); v_id uuid; v_final boolean;
begin
  if auth.uid() is null or v_row->>'record_state'='historical' then return new; end if;
  if tg_table_name='public_class_participant_records' and nullif(btrim(v_row->>'assessment_summary'),'') is null
    and (tg_op<>'UPDATE' or nullif(btrim(to_jsonb(old)->>'assessment_summary'),'') is null) then return new; end if;
  v_id:=coalesce(v_row->>'activity_registration_id',v_row->>'registration_id')::uuid;
  v_final:=case when tg_table_name='public_class_participant_records' then nullif(btrim(v_row->>'assessment_summary'),'') is not null
    else v_row->>'result_finalized_at' is not null or (v_row->>'result_source'='legacy' and not exists(
      select 1 from public.activity_registrations where id=v_id and assessment_started_at is not null)) end;
  insert into public.assessment_workflow_states(registration_id,stage,arrived_at,last_action,updated_by)
    values(v_id,case when v_final then 'feedback' else 'in_progress' end,clock_timestamp(),'result_changed',auth.uid())
    on conflict(registration_id) do update set stage=excluded.stage,report_id=null,last_action='result_changed';
  return new;
end $$;
create trigger assessment_workflow_result_changed after insert or update of score,assessment_band,strengths,focus_areas,teacher_recommendation,recommended_class,teacher_observation,result_finalized_at
  on public.assessment_results for each row execute function public.assessment_workflow_result_changed();
create trigger assessment_workflow_public_class_changed after insert or update of assessment_summary,recommendation
  on public.public_class_participant_records for each row execute function public.assessment_workflow_result_changed();

revoke all on function public.stamp_assessment_workflow(),public.audit_assessment_workflow(),public.ensure_assessment_report(uuid),
  public.save_assessment_workflow(uuid,uuid,text,integer,jsonb),public.guard_finalized_assessment_workflow(),public.assessment_workflow_result_changed() from public,anon,authenticated;
grant execute on function public.save_assessment_workflow(uuid,uuid,text,integer,jsonb) to authenticated;
select pg_notify('pgrst','reload schema');
