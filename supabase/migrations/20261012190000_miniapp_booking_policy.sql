begin;

-- Booking policy shares the existing settings draft, history and publication transaction.
do $copy$
begin
  execute replace(pg_get_functiondef('mathin_internal.valid_miniapp_settings(jsonb)'::regprocedure),
    'mathin_internal.valid_miniapp_settings(', 'mathin_internal.valid_miniapp_presentation_settings(');
end $copy$;
create function mathin_internal.valid_miniapp_booking_policy(p jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if jsonb_typeof(p) is distinct from 'object' or not(p ?& array['windowDays','modes','bookingCutoffMinutes','selfCancellation','cancellationCutoffMinutes','instructions'])
    or p-array['windowDays','modes','bookingCutoffMinutes','selfCancellation','cancellationCutoffMinutes','instructions']<>'{}'
    or not coalesce(p->>'windowDays' ~ '^[0-9]+$',false) or (p->>'windowDays')::integer not between 1 and 56
    or not coalesce(p->>'bookingCutoffMinutes' ~ '^[0-9]+$',false) or (p->>'bookingCutoffMinutes')::integer not between 0 and 10080
    or not coalesce(p->>'cancellationCutoffMinutes' ~ '^[0-9]+$',false) or (p->>'cancellationCutoffMinutes')::integer not between 0 and 10080
    or jsonb_typeof(p->'selfCancellation') is distinct from 'boolean'
    or jsonb_typeof(p->'modes') is distinct from 'array' or not mathin_internal.miniapp_text_valid(p->'instructions',2000) then return false; end if;
  return jsonb_array_length(p->'modes') between 1 and 2
    and not exists(select 1 from jsonb_array_elements_text(p->'modes') m where m not in ('campus','online'))
    and jsonb_array_length(p->'modes')=(select count(distinct m) from jsonb_array_elements_text(p->'modes') m);
exception when others then return false;
end $$;
create or replace function mathin_internal.valid_miniapp_settings(p jsonb) returns boolean
language sql immutable security definer set search_path=public,pg_temp as $$
  select mathin_internal.valid_miniapp_presentation_settings(p-'booking')
    and (not(p ? 'booking') or mathin_internal.valid_miniapp_booking_policy(p->'booking'))
    and octet_length(p::text)<=65536;
$$;
create function public.miniapp_booking_policy() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((select published->'booking' from public.miniapp_settings where singleton),
    '{"windowDays":14,"modes":["campus"],"bookingCutoffMinutes":0,"selfCancellation":false,"cancellationCutoffMinutes":0,"instructions":{"zh":"","en":""}}'::jsonb);
$$;
revoke all on function mathin_internal.valid_miniapp_presentation_settings(jsonb),mathin_internal.valid_miniapp_booking_policy(jsonb) from public,anon,authenticated;
revoke all on function public.miniapp_booking_policy() from public,anon,authenticated;
grant execute on function public.miniapp_booking_policy() to postgres,authenticated;

-- Campus remains the responsible service campus for online slots. Joining instructions
-- are staff-only until a family books; each booking freezes its own copy.
alter table public.assessment_slots add column mode text not null default 'campus' check(mode in ('campus','online')),
  add column joining_instructions text not null default '' check(length(joining_instructions)<=2000);
alter table public.lead_invitation_threads drop constraint lead_invitation_threads_parent_request_check;
alter table public.lead_invitation_threads add constraint lead_invitation_threads_parent_request_check check (
  (parent_request_actor is null and parent_request_payload is null and assessment_slot_id is null)
  or (parent_request_actor is not null and parent_request_payload is not null and jsonb_typeof(parent_request_payload)='object'
    and parent_request_payload ?& array['version','studentId','assessorId']
    and jsonb_typeof(parent_request_payload->'studentId')='string' and jsonb_typeof(parent_request_payload->'assessorId')='string'
    and ((parent_request_payload->>'version'='1' and assessment_slot_id is null and jsonb_typeof(parent_request_payload->'parentTimeOptions')='array')
      or (parent_request_payload->>'version'='2' and assessment_slot_id is not null
        and parent_request_payload ?& array['slotId','subjects','grade','mode','campus','endsAt']
        and parent_request_payload->>'slotId'=assessment_slot_id::text and parent_request_payload->>'mode' in ('campus','online')
        and jsonb_typeof(parent_request_payload->'subjects')='array' and jsonb_typeof(parent_request_payload->'grade')='number'
        and jsonb_typeof(parent_request_payload->'campus')='object' and jsonb_typeof(parent_request_payload->'endsAt')='string')))
);
CREATE OR REPLACE FUNCTION public.guard_assessment_slot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_teacher uuid;
begin
  for v_teacher in select distinct id from unnest(array[new.teacher_id,case when tg_op='UPDATE' then old.teacher_id end]) id where id is not null order by id loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
  end loop;
  if tg_op='UPDATE' and exists(select 1 from public.lead_invitation_threads where assessment_slot_id=old.id)
    and (new.teacher_id,new.campus_id,new.subjects,new.grades,new.starts_at,new.ends_at,new.mode,new.joining_instructions)
      is distinct from (old.teacher_id,old.campus_id,old.subjects,old.grades,old.starts_at,old.ends_at,old.mode,old.joining_instructions)
    then raise exception 'SLOT_BOOKED'; end if;
  if new.enabled and exists(select 1 from public.assessment_slots s where s.id<>new.id and s.teacher_id=new.teacher_id
    and s.enabled and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)'))
    then raise exception 'TIME_UNAVAILABLE'; end if;
  new.updated_at:=clock_timestamp();
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.guard_assessment_slot_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_slot public.assessment_slots%rowtype; v_teacher uuid; v_end timestamptz;
begin
  if tg_op='UPDATE' and old.assessment_slot_id is not null
    and (new.assessment_slot_id,new.assessor_id,new.scheduled_at,new.kind,new.lead_id,new.location_text)
      is distinct from (old.assessment_slot_id,old.assessor_id,old.scheduled_at,old.kind,old.lead_id,old.location_text)
    then raise exception 'SLOT_BOOKING_IMMUTABLE'; end if;
  for v_teacher in select distinct id from unnest(array[new.assessor_id,case when tg_op='UPDATE' then old.assessor_id end]) id where id is not null order by id loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
  end loop;
  if new.assessment_slot_id is not null then
    select * into v_slot from public.assessment_slots where id=new.assessment_slot_id for share;
    if v_slot.id is null or new.assessor_id is distinct from v_slot.teacher_id or new.scheduled_at is distinct from v_slot.starts_at
      or new.parent_request_payload->>'assessorId' is distinct from v_slot.teacher_id::text
      or (new.parent_request_payload->>'endsAt')::timestamptz is distinct from v_slot.ends_at
      or new.parent_request_payload->>'mode' is distinct from v_slot.mode
      or coalesce(new.parent_request_payload->>'joiningInstructions','') is distinct from v_slot.joining_instructions
      or new.parent_request_payload#>>'{campus,id}' is distinct from v_slot.campus_id::text
      then raise exception 'SLOT_BOOKING_IMMUTABLE'; end if;
    if tg_op='INSERT' and (not v_slot.enabled or v_slot.starts_at<=now() or (v_slot.mode='campus' and public.staff_calendar_campus_closed(v_slot.campus_id,v_slot.starts_at,v_slot.ends_at))) then raise exception 'SLOT_UNAVAILABLE'; end if;
    v_end:=v_slot.ends_at;
  else v_end:=new.scheduled_at+interval '40 minutes'; end if;
  if new.kind='assessment_1v1' and new.scheduled_at is not null and new.state in ('awaiting_parent','confirmed','completed') then
    if new.assessment_slot_id is not null then
      if public.assessment_teacher_time_busy(new.assessor_id,new.scheduled_at,v_end,new.id) then raise exception 'TIME_UNAVAILABLE'; end if;
    elsif public.staff_calendar_internal_busy(new.assessor_id,new.scheduled_at,v_end)
      or exists(select 1 from public.class_sessions s join public.classrooms c on c.id=s.classroom_id
        where s.deleted_at is null and s.cancelled_by is null and s.voided_at is null and c.trashed_at is null
          and s.scheduled_at is not null and s.duration_min>0
          and tstzrange(s.scheduled_at,s.scheduled_at+make_interval(mins=>s.duration_min),'[)') && tstzrange(new.scheduled_at,v_end,'[)')
          and new.assessor_id in(select public.staff_calendar_session_teachers(s.classroom_id,s.teacher_override)))
      or exists(select 1 from public.lead_invitation_threads t join public.assessment_slots s on s.id=t.assessment_slot_id
        where t.id<>new.id and t.assessor_id=new.assessor_id and t.state<>'cancelled'
          and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(new.scheduled_at,v_end,'[)'))
      then raise exception 'TIME_UNAVAILABLE'; end if;
  end if;
  return new;
end $function$;
drop trigger lead_invitation_slots_guard on public.lead_invitation_threads;
create trigger lead_invitation_slots_guard before insert or update of assessment_slot_id,assessor_id,scheduled_at,state,kind,lead_id,location_text,parent_request_payload
  on public.lead_invitation_threads for each row execute function public.guard_assessment_slot_booking();
CREATE OR REPLACE FUNCTION public.assessment_slot_projection(p_slot assessment_slots)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object('id',p_slot.id,'teacherId',p_slot.teacher_id,'campusId',p_slot.campus_id,'mode',p_slot.mode,'joiningInstructions',p_slot.joining_instructions,
    'subjects',p_slot.subjects,'grades',p_slot.grades,'startsAt',p_slot.starts_at,'endsAt',p_slot.ends_at,
    'enabled',p_slot.enabled,'booked',exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot.id),
    'activeBooked',exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot.id and state<>'cancelled'),
    'ruleId',p_slot.rule_id,'blocked',not public.is_assessment_teacher(p_slot.teacher_id) or not exists(select 1 from public.assessment_topics topic where topic.enabled and topic.id=any(p_slot.subjects)) or public.assessment_slot_excluded(p_slot.teacher_id,p_slot.campus_id,p_slot.starts_at,p_slot.ends_at) or (p_slot.mode='campus' and public.staff_calendar_campus_closed(p_slot.campus_id,p_slot.starts_at,p_slot.ends_at))
      or public.assessment_teacher_time_busy(p_slot.teacher_id,p_slot.starts_at,p_slot.ends_at,
        (select id from public.lead_invitation_threads where assessment_slot_id=p_slot.id and state<>'cancelled' limit 1)),
    'updatedAt',p_slot.updated_at);
