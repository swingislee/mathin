-- DEV-SCHOOL-OPS-1 / Phase 2C: public-class events, reusable microcourses,
-- role-aware on-site records, printable roster assets, and deferred class links.
--
-- `activities(kind = 'public_class')` remains the public event. Its segments are
-- the actual trial lessons, group assessments, and parent talks. A segment links
-- directly to an existing microcourse lecture; it does not manufacture a temporary
-- classroom just to gain courseware. Confirming a family never creates a formal
-- class or enrollment. Class links are explicit, later conversion decisions.

begin;

alter table public.activities
  add column public_class_print_background_path text;

alter table public.activities
  add constraint activities_public_class_print_background_path_check check (
    public_class_print_background_path is null
    or char_length(public_class_print_background_path) between 1 and 500
  );

create table public.public_class_segments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  kind text not null check (kind in ('trial_lesson', 'group_assessment', 'parent_talk')),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  scheduled_at timestamptz not null,
  duration_min smallint not null check (duration_min between 1 and 600),
  room_id uuid references public.campus_rooms(id) on delete restrict,
  location text not null default '' check (char_length(location) <= 100),
  position smallint not null check (position between 1 and 100),
  primary_teacher_id uuid references public.profiles(id) on delete set null,
  assistant_teacher_id uuid references public.profiles(id) on delete set null,
  microcourse_course_id uuid references public.courses(id) on delete set null,
  microcourse_lecture_id uuid references public.course_lectures(id) on delete set null,
  print_background_path text check (
    print_background_path is null or char_length(print_background_path) between 1 and 500
  ),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_class_segments_distinct_teachers_check check (
    primary_teacher_id is null or assistant_teacher_id is null
    or primary_teacher_id <> assistant_teacher_id
  ),
  constraint public_class_segments_microcourse_pair_check check (
    (microcourse_course_id is null and microcourse_lecture_id is null)
    or (microcourse_course_id is not null and microcourse_lecture_id is not null)
  ),
  unique (activity_id, position),
  unique (id, activity_id)
);

create index public_class_segments_microcourse_idx
  on public.public_class_segments(microcourse_course_id, microcourse_lecture_id)
  where microcourse_lecture_id is not null;
create index public_class_segments_schedule_idx
  on public.public_class_segments(activity_id, scheduled_at, position);
create index public_class_segments_room_schedule_idx
  on public.public_class_segments(room_id, scheduled_at)
  where room_id is not null;

alter table public.activity_registrations
  add constraint activity_registrations_id_activity_unique unique (id, activity_id);

create table public.public_class_participant_records (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  segment_id uuid not null,
  registration_id uuid not null,
  student_presence text not null default 'expected'
    check (student_presence in ('expected', 'attended', 'late', 'absent', 'not_applicable')),
  guardian_presence text not null default 'not_applicable'
    check (guardian_presence in ('expected', 'attended', 'late', 'absent', 'not_applicable')),
  learning_observation text not null default '' check (char_length(learning_observation) <= 3000),
  assessment_summary text not null default '' check (char_length(assessment_summary) <= 3000),
  parent_feedback text not null default '' check (char_length(parent_feedback) <= 3000),
  recommendation text not null default '' check (char_length(recommendation) <= 3000),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (segment_id, activity_id)
    references public.public_class_segments(id, activity_id) on delete cascade,
  foreign key (registration_id, activity_id)
    references public.activity_registrations(id, activity_id) on delete cascade,
  unique (segment_id, registration_id)
);

create index public_class_participant_records_activity_idx
  on public.public_class_participant_records(activity_id, segment_id, updated_at desc);
create index public_class_participant_records_registration_idx
  on public.public_class_participant_records(registration_id, updated_at desc);

