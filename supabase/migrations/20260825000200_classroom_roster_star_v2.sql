-- M4a: freeze the enrollment-authoritative classroom roster per session and
-- version star awards against stable students.id identities.

begin;

alter table public.class_sessions
  add column roster_revision integer not null default 0,
  add column roster_source_hash text,
  add column roster_frozen_at timestamptz,
  add column star_event_schema smallint not null default 1,
  add constraint class_sessions_roster_revision_valid check (roster_revision >= 0),
  add constraint class_sessions_roster_snapshot_complete check (
    (roster_revision = 0 and roster_source_hash is null and roster_frozen_at is null)
    or (
      roster_revision > 0
      and roster_source_hash ~ '^[0-9a-f]{64}$'
      and roster_frozen_at is not null
    )
  ),
  add constraint class_sessions_star_event_schema_valid check (star_event_schema in (1, 2));

create table public.session_roster_revisions (
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  revision integer not null check (revision > 0),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason in ('start', 'teacher_refresh')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (session_id, revision)
);

create table public.session_roster_entries (
  session_id uuid not null,
  revision integer not null,
  student_id uuid not null references public.students(id) on delete restrict,
  name text not null,
  seat_position smallint check (seat_position between 0 and 59),
  user_id uuid references public.profiles(id) on delete set null,
  roster_order smallint not null check (roster_order between 0 and 59),
  primary key (session_id, revision, student_id),
  unique (session_id, revision, roster_order),
  unique (session_id, revision, seat_position),
  foreign key (session_id, revision)
    references public.session_roster_revisions(session_id, revision)
    on delete cascade
);

create index session_roster_entries_student_idx
  on public.session_roster_entries(student_id, session_id);
create index session_roster_entries_user_idx
  on public.session_roster_entries(user_id, session_id)
  where user_id is not null;

alter table public.session_roster_revisions enable row level security;
alter table public.session_roster_entries enable row level security;

create policy session_roster_revisions_select_member
on public.session_roster_revisions
for select to authenticated
using (
  public.is_session_teacher(session_id, (select auth.uid()))
  or public.is_session_member(session_id, (select auth.uid()))
);

create policy session_roster_entries_select_member
on public.session_roster_entries
for select to authenticated
using (
  public.is_session_teacher(session_id, (select auth.uid()))
  or public.is_session_member(session_id, (select auth.uid()))
);

revoke all on public.session_roster_revisions from anon, authenticated;
revoke all on public.session_roster_entries from anon, authenticated;
grant select on public.session_roster_revisions to authenticated;
grant select on public.session_roster_entries to authenticated;

-- Active enrollments are the roster authority. classroom_members remains the
-- account access list; students without a claimed account therefore stay here
-- with user_id = null. Saved seat positions are reused without compaction.
create function public.current_session_roster_source(p_session_id uuid)
returns table (
  student_id uuid,
  name text,
  seat_position smallint,
  user_id uuid,
  roster_order integer
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select
    student_row.id,
    coalesce(nullif(trim(student_row.name), ''), '—'),
    seat_row.position,
    student_row.user_id,
    (row_number() over (
      order by
        case when seat_row.position is null then 1 else 0 end,
        seat_row.position,
        enrollment_row.joined_at,
        student_row.id
    ) - 1)::integer
  from public.class_sessions session_row
  join public.enrollments enrollment_row
    on enrollment_row.classroom_id = session_row.classroom_id
   and enrollment_row.status = 'active'
  join public.students student_row on student_row.id = enrollment_row.student_id
  left join public.classroom_student_seat_order seat_row
    on seat_row.classroom_id = session_row.classroom_id
   and seat_row.student_id = student_row.id
  where session_row.id = p_session_id
    and session_row.deleted_at is null;
$$;

create function public.session_roster_source_hash(p_session_id uuid)
returns text
language sql security definer stable
set search_path = public, pg_temp
as $$
  select encode(
    extensions.digest(
      convert_to(
        coalesce(
          jsonb_agg(
            jsonb_build_array(
              source_row.student_id,
              source_row.name,
              source_row.seat_position,
              source_row.user_id,
              source_row.roster_order
            ) order by source_row.roster_order
          ),
          '[]'::jsonb
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.current_session_roster_source(p_session_id) source_row;
$$;

revoke all on function public.current_session_roster_source(uuid)
  from public, anon, authenticated;
revoke all on function public.session_roster_source_hash(uuid)
  from public, anon, authenticated;

create function public.get_session_roster(p_session_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_row public.class_sessions%rowtype;
  current_hash text;
  revision_created_at timestamptz;
  entries jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;

  select * into session_row
    from public.class_sessions
   where id = p_session_id
     and deleted_at is null;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not (
    public.is_session_teacher(p_session_id, uid)
    or public.is_session_member(p_session_id, uid)
  ) then
    raise exception 'FORBIDDEN';
  end if;

  current_hash := public.session_roster_source_hash(p_session_id);

  if session_row.roster_revision > 0 then
    select revision_row.created_at into revision_created_at
      from public.session_roster_revisions revision_row
     where revision_row.session_id = p_session_id
       and revision_row.revision = session_row.roster_revision;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'studentId', entry_row.student_id,
          'name', entry_row.name,
          'seatPosition', entry_row.seat_position,
          'userId', entry_row.user_id
        ) order by entry_row.roster_order
      ),
      '[]'::jsonb
    ) into entries
      from public.session_roster_entries entry_row
     where entry_row.session_id = p_session_id
       and entry_row.revision = session_row.roster_revision;
  else
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'studentId', source_row.student_id,
          'name', source_row.name,
          'seatPosition', source_row.seat_position,
          'userId', source_row.user_id
        ) order by source_row.roster_order
      ),
      '[]'::jsonb
    ) into entries
      from public.current_session_roster_source(p_session_id) source_row;
  end if;

  return jsonb_build_object(
    'sessionId', session_row.id,
    'revision', nullif(session_row.roster_revision, 0),
    'frozen', session_row.roster_revision > 0,
    'sourceHash', session_row.roster_source_hash,
    'currentSourceHash', current_hash,
    'hasDifference', session_row.roster_revision > 0
      and session_row.roster_source_hash is distinct from current_hash,
    'frozenAt', session_row.roster_frozen_at,
    'revisionCreatedAt', revision_created_at,
    'starEventSchema', session_row.star_event_schema,
    'entries', entries
  );
