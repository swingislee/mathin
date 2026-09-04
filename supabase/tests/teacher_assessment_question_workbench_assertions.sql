begin;

do $$
declare
  actor_id uuid;
  target_student_id uuid;
  activity_id uuid;
  registration_id uuid;
  paper_id uuid;
  version_id uuid;
  first_question_id uuid;
  second_question_id uuid;
  result jsonb;
  rejected boolean;
begin
  select id into actor_id
    from public.profiles
   where role = 'admin' and is_active
   order by created_at
   limit 1;
  if actor_id is null then raise exception 'TEACHER_ASSESSMENT_ADMIN_FIXTURE_REQUIRED'; end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  if not public.has_perm(actor_id, 'review.write') then
    raise exception 'TEACHER_ASSESSMENT_PERMISSION_REQUIRED';
  end if;

  target_student_id := public.create_student(
    'Teacher assessment assertion student', 5::smallint, '', '',
    'teacher-assessment-assertion', '', '', ''
  );
  insert into public.activities(kind, title, scheduled_at, location, created_by)
  values ('assessment_1v1', 'Teacher assessment assertion', now(), 'local assertion', actor_id)
  returning id into activity_id;
  insert into public.activity_registrations(activity_id, student_id, status, operated_by)
  values (activity_id, target_student_id, 'booked', actor_id)
  returning id into registration_id;

  insert into public.assessment_papers(title, source, grade_min, grade_max, created_by)
  values ('Teacher assessment assertion paper', 'internal', 5, 5, actor_id)
  returning id into paper_id;
  insert into public.assessment_paper_versions(
    paper_id, version_no, status, question_count, total_score, created_by
  ) values (paper_id, 1, 'draft', 2, 10, actor_id)
  returning id into version_id;
  insert into public.assessment_paper_questions(
    paper_version_id, position, question_no, prompt, knowledge_point, max_score, quick_scores
  ) values (
    version_id, 1, '1', 'First question', 'Number sense', 6,
    '{"independent":6,"prompted":4,"partial":2,"unable":0,"not_tested":null}'::jsonb
  ) returning id into first_question_id;
  insert into public.assessment_paper_questions(
    paper_version_id, position, question_no, prompt, knowledge_point, max_score, quick_scores
  ) values (
    version_id, 2, '2', 'Second question', 'Reasoning', 4,
    '{"independent":4,"prompted":3,"partial":2,"unable":0,"not_tested":null}'::jsonb
  ) returning id into second_question_id;
  update public.assessment_paper_versions
     set status = 'published', published_at = now()
   where id = version_id;

  perform public.bind_teacher_assessment_paper(registration_id, version_id);
  result := public.save_teacher_assessment_question(
    registration_id, first_question_id, 'independent', 6::smallint, 'Clear reasoning'
  );
  if result ->> 'answeredCount' <> '1'
     or result ->> 'questionCount' <> '2'
     or result ->> 'score' <> '6' then
    raise exception 'TEACHER_ASSESSMENT_FIRST_RESULT_INVALID';
  end if;
  if not exists (
    select 1 from public.activity_registrations
     where id = registration_id and status = 'attended' and assessment_started_at is not null
  ) then raise exception 'TEACHER_ASSESSMENT_DID_NOT_MARK_ATTENDED'; end if;

  rejected := false;
  begin
    perform public.complete_teacher_assessment(registration_id);
  exception when others then
    if position('ASSESSMENT_QUESTIONS_INCOMPLETE' in sqlerrm) = 0 then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'TEACHER_ASSESSMENT_ALLOWED_INCOMPLETE'; end if;

  result := public.save_teacher_assessment_question(
    registration_id, second_question_id, 'not_tested', null::smallint, 'Time ended'
  );
  result := public.complete_teacher_assessment(registration_id);
  if result ->> 'score' <> '6' or result ->> 'suggestedBand' <> 'a' then
    raise exception 'TEACHER_ASSESSMENT_SUMMARY_INVALID';
  end if;
  if not exists (
    select 1 from public.assessment_results
     where activity_registration_id = registration_id
       and score = 6 and assessment_band = 'a'
  ) or not exists (
    select 1 from public.activity_registrations
     where id = registration_id and assessment_completed_at is not null
  ) then raise exception 'TEACHER_ASSESSMENT_COMPLETION_NOT_PERSISTED'; end if;

  rejected := false;
  begin
    update public.assessment_paper_questions set max_score = 7 where id = first_question_id;
  exception when others then
    if position('ASSESSMENT_PAPER_VERSION_LOCKED' in sqlerrm) = 0 then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'TEACHER_ASSESSMENT_PUBLISHED_PAPER_MUTATED'; end if;

  if not exists (
    select 1 from pg_class
     where oid = 'public.assessment_question_results'::regclass and relrowsecurity
  ) then raise exception 'TEACHER_ASSESSMENT_RLS_NOT_ENABLED'; end if;
end;
$$;

rollback;
