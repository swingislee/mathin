-- 测评快速登记与逐题证据分别留存。机构开关只约束最终结果，不阻断草稿、反馈或归类。
-- 共用触发器在不同表上没有相同的字段集合；用 JSON 字段读取保留原历史守卫语义。
do $migration$
declare v_definition text; v_old text:='tg_table_name=''course_enrollments'' and new.opportunity_id is not null';
begin
  v_definition:=pg_get_functiondef('public.guard_business_record_state()'::regprocedure);
  if position(v_old in v_definition)=0 then raise exception 'ASSESSMENT_RECORD_GUARD_DEFINITION_CHANGED'; end if;
  execute replace(v_definition,v_old,'tg_table_name=''course_enrollments'' and (to_jsonb(new)->>''opportunity_id'') is not null');
end $migration$;

create or replace function public.organization_feature_keys()
returns text[] language sql immutable as $$
  select array[
    'finance.enabled','notifications.email','notifications.sms','notifications.wechat','notifications.web_push',
    'public_content.publish','teaching.preparation_archive_edit',
    'teaching.classroom_board_checkpoint_v2','teaching.classroom_input_v2',
    'teaching.classroom_h5_pointer_v1','teaching.classroom_layout_v2',
    'teaching.teacher_microcourses_v1','teaching.teacher_microcourse_browser_v2',
    'assessment.require_teacher_completion'
  ]::text[]
$$;

insert into public.feature_flag_versions(organization_id,flag_key,version,enabled,effective_from,reason)
select id,'assessment.require_teacher_completion',1,false,now(),'逐题登记可选；快速登记可生成测评结果'
from public.organizations where singleton_key=1;

alter table public.assessment_results
  add column result_source text not null default 'legacy' check(result_source in ('legacy','quick_entry','teacher')),
  add column result_finalized_at timestamptz;

create table public.assessment_quick_entries (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.activity_registrations(id) on delete restrict,
  entry jsonb not null check(jsonb_typeof(entry)='object'),
  revision integer not null check(revision>0),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz
);
create table public.assessment_entry_events (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.activity_registrations(id) on delete restrict,
  entry_kind text not null check(entry_kind in ('quick_entry','teacher')),
  previous_values jsonb,
  saved_values jsonb not null,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp()
);
create index assessment_entry_events_registration_idx on public.assessment_entry_events(registration_id,recorded_at desc,id);
alter table public.assessment_quick_entries enable row level security;
alter table public.assessment_entry_events enable row level security;
revoke all on public.assessment_quick_entries,public.assessment_entry_events from public,anon,authenticated;
grant select on public.assessment_quick_entries,public.assessment_entry_events to authenticated;
create function public.can_read_assessment_entry(p_registration_id uuid) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select public.can_follow_up_participation(p_registration_id,auth.uid()) or public.can_record_teacher_assessment(p_registration_id,auth.uid())
$$;
revoke all on function public.can_read_assessment_entry(uuid) from public,anon,authenticated;
grant execute on function public.can_read_assessment_entry(uuid) to authenticated;
create policy assessment_quick_entries_read on public.assessment_quick_entries for select to authenticated using (
  public.can_read_assessment_entry(registration_id)
);
create policy assessment_entry_events_read on public.assessment_entry_events for select to authenticated using (
  public.can_read_assessment_entry(registration_id)
);
create view public.assessment_entry_actors with (security_invoker=true) as
select distinct on (e.registration_id,e.entry_kind) e.id,e.registration_id,e.entry_kind,e.recorded_by,e.recorded_at,p.display_name
from public.assessment_entry_events e join public.profiles p on p.id=e.recorded_by
order by e.registration_id,e.entry_kind,e.recorded_at desc,e.id desc;
revoke all on public.assessment_entry_actors from public,anon,authenticated;
grant select on public.assessment_entry_actors to authenticated;
create policy activity_routes_lead_followup_select on public.activity_routes for select to authenticated using (
  lead_id is not null and public.has_perm((select auth.uid()),'followup.view')
  and public.can_follow_up_participation(activity_registration_id,(select auth.uid()))
);
create trigger assessment_entry_events_immutable before update or delete on public.assessment_entry_events
for each row execute function public.guard_phase3_enrollment_history();

