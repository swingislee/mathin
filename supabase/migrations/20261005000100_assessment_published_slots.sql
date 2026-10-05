-- 教师/教务主动发布可约测评时段；预约事实仍保存在既有邀约表。
create table public.assessment_slots (
  id uuid primary key,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  subjects text[] not null check (cardinality(subjects) between 1 and 2
    and array_ndims(subjects)=1 and array_position(subjects,null) is null and subjects <@ array['math','english']::text[]),
  grades integer[] not null default '{}' check (cardinality(grades)<=14
    and (cardinality(grades)=0 or array_ndims(grades)=1) and array_position(grades,null) is null
    and grades <@ array[-1,0,1,2,3,4,5,6,7,8,9,10,11,12]),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  enabled boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint assessment_slots_time_check check (isfinite(starts_at) and isfinite(ends_at)
    and starts_at=date_trunc('minute',starts_at) and ends_at=date_trunc('minute',ends_at)
    and ends_at-starts_at between interval '5 minutes' and interval '4 hours')
);
create index assessment_slots_teacher_time_idx on public.assessment_slots(teacher_id,starts_at,ends_at);
create index assessment_slots_published_idx on public.assessment_slots(starts_at,campus_id) where enabled;
comment on table public.assessment_slots is 'Explicitly published campus assessment availability. Disable instead of delete; bookings reuse lead_invitation_threads.';

alter table public.lead_invitation_threads
  add column assessment_slot_id uuid references public.assessment_slots(id) on delete restrict,
  drop constraint lead_invitation_threads_availability_shape_check,
  add constraint lead_invitation_threads_availability_shape_check check (
    (assessment_slot_id is not null and kind='assessment_1v1'
      and state in ('confirmed','completed','cancelled') and scheduled_at is not null
      and cardinality(parent_time_options)=0 and cardinality(assessor_time_options)=0)
    or (assessment_slot_id is null and (
      (kind='assessment_1v1' and (scheduled_at is null or (
        to_char(scheduled_at at time zone 'Asia/Shanghai','YYYY-MM-DD"@"HH24:MI')=any(parent_time_options)
        and to_char(scheduled_at at time zone 'Asia/Shanghai','YYYY-MM-DD"@"HH24:MI')=any(assessor_time_options))))
      or (kind<>'assessment_1v1' and cardinality(parent_time_options)=0 and cardinality(assessor_time_options)=0 and scheduled_at is null)
    ))
  ),
  drop constraint lead_invitation_threads_parent_request_check,
  add constraint lead_invitation_threads_parent_request_check check (
    (parent_request_actor is null and parent_request_payload is null and assessment_slot_id is null)
    or (parent_request_actor is not null and parent_request_payload is not null
      and jsonb_typeof(parent_request_payload)='object'
      and parent_request_payload ?& array['version','studentId','assessorId']
      and jsonb_typeof(parent_request_payload->'studentId')='string'
      and jsonb_typeof(parent_request_payload->'assessorId')='string'
      and ((parent_request_payload->>'version'='1' and assessment_slot_id is null
        and jsonb_typeof(parent_request_payload->'parentTimeOptions')='array')
        or (parent_request_payload->>'version'='2' and assessment_slot_id is not null
          and parent_request_payload ?& array['slotId','subjects','grade','mode','campus','endsAt']
          and parent_request_payload->>'slotId'=assessment_slot_id::text
          and parent_request_payload->>'mode'='campus'
          and jsonb_typeof(parent_request_payload->'subjects')='array'
          and jsonb_typeof(parent_request_payload->'grade')='number'
          and jsonb_typeof(parent_request_payload->'campus')='object'
          and jsonb_typeof(parent_request_payload->'endsAt')='string')))
  );
create unique index lead_invitation_threads_booked_slot_idx on public.lead_invitation_threads(assessment_slot_id)
  where assessment_slot_id is not null and state<>'cancelled';
comment on column public.lead_invitation_threads.assessment_slot_id is 'Published slot booked by a parent. Time, teacher and campus are immutable; cancellation releases availability and preserves history.';

