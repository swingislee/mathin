-- Backend-owned diagnostic topics and teacher opening/exclusion rules.
-- Existing bookings and standalone slots retain their identities and snapshots.
create table public.assessment_topics (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  name_en text not null default '' check (length(name_en)<=80),
  enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.assessment_topics(id,name,name_en) values
  ('thinking','思维','Thinking'),('math','数学','Mathematics'),('english','英语','English');
alter table public.assessment_topics enable row level security;
revoke all on public.assessment_topics from public,anon,authenticated;

create function public.assessment_topics_valid(p_topics text[],p_enabled boolean default false) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select coalesce(cardinality(p_topics) between 1 and 12 and array_ndims(p_topics)=1
    and array_position(p_topics,null) is null
    and cardinality(p_topics)=(select count(distinct x) from unnest(p_topics) x)
    and not exists(select 1 from unnest(p_topics) x where not exists(
      select 1 from public.assessment_topics t where t.id=x and (not p_enabled or t.enabled))),false);
$$;
alter table public.assessment_slots drop constraint assessment_slots_subjects_check;
alter table public.assessment_slots add constraint assessment_slots_subjects_check check (public.assessment_topics_valid(subjects));

create table public.assessment_availability_rules (
  id uuid primary key,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  definition jsonb not null check(jsonb_typeof(definition)='object'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp()
);
create index assessment_rules_teacher_idx on public.assessment_availability_rules(teacher_id);
alter table public.assessment_availability_rules enable row level security;
revoke all on public.assessment_availability_rules from public,anon,authenticated;
alter table public.assessment_slots add column rule_id uuid references public.assessment_availability_rules(id) on delete restrict;
create index assessment_slots_rule_idx on public.assessment_slots(rule_id,starts_at) where rule_id is not null;

-- Exclusions are evaluated when reading and booking, including standalone slots.
-- This also allows an exclusion to be removed without recreating slot identities.
create function public.assessment_slot_excluded(p_teacher uuid,p_campus uuid,p_start timestamptz,p_end timestamptz) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select exists(select 1 from public.assessment_availability_rules r
    cross join lateral generate_series(
      (p_start at time zone (r.definition->>'timeZone'))::date::timestamp,
      ((p_end-interval '1 microsecond') at time zone (r.definition->>'timeZone'))::date::timestamp,interval '1 day') d
    where r.teacher_id=p_teacher and r.definition->>'kind'='exclude' and (r.definition->>'enabled')::boolean
      and (r.definition->>'campusId' is null or r.definition->>'campusId'=p_campus::text)
      and d::date between (r.definition->>'from')::date and (r.definition->>'until')::date
      and (r.definition->'weekdays'='[]'::jsonb or r.definition->'weekdays' @> to_jsonb(array[extract(isodow from d)::integer]))
      and tstzrange(p_start,p_end,'[)') && tstzrange(
        (d+make_interval(mins=>(r.definition->>'startMinute')::integer)) at time zone (r.definition->>'timeZone'),
        (d+make_interval(mins=>(r.definition->>'endMinute')::integer)) at time zone (r.definition->>'timeZone'),'[)'));
$$;

create function public.assessment_topic_projection() returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'nameEn',name_en,'enabled',enabled,'updatedAt',updated_at)
    order by case when id='thinking' then 0 else 1 end,name,id),'[]') from public.assessment_topics;
$$;
create function public.assessment_public_topics() returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  with available as materialized (
    select s.subjects from public.assessment_slots s join public.campuses c on c.id=s.campus_id
    where s.enabled and s.starts_at>now()
      and s.starts_at<(((now() at time zone 'Asia/Shanghai')::date+14)::timestamp at time zone 'Asia/Shanghai')
      and public.is_staff(s.teacher_id) and public.has_perm(s.teacher_id,'review.write') and c.status='active'
      and not public.assessment_slot_excluded(s.teacher_id,s.campus_id,s.starts_at,s.ends_at)
      and not public.staff_calendar_campus_closed(s.campus_id,s.starts_at,s.ends_at)
      and not public.assessment_teacher_time_busy(s.teacher_id,s.starts_at,s.ends_at)
  ) select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'label',jsonb_build_object('zh',t.name,'en',coalesce(nullif(t.name_en,''),t.name)),
    'available',t.enabled and exists(select 1 from available a where t.id=any(a.subjects)))
    order by case when t.id='thinking' then 0 else 1 end,t.name,t.id),'[]') from public.assessment_topics t;
