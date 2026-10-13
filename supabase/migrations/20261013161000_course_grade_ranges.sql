-- A course can serve an inclusive grade range. NULL keeps the existing single grade.
begin;
alter table public.courses add column if not exists grade_end smallint;
alter table public.courses add constraint courses_grade_range_check
  check (grade_end is null or (grade_end >= grade and grade_end <= 9));
comment on column public.courses.grade_end is 'Inclusive final grade; NULL means the single grade in grade.';

-- Extend the installed query bodies in place, retaining their current permission
-- and teacher-microcourse branches. Fail closed if a prerequisite query changed.
do $$
declare body text; signature text; anchor text;
begin
  foreach signature in array array[
    'public.get_course_family_detail_pre_teacher_class_root(uuid,uuid,text)',
    'public.get_course_family_detail(uuid,uuid,text)',
    'public.list_course_families(text,jsonb,integer)'
  ] loop
    body := pg_get_functiondef(signature::regprocedure);
    if signature like '%list_course_families%' then
      anchor := 'course_row.grade = v_grade';
      if strpos(body, anchor) = 0 then raise exception 'GRADE_RANGE_QUERY_CHANGED: %', signature; end if;
      body := replace(body, anchor, 'v_grade between course_row.grade and coalesce(course_row.grade_end, course_row.grade)');
      body := replace(body, 'course_row.grade,', 'course_row.grade, course_row.grade_end,');
      body := replace(body, '''grade'', variant_row.grade,', '''grade'', variant_row.grade, ''gradeEnd'', variant_row.grade_end,');
    else
      if strpos(body, '''grade'',') = 0 then raise exception 'GRADE_RANGE_QUERY_CHANGED: %', signature; end if;
      body := replace(body, '''grade'', course_row.grade,', '''grade'', course_row.grade, ''gradeEnd'', course_row.grade_end,');
      body := replace(body, '''grade'', selected_variant.grade,', '''grade'', selected_variant.grade, ''gradeEnd'', selected_variant.grade_end,');
      body := replace(body, '''grade'', course.grade,', '''grade'', course.grade, ''gradeEnd'', course.grade_end,');
    end if;
    execute body;
  end loop;
  signature := 'public.list_class_build_course_variants(text,smallint,smallint,text,text,integer,boolean,text,uuid,text,text)';
  body := pg_get_functiondef(signature::regprocedure);
  anchor := 'course_row.grade = p_grade';
  if strpos(body, anchor) = 0 then raise exception 'GRADE_RANGE_QUERY_CHANGED: %', signature; end if;
  execute replace(body, anchor, 'p_grade between course_row.grade and coalesce(course_row.grade_end, course_row.grade)');
end;
$$;
notify pgrst, 'reload schema';
commit;
