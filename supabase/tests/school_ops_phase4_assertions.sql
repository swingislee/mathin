-- Phase 4 session/roster/attendance contract. Uses fixed development accounts,
-- creates only transaction-local purpose=test fixtures, and rolls every change back.

begin;

do $$
declare
  admin_id uuid;
  teacher_id uuid;
  substitute_id uuid;
  readonly_substitute_id uuid;
  outsider_id uuid;
  mark_role_id constant uuid := 'f4000000-0000-4000-8000-000000000011';
  readonly_role_id constant uuid := 'f4000000-0000-4000-8000-000000000012';
  classroom_id constant uuid := 'f4000000-0000-4000-8000-000000000101';
  active_student_id constant uuid := 'f4000000-0000-4000-8000-000000000201';
  historical_student_id constant uuid := 'f4000000-0000-4000-8000-000000000202';
  late_student_id constant uuid := 'f4000000-0000-4000-8000-000000000203';
  boundary_student_id constant uuid := 'f4000000-0000-4000-8000-000000000204';
  mismatch_student_id constant uuid := 'f4000000-0000-4000-8000-000000000205';
  outsider_student_id constant uuid := 'f4000000-0000-4000-8000-000000000206';
  session_id constant uuid := 'f4000000-0000-4000-8000-000000000301';
  readonly_session_id constant uuid := 'f4000000-0000-4000-8000-000000000302';
  cancelled_session_id constant uuid := 'f4000000-0000-4000-8000-000000000303';
  voided_session_id constant uuid := 'f4000000-0000-4000-8000-000000000304';
  deleted_session_id constant uuid := 'f4000000-0000-4000-8000-000000000305';
  drawer_rows jsonb;