$$;

create function public.get_assessment_rules_workspace() returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_all boolean; v_teachers jsonb; v_rules jsonb; v_campuses jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(v_uid,v_uid) then raise exception 'FORBIDDEN'; end if;
  v_all:=public.assessment_slots_manage_all(v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'displayName',p.display_name,
    'canReceive',public.is_staff(p.id) and public.has_perm(p.id,'review.write'),
    'standaloneCount',(select count(*) from public.assessment_slots s where s.teacher_id=p.id and s.rule_id is null and s.enabled and s.starts_at>now()))
    order by p.display_name,p.id),'[]') into v_teachers from public.profiles p
    where (v_all or p.id=v_uid) and ((public.is_staff(p.id) and public.has_perm(p.id,'review.write'))
      or exists(select 1 from public.assessment_availability_rules r where r.teacher_id=p.id)
      or exists(select 1 from public.assessment_slots s where s.teacher_id=p.id and s.starts_at>now()));
  select coalesce(jsonb_agg(r.definition||jsonb_build_object('id',r.id,'teacherId',r.teacher_id,'updatedAt',r.updated_at,
    'availableCount',(select count(*) from public.assessment_slots s join public.campuses c on c.id=s.campus_id
      where s.rule_id=r.id and s.enabled and s.starts_at>now() and c.status='active'
        and public.is_staff(s.teacher_id) and public.has_perm(s.teacher_id,'review.write')
        and exists(select 1 from public.assessment_topics t where t.enabled and t.id=any(s.subjects))
        and not public.assessment_slot_excluded(s.teacher_id,s.campus_id,s.starts_at,s.ends_at) and not public.staff_calendar_campus_closed(s.campus_id,s.starts_at,s.ends_at)
        and not public.assessment_teacher_time_busy(s.teacher_id,s.starts_at,s.ends_at)),
    'bookedCount',(select count(*) from public.assessment_slots s join public.lead_invitation_threads t on t.assessment_slot_id=s.id
      where s.rule_id=r.id and s.ends_at>now() and t.state<>'cancelled')) order by r.definition->>'kind',r.definition->>'from',r.id),'[]')
    into v_rules from public.assessment_availability_rules r where v_all or r.teacher_id=v_uid;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'active',c.status='active') order by c.name,c.id),'[]')
    into v_campuses from public.campuses c;
  return jsonb_build_object('currentUserId',v_uid,'canManageAll',v_all,'teachers',v_teachers,'campuses',v_campuses,'rules',v_rules,
    'topics',public.assessment_topic_projection());
end $$;

