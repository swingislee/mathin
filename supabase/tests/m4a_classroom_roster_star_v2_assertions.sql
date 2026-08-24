\set ON_ERROR_STOP on

-- Development-target assertion. It reuses a fixed-account classroom, creates
-- two temporary sessions, and rolls every roster/event/source change back.
begin;

create temp table m4a_context (
  teacher_id uuid not null,
  student_id uuid not null,
  student_user_id uuid not null,
  v1_session_id uuid not null,
  v2_session_id uuid not null,
  award_a uuid not null,
  award_b uuid not null,
  award_c uuid not null
);

do $$
declare
  classroom_uuid uuid;
  teacher_uuid uuid;
  student_uuid uuid;
  student_user_uuid uuid;
  donor_student_uuid uuid;
  v1_session_uuid uuid := gen_random_uuid();
  v2_session_uuid uuid := gen_random_uuid();
  award_a_uuid uuid := gen_random_uuid();
  award_b_uuid uuid := gen_random_uuid();
  award_c_uuid uuid := gen_random_uuid();
  new_seat integer;
  state jsonb;
  current_hash text;
begin
  select
    classroom_row.id,
    teacher_member.user_id,
    enrollment_row.student_id,
    student_row.user_id
    into classroom_uuid, teacher_uuid, student_uuid, student_user_uuid
    from public.classrooms classroom_row
    join public.classroom_members teacher_member
      on teacher_member.classroom_id = classroom_row.id
     and teacher_member.role = 'teacher'
    join public.profiles teacher_profile
      on teacher_profile.id = teacher_member.user_id
     and teacher_profile.is_active
    join public.enrollments enrollment_row
      on enrollment_row.classroom_id = classroom_row.id
     and enrollment_row.status = 'active'
    join public.students student_row
      on student_row.id = enrollment_row.student_id
   where (
     select count(*)
       from public.enrollments active_row
      where active_row.classroom_id = classroom_row.id
        and active_row.status = 'active'
   ) < 60
   order by classroom_row.created_at, enrollment_row.joined_at
   limit 1;

  if classroom_uuid is null then
    raise exception 'M4A_FIXED_ACTIVE_ENROLLMENT_MISSING';
  end if;

  -- The fixed development dataset may intentionally leave the active student
  -- unclaimed. Borrow an already-existing fixed student mapping inside this
  -- rollback-only transaction so the legacy writer can also be exercised.
  if student_user_uuid is null then
    select student_row.id, student_row.user_id
      into donor_student_uuid, student_user_uuid
      from public.students student_row
      join public.profiles profile_row
        on profile_row.id = student_row.user_id
       and profile_row.is_active
     where student_row.id <> student_uuid
     order by student_row.created_at
     limit 1;
    if student_user_uuid is null then
      raise exception 'M4A_FIXED_STUDENT_ACCOUNT_MISSING';
    end if;
    update public.students set user_id = null where id = donor_student_uuid;
    update public.students set user_id = student_user_uuid where id = student_uuid;
  end if;

  insert into public.class_sessions(id, classroom_id, title)
  values
    (v1_session_uuid, classroom_uuid, 'M4a rollback v1'),
    (v2_session_uuid, classroom_uuid, 'M4a rollback v2');

  perform set_config('request.jwt.claim.sub', teacher_uuid::text, true);

  state := public.freeze_session_roster(v1_session_uuid, 1::smallint);
  if not (state ->> 'frozen')::boolean
     or (state ->> 'revision')::integer <> 1
     or (state ->> 'starEventSchema')::integer <> 1
  then
    raise exception 'M4A_V1_FREEZE_FAILED: %', state;
  end if;

  if not exists (
    select 1
      from public.session_roster_entries entry_row
     where entry_row.session_id = v1_session_uuid
       and entry_row.revision = 1
       and entry_row.student_id = student_uuid
       and entry_row.user_id = student_user_uuid
  ) then
    raise exception 'M4A_V1_IDENTITY_NOT_SNAPSHOTTED';
  end if;

  -- The next snapshot must keep the active enrollment even after the account
  -- mapping becomes null.
  update public.students set user_id = null where id = student_uuid;
  state := public.freeze_session_roster(v2_session_uuid, 2::smallint);
  if (state ->> 'starEventSchema')::integer <> 2
     or not exists (
       select 1
         from public.session_roster_entries entry_row
        where entry_row.session_id = v2_session_uuid
          and entry_row.revision = 1
          and entry_row.student_id = student_uuid
          and entry_row.user_id is null
     )
  then
    raise exception 'M4A_UNCLAIMED_V2_FREEZE_FAILED: %', state;
  end if;

  select candidate.position into new_seat
    from generate_series(0, 59) candidate(position)
   where not exists (
     select 1
       from public.classroom_student_seat_order seat_row
      where seat_row.classroom_id = classroom_uuid
        and seat_row.position = candidate.position
   )
   order by candidate.position desc
   limit 1;
  if new_seat is null then raise exception 'M4A_FREE_SEAT_MISSING'; end if;

  delete from public.classroom_student_seat_order
   where classroom_id = classroom_uuid
     and student_id = student_uuid;
  insert into public.classroom_student_seat_order(
    classroom_id, student_id, position, updated_by
  ) values (classroom_uuid, student_uuid, new_seat, teacher_uuid);

  state := public.get_session_roster(v2_session_uuid);
  if not (state ->> 'hasDifference')::boolean
     or state ->> 'sourceHash' = state ->> 'currentSourceHash'
  then
    raise exception 'M4A_ROSTER_DIFFERENCE_NOT_VISIBLE: %', state;
  end if;

  current_hash := state ->> 'currentSourceHash';
  state := public.refresh_session_roster(v2_session_uuid, current_hash);
  if (state ->> 'revision')::integer <> 2
     or (state ->> 'hasDifference')::boolean
     or (state ->> 'starEventSchema')::integer <> 2
     or not exists (
       select 1
         from public.session_roster_entries entry_row
        where entry_row.session_id = v2_session_uuid
          and entry_row.revision = 2
          and entry_row.student_id = student_uuid
          and entry_row.seat_position = new_seat
     )
  then
    raise exception 'M4A_CONFIRMED_REFRESH_FAILED: %', state;
  end if;

  if public.is_valid_session_star_event(
    v2_session_uuid,
    'star',
    jsonb_build_object('studentId', student_uuid, 'awardId', award_a_uuid)
  ) then
    raise exception 'M4A_MISSING_SCHEMA_ACCEPTED';
  end if;
  if public.is_valid_session_star_event(
    v2_session_uuid,
    'star',
    jsonb_build_object(
      'schemaVersion', 3,
      'studentId', student_uuid,
      'awardId', award_a_uuid
    )
  ) then
    raise exception 'M4A_UNKNOWN_SCHEMA_ACCEPTED';
  end if;
  if public.is_valid_session_star_event(
    v1_session_uuid,
    'star',
    jsonb_build_object('studentId', student_uuid)
  ) then
    raise exception 'M4A_V1_STABLE_ID_ACCEPTED';
  end if;

  insert into m4a_context values (
    teacher_uuid,
    student_uuid,
    student_user_uuid,
    v1_session_uuid,
    v2_session_uuid,
    award_a_uuid,
    award_b_uuid,
    award_c_uuid
  );
