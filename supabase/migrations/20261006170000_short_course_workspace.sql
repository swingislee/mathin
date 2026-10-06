begin;

-- Short courses share the formal classroom/session/roster records. These tables
-- only add the batch and teaching-group information used by the separate entry.
create table public.short_course_batches (
  id uuid primary key,
  topic text not null check (char_length(btrim(topic)) between 1 and 100),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  term_id uuid not null references public.school_terms(id),
  starts_on date not null,
  session_count smallint not null check (session_count between 1 and 40),
  duration_min smallint not null check (duration_min between 1 and 600),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  creation_input jsonb not null
);

create table public.short_course_class_details (
  classroom_id uuid primary key references public.classrooms(id) on delete cascade,
  batch_id uuid not null references public.short_course_batches(id),
  level text not null check (level in ('beginner','intermediate','advanced','mixed')),
  grades smallint[] not null default '{}',
  planned_students smallint check (planned_students between 0 and 500),
  weekly_slots jsonb not null check (jsonb_typeof(weekly_slots) = 'array'),
  sort_order smallint not null default 0
);
create index short_course_class_details_batch_idx on public.short_course_class_details(batch_id, sort_order);
create index classrooms_short_course_idx on public.classrooms(id) where offering_type = 'short_term_topic' and trashed_at is null;

alter table public.short_course_batches enable row level security;
alter table public.short_course_class_details enable row level security;
revoke all on public.short_course_batches, public.short_course_class_details from public, anon, authenticated;
grant select (id,topic,name,term_id,starts_on,session_count,duration_min,created_by,created_at) on public.short_course_batches to authenticated;
grant select on public.short_course_class_details to authenticated;

create policy short_course_class_details_read on public.short_course_class_details for select to authenticated
using ((public.is_staff((select auth.uid())) or public.is_admin((select auth.uid()))) and exists (
  select 1 from public.classrooms c where c.id = classroom_id
));
create policy short_course_batches_read on public.short_course_batches for select to authenticated
using ((public.is_staff((select auth.uid())) or public.is_admin((select auth.uid()))) and (
  created_by = (select auth.uid()) or exists (
    select 1 from public.short_course_class_details d where d.batch_id = id
  )
));