begin
  select id into admin_id from auth.users where email = 'test-admin@mathin.local';
  select id into teacher_id from auth.users where email = 'test-teacher@mathin.local';
  select id into substitute_id from auth.users where email = 'test-multirole@mathin.local';
  select id into readonly_substitute_id from auth.users where email = 'test-research@mathin.local';
  select id into outsider_id from auth.users where email = 'test-sales@mathin.local';
  if admin_id is null or teacher_id is null or substitute_id is null
     or readonly_substitute_id is null or outsider_id is null then
    raise exception 'PHASE4_FIXED_STAFF_FIXTURES_REQUIRED';
  end if;

  -- Give the two substitute fixtures exact capabilities so schedule visibility cannot
  -- accidentally pass through a broader role such as schedule.view.all.
  insert into public.staff_roles(id, key, name, is_system)
  values
    (mark_role_id, 'phase4_assert_mark', 'Phase 4 assertion mark', false),
    (readonly_role_id, 'phase4_assert_readonly', 'Phase 4 assertion readonly', false);
  delete from public.staff_role_members where user_id in (substitute_id, readonly_substitute_id);
  insert into public.staff_role_members(user_id, role_id, granted_by)
  values
    (substitute_id, mark_role_id, admin_id),
    (readonly_substitute_id, readonly_role_id, admin_id);
  insert into public.role_permissions(role_id, perm_key)
  values (mark_role_id, 'attendance.mark');

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.classrooms(id, owner_id, name, invite_code, purpose)
  values (classroom_id, admin_id, 'Phase 4 assertion class', 'p4assert', 'test');
  insert into public.classroom_members(classroom_id, user_id, role)
  values (classroom_id, teacher_id, 'teacher');

  insert into public.students(id, name, status, bind_code)
  values
    (active_student_id, 'Phase 4 active', 'enrolled', 'p4assert01'),
    (historical_student_id, 'Phase 4 historical', 'enrolled', 'p4assert02'),
    (late_student_id, 'Phase 4 late', 'enrolled', 'p4assert03'),
    (boundary_student_id, 'Phase 4 boundary', 'enrolled', 'p4assert04'),
    (mismatch_student_id, 'Phase 4 mismatch', 'enrolled', 'p4assert05'),
    (outsider_student_id, 'Phase 4 outsider', 'enrolled', 'p4assert06');

  insert into public.enrollments(id, classroom_id, student_id, status, joined_at, left_at, operated_by)
  values
    ('f4000000-0000-4000-8000-000000000401', classroom_id, active_student_id, 'active', '2026-09-05 08:00:00+00', null, admin_id),
    ('f4000000-0000-4000-8000-000000000402', classroom_id, historical_student_id, 'transferred_out', '2026-09-05 08:00:00+00', '2026-09-05 09:30:00+00', admin_id),
    ('f4000000-0000-4000-8000-000000000403', classroom_id, late_student_id, 'active', '2026-09-05 09:01:00+00', null, admin_id),
    ('f4000000-0000-4000-8000-000000000404', classroom_id, boundary_student_id, 'withdrawn', '2026-09-05 08:00:00+00', '2026-09-05 09:00:00+00', admin_id);

  insert into public.class_sessions(
    id, classroom_id, title, scheduled_at, started_at, teacher_override,
    deleted_at, cancelled_by, voided_at
  ) values
    (session_id, classroom_id, 'Phase 4 marked substitute', '2026-09-05 10:00:00+00', '2026-09-05 09:00:00+00', substitute_id, null, null, null),
    (readonly_session_id, classroom_id, 'Phase 4 readonly substitute', '2026-09-05 11:00:00+00', null, readonly_substitute_id, null, null, null),
    (cancelled_session_id, classroom_id, 'Phase 4 cancelled', '2026-09-05 12:00:00+00', null, substitute_id, null, admin_id, null),
    (voided_session_id, classroom_id, 'Phase 4 voided', '2026-09-05 13:00:00+00', null, substitute_id, null, null, '2026-09-05 08:30:00+00'),
    (deleted_session_id, classroom_id, 'Phase 4 deleted', '2026-09-05 14:00:00+00', null, substitute_id, '2026-09-05 08:30:00+00', null, null);

  -- Simulate a legacy row that no longer belongs to rosterAt. It must remain visible
  -- and correctable, without allowing a new arbitrary nonmember attendance row.
  insert into public.session_attendance(session_id, student_id, status, note)
  values (session_id, mismatch_student_id, 'leave', 'legacy mismatch');

  perform set_config('request.jwt.claim.sub', '', true);
  if public.can_view_session_attendance_v2(session_id)
     or public.can_mark_session_attendance_v2(session_id) then
    raise exception 'PHASE4_ANONYMOUS_ATTENDANCE_ACCESS_ALLOWED';
  end if;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  if not public.can_mark_session_attendance_v2(session_id) then raise exception 'PHASE4_ADMIN_MARK_REJECTED'; end if;

  perform set_config('request.jwt.claim.sub', teacher_id::text, true);
  if not public.can_mark_session_attendance_v2(session_id) then raise exception 'PHASE4_CLASS_TEACHER_MARK_REJECTED'; end if;

  perform set_config('request.jwt.claim.sub', substitute_id::text, true);
  if not public.can_mark_session_attendance_v2(session_id) then raise exception 'PHASE4_SUBSTITUTE_MARK_REJECTED'; end if;
  if not public.can_insert_session_attendance_v2(session_id, active_student_id)
     or not public.can_insert_session_attendance_v2(session_id, historical_student_id) then
    raise exception 'PHASE4_ROSTER_MEMBER_REJECTED';
  end if;
  if public.can_insert_session_attendance_v2(session_id, late_student_id)
     or public.can_insert_session_attendance_v2(session_id, boundary_student_id)
     or public.can_insert_session_attendance_v2(session_id, outsider_student_id) then
    raise exception 'PHASE4_NON_ROSTER_MEMBER_ALLOWED';
  end if;
  if public.can_mark_session_attendance_v2(cancelled_session_id)
     or public.can_mark_session_attendance_v2(voided_session_id)
     or public.can_mark_session_attendance_v2(deleted_session_id) then
    raise exception 'PHASE4_CLOSED_SESSION_MARK_ALLOWED';
  end if;

  drawer_rows := public.get_session_attendance_roster_v2(session_id);
  if jsonb_array_length(drawer_rows) <> 3 then raise exception 'PHASE4_DRAWER_ROSTER_COUNT_INVALID'; end if;
  if not exists (
    select 1 from jsonb_array_elements(drawer_rows) entry
     where entry ->> 'studentId' = mismatch_student_id::text
       and (entry ->> 'historyMismatch')::boolean
       and (entry ->> 'marked')::boolean
  ) then raise exception 'PHASE4_HISTORY_MISMATCH_NOT_PRESERVED'; end if;
  if exists (
    select 1 from jsonb_array_elements(drawer_rows) entry
     where entry ->> 'studentId' in (late_student_id::text, boundary_student_id::text, outsider_student_id::text)
  ) then raise exception 'PHASE4_DRAWER_INCLUDED_NON_ROSTER_MEMBER'; end if;

  perform set_config('request.jwt.claim.sub', outsider_id::text, true);
  if public.can_view_session_attendance_v2(session_id)
     or public.can_mark_session_attendance_v2(session_id) then
    raise exception 'PHASE4_NON_ASSIGNED_STAFF_ACCESS_ALLOWED';
  end if;

  perform set_config('request.jwt.claim.sub', readonly_substitute_id::text, true);
  if not public.can_view_session_attendance_v2(readonly_session_id) then raise exception 'PHASE4_READONLY_SUBSTITUTE_VIEW_REJECTED'; end if;
  if public.can_mark_session_attendance_v2(readonly_session_id) then raise exception 'PHASE4_READONLY_SUBSTITUTE_MARK_ALLOWED'; end if;
  drawer_rows := public.get_session_attendance_roster_v2(readonly_session_id);
  if jsonb_array_length(drawer_rows) <> 2 then raise exception 'PHASE4_READONLY_SUBSTITUTE_ROSTER_HIDDEN'; end if;
  if not exists (
    select 1 from public.get_staff_schedule_v2(
      '2026-09-05 00:00:00+00', '2026-09-06 00:00:00+00', null, null
    ) schedule_row where schedule_row.session_id = readonly_session_id
  ) then raise exception 'PHASE4_READONLY_SUBSTITUTE_SCHEDULE_HIDDEN'; end if;

  if has_table_privilege('authenticated', 'public.session_attendance', 'UPDATE') then
    raise exception 'PHASE4_TABLE_WIDE_UPDATE_STILL_GRANTED';
  end if;
  if not has_column_privilege('authenticated', 'public.session_attendance', 'status', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.session_attendance', 'note', 'UPDATE')
     or has_column_privilege('authenticated', 'public.session_attendance', 'session_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.session_attendance', 'student_id', 'UPDATE') then
    raise exception 'PHASE4_ATTENDANCE_COLUMN_GRANTS_INVALID';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where email = 'test-multirole@mathin.local'),
  true
);
set local role authenticated;

