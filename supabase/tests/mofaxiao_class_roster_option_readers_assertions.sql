begin;

do $$
declare
  actor_id uuid;
  actor_name text;
  term_id_value uuid;
  classroom_id_value uuid;
  student_id_value uuid;
  option_row record;
  suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
begin
  select id, display_name into actor_id, actor_name
    from public.profiles
   where role = 'admin' and is_active
   order by created_at
   limit 1;
  if actor_id is null then raise exception 'ROSTER_OPTION_ADMIN_FIXTURE_REQUIRED'; end if;

  select id into term_id_value
    from public.school_terms
   where year = 2026 and term = 2
   order by starts_on
   limit 1;
  if term_id_value is null then raise exception 'ROSTER_OPTION_2026_AUTUMN_TERM_REQUIRED'; end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  classroom_id_value := public.create_class_v2(
    p_name => '__花名册候选读取回滚断言_' || suffix,
    p_course_id => null::uuid,
    p_capacity => 8::smallint,
    p_room_id => null::uuid,
    p_primary_teacher_id => actor_id,
    p_learning_support_id => null::uuid,
    p_term_id => term_id_value,
    p_purpose => 'production',
    p_sessions => '[]'::jsonb,
    p_activate => false,
    p_offering_type => 'long_term_formal'
  );

  insert into public.students(name, phone, grade, status, source, created_by, bind_code)
  values (
    '__花名册候选读取学员_' || suffix,
    '196' || lpad((floor(random() * 100000000))::bigint::text, 8, '0'),
    3, 'enrolled', '断言', actor_id, public.generate_student_bind_code()
  ) returning id into student_id_value;

  insert into public.enrollments(classroom_id, student_id, status, joined_at, term_id, operated_by)
  values (classroom_id_value, student_id_value, 'active', now(), term_id_value, actor_id);

  select * into option_row
    from public.list_mofaxiao_class_roster_target_options()
   where id = classroom_id_value;

  if option_row.id is null then raise exception 'ROSTER_OPTION_TARGET_MISSING'; end if;
  if option_row.term_id is distinct from term_id_value
     or option_row.school_year <> 2026
     or option_row.season <> 2
     or option_row.capacity <> 8
     or option_row.active_enrollment_count <> 1 then
    raise exception 'ROSTER_OPTION_TARGET_METADATA_WRONG: %', row_to_json(option_row);
  end if;
  if not actor_name = any(option_row.primary_teacher_names) then
    raise exception 'ROSTER_OPTION_PRIMARY_TEACHER_MISSING: %', row_to_json(option_row);
  end if;
end
$$;

rollback;