-- One transaction creates a batch, its classes and all lessons. The request UUID
-- also makes a lost response safe to retry, including a second concurrent submit.
create function public.create_short_course_batch(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  request_id uuid := (p_input->>'requestId')::uuid;
  existing public.short_course_batches;
  group_input jsonb;
  lesson_input jsonb;
  new_class uuid;
  class_ids uuid[] := '{}';
  group_order smallint := 0;
  total_lessons smallint := (p_input->>'sessionCount')::smallint;
  duration smallint := (p_input->>'durationMin')::smallint;
  term uuid := (p_input->>'termId')::uuid;
  grades_value smallint[];
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(actor, 'class.create') then raise exception 'FORBIDDEN'; end if;
  if request_id is null or term is null or total_lessons is null or total_lessons not between 1 and 40
    or duration is null or duration not between 1 and 600
    or coalesce(char_length(btrim(p_input->>'topic')),0) not between 1 and 100
    or coalesce(char_length(btrim(p_input->>'name')),0) not between 1 and 100
    or nullif(p_input->>'startsOn','') is null
    or jsonb_typeof(p_input->'classes') is distinct from 'array'
  then raise exception 'VALIDATION'; end if;
  if jsonb_array_length(p_input->'classes') not between 1 and 30 then raise exception 'VALIDATION'; end if;

  perform pg_advisory_xact_lock(hashtextextended('short-course:' || request_id::text, 0));
  select * into existing from public.short_course_batches b where b.id = request_id;
  if found then
    if existing.created_by <> actor then raise exception 'FORBIDDEN_SCOPE'; end if;
    if existing.creation_input is distinct from p_input then raise exception 'REQUEST_ALREADY_SAVED'; end if;
    return jsonb_build_object('batchId', request_id, 'classroomIds', (
      select coalesce(jsonb_agg(d.classroom_id order by d.sort_order),'[]'::jsonb)
      from public.short_course_class_details d where d.batch_id = request_id
    ));
  end if;

  insert into public.short_course_batches(id,topic,name,term_id,starts_on,session_count,duration_min,created_by,creation_input)
  values (request_id,btrim(p_input->>'topic'),btrim(p_input->>'name'),term,(p_input->>'startsOn')::date,total_lessons,duration,actor,p_input);

  for group_input in select value from jsonb_array_elements(p_input->'classes') loop
    if group_input->>'level' is null or group_input->>'level' not in ('beginner','intermediate','advanced','mixed')
      or (group_input->>'capacity') is null or (group_input->>'capacity')::integer not between 1 and 500
      or jsonb_typeof(group_input->'weeklySlots') is distinct from 'array'
      or jsonb_typeof(group_input->'sessions') is distinct from 'array'
      or jsonb_typeof(group_input->'grades') is distinct from 'array'
    then raise exception 'VALIDATION'; end if;
    if jsonb_array_length(group_input->'weeklySlots') not between 1 and 7
      or jsonb_array_length(group_input->'sessions') <> total_lessons
      or jsonb_array_length(group_input->'grades') > 12
    then raise exception 'INVALID_SCHEDULE'; end if;
    if exists (select 1 from jsonb_array_elements(group_input->'weeklySlots') s where
      not coalesce((s->>'weekday') ~ '^[0-6]$', false)
      or not coalesce((s->>'time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false))
      or (select count(*) from jsonb_array_elements(group_input->'weeklySlots')) <>
         (select count(distinct s->>'weekday') from jsonb_array_elements(group_input->'weeklySlots') s)
    then raise exception 'INVALID_SCHEDULE'; end if;
    select coalesce(array_agg(value::smallint order by value::smallint),'{}'::smallint[])
      into grades_value from jsonb_array_elements_text(group_input->'grades');
    if exists (select 1 from unnest(grades_value) g where g not between 1 and 12)
      or (group_input->>'plannedStudents')::integer < 0
      or (group_input->>'plannedStudents')::integer > (group_input->>'capacity')::integer
    then raise exception 'VALIDATION'; end if;
    if (select count(distinct s->>'scheduledAt') from jsonb_array_elements(group_input->'sessions') s) <> total_lessons
    then raise exception 'INVALID_SCHEDULE'; end if;
    select jsonb_agg(jsonb_build_object(
      'title', s->>'name', 'lecture_id', null,
      'scheduled_at', s->>'scheduledAt', 'duration_min', duration
    ) order by ordinal) into lesson_input
      from jsonb_array_elements(group_input->'sessions') with ordinality items(s,ordinal);

    new_class := public.create_free_class_with_sessions_v2(
      p_name => group_input->>'name', p_capacity => (group_input->>'capacity')::smallint,
      p_room_id => nullif(group_input->>'roomId','')::uuid,
      p_primary_teacher_id => (group_input->>'teacherId')::uuid,
      p_learning_support_id => null, p_term_id => term, p_purpose => 'production',
      p_sessions => lesson_input, p_activate => false, p_offering_type => 'short_term_topic'
    );
    -- A mixed-grade class keeps its complete grade set in the short-course metadata.
    update public.classrooms set grade = case when cardinality(grades_value)=1 then grades_value[1] else null end where id=new_class;
    insert into public.short_course_class_details(classroom_id,batch_id,level,grades,planned_students,weekly_slots,sort_order)
    values(new_class,request_id,group_input->>'level',grades_value,(group_input->>'plannedStudents')::smallint,group_input->'weeklySlots',group_order);
    class_ids := array_append(class_ids,new_class);
    group_order := group_order + 1;
  end loop;
  return jsonb_build_object('batchId',request_id,'classroomIds',to_jsonb(class_ids));
end $$;

create function public.list_short_courses(p_filters jsonb default '{}', p_page integer default 1)
returns jsonb language plpgsql security invoker stable set search_path=public,pg_temp as $$
declare result jsonb; actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (public.is_staff(actor) or public.is_admin(actor)) then raise exception 'FORBIDDEN'; end if;
  with visible as materialized (
    select c.id,c.name,c.capacity,c.operational_status,c.owner_id,
      d.batch_id,d.level,d.grades,d.planned_students,d.weekly_slots,d.sort_order,
      b.topic,b.name as batch_name,b.starts_on,b.session_count
    from public.classrooms c
    left join public.short_course_class_details d on d.classroom_id=c.id
    left join public.short_course_batches b on b.id=d.batch_id
    where c.offering_type='short_term_topic' and c.purpose='production'
      and c.trashed_at is null and c.archived_at is null
      and (public.has_perm(actor,'class.view.all') or c.owner_id=actor or exists (
        select 1 from public.classroom_staff_assignments a where a.classroom_id=c.id and a.user_id=actor
      ))
  ), filtered as materialized (
    select * from visible v where
      (coalesce(p_filters->>'batchId','')='' or v.batch_id::text=p_filters->>'batchId')
      and (coalesce(p_filters->>'status','')='' or v.operational_status=p_filters->>'status')
      and (coalesce(p_filters->>'q','')='' or position(lower(left(p_filters->>'q',80)) in lower(concat_ws(' ',v.name,v.topic,v.batch_name)))>0)
  ), paged as (
    select * from filtered order by starts_on desc nulls last,batch_id,sort_order nulls last,name,id
    limit 20 offset ((greatest(1,least(coalesce(p_page,1),100000))-1)*20)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'batches', coalesce((select jsonb_agg(jsonb_build_object('id',b.batch_id,'name',b.batch_name,'topic',b.topic) order by b.starts_on desc,b.batch_name)
      from (select distinct batch_id,batch_name,topic,starts_on from visible where batch_id is not null) b),'[]'::jsonb),
    'classes', coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'name',p.name,'capacity',p.capacity,'status',p.operational_status,
      'batchId',p.batch_id,'batchName',p.batch_name,'topic',p.topic,'level',p.level,
      'grades',coalesce(to_jsonb(p.grades),'[]'::jsonb),'plannedStudents',p.planned_students,
      'weeklySlots',coalesce(p.weekly_slots,'[]'::jsonb),'sessionCount',p.session_count,
      'teacherName',(select display_name from public.profiles where id=p.owner_id),
      'enrolledCount',(select count(*) from public.enrollments e where e.classroom_id=p.id and e.status='active'),
      'sessions',coalesce((select jsonb_agg(jsonb_build_object(
        'id',s.id,'name',s.title,'scheduledAt',s.scheduled_at,'startedAt',s.started_at,'endedAt',s.ended_at,
        'cancelled',s.deleted_at is not null,'voided',s.voided_at is not null
      ) order by s.scheduled_at nulls last,s.id) from public.class_sessions s where s.classroom_id=p.id),'[]'::jsonb)
    ) order by p.starts_on desc nulls last,p.batch_id,p.sort_order nulls last,p.name,p.id) from paged p),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create function public.get_short_course_metadata(p_classroom_id uuid)
returns jsonb language sql security invoker stable set search_path=public,pg_temp as $$
  select jsonb_build_object('batchId',b.id,'batchName',b.name,'topic',b.topic,
    'level',d.level,'grades',to_jsonb(d.grades),'plannedStudents',d.planned_students,
    'weeklySlots',d.weekly_slots,'sessionCount',b.session_count)
  from public.short_course_class_details d join public.short_course_batches b on b.id=d.batch_id
  where d.classroom_id=p_classroom_id;
$$;

create function public.get_short_course_batch_receipt(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.short_course_batches; normalized_classes jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(auth.uid(),'class.create') then raise exception 'FORBIDDEN'; end if;
  select * into existing from public.short_course_batches where id=(p_input->>'requestId')::uuid;
  if not found then return null; end if;
  if existing.created_by <> auth.uid() then raise exception 'FORBIDDEN_SCOPE'; end if;
  select jsonb_agg(item-'sessions' order by ordinal) into normalized_classes
    from jsonb_array_elements(existing.creation_input->'classes') with ordinality rows(item,ordinal);
  if existing.creation_input-'classes' is distinct from p_input-'classes'
    or normalized_classes is distinct from p_input->'classes'
  then raise exception 'REQUEST_ALREADY_SAVED'; end if;
  return jsonb_build_object('batchId',existing.id,'classroomIds',(
    select jsonb_agg(classroom_id order by sort_order) from public.short_course_class_details where batch_id=existing.id
  ));
end $$;

-- The existing directory keeps its paging/count contract and supports a typed
-- filter before pagination. Callers outside the long-course entry remain intact.
do $migration$
declare definition text:=replace(pg_get_functiondef('public.list_classrooms_for_scope(text,jsonb,integer)'::regprocedure),E'\r\n',E'\n');
        marker text:='where classroom_row.trashed_at is null';
begin
  if (length(definition)-length(replace(definition,marker,'')))/length(marker) <> 1 then
    raise exception 'SHORT_COURSE_CLASS_LIST_BASELINE_CHANGED';
  end if;
  execute replace(definition,marker,marker || E'\n      and (coalesce(p_filters->>''offeringType'','''') = '''' or classroom_row.offering_type = p_filters->>''offeringType'')');
end $migration$;

revoke all on function public.create_short_course_batch(jsonb),public.list_short_courses(jsonb,integer),public.get_short_course_metadata(uuid),public.get_short_course_batch_receipt(jsonb) from public,anon,authenticated;
grant execute on function public.create_short_course_batch(jsonb),public.list_short_courses(jsonb,integer),public.get_short_course_metadata(uuid),public.get_short_course_batch_receipt(jsonb) to authenticated;
select pg_notify('pgrst','reload schema');
commit;
