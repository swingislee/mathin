-- Shared opening/exclusion rules use the existing employee business groups.
-- Roles describe teaching work; all existing capability checks still apply.
alter table public.assessment_availability_rules alter column teacher_id drop not null;
alter table public.assessment_availability_rules add column scope jsonb;
alter table public.assessment_availability_rules add constraint assessment_rule_scope_check check (
  (teacher_id is not null and scope is null) or
  (teacher_id is null and scope is not null and jsonb_typeof(scope)='object'
    and scope->>'kind' in ('all','groups','teachers') and jsonb_typeof(scope->'ids')='array'));

create function public.is_assessment_teacher(p_user uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(public.is_staff(p_user) and public.has_perm(p_user,'review.write') and exists(
    select 1 from public.school_staff_business_roles r where r.user_id=p_user and r.business_role in ('teacher','assessment_teacher')),false);
$$;
create function public.assessment_rule_applies(p_rule public.assessment_availability_rules,p_teacher uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(p_rule.teacher_id=p_teacher or (p_rule.teacher_id is null and (
    p_rule.scope->>'kind'='all' or (p_rule.scope->>'kind'='teachers' and p_rule.scope->'ids' @> to_jsonb(array[p_teacher]))
    or (p_rule.scope->>'kind'='groups' and exists(select 1 from public.school_business_group_members m
      where m.user_id=p_teacher and m.removed_at is null and p_rule.scope->'ids' @> to_jsonb(array[m.group_id]))))),false);
$$;

create function public.validate_assessment_rule_definition(p_definition jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_from date; v_until date;
  v_topics text[]; v_grades integer[]; v_weekdays integer[]; v_start integer; v_end integer; v_duration integer; v_enabled boolean; v_kind text; v_campus uuid;
begin
  if p_definition is null or jsonb_typeof(p_definition)<>'object'
    or not p_definition ?& array['kind','label','campusId','topics','grades','weekdays','from','until','startMinute','endMinute','durationMinutes','timeZone','enabled']
    or p_definition-array['kind','label','campusId','topics','grades','weekdays','from','until','startMinute','endMinute','durationMinutes','timeZone','enabled']<>'{}'::jsonb
    or jsonb_typeof(p_definition->'topics')<>'array' or jsonb_typeof(p_definition->'grades')<>'array'
    or jsonb_typeof(p_definition->'weekdays')<>'array' or jsonb_typeof(p_definition->'enabled')<>'boolean'
    or jsonb_typeof(p_definition->'label')<>'string' or length(p_definition->>'label')>120
    or not exists(select 1 from pg_timezone_names where name=p_definition->>'timeZone') then raise exception 'VALIDATION'; end if;
  begin
    v_from:=(p_definition->>'from')::date; v_until:=(p_definition->>'until')::date;
    v_start:=(p_definition->>'startMinute')::integer; v_end:=(p_definition->>'endMinute')::integer;
    v_duration:=(p_definition->>'durationMinutes')::integer; v_campus:=(p_definition->>'campusId')::uuid;
    v_topics:=array(select jsonb_array_elements_text(p_definition->'topics') order by 1);
    v_grades:=array(select x::integer from jsonb_array_elements_text(p_definition->'grades') x order by 1);
    v_weekdays:=array(select x::integer from jsonb_array_elements_text(p_definition->'weekdays') x order by 1);
  exception when invalid_text_representation or datetime_field_overflow then raise exception 'VALIDATION'; end;
  v_enabled:=(p_definition->>'enabled')::boolean; v_kind:=p_definition->>'kind';
  if v_kind is null or v_kind not in ('open','exclude') or v_from is null or v_until is null or not isfinite(v_from) or not isfinite(v_until)
    or v_until<v_from or v_until-v_from>370 or v_start is null or v_end is null or v_start<0 or v_end>1440 or v_start>=v_end
    or cardinality(v_weekdays)>7 or array_position(v_weekdays,null) is not null or not v_weekdays<@array[1,2,3,4,5,6,7]
    or cardinality(v_weekdays)<>(select count(distinct x) from unnest(v_weekdays) x)
    or cardinality(v_grades)>14 or array_position(v_grades,null) is not null or not v_grades<@array[-1,0,1,2,3,4,5,6,7,8,9,10,11,12]
    or cardinality(v_grades)<>(select count(distinct x) from unnest(v_grades) x) then raise exception 'VALIDATION'; end if;
  if v_kind='open' then
    if v_campus is null or cardinality(v_weekdays)=0 or v_duration is null or v_duration not between 5 and 240 or v_duration>v_end-v_start
      or not public.assessment_topics_valid(v_topics,v_enabled) then raise exception 'VALIDATION'; end if;
  elsif cardinality(v_topics)<>0 or cardinality(v_grades)<>0 or v_duration is not null then raise exception 'VALIDATION'; end if;
  if v_campus is not null and not exists(select 1 from public.campuses where id=v_campus and (not v_enabled or status='active')) then raise exception 'CAMPUS_UNAVAILABLE'; end if;
end $$;

create or replace function public.refresh_assessment_rule_slots(p_teacher uuid,p_actor uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
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
          and s.campus_id=(r.definition->>'campusId')::uuid and s.subjects=v_subjects and s.grades=v_grades order by s.created_at,s.id limit 1;
        if found then
          update public.assessment_slots set enabled=true,updated_by=p_actor where id=v_slot.id;
        else
          insert into public.assessment_slots(id,teacher_id,campus_id,subjects,grades,starts_at,ends_at,enabled,created_by,updated_by,rule_id)
            values(gen_random_uuid(),p_teacher,(r.definition->>'campusId')::uuid,v_subjects,v_grades,v_start,v_end,true,p_actor,p_actor,r.id);
        end if;
      end loop;
    end loop;
  end loop;
end $$;
create or replace function public.save_assessment_rule(p_id uuid,p_teacher_id uuid,p_definition jsonb,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_old public.assessment_availability_rules%rowtype; v_from date; v_until date;
  v_topics text[]; v_grades integer[]; v_weekdays integer[]; v_start integer; v_end integer; v_duration integer; v_enabled boolean; v_kind text; v_campus uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(v_uid,p_teacher_id) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_teacher_id is null then raise exception 'VALIDATION'; end if;
  perform public.validate_assessment_rule_definition(p_definition);
  v_kind:=p_definition->>'kind';
  if v_kind='open' and (p_definition->>'enabled')::boolean and not public.is_assessment_teacher(p_teacher_id) then raise exception 'NO_ELIGIBLE_TEACHER'; end if;
  perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||p_teacher_id::text,0));
  select * into v_old from public.assessment_availability_rules where id=p_id for update;
  if found then
    if v_old.teacher_id is distinct from p_teacher_id then raise exception 'FORBIDDEN'; end if;
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_old.updated_at then raise exception 'CONFLICT'; end if;
    update public.assessment_availability_rules set definition=p_definition,updated_by=v_uid,updated_at=clock_timestamp() where id=p_id;
  else
    if p_expected_updated_at is not null then raise exception 'NOT_FOUND'; end if;
    insert into public.assessment_availability_rules(id,teacher_id,definition,created_by,updated_by) values(p_id,p_teacher_id,p_definition,v_uid,v_uid);
  end if;
  if v_kind='open' or v_old.definition->>'kind'='open' then perform public.refresh_assessment_rule_slots(p_teacher_id,v_uid); end if;
  return public.get_assessment_rules_workspace();
end $$;
create or replace function public.get_assessment_rules_workspace() returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_all boolean; v_teachers jsonb; v_rules jsonb; v_campuses jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(v_uid,v_uid) then raise exception 'FORBIDDEN'; end if;
  v_all:=public.assessment_slots_manage_all(v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'displayName',p.display_name,
    'canReceive',public.is_assessment_teacher(p.id),
    'groupIds',coalesce((select jsonb_agg(m.group_id) from public.school_business_group_members m where m.user_id=p.id and m.removed_at is null),'[]'::jsonb),
    'standaloneCount',(select count(*) from public.assessment_slots s where s.teacher_id=p.id and s.rule_id is null and s.enabled and s.starts_at>now()))
    order by p.display_name,p.id),'[]') into v_teachers from public.profiles p
    where (v_all or p.id=v_uid) and public.is_staff(p.id) and exists(select 1 from public.school_staff_business_roles r
      where r.user_id=p.id and r.business_role in ('teacher','assessment_teacher'));
  select coalesce(jsonb_agg(r.definition||jsonb_build_object('id',r.id,'teacherId',r.teacher_id,'scope',r.scope,'updatedAt',r.updated_at,
    'availableCount',(select count(*) from public.assessment_slots s join public.campuses c on c.id=s.campus_id
      where s.rule_id=r.id and (v_all or s.teacher_id=v_uid) and s.enabled and s.starts_at>now() and c.status='active'
        and public.is_assessment_teacher(s.teacher_id)
        and exists(select 1 from public.assessment_topics t where t.enabled and t.id=any(s.subjects))
        and not public.assessment_slot_excluded(s.teacher_id,s.campus_id,s.starts_at,s.ends_at) and not public.staff_calendar_campus_closed(s.campus_id,s.starts_at,s.ends_at)
        and not public.assessment_teacher_time_busy(s.teacher_id,s.starts_at,s.ends_at)),
    'bookedCount',(select count(*) from public.assessment_slots s join public.lead_invitation_threads t on t.assessment_slot_id=s.id
      where s.rule_id=r.id and (v_all or s.teacher_id=v_uid) and s.ends_at>now() and t.state<>'cancelled')) order by r.definition->>'kind',r.definition->>'from',r.id),'[]')
    into v_rules from public.assessment_availability_rules r where v_all or public.assessment_rule_applies(r,v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'active',c.status='active') order by c.name,c.id),'[]')
    into v_campuses from public.campuses c;
  return jsonb_build_object('currentUserId',v_uid,'canManageAll',v_all,'teachers',v_teachers,'campuses',v_campuses,'rules',v_rules,
    'topics',public.assessment_topic_projection(),'canManageStaff',public.can_manage_school_groups(),
    'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name) from public.school_business_groups g
      where v_all or exists(select 1 from public.school_business_group_members m where m.group_id=g.id and m.user_id=v_uid and m.removed_at is null)),'[]'::jsonb));