create function public.assessment_slots_manage_all(p_user uuid) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select public.is_staff(p_user) and (public.has_perm(p_user,'followup.write') or public.has_perm(p_user,'schedule.manage'));
$$;
create function public.assessment_slots_can_manage(p_user uuid,p_teacher uuid) returns boolean
language sql security definer stable set search_path=public,pg_temp as $$
  select public.is_staff(p_user) and (public.assessment_slots_manage_all(p_user)
    or (p_user=p_teacher and public.has_perm(p_user,'review.write')));
$$;
alter table public.assessment_slots enable row level security;
revoke all on public.assessment_slots from public,anon,authenticated;
grant select on public.assessment_slots to authenticated;
create policy assessment_slots_staff_select on public.assessment_slots for select to authenticated
  using (public.assessment_slots_can_manage((select auth.uid()),teacher_id));

-- 与发布、预约、旧邀约修改共用教师锁，避免从不同入口重复占用一个教师。
create function public.guard_assessment_slot() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_teacher uuid;
begin
  for v_teacher in select distinct id from unnest(array[new.teacher_id,case when tg_op='UPDATE' then old.teacher_id end]) id where id is not null order by id loop
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_teacher::text,0));
  end loop;
  if tg_op='UPDATE' and exists(select 1 from public.lead_invitation_threads where assessment_slot_id=old.id)
    and (new.teacher_id,new.campus_id,new.subjects,new.grades,new.starts_at,new.ends_at)
      is distinct from (old.teacher_id,old.campus_id,old.subjects,old.grades,old.starts_at,old.ends_at)
    then raise exception 'SLOT_BOOKED'; end if;
  if new.enabled and exists(select 1 from public.assessment_slots s where s.id<>new.id and s.teacher_id=new.teacher_id
    and s.enabled and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)'))
    then raise exception 'TIME_UNAVAILABLE'; end if;
  new.updated_at:=clock_timestamp();
  return new;
end $$;
create trigger assessment_slots_guard before insert or update on public.assessment_slots for each row execute function public.guard_assessment_slot();

create function public.assessment_teacher_time_busy(p_teacher uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_except_invitation uuid default null)
returns boolean language sql security definer stable set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.lead_invitation_threads t left join public.assessment_slots s on s.id=t.assessment_slot_id
    where t.assessor_id=p_teacher and t.kind='assessment_1v1' and t.scheduled_at is not null
      and t.state in ('awaiting_parent','confirmed','completed') and t.id is distinct from p_except_invitation
      and tstzrange(t.scheduled_at,coalesce(s.ends_at,t.scheduled_at+interval '40 minutes'),'[)') && tstzrange(p_starts_at,p_ends_at,'[)')
  );
$$;

create function public.guard_assessment_slot_booking() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
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
      or new.parent_request_payload#>>'{campus,id}' is distinct from v_slot.campus_id::text
      then raise exception 'SLOT_BOOKING_IMMUTABLE'; end if;
    if tg_op='INSERT' and (not v_slot.enabled or v_slot.starts_at<=now()) then raise exception 'SLOT_UNAVAILABLE'; end if;
    v_end:=v_slot.ends_at;
  else
    v_end:=new.scheduled_at+interval '40 minutes';
  end if;
  if new.kind='assessment_1v1' and new.scheduled_at is not null and new.state in ('awaiting_parent','confirmed','completed') then
    if new.assessment_slot_id is not null then
      if public.assessment_teacher_time_busy(new.assessor_id,new.scheduled_at,v_end,new.id) then raise exception 'TIME_UNAVAILABLE'; end if;
    elsif exists(select 1 from public.lead_invitation_threads t join public.assessment_slots s on s.id=t.assessment_slot_id
      where t.id<>new.id and t.assessor_id=new.assessor_id and t.state<>'cancelled'
        and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(new.scheduled_at,v_end,'[)')) then
      raise exception 'TIME_UNAVAILABLE';
    end if;
  end if;
  return new;
end $$;
create trigger lead_invitation_slots_guard before insert or update of assessment_slot_id,assessor_id,scheduled_at,state,kind,lead_id,location_text
  on public.lead_invitation_threads for each row execute function public.guard_assessment_slot_booking();

