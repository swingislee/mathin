-- Reuse the classroom fill rail in 1:1 assessment without turning one bulk
-- gesture into many browser requests. Both operations are one database
-- transaction and delegate each row to the existing audited save function.

create or replace function public.teacher_assessment_summary_snapshot(
  p_registration_id uuid
) returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  with registration as (
    select assessment_paper_version_id as version_id,
           assessment_completed_at as completed_at
      from public.activity_registrations
     where id = p_registration_id
  ), totals as (
    select count(*) filter (where result.outcome is not null)::integer as answered_count,
           coalesce(sum(result.awarded_score), 0)::integer as score
      from registration
      join public.assessment_paper_questions question
        on question.paper_version_id = registration.version_id
      left join public.assessment_question_results result
        on result.question_id = question.id
       and result.activity_registration_id = p_registration_id
  )
  select jsonb_build_object(
    'answeredCount', totals.answered_count,
    'questionCount', version.question_count,
    'score', totals.score,
    'totalScore', version.total_score,
    'suggestedBand', public.assessment_band_for_score(version.id, totals.score::smallint),
    'completedAt', registration.completed_at
  )
    from registration
    join public.assessment_paper_versions version on version.id = registration.version_id
    cross join totals;
$$;

create or replace function public.fill_teacher_assessment_questions(
  p_registration_id uuid,
  p_question_ids uuid[],
  p_outcome text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_version_id uuid;
  v_question_id uuid;
  v_score smallint;
  v_note text;
  v_existing_outcome text;
  v_filled_ids uuid[] := '{}'::uuid[];
  v_summary jsonb;
begin
  if not public.can_record_teacher_assessment(p_registration_id, v_uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  if p_outcome is null
     or p_outcome not in ('explained', 'independent', 'prompted', 'imitated', 'incomplete')
     or p_question_ids is null
     or cardinality(p_question_ids) not between 1 and 200 then
    raise exception 'INVALID_ASSESSMENT_QUESTION_RESULT';
  end if;

  select assessment_paper_version_id
    into v_version_id
    from public.activity_registrations
   where id = p_registration_id
   for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_version_id is null then raise exception 'ASSESSMENT_PAPER_REQUIRED'; end if;

  if (
    select count(distinct question.id)
      from unnest(p_question_ids) requested(question_id)
      join public.assessment_paper_questions question
        on question.id = requested.question_id
       and question.paper_version_id = v_version_id
  ) <> cardinality(p_question_ids) then
    raise exception 'ASSESSMENT_QUESTION_NOT_IN_PAPER';
  end if;

  foreach v_question_id in array p_question_ids loop
    select result.outcome,
           coalesce(result.note, ''),
           nullif(question.quick_scores ->> p_outcome, '')::smallint
      into v_existing_outcome, v_note, v_score
      from public.assessment_paper_questions question
      left join public.assessment_question_results result
        on result.question_id = question.id
       and result.activity_registration_id = p_registration_id
     where question.id = v_question_id
       and question.paper_version_id = v_version_id;

    if v_existing_outcome is null then
      perform public.save_teacher_assessment_question(
        p_registration_id,
        v_question_id,
        p_outcome,
        v_score,
        v_note
      );
      v_filled_ids := array_append(v_filled_ids, v_question_id);
    end if;
  end loop;

  v_summary := public.teacher_assessment_summary_snapshot(p_registration_id);
  return v_summary || jsonb_build_object('questionIds', to_jsonb(v_filled_ids));
end;
$$;

create or replace function public.undo_teacher_assessment_question_fill(
  p_registration_id uuid,
  p_question_ids uuid[],
  p_outcome text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_version_id uuid;
  v_question_id uuid;
  v_note text;
  v_restored_ids uuid[] := '{}'::uuid[];
  v_summary jsonb;
begin
  if not public.can_record_teacher_assessment(p_registration_id, v_uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  if p_outcome is null
     or p_outcome not in ('explained', 'independent', 'prompted', 'imitated', 'incomplete')
     or p_question_ids is null
     or cardinality(p_question_ids) not between 1 and 200 then
    raise exception 'INVALID_ASSESSMENT_QUESTION_RESULT';
  end if;

  select assessment_paper_version_id
    into v_version_id
    from public.activity_registrations
   where id = p_registration_id
   for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_version_id is null then raise exception 'ASSESSMENT_PAPER_REQUIRED'; end if;

  if (
    select count(distinct question.id)
      from unnest(p_question_ids) requested(question_id)
      join public.assessment_paper_questions question
        on question.id = requested.question_id
       and question.paper_version_id = v_version_id
  ) <> cardinality(p_question_ids) then
    raise exception 'ASSESSMENT_QUESTION_NOT_IN_PAPER';
  end if;

  foreach v_question_id in array p_question_ids loop
    select result.note
      into v_note
      from public.assessment_question_results result
     where result.activity_registration_id = p_registration_id
       and result.question_id = v_question_id
       and result.outcome = p_outcome;

    if found then
      perform public.save_teacher_assessment_question(
        p_registration_id,
        v_question_id,
        null,
        null,
        coalesce(v_note, '')
      );
      v_restored_ids := array_append(v_restored_ids, v_question_id);
    end if;
  end loop;

  v_summary := public.teacher_assessment_summary_snapshot(p_registration_id);
  return v_summary || jsonb_build_object('questionIds', to_jsonb(v_restored_ids));
end;
$$;

revoke all on function public.teacher_assessment_summary_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.fill_teacher_assessment_questions(uuid, uuid[], text) from public, anon, authenticated;
revoke all on function public.undo_teacher_assessment_question_fill(uuid, uuid[], text) from public, anon, authenticated;

grant execute on function public.fill_teacher_assessment_questions(uuid, uuid[], text) to authenticated;
grant execute on function public.undo_teacher_assessment_question_fill(uuid, uuid[], text) to authenticated;