end $$;

create function public.save_assessment_shared_rule(p_id uuid,p_scope jsonb,p_definition jsonb,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_old public.assessment_availability_rules%rowtype; v_ids uuid[]; v_teacher uuid; v_teachers uuid[];
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_manage_all(v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_scope is null or jsonb_typeof(p_scope)<>'object'
    or not p_scope ?& array['kind','ids'] or p_scope-array['kind','ids']<>'{}'::jsonb
    or p_scope->>'kind' is null or p_scope->>'kind' not in ('all','groups','teachers') or jsonb_typeof(p_scope->'ids')<>'array' then raise exception 'VALIDATION'; end if;
  begin v_ids:=array(select x::uuid from jsonb_array_elements_text(p_scope->'ids') x);
  exception when invalid_text_representation then raise exception 'VALIDATION'; end;
  if cardinality(v_ids)>500 or array_position(v_ids,null) is not null
    or cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids) x)
    or (p_scope->>'kind'='all' and cardinality(v_ids)<>0)
    or (p_scope->>'kind'<>'all' and cardinality(v_ids)=0) then raise exception 'VALIDATION'; end if;
  if p_scope->>'kind'='groups' and exists(select 1 from unnest(v_ids) id where not exists(select 1 from public.school_business_groups g where g.id=id)) then raise exception 'VALIDATION'; end if;
  if p_scope->>'kind'='teachers' and exists(select 1 from unnest(v_ids) id where not exists(select 1 from public.school_staff_business_roles r
    where r.user_id=id and r.business_role in ('teacher','assessment_teacher') and public.is_staff(r.user_id))) then raise exception 'NO_ELIGIBLE_TEACHER'; end if;
  perform public.validate_assessment_rule_definition(p_definition);
  perform pg_advisory_xact_lock(hashtextextended('assessment-shared-rules',0));
  select * into v_old from public.assessment_availability_rules where id=p_id for update;
  if found then
    if v_old.teacher_id is not null then raise exception 'FORBIDDEN'; end if;
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_old.updated_at then raise exception 'CONFLICT'; end if;
  elsif p_expected_updated_at is not null then raise exception 'NOT_FOUND'; end if;
  -- Lock old and new targets in the same order before changing the shared rule.
  select array_agg(id order by id) into v_teachers from (
    select p.id from public.profiles p where public.is_assessment_teacher(p.id)
    union select s.teacher_id from public.assessment_slots s where s.rule_id=p_id and s.starts_at>now()
  ) targets;
  foreach v_teacher in array coalesce(v_teachers,'{}'::uuid[]) loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
  end loop;
  insert into public.assessment_availability_rules(id,teacher_id,scope,definition,created_by,updated_by)
    values(p_id,null,p_scope,p_definition,v_uid,v_uid)
    on conflict(id) do update set scope=excluded.scope,definition=excluded.definition,updated_by=v_uid,updated_at=clock_timestamp();
  if p_definition->>'kind'='open' or v_old.definition->>'kind'='open' then
    foreach v_teacher in array coalesce(v_teachers,'{}'::uuid[]) loop perform public.refresh_assessment_rule_slots(v_teacher,v_uid); end loop;
  end if;
  return public.get_assessment_rules_workspace();