$function$;
CREATE OR REPLACE FUNCTION public.save_assessment_slot_v2(p_slot_id uuid, p_teacher_id uuid, p_campus_id uuid, p_subjects text[], p_grades integer[], p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_enabled boolean, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_mode text DEFAULT 'campus'::text, p_joining_instructions text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid:=auth.uid(); v_slot public.assessment_slots%rowtype; v_old_teacher uuid; v_teacher uuid; v_subjects text[]; v_grades integer[];
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(v_uid,p_teacher_id) then raise exception 'FORBIDDEN'; end if;
  if p_mode is null or p_mode not in ('campus','online') or p_joining_instructions is null or length(p_joining_instructions)>2000
    or (p_mode='online' and btrim(p_joining_instructions)='') or p_slot_id is null or p_teacher_id is null or p_campus_id is null or p_subjects is null or p_grades is null or p_enabled is null
    or cardinality(p_subjects) not between 1 and 12 or array_ndims(p_subjects)<>1 or array_position(p_subjects,null) is not null
    or not public.assessment_topics_valid(p_subjects) or cardinality(p_grades)>14
    or (cardinality(p_grades)>0 and array_ndims(p_grades)<>1) or array_position(p_grades,null) is not null
    or not p_grades<@array[-1,0,1,2,3,4,5,6,7,8,9,10,11,12]
    or p_starts_at is null or p_ends_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at)
    or p_starts_at<>date_trunc('minute',p_starts_at) or p_ends_at<>date_trunc('minute',p_ends_at)
    or p_ends_at-p_starts_at not between interval '5 minutes' and interval '4 hours' then raise exception 'VALIDATION'; end if;
  v_subjects:=array(select distinct unnest(p_subjects) order by 1); v_grades:=array(select distinct unnest(p_grades) order by 1);
  if cardinality(v_subjects)<>cardinality(p_subjects) or cardinality(v_grades)<>cardinality(p_grades) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('assessment-slot-save:'||p_slot_id::text,0));
  select teacher_id into v_old_teacher from public.assessment_slots where id=p_slot_id;
  if v_old_teacher is not null and not public.assessment_slots_can_manage(v_uid,v_old_teacher) then raise exception 'FORBIDDEN'; end if;
  for v_teacher in select distinct id from unnest(array[p_teacher_id,v_old_teacher]) id where id is not null order by id loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
  end loop;
  select * into v_slot from public.assessment_slots where id=p_slot_id for update;
  if v_slot.rule_id is not null then raise exception 'RULE_MANAGED'; end if; if v_slot.id is not null then
    if v_slot.teacher_id is distinct from v_old_teacher then raise exception 'CONFLICT'; end if;
    if (p_expected_updated_at is null and v_slot.created_by=v_uid or p_expected_updated_at=v_slot.updated_at)
      and (v_slot.teacher_id,v_slot.campus_id,v_slot.subjects,v_slot.grades,v_slot.starts_at,v_slot.ends_at,v_slot.enabled,v_slot.mode,v_slot.joining_instructions)
        is not distinct from (p_teacher_id,p_campus_id,v_subjects,v_grades,p_starts_at,p_ends_at,p_enabled,p_mode,p_joining_instructions)
      then return public.assessment_slot_projection(v_slot); end if;
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_slot.updated_at then raise exception 'CONFLICT'; end if;
    if exists(select 1 from public.lead_invitation_threads where assessment_slot_id=v_slot.id)
      and (v_slot.teacher_id,v_slot.campus_id,v_slot.subjects,v_slot.grades,v_slot.starts_at,v_slot.ends_at,v_slot.mode,v_slot.joining_instructions)
        is distinct from (p_teacher_id,p_campus_id,v_subjects,v_grades,p_starts_at,p_ends_at,p_mode,p_joining_instructions) then raise exception 'SLOT_BOOKED'; end if;
  elsif p_expected_updated_at is not null then raise exception 'NOT_FOUND'; end if;
  -- 原教师/校区停用后仍可关闭既有排班；关闭不会改变预约事实。
  if v_slot.id is not null and not p_enabled
    and (v_slot.teacher_id,v_slot.campus_id,v_slot.subjects,v_slot.grades,v_slot.starts_at,v_slot.ends_at,v_slot.mode,v_slot.joining_instructions)
      is not distinct from (p_teacher_id,p_campus_id,v_subjects,v_grades,p_starts_at,p_ends_at,p_mode,p_joining_instructions) then
    update public.assessment_slots set enabled=false,updated_by=v_uid where id=p_slot_id returning * into v_slot;
    return public.assessment_slot_projection(v_slot);
  end if;
  if not public.is_assessment_teacher(p_teacher_id) then raise exception 'NO_ELIGIBLE_TEACHER'; end if;
  if not exists(select 1 from public.campuses where id=p_campus_id and status='active') then raise exception 'CAMPUS_UNAVAILABLE'; end if;
  if (v_slot.id is null or p_enabled or (v_slot.starts_at,v_slot.ends_at,v_slot.mode,v_slot.joining_instructions) is distinct from (p_starts_at,p_ends_at,p_mode,p_joining_instructions))
    and p_starts_at<=now() then raise exception 'TIME_UNAVAILABLE'; end if;
  if p_enabled and p_mode='campus' and public.staff_calendar_campus_closed(p_campus_id,p_starts_at,p_ends_at) then raise exception 'TIME_UNAVAILABLE'; end if; if p_enabled and public.assessment_teacher_time_busy(p_teacher_id,p_starts_at,p_ends_at,
    (select id from public.lead_invitation_threads where assessment_slot_id=p_slot_id and state<>'cancelled' limit 1)) then raise exception 'TIME_UNAVAILABLE'; end if;
  if v_slot.id is null then
    insert into public.assessment_slots(id,teacher_id,campus_id,subjects,grades,starts_at,ends_at,enabled,created_by,updated_by,mode,joining_instructions)
      values(p_slot_id,p_teacher_id,p_campus_id,v_subjects,v_grades,p_starts_at,p_ends_at,p_enabled,v_uid,v_uid,p_mode,p_joining_instructions) returning * into v_slot;
  else
    update public.assessment_slots set teacher_id=p_teacher_id,campus_id=p_campus_id,subjects=v_subjects,grades=v_grades,
      starts_at=p_starts_at,ends_at=p_ends_at,enabled=p_enabled,updated_by=v_uid,mode=p_mode,joining_instructions=p_joining_instructions where id=p_slot_id returning * into v_slot;
  end if;
  return public.assessment_slot_projection(v_slot);
