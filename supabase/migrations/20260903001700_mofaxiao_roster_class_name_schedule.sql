-- DATA-IMPORT-CLASS-ROSTER-7: Mofaxiao class names contain only the weekly
-- start time. A source prefix such as `9.12开课` is scheduling data: it anchors
-- automatic weekly session generation and never appears in the class name.

begin;

create or replace function mathin_internal.build_mofaxiao_roster_class_name(p_default jsonb)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_system text := regexp_replace(btrim(coalesce(p_default->>'system', '')), '\s+', '', 'g');
  v_grade text := regexp_replace(btrim(coalesce(p_default->>'gradeText', '')), '\s+', '', 'g');
  v_season text := regexp_replace(btrim(coalesce(p_default->>'seasonText', '')), '\s+', '', 'g');
  v_class_type text := regexp_replace(btrim(coalesce(
    p_default->>'businessClassType', p_default->>'classType', ''
  )), '\s+', '', 'g');
  v_campus text := regexp_replace(btrim(coalesce(p_default->>'campusName', '')), '\s+', '', 'g');
  v_teacher text := regexp_replace(btrim(coalesce(p_default->>'teacherInitials', '')), '\s+', '', 'g');
  v_weekday text := regexp_replace(btrim(coalesce(p_default->>'weekday', '')), '\s+', '', 'g');
  v_time_source text := regexp_replace(btrim(coalesce(p_default->>'time', '')), '\s+', '', 'g');
  v_time text := regexp_replace(btrim(coalesce(p_default->>'startTime', '')), '\s+', '', 'g');
  v_time_parts text[];
begin
  v_system := regexp_replace(v_system, '体系$', '');
  if v_system = '' then
    v_system := '待定系列';
  elsif public.normalize_mofaxiao_class_text(v_system) like '%贯通%' then
    v_system := '贯通思维';
  elsif public.normalize_mofaxiao_class_text(v_system) like '%培优%'
     or public.normalize_mofaxiao_class_text(v_system) like '%科学%' then
    v_system := '科学思维';
  end if;
  if v_grade = '' then v_grade := '待定年级'; end if;
  if v_season = '' then v_season := '待定季节'; end if;
  if v_class_type = '' then v_class_type := '待定班型'; end if;
  if public.normalize_mofaxiao_class_text(v_campus) like '%紫辰%' then v_campus := '紫辰阁'; end if;
  if v_campus = '' then v_campus := '待定校区'; end if;
  if v_teacher = '' then
    v_teacher := regexp_replace(btrim(coalesce(p_default->>'teacherName', '')), '\s+', '', 'g');
  end if;
  if v_teacher = '' then v_teacher := '待定老师'; end if;
  if v_weekday = '' then v_weekday := '待定星期'; end if;

  if v_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    v_time_parts := regexp_match(v_time_source, '([0-9]{1,2}):([0-9]{2})');
    if v_time_parts is not null
       and v_time_parts[1]::integer between 0 and 23
       and v_time_parts[2]::integer between 0 and 59 then
      v_time := lpad(v_time_parts[1], 2, '0') || ':' || v_time_parts[2];
    else
      v_time := '待定时间';
    end if;
  end if;

  return left('【' || v_system || '】' || v_grade || v_season || v_class_type ||
    '|' || v_campus || v_teacher || v_weekday || v_time, 100);
exception when invalid_text_representation or numeric_value_out_of_range then
  return left('【' || v_system || '】' || v_grade || v_season || v_class_type ||
    '|' || v_campus || v_teacher || v_weekday || '待定时间', 100);
end
$$;

revoke all on function mathin_internal.build_mofaxiao_roster_class_name(jsonb)
  from public, anon, authenticated;

create or replace function mathin_internal.build_mofaxiao_roster_sessions(
  p_course_id uuid,
  p_room_id uuid,
  p_default jsonb
) returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_source_time text := regexp_replace(btrim(coalesce(p_default->>'time', '')), '\s+', '', 'g');
  v_date_parts text[];
  v_time_parts text[];
  v_school_year integer;
  v_start_date date;
  v_start_time time without time zone;
  v_end_time time without time zone;
  v_duration integer;
  v_default_duration integer;
  v_timezone text;
  v_rule_weekday integer;
  v_cursor date;
  v_calendar jsonb;
  v_is_teaching_day boolean;
  v_guard integer := 0;
  v_lecture_count integer;
  v_lecture record;
  v_result jsonb := '[]'::jsonb;