create function public.save_assessment_topic(p_id text,p_name text,p_name_en text,p_enabled boolean,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.assessment_topics%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_manage_all(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' or p_name is null or length(btrim(p_name)) not between 1 and 80
    or p_name_en is null or length(btrim(p_name_en))>80 or p_enabled is null then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('assessment-topic:'||p_id,0));
  select * into v_old from public.assessment_topics where id=p_id for update;
  if found then
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_old.updated_at then raise exception 'CONFLICT'; end if;
    update public.assessment_topics set name=btrim(p_name),name_en=btrim(p_name_en),enabled=p_enabled,updated_at=clock_timestamp() where id=p_id;
  else
    if p_expected_updated_at is not null then raise exception 'NOT_FOUND'; end if;
    insert into public.assessment_topics(id,name,name_en,enabled) values(p_id,btrim(p_name),btrim(p_name_en),p_enabled);
  end if;
  return public.get_assessment_rules_workspace();
end $$;

-- Called only after the caller and rule have been validated, under the teacher lock.
create function public.refresh_assessment_rule_slots(p_teacher uuid,p_actor uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; d date; m integer; v_start timestamptz; v_end timestamptz; v_subjects text[]; v_grades integer[];
  v_slot public.assessment_slots%rowtype; v_total integer:=0; v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||p_teacher::text,0));
  -- Booking snapshots are immutable. Disabling a slot never cancels its booking.
  update public.assessment_slots set enabled=false,updated_by=p_actor where teacher_id=p_teacher and rule_id is not null and starts_at>now() and enabled;
  for r in select * from public.assessment_availability_rules where teacher_id=p_teacher
    and definition->>'kind'='open' and (definition->>'enabled')::boolean order by id loop
    if not public.is_staff(p_teacher) or not public.has_perm(p_teacher,'review.write') then continue; end if;
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
        -- Existing confirmed appointments keep their original time, teacher and topic.
        if exists(select 1 from public.lead_invitation_threads t left join public.assessment_slots s on s.id=t.assessment_slot_id
          where t.assessor_id=p_teacher and t.kind='assessment_1v1' and t.state in ('awaiting_parent','confirmed','completed') and t.scheduled_at is not null
          and tstzrange(t.scheduled_at,coalesce(s.ends_at,t.scheduled_at+interval '40 minutes'),'[)') && tstzrange(v_start,v_end,'[)')) then continue; end if;
        select * into v_slot from public.assessment_slots s where s.rule_id=r.id and s.starts_at=v_start and s.ends_at=v_end
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