create function public.assessment_slot_projection(p_slot public.assessment_slots) returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_slot.id,'teacherId',p_slot.teacher_id,'campusId',p_slot.campus_id,
    'subjects',p_slot.subjects,'grades',p_slot.grades,'startsAt',p_slot.starts_at,'endsAt',p_slot.ends_at,
    'enabled',p_slot.enabled,'booked',exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot.id),
    'updatedAt',p_slot.updated_at);
$$;

create function public.get_assessment_slot_management(p_from date,p_to date) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_all boolean; v_teachers jsonb; v_campuses jsonb; v_slots jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(v_uid,v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from or p_to-p_from>92 then raise exception 'VALIDATION'; end if;
  v_all:=public.assessment_slots_manage_all(v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'displayName',p.display_name) order by p.display_name,p.id),'[]') into v_teachers
    from public.profiles p where public.is_staff(p.id) and public.has_perm(p.id,'review.write') and (v_all or p.id=v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name,c.id),'[]') into v_campuses from public.campuses c where c.status='active';
  select coalesce(jsonb_agg(public.assessment_slot_projection(s) order by s.starts_at,s.teacher_id,s.id),'[]') into v_slots
    from public.assessment_slots s where (v_all or s.teacher_id=v_uid)
      and s.starts_at>=p_from::timestamp at time zone 'Asia/Shanghai' and s.starts_at<(p_to+1)::timestamp at time zone 'Asia/Shanghai';
  return jsonb_build_object('currentUserId',v_uid,'canManageAll',v_all,'teachers',v_teachers,'campuses',v_campuses,'slots',v_slots);
end $$;