do $$
declare
  rejected boolean;
  affected integer;
begin
  insert into public.session_attendance(session_id, student_id, status, note)
  values
    ('f4000000-0000-4000-8000-000000000301', 'f4000000-0000-4000-8000-000000000201', 'present', ''),
    ('f4000000-0000-4000-8000-000000000301', 'f4000000-0000-4000-8000-000000000202', 'late', 'arrived after start');

  update public.session_attendance
     set status = 'present', note = 'corrected'
   where session_id = 'f4000000-0000-4000-8000-000000000301'
     and student_id = 'f4000000-0000-4000-8000-000000000205';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'PHASE4_SUBSTITUTE_MISMATCH_UPDATE_REJECTED'; end if;

  rejected := false;
  begin
    insert into public.session_attendance(session_id, student_id, status, note)
    values ('f4000000-0000-4000-8000-000000000301', 'f4000000-0000-4000-8000-000000000203', 'present', '');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'PHASE4_LATE_JOIN_INSERT_ALLOWED'; end if;

  rejected := false;
  begin
    insert into public.session_attendance(session_id, student_id, status, note)
    values ('f4000000-0000-4000-8000-000000000301', 'f4000000-0000-4000-8000-000000000206', 'present', '');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'PHASE4_ARBITRARY_STUDENT_INSERT_ALLOWED'; end if;

  rejected := false;
  begin
    update public.session_attendance
       set student_id = 'f4000000-0000-4000-8000-000000000203'
     where session_id = 'f4000000-0000-4000-8000-000000000301'
       and student_id = 'f4000000-0000-4000-8000-000000000201';
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'PHASE4_ATTENDANCE_PRIMARY_KEY_UPDATE_ALLOWED'; end if;
end;
$$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where email = 'test-research@mathin.local'),
  true
);
set local role authenticated;

do $$
declare
  rejected boolean := false;
  affected integer;
begin
  begin
    insert into public.session_attendance(session_id, student_id, status, note)
    values ('f4000000-0000-4000-8000-000000000302', 'f4000000-0000-4000-8000-000000000201', 'present', '');
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'PHASE4_READONLY_SUBSTITUTE_INSERT_ALLOWED'; end if;

  update public.session_attendance
     set note = 'must stay hidden'
   where session_id = 'f4000000-0000-4000-8000-000000000301'
     and student_id = 'f4000000-0000-4000-8000-000000000205';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'PHASE4_READONLY_SUBSTITUTE_UPDATE_ALLOWED'; end if;
end;
$$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where email = 'test-teacher@mathin.local'),
  true
);

do $$
declare
  change_id uuid;
begin
  change_id := public.record_session_change(
    'f4000000-0000-4000-8000-000000000301',
    'f4000000-0000-4000-8000-000000000201',
    'leave',
    null,
    'Phase 4 assertion'
  );
  if change_id is null or not exists (
    select 1 from public.session_changes where id = change_id and kind = 'leave'
  ) then raise exception 'PHASE4_INTERNAL_SESSION_CHANGE_BROKEN'; end if;
end;
$$;

rollback;
