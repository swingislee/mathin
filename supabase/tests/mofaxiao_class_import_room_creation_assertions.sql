begin;

do $$
declare
  actor_id uuid;
  actor_name text;
  term_id_value uuid;
  season_value smallint;
  campus_id_value uuid;
  room_id_value uuid;
  classroom_id_value uuid;
  batch_id_value uuid;
  suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  room_name_value text;
  external_id_value text;
  rows_value jsonb;
  preview_result jsonb;
  applied_result jsonb;
  room_count_before bigint;
  session_count_before bigint;
begin
  select id, display_name into actor_id, actor_name
    from public.profiles
   where role = 'admin' and is_active
   order by created_at
   limit 1;
  if actor_id is null then raise exception 'CLASS_ROOM_IMPORT_ADMIN_FIXTURE_REQUIRED'; end if;

  select id, term into term_id_value, season_value
    from public.school_terms
   where term between 1 and 4
   order by year desc, term
   limit 1;
  if term_id_value is null then raise exception 'CLASS_ROOM_IMPORT_TERM_FIXTURE_REQUIRED'; end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  campus_id_value := public.create_campus_v2('__班级导入校区_' || suffix, null);
  room_name_value := '__导入新教室_' || suffix;
  external_id_value := '__room-import-' || suffix;
  select count(*) into room_count_before from public.campus_rooms;
  select count(*) into session_count_before from public.class_sessions;

  rows_value := jsonb_build_array(jsonb_build_object(
    'sourceRow', 2,
    'externalClassId', external_id_value,
    'name', '__班级导入教室断言_' || suffix,
    'teachingMode', '面授',
    'courseName', '自由班',
    'courseType', '长期班',
    'progressText', '0/10',
    'subject', '思维',
    'grade', 1,
    'gradeText', '一年级',
    'gradeUnmapped', false,
    'season', season_value,
    'seasonText', '断言学期',
    'classType', '',
    'assessmentDifficulty', '',
    'teacherName', actor_name,
    'campusName', '__班级导入校区_' || suffix,
    'roomName', room_name_value,
    'feeText', '',
    'currentStudentCount', 0,
    'enrolledCount', 0,
    'capacity', 10,
    'capacityInvalid', false,
    'sourceStatus', '未开课',
    'startDate', null,
    'startDateText', '',
    'endDate', null,
    'endDateText', '',
    'sessionTime', '',
    'purchasedText', '',
    'courseId', null,
    'importAsFreeClass', true,
    'primaryTeacherId', actor_id,
    'roomId', null,
    'createRoomCampusId', campus_id_value,
    'schoolTermId', term_id_value
  ));

  preview_result := public.preview_mofaxiao_class_import(
    'mofaxiao-classes-v1', rows_value, gen_random_uuid()::text,
    repeat('a', 64), repeat('b', 64), 'mofaxiao',
    'class-room-assertion.xlsx', 'bill', '班级导入新建教室断言'
  );
  if preview_result->>'status' <> 'validated'
     or (preview_result->>'valid')::integer <> 1
     or (preview_result->>'dup')::integer <> 0
     or (preview_result->>'errorCount')::integer <> 0 then
    raise exception 'CLASS_ROOM_IMPORT_PREVIEW_WRONG: %', preview_result;
  end if;
  if (select count(*) from public.campus_rooms) <> room_count_before then
    raise exception 'CLASS_ROOM_IMPORT_DRY_RUN_CREATED_ROOM';
  end if;

  batch_id_value := (preview_result->>'batchId')::uuid;
  applied_result := public.apply_mofaxiao_class_import(batch_id_value);
  if applied_result->>'status' <> 'completed'
     or (applied_result->>'inserted')::integer <> 1
     or (applied_result->>'errorCount')::integer <> 0 then
    raise exception 'CLASS_ROOM_IMPORT_APPLY_WRONG: %', applied_result;
  end if;

  select id into room_id_value
    from public.campus_rooms
   where campus_id = campus_id_value and name = room_name_value;
  if room_id_value is null then raise exception 'CLASS_ROOM_IMPORT_ROOM_NOT_CREATED'; end if;
  if (select capacity from public.campus_rooms where id = room_id_value) is not null then
    raise exception 'CLASS_ROOM_IMPORT_COPIED_CLASS_CAPACITY_TO_ROOM';
  end if;

  select target_id into classroom_id_value
    from public.data_import_rows
   where batch_id = batch_id_value and row_no = 1;
  if classroom_id_value is null or not exists (
    select 1 from public.classrooms classroom
     where classroom.id = classroom_id_value
       and classroom.default_room_id = room_id_value
       and classroom.term_id = term_id_value
       and classroom.owner_id = actor_id
  ) then
    raise exception 'CLASS_ROOM_IMPORT_CLASS_NOT_BOUND_TO_ROOM';
  end if;
  if (select count(*) from public.campus_rooms) <> room_count_before + 1 then
    raise exception 'CLASS_ROOM_IMPORT_ROOM_COUNT_WRONG';
  end if;
  if (select count(*) from public.class_sessions) <> session_count_before then
    raise exception 'CLASS_ROOM_IMPORT_CREATED_SESSION';
  end if;

  applied_result := public.apply_mofaxiao_class_import(batch_id_value);
  if (select count(*) from public.campus_rooms where campus_id = campus_id_value and name = room_name_value) <> 1 then
    raise exception 'CLASS_ROOM_IMPORT_REAPPLY_DUPLICATED_ROOM';
  end if;
end
$$;

rollback;