-- 记录身份仍然来自原预约/参与者。学服只在自己已有的跟进范围登记，不获得逐题写权限。
create function public.ensure_quick_assessment_registration(p_registration_id uuid,p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_id uuid:=p_registration_id; v_activity uuid;
  v_invitation public.lead_invitation_threads%rowtype; v_lead public.leads%rowtype;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if num_nonnulls(p_registration_id,p_invitation_id)<>1 then raise exception 'VALIDATION'; end if;
  if not (public.has_perm(v_uid,'review.write') or public.has_perm(v_uid,'followup.write')) then raise exception 'FORBIDDEN'; end if;
  if p_invitation_id is not null then
    select * into v_invitation from public.lead_invitation_threads where id=p_invitation_id for update;
    if not found or v_invitation.kind<>'assessment_1v1' then raise exception 'NOT_FOUND'; end if;
    select * into v_lead from public.leads where id=v_invitation.lead_id;
    if not ((public.has_perm(v_uid,'review.write') and (v_invitation.assessor_id=v_uid or public.has_perm(v_uid,'student.view.all')))
      or (public.has_perm(v_uid,'followup.write') and public.can_access_course_opportunity_subject(v_lead.student_id,v_lead.id,v_lead.owner_id,v_uid)))
      then raise exception 'FORBIDDEN_SCOPE'; end if;
    select r.id into v_id from public.activities a join public.activity_registrations r on r.activity_id=a.id
      where a.source_invitation_id=p_invitation_id and a.deleted_at is null;
    if v_id is null then
      if v_invitation.state<>'confirmed' or v_invitation.scheduled_at is null then raise exception 'INVITATION_NOT_CONFIRMED'; end if;
      insert into public.activities(kind,title,scheduled_at,location,created_by,source_invitation_id)
        values('assessment_1v1','测评',v_invitation.scheduled_at,v_invitation.location_text,v_uid,p_invitation_id) returning id into v_activity;
      insert into public.activity_registrations(activity_id,student_id,lead_id,status,operated_by)
        values(v_activity,v_lead.student_id,case when v_lead.student_id is null then v_lead.id end,'booked',v_uid) returning id into v_id;
      update public.lead_invitation_threads set state='completed',updated_by=v_uid,closed_by=v_uid,closed_at=now() where id=p_invitation_id;
      insert into public.lead_invitation_events(invitation_id,from_state,to_state,channel,note,recorded_by)
        values(p_invitation_id,'confirmed','completed','other','已进入测评快速登记；逐题测评尚可后补',v_uid);
    end if;
  end if;
  perform public.require_current_business_record('activity_registrations',v_id);
  perform 1 from public.activity_registrations r join public.activities a on a.id=r.activity_id
    where r.id=v_id and a.kind='assessment_1v1' and a.deleted_at is null and a.record_state='current'
      and r.status not in ('cancelled','no_show') for update of r;
  if not found then raise exception 'PARTICIPATION_UNAVAILABLE'; end if;
  if not (public.can_record_teacher_assessment(v_id,v_uid)
    or (public.has_perm(v_uid,'followup.write') and public.can_follow_up_participation(v_id,v_uid))) then raise exception 'FORBIDDEN_SCOPE'; end if;
  return v_id;
end $$;

-- 所有结果写入口都经过同一最终状态判定；旧登记入口在下方转入快速登记。
create function public.stamp_assessment_result_source() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_registration public.activity_registrations%rowtype; v_kind text;
begin
  if new.record_state='historical' then return new; end if;
  select * into v_registration from public.activity_registrations where id=new.activity_registration_id;
  select kind into v_kind from public.activities where id=v_registration.activity_id;
  if v_kind<>'assessment_1v1' then return new; end if;
  if current_setting('mathin.assessment_entry_source',true)='quick_entry' then
    if public.is_feature_enabled('assessment.require_teacher_completion') and v_registration.assessment_completed_at is null
      then raise exception 'TEACHER_ASSESSMENT_REQUIRED'; end if;
    new.result_source:='quick_entry'; new.result_finalized_at:=now();
  elsif v_registration.assessment_paper_version_id is not null then
    new.result_source:='teacher'; new.result_finalized_at:=v_registration.assessment_completed_at;
  elsif public.is_feature_enabled('assessment.require_teacher_completion') and v_registration.assessment_completed_at is null then
    raise exception 'TEACHER_ASSESSMENT_REQUIRED';
  end if;
  return new;
end $$;
create trigger assessment_result_source before insert or update of score,assessment_band,strengths,focus_areas,parent_concerns,teacher_recommendation,recommended_class,teacher_observation,assessed_by
on public.assessment_results for each row execute function public.stamp_assessment_result_source();

create function public.audit_teacher_assessment_entry() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.record_state='current' and new.result_source='teacher' and auth.uid() is not null then
    insert into public.assessment_entry_events(registration_id,entry_kind,previous_values,saved_values,recorded_by)
      values(new.activity_registration_id,'teacher',case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new),auth.uid());
  end if;
  return new;