end $function$;
create or replace function public.save_assessment_slot(p_slot_id uuid,p_teacher_id uuid,p_campus_id uuid,p_subjects text[],p_grades integer[],
  p_starts_at timestamptz,p_ends_at timestamptz,p_enabled boolean,p_expected_updated_at timestamptz default null) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select public.save_assessment_slot_v2(p_slot_id,p_teacher_id,p_campus_id,p_subjects,p_grades,p_starts_at,p_ends_at,p_enabled,p_expected_updated_at,'campus','');
$$;
CREATE OR REPLACE FUNCTION public.save_assessment_slot_series_v2(p_slot_id uuid, p_teacher_id uuid, p_campus_id uuid, p_subjects text[], p_grades integer[], p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_enabled boolean, p_recurrence jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_mode text DEFAULT 'campus'::text, p_joining_instructions text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid:=auth.uid(); v_series public.staff_calendar_slot_series%rowtype; v_payload jsonb; v_slot public.assessment_slots%rowtype;
  v_starts timestamptz[]; v_start timestamptz; v_id uuid; v_result jsonb; v_saved jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(v_uid,p_teacher_id) then raise exception 'FORBIDDEN'; end if;
  if p_slot_id is null or p_recurrence is null or p_expected_updated_at is not null then raise exception 'VALIDATION'; end if;
  select array_agg(occurrence order by occurrence) into v_starts from public.staff_calendar_recurrence_starts(p_starts_at,p_recurrence) occurrence;
  v_payload:=jsonb_build_object('teacherId',p_teacher_id,'campusId',p_campus_id,'subjects',array(select unnest(p_subjects) order by 1),
    'grades',array(select unnest(p_grades) order by 1),'startsAt',p_starts_at,'endsAt',p_ends_at,'enabled',p_enabled,'recurrence',p_recurrence,'mode',p_mode,'joiningInstructions',p_joining_instructions);
  perform pg_advisory_xact_lock(hashtextextended('assessment-slot-save:'||p_slot_id::text,0));
  select * into v_series from public.staff_calendar_slot_series where request_id=p_slot_id;
  if v_series.request_id is not null then
    if v_series.created_by<>v_uid then raise exception 'FORBIDDEN'; end if;
    if v_series.request_payload is distinct from v_payload then raise exception 'CONFLICT'; end if;
    select * into v_slot from public.assessment_slots where id=p_slot_id;
    if not public.assessment_slots_can_manage(v_uid,v_slot.teacher_id) then raise exception 'FORBIDDEN'; end if;
    return public.assessment_slot_projection(v_slot);
  end if;
  if exists(select 1 from public.assessment_slots where id=p_slot_id) then raise exception 'CONFLICT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||p_teacher_id::text,0));
  foreach v_start in array v_starts loop
    v_id:=case when v_result is null then p_slot_id else gen_random_uuid() end;
    v_saved:=public.save_assessment_slot_v2(v_id,p_teacher_id,p_campus_id,p_subjects,p_grades,v_start,v_start+(p_ends_at-p_starts_at),p_enabled,null,p_mode,p_joining_instructions);
    if v_result is null then v_result:=v_saved; end if;
  end loop;
  insert into public.staff_calendar_slot_series(request_id,created_by,request_payload) values(p_slot_id,v_uid,v_payload);
  return v_result;
end $function$;
revoke all on function public.save_assessment_slot_v2(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,timestamptz,text,text),
  public.save_assessment_slot_series_v2(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,jsonb,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.save_assessment_slot_v2(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,timestamptz,text,text),
  public.save_assessment_slot_series_v2(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,jsonb,timestamptz,text,text) to postgres,authenticated;

do $copy$
begin
  execute replace(pg_get_functiondef('public.validate_assessment_rule_definition(jsonb)'::regprocedure),
    'public.validate_assessment_rule_definition(', 'mathin_internal.validate_assessment_core_rule(');
end $copy$;
create or replace function public.validate_assessment_rule_definition(p_definition jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform mathin_internal.validate_assessment_core_rule(p_definition-array['mode','joiningInstructions']);
  if (p_definition ? 'mode' and not coalesce(p_definition->>'mode' in ('campus','online'),false))
    or (p_definition ? 'joiningInstructions' and (jsonb_typeof(p_definition->'joiningInstructions') is distinct from 'string' or length(p_definition->>'joiningInstructions')>2000))
    or (p_definition->>'kind'='open' and p_definition->>'mode'='online' and coalesce(btrim(p_definition->>'joiningInstructions'),'')='') then raise exception 'VALIDATION'; end if;
end $$;
revoke all on function mathin_internal.validate_assessment_core_rule(jsonb) from public,anon,authenticated;
grant execute on function mathin_internal.validate_assessment_core_rule(jsonb) to postgres;
CREATE OR REPLACE FUNCTION public.refresh_assessment_rule_slots(p_teacher uuid, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r record; d date; m integer; v_start timestamptz; v_end timestamptz; v_subjects text[]; v_grades integer[];
  v_slot public.assessment_slots%rowtype; v_total integer:=0; v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||p_teacher::text,0));
  -- Booking snapshots are immutable. Disabling a slot never cancels its booking.
  update public.assessment_slots set enabled=false,updated_by=p_actor where teacher_id=p_teacher and rule_id is not null and starts_at>now() and enabled;
  for r in select rule.* from public.assessment_availability_rules rule where public.assessment_rule_applies(rule,p_teacher)
    and definition->>'kind'='open' and (definition->>'enabled')::boolean order by (teacher_id is null),id loop
    if not public.is_assessment_teacher(p_teacher) then continue; end if;
    if not exists(select 1 from public.campuses where id=(r.definition->>'campusId')::uuid and status='active') then continue; end if;
    v_subjects:=array(select jsonb_array_elements_text(r.definition->'topics') order by 1);
    v_grades:=array(select x::integer from jsonb_array_elements_text(r.definition->'grades') x order by 1);
    v_count:=0;
    for d in select day::date from generate_series(greatest((r.definition->>'from')::date,(now() at time zone (r.definition->>'timeZone'))::date)::timestamp,
      (r.definition->>'until')::date::timestamp,interval '1 day') day
      where r.definition->'weekdays' @> to_jsonb(array[extract(isodow from day)::integer]) loop
      m:=(r.definition->>'startMinute')::integer;
      while m+(r.definition->>'durationMinutes')::integer <= (r.definition->>'endMinute')::integer loop
        v_start:=(d::timestamp+make_interval(mins=>m)) at time zone (r.definition->>'timeZone');
        v_end:=(d::timestamp+make_interval(mins=>m+(r.definition->>'durationMinutes')::integer)) at time zone (r.definition->>'timeZone');
        m:=m+(r.definition->>'durationMinutes')::integer;
        if v_start<=now() then continue; end if;
        v_total:=v_total+1; v_count:=v_count+1;
        if v_count>5000 or v_total>20000 then raise exception 'RULE_TOO_LARGE'; end if;
        -- Personal openings take priority; shared openings fill the remaining time.
        if r.teacher_id is null and exists(select 1 from public.assessment_slots s where s.teacher_id=p_teacher
          and s.enabled and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(v_start,v_end,'[)')) then continue; end if;
        select * into v_slot from public.assessment_slots s where s.teacher_id=p_teacher and s.rule_id=r.id and s.starts_at=v_start and s.ends_at=v_end
          and s.mode=coalesce(r.definition->>'mode','campus') and s.joining_instructions=coalesce(r.definition->>'joiningInstructions','')
          and s.campus_id=(r.definition->>'campusId')::uuid and s.subjects=v_subjects and s.grades=v_grades order by s.created_at,s.id limit 1;
        if found then
          update public.assessment_slots set enabled=true,updated_by=p_actor where id=v_slot.id;
        else
          insert into public.assessment_slots(id,teacher_id,campus_id,subjects,grades,starts_at,ends_at,enabled,created_by,updated_by,rule_id,mode,joining_instructions)
            values(gen_random_uuid(),p_teacher,(r.definition->>'campusId')::uuid,v_subjects,v_grades,v_start,v_end,true,p_actor,p_actor,r.id,coalesce(r.definition->>'mode','campus'),coalesce(r.definition->>'joiningInstructions',''));
        end if;
      end loop;
    end loop;
  end loop;
end $function$;
CREATE OR REPLACE FUNCTION public.get_assessment_rules_workspace()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid:=auth.uid(); v_all boolean; v_teachers jsonb; v_rules jsonb; v_campuses jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(v_uid,v_uid) then raise exception 'FORBIDDEN'; end if;
  v_all:=public.assessment_slots_manage_all(v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'displayName',p.display_name,
    'canReceive',public.is_assessment_teacher(p.id),
    'groupIds',coalesce((select jsonb_agg(distinct a.group_id) from public.school_business_group_members m cross join lateral unnest(public.school_group_lineage(m.group_id)) a(group_id) where m.user_id=p.id and m.removed_at is null),'[]'::jsonb),
    'standaloneCount',(select count(*) from public.assessment_slots s where s.teacher_id=p.id and s.rule_id is null and s.enabled and s.starts_at>now()))
    order by p.display_name,p.id),'[]') into v_teachers from public.profiles p
    where (v_all or p.id=v_uid) and public.is_staff(p.id) and exists(select 1 from public.school_staff_business_roles r
      where r.user_id=p.id and r.business_role in ('teacher','assessment_teacher'));
  select coalesce(jsonb_agg(r.definition||jsonb_build_object('id',r.id,'teacherId',r.teacher_id,'scope',r.scope,'updatedAt',r.updated_at,
    'availableCount',(select count(*) from public.assessment_slots s join public.campuses c on c.id=s.campus_id
      where s.rule_id=r.id and (v_all or s.teacher_id=v_uid) and s.enabled and s.starts_at>now() and c.status='active'
        and public.is_assessment_teacher(s.teacher_id)
        and exists(select 1 from public.assessment_topics t where t.enabled and t.id=any(s.subjects))
        and not public.assessment_slot_excluded(s.teacher_id,s.campus_id,s.starts_at,s.ends_at) and (s.mode='online' or not public.staff_calendar_campus_closed(s.campus_id,s.starts_at,s.ends_at))
        and not public.assessment_teacher_time_busy(s.teacher_id,s.starts_at,s.ends_at)),
    'bookedCount',(select count(*) from public.assessment_slots s join public.lead_invitation_threads t on t.assessment_slot_id=s.id
      where s.rule_id=r.id and (v_all or s.teacher_id=v_uid) and s.ends_at>now() and t.state<>'cancelled')) order by r.definition->>'kind',r.definition->>'from',r.id),'[]')
    into v_rules from public.assessment_availability_rules r where v_all or public.assessment_rule_applies(r,v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'active',c.status='active') order by c.name,c.id),'[]')
    into v_campuses from public.campuses c;
  return jsonb_build_object('currentUserId',v_uid,'canManageAll',v_all,'teachers',v_teachers,'campuses',v_campuses,'rules',v_rules,
    'topics',public.assessment_topic_projection(),'canManageStaff',public.can_manage_school_groups(),
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by public.school_group_sort_key(g.id)) from public.school_business_groups g
      where g.archived_at is null and (v_all or g.id in(select group_id from public.school_actor_group_scope(v_uid)))),'[]'::jsonb));
