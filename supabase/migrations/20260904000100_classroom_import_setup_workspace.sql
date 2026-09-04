-- DATA-IMPORT-CLASS-ROSTER-8: an imported class shell is completed as one
-- teaching setup, not through unrelated profile/staff/session dialogs.
-- Preserve the source scheduling facts, expose one scoped read model, and
-- atomically bind course + lead teacher + room + generated sessions.

begin;

alter table public.class_roster_source_mappings
  add column if not exists setup_source_batch_id uuid
    references public.data_import_batches(id) on delete set null,
  add column if not exists source_context jsonb not null default '{}'::jsonb,
  add column if not exists setup_review_issues text[] not null default '{}'::text[],
  add column if not exists setup_completed_at timestamptz,
  add column if not exists setup_completed_by uuid references public.profiles(id) on delete set null;

alter table public.class_roster_source_mappings
  drop constraint if exists class_roster_source_mappings_source_context_object;
alter table public.class_roster_source_mappings
  add constraint class_roster_source_mappings_source_context_object
  check (jsonb_typeof(source_context) = 'object');

alter table public.class_roster_source_mappings
  drop constraint if exists class_roster_source_mappings_setup_review_issues_check;
alter table public.class_roster_source_mappings
  add constraint class_roster_source_mappings_setup_review_issues_check
  check (setup_review_issues <@ array['course', 'teacher', 'room', 'schedule']::text[]);

-- Older completed batches discarded `defaultClass` after creating the shell.
-- Their stable source key still contains the original weekday/schedule, so
-- retain that key as a fallback context instead of inventing new defaults.
with created as (
  select
    item.batch_id,
    nullif(item.payload->>'classroomId', '')::uuid as classroom_id,
    item.payload->>'sourceClassKey' as source_class_key,
    min(coalesce(item.payload->>'sourceClassLabel', '')) as source_label,
    array_remove(array[
      case when bool_or('CLASS_NEEDS_COURSE' = any(item.error_codes)) then 'course' end,
      case when bool_or('CLASS_NEEDS_TEACHER' = any(item.error_codes)) then 'teacher' end,
      case when bool_or('CLASS_NEEDS_ROOM' = any(item.error_codes)) then 'room' end,
      case when bool_or('CLASS_NEEDS_SCHEDULE' = any(item.error_codes)) then 'schedule' end
    ], null)::text[] as review_issues
  from public.data_import_rows item
  where 'CREATED_DEFAULT_CLASS' = any(item.error_codes)
    and nullif(item.payload->>'classroomId', '') is not null
  group by item.batch_id, nullif(item.payload->>'classroomId', '')::uuid,
    item.payload->>'sourceClassKey'
)
update public.class_roster_source_mappings mapping
   set setup_source_batch_id = created.batch_id,
       source_context = case
         when mapping.source_context = '{}'::jsonb then jsonb_build_object(
           'sourceClassKey', created.source_class_key,
           'sourceClassLabel', created.source_label
         )
         else mapping.source_context
       end,
       setup_review_issues = created.review_issues
  from created
 where mapping.source_system = 'mofaxiao'
   and mapping.source_class_key = created.source_class_key
   and mapping.classroom_id = created.classroom_id;

