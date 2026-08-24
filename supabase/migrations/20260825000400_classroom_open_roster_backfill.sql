-- M4a rollout bridge: sessions already in progress when the roster migration
-- lands never call startClassSession again. Freeze only those open sessions as
-- legacy v1; ended history remains untouched until an explicit reopen.

begin;

create temp table m4a_open_roster_backfill on commit drop as
select
  session_row.id as session_id,
  public.session_roster_source_hash(session_row.id) as source_hash,
  actor.user_id as created_by,
  now() as frozen_at
from public.class_sessions session_row
join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
cross join lateral (
  select candidate.user_id
  from (
    select 0 as priority, session_row.teacher_override as user_id
    union all
    select 1, member_row.user_id
      from public.classroom_members member_row
     where member_row.classroom_id = session_row.classroom_id
       and member_row.role = 'teacher'
    union all
    select 2, classroom_row.owner_id
  ) candidate
  join public.profiles profile_row
    on profile_row.id = candidate.user_id
   and profile_row.is_active
  order by candidate.priority, candidate.user_id
  limit 1
) actor
where session_row.deleted_at is null
  and session_row.started_at is not null
  and session_row.ended_at is null
  and session_row.roster_revision = 0;

do $$
begin
  if (
    select count(*)
      from public.class_sessions session_row
     where session_row.deleted_at is null
       and session_row.started_at is not null
       and session_row.ended_at is null
       and session_row.roster_revision = 0
  ) <> (select count(*) from m4a_open_roster_backfill) then
    raise exception 'OPEN_ROSTER_TEACHER_MISSING';
  end if;

  if exists (
    select 1
      from m4a_open_roster_backfill backfill_row
      cross join lateral public.current_session_roster_source(backfill_row.session_id) source_row
     group by backfill_row.session_id
    having count(*) > 60
  ) then
    raise exception 'ROSTER_CAPACITY_EXCEEDED';
  end if;
end;
$$;

insert into public.session_roster_revisions(
  session_id, revision, source_hash, reason, created_by, created_at
)
select session_id, 1, source_hash, 'start', created_by, frozen_at
from m4a_open_roster_backfill;

insert into public.session_roster_entries(
  session_id, revision, student_id, name, seat_position, user_id, roster_order
)
select
  backfill_row.session_id,
  1,
  source_row.student_id,
  source_row.name,
  source_row.seat_position,
  source_row.user_id,
  source_row.roster_order::smallint
from m4a_open_roster_backfill backfill_row
cross join lateral public.current_session_roster_source(backfill_row.session_id) source_row;

update public.class_sessions session_row
set roster_revision = 1,
    roster_source_hash = backfill_row.source_hash,
    roster_frozen_at = backfill_row.frozen_at,
    star_event_schema = 1
from m4a_open_roster_backfill backfill_row
where session_row.id = backfill_row.session_id;

comment on column public.class_sessions.roster_frozen_at is
  'Initial roster freeze time; rollout backfills only sessions that were already open.';

commit;