end $function$;
CREATE OR REPLACE FUNCTION public.parent_assessment_availability_v2(p_student_id uuid, p_subjects text[], p_grade integer, p_mode text DEFAULT 'campus'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_from date:=(now() at time zone 'Asia/Shanghai')::date; v_slots jsonb; v_teachers jsonb; v_campuses jsonb; v_policy jsonb:=public.miniapp_booking_policy();
begin
  if not public.miniapp_can_register(p_student_id,'activity')
    or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'FORBIDDEN'; end if;
  if p_mode is null or p_mode not in ('campus','online') or p_subjects is null or cardinality(p_subjects) not between 1 and 12 or array_ndims(p_subjects)<>1
    or array_position(p_subjects,null) is not null or not public.assessment_topics_valid(p_subjects)
    or cardinality(p_subjects)<>(select count(distinct x) from unnest(p_subjects) x)
    or p_grade is null or p_grade not between -1 and 12 then raise exception 'VALIDATION'; end if;
  with matched as materialized (
    select s.*,p.display_name,c.name from public.assessment_slots s join public.profiles p on p.id=s.teacher_id join public.campuses c on c.id=s.campus_id
    where s.mode=p_mode and v_policy->'modes' ? s.mode and s.enabled and s.starts_at>now()+make_interval(mins=>(v_policy->>'bookingCutoffMinutes')::integer) and s.starts_at<(v_from+(v_policy->>'windowDays')::integer)::timestamp at time zone 'Asia/Shanghai'
      and p_subjects<@s.subjects and (cardinality(s.grades)=0 or p_grade=any(s.grades))
      and public.is_assessment_teacher(p.id) and c.status='active'
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'teacherId',s.teacher_id,'campusId',s.campus_id,'mode',s.mode,'startsAt',s.starts_at,'endsAt',s.ends_at,
      'available',not public.assessment_teacher_time_busy(s.teacher_id,s.starts_at,s.ends_at) and not public.assessment_slot_excluded(s.teacher_id,s.campus_id,s.starts_at,s.ends_at) and public.assessment_topics_valid(p_subjects,true) and (s.mode='online' or not public.staff_calendar_campus_closed(s.campus_id,s.starts_at,s.ends_at))) order by s.starts_at,s.id),'[]') from matched s),
    (select coalesce(jsonb_agg(jsonb_build_object('id',t.teacher_id,'displayName',t.display_name) order by t.display_name,t.teacher_id),'[]') from (select distinct teacher_id,display_name from matched) t),
    (select coalesce(jsonb_agg(jsonb_build_object('id',c.campus_id,'name',c.name) order by c.name,c.campus_id),'[]') from (select distinct campus_id,name from matched) c)
    into v_slots,v_teachers,v_campuses;
  return jsonb_build_object('participantId',p_student_id,'timeZone','Asia/Shanghai','from',v_from,'to',v_from+(v_policy->>'windowDays')::integer-1,
    'policy',v_policy,'teachers',v_teachers,'campuses',v_campuses,'slots',v_slots);
