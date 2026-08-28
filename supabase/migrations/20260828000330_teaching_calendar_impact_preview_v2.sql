-- DEV-ORG-1: read-only impact preview for teaching-calendar changes.

begin;

create or replace function public.preview_teaching_calendar_impact_v2(
  p_campus_id uuid,
  p_starts_on date,
  p_ends_on date
) returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); timezone_value text;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
     or p_ends_on > p_starts_on + 730 then raise exception 'VALIDATION'; end if;
  if p_campus_id is not null and not exists (
    select 1 from public.campuses where id = p_campus_id and status = 'active'
  ) then raise exception 'INVALID_CAMPUS'; end if;
  select timezone into timezone_value from public.organizations where singleton_key = 1;

  return (
    with scoped_sessions as (
      select session_row.id, session_row.classroom_id, session_row.room_id,
             session_row.scheduled_at, session_row.started_at, session_row.ended_at,
             session_row.cancelled_by, session_row.voided_at, session_row.deleted_at
        from public.class_sessions session_row
        left join public.campus_rooms room_row on room_row.id = session_row.room_id
       where session_row.scheduled_at is not null
         and (session_row.scheduled_at at time zone timezone_value)::date
             between p_starts_on and p_ends_on
         and (p_campus_id is null or room_row.campus_id = p_campus_id)
    ), future_sessions as (
      select * from scoped_sessions
       where scheduled_at >= now()
         and deleted_at is null and cancelled_by is null and voided_at is null
         and started_at is null and ended_at is null
    )
    select jsonb_build_object(
      'futureSessionCount', (select count(*) from future_sessions),
      'futureClassroomCount', (select count(distinct classroom_id) from future_sessions),
      'locationPendingCount', (select count(*) from future_sessions where room_id is null),
      'historicalSessionCount', (select count(*) from scoped_sessions)
        - (select count(*) from future_sessions)
    )
  );
end
$$;

revoke all on function public.preview_teaching_calendar_impact_v2(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.preview_teaching_calendar_impact_v2(uuid, date, date)
  to authenticated;

comment on function public.preview_teaching_calendar_impact_v2(uuid, date, date) is
  'Counts existing sessions in a proposed calendar scope/range without mutating them; campus scope is derived only from room membership';

select pg_notify('pgrst', 'reload schema');

commit;
