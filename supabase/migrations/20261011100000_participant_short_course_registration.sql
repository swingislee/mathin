begin;

-- Explicit opt-in for community short courses. Classes, lessons and applications
-- retain their native class identities; no duplicate activity is created.
create table public.miniapp_short_course_publications (
  classroom_id uuid primary key references public.classrooms(id),
  location text not null default '' check (char_length(location) <= 100),
  tags text[] not null default array['短期课'] check (
    cardinality(tags) <= 10 and array_position(tags,null) is null
    and char_length(array_to_string(tags,'')) <= 400
  ),
  created_at timestamptz not null default now()
);
alter table public.miniapp_short_course_publications enable row level security;
revoke all on public.miniapp_short_course_publications from public,anon,authenticated;

-- Kindergarten uses the same -1 / 0 stage identities as Mini Program discovery.
alter table public.activities drop constraint activities_target_grades_check;
alter table public.activities add constraint activities_target_grades_check check (
  target_grades is null or (cardinality(target_grades) <= 14
    and coalesce(array_ndims(target_grades),1)=1 and array_position(target_grades,null) is null
    and target_grades <@ array[-1,0,1,2,3,4,5,6,7,8,9,10,11,12]::smallint[])
);
comment on column public.activities.target_grades is '适用阶段：NULL=待核对，空数组=不限，-1=幼中班，0=幼大班，1至12=相应年级。';
create or replace function public.set_activity_target_grades(p_activity_id uuid,p_target_grades smallint[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.require_current_business_record('activities',p_activity_id);
  if auth.uid() is null or not public.has_perm(auth.uid(),'activity.manage') then raise exception 'FORBIDDEN'; end if;
  if p_target_grades is not null and (cardinality(p_target_grades)>14 or coalesce(array_ndims(p_target_grades),1)<>1
    or array_position(p_target_grades,null) is not null
    or not (p_target_grades <@ array[-1,0,1,2,3,4,5,6,7,8,9,10,11,12]::smallint[])) then raise exception 'INVALID_INPUT'; end if;
  update public.activities set target_grades=case when p_target_grades is null then null
    else array(select distinct grade from unnest(p_target_grades) grade order by grade) end
    where id=p_activity_id and deleted_at is null and source_invitation_id is null;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- Preserve the shipped activity DTO so existing Mini Program versions can use
-- these explicitly published short courses without a client release.
create function public.miniapp_participant_activity_catalog() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  with offers as materialized (select x from jsonb_array_elements(public.miniapp_registration_catalog()) x),
  participant_offers as (
    select x item from offers where x->>'kind'='activity'
    union all
    select jsonb_build_object('id',c.id,'kind','activity','title',o.x->>'title','description',o.x->>'description',
      'priceCents',null,'bookingClosesAt',o.x->>'bookingClosesAt','revision',o.x->'revision','classes','[]'::jsonb,
      'activity',jsonb_build_object('id',c.id,'tags',p.tags,'targetGrades',coalesce(to_jsonb(d.grades),
          case when c.grade is null then null else jsonb_build_array(c.grade) end),
        'location',p.location,'startsAt',first_lesson.scheduled_at,'durationMinutes',first_lesson.duration_min,
        'remaining',o.x#>'{classes,0,remaining}'))
    from offers o join public.classrooms c on c.id=(o.x->>'id')::uuid and o.x->>'kind'='class'
    join public.miniapp_short_course_publications p on p.classroom_id=c.id
    left join public.short_course_class_details d on d.classroom_id=c.id
    cross join lateral (select s.scheduled_at,s.duration_min from public.class_sessions s
      where s.classroom_id=c.id and s.deleted_at is null and s.cancelled_by is null and s.voided_at is null
      order by s.scheduled_at limit 1) first_lesson
    where c.offering_type='short_term_topic' and first_lesson.scheduled_at>now()
  ) select coalesce(jsonb_agg(item order by item#>>'{activity,startsAt}',item->>'id'),'[]'::jsonb) from participant_offers;
$$;

create function public.miniapp_participant_apply_registration(p_id uuid,p_target_id uuid,p_revision integer,p_student_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare target_kind text; offer jsonb; native_offer jsonb; existing public.parent_registration_applications;
begin
  if not public.miniapp_can_register(p_student_id,'activity') then raise exception 'FORBIDDEN'; end if;
  if p_id is null or p_target_id is null or p_revision is null or p_revision<1 then raise exception 'VALIDATION'; end if;
  target_kind:=case when exists(select 1 from miniapp_short_course_publications p join classrooms c on c.id=p.classroom_id
    where c.id=p_target_id and c.offering_type='short_term_topic') then 'class' else 'activity' end;
  if exists(select 1 from parent_course_applications where id=p_id) then raise exception 'CONFLICT'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text,6843));
  select * into existing from parent_registration_applications where id=p_id;
  if found then
    if existing.applicant_id<>auth.uid() or existing.student_id<>p_student_id or existing.kind<>target_kind
      or coalesce(existing.classroom_id,existing.activity_id) is distinct from p_target_id
      or (existing.snapshot->>'revision')::integer is distinct from p_revision then raise exception 'CONFLICT'; end if;
    return existing.id;
  end if;
  if target_kind='class' then perform 1 from classrooms where id=p_target_id for share;
  else perform 1 from activities where id=p_target_id for share; end if;
  select x into offer from jsonb_array_elements(public.miniapp_participant_activity_catalog()) x where x->>'id'=p_target_id::text;
  if offer is null then raise exception 'BOOKING_CLOSED'; end if;
  if (offer->>'revision')::integer is distinct from p_revision then raise exception 'FORM_CHANGED'; end if;
  if exists(select 1 from parent_registration_applications where student_id=p_student_id and kind=target_kind
    and coalesce(classroom_id,activity_id)=p_target_id and status='pending') then raise exception 'CONFLICT'; end if;
  select x into native_offer from jsonb_array_elements(public.miniapp_registration_catalog()) x
    where x->>'kind'=target_kind and x->>'id'=p_target_id::text;
  if native_offer is null then raise exception 'BOOKING_CLOSED'; end if;
  if target_kind='class' then native_offer:=native_offer||jsonb_build_object('miniappShortCourse',true); end if;
  insert into parent_registration_applications(id,kind,classroom_id,activity_id,applicant_id,student_id,snapshot)
    values(p_id,target_kind,case when target_kind='class' then p_target_id end,
      case when target_kind='activity' then p_target_id end,auth.uid(),p_student_id,native_offer);
  return p_id;
end $$;

create function public.miniapp_participant_registration_applications() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.miniapp_family_ready() then raise exception 'FORBIDDEN'; end if;
  return (select coalesce(jsonb_agg(mathin_internal.parent_registration_application_json(a,s.name)
    ||jsonb_build_object('kind','activity','activityId',coalesce(a.activity_id,a.classroom_id)) order by a.created_at desc),'[]'::jsonb)
    from parent_registration_applications a join students s on s.id=a.student_id
    where a.applicant_id=auth.uid() and public.miniapp_can_register(a.student_id,'activity')
      and (a.kind='activity' or (a.kind='class' and a.snapshot->>'miniappShortCourse'='true')));
end $$;

create function public.miniapp_participant_cancel_registration(p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare existing public.parent_registration_applications;
begin
  select * into existing from parent_registration_applications where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if existing.applicant_id is distinct from auth.uid() or not public.miniapp_can_register(existing.student_id,'activity')
    or not (existing.kind='activity' or (existing.kind='class' and coalesce(existing.snapshot->>'miniappShortCourse','false')='true'))
    then raise exception 'FORBIDDEN'; end if;
  if existing.status='cancelled' then return; end if;
  if existing.status<>'pending' then raise exception 'CONFLICT'; end if;
  update parent_registration_applications set status='cancelled',resolved_at=now(),resolved_by=auth.uid() where id=p_id;
end $$;

revoke all on function public.miniapp_participant_activity_catalog(),public.miniapp_participant_apply_registration(uuid,uuid,integer,uuid),
  public.miniapp_participant_registration_applications(),public.miniapp_participant_cancel_registration(uuid) from public,anon,authenticated;
grant execute on function public.miniapp_participant_activity_catalog() to anon,authenticated;
grant execute on function public.miniapp_participant_apply_registration(uuid,uuid,integer,uuid),
  public.miniapp_participant_registration_applications(),public.miniapp_participant_cancel_registration(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