end $function$;
create or replace function public.parent_assessment_availability(p_student_id uuid,p_subjects text[],p_grade integer) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select public.parent_assessment_availability_v2(p_student_id,p_subjects,p_grade,'campus');
$$;
revoke all on function public.parent_assessment_availability_v2(uuid,text[],integer,text) from public,anon,authenticated;
grant execute on function public.parent_assessment_availability_v2(uuid,text[],integer,text) to postgres,authenticated;
CREATE OR REPLACE FUNCTION public.assessment_public_topics()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with policy as materialized (select public.miniapp_booking_policy() value), available as materialized (
    select s.subjects from public.assessment_slots s join public.campuses c on c.id=s.campus_id cross join policy
    where s.enabled and s.starts_at>now()+make_interval(mins=>(policy.value->>'bookingCutoffMinutes')::integer) and policy.value->'modes' ? s.mode
      and s.starts_at<(((now() at time zone 'Asia/Shanghai')::date+(policy.value->>'windowDays')::integer)::timestamp at time zone 'Asia/Shanghai')
      and public.is_assessment_teacher(s.teacher_id) and c.status='active'
      and not public.assessment_slot_excluded(s.teacher_id,s.campus_id,s.starts_at,s.ends_at)
      and (s.mode='online' or not public.staff_calendar_campus_closed(s.campus_id,s.starts_at,s.ends_at))
      and not public.assessment_teacher_time_busy(s.teacher_id,s.starts_at,s.ends_at)
  ) select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',jsonb_build_object('zh',t.name,'en',coalesce(nullif(t.name_en,''),t.name)),
    'available',t.enabled and exists(select 1 from available a where t.id=any(a.subjects)))
    order by case when t.id='thinking' then 0 else 1 end,t.name,t.id),'[]') from public.assessment_topics t;