create function public.save_assessment_slot(p_slot_id uuid,p_teacher_id uuid,p_campus_id uuid,p_subjects text[],p_grades integer[],
  p_starts_at timestamptz,p_ends_at timestamptz,p_enabled boolean,p_expected_updated_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_slot public.assessment_slots%rowtype; v_old_teacher uuid; v_teacher uuid; v_subjects text[]; v_grades integer[];
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.assessment_slots_can_manage(v_uid,p_teacher_id) then raise exception 'FORBIDDEN'; end if;
  if p_slot_id is null or p_teacher_id is null or p_campus_id is null or p_subjects is null or p_grades is null or p_enabled is null
    or cardinality(p_subjects) not between 1 and 2 or array_ndims(p_subjects)<>1 or array_position(p_subjects,null) is not null
    or not p_subjects<@array['math','english']::text[] or cardinality(p_grades)>14
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
  if v_slot.id is not null then
    if v_slot.teacher_id is distinct from v_old_teacher then raise exception 'CONFLICT'; end if;
    if (p_expected_updated_at is null and v_slot.created_by=v_uid or p_expected_updated_at=v_slot.updated_at)
      and (v_slot.teacher_id,v_slot.campus_id,v_slot.subjects,v_slot.grades,v_slot.starts_at,v_slot.ends_at,v_slot.enabled)
        is not distinct from (p_teacher_id,p_campus_id,v_subjects,v_grades,p_starts_at,p_ends_at,p_enabled)
      then return public.assessment_slot_projection(v_slot); end if;
    if p_expected_updated_at is null or p_expected_updated_at is distinct from v_slot.updated_at then raise exception 'CONFLICT'; end if;
    if exists(select 1 from public.lead_invitation_threads where assessment_slot_id=v_slot.id)
      and (v_slot.teacher_id,v_slot.campus_id,v_slot.subjects,v_slot.grades,v_slot.starts_at,v_slot.ends_at)
        is distinct from (p_teacher_id,p_campus_id,v_subjects,v_grades,p_starts_at,p_ends_at) then raise exception 'SLOT_BOOKED'; end if;
  elsif p_expected_updated_at is not null then raise exception 'NOT_FOUND'; end if;
  if not public.is_staff(p_teacher_id) or not public.has_perm(p_teacher_id,'review.write') then raise exception 'NO_ELIGIBLE_TEACHER'; end if;
  if not exists(select 1 from public.campuses where id=p_campus_id and status='active') then raise exception 'CAMPUS_UNAVAILABLE'; end if;
  if (v_slot.id is null or p_enabled or (v_slot.starts_at,v_slot.ends_at) is distinct from (p_starts_at,p_ends_at))
    and p_starts_at<=now() then raise exception 'TIME_UNAVAILABLE'; end if;
  if p_enabled and public.assessment_teacher_time_busy(p_teacher_id,p_starts_at,p_ends_at,
    (select id from public.lead_invitation_threads where assessment_slot_id=p_slot_id and state<>'cancelled' limit 1)) then raise exception 'TIME_UNAVAILABLE'; end if;
  if v_slot.id is null then
    insert into public.assessment_slots(id,teacher_id,campus_id,subjects,grades,starts_at,ends_at,enabled,created_by,updated_by)
      values(p_slot_id,p_teacher_id,p_campus_id,v_subjects,v_grades,p_starts_at,p_ends_at,p_enabled,v_uid,v_uid) returning * into v_slot;
  else
    update public.assessment_slots set teacher_id=p_teacher_id,campus_id=p_campus_id,subjects=v_subjects,grades=v_grades,
      starts_at=p_starts_at,ends_at=p_ends_at,enabled=p_enabled,updated_by=v_uid where id=p_slot_id returning * into v_slot;
  end if;
  return public.assessment_slot_projection(v_slot);
end $$;

create function public.parent_assessment_availability(p_student_id uuid,p_subjects text[],p_grade integer) returns jsonb
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_from date:=(now() at time zone 'Asia/Shanghai')::date; v_slots jsonb; v_teachers jsonb; v_campuses jsonb;
begin
  if not public.miniapp_can_participate(p_student_id,'grades')
    or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'FORBIDDEN'; end if;
  if p_subjects is null or cardinality(p_subjects) not between 1 and 2 or array_ndims(p_subjects)<>1
    or array_position(p_subjects,null) is not null or not p_subjects<@array['math','english']::text[]
    or cardinality(p_subjects)<>(select count(distinct x) from unnest(p_subjects) x)
    or p_grade is null or p_grade not between -1 and 12 then raise exception 'VALIDATION'; end if;
  with matched as materialized (
    select s.*,p.display_name,c.name from public.assessment_slots s join public.profiles p on p.id=s.teacher_id join public.campuses c on c.id=s.campus_id
    where s.enabled and s.starts_at>now() and s.starts_at<(v_from+14)::timestamp at time zone 'Asia/Shanghai'
      and p_subjects<@s.subjects and (cardinality(s.grades)=0 or p_grade=any(s.grades))
      and public.is_staff(p.id) and public.has_perm(p.id,'review.write') and c.status='active'
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'teacherId',s.teacher_id,'campusId',s.campus_id,'startsAt',s.starts_at,'endsAt',s.ends_at,
      'available',not public.assessment_teacher_time_busy(s.teacher_id,s.starts_at,s.ends_at)) order by s.starts_at,s.id),'[]') from matched s),
    (select coalesce(jsonb_agg(jsonb_build_object('id',t.teacher_id,'displayName',t.display_name) order by t.display_name,t.teacher_id),'[]') from (select distinct teacher_id,display_name from matched) t),
    (select coalesce(jsonb_agg(jsonb_build_object('id',c.campus_id,'name',c.name) order by c.name,c.campus_id),'[]') from (select distinct campus_id,name from matched) c)
    into v_slots,v_teachers,v_campuses;
  return jsonb_build_object('participantId',p_student_id,'timeZone','Asia/Shanghai','from',v_from,'to',v_from+13,
    'teachers',v_teachers,'campuses',v_campuses,'slots',v_slots);
end $$;