begin
  if p_course_id is null or jsonb_typeof(p_default) is distinct from 'object' then
    return v_result;
  end if;

  if coalesce(p_default->>'startDate', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_start_date := (p_default->>'startDate')::date;
  else
    v_date_parts := regexp_match(v_source_time, '^([0-9]{1,2})[./-]([0-9]{1,2})(日)?开课');
    if v_date_parts is not null and coalesce(p_default->>'schoolYear', '') ~ '^[0-9]{4}$' then
      v_school_year := (p_default->>'schoolYear')::integer;
      v_start_date := make_date(v_school_year, v_date_parts[1]::integer, v_date_parts[2]::integer);
    end if;
  end if;

  if coalesce(p_default->>'startTime', '') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    v_start_time := (p_default->>'startTime')::time;
  else
    v_time_parts := regexp_match(v_source_time, '([0-9]{1,2}):([0-9]{2})[-~～—–至]([0-9]{1,2}):([0-9]{2})');
    if v_time_parts is not null
       and v_time_parts[1]::integer between 0 and 23
       and v_time_parts[2]::integer between 0 and 59 then
      v_start_time := make_time(v_time_parts[1]::integer, v_time_parts[2]::integer, 0);
    end if;
  end if;

  if coalesce(p_default->>'durationMin', '') ~ '^[0-9]{1,3}$' then
    v_duration := (p_default->>'durationMin')::integer;
  elsif coalesce(p_default->>'endTime', '') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
        and v_start_time is not null then
    v_end_time := (p_default->>'endTime')::time;
    v_duration := extract(epoch from (v_end_time - v_start_time))::integer / 60;
  elsif v_time_parts is not null and v_start_time is not null
        and v_time_parts[3]::integer between 0 and 23
        and v_time_parts[4]::integer between 0 and 59 then
    v_end_time := make_time(v_time_parts[3]::integer, v_time_parts[4]::integer, 0);
    v_duration := extract(epoch from (v_end_time - v_start_time))::integer / 60;
  end if;

  select organization.timezone, organization.default_lesson_duration_min
    into v_timezone, v_default_duration
    from public.organizations organization
   where organization.singleton_key = 1;
  v_duration := coalesce(v_duration, v_default_duration);
  if v_start_date is null or v_start_time is null or v_timezone is null
     or v_duration not between 1 and 600 then
    return v_result;
  end if;

  select count(*) into v_lecture_count
    from public.course_lectures lecture
   where lecture.course_id = p_course_id and lecture.status = 'active';
  if v_lecture_count not between 1 and 200 then return v_result; end if;

  v_rule_weekday := extract(dow from v_start_date)::integer;
  v_cursor := v_start_date;
  for v_lecture in
    select lecture.id
      from public.course_lectures lecture
     where lecture.course_id = p_course_id and lecture.status = 'active'
     order by lecture.no, lecture.id
  loop
    v_is_teaching_day := false;
    while not v_is_teaching_day loop
      v_guard := v_guard + 1;
      if v_guard > v_lecture_count * 14 + 60 then return '[]'::jsonb; end if;
      v_calendar := public.get_effective_calendar_day_v2(v_cursor, p_room_id);
      if v_calendar->'entry' = 'null'::jsonb then
        v_is_teaching_day := extract(dow from v_cursor)::integer = v_rule_weekday;
      elsif v_calendar #>> '{entry,kind}' <> 'closed'
            and v_calendar #>> '{entry,scheduleMode}' = 'mapped'
            and (v_calendar #>> '{entry,mappedWeekday}')::integer = v_rule_weekday then
        v_is_teaching_day := true;
      end if;
      if not v_is_teaching_day then v_cursor := v_cursor + 1; end if;
    end loop;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'lecture_id', v_lecture.id,
      'scheduled_at', (v_cursor + v_start_time) at time zone v_timezone,
      'duration_min', v_duration
    ));
    v_cursor := v_cursor + 1;
  end loop;
  return v_result;
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    return '[]'::jsonb;
end
$$;