create or replace function public.get_classroom_import_setup_context_v2(p_classroom_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_mapping public.class_roster_source_mappings%rowtype;
  v_classroom public.classrooms%rowtype;
  v_review_issues text[];
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_classroom from public.classrooms where id = p_classroom_id;
  if v_classroom.id is null then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not public.can_manage_classroom(p_classroom_id, v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;

  select * into v_mapping
    from public.class_roster_source_mappings mapping
   where mapping.classroom_id = p_classroom_id
     and mapping.source_system = 'mofaxiao'
   order by mapping.updated_at desc, mapping.created_at desc
   limit 1;
  if v_mapping.classroom_id is null then return null; end if;

  v_review_issues := case when v_mapping.setup_completed_at is not null then '{}'::text[] else
    array_remove(array[
      case when 'course' = any(v_mapping.setup_review_issues)
             and v_classroom.course_id is null then 'course' end,
      case when 'teacher' = any(v_mapping.setup_review_issues) then 'teacher' end,
      case when 'room' = any(v_mapping.setup_review_issues)
             and v_classroom.default_room_id is null then 'room' end,
      case when 'schedule' = any(v_mapping.setup_review_issues)
             and not exists (
               select 1 from public.class_sessions session_row
                where session_row.classroom_id = p_classroom_id
             ) then 'schedule' end
    ], null)::text[] end;

  return jsonb_build_object(
    'sourceSystem', v_mapping.source_system,
    'sourceClassKey', v_mapping.source_class_key,
    'sourceLabel', v_mapping.source_label,
    'sourceContext', v_mapping.source_context,
    'reviewIssues', to_jsonb(v_review_issues),
    'completedAt', v_mapping.setup_completed_at
  );
end
$$;

create or replace function public.complete_classroom_setup_v2(
  p_classroom_id uuid,
  p_name text,
  p_capacity smallint,
  p_course_id uuid,
  p_room_id uuid,
  p_primary_teacher_id uuid,
  p_sessions jsonb default '[]'::jsonb,
  p_expected_session_count integer default 0
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_classroom public.classrooms%rowtype;
  v_course public.courses%rowtype;
  v_old_primary uuid;
  v_session_count integer;
  v_active_lecture_count integer;
  v_input_count integer;
  v_distinct_lecture_count integer;
  v_matched_lecture_count integer;
  v_created_count integer := 0;
  v_input record;
  v_session_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'class.manage') then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_classroom
    from public.classrooms
   where id = p_classroom_id
   for update;
  if v_classroom.id is null then raise exception 'CLASSROOM_NOT_FOUND'; end if;
  if not public.can_manage_classroom(p_classroom_id, v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if v_classroom.trashed_at is not null then raise exception 'CLASSROOM_TRASHED'; end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or char_length(btrim(p_name)) > 100 then
    raise exception 'INVALID_NAME';
  end if;
  if p_capacity is not null and p_capacity not between 1 and 500 then
    raise exception 'INVALID_CAPACITY';
  end if;
  if v_classroom.term_id is null or not exists (
    select 1 from public.school_terms term where term.id = v_classroom.term_id
  ) then raise exception 'INVALID_CLASSROOM_TERM'; end if;

  select course.* into v_course
    from public.courses course
    join public.course_families family on family.id = course.family_id
   where course.id = p_course_id
     and course.status = 'enabled'
     and course.trashed_at is null
     and course.purpose = v_classroom.purpose
     and family.status = 'enabled'
     and family.purpose = v_classroom.purpose;
  if v_course.id is null then raise exception 'COURSE_NOT_AVAILABLE'; end if;

  if not exists (
    select 1 from public.profiles profile
     where profile.id = p_primary_teacher_id
       and profile.is_active and profile.role in ('staff', 'admin')
  ) then raise exception 'INVALID_STAFF'; end if;
  if not exists (
    select 1 from public.campus_rooms room
    join public.campuses campus on campus.id = room.campus_id
     where room.id = p_room_id and room.status = 'active' and campus.status = 'active'
  ) then raise exception 'INVALID_ROOM'; end if;
  if jsonb_typeof(coalesce(p_sessions, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) > 200 then
    raise exception 'INVALID_SCHEDULE';
  end if;

  select count(*) into v_session_count
    from public.class_sessions session_row
   where session_row.classroom_id = p_classroom_id;
  if v_session_count <> coalesce(p_expected_session_count, -1) then
    raise exception 'CLASSROOM_SETUP_STALE';
  end if;
  if v_session_count > 0 and v_classroom.course_id is distinct from p_course_id then
    raise exception 'CLASSROOM_HAS_SESSIONS';
  end if;

  select count(*) into v_active_lecture_count
    from public.course_lectures lecture
   where lecture.course_id = p_course_id and lecture.status = 'active';
  if v_active_lecture_count not between 1 and 200 then raise exception 'INVALID_SCHEDULE'; end if;

  if v_session_count = 0 then
    select count(*), count(distinct input.lecture_id), count(lecture.id)
      into v_input_count, v_distinct_lecture_count, v_matched_lecture_count
      from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
        as input(lecture_id uuid, scheduled_at timestamptz, duration_min smallint, closed_day_reason text)
      left join public.course_lectures lecture
        on lecture.id = input.lecture_id
       and lecture.course_id = p_course_id
       and lecture.status = 'active'
     where input.scheduled_at is not null
       and input.duration_min between 1 and 600;
    if v_input_count <> v_active_lecture_count
       or v_distinct_lecture_count <> v_active_lecture_count
       or v_matched_lecture_count <> v_active_lecture_count then
      raise exception 'INVALID_SCHEDULE';
    end if;
    perform public.validate_class_build_calendar_sessions_v2(p_room_id, p_sessions);
  elsif jsonb_array_length(coalesce(p_sessions, '[]'::jsonb)) <> 0 then
    raise exception 'CLASSROOM_HAS_SESSIONS';
  end if;

  select assignment.user_id into v_old_primary
    from public.classroom_staff_assignments assignment
   where assignment.classroom_id = p_classroom_id
     and assignment.responsibility = 'primary_teacher'
   for update;

  delete from public.classroom_staff_assignments assignment
   where assignment.classroom_id = p_classroom_id
     and assignment.responsibility = 'primary_teacher'
     and assignment.user_id <> p_primary_teacher_id;
  delete from public.classroom_staff_assignments assignment
   where assignment.classroom_id = p_classroom_id
     and assignment.responsibility = 'learning_support'
     and assignment.user_id = p_primary_teacher_id;
  insert into public.classroom_staff_assignments (
    classroom_id, user_id, responsibility, created_by
  ) values (
    p_classroom_id, p_primary_teacher_id, 'primary_teacher', v_uid
  ) on conflict (classroom_id, user_id, responsibility) do nothing;
  insert into public.classroom_members (classroom_id, user_id, role)
  values (p_classroom_id, p_primary_teacher_id, 'teacher')
  on conflict (classroom_id, user_id) do update set role = 'teacher';

  if v_old_primary is not null and v_old_primary <> p_primary_teacher_id
     and not exists (
       select 1 from public.classroom_staff_assignments assignment
        where assignment.classroom_id = p_classroom_id
          and assignment.user_id = v_old_primary
          and assignment.responsibility in ('primary_teacher', 'assistant_teacher')
     ) then
    delete from public.classroom_members member
     where member.classroom_id = p_classroom_id
       and member.user_id = v_old_primary
       and member.role = 'teacher';
  end if;

  update public.classrooms
     set name = btrim(p_name),
         course_id = p_course_id,
         grade = v_course.grade,
         capacity = p_capacity,
         default_room_id = p_room_id,
         owner_id = p_primary_teacher_id
   where id = p_classroom_id;
  update public.class_sessions session_row
     set room_id = p_room_id
   where session_row.classroom_id = p_classroom_id
     and session_row.room_assignment_origin = 'class_default'
     and session_row.deleted_at is null
     and session_row.cancelled_by is null
     and session_row.voided_at is null
     and session_row.started_at is null
     and session_row.ended_at is null;

  if v_session_count = 0 then
    for v_input in
      select input.lecture_id, input.scheduled_at, input.duration_min,
             coalesce(input.closed_day_reason, '') as closed_day_reason,
             lecture.no, lecture.name
        from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
          as input(lecture_id uuid, scheduled_at timestamptz, duration_min smallint, closed_day_reason text)
        join public.course_lectures lecture
          on lecture.id = input.lecture_id
         and lecture.course_id = p_course_id
         and lecture.status = 'active'
       order by lecture.no, lecture.id
    loop
      insert into public.class_sessions (
        classroom_id, lecture_id, lecture_no, title, scheduled_at, duration_min,
        term_id, room_id, room_assignment_origin, courseware, courseware_overlay
      ) values (
        p_classroom_id, v_input.lecture_id, v_input.no, v_input.name,
        v_input.scheduled_at, v_input.duration_min, v_classroom.term_id,
        p_room_id, 'class_default', '[]'::jsonb, '[]'::jsonb
      ) returning id into v_session_id;
      v_created_count := v_created_count + 1;
      perform public.emit_domain_event(
        'session.schedule.created', 'class_session', v_session_id,
        jsonb_build_object('classroomId', p_classroom_id, 'source', 'classroom_setup'), null, null
      );
    end loop;
    perform public.emit_class_build_closed_day_events_v2(p_classroom_id, p_room_id, p_sessions);
  end if;

  update public.class_roster_source_mappings mapping
     set setup_completed_at = now(),
         setup_completed_by = v_uid,
         updated_by = v_uid,
         updated_at = now()
   where mapping.classroom_id = p_classroom_id
     and cardinality(mapping.setup_review_issues) > 0;

  perform public.emit_domain_event(
    'classroom.setup.completed', 'classroom', p_classroom_id,
    jsonb_build_object(
      'courseId', p_course_id,
      'primaryTeacherId', p_primary_teacher_id,
      'roomId', p_room_id,
      'createdSessions', v_created_count,
      'source', case when exists (
        select 1 from public.class_roster_source_mappings mapping
         where mapping.classroom_id = p_classroom_id
           and mapping.setup_completed_at is not null
      ) then 'import_repair' else 'class_setup' end
    ), p_primary_teacher_id, null
  );

  return jsonb_build_object(
    'classroomId', p_classroom_id,
    'createdSessions', v_created_count,
    'totalSessions', v_session_count + v_created_count
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'INVALID_SCHEDULE';
end
$$;

-- Keep the completed import result live: once the atomic setup succeeds, the
-- old import batch no longer advertises a stale "needs review" class.
create or replace function public.get_mofaxiao_class_roster_import_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_created_classes jsonb;
begin
  v_result := mathin_internal.get_mofaxiao_class_roster_import_batch_base(p_batch_id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', created.classroom_id,
    'name', created.classroom_name,
    'sourceClassKey', created.source_class_key,
    'reviewIssues', to_jsonb(created.review_issues)
  ) order by created.classroom_name, created.classroom_id), '[]'::jsonb)
  into v_created_classes
  from (
    select
      nullif(item.payload->>'classroomId', '')::uuid as classroom_id,
      classroom.name as classroom_name,
      item.payload->>'sourceClassKey' as source_class_key,
      case when mapping.setup_completed_at is not null then '{}'::text[] else array_remove(array[
        case when bool_or('CLASS_NEEDS_COURSE' = any(item.error_codes))
                   and classroom.course_id is null then 'course' end,
        case when bool_or('CLASS_NEEDS_TEACHER' = any(item.error_codes)) then 'teacher' end,
        case when bool_or('CLASS_NEEDS_ROOM' = any(item.error_codes))
                   and classroom.default_room_id is null then 'room' end,
        case when bool_or('CLASS_NEEDS_SCHEDULE' = any(item.error_codes))
                   and not exists (
                     select 1 from public.class_sessions session_row
                      where session_row.classroom_id = classroom.id
                   ) then 'schedule' end
      ], null)::text[] end as review_issues
    from public.data_import_rows item
    join public.classrooms classroom
      on classroom.id = nullif(item.payload->>'classroomId', '')::uuid
    left join public.class_roster_source_mappings mapping
      on mapping.source_system = 'mofaxiao'
     and mapping.source_class_key = item.payload->>'sourceClassKey'
     and mapping.classroom_id = classroom.id
    where item.batch_id = p_batch_id
      and 'CREATED_DEFAULT_CLASS' = any(item.error_codes)
    group by nullif(item.payload->>'classroomId', '')::uuid,
      classroom.id, classroom.name, classroom.course_id, classroom.default_room_id,
      item.payload->>'sourceClassKey', mapping.setup_completed_at
  ) created;
  return v_result || jsonb_build_object('createdClasses', v_created_classes);
end
$$;

-- Preserve the exact default-class object before the legacy apply core clears
-- it from row payloads. This wrapper retains the existing class-type mapping
-- contract and adds only import setup provenance after the atomic apply.
create or replace function public.apply_mofaxiao_class_roster_import(p_batch_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_batch public.data_import_batches%rowtype;
  v_contexts jsonb := '{}'::jsonb;
begin
  if v_uid is null or not public.has_perm(v_uid, 'enrollment.manage') then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_batch
    from public.data_import_batches
   where id = p_batch_id
   for update;
  if v_batch.id is null
     or v_batch.import_kind <> 'enrollments'
     or v_batch.template_version <> 'mofaxiao-class-roster-v1'
     or v_batch.source_system is distinct from 'mofaxiao' then
    raise exception 'BATCH_NOT_FOUND';
  end if;
  if v_batch.created_by <> v_uid and not public.is_admin(v_uid) then
    raise exception 'FORBIDDEN';
  end if;

  if v_batch.status <> 'completed' then
    update public.data_import_rows item
       set payload = jsonb_set(
         jsonb_set(
           item.payload,
           '{defaultClass,businessClassType}',
           to_jsonb(item.payload #>> '{defaultClass,classType}'),
           true
         ),
         '{defaultClass,classType}',
         to_jsonb(coalesce(
           nullif(item.payload #>> '{defaultClass,courseClassType}', ''),
           item.payload #>> '{defaultClass,classType}'
         )),
         true
       )
     where item.batch_id = v_batch.id
       and item.row_status = 'valid'
       and jsonb_typeof(item.payload->'defaultClass') = 'object';

    select coalesce(jsonb_object_agg(context.source_class_key, context.default_class), '{}'::jsonb)
      into v_contexts
      from (
        select distinct on (item.payload->>'sourceClassKey')
          item.payload->>'sourceClassKey' as source_class_key,
          item.payload->'defaultClass' as default_class
        from public.data_import_rows item
        where item.batch_id = v_batch.id
          and item.row_status = 'valid'
          and jsonb_typeof(item.payload->'defaultClass') = 'object'
        order by item.payload->>'sourceClassKey', item.row_no
      ) context;
  end if;

  perform mathin_internal.apply_mofaxiao_class_roster_import_class_type_base(v_batch.id);

  with created as (
    select
      nullif(item.payload->>'classroomId', '')::uuid as classroom_id,
      item.payload->>'sourceClassKey' as source_class_key,
      min(coalesce(item.payload->>'sourceClassLabel', '')) as source_label,
      array_remove(array[
        case when bool_or('CLASS_NEEDS_COURSE' = any(item.error_codes)) then 'course' end,
        case when bool_or('CLASS_NEEDS_TEACHER' = any(item.error_codes)) then 'teacher' end,
        case when bool_or('CLASS_NEEDS_ROOM' = any(item.error_codes)) then 'room' end,
        case when bool_or('CLASS_NEEDS_SCHEDULE' = any(item.error_codes)) then 'schedule' end
      ], null)::text[] as review_issues
    from public.data_import_rows item
    where item.batch_id = v_batch.id
      and 'CREATED_DEFAULT_CLASS' = any(item.error_codes)
    group by nullif(item.payload->>'classroomId', '')::uuid,
      item.payload->>'sourceClassKey'
  )
  update public.class_roster_source_mappings mapping
     set setup_source_batch_id = v_batch.id,
         source_context = case
           when jsonb_typeof(v_contexts -> created.source_class_key) = 'object'
             then v_contexts -> created.source_class_key
           when mapping.source_context <> '{}'::jsonb then mapping.source_context
           else jsonb_build_object(
             'sourceClassKey', created.source_class_key,
             'sourceClassLabel', created.source_label
           )
         end,
         setup_review_issues = created.review_issues,
         setup_completed_at = case
           when v_batch.status = 'completed' then mapping.setup_completed_at
           else null
         end,
         setup_completed_by = case
           when v_batch.status = 'completed' then mapping.setup_completed_by
           else null
         end,
         updated_by = v_uid,
         updated_at = now()
    from created
   where mapping.source_system = 'mofaxiao'
     and mapping.source_class_key = created.source_class_key
     and mapping.classroom_id = created.classroom_id;

  return public.get_mofaxiao_class_roster_import_batch(v_batch.id);
end
$$;

comment on function public.get_classroom_import_setup_context_v2(uuid) is
  'Returns the preserved import defaults and live unresolved setup items for one manageable class.';
comment on function public.complete_classroom_setup_v2(uuid, text, smallint, uuid, uuid, uuid, jsonb, integer) is
  'Atomically completes an existing class shell with course, lead teacher, room, and a full generated lecture schedule.';
comment on function public.apply_mofaxiao_class_roster_import(uuid) is
  'Applies a Mofaxiao roster batch and preserves source defaults for the post-import class setup workspace.';

revoke all on function public.get_classroom_import_setup_context_v2(uuid)
  from public, anon, authenticated;
revoke all on function public.complete_classroom_setup_v2(
  uuid, text, smallint, uuid, uuid, uuid, jsonb, integer
) from public, anon, authenticated;
revoke all on function public.get_mofaxiao_class_roster_import_batch(uuid)
  from public, anon, authenticated;
revoke all on function public.apply_mofaxiao_class_roster_import(uuid)
  from public, anon, authenticated;

grant execute on function public.get_classroom_import_setup_context_v2(uuid) to authenticated;
grant execute on function public.complete_classroom_setup_v2(
  uuid, text, smallint, uuid, uuid, uuid, jsonb, integer
) to authenticated;
grant execute on function public.get_mofaxiao_class_roster_import_batch(uuid) to authenticated;
grant execute on function public.apply_mofaxiao_class_roster_import(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