end;
$$;

grant select on m4a_context to authenticated;
select set_config(
  'request.jwt.claim.sub',
  (select teacher_id::text from m4a_context),
  true
);

-- Exercise the real authenticated insert policy for both frozen writers.
set local role authenticated;

insert into public.session_events(id, session_id, user_id, device_id, seq, type, payload, at)
select gen_random_uuid(), v1_session_id, teacher_id, 'm4a-v1', 1, 'star',
       jsonb_build_object('studentId', student_user_id), now()
  from m4a_context;

insert into public.session_events(id, session_id, user_id, device_id, seq, type, payload, at)
select gen_random_uuid(), v2_session_id, teacher_id, 'm4a-v2', event_row.seq, event_row.type,
       jsonb_build_object(
         'schemaVersion', 2,
         'studentId', student_id,
         'awardId', event_row.award_id
       ),
       now()
  from m4a_context
  cross join lateral (
    values
      (1::bigint, 'star'::text, award_a),
      (2::bigint, 'star'::text, award_a),
      (3::bigint, 'star_undo'::text, award_a),
      (4::bigint, 'star_undo'::text, award_b),
      (5::bigint, 'star'::text, award_b),
      (6::bigint, 'star'::text, award_c)
  ) event_row(seq, type, award_id);

reset role;

do $$
declare
  target_student uuid;
  target_session uuid;
  expected_hash text;
  actual_total integer;
  flag_enabled boolean;
  insert_policy text;
begin
  select student_id, v2_session_id into target_student, target_session from m4a_context;

  select public.get_student_star_total(target_student) into actual_total;
  if actual_total <> 2 then
    raise exception 'M4A_DUAL_READ_TOTAL_FAILED: %', actual_total;
  end if;

  select public.session_roster_source_hash(target_session) into expected_hash;
  if expected_hash <> (
    select roster_source_hash from public.class_sessions where id = target_session
  ) then
    raise exception 'M4A_REFRESH_HASH_NOT_CURRENT';
  end if;

  select flag_row.enabled into flag_enabled
    from public.feature_flag_versions flag_row
   where flag_row.flag_key = 'teaching.classroom_layout_v2'
     and flag_row.effective_until is null
   order by flag_row.version desc
   limit 1;
  if coalesce(flag_enabled, true) then
    raise exception 'M4A_LAYOUT_FLAG_NOT_FAIL_CLOSED';
  end if;

  select pg_get_expr(policy_row.polwithcheck, policy_row.polrelid)
    into insert_policy
    from pg_policy policy_row
   where policy_row.polrelid = 'public.session_events'::regclass
     and policy_row.polname = 'events_insert_own';
  if insert_policy not like '%is_valid_session_star_event%' then
    raise exception 'M4A_STAR_RLS_GUARD_MISSING';
  end if;
end;
$$;

rollback;

select 'M4a roster/star v2 assertions passed' as result;