create or replace function public.parent_assessment_request_projection(p_invitation_id uuid,p_student_id uuid) returns jsonb
language sql security definer stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',t.id,'participantId',l.student_id,
    'teacher',case when p.id is null then null else jsonb_build_object('id',p.id,'displayName',p.display_name) end,
    'state',t.state,'parentTimeOptions',to_jsonb(t.parent_time_options),'teacherTimeOptions',to_jsonb(t.assessor_time_options),
    'sharedTimeOptions',to_jsonb(shared.options),'proposedStartsAt',case when t.state='awaiting_parent' then t.scheduled_at else null end,
    'scheduledAt',case when t.state in ('confirmed','completed') then t.scheduled_at else null end,'updatedAt',t.updated_at,
    'canConfirm',coalesce(t.assessment_slot_id is null and t.state='awaiting_parent' and l.status<>'invalid'
      and p.role in ('staff','admin') and p.is_active and p.account_status='active' and public.has_perm(p.id,'review.write') and cardinality(shared.options)>0,false),
    'booking',case when t.assessment_slot_id is null then null else jsonb_build_object(
      'slotId',t.assessment_slot_id,'subjects',t.parent_request_payload->'subjects','grade',t.parent_request_payload->'grade',
      'mode','campus','campus',t.parent_request_payload->'campus','endsAt',t.parent_request_payload->'endsAt') end)
  from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id left join public.profiles p on p.id=t.assessor_id
  cross join lateral (select array(select distinct option_value from unnest(t.parent_time_options) option_value
    where option_value=any(t.assessor_time_options) and public.parent_assessment_time_at(option_value)>now() order by option_value) options) shared
  where t.id=p_invitation_id and l.student_id=p_student_id and t.kind='assessment_1v1';
$$;

-- 公开排班也是新家长请求的教师来源，早期请求入口仍自行检查任课教师关系。
create or replace function public.parent_assessment_request_blocker(p_student_id uuid) returns text
language plpgsql security definer stable set search_path=public,pg_temp as $$
declare v_count bigint; v_status text;
begin
  select count(*),min(l.status) into v_count,v_status from public.leads l where l.student_id=p_student_id;
  if v_count=0 then return 'NO_LINKED_LEAD'; end if;
  if v_count>1 then return 'AMBIGUOUS_LINKED_LEAD'; end if;
  if v_status='invalid' then return 'LEAD_UNAVAILABLE'; end if;
  if exists(select 1 from public.lead_invitation_threads t join public.leads l on l.id=t.lead_id
    where l.student_id=p_student_id and t.state not in ('completed','cancelled')) then return 'ACTIVE_INVITATION'; end if;
  if not exists(select 1 from public.parent_assessment_eligible_teachers(p_student_id)) and not exists(
    select 1 from public.assessment_slots s join public.campuses c on c.id=s.campus_id
      where s.enabled and s.starts_at>now() and s.starts_at<(((now() at time zone 'Asia/Shanghai')::date+14)::timestamp at time zone 'Asia/Shanghai')
        and public.is_staff(s.teacher_id) and public.has_perm(s.teacher_id,'review.write') and c.status='active'
  ) then return 'NO_ELIGIBLE_TEACHER'; end if;
  return null;
end $$;

