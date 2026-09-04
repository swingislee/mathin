begin;

-- Session-scoped read authority. It mirrors class visibility for admin/class teachers and adds only
-- the exact active teacher_override lesson; attendance.mark is deliberately not required for read-only use.
create or replace function public.can_view_session_attendance_v2(
  p_session_id uuid
) returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.class_sessions session_row
     where session_row.id = p_session_id
       and session_row.deleted_at is null
       and (
         public.is_admin((select auth.uid()))
         or (
           public.is_staff((select auth.uid()))
           and (
             public.staff_has_perm((select auth.uid()), 'class.view.all')
             or public.is_classroom_teacher(session_row.classroom_id, (select auth.uid()))
             or session_row.teacher_override = (select auth.uid())
           )
         )
       )
  );
$$;

revoke all on function public.can_view_session_attendance_v2(uuid) from public, anon, authenticated;
grant execute on function public.can_view_session_attendance_v2(uuid) to authenticated;

-- 课次级点名权限补齐 teacher_override。应用能力层已把有效代课教师判为可点名，
-- 旧 can_mark_attendance(classroom_id, uid) 只认识班级教师，无法表达单课次代课关系。
create or replace function public.can_mark_session_attendance_v2(
  p_session_id uuid
) returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.class_sessions session_row
     where session_row.id = p_session_id
       and session_row.deleted_at is null
       and session_row.cancelled_by is null
       and session_row.voided_at is null
       and (
         public.is_admin((select auth.uid()))
         or (
           public.can_view_session_attendance_v2(session_row.id)
           and public.staff_has_perm((select auth.uid()), 'attendance.mark')
         )
       )
  );
$$;

revoke all on function public.can_mark_session_attendance_v2(uuid) from public, anon, authenticated;
grant execute on function public.can_mark_session_attendance_v2(uuid) to authenticated;

-- Phase 4：考勤新增必须同时满足“当前账号可给该班点名”与“学生属于该课次名单”。
-- 名单锚点在开课后固定为 started_at，未开课时使用 scheduled_at；只有无时间课次
-- 才使用当前 active 成员。有效期统一为 [joined_at, left_at)。
create or replace function public.can_insert_session_attendance_v2(
  p_session_id uuid,
  p_student_id uuid
) returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
     from public.class_sessions session_row
     where session_row.id = p_session_id
       and public.can_mark_session_attendance_v2(session_row.id)
       and exists (
         select 1
           from public.enrollments membership_row
          where membership_row.classroom_id = session_row.classroom_id
            and membership_row.student_id = p_student_id
            and (
              (
                coalesce(session_row.started_at, session_row.scheduled_at) is not null
                and membership_row.joined_at <= coalesce(session_row.started_at, session_row.scheduled_at)
                and (
                  membership_row.left_at is null
                  or membership_row.left_at > coalesce(session_row.started_at, session_row.scheduled_at)
                )
              )
              or (
                coalesce(session_row.started_at, session_row.scheduled_at) is null
                and membership_row.status = 'active'
                and membership_row.left_at is null
              )
            )
       )
  );
$$;

comment on function public.can_insert_session_attendance_v2(uuid, uuid) is
  'Phase 4 attendance INSERT guard: caller can mark the class and student belongs to rosterAt=started_at??scheduled_at using [joined_at,left_at); untimed sessions use current active membership.';

revoke all on function public.can_insert_session_attendance_v2(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_insert_session_attendance_v2(uuid, uuid) to authenticated;

-- Exact session-scoped read model for the attendance drawer. A substitute must not receive class-wide
-- enrollment/student access merely to mark one lesson, so resolve the roster inside this guarded RPC.
-- Existing attendance outside the expected roster is retained as historyMismatch and remains correctable.
create or replace function public.get_session_attendance_roster_v2(
  p_session_id uuid
) returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  session_row public.class_sessions%rowtype;
  result_rows jsonb;
begin
  if (select auth.uid()) is null then raise exception 'UNAUTHENTICATED'; end if;

  select * into session_row
    from public.class_sessions
   where id = p_session_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.can_view_session_attendance_v2(p_session_id) then raise exception 'FORBIDDEN'; end if;

  with expected_students as (
    select distinct on (membership_row.student_id)
      membership_row.student_id,
      student_row.name,
      student_row.user_id
    from public.enrollments membership_row
    join public.students student_row on student_row.id = membership_row.student_id
    where membership_row.classroom_id = session_row.classroom_id
      and (
        (
          coalesce(session_row.started_at, session_row.scheduled_at) is not null
          and membership_row.joined_at <= coalesce(session_row.started_at, session_row.scheduled_at)
          and (
            membership_row.left_at is null
            or membership_row.left_at > coalesce(session_row.started_at, session_row.scheduled_at)
          )
        )
        or (
          coalesce(session_row.started_at, session_row.scheduled_at) is null
          and membership_row.status = 'active'
          and membership_row.left_at is null
        )
      )
    order by membership_row.student_id, membership_row.joined_at desc, membership_row.id
  ), attendance_rows as (
    select
      attendance_row.student_id,
      student_row.name,
      attendance_row.status,
      attendance_row.note
    from public.session_attendance attendance_row
    join public.students student_row on student_row.id = attendance_row.student_id
    where attendance_row.session_id = p_session_id
  ), combined_students as (
    select student_id from expected_students
    union
    select student_id from attendance_rows
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'studentId', combined_row.student_id,
        'studentName', coalesce(expected_row.name, attendance_row.name, '-'),
        'status', coalesce(
          attendance_row.status,
          case when expected_row.user_id is not null and exists (
            select 1 from public.session_events event_row
             where event_row.session_id = p_session_id and event_row.user_id = expected_row.user_id
          ) then 'present' else 'absent' end
        ),
        'note', coalesce(attendance_row.note, ''),
        'marked', attendance_row.student_id is not null,
        'historyMismatch', expected_row.student_id is null
      )
      order by lower(coalesce(expected_row.name, attendance_row.name, '-')), combined_row.student_id
    ),
    '[]'::jsonb
  ) into result_rows
  from combined_students combined_row
  left join expected_students expected_row on expected_row.student_id = combined_row.student_id
  left join attendance_rows attendance_row on attendance_row.student_id = combined_row.student_id;

  return result_rows;
