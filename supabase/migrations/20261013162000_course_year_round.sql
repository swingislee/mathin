-- Explicit year-round curriculum mode. Seasonal courses retain the required term.
begin;
alter table public.courses add column if not exists year_round boolean not null default false;
alter table public.courses drop constraint courses_curriculum_term_required;
alter table public.courses add constraint courses_curriculum_term_required
  check (course_kind <> 'curriculum' or term is not null or year_round);
alter table public.courses add constraint courses_year_round_mode_check
  check (not year_round or (course_kind = 'curriculum' and term is null));

do $$
declare body text; signature text;
begin
  foreach signature in array array[
    'public.get_course_family_detail_pre_teacher_class_root(uuid,uuid,text)',
    'public.get_course_family_detail(uuid,uuid,text)',
    'public.list_course_families(text,jsonb,integer)'
  ] loop
    body := pg_get_functiondef(signature::regprocedure);
    if signature like '%list_course_families%' then
      if strpos(body, 'course_row.term = v_course_season') = 0 then raise exception 'YEAR_ROUND_QUERY_CHANGED'; end if;
      body := replace(body, 'course_row.grade,', 'course_row.grade, course_row.year_round,');
      body := replace(body, '''grade'', variant_row.grade,', '''grade'', variant_row.grade, ''yearRound'', variant_row.year_round,');
      body := replace(body, 'course_row.term = v_course_season', 'course_row.term = v_course_season or course_row.year_round');
      body := replace(body, 'v_variant_filtered :=', 'v_variant_filtered := coalesce(p_filters ->> ''yearRound'','''') = ''true'' or');
      body := replace(body, 'where course_row.trashed_at is null', 'where (coalesce(p_filters ->> ''yearRound'','''') <> ''true'' or course_row.year_round) and course_row.trashed_at is null');
    else
      if strpos(body, '''grade'',') = 0 then raise exception 'YEAR_ROUND_QUERY_CHANGED'; end if;
      body := replace(body, '''grade'', course_row.grade,', '''grade'', course_row.grade, ''yearRound'', course_row.year_round,');
      body := replace(body, '''grade'', selected_variant.grade,', '''grade'', selected_variant.grade, ''yearRound'', selected_variant.year_round,');
      body := replace(body, '''grade'', course.grade,', '''grade'', course.grade, ''yearRound'', course.year_round,');
    end if;
    execute body;
  end loop;
  signature := 'public.list_class_build_course_variants(text,smallint,smallint,text,text,integer,boolean,text,uuid,text,text)';
  body := pg_get_functiondef(signature::regprocedure);
  if strpos(body, 'course_row.term = p_course_season') = 0 then raise exception 'YEAR_ROUND_QUERY_CHANGED'; end if;
  execute replace(body, 'course_row.term = p_course_season', 'course_row.term = p_course_season or course_row.year_round');
end;
$$;
notify pgrst, 'reload schema';
commit;