$function$;
CREATE OR REPLACE FUNCTION public.parent_assessment_request_blocker(p_student_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_count bigint; v_status text; v_policy jsonb:=public.miniapp_booking_policy();
begin
  select count(*),min(l.status) into v_count,v_status from public.leads l where l.student_id=p_student_id;
  if v_count=0 then return 'NO_LINKED_LEAD'; end if;
  if v_count>1 then return 'AMBIGUOUS_LINKED_LEAD'; end if;
  if v_status='invalid' then return 'LEAD_UNAVAILABLE'; end if;
  if exists(select 1 from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id
    where l.student_id=p_student_id and t.state not in ('completed','cancelled')) then return 'ACTIVE_INVITATION'; end if;
  if not exists(select 1 from public.parent_assessment_eligible_teachers(p_student_id)) and not exists(
    select 1 from public.assessment_slots s join public.campuses c on c.id=s.campus_id
      where s.enabled and s.starts_at>now()+make_interval(mins=>(v_policy->>'bookingCutoffMinutes')::integer) and v_policy->'modes' ? s.mode and s.starts_at<(((now() at time zone 'Asia/Shanghai')::date+(v_policy->>'windowDays')::integer)::timestamp at time zone 'Asia/Shanghai')
        and public.is_assessment_teacher(s.teacher_id) and c.status='active'
  ) then return 'NO_ELIGIBLE_TEACHER'; end if;
  return null;
end $function$;
CREATE OR REPLACE FUNCTION public.parent_assessment_overview(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_blocker text; v_teachers jsonb; v_requests jsonb;
begin
  if not public.miniapp_can_register(p_student_id,'activity')
    or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'FORBIDDEN'; end if;
  v_blocker := public.parent_assessment_request_blocker(p_student_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'displayName',t.display_name) order by t.display_name,t.id),'[]'::jsonb)
    into v_teachers from public.parent_assessment_eligible_teachers(p_student_id) t;
  select coalesce(jsonb_agg(public.parent_assessment_request_projection(t.id,p_student_id) order by t.updated_at desc,t.id desc),'[]'::jsonb)
    into v_requests from (
      select t.id,t.updated_at from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id
      where l.student_id=p_student_id and t.kind='assessment_1v1'
      order by t.updated_at desc,t.id desc limit 100
    ) t;
  return jsonb_build_object('participantId',p_student_id,'timeZone','Asia/Shanghai',
    'eligibility',jsonb_build_object('canRequest',v_blocker is null,'reason',v_blocker),
    'teachers',v_teachers,'requests',v_requests,'topics',public.assessment_public_topics(),'policy',public.miniapp_booking_policy());