end $$;
create trigger assessment_teacher_entry_audit after insert or update of score,assessment_band,teacher_observation,assessed_by
on public.assessment_results for each row execute function public.audit_teacher_assessment_entry();

create function public.save_assessment_quick_entry(p_registration_id uuid default null,p_invitation_id uuid default null,p_entry jsonb default null,p_expected_revision integer default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_id uuid; v_previous public.assessment_quick_entries%rowtype;
  v_saved public.assessment_quick_entries%rowtype; v_registration public.activity_registrations%rowtype;
  v_result public.assessment_results%rowtype; v_flag boolean; v_publish boolean; v_field text;
  v_band text:=p_entry->>'assessmentBand'; v_score smallint; v_route text:=p_entry->>'route';
  v_source text:=current_setting('mathin.assessment_entry_source',true);
begin
  if p_entry is null or jsonb_typeof(p_entry)<>'object' or p_expected_revision is null or p_expected_revision<0
    or (p_entry-array['assessmentBand','score','strengths','focusAreas','parentConcerns','teacherRecommendation','recommendedClass','route'])<>'{}'::jsonb
    then raise exception 'VALIDATION'; end if;
  foreach v_field in array array['strengths','focusAreas','parentConcerns','teacherRecommendation','recommendedClass'] loop
    if jsonb_typeof(p_entry->v_field) is distinct from 'string' or length(p_entry->>v_field)>(case when v_field='recommendedClass' then 200 else 2000 end)
      then raise exception 'VALIDATION'; end if;
  end loop;
  if v_band is not null and v_band not in ('x_plus','g_plus','a','a_plus','s','c','below_a')
    or v_route is not null and v_route not in ('continue_follow_up','await_product','closed','enrollment_pending')
    or (p_entry->>'score' is not null and (jsonb_typeof(p_entry->'score')<>'number' or (p_entry->>'score')!~'^\d+$'))
    then raise exception 'VALIDATION'; end if;
  if (p_entry->>'score')::numeric not between 0 and 10000 then raise exception 'VALIDATION'; end if;
  v_score:=(p_entry->>'score')::smallint;
  v_id:=public.ensure_quick_assessment_registration(p_registration_id,p_invitation_id);
  select * into v_registration from public.activity_registrations where id=v_id;
  select * into v_previous from public.assessment_quick_entries where registration_id=v_id;
  if coalesce(v_previous.revision,0)<>p_expected_revision then raise exception 'ASSESSMENT_ENTRY_CONFLICT'; end if;
  if v_band='below_a' and not exists(select 1 from public.assessment_results where activity_registration_id=v_id and assessment_band='below_a')
    then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtext('feature-flag-v2:assessment.require_teacher_completion'));
  v_flag:=public.is_feature_enabled('assessment.require_teacher_completion');
  v_publish:=not v_flag and v_registration.assessment_completed_at is null and (
    v_score is not null or v_band is not null or btrim(p_entry->>'strengths')<>'' or btrim(p_entry->>'focusAreas')<>''
    or btrim(p_entry->>'teacherRecommendation')<>'' or btrim(p_entry->>'recommendedClass')<>'');
  if v_publish then
    update public.activity_registrations set status='attended',operated_by=v_uid where id=v_id;
    v_registration.status:='attended';
    perform set_config('mathin.assessment_entry_source','quick_entry',true);
    insert into public.assessment_results(activity_registration_id,student_id,lead_id,overall_level,assessment_band,score,
      strengths,focus_areas,parent_concerns,teacher_recommendation,recommended_class,assessed_by)
    values(v_id,v_registration.student_id,v_registration.lead_id,null,v_band,v_score,
      btrim(p_entry->>'strengths'),btrim(p_entry->>'focusAreas'),btrim(p_entry->>'parentConcerns'),btrim(p_entry->>'teacherRecommendation'),btrim(p_entry->>'recommendedClass'),v_uid)
    on conflict(activity_registration_id) do update set assessment_band=excluded.assessment_band,score=excluded.score,
      strengths=excluded.strengths,focus_areas=excluded.focus_areas,parent_concerns=excluded.parent_concerns,
      teacher_recommendation=excluded.teacher_recommendation,recommended_class=excluded.recommended_class,assessed_by=excluded.assessed_by;
    perform set_config('mathin.assessment_entry_source',coalesce(v_source,''),true);
  end if;
  insert into public.assessment_quick_entries(registration_id,entry,revision,recorded_by,finalized_at)
    values(v_id,p_entry,p_expected_revision+1,v_uid,case when v_publish then now() end)
    on conflict(registration_id) do update set entry=excluded.entry,revision=excluded.revision,recorded_by=excluded.recorded_by,
      updated_at=now(),finalized_at=excluded.finalized_at returning * into v_saved;
  insert into public.assessment_entry_events(registration_id,entry_kind,previous_values,saved_values,recorded_by)
    values(v_id,'quick_entry',v_previous.entry,p_entry,v_uid);
  -- 反馈与归类采用既有追加式沟通记录；任何操作者都不能伪造别人的姓名。
  if v_route is not null and (v_previous.entry->>'route' is distinct from v_route
    or v_previous.entry->>'parentConcerns' is distinct from p_entry->>'parentConcerns') then
    if not public.has_perm(v_uid,'followup.write') or not public.can_follow_up_participation(v_id,v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
    perform public.save_post_activity_contact(v_id,gen_random_uuid(),'other','connected',v_route,btrim(p_entry->>'parentConcerns'),null);
  end if;
  select * into v_result from public.assessment_results where activity_registration_id=v_id;
  return jsonb_build_object('registrationId',v_id,'activityId',v_registration.activity_id,'entry',to_jsonb(v_saved),
    'participationStatus',v_registration.status,
    'recordedByName',(select display_name from public.profiles where id=v_uid),'assessment',case when v_result.id is not null then to_jsonb(v_result) end,
    'teacherRequired',v_flag);
end $$;

-- 1 对 1 的反馈与归类不以逐题完成为前提；实际报名保持原有资格条件。
do $migration$
declare v_definition text; v_old text:='''eligible'',r.status <> ''cancelled'' and case when a.kind=''assessment_1v1''';
begin
  v_definition:=pg_get_functiondef('public.get_activity_enrollment_context(uuid,uuid)'::regprocedure);
  if position(v_old in v_definition)=0 then raise exception 'ASSESSMENT_CONTEXT_DEFINITION_CHANGED'; end if;
  v_definition:=replace(v_definition,v_old,'''canContactBeforeCompletion'',a.kind=''assessment_1v1'' and r.status not in (''cancelled'',''no_show''),
    '||v_old);
  v_old:='then r.assessment_completed_at is not null or (r.assessment_started_at is null and ar.id is not null and r.status=''attended'')';
  if position(v_old in v_definition)=0 then raise exception 'ASSESSMENT_ELIGIBILITY_DEFINITION_CHANGED'; end if;
  v_definition:=replace(v_definition,v_old,'then r.assessment_completed_at is not null or ar.result_finalized_at is not null
      or (ar.result_source=''legacy'' and r.assessment_started_at is null and ar.id is not null and r.status=''attended'')');
  execute v_definition;
  v_definition:=pg_get_functiondef('public.save_post_activity_contact(uuid,uuid,text,text,text,text,timestamp with time zone)'::regprocedure);
  v_old:='if not (v_context->>''eligible'')::boolean then';
  if position(v_old in v_definition)=0 then raise exception 'ASSESSMENT_CONTACT_DEFINITION_CHANGED'; end if;
  execute replace(v_definition,v_old,'if not ((v_context->>''eligible'')::boolean or coalesce((v_context->>''canContactBeforeCompletion'')::boolean,false)) then');
end $migration$;

-- 旧汇总 API 与新入口执行同一开关；保留活动集中测评原实现。
create or replace function public.save_invitation_assessment_row(p_invitation_id uuid,p_assessment_band text default null,p_score smallint default null,
  p_strengths text default '',p_focus_areas text default '',p_parent_concerns text default '',p_teacher_recommendation text default '',p_recommended_class text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_revision integer;
begin
  v_id:=public.ensure_quick_assessment_registration(null,p_invitation_id);
  select revision into v_revision from public.assessment_quick_entries where registration_id=v_id;
  return public.save_assessment_quick_entry(v_id,null,jsonb_build_object('assessmentBand',p_assessment_band,'score',p_score,
    'strengths',coalesce(p_strengths,''),'focusAreas',coalesce(p_focus_areas,''),'parentConcerns',coalesce(p_parent_concerns,''),
    'teacherRecommendation',coalesce(p_teacher_recommendation,''),'recommendedClass',coalesce(p_recommended_class,''),'route',null),coalesce(v_revision,0));
end $$;
do $migration$
declare v_definition text; v_body text;
begin
  select pg_get_functiondef(p.oid),p.prosrc into v_definition,v_body from pg_proc p
    where p.oid='public.save_activity_assessment_row(uuid,text,smallint,text,text,text,text,text)'::regprocedure;
  execute replace(v_definition,v_body,regexp_replace(v_body,'\mBEGIN\M',$inject$begin
    if exists(select 1 from public.activity_registrations r join public.activities a on a.id=r.activity_id where r.id=p_registration_id and a.kind='assessment_1v1') then
      return (public.save_assessment_quick_entry(p_registration_id,null,jsonb_build_object('assessmentBand',p_assessment_band,'score',p_score,
        'strengths',coalesce(p_strengths,''),'focusAreas',coalesce(p_focus_areas,''),'parentConcerns',coalesce(p_parent_concerns,''),
        'teacherRecommendation',coalesce(p_teacher_recommendation,''),'recommendedClass',coalesce(p_recommended_class,''),'route',null),
        coalesce((select revision from public.assessment_quick_entries where registration_id=p_registration_id),0))#>>'{entry,id}')::uuid;
    end if;
  $inject$,'i'));
end $migration$;

revoke all on function public.ensure_quick_assessment_registration(uuid,uuid),public.stamp_assessment_result_source(),
  public.audit_teacher_assessment_entry(),public.save_assessment_quick_entry(uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.save_assessment_quick_entry(uuid,uuid,jsonb,integer) to authenticated;
select pg_notify('pgrst','reload schema');