end $$;

create function public.refresh_assessment_staff_scope() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_teacher uuid; v_actor uuid;
begin
  v_teacher:=case when tg_op='DELETE' then old.user_id else new.user_id end;
  v_actor:=coalesce(auth.uid(),v_teacher);
  perform public.refresh_assessment_rule_slots(v_teacher,v_actor);
  return null;
end $$;
create trigger assessment_staff_role_scope after insert or update or delete on public.school_staff_business_roles
  for each row execute function public.refresh_assessment_staff_scope();
create trigger assessment_staff_group_scope after insert or update or delete on public.school_business_group_members
  for each row execute function public.refresh_assessment_staff_scope();


-- Keep booking identity, ownership, idempotency and capability checks intact.
do $wire$
declare v_sig text; v_def text; v_before text; v_after text;
begin
  for v_sig,v_before,v_after in select * from (values
    ('public.assessment_slot_excluded(uuid,uuid,timestamptz,timestamptz)','r.teacher_id=p_teacher','public.assessment_rule_applies(r,p_teacher)'),
    ('public.assessment_public_topics()', 'public.is_staff(s.teacher_id) and public.has_perm(s.teacher_id,''review.write'')', 'public.is_assessment_teacher(s.teacher_id)'),
    ('public.parent_assessment_availability(uuid,text[],integer)', 'public.is_staff(p.id) and public.has_perm(p.id,''review.write'')', 'public.is_assessment_teacher(p.id)'),
    ('public.parent_assessment_request_blocker(uuid)', 'public.is_staff(s.teacher_id) and public.has_perm(s.teacher_id,''review.write'')', 'public.is_assessment_teacher(s.teacher_id)'),
    ('public.parent_assessment_eligible_teachers(uuid)', 'and public.has_perm(p.id,''review.write'')', 'and public.is_assessment_teacher(p.id)'),
    ('public.book_parent_assessment_slot(uuid,uuid,uuid,text[],integer)', 'not public.is_staff(v_teacher) or not public.has_perm(v_teacher,''review.write'')', 'not public.is_assessment_teacher(v_teacher)'),
    ('public.save_assessment_slot(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,timestamptz)', 'not public.is_staff(p_teacher_id) or not public.has_perm(p_teacher_id,''review.write'')', 'not public.is_assessment_teacher(p_teacher_id)'),
    ('public.get_assessment_slot_management(date,date)', 'public.is_staff(p.id) and public.has_perm(p.id,''review.write'')', 'public.is_assessment_teacher(p.id)'),
    ('public.read_school_collaboration_settings()', '''canFollowUp'',public.has_perm(p.id,''followup.write'')', '''canFollowUp'',public.has_perm(p.id,''followup.write''),''canReview'',public.has_perm(p.id,''review.write'')'),
    ('public.assessment_slot_projection(public.assessment_slots)', '''blocked'',public.assessment_slot_excluded', '''blocked'',not public.is_assessment_teacher(p_slot.teacher_id) or not exists(select 1 from public.assessment_topics topic where topic.enabled and topic.id=any(p_slot.subjects)) or public.assessment_slot_excluded')
  ) changes(sig,before_text,after_text) loop
    v_def:=pg_get_functiondef(v_sig::regprocedure);
    if position(v_before in v_def)=0 then raise exception 'ASSESSMENT_SCOPE_ANCHOR_MISSING: %',v_sig; end if;
    execute replace(v_def,v_before,v_after);
  end loop;
end $wire$;

create function public.get_assessment_teacher_calendar(p_teacher_id uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(auth.uid(),p_teacher_id) then raise exception 'FORBIDDEN'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>30 then raise exception 'VALIDATION'; end if;
  return coalesce((select jsonb_agg(public.assessment_slot_projection(s) order by s.starts_at,s.id)
    from public.assessment_slots s where s.teacher_id=p_teacher_id
      and s.starts_at>=p_from::timestamp at time zone 'Asia/Shanghai' and s.starts_at<(p_to+1)::timestamp at time zone 'Asia/Shanghai'
      and (s.enabled or exists(select 1 from public.lead_invitation_threads t where t.assessment_slot_id=s.id and t.state in ('awaiting_parent','confirmed','completed')))),'[]'::jsonb);
end $$;

revoke all on function public.is_assessment_teacher(uuid),public.assessment_rule_applies(public.assessment_availability_rules,uuid),
  public.validate_assessment_rule_definition(jsonb),public.refresh_assessment_staff_scope(),
  public.save_assessment_shared_rule(uuid,jsonb,jsonb,timestamptz),public.get_assessment_teacher_calendar(uuid,date,date) from public,anon,authenticated;
grant execute on function public.save_assessment_shared_rule(uuid,jsonb,jsonb,timestamptz),public.get_assessment_teacher_calendar(uuid,date,date) to authenticated;
select pg_notify('pgrst','reload schema');