end
$function$;
CREATE OR REPLACE FUNCTION public.parent_assessment_request_projection(p_invitation_id uuid, p_student_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object('id',t.id,'participantId',l.student_id,
    'teacher',case when p.id is null then null else jsonb_build_object('id',p.id,'displayName',p.display_name) end,
    'state',t.state,'parentTimeOptions',to_jsonb(t.parent_time_options),'teacherTimeOptions',to_jsonb(t.assessor_time_options),
    'sharedTimeOptions',to_jsonb(shared.options),'proposedStartsAt',case when t.state='awaiting_parent' then t.scheduled_at else null end,
    'scheduledAt',case when t.state in ('confirmed','completed') then t.scheduled_at else null end,'updatedAt',t.updated_at,
    'canCancel',coalesce(t.state='confirmed' and t.parent_request_actor=auth.uid() and public.miniapp_can_register(p_student_id,'activity')
      and (t.parent_request_payload->>'cancelUntil')::timestamptz>now(),false),'cancelUntil',t.parent_request_payload->'cancelUntil',
    'canConfirm',coalesce(t.assessment_slot_id is null and t.state='awaiting_parent' and l.status<>'invalid'
      and p.role in ('staff','admin') and p.is_active and p.account_status='active' and public.has_perm(p.id,'review.write') and cardinality(shared.options)>0,false),
    'booking',case when t.assessment_slot_id is null then null else jsonb_build_object(
      'slotId',t.assessment_slot_id,'subjects',t.parent_request_payload->'subjects','grade',t.parent_request_payload->'grade',
      'mode',t.parent_request_payload->>'mode','joiningInstructions',coalesce(t.parent_request_payload->>'joiningInstructions',''),'campus',t.parent_request_payload->'campus','endsAt',t.parent_request_payload->'endsAt') end)
  from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id left join public.profiles p on p.id=t.assessor_id
  cross join lateral (select array(select distinct option_value from unnest(t.parent_time_options) option_value
    where option_value=any(t.assessor_time_options) and public.parent_assessment_time_at(option_value)>now() order by option_value) options) shared
  where t.id=p_invitation_id and l.student_id=p_student_id and t.kind='assessment_1v1';
$function$;
CREATE OR REPLACE FUNCTION public.book_parent_assessment_slot_v2(p_request_id uuid, p_student_id uuid, p_slot_id uuid, p_subjects text[], p_grade integer, p_mode text DEFAULT 'campus'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid:=auth.uid(); v_subjects text[]; v_invitation public.lead_invitation_threads%rowtype;
  v_slot public.assessment_slots%rowtype; v_lead public.leads%rowtype; v_teacher uuid; v_payload jsonb; v_campus_name text; v_count bigint; v_policy jsonb;
begin
  if not public.miniapp_can_register(p_student_id,'activity')
    or not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'FORBIDDEN'; end if;
  if p_mode is null or p_mode not in ('campus','online') or p_request_id is null or p_slot_id is null or p_subjects is null or cardinality(p_subjects) not between 1 and 12 or array_ndims(p_subjects)<>1
    or array_position(p_subjects,null) is not null or not public.assessment_topics_valid(p_subjects)
    or p_grade is null or p_grade not between -1 and 12 then raise exception 'VALIDATION'; end if;
  v_subjects:=array(select distinct unnest(p_subjects) order by 1);
  if cardinality(v_subjects)<>cardinality(p_subjects) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('parent-assessment-request:'||p_request_id::text,0));
  select * into v_invitation from public.lead_invitation_threads where id=p_request_id for update;
  if found then
    if v_invitation.parent_request_actor is distinct from v_uid or v_invitation.assessment_slot_id is distinct from p_slot_id
      or v_invitation.parent_request_payload->>'studentId' is distinct from p_student_id::text
      or v_invitation.parent_request_payload->'subjects' is distinct from to_jsonb(v_subjects)
      or v_invitation.parent_request_payload->>'mode' is distinct from p_mode
      or v_invitation.parent_request_payload->'grade' is distinct from to_jsonb(p_grade) then raise exception 'CONFLICT'; end if;
    if v_invitation.kind<>'assessment_1v1' or not exists(select 1 from public.leads where id=v_invitation.lead_id and student_id=p_student_id) then raise exception 'CONFLICT'; end if;
    return public.parent_assessment_request_projection(v_invitation.id,p_student_id);
  end if;
  perform 1 from public.students where id=p_student_id for update;
  select * into v_lead from public.leads where student_id=p_student_id order by id limit 1 for update;
  if not public.miniapp_can_register(p_student_id,'activity')
    or not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'FORBIDDEN'; end if;
  select count(*) into v_count from public.leads where student_id=p_student_id;
  if v_count=0 then raise exception 'NO_LINKED_LEAD'; end if;
  if v_count>1 then raise exception 'AMBIGUOUS_LINKED_LEAD'; end if;
  if v_lead.status='invalid' then raise exception 'LEAD_UNAVAILABLE'; end if;
  if exists(select 1 from public.lead_invitation_threads where lead_id=v_lead.id and state not in ('completed','cancelled')) then raise exception 'ACTIVE_INVITATION'; end if;
  select teacher_id into v_teacher from public.assessment_slots where id=p_slot_id;
  if v_teacher is null then raise exception 'SLOT_UNAVAILABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
  select * into v_slot from public.assessment_slots where id=p_slot_id for update;
  v_policy:=public.miniapp_booking_policy();
  if v_slot.mode is distinct from p_mode or not(v_policy->'modes' ? p_mode) or v_slot.teacher_id is distinct from v_teacher or not v_slot.enabled or public.assessment_slot_excluded(v_slot.teacher_id,v_slot.campus_id,v_slot.starts_at,v_slot.ends_at) or not public.assessment_topics_valid(p_subjects,true) or v_slot.starts_at<=now()+make_interval(mins=>(v_policy->>'bookingCutoffMinutes')::integer)
    or v_slot.starts_at>=(((now() at time zone 'Asia/Shanghai')::date+(v_policy->>'windowDays')::integer)::timestamp at time zone 'Asia/Shanghai')
    or not v_subjects<@v_slot.subjects or (cardinality(v_slot.grades)>0 and not p_grade=any(v_slot.grades)) then raise exception 'SLOT_UNAVAILABLE'; end if;
  if not public.is_assessment_teacher(v_teacher) then raise exception 'NO_ELIGIBLE_TEACHER'; end if;
  select name into v_campus_name from public.campuses where id=v_slot.campus_id and status='active';
  if not found then raise exception 'CAMPUS_UNAVAILABLE'; end if;
  if exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot_id and state<>'cancelled') then raise exception 'SLOT_UNAVAILABLE'; end if;
  if v_slot.mode='campus' and public.staff_calendar_campus_closed(v_slot.campus_id,v_slot.starts_at,v_slot.ends_at) then raise exception 'SLOT_UNAVAILABLE'; end if; if public.assessment_teacher_time_busy(v_teacher,v_slot.starts_at,v_slot.ends_at) then raise exception 'TIME_UNAVAILABLE'; end if;
  v_payload:=jsonb_build_object('version',2,'studentId',p_student_id,'assessorId',v_teacher,'slotId',p_slot_id,
    'subjects',v_subjects,'grade',p_grade,'mode',p_mode,'joiningInstructions',v_slot.joining_instructions,
    'policy',v_policy,'cancelUntil',case when (v_policy->>'selfCancellation')::boolean then v_slot.starts_at-make_interval(mins=>(v_policy->>'cancellationCutoffMinutes')::integer) end,'campus',jsonb_build_object('id',v_slot.campus_id,'name',v_campus_name),'endsAt',v_slot.ends_at);
  begin
    insert into public.lead_invitation_threads(id,lead_id,kind,state,assessor_id,scheduled_at,location_text,
      owner_id_at_open,created_by,updated_by,parent_request_actor,parent_request_payload,assessment_slot_id)
    values(p_request_id,v_lead.id,'assessment_1v1','confirmed',v_teacher,v_slot.starts_at,case when p_mode='online' then '线上诊断 · '||v_campus_name else '到校诊断 · '||v_campus_name end,
      v_lead.owner_id,v_uid,v_uid,v_uid,v_payload,p_slot_id);
  exception when unique_violation then
    if exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot_id and state<>'cancelled') then raise exception 'SLOT_UNAVAILABLE'; end if;
    raise exception 'ACTIVE_INVITATION';
  end;
  insert into public.lead_invitation_events(invitation_id,from_state,to_state,channel,note,recorded_by)
    values(p_request_id,null,'confirmed','other','家长预约已发布的诊断时段',v_uid);
  perform public.emit_domain_event('parent.assessment.confirmed','lead_invitation',p_request_id,
    jsonb_build_object('studentId',p_student_id,'slotId',p_slot_id,'scheduledAt',v_slot.starts_at),v_teacher,null);
  return public.parent_assessment_request_projection(p_request_id,p_student_id);