create function public.save_assessment_rule(p_id uuid,p_teacher_id uuid,p_definition jsonb,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_old public.assessment_availability_rules%rowtype; v_from date; v_until date;
  v_topics text[]; v_grades integer[]; v_weekdays integer[]; v_start integer; v_end integer; v_duration integer; v_enabled boolean; v_kind text; v_campus uuid;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(v_uid,p_teacher_id) then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_teacher_id is null or p_definition is null or jsonb_typeof(p_definition)<>'object'
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
    if v_enabled and (not public.is_staff(p_teacher_id) or not public.has_perm(p_teacher_id,'review.write')) then raise exception 'NO_ELIGIBLE_TEACHER'; end if;
  elsif cardinality(v_topics)<>0 or cardinality(v_grades)<>0 or v_duration is not null then raise exception 'VALIDATION'; end if;
  if v_campus is not null and not exists(select 1 from public.campuses where id=v_campus and (not v_enabled or status='active')) then raise exception 'CAMPUS_UNAVAILABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||p_teacher_id::text,0));
  select * into v_old from public.assessment_availability_rules where id=p_id for update;
  if found then
    if v_old.teacher_id<>p_teacher_id then raise exception 'FORBIDDEN'; end if;
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_old.updated_at then raise exception 'CONFLICT'; end if;
    update public.assessment_availability_rules set definition=p_definition,updated_by=v_uid,updated_at=clock_timestamp() where id=p_id;
  else
    if p_expected_updated_at is not null then raise exception 'NOT_FOUND'; end if;
    insert into public.assessment_availability_rules(id,teacher_id,definition,created_by,updated_by) values(p_id,p_teacher_id,p_definition,v_uid,v_uid);
  end if;
  if v_kind='open' or v_old.definition->>'kind'='open' then perform public.refresh_assessment_rule_slots(p_teacher_id,v_uid); end if;
  return public.get_assessment_rules_workspace();
end $$;

-- Preserve all existing authorization/idempotency logic; replace only the topic
-- whitelist and add the exclusion checks at the existing booking/read gates.
do $wire$
declare sig text; def text; needle text;
begin
  foreach sig in array array[
    'public.save_assessment_slot(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,timestamptz)',
    'public.parent_assessment_availability(uuid,text[],integer)',
    'public.book_parent_assessment_slot(uuid,uuid,uuid,text[],integer)'] loop
    def:=pg_get_functiondef(sig::regprocedure);
    needle:='not p_subjects<@array[''math'',''english'']::text[]';
    if position(needle in def)=0 then raise exception 'ASSESSMENT_TOPIC_ANCHOR_MISSING: %',sig; end if;
    def:=replace(def,needle,'not public.assessment_topics_valid(p_subjects)');
    def:=replace(def,'cardinality(p_subjects) not between 1 and 2','cardinality(p_subjects) not between 1 and 12');
    if sig like '%parent_assessment_availability%' then
      needle:='''available'',not public.assessment_teacher_time_busy(s.teacher_id,s.starts_at,s.ends_at)';
      if position(needle in def)=0 then raise exception 'ASSESSMENT_AVAILABILITY_ANCHOR_MISSING'; end if;
      def:=replace(def,needle,needle||' and not public.assessment_slot_excluded(s.teacher_id,s.campus_id,s.starts_at,s.ends_at) and public.assessment_topics_valid(p_subjects,true)');
    elsif sig like '%book_parent_assessment_slot%' then
      needle:='if v_slot.teacher_id is distinct from v_teacher or not v_slot.enabled';
      if position(needle in def)=0 then raise exception 'ASSESSMENT_BOOK_ANCHOR_MISSING'; end if;
      def:=replace(def,needle,needle||' or public.assessment_slot_excluded(v_slot.teacher_id,v_slot.campus_id,v_slot.starts_at,v_slot.ends_at) or not public.assessment_topics_valid(p_subjects,true)');
    else
      needle:='if v_slot.id is not null then';
      if position(needle in def)=0 then raise exception 'ASSESSMENT_SAVE_ANCHOR_MISSING'; end if;
      def:=replace(def,needle,'if v_slot.rule_id is not null then raise exception ''RULE_MANAGED''; end if; '||needle);
    end if;
    execute def;
  end loop;
  def:=pg_get_functiondef('public.parent_assessment_overview(uuid)'::regprocedure);
  needle:='''teachers'',v_teachers,''requests'',v_requests';
  if position(needle in def)=0 then raise exception 'ASSESSMENT_OVERVIEW_ANCHOR_MISSING'; end if;
  execute replace(def,needle,needle||',''topics'',public.assessment_public_topics()');
  def:=pg_get_functiondef('public.assessment_slot_projection(public.assessment_slots)'::regprocedure);
  needle:='''blocked'',public.staff_calendar_campus_closed';
  if position(needle in def)=0 then raise exception 'ASSESSMENT_PROJECTION_ANCHOR_MISSING'; end if;
  execute replace(def,needle,'''ruleId'',p_slot.rule_id,''blocked'',public.assessment_slot_excluded(p_slot.teacher_id,p_slot.campus_id,p_slot.starts_at,p_slot.ends_at) or public.staff_calendar_campus_closed');
  def:=pg_get_functiondef('public.get_assessment_slot_management(date,date)'::regprocedure);
  needle:='''slots'',v_slots';
  if position(needle in def)=0 then raise exception 'ASSESSMENT_MANAGEMENT_ANCHOR_MISSING'; end if;
  execute replace(def,needle,needle||',''topics'',public.assessment_topic_projection()');
end $wire$;

revoke all on function public.assessment_topics_valid(text[],boolean),public.assessment_slot_excluded(uuid,uuid,timestamptz,timestamptz),
  public.assessment_topic_projection(),public.assessment_public_topics(),public.refresh_assessment_rule_slots(uuid,uuid),
  public.get_assessment_rules_workspace(),public.save_assessment_topic(text,text,text,boolean,timestamptz),
  public.save_assessment_rule(uuid,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.get_assessment_rules_workspace(),public.save_assessment_topic(text,text,text,boolean,timestamptz),
  public.save_assessment_rule(uuid,uuid,jsonb,timestamptz) to authenticated;
select pg_notify('pgrst','reload schema');