create function public.book_parent_assessment_slot(p_request_id uuid,p_student_id uuid,p_slot_id uuid,p_subjects text[],p_grade integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_subjects text[]; v_invitation public.lead_invitation_threads%rowtype;
  v_slot public.assessment_slots%rowtype; v_lead public.leads%rowtype; v_teacher uuid; v_payload jsonb; v_campus_name text; v_count bigint;
begin
  if not public.miniapp_can_participate(p_student_id,'grades')
    or not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'FORBIDDEN'; end if;
  if p_request_id is null or p_slot_id is null or p_subjects is null or cardinality(p_subjects) not between 1 and 2 or array_ndims(p_subjects)<>1
    or array_position(p_subjects,null) is not null or not p_subjects<@array['math','english']::text[]
    or p_grade is null or p_grade not between -1 and 12 then raise exception 'VALIDATION'; end if;
  v_subjects:=array(select distinct unnest(p_subjects) order by 1);
  if cardinality(v_subjects)<>cardinality(p_subjects) then raise exception 'VALIDATION'; end if;
  perform pg_advisory_xact_lock(hashtextextended('parent-assessment-request:'||p_request_id::text,0));
  select * into v_invitation from public.lead_invitation_threads where id=p_request_id for update;
  if found then
    if v_invitation.parent_request_actor is distinct from v_uid or v_invitation.assessment_slot_id is distinct from p_slot_id
      or v_invitation.parent_request_payload->>'studentId' is distinct from p_student_id::text
      or v_invitation.parent_request_payload->'subjects' is distinct from to_jsonb(v_subjects)
      or v_invitation.parent_request_payload->'grade' is distinct from to_jsonb(p_grade) then raise exception 'CONFLICT'; end if;
    if v_invitation.kind<>'assessment_1v1' or not exists(select 1 from public.leads where id=v_invitation.lead_id and student_id=p_student_id) then raise exception 'CONFLICT'; end if;
    return public.parent_assessment_request_projection(v_invitation.id,p_student_id);
  end if;
  perform 1 from public.students where id=p_student_id for update;
  select * into v_lead from public.leads where student_id=p_student_id order by id limit 1 for update;
  if not public.miniapp_can_participate(p_student_id,'grades')
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
  if v_slot.teacher_id is distinct from v_teacher or not v_slot.enabled or v_slot.starts_at<=now()
    or v_slot.starts_at>=(((now() at time zone 'Asia/Shanghai')::date+14)::timestamp at time zone 'Asia/Shanghai')
    or not v_subjects<@v_slot.subjects or (cardinality(v_slot.grades)>0 and not p_grade=any(v_slot.grades)) then raise exception 'SLOT_UNAVAILABLE'; end if;
  if not public.is_staff(v_teacher) or not public.has_perm(v_teacher,'review.write') then raise exception 'NO_ELIGIBLE_TEACHER'; end if;
  select name into v_campus_name from public.campuses where id=v_slot.campus_id and status='active';
  if not found then raise exception 'CAMPUS_UNAVAILABLE'; end if;
  if exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot_id and state<>'cancelled') then raise exception 'SLOT_UNAVAILABLE'; end if;
  if public.assessment_teacher_time_busy(v_teacher,v_slot.starts_at,v_slot.ends_at) then raise exception 'TIME_UNAVAILABLE'; end if;
  v_payload:=jsonb_build_object('version',2,'studentId',p_student_id,'assessorId',v_teacher,'slotId',p_slot_id,
    'subjects',v_subjects,'grade',p_grade,'mode','campus','campus',jsonb_build_object('id',v_slot.campus_id,'name',v_campus_name),'endsAt',v_slot.ends_at);
  begin
    insert into public.lead_invitation_threads(id,lead_id,kind,state,assessor_id,scheduled_at,location_text,
      owner_id_at_open,created_by,updated_by,parent_request_actor,parent_request_payload,assessment_slot_id)
    values(p_request_id,v_lead.id,'assessment_1v1','confirmed',v_teacher,v_slot.starts_at,'线下到校区测试 · '||v_campus_name,
      v_lead.owner_id,v_uid,v_uid,v_uid,v_payload,p_slot_id);
  exception when unique_violation then
    if exists(select 1 from public.lead_invitation_threads where assessment_slot_id=p_slot_id and state<>'cancelled') then raise exception 'SLOT_UNAVAILABLE'; end if;
    raise exception 'ACTIVE_INVITATION';
  end;
  insert into public.lead_invitation_events(invitation_id,from_state,to_state,channel,note,recorded_by)
    values(p_request_id,null,'confirmed','other','家长预约已发布的线下测评时段',v_uid);
  perform public.emit_domain_event('parent.assessment.confirmed','lead_invitation',p_request_id,
    jsonb_build_object('studentId',p_student_id,'slotId',p_slot_id,'scheduledAt',v_slot.starts_at),v_teacher,null);
  return public.parent_assessment_request_projection(p_request_id,p_student_id);
end $$;

