-- Keep one assessment-language contract across classroom checks and 1:1 papers:
-- explained > independent > prompted > imitated > incomplete. A missing outcome
-- is the unchecked state and remains reversible until the assessment is completed.

alter table public.assessment_question_results
  drop constraint if exists assessment_question_results_outcome_check,
  drop constraint if exists assessment_question_result_shape_check;

update public.assessment_question_results
   set outcome = case outcome
     when 'partial' then 'imitated'
     when 'unable' then 'incomplete'
     when 'not_tested' then 'incomplete'
     else outcome
   end,
       awarded_score = case
         when outcome = 'not_tested' then coalesce(awarded_score, 0)
         else awarded_score
       end
 where outcome in ('partial', 'unable', 'not_tested');

alter table public.assessment_question_results
  add constraint assessment_question_results_outcome_check check (
    outcome in ('explained', 'independent', 'prompted', 'imitated', 'incomplete')
  ),
  add constraint assessment_question_result_shape_check check (
    outcome is not null or awarded_score is null
  );

-- Published paper versions are normally immutable. This one-time schema
-- compatibility rewrite runs inside the migration transaction and restores the
-- trigger immediately after replacing only the quick-score key names.
alter table public.assessment_paper_questions
  disable trigger assessment_paper_questions_draft_only;

update public.assessment_paper_questions
   set quick_scores = jsonb_build_object(
     'explained', coalesce(quick_scores -> 'explained', quick_scores -> 'independent', 'null'::jsonb),
     'independent', coalesce(quick_scores -> 'independent', 'null'::jsonb),
     'prompted', coalesce(quick_scores -> 'prompted', 'null'::jsonb),
     'imitated', coalesce(quick_scores -> 'imitated', quick_scores -> 'partial', 'null'::jsonb),
     'incomplete', coalesce(quick_scores -> 'incomplete', quick_scores -> 'unable', '0'::jsonb)
   );

alter table public.assessment_paper_questions
  enable trigger assessment_paper_questions_draft_only;

create or replace function public.save_teacher_assessment_question(
  p_registration_id uuid,
  p_question_id uuid,
  p_outcome text default null,
  p_score smallint default null,
  p_note text default ''
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_version_id uuid;
  v_status text;
  v_student_id uuid;
  v_lead_id uuid;
  v_activity_title text;
  v_max_score smallint;
  v_question_count integer;
  v_answered_count integer;
  v_total_score smallint;
  v_score smallint;
  v_band text;
  v_completed_at timestamptz;
  v_was_new_assessment boolean;
begin
  if not public.can_record_teacher_assessment(p_registration_id, v_uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  if (p_outcome is not null
       and p_outcome not in ('explained', 'independent', 'prompted', 'imitated', 'incomplete'))
     or char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'INVALID_ASSESSMENT_QUESTION_RESULT';
  end if;

  select registration.assessment_paper_version_id,
         registration.status,
         registration.student_id,
         registration.lead_id,
         activity.title
    into v_version_id, v_status, v_student_id, v_lead_id, v_activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id
   for update of registration;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_status in ('no_show', 'cancelled') then raise exception 'PARTICIPATION_NOT_ASSESSABLE'; end if;
  if v_version_id is null then raise exception 'ASSESSMENT_PAPER_REQUIRED'; end if;

  select max_score into v_max_score
    from public.assessment_paper_questions
   where id = p_question_id and paper_version_id = v_version_id;
  if not found then raise exception 'ASSESSMENT_QUESTION_NOT_IN_PAPER'; end if;
  if (p_score is not null and (p_score < 0 or p_score > v_max_score))
     or (p_score is not null and p_outcome is null) then
    raise exception 'INVALID_ASSESSMENT_QUESTION_SCORE';
  end if;

  if p_outcome is null and p_score is null and btrim(coalesce(p_note, '')) = '' then
    delete from public.assessment_question_results
     where activity_registration_id = p_registration_id
       and question_id = p_question_id;
  else
    insert into public.assessment_question_results(
      activity_registration_id, question_id, outcome, awarded_score, note, assessed_by
    ) values (
      p_registration_id, p_question_id, p_outcome, p_score,
      btrim(coalesce(p_note, '')), v_uid
    )
    on conflict (activity_registration_id, question_id) do update
      set outcome = excluded.outcome,
          awarded_score = excluded.awarded_score,
          note = excluded.note,
          assessed_by = excluded.assessed_by;
  end if;

  if v_status = 'booked' then
    update public.activity_registrations
       set status = 'attended', operated_by = v_uid
     where id = p_registration_id;
    if v_student_id is not null then
      insert into public.student_follow_ups(student_id, author_id, content, kind)
      values (v_student_id, v_uid, '活动到场：' || v_activity_title, 'activity');
    end if;
  end if;
  update public.activity_registrations
     set assessment_started_at = coalesce(assessment_started_at, now())
   where id = p_registration_id;

  select version.question_count,
         coalesce(sum(result.awarded_score), 0)::smallint,
         count(*) filter (where result.outcome is not null)::integer
    into v_question_count, v_score, v_answered_count
    from public.assessment_paper_versions version
    left join public.assessment_paper_questions question
      on question.paper_version_id = version.id
    left join public.assessment_question_results result
      on result.question_id = question.id
     and result.activity_registration_id = p_registration_id
   where version.id = v_version_id
   group by version.question_count;
  select total_score into v_total_score
    from public.assessment_paper_versions where id = v_version_id;
  v_band := public.assessment_band_for_score(v_version_id, v_score);

  update public.activity_registrations
     set assessment_completed_at = case
       when assessment_completed_at is not null and v_answered_count < v_question_count then null
       else assessment_completed_at
     end
   where id = p_registration_id
   returning assessment_completed_at into v_completed_at;

  v_was_new_assessment := not exists (
    select 1 from public.assessment_results
     where activity_registration_id = p_registration_id
  );
  insert into public.assessment_results(
    activity_registration_id, student_id, lead_id, overall_level,
    assessment_band, score, assessed_by
  ) values (
    p_registration_id, v_student_id, v_lead_id, null,
    case when v_completed_at is not null then v_band else null end, v_score, v_uid
  )
  on conflict (activity_registration_id) do update
    set student_id = excluded.student_id,
        lead_id = excluded.lead_id,
        assessment_band = excluded.assessment_band,
        score = excluded.score,
        assessed_by = excluded.assessed_by;

  if v_was_new_assessment and v_student_id is not null then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (v_student_id, v_uid, '已开始逐题测评：' || v_activity_title, 'activity');
  end if;

  return jsonb_build_object(
    'answeredCount', v_answered_count,
    'questionCount', v_question_count,
    'score', v_score,
    'totalScore', v_total_score,
    'suggestedBand', v_band,
    'completedAt', v_completed_at
  );
end;
$$;