end;
$$;

create function public.freeze_session_roster(
  p_session_id uuid,
  p_star_event_schema smallint default 1
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_row public.class_sessions%rowtype;
  selected_schema smallint;
  source_hash text;
  roster_count integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_star_event_schema is null or p_star_event_schema not in (1, 2) then
    raise exception 'VALIDATION';
  end if;

  select * into session_row
    from public.class_sessions
   where id = p_session_id
     and deleted_at is null
   for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;

  -- A frozen session never changes writers when a rollout flag changes later.
  if session_row.roster_revision > 0 then
    return public.get_session_roster(p_session_id);
  end if;

  select count(*) into roster_count
    from public.current_session_roster_source(p_session_id);
  if roster_count > 60 then raise exception 'ROSTER_CAPACITY_EXCEEDED'; end if;

  source_hash := public.session_roster_source_hash(p_session_id);
  selected_schema := case
    when exists (
      select 1 from public.session_events event_row
       where event_row.session_id = p_session_id
         and event_row.type in ('star', 'star_undo')
    ) then 1
    else p_star_event_schema
  end;

  insert into public.session_roster_revisions(
    session_id, revision, source_hash, reason, created_by
  ) values (p_session_id, 1, source_hash, 'start', uid);

  insert into public.session_roster_entries(
    session_id, revision, student_id, name, seat_position, user_id, roster_order
  )
  select
    p_session_id,
    1,
    source_row.student_id,
    source_row.name,
    source_row.seat_position,
    source_row.user_id,
    source_row.roster_order::smallint
  from public.current_session_roster_source(p_session_id) source_row;

  update public.class_sessions
     set roster_revision = 1,
         roster_source_hash = source_hash,
         roster_frozen_at = now(),
         star_event_schema = selected_schema
   where id = p_session_id;

  perform public.emit_domain_event(
    'class_session.roster_frozen',
    'class_session',
    p_session_id,
    jsonb_build_object(
      'revision', 1,
      'studentCount', roster_count,
      'starEventSchema', selected_schema
    ),
    null,
    null
  );

  return public.get_session_roster(p_session_id);
end;
$$;

create function public.refresh_session_roster(
  p_session_id uuid,
  p_expected_source_hash text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  session_row public.class_sessions%rowtype;
  current_hash text;
  next_revision integer;
  roster_count integer;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_expected_source_hash is null
     or p_expected_source_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'VALIDATION';
  end if;

  select * into session_row
    from public.class_sessions
   where id = p_session_id
     and deleted_at is null
   for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not public.is_session_teacher(p_session_id, uid) then raise exception 'FORBIDDEN'; end if;
  if session_row.roster_revision = 0 then raise exception 'ROSTER_NOT_FROZEN'; end if;

  current_hash := public.session_roster_source_hash(p_session_id);
  if current_hash <> p_expected_source_hash then raise exception 'ROSTER_CHANGED'; end if;
  if current_hash = session_row.roster_source_hash then
    return public.get_session_roster(p_session_id);
  end if;

  select count(*) into roster_count
    from public.current_session_roster_source(p_session_id);
  if roster_count > 60 then raise exception 'ROSTER_CAPACITY_EXCEEDED'; end if;

  next_revision := session_row.roster_revision + 1;
  insert into public.session_roster_revisions(
    session_id, revision, source_hash, reason, created_by
  ) values (p_session_id, next_revision, current_hash, 'teacher_refresh', uid);

  insert into public.session_roster_entries(
    session_id, revision, student_id, name, seat_position, user_id, roster_order
  )
  select
    p_session_id,
    next_revision,
    source_row.student_id,
    source_row.name,
    source_row.seat_position,
    source_row.user_id,
    source_row.roster_order::smallint
  from public.current_session_roster_source(p_session_id) source_row;

  update public.class_sessions
     set roster_revision = next_revision,
         roster_source_hash = current_hash
   where id = p_session_id;

  perform public.emit_domain_event(
    'class_session.roster_refreshed',
    'class_session',
    p_session_id,
    jsonb_build_object(
      'revision', next_revision,
      'studentCount', roster_count
    ),
    null,
    null
  );

  return public.get_session_roster(p_session_id);
end;
$$;

revoke all on function public.get_session_roster(uuid)
  from public, anon, authenticated;
revoke all on function public.freeze_session_roster(uuid, smallint)
  from public, anon, authenticated;
revoke all on function public.refresh_session_roster(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_session_roster(uuid) to authenticated;
grant execute on function public.freeze_session_roster(uuid, smallint) to authenticated;
grant execute on function public.refresh_session_roster(uuid, text) to authenticated;

-- This helper is used by the insert RLS policy. v1 targets a claimed user id;
-- v2 targets stable students.id and always names the concrete award being
-- added or revoked. Reverse arrival remains valid, so undo does not require
-- the award row to have arrived first.
create function public.is_valid_session_star_event(
  p_session_id uuid,
  p_type text,
  p_payload jsonb
)
returns boolean
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  session_row public.class_sessions%rowtype;
  target_text text;
  award_text text;
  target_id uuid;
begin
  if p_type not in ('star', 'star_undo') then return true; end if;
  if jsonb_typeof(p_payload) <> 'object' then return false; end if;

  select * into session_row
    from public.class_sessions
   where id = p_session_id
     and deleted_at is null;
  if not found then return false; end if;

  target_text := p_payload ->> 'studentId';
  if target_text is null
     or target_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return false;
  end if;
  target_id := target_text::uuid;

  if session_row.star_event_schema = 2 then
    award_text := p_payload ->> 'awardId';
    if p_payload -> 'schemaVersion' is distinct from '2'::jsonb
       or award_text is null
       or award_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or session_row.roster_revision = 0
    then
      return false;
    end if;
    return exists (
      select 1
        from public.session_roster_entries entry_row
       where entry_row.session_id = p_session_id
         and entry_row.revision = session_row.roster_revision
         and entry_row.student_id = target_id
    );
  end if;

  if p_payload ? 'schemaVersion'
     and p_payload -> 'schemaVersion' <> '1'::jsonb
  then
    return false;
  end if;

  if session_row.roster_revision > 0 then
    return exists (
      select 1
        from public.session_roster_entries entry_row
       where entry_row.session_id = p_session_id
         and entry_row.revision = session_row.roster_revision
         and entry_row.user_id = target_id
    );
  end if;

  return exists (
    select 1
      from public.enrollments enrollment_row
      join public.students student_row on student_row.id = enrollment_row.student_id
     where enrollment_row.classroom_id = session_row.classroom_id
       and enrollment_row.status = 'active'
       and student_row.user_id = target_id
  );
end;
$$;

revoke all on function public.is_valid_session_star_event(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.is_valid_session_star_event(uuid, text, jsonb)
  to authenticated;

drop policy if exists "events_insert_own" on public.session_events;
create policy "events_insert_own" on public.session_events
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (
    public.is_session_member(session_id, (select auth.uid()))
    or public.is_session_teacher(session_id, (select auth.uid()))
  )
  and (
    type in ('hand', 'answer')
    or (
      public.is_session_teacher(session_id, (select auth.uid()))
      and public.is_valid_session_star_event(session_id, type, payload)
    )
  )
);

drop policy if exists "events_select_student_scope" on public.session_events;
create policy "events_select_student_scope" on public.session_events
for select to authenticated
using (
  type in ('star', 'star_undo')
  and exists (
    select 1
      from public.students student_row
     where (
       public.can_access_student(student_row.id, (select auth.uid()))
       or student_row.user_id = (select auth.uid())
       or exists (
         select 1
           from public.student_guardians guardian_row
          where guardian_row.student_id = student_row.id
            and guardian_row.guardian_id = (select auth.uid())
       )
     )
     and (
       (
         session_events.payload -> 'schemaVersion' = '2'::jsonb
         and session_events.payload ->> 'studentId' = student_row.id::text
       )
       or (
         (
           not (session_events.payload ? 'schemaVersion')
           or session_events.payload -> 'schemaVersion' = '1'::jsonb
         )
         and (
           (
             student_row.user_id is not null
             and session_events.payload ->> 'studentId' = student_row.user_id::text
           )
           or exists (
             select 1
               from public.session_roster_entries legacy_entry
              where legacy_entry.session_id = session_events.session_id
                and legacy_entry.student_id = student_row.id
                and legacy_entry.user_id is not null
                and session_events.payload ->> 'studentId' = legacy_entry.user_id::text
           )
         )
       )
     )
  )
);

-- Shared customer aggregate: legacy net count plus the v2 award set minus
-- its revocation set. Duplicate and reverse-order delivery converge.
create function public.student_star_total(p_student_id uuid)
returns integer
language sql security definer stable
set search_path = public, pg_temp
as $$
  with identity as (
    select student_row.id, student_row.user_id
      from public.students student_row
     where student_row.id = p_student_id
  ),
  legacy_targets as (
    select null::uuid as session_id, identity.user_id
      from identity
     where identity.user_id is not null
    union
    select distinct entry_row.session_id, entry_row.user_id
      from public.session_roster_entries entry_row
     where entry_row.student_id = p_student_id
       and entry_row.user_id is not null
  ),
  legacy as (
    select greatest(
      0,
      coalesce(sum(case when event_row.type = 'star' then 1 else -1 end), 0)
    )::integer as count
      from public.session_events event_row
     where event_row.type in ('star', 'star_undo')
       and (
         not (event_row.payload ? 'schemaVersion')
         or event_row.payload -> 'schemaVersion' = '1'::jsonb
       )
       and exists (
         select 1
           from legacy_targets target_row
          where (target_row.session_id is null or target_row.session_id = event_row.session_id)
            and event_row.payload ->> 'studentId' = target_row.user_id::text
       )
  ),
  awards as (
    select distinct event_row.session_id, event_row.payload ->> 'awardId' as award_id
      from public.session_events event_row
      cross join identity
     where event_row.type = 'star'
       and event_row.payload -> 'schemaVersion' = '2'::jsonb
       and event_row.payload ->> 'studentId' = identity.id::text
       and event_row.payload ->> 'awardId'
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  active_v2 as (
    select count(*)::integer as count
      from awards award_row
      cross join identity
     where not exists (
       select 1
         from public.session_events undo_row
        where undo_row.session_id = award_row.session_id
          and undo_row.type = 'star_undo'
          and undo_row.payload -> 'schemaVersion' = '2'::jsonb
          and undo_row.payload ->> 'studentId' = identity.id::text
          and undo_row.payload ->> 'awardId' = award_row.award_id
     )
  )
  select coalesce(legacy.count, 0) + coalesce(active_v2.count, 0)
    from legacy cross join active_v2;
$$;

revoke all on function public.student_star_total(uuid)
  from public, anon, authenticated;

-- Latest ten-column customer summary, with only the star expression replaced
-- by the stable-id, dual-read aggregate above.
drop function if exists public.get_my_learning_summary();
create function public.get_my_learning_summary()
returns table (
  student_id uuid,
  student_name text,
  grade smallint,
  next_session_at timestamptz,
  attendance_rate_30d numeric,
  recent_submissions jsonb,
  star_total int,
  payment_status text,
  week_session_count int,
  pending_assignment_count int
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  with my_students as (
    select student_row.id, student_row.name, student_row.grade, student_row.user_id
      from public.students student_row
     where student_row.user_id = auth.uid()
       and student_row.deleted_at is null
    union
    select student_row.id, student_row.name, student_row.grade, student_row.user_id
      from public.students student_row
      join public.student_guardians guardian_row
        on guardian_row.student_id = student_row.id
     where guardian_row.guardian_id = auth.uid()
       and student_row.deleted_at is null
  )
  select
    my_student.id,
    my_student.name,
    my_student.grade,
    (
      select min(session_row.scheduled_at)
        from public.class_sessions session_row
        join public.enrollments enrollment_row
          on enrollment_row.classroom_id = session_row.classroom_id
         and enrollment_row.status = 'active'
       where enrollment_row.student_id = my_student.id
         and session_row.scheduled_at >= now()
         and session_row.deleted_at is null
    ),
    (
      select case when count(*) = 0 then null
             else round(100.0 * count(*) filter (where attendance_row.status = 'present') / count(*), 1)
             end
        from public.session_attendance attendance_row
        join public.class_sessions session_row on session_row.id = attendance_row.session_id
       where attendance_row.student_id = my_student.id
         and session_row.scheduled_at >= now() - interval '30 days'
         and session_row.scheduled_at < now()
    ),
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'title', submission_row.title,
            'score', submission_row.score,
            'gradedAt', submission_row.graded_at
          ) order by submission_row.rank
        ),
        '[]'::jsonb
      )
        from (
          select assignment_row.title, submission.score, submission.graded_at,
                 row_number() over (
                   order by coalesce(submission.graded_at, submission.submitted_at) desc
                 ) as rank
            from public.submissions submission
            join public.assignments assignment_row on assignment_row.id = submission.assignment_id
           where my_student.user_id is not null
             and submission.user_id = my_student.user_id
        ) submission_row
       where submission_row.rank <= 5
    ),
    public.student_star_total(my_student.id),
    (
      select case
        when exists (
          select 1 from public.orders order_row
           where order_row.student_id = my_student.id
             and order_row.status in ('unpaid', 'partial')
        ) then 'overdue'
        when exists (
          select 1 from public.orders order_row
           where order_row.student_id = my_student.id
        ) then 'ok'
        else 'none'
      end
    ),
    (
      select count(*)::int
        from public.class_sessions session_row
        join public.enrollments enrollment_row
          on enrollment_row.classroom_id = session_row.classroom_id
         and enrollment_row.status = 'active'
       where enrollment_row.student_id = my_student.id
         and session_row.deleted_at is null
         and session_row.scheduled_at >= now()
         and session_row.scheduled_at < now() + interval '7 days'
    ),
    (
      select case when my_student.user_id is null then null else (
        select count(*)::int
          from public.assignments assignment_row
          join public.classroom_members member_row
            on member_row.classroom_id = assignment_row.classroom_id
           and member_row.user_id = my_student.user_id
           and member_row.role = 'student'
         where (assignment_row.due_at is null or assignment_row.due_at >= now())
           and not exists (
             select 1 from public.submissions submission
              where submission.assignment_id = assignment_row.id
                and submission.user_id = my_student.user_id
                and submission.submitted_at is not null
           )
      ) end
    )
  from my_students my_student;
$$;

revoke all on function public.get_my_learning_summary()
  from public, anon, authenticated;
grant execute on function public.get_my_learning_summary() to authenticated;

create or replace function public.organization_feature_keys()
returns text[] language sql immutable
as $$
  select array[
    'finance.enabled',
    'notifications.email',
    'notifications.sms',
    'notifications.wechat',
    'public_content.publish',
    'teaching.preparation_archive_edit',
    'teaching.classroom_board_checkpoint_v2',
    'teaching.classroom_input_v2',
    'teaching.classroom_h5_pointer_v1',
    'teaching.classroom_layout_v2'
  ]::text[]
$$;

insert into public.feature_flag_versions(
  organization_id, flag_key, version, enabled, effective_from, reason
)
select organization_row.id, 'teaching.classroom_layout_v2', 1, false, now(),
       'M4 fail-closed default'
  from public.organizations organization_row
 where organization_row.singleton_key = 1
on conflict do nothing;

comment on table public.session_roster_revisions is
  'Immutable per-session roster revisions created at start or explicit teacher refresh.';
comment on table public.session_roster_entries is
  'Enrollment-authoritative roster snapshot keyed by stable students.id; account mapping is nullable.';
comment on function public.refresh_session_roster(uuid, text) is
  'Refreshes the frozen roster only after a teacher confirms the exact currently observed source hash.';
comment on function public.is_valid_session_star_event(uuid, text, jsonb) is
  'Fail-closed RLS predicate for session-frozen v1/v2 star targets and payload versions.';

commit;