end $function$;
create or replace function public.book_parent_assessment_slot(p_request_id uuid,p_student_id uuid,p_slot_id uuid,p_subjects text[],p_grade integer) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select public.book_parent_assessment_slot_v2(p_request_id,p_student_id,p_slot_id,p_subjects,p_grade,'campus');
$$;
revoke all on function public.book_parent_assessment_slot_v2(uuid,uuid,uuid,text[],integer,text) from public,anon,authenticated;
grant execute on function public.book_parent_assessment_slot_v2(uuid,uuid,uuid,text[],integer,text) to postgres,authenticated;

create function public.cancel_parent_assessment_slot(p_id uuid,p_student_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.lead_invitation_threads; v_teacher uuid; v_lead uuid; v_uid uuid:=auth.uid();
begin
  if not public.miniapp_can_register(p_student_id,'activity') or not exists(select 1 from profiles where id=v_uid and is_active) then raise exception 'FORBIDDEN'; end if;
  -- Follow the booking lock order: request, student, lead, teacher, invitation.
  perform pg_advisory_xact_lock(hashtextextended('parent-assessment-request:'||p_id::text,0));
  perform 1 from public.students where id=p_student_id for update;
  select l.id,t2.assessor_id into v_lead,v_teacher from public.lead_invitation_threads t2 join public.leads l on l.id=t2.lead_id
    where t2.id=p_id and t2.parent_request_actor=v_uid and l.student_id=p_student_id and t2.assessment_slot_id is not null;
  if v_teacher is null then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.leads where id=v_lead for update;
  perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
  select * into t from public.lead_invitation_threads where id=p_id for update;
  if not public.miniapp_can_register(p_student_id,'activity') or t.parent_request_actor is distinct from v_uid then raise exception 'FORBIDDEN'; end if;
  if t.state='cancelled' then return public.parent_assessment_request_projection(p_id,p_student_id); end if;
  if t.state<>'confirmed' or not coalesce((t.parent_request_payload->>'cancelUntil')::timestamptz>now(),false) then raise exception 'BOOKING_CLOSED'; end if;
  update public.lead_invitation_threads set state='cancelled',closed_by=v_uid,closed_at=now(),updated_by=v_uid,updated_at=clock_timestamp() where id=p_id;
  insert into public.lead_invitation_events(invitation_id,from_state,to_state,channel,note,recorded_by)
    values(p_id,'confirmed','cancelled','other','家长在预约截止前取消',v_uid);
  perform public.emit_domain_event('parent.assessment.cancelled','lead_invitation',p_id,jsonb_build_object('studentId',p_student_id),v_teacher,null);
  return public.parent_assessment_request_projection(p_id,p_student_id);
end $$;
revoke all on function public.cancel_parent_assessment_slot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_parent_assessment_slot(uuid,uuid) to authenticated;
-- Project cancellation from the same status, record and time boundaries as the existing activity RPC.
do $capability$
declare d text; needle text:='''status'',r.status) item';
begin
  d:=pg_get_functiondef('public.miniapp_my_bookings()'::regprocedure);
  if position(needle in d)=0 then raise exception 'BOOKING_PROJECTION_ANCHOR_CHANGED'; end if;
  execute replace(d,needle,'''status'',r.status,''canCancel'',r.status=''booked'' and r.record_state=''current'' and a.scheduled_at>now()) item');
end $capability$;
notify pgrst,'reload schema';
commit;