revoke all on function mathin_internal.build_mofaxiao_roster_sessions(uuid, uuid, jsonb)
  from public, anon, authenticated;

do $migration$
declare
  apply_function regprocedure := to_regprocedure(
    'mathin_internal.apply_mofaxiao_class_roster_import_class_type_base(uuid)'
  );
  original_definition text;
  amended_definition text;
begin
  if apply_function is null then raise exception 'MOFAXIAO_ROSTER_APPLY_FUNCTION_MISSING'; end if;
  original_definition := pg_get_functiondef(apply_function);

  if position('mathin_internal.build_mofaxiao_roster_sessions' in original_definition) = 0 then
    amended_definition := replace(
      original_definition,
      '  v_created boolean;' || chr(10) || '  v_created_count integer',
      '  v_created boolean;' || chr(10) || '  v_sessions jsonb;' || chr(10) || '  v_created_count integer'
    );
    if amended_definition = original_definition then
      raise exception 'MOFAXIAO_ROSTER_SESSION_VARIABLE_ANCHOR_MISSING';
    end if;
    original_definition := amended_definition;

    amended_definition := replace(
      original_definition,
      '    v_created := false;' || chr(10) ||
        '    v_review_codes := array[''CLASS_NEEDS_SCHEDULE'']::text[];',
      '    v_created := false;' || chr(10) ||
        '    v_sessions := ''[]''::jsonb;' || chr(10) ||
        '    v_review_codes := ''{}''::text[];'
    );
    if amended_definition = original_definition then
      raise exception 'MOFAXIAO_ROSTER_REVIEW_INITIALIZER_ANCHOR_MISSING';
    end if;
    original_definition := amended_definition;

    amended_definition := replace(
      original_definition,
      '      v_classroom_id := public.create_class_v2(',
      '      v_sessions := mathin_internal.build_mofaxiao_roster_sessions(' || chr(10) ||
        '        v_course_id, v_room_id, v_default' || chr(10) ||
        '      );' || chr(10) ||
        '      if jsonb_array_length(v_sessions) = 0 then' || chr(10) ||
        '        v_review_codes := array_append(v_review_codes, ''CLASS_NEEDS_SCHEDULE'');' || chr(10) ||
        '      end if;' || chr(10) || chr(10) ||
        '      v_classroom_id := public.create_class_v2('
    );
    if amended_definition = original_definition then
      raise exception 'MOFAXIAO_ROSTER_CLASS_CREATE_ANCHOR_MISSING';
    end if;
    original_definition := amended_definition;

    amended_definition := replace(
      original_definition,
      '        p_sessions => ''[]''::jsonb,',
      '        p_sessions => v_sessions,'
    );
    if amended_definition = original_definition then
      raise exception 'MOFAXIAO_ROSTER_EMPTY_SESSIONS_ANCHOR_MISSING';
    end if;
    execute amended_definition;
  end if;

  if position(
    'mathin_internal.build_mofaxiao_roster_sessions' in pg_get_functiondef(apply_function)
  ) = 0 or position(
    'p_sessions => v_sessions' in pg_get_functiondef(apply_function)
  ) = 0 then
    raise exception 'MOFAXIAO_ROSTER_AUTOMATIC_SCHEDULE_NOT_INSTALLED';
  end if;
  if position(
    'v_review_codes := array[''CLASS_NEEDS_SCHEDULE'']::text[]'
    in pg_get_functiondef(apply_function)
  ) > 0 then
    raise exception 'MOFAXIAO_ROSTER_SCHEDULE_STILL_ALWAYS_PENDING';
  end if;
end
$migration$;

comment on function mathin_internal.build_mofaxiao_roster_class_name(jsonb) is
  'Builds compact roster class names as 【series】grade-season-level|location-teacher-weekday-start-time.';
comment on function mathin_internal.build_mofaxiao_roster_sessions(uuid, uuid, jsonb) is
  'Builds calendar-aware weekly course sessions from the source class start date and time range.';
comment on function public.apply_mofaxiao_class_roster_import(uuid) is
  'Applies a validated Mofaxiao roster batch, creating compactly named classes and automatically scheduling matched course lectures when source timing is complete.';

select pg_notify('pgrst', 'reload schema');

commit;