-- 既有邀约入口继续负责完成/取消。已发布时段只能结束，改期须取消后重新预约。
create or replace function public.update_lead_invitation_v3(p_invitation_id uuid,p_kind text,p_state text,p_activity_id uuid,p_assessor_id uuid,
  p_parent_time_options text[],p_assessor_time_options text[],p_scheduled_at timestamptz,p_location_text text,p_channel text,p_note text,p_next_contact_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb; v_lead_id uuid; v_invitation public.lead_invitation_threads%rowtype; v_uid uuid:=auth.uid();
begin
  select * into v_invitation from public.lead_invitation_threads where id=p_invitation_id;
  if v_invitation.id is null then raise exception 'NOT_FOUND'; end if;
  if v_invitation.assessment_slot_id is not null then
    if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
    if not public.has_perm(v_uid,'followup.write') or not public.can_edit_school_lead(v_invitation.lead_id,v_uid) then raise exception 'FORBIDDEN'; end if;
    if p_kind is distinct from 'assessment_1v1' or p_state is null or p_state not in ('completed','cancelled')
      or p_activity_id is not null or p_assessor_id is distinct from v_invitation.assessor_id
      or p_scheduled_at is distinct from v_invitation.scheduled_at or p_location_text is distinct from v_invitation.location_text
      or cardinality(coalesce(p_parent_time_options,'{}'))<>0 or cardinality(coalesce(p_assessor_time_options,'{}'))<>0
      or p_next_contact_at is not null or p_channel is null or p_channel not in ('phone','wechat','in_person','other')
      or length(coalesce(p_note,''))>2000 then raise exception 'SLOT_BOOKING_IMMUTABLE'; end if;
    perform pg_advisory_xact_lock(hashtextextended('assessment-teacher:'||v_invitation.assessor_id::text,0));
    select * into v_invitation from public.lead_invitation_threads where id=p_invitation_id for update;
    if v_invitation.state=p_state then return jsonb_build_object('invitationId',v_invitation.id,'kind',v_invitation.kind,'state',v_invitation.state,'nextContactAt',null); end if;
    if v_invitation.state in ('completed','cancelled') then raise exception 'INVITATION_CLOSED'; end if;
    update public.lead_invitation_threads set state=p_state,closed_by=v_uid,closed_at=now(),updated_by=v_uid,
      summary=case when btrim(coalesce(p_note,''))<>'' then btrim(p_note) else summary end where id=p_invitation_id;
    insert into public.lead_invitation_events(invitation_id,from_state,to_state,channel,note,recorded_by)
      values(p_invitation_id,v_invitation.state,p_state,p_channel,btrim(coalesce(p_note,'')),v_uid);
    perform public.emit_domain_event('lead.invitation.updated','lead_invitation',p_invitation_id,
      jsonb_build_object('leadId',v_invitation.lead_id,'kind',p_kind,'state',p_state),v_uid,null);
    return jsonb_build_object('invitationId',p_invitation_id,'kind',p_kind,'state',p_state,'nextContactAt',null);
  end if;
  if p_next_contact_at is not null and p_state not in ('coordinating_time','awaiting_teacher','awaiting_parent','waiting_activity') then raise exception 'REMINDER_NOT_ALLOWED'; end if;
  if p_next_contact_at is not null and p_next_contact_at<=now() then raise exception 'REMINDER_NOT_FUTURE'; end if;
  v_lead_id:=v_invitation.lead_id;
  v_result:=public.update_lead_invitation_v2(p_invitation_id,p_kind,p_state,p_activity_id,p_assessor_id,
    p_parent_time_options,p_assessor_time_options,p_scheduled_at,p_location_text,p_channel,p_note);
  perform public.set_lead_contact_reminder(v_lead_id,p_next_contact_at);
  return v_result||jsonb_build_object('nextContactAt',p_next_contact_at);
end $$;

revoke all on function public.assessment_slots_manage_all(uuid),public.assessment_slots_can_manage(uuid,uuid),public.guard_assessment_slot(),
  public.assessment_teacher_time_busy(uuid,timestamptz,timestamptz,uuid),public.guard_assessment_slot_booking(),
  public.assessment_slot_projection(public.assessment_slots),public.get_assessment_slot_management(date,date),
  public.save_assessment_slot(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,timestamptz),
  public.parent_assessment_availability(uuid,text[],integer),public.book_parent_assessment_slot(uuid,uuid,uuid,text[],integer)
  from public,anon,authenticated;
grant execute on function public.assessment_slots_can_manage(uuid,uuid),public.get_assessment_slot_management(date,date),
  public.save_assessment_slot(uuid,uuid,uuid,text[],integer[],timestamptz,timestamptz,boolean,timestamptz),
  public.parent_assessment_availability(uuid,text[],integer),public.book_parent_assessment_slot(uuid,uuid,uuid,text[],integer) to authenticated;
select pg_notify('pgrst','reload schema');