create table public.public_class_classroom_links (
  activity_id uuid not null references public.activities(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (activity_id, classroom_id)
);

create index public_class_classroom_links_classroom_idx
  on public.public_class_classroom_links(classroom_id, linked_at desc);

create table public.public_class_classroom_participants (
  activity_id uuid not null,
  classroom_id uuid not null,
  registration_id uuid not null,
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  primary key (activity_id, classroom_id, registration_id),
  foreign key (activity_id, classroom_id)
    references public.public_class_classroom_links(activity_id, classroom_id) on delete cascade,
  foreign key (registration_id, activity_id)
    references public.activity_registrations(id, activity_id) on delete cascade
);

create index public_class_classroom_participants_registration_idx
  on public.public_class_classroom_participants(registration_id, linked_at desc);

create trigger public_class_segments_set_updated_at
  before update on public.public_class_segments
  for each row execute function public.set_updated_at();
create trigger public_class_participant_records_set_updated_at
  before update on public.public_class_participant_records
  for each row execute function public.set_updated_at();

alter table public.public_class_segments enable row level security;
alter table public.public_class_participant_records enable row level security;
alter table public.public_class_classroom_links enable row level security;
alter table public.public_class_classroom_participants enable row level security;

create policy public_class_segments_staff_select
  on public.public_class_segments for select to authenticated
  using (public.is_staff((select auth.uid())));
create policy public_class_participant_records_staff_select
  on public.public_class_participant_records for select to authenticated
  using (public.is_staff((select auth.uid())));
create policy public_class_classroom_links_staff_select
  on public.public_class_classroom_links for select to authenticated
  using (public.is_staff((select auth.uid())));
create policy public_class_classroom_participants_staff_select
  on public.public_class_classroom_participants for select to authenticated
  using (public.is_staff((select auth.uid())));

revoke all on public.public_class_segments,
  public.public_class_participant_records,
  public.public_class_classroom_links,
  public.public_class_classroom_participants
  from public, anon, authenticated;
grant select on public.public_class_segments,
  public.public_class_participant_records,
  public.public_class_classroom_links,
  public.public_class_classroom_participants
  to authenticated;

create or replace function public.can_record_public_class(p_activity_id uuid, p_uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null and (
    public.is_admin(p_uid)
    or public.has_perm(p_uid, 'activity.manage')
    or public.has_perm(p_uid, 'activity.register')
    or public.has_perm(p_uid, 'review.write')
    or exists (
      select 1
        from public.public_class_segments segment
       where segment.activity_id = p_activity_id
         and p_uid in (segment.primary_teacher_id, segment.assistant_teacher_id)
    )
  )
$$;

revoke all on function public.can_record_public_class(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_record_public_class(uuid, uuid) to authenticated;

create or replace function public.seed_public_class_segment_records()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.public_class_participant_records(
    activity_id, segment_id, registration_id, student_presence, guardian_presence
  )
  select new.activity_id, new.id, registration.id,
         case when new.kind = 'parent_talk' then 'not_applicable' else 'expected' end,
         case when new.kind = 'parent_talk' then 'expected' else 'not_applicable' end
    from public.activity_registrations registration
   where registration.activity_id = new.activity_id
     and registration.status <> 'cancelled'
  on conflict (segment_id, registration_id) do nothing;
  return new;
end
$$;

create trigger public_class_segments_seed_records
  after insert on public.public_class_segments
  for each row execute function public.seed_public_class_segment_records();

create or replace function public.seed_public_class_registration_records()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'cancelled' and exists (
    select 1 from public.activities activity
     where activity.id = new.activity_id
       and activity.kind = 'public_class'
       and activity.deleted_at is null
  ) then
    insert into public.public_class_participant_records(
      activity_id, segment_id, registration_id, student_presence, guardian_presence
    )
    select new.activity_id, segment.id, new.id,
           case when segment.kind = 'parent_talk' then 'not_applicable' else 'expected' end,
           case when segment.kind = 'parent_talk' then 'expected' else 'not_applicable' end
      from public.public_class_segments segment
     where segment.activity_id = new.activity_id
    on conflict (segment_id, registration_id) do nothing;
  end if;
  return new;
end
$$;

create trigger activity_registrations_seed_public_class_records
  after insert or update of status on public.activity_registrations
  for each row execute function public.seed_public_class_registration_records();

create or replace function public.sync_confirmed_public_class_invitation()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id uuid;
begin
  if new.kind <> 'activity' or new.activity_id is null or not exists (
    select 1 from public.activities activity
     where activity.id = new.activity_id
       and activity.kind = 'public_class'
       and activity.deleted_at is null
  ) then
    return new;
  end if;

  select lead.student_id into v_student_id
    from public.leads lead where lead.id = new.lead_id;

  if new.state = 'confirmed' then
    if v_student_id is not null then
      insert into public.activity_registrations(
        activity_id, student_id, lead_id, status, operated_by
      ) values (
        new.activity_id, v_student_id, null, 'booked', new.updated_by
      )
      on conflict (activity_id, student_id) do update
        set status = 'booked', operated_by = excluded.operated_by;
    else
      insert into public.activity_registrations(
        activity_id, student_id, lead_id, status, operated_by
      ) values (
        new.activity_id, null, new.lead_id, 'booked', new.updated_by
      )
      on conflict (activity_id, lead_id) where lead_id is not null do update
        set status = 'booked', operated_by = excluded.operated_by;
    end if;
  elsif tg_op = 'UPDATE' and old.state = 'confirmed'
    and new.state in ('cancelled', 'waiting_activity') then
    update public.activity_registrations
       set status = 'cancelled', operated_by = new.updated_by
     where activity_id = old.activity_id
       and (student_id = v_student_id or lead_id = new.lead_id);
  end if;

  return new;
end
$$;

create trigger lead_invitation_threads_sync_public_class_registration
  after insert or update of kind, state, activity_id on public.lead_invitation_threads
  for each row execute function public.sync_confirmed_public_class_invitation();

create or replace function public.create_public_class_event(
  p_title text,
  p_scheduled_at timestamptz,
  p_location text default '',
  p_capacity smallint default null,
  p_remark text default '',
  p_segments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_activity_id uuid;
  v_segment record;
  v_position smallint := 0;
  v_segments jsonb := coalesce(p_segments, '[]'::jsonb);
begin
  if v_uid is null or not public.has_perm(v_uid, 'activity.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if btrim(coalesce(p_title, '')) = ''
     or char_length(btrim(p_title)) > 100
     or p_scheduled_at is null
     or p_capacity is not null and p_capacity not between 1 and 32767
     or char_length(coalesce(p_location, '')) > 100
     or char_length(coalesce(p_remark, '')) > 1000
     or jsonb_typeof(v_segments) <> 'array'
     or jsonb_array_length(v_segments) > 20 then
    raise exception 'INVALID_PUBLIC_CLASS';
  end if;

  insert into public.activities(
    kind, title, scheduled_at, duration_min, location, capacity, remark, created_by
  ) values (
    'public_class', btrim(p_title), p_scheduled_at, null,
    btrim(coalesce(p_location, '')), p_capacity, btrim(coalesce(p_remark, '')), v_uid
  ) returning id into v_activity_id;

  if jsonb_array_length(v_segments) = 0 then
    insert into public.public_class_segments(
      activity_id, kind, title, scheduled_at, duration_min, location,
      position, created_by, updated_by
    ) values (
      v_activity_id, 'trial_lesson', '体验课', p_scheduled_at, 60,
      btrim(coalesce(p_location, '')), 1, v_uid, v_uid
    );
  else
    for v_segment in
      select * from jsonb_to_recordset(v_segments) as item(
        kind text, title text, scheduled_at timestamptz, duration_min smallint,
        room_id uuid, location text, primary_teacher_id uuid, assistant_teacher_id uuid
      )
    loop
      v_position := v_position + 1;
      if v_segment.kind not in ('trial_lesson', 'group_assessment', 'parent_talk')
         or btrim(coalesce(v_segment.title, '')) = ''
         or char_length(btrim(v_segment.title)) > 100
         or v_segment.scheduled_at is null
         or v_segment.duration_min is null or v_segment.duration_min not between 1 and 600
         or char_length(coalesce(v_segment.location, '')) > 100
         or v_segment.primary_teacher_id is not null and v_segment.assistant_teacher_id = v_segment.primary_teacher_id
         or v_segment.room_id is not null and not exists (
           select 1 from public.campus_rooms room
            where room.id = v_segment.room_id and room.status = 'active'
         ) then
        raise exception 'INVALID_PUBLIC_CLASS_SEGMENT';
      end if;
      insert into public.public_class_segments(
        activity_id, kind, title, scheduled_at, duration_min, room_id, location,
        position, primary_teacher_id, assistant_teacher_id, created_by, updated_by
      ) values (
        v_activity_id, v_segment.kind, btrim(v_segment.title), v_segment.scheduled_at,
        v_segment.duration_min, v_segment.room_id, btrim(coalesce(v_segment.location, '')),
        v_position, v_segment.primary_teacher_id, v_segment.assistant_teacher_id, v_uid, v_uid
      );
    end loop;
  end if;

  perform public.emit_domain_event(
    'public_class.created', 'activity', v_activity_id,
    jsonb_build_object('segmentCount', greatest(jsonb_array_length(v_segments), 1)),
    null, null
  );
  return v_activity_id;
end
$$;

create or replace function public.save_public_class_segment(
  p_activity_id uuid,
  p_segment_id uuid,
  p_kind text,
  p_title text,
  p_scheduled_at timestamptz,
  p_duration_min smallint,
  p_room_id uuid default null,
  p_location text default '',
  p_primary_teacher_id uuid default null,
  p_assistant_teacher_id uuid default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_segment_id uuid;
  v_position smallint;
begin
  if v_uid is null or not public.has_perm(v_uid, 'activity.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.activities activity
     where activity.id = p_activity_id and activity.kind = 'public_class'
       and activity.deleted_at is null
  ) then raise exception 'PUBLIC_CLASS_NOT_FOUND'; end if;
  if p_kind not in ('trial_lesson', 'group_assessment', 'parent_talk')
     or btrim(coalesce(p_title, '')) = '' or char_length(btrim(p_title)) > 100
     or p_scheduled_at is null or p_duration_min not between 1 and 600
     or char_length(coalesce(p_location, '')) > 100
     or p_primary_teacher_id is not null and p_primary_teacher_id = p_assistant_teacher_id
     or p_room_id is not null and not exists (
       select 1 from public.campus_rooms room
        where room.id = p_room_id and room.status = 'active'
     ) then
    raise exception 'INVALID_PUBLIC_CLASS_SEGMENT';
  end if;

  if p_segment_id is null then
    select (coalesce(max(position), 0) + 1)::smallint into v_position
      from public.public_class_segments where activity_id = p_activity_id;
    insert into public.public_class_segments(
      activity_id, kind, title, scheduled_at, duration_min, room_id, location,
      position, primary_teacher_id, assistant_teacher_id, created_by, updated_by
    ) values (
      p_activity_id, p_kind, btrim(p_title), p_scheduled_at, p_duration_min,
      p_room_id, btrim(coalesce(p_location, '')), v_position,
      p_primary_teacher_id, p_assistant_teacher_id, v_uid, v_uid
    ) returning id into v_segment_id;
  else
    update public.public_class_segments
       set kind = p_kind,
           title = btrim(p_title),
           scheduled_at = p_scheduled_at,
           duration_min = p_duration_min,
           room_id = p_room_id,
           location = btrim(coalesce(p_location, '')),
           primary_teacher_id = p_primary_teacher_id,
           assistant_teacher_id = p_assistant_teacher_id,
           updated_by = v_uid
     where id = p_segment_id and activity_id = p_activity_id
     returning id into v_segment_id;
    if v_segment_id is null then raise exception 'PUBLIC_CLASS_SEGMENT_NOT_FOUND'; end if;
  end if;

  update public.activities activity
     set scheduled_at = source.first_at,
         location = case when activity.location = '' then source.first_location else activity.location end
    from (
      select scheduled_at as first_at, location as first_location
        from public.public_class_segments
       where activity_id = p_activity_id
       order by scheduled_at, position limit 1
    ) source
   where activity.id = p_activity_id;

  perform public.emit_domain_event(
    'public_class.segment.saved', 'public_class_segment', v_segment_id,
    jsonb_build_object('activityId', p_activity_id, 'kind', p_kind), null, null
  );
  return v_segment_id;
end
$$;

create or replace function public.delete_public_class_segment(p_segment_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_activity_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'activity.manage') then
    raise exception 'FORBIDDEN';
  end if;
  select activity_id into v_activity_id
    from public.public_class_segments where id = p_segment_id for update;
  if v_activity_id is null then raise exception 'PUBLIC_CLASS_SEGMENT_NOT_FOUND'; end if;
  if (select count(*) from public.public_class_segments where activity_id = v_activity_id) <= 1 then
    raise exception 'PUBLIC_CLASS_REQUIRES_SEGMENT';
  end if;
  delete from public.public_class_segments where id = p_segment_id;
end
$$;

create or replace function public.save_public_class_participant_record(
  p_segment_id uuid,
  p_registration_id uuid,
  p_student_presence text,
  p_guardian_presence text,
  p_learning_observation text default '',
  p_assessment_summary text default '',
  p_parent_feedback text default '',
  p_recommendation text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_activity_id uuid;
  v_record_id uuid;
begin
  select segment.activity_id into v_activity_id
    from public.public_class_segments segment
    join public.activity_registrations registration
      on registration.activity_id = segment.activity_id
     and registration.id = p_registration_id
   where segment.id = p_segment_id;
  if v_activity_id is null then raise exception 'PUBLIC_CLASS_RECORD_NOT_FOUND'; end if;
  if not public.can_record_public_class(v_activity_id, v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_student_presence not in ('expected', 'attended', 'late', 'absent', 'not_applicable')
     or p_guardian_presence not in ('expected', 'attended', 'late', 'absent', 'not_applicable')
     or char_length(coalesce(p_learning_observation, '')) > 3000
     or char_length(coalesce(p_assessment_summary, '')) > 3000
     or char_length(coalesce(p_parent_feedback, '')) > 3000
     or char_length(coalesce(p_recommendation, '')) > 3000 then
    raise exception 'INVALID_PUBLIC_CLASS_RECORD';
  end if;

  insert into public.public_class_participant_records(
    activity_id, segment_id, registration_id, student_presence, guardian_presence,
    learning_observation, assessment_summary, parent_feedback, recommendation, updated_by
  ) values (
    v_activity_id, p_segment_id, p_registration_id, p_student_presence, p_guardian_presence,
    btrim(coalesce(p_learning_observation, '')), btrim(coalesce(p_assessment_summary, '')),
    btrim(coalesce(p_parent_feedback, '')), btrim(coalesce(p_recommendation, '')), v_uid
  )
  on conflict (segment_id, registration_id) do update
    set student_presence = excluded.student_presence,
        guardian_presence = excluded.guardian_presence,
        learning_observation = excluded.learning_observation,
        assessment_summary = excluded.assessment_summary,
        parent_feedback = excluded.parent_feedback,
        recommendation = excluded.recommendation,
        updated_by = excluded.updated_by
  returning id into v_record_id;

  if p_student_presence in ('attended', 'late')
     or p_guardian_presence in ('attended', 'late')
     or btrim(coalesce(p_learning_observation, '')) <> ''
     or btrim(coalesce(p_assessment_summary, '')) <> '' then
    update public.activity_registrations
       set status = 'attended', operated_by = v_uid
     where id = p_registration_id and status <> 'cancelled';
  end if;

  perform public.emit_domain_event(
    'public_class.participant.saved', 'activity_registration', p_registration_id,
    jsonb_build_object('activityId', v_activity_id, 'segmentId', p_segment_id), null, null
  );
  return v_record_id;
end
$$;

create or replace function public.save_public_class_registration_status(
  p_registration_id uuid,
  p_status text,
  p_outcome text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_activity_id uuid;
begin
  select registration.activity_id into v_activity_id
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id
     and activity.kind = 'public_class' and activity.deleted_at is null;
  if v_activity_id is null then raise exception 'PUBLIC_CLASS_RECORD_NOT_FOUND'; end if;
  if not public.can_record_public_class(v_activity_id, v_uid) then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('booked', 'attended', 'no_show', 'cancelled')
     or char_length(coalesce(p_outcome, '')) > 1000 then
    raise exception 'INVALID_PUBLIC_CLASS_RECORD';
  end if;
  update public.activity_registrations
     set status = p_status, outcome = btrim(coalesce(p_outcome, '')), operated_by = v_uid
   where id = p_registration_id;
end
$$;

create or replace function public.link_public_classroom(
  p_activity_id uuid,
  p_classroom_id uuid
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_perm(v_uid, 'class.manage')
     or not public.can_manage_classroom(p_classroom_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.activities activity
     where activity.id = p_activity_id and activity.kind = 'public_class'
       and activity.deleted_at is null
  ) then raise exception 'PUBLIC_CLASS_NOT_FOUND'; end if;
  insert into public.public_class_classroom_links(activity_id, classroom_id, linked_by)
  values (p_activity_id, p_classroom_id, v_uid)
  on conflict (activity_id, classroom_id) do nothing;
  perform public.emit_domain_event(
    'public_class.classroom.linked', 'activity', p_activity_id,
    jsonb_build_object('classroomId', p_classroom_id), null, null
  );
end
$$;

create or replace function public.unlink_public_classroom(
  p_activity_id uuid,
  p_classroom_id uuid
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_perm(v_uid, 'class.manage')
     or not public.can_manage_classroom(p_classroom_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.public_class_classroom_links
   where activity_id = p_activity_id and classroom_id = p_classroom_id;
end
$$;

create or replace function public.sync_public_classroom_candidates(
  p_activity_id uuid,
  p_classroom_id uuid,
  p_registration_ids uuid[]
)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[] := coalesce(p_registration_ids, '{}'::uuid[]);
  v_count integer;
begin
  if v_uid is null or not public.has_perm(v_uid, 'class.manage')
     or not public.can_manage_classroom(p_classroom_id, v_uid)
     or not exists (
       select 1 from public.public_class_classroom_links link
        where link.activity_id = p_activity_id and link.classroom_id = p_classroom_id
     ) then raise exception 'FORBIDDEN'; end if;
  if exists (
    select 1 from unnest(v_ids) as requested(registration_id)
     where not exists (
       select 1 from public.activity_registrations registration
        where registration.id = requested.registration_id
          and registration.activity_id = p_activity_id
          and registration.status <> 'cancelled'
          and registration.student_id is not null
     )
  ) then raise exception 'INVALID_PUBLIC_CLASS_CANDIDATE'; end if;

  delete from public.public_class_classroom_participants candidate
   where candidate.activity_id = p_activity_id
     and candidate.classroom_id = p_classroom_id
     and not (candidate.registration_id = any(v_ids));
  insert into public.public_class_classroom_participants(
    activity_id, classroom_id, registration_id, linked_by
  )
  select p_activity_id, p_classroom_id, requested.registration_id, v_uid
    from unnest(v_ids) as requested(registration_id)
  on conflict (activity_id, classroom_id, registration_id) do nothing;
  select count(*) into v_count
    from public.public_class_classroom_participants
   where activity_id = p_activity_id and classroom_id = p_classroom_id;
  return v_count;
end
$$;

create or replace function public.link_public_class_segment_microcourse(
  p_segment_id uuid,
  p_course_id uuid,
  p_lecture_id uuid
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.has_perm(v_uid, 'activity.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.public_class_segments segment
    join public.activities activity on activity.id = segment.activity_id
    where segment.id = p_segment_id and activity.kind = 'public_class'
      and activity.deleted_at is null
  ) then raise exception 'PUBLIC_CLASS_SEGMENT_NOT_FOUND'; end if;
  if (p_course_id is null) <> (p_lecture_id is null) then
    raise exception 'INVALID_MICROCOURSE_SELECTION';
  end if;
  if p_course_id is not null and not exists (
    select 1 from public.courses course
    join public.course_families family on family.id = course.family_id
    join public.course_lectures lecture
      on lecture.id = p_lecture_id and lecture.course_id = course.id
    where course.id = p_course_id and course.course_kind = 'microcourse'
      and course.trashed_at is null and family.slug = 'teacher-microcourses'
      and lecture.status <> 'archived'
  ) then raise exception 'INVALID_MICROCOURSE_SELECTION'; end if;
  update public.public_class_segments
     set microcourse_course_id = p_course_id,
         microcourse_lecture_id = p_lecture_id,
         updated_by = v_uid
   where id = p_segment_id;
  perform public.emit_domain_event(
    'public_class.microcourse.selected', 'public_class_segment', p_segment_id,
    jsonb_build_object('courseId', p_course_id, 'lectureId', p_lecture_id), null, null
  );
end
$$;

-- Existing one-off public classes become one-segment events. The first public
-- class workbench therefore opens without requiring a manual data repair.
insert into public.public_class_segments(
  activity_id, kind, title, scheduled_at, duration_min, location,
  position, created_by, updated_by
)
select activity.id, 'trial_lesson', activity.title, activity.scheduled_at,
       coalesce(activity.duration_min, 60), activity.location,
       1, activity.created_by, activity.created_by
  from public.activities activity
 where activity.kind = 'public_class' and activity.deleted_at is null
   and not exists (
     select 1 from public.public_class_segments segment
      where segment.activity_id = activity.id
   );

-- Materialize already-confirmed activity invitations into the event roster.
insert into public.activity_registrations(
  activity_id, student_id, lead_id, status, operated_by
)
select invitation.activity_id, lead.student_id, null, 'booked', invitation.updated_by
from public.lead_invitation_threads invitation
join public.activities activity on activity.id = invitation.activity_id
join public.leads lead on lead.id = invitation.lead_id
where invitation.kind = 'activity' and invitation.state = 'confirmed'
  and activity.kind = 'public_class' and activity.deleted_at is null
  and lead.student_id is not null
on conflict (activity_id, student_id) do update
set status = 'booked', operated_by = excluded.operated_by;

insert into public.activity_registrations(
  activity_id, student_id, lead_id, status, operated_by
)
select invitation.activity_id, null, invitation.lead_id, 'booked', invitation.updated_by
from public.lead_invitation_threads invitation
join public.activities activity on activity.id = invitation.activity_id
join public.leads lead on lead.id = invitation.lead_id
where invitation.kind = 'activity' and invitation.state = 'confirmed'
  and activity.kind = 'public_class' and activity.deleted_at is null
  and lead.student_id is null
on conflict (activity_id, lead_id) where lead_id is not null do update
set status = 'booked', operated_by = excluded.operated_by;

revoke all on function public.seed_public_class_segment_records() from public, anon, authenticated;
revoke all on function public.seed_public_class_registration_records() from public, anon, authenticated;
revoke all on function public.sync_confirmed_public_class_invitation() from public, anon, authenticated;
revoke all on function public.create_public_class_event(text,timestamptz,text,smallint,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.save_public_class_segment(uuid,uuid,text,text,timestamptz,smallint,uuid,text,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.delete_public_class_segment(uuid) from public, anon, authenticated;
revoke all on function public.save_public_class_participant_record(uuid,uuid,text,text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.save_public_class_registration_status(uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.link_public_classroom(uuid,uuid) from public, anon, authenticated;
revoke all on function public.unlink_public_classroom(uuid,uuid) from public, anon, authenticated;
revoke all on function public.sync_public_classroom_candidates(uuid,uuid,uuid[])
  from public, anon, authenticated;
revoke all on function public.link_public_class_segment_microcourse(uuid,uuid,uuid)
  from public, anon, authenticated;

grant execute on function public.create_public_class_event(text,timestamptz,text,smallint,text,jsonb)
  to authenticated;
grant execute on function public.save_public_class_segment(uuid,uuid,text,text,timestamptz,smallint,uuid,text,uuid,uuid)
  to authenticated;
grant execute on function public.delete_public_class_segment(uuid) to authenticated;
grant execute on function public.save_public_class_participant_record(uuid,uuid,text,text,text,text,text,text)
  to authenticated;
grant execute on function public.save_public_class_registration_status(uuid,text,text)
  to authenticated;
grant execute on function public.link_public_classroom(uuid,uuid) to authenticated;
grant execute on function public.unlink_public_classroom(uuid,uuid) to authenticated;
grant execute on function public.sync_public_classroom_candidates(uuid,uuid,uuid[])
  to authenticated;
grant execute on function public.link_public_class_segment_microcourse(uuid,uuid,uuid)
  to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