end
$$;

comment on function public.get_session_attendance_roster_v2(uuid) is
  'Phase 4 session-scoped attendance drawer: rosterAt membership plus existing mismatch history; authorized by can_view_session_attendance_v2.';

revoke all on function public.get_session_attendance_roster_v2(uuid) from public, anon, authenticated;
grant execute on function public.get_session_attendance_roster_v2(uuid) to authenticated;

-- Preserve all existing student/archive visibility and add only the exact active substitute lesson.
drop policy if exists "attendance_select_scope" on public.session_attendance;
create policy "attendance_select_scope" on public.session_attendance
  for select to authenticated
  using (
    public.can_view_attendance(session_id, student_id, (select auth.uid()))
    or public.can_view_session_attendance_v2(session_id)
  );

-- RLS policies are permissive (OR), so the old insert policy must be replaced rather than supplemented.
drop policy if exists "attendance_insert_mark" on public.session_attendance;
create policy "attendance_insert_mark" on public.session_attendance
  for insert to authenticated
  with check (public.can_insert_session_attendance_v2(session_id, student_id));

-- Existing historyMismatch rows must remain correctable. Replace the predicate with the same session-level
-- authority (including teacher_override). P4I-15 temporarily granted table-wide UPDATE for PostgREST upsert;
-- Phase 4 no longer uses upsert, so take that grant back and expose only the two editable fact columns.
drop policy if exists "attendance_update_mark" on public.session_attendance;
create policy "attendance_update_mark" on public.session_attendance
  for update to authenticated
  using (public.can_mark_session_attendance_v2(session_id))
  with check (public.can_mark_session_attendance_v2(session_id));

revoke update on public.session_attendance from authenticated;
grant update (status, note) on public.session_attendance to authenticated;

-- get_staff_schedule_v2 previously omitted teacher_override from its SECURITY DEFINER scope even though
-- the canonical session RLS and UI capability layer both recognize the substitute. Keep its signature and
-- result shape stable; only add the active substitute visibility branch.
create or replace function public.get_staff_schedule_v2(
  p_from timestamptz,
  p_to timestamptz,
  p_campus_id uuid default null,
  p_room_id uuid default null
) returns table(
  session_id uuid,
  classroom_id uuid,
  classroom_name text,
  lecture_name text,
  scheduled_at timestamptz,
  duration_min smallint,
  teacher_name text,
  room_id uuid,
  room_name text,
  campus_id uuid,
  campus_name text,
  room_assignment_origin text
)
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to > p_from + interval '370 days' then
    raise exception 'VALIDATION';
  end if;
  return query
  select session_row.id, classroom_row.id, classroom_row.name, session_row.title,
         session_row.scheduled_at, session_row.duration_min,
         coalesce(override_profile.display_name, primary_profile.display_name, owner_profile.display_name, ''),
         room_row.id, room_row.name, campus_row.id, campus_row.name,
         session_row.room_assignment_origin
    from public.class_sessions session_row
    join public.classrooms classroom_row on classroom_row.id = session_row.classroom_id
    left join public.profiles override_profile on override_profile.id = session_row.teacher_override
    left join lateral (
      select assignment_row.user_id
        from public.classroom_staff_assignments assignment_row
       where assignment_row.classroom_id = classroom_row.id
         and assignment_row.responsibility = 'primary_teacher'
       order by assignment_row.created_at limit 1
    ) primary_assignment on true
    left join public.profiles primary_profile on primary_profile.id = primary_assignment.user_id
    left join public.profiles owner_profile on owner_profile.id = classroom_row.owner_id
    left join public.campus_rooms room_row on room_row.id = session_row.room_id
    left join public.campuses campus_row on campus_row.id = room_row.campus_id
   where session_row.deleted_at is null
     and session_row.scheduled_at >= p_from and session_row.scheduled_at < p_to
     and (p_room_id is null or session_row.room_id = p_room_id)
     and (p_campus_id is null or campus_row.id = p_campus_id)
     and (
       public.has_perm(uid, 'schedule.view.all')
       or public.is_classroom_teacher(classroom_row.id, uid)
       or exists (
         select 1 from public.classroom_staff_assignments assignment_row
          where assignment_row.classroom_id = classroom_row.id and assignment_row.user_id = uid
       )
       or (
         session_row.teacher_override = uid
         and public.is_staff(uid)
       )
     )
   order by session_row.scheduled_at, session_row.id;
end
$$;

revoke all on function public.get_staff_schedule_v2(timestamptz, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_staff_schedule_v2(timestamptz, timestamptz, uuid, uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
