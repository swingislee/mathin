-- DEV-SCHOOL-OPS-1 / Phase 2 teacher-facing question assessment workbench.
--
-- The support workbench keeps the cross-student aggregate view. This migration
-- adds the teacher axis: one registration, one immutable published paper
-- version, and one compact result row per question. Question count, per-question
-- points, total score, quick-score rubric and band thresholds are paper data;
-- none of them are global UI constants.

create table public.assessment_papers (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  source text not null check (char_length(btrim(source)) between 1 and 80),
  grade_min smallint check (grade_min between -1 and 12),
  grade_max smallint check (grade_max between -1 and 12),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint assessment_papers_grade_range_check check (
    grade_min is null or grade_max is null or grade_min <= grade_max
  )
);

create table public.assessment_paper_versions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.assessment_papers(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  question_count smallint not null check (question_count between 1 and 200),
  total_score smallint not null check (total_score between 1 and 10000),
  band_thresholds jsonb not null default jsonb_build_object(
    'x_plus', 0, 'g_plus', 40, 'a', 55, 'a_plus', 70, 's', 85, 'c', 95
  ) check (jsonb_typeof(band_thresholds) = 'object'),
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (paper_id, version_no)
);

create table public.assessment_paper_questions (
  id uuid primary key default gen_random_uuid(),
  paper_version_id uuid not null references public.assessment_paper_versions(id) on delete cascade,
  position smallint not null check (position between 1 and 200),
  question_no text not null check (char_length(btrim(question_no)) between 1 and 24),
  prompt text not null default '' check (char_length(prompt) <= 1000),
  knowledge_point text not null default '' check (char_length(knowledge_point) <= 200),
  max_score smallint not null check (max_score between 1 and 1000),
  quick_scores jsonb not null check (jsonb_typeof(quick_scores) = 'object'),
  created_at timestamptz not null default now(),
  unique (paper_version_id, position),
  unique (paper_version_id, question_no)
);

alter table public.activity_registrations
  add column assessment_paper_version_id uuid
    references public.assessment_paper_versions(id) on delete restrict,
  add column assessment_started_at timestamptz,
  add column assessment_completed_at timestamptz,
  add constraint activity_registration_assessment_time_check check (
    assessment_completed_at is null
    or assessment_started_at is not null and assessment_completed_at >= assessment_started_at
  );

alter table public.assessment_results
  add column teacher_observation text not null default ''
    check (char_length(teacher_observation) <= 3000),
  drop constraint if exists assessment_results_score_check;

alter table public.assessment_results
  add constraint assessment_results_score_check check (score between 0 and 10000);

create table public.assessment_question_results (
  id uuid primary key default gen_random_uuid(),
  activity_registration_id uuid not null
    references public.activity_registrations(id) on delete cascade,
  question_id uuid not null
    references public.assessment_paper_questions(id) on delete restrict,
  outcome text check (outcome in ('independent', 'prompted', 'partial', 'unable', 'not_tested')),
  awarded_score smallint check (awarded_score between 0 and 1000),
  note text not null default '' check (char_length(note) <= 1000),
  assessed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_registration_id, question_id),
  constraint assessment_question_result_shape_check check (
    (outcome is not null or awarded_score is null)
    and (outcome is distinct from 'not_tested' or awarded_score is null)
  )
);

create index assessment_papers_active_idx
  on public.assessment_papers(source, grade_min, grade_max)
  where archived_at is null;
create index assessment_paper_versions_published_idx
  on public.assessment_paper_versions(paper_id, version_no desc)
  where status = 'published';
create index assessment_question_results_registration_idx
  on public.assessment_question_results(activity_registration_id, updated_at desc);

create trigger assessment_papers_set_updated_at
  before update on public.assessment_papers
  for each row execute function public.set_updated_at();
create trigger assessment_paper_versions_set_updated_at
  before update on public.assessment_paper_versions
  for each row execute function public.set_updated_at();
create trigger assessment_question_results_set_updated_at
  before update on public.assessment_question_results
  for each row execute function public.set_updated_at();

create or replace function public.guard_published_assessment_paper_question()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
begin
  v_version_id := case when tg_op = 'DELETE' then old.paper_version_id else new.paper_version_id end;
  if exists (
    select 1 from public.assessment_paper_versions
     where id = v_version_id and status <> 'draft'
  ) then
    raise exception 'ASSESSMENT_PAPER_VERSION_LOCKED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger assessment_paper_questions_draft_only
  before insert or update or delete on public.assessment_paper_questions
  for each row execute function public.guard_published_assessment_paper_question();

create or replace function public.guard_published_assessment_paper_version()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'draft' then
    if tg_op = 'DELETE' then raise exception 'ASSESSMENT_PAPER_VERSION_LOCKED'; end if;
    if new.paper_id is distinct from old.paper_id
       or new.version_no is distinct from old.version_no
       or new.question_count is distinct from old.question_count
       or new.total_score is distinct from old.total_score
       or new.band_thresholds is distinct from old.band_thresholds
       or new.published_at is distinct from old.published_at
       or new.created_by is distinct from old.created_by
       or new.status not in (old.status, 'retired') then
      raise exception 'ASSESSMENT_PAPER_VERSION_LOCKED';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger assessment_paper_versions_published_immutable
  before update or delete on public.assessment_paper_versions
  for each row execute function public.guard_published_assessment_paper_version();

alter table public.assessment_papers enable row level security;
alter table public.assessment_paper_versions enable row level security;
alter table public.assessment_paper_questions enable row level security;
alter table public.assessment_question_results enable row level security;

create policy assessment_papers_staff_select on public.assessment_papers
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy assessment_paper_versions_staff_select on public.assessment_paper_versions
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy assessment_paper_questions_staff_select on public.assessment_paper_questions
  for select to authenticated using (public.is_staff((select auth.uid())));
create policy assessment_question_results_staff_select on public.assessment_question_results
  for select to authenticated using (public.is_staff((select auth.uid())));

revoke all on public.assessment_papers from anon, authenticated;
revoke all on public.assessment_paper_versions from anon, authenticated;
revoke all on public.assessment_paper_questions from anon, authenticated;
revoke all on public.assessment_question_results from anon, authenticated;
grant select on public.assessment_papers to authenticated;
grant select on public.assessment_paper_versions to authenticated;
grant select on public.assessment_paper_questions to authenticated;
grant select on public.assessment_question_results to authenticated;

create or replace function public.can_record_teacher_assessment(
  p_registration_id uuid,
  p_uid uuid
) returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null
     and public.has_perm(p_uid, 'review.write')
     and exists (
       select 1
         from public.activity_registrations registration
         join public.activities activity on activity.id = registration.activity_id
        where registration.id = p_registration_id
          and activity.kind = 'assessment_1v1'
          and activity.deleted_at is null
          and (
            public.has_perm(p_uid, 'student.view.all')
            or registration.student_id is not null
               and public.can_access_student(registration.student_id, p_uid)
            or registration.lead_id is not null
               and exists (
                 select 1
                   from public.lead_invitation_threads invitation
                  where invitation.id = activity.source_invitation_id
                    and invitation.assessor_id = p_uid
               )
          )
     );
$$;

create or replace function public.assessment_band_for_score(
  p_paper_version_id uuid,
  p_score smallint
) returns text
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_total_score numeric;
  v_thresholds jsonb;
  v_percent numeric;
begin
  if p_score is null then return null; end if;
  select total_score, band_thresholds
    into v_total_score, v_thresholds
    from public.assessment_paper_versions
   where id = p_paper_version_id;
  if not found or v_total_score <= 0 then return null; end if;
  v_percent := p_score::numeric * 100 / v_total_score;
  if v_percent >= coalesce((v_thresholds ->> 'c')::numeric, 95) then return 'c'; end if;
  if v_percent >= coalesce((v_thresholds ->> 's')::numeric, 85) then return 's'; end if;
  if v_percent >= coalesce((v_thresholds ->> 'a_plus')::numeric, 70) then return 'a_plus'; end if;
  if v_percent >= coalesce((v_thresholds ->> 'a')::numeric, 55) then return 'a'; end if;
  if v_percent >= coalesce((v_thresholds ->> 'g_plus')::numeric, 40) then return 'g_plus'; end if;
  return 'x_plus';
end;
$$;

create or replace function public.start_invitation_teacher_assessment(
  p_invitation_id uuid
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(), 'review.write') then
    raise exception 'FORBIDDEN';
  end if;
  return public.ensure_invitation_assessment_registration(p_invitation_id);
end;
$$;

create or replace function public.bind_teacher_assessment_paper(
  p_registration_id uuid,
  p_paper_version_id uuid
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_version uuid;
  v_status text;
  v_expected_count integer;
  v_expected_score integer;
  v_actual_count integer;
  v_actual_score integer;
begin
  if not public.can_record_teacher_assessment(p_registration_id, auth.uid()) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  select assessment_paper_version_id, status
    into v_existing_version, v_status
    from public.activity_registrations
   where id = p_registration_id
   for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_status in ('no_show', 'cancelled') then raise exception 'PARTICIPATION_NOT_ASSESSABLE'; end if;
  if v_existing_version is not null
     and v_existing_version is distinct from p_paper_version_id
     and exists (
       select 1 from public.assessment_question_results
        where activity_registration_id = p_registration_id
     ) then
    raise exception 'ASSESSMENT_PAPER_BINDING_LOCKED';
  end if;

  select question_count, total_score
    into v_expected_count, v_expected_score
    from public.assessment_paper_versions
   where id = p_paper_version_id and status = 'published';
  if not found then raise exception 'ASSESSMENT_PAPER_NOT_PUBLISHED'; end if;

  select count(*)::integer, coalesce(sum(max_score), 0)::integer
    into v_actual_count, v_actual_score
    from public.assessment_paper_questions
   where paper_version_id = p_paper_version_id;
  if v_actual_count <> v_expected_count or v_actual_score <> v_expected_score then
    raise exception 'ASSESSMENT_PAPER_INVALID_TOTAL';
  end if;

  update public.activity_registrations
     set assessment_paper_version_id = p_paper_version_id,
         assessment_started_at = case
           when v_existing_version is distinct from p_paper_version_id then null
           else assessment_started_at
         end,
         assessment_completed_at = case
           when v_existing_version is distinct from p_paper_version_id then null
           else assessment_completed_at
         end,
         operated_by = auth.uid()
   where id = p_registration_id;
end;
$$;

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
  if p_outcome is not null
       and p_outcome not in ('independent', 'prompted', 'partial', 'unable', 'not_tested')
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
  if p_score is not null and (p_score < 0 or p_score > v_max_score)
     or p_score is not null and p_outcome is null
     or p_outcome = 'not_tested' and p_score is not null then
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

create or replace function public.save_teacher_assessment_observation(
  p_registration_id uuid,
  p_observation text default ''
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_student_id uuid;
  v_lead_id uuid;
  v_score smallint;
begin
  if not public.can_record_teacher_assessment(p_registration_id, v_uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  if char_length(coalesce(p_observation, '')) > 3000 then
    raise exception 'INVALID_TEACHER_OBSERVATION';
  end if;
  select student_id, lead_id into v_student_id, v_lead_id
    from public.activity_registrations
   where id = p_registration_id
     and assessment_paper_version_id is not null;
  if not found then raise exception 'ASSESSMENT_PAPER_REQUIRED'; end if;
  select coalesce(sum(awarded_score), 0)::smallint into v_score
    from public.assessment_question_results
   where activity_registration_id = p_registration_id;
  insert into public.assessment_results(
    activity_registration_id, student_id, lead_id, overall_level,
    assessment_band, score, teacher_observation, assessed_by
  ) values (
    p_registration_id, v_student_id, v_lead_id, null,
    null, v_score, btrim(coalesce(p_observation, '')), v_uid
  )
  on conflict (activity_registration_id) do update
    set teacher_observation = excluded.teacher_observation,
        assessed_by = excluded.assessed_by;
end;
$$;

create or replace function public.complete_teacher_assessment(
  p_registration_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_version_id uuid;
  v_student_id uuid;
  v_lead_id uuid;
  v_activity_title text;
  v_question_count integer;
  v_answered_count integer;
  v_score smallint;
  v_total_score smallint;
  v_band text;
  v_completed_at timestamptz := now();
begin
  if not public.can_record_teacher_assessment(p_registration_id, v_uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  select registration.assessment_paper_version_id,
         registration.student_id,
         registration.lead_id,
         activity.title,
         version.question_count,
         version.total_score
    into v_version_id, v_student_id, v_lead_id, v_activity_title,
         v_question_count, v_total_score
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
    join public.assessment_paper_versions version
      on version.id = registration.assessment_paper_version_id
   where registration.id = p_registration_id
     and registration.status not in ('no_show', 'cancelled')
   for update of registration;
  if not found then raise exception 'ASSESSMENT_PAPER_REQUIRED'; end if;

  select count(*) filter (where outcome is not null)::integer,
         coalesce(sum(awarded_score), 0)::smallint
    into v_answered_count, v_score
    from public.assessment_question_results
   where activity_registration_id = p_registration_id;
  if v_answered_count <> v_question_count then
    raise exception 'ASSESSMENT_QUESTIONS_INCOMPLETE';
  end if;
  v_band := public.assessment_band_for_score(v_version_id, v_score);

  update public.activity_registrations
     set status = 'attended',
         assessment_started_at = coalesce(assessment_started_at, v_completed_at),
         assessment_completed_at = v_completed_at,
         operated_by = v_uid
   where id = p_registration_id;
  insert into public.assessment_results(
    activity_registration_id, student_id, lead_id, overall_level,
    assessment_band, score, assessed_by
  ) values (
    p_registration_id, v_student_id, v_lead_id, null,
    v_band, v_score, v_uid
  )
  on conflict (activity_registration_id) do update
    set student_id = excluded.student_id,
        lead_id = excluded.lead_id,
        assessment_band = excluded.assessment_band,
        score = excluded.score,
        assessed_by = excluded.assessed_by;

  if v_student_id is not null then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (
      v_student_id,
      v_uid,
      '已完成逐题测评：' || v_activity_title || '；' || v_score || '/' || v_total_score,
      'activity'
    );
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

create or replace function public.get_teacher_assessment_workbench(
  p_registration_id uuid
) returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_registration public.activity_registrations%rowtype;
  v_activity public.activities%rowtype;
  v_grade smallint;
  v_grade_text text := '';
  v_name text;
  v_background text := '';
  v_result public.assessment_results%rowtype;
  v_payload jsonb;
begin
  if not public.can_record_teacher_assessment(p_registration_id, v_uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  select * into v_registration
    from public.activity_registrations where id = p_registration_id;
  select * into v_activity
    from public.activities where id = v_registration.activity_id;
  select * into v_result
    from public.assessment_results where activity_registration_id = p_registration_id;

  if v_registration.student_id is not null then
    select name, grade, remark into v_name, v_grade, v_background
      from public.students where id = v_registration.student_id;
  else
    select provisional_student_name, grade_hint, grade_text
      into v_name, v_grade, v_grade_text
      from public.leads where id = v_registration.lead_id;
  end if;
  if v_activity.source_invitation_id is not null then
    select coalesce(nullif(summary, ''), v_background)
      into v_background
      from public.lead_invitation_threads
     where id = v_activity.source_invitation_id;
  end if;

  select jsonb_build_object(
    'registrationId', v_registration.id,
    'subjectName', coalesce(v_name, '-'),
    'grade', v_grade,
    'gradeText', coalesce(v_grade_text, ''),
    'background', coalesce(v_background, ''),
    'participationStatus', v_registration.status,
    'scheduledAt', v_activity.scheduled_at,
    'location', v_activity.location,
    'startedAt', v_registration.assessment_started_at,
    'completedAt', v_registration.assessment_completed_at,
    'score', v_result.score,
    'assessmentBand', v_result.assessment_band,
    'teacherObservation', coalesce(v_result.teacher_observation, ''),
    'paperVersion', case when version.id is null then null else jsonb_build_object(
      'id', version.id,
      'paperId', paper.id,
      'title', paper.title,
      'source', paper.source,
      'versionNo', version.version_no,
      'questionCount', version.question_count,
      'totalScore', version.total_score,
      'bandThresholds', version.band_thresholds
    ) end,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', question.id,
        'position', question.position,
        'questionNo', question.question_no,
        'prompt', question.prompt,
        'knowledgePoint', question.knowledge_point,
        'maxScore', question.max_score,
        'quickScores', question.quick_scores,
        'result', case when question_result.id is null then null else jsonb_build_object(
          'outcome', question_result.outcome,
          'score', question_result.awarded_score,
          'note', question_result.note,
          'updatedAt', question_result.updated_at
        ) end
      ) order by question.position)
        from public.assessment_paper_questions question
        left join public.assessment_question_results question_result
          on question_result.question_id = question.id
         and question_result.activity_registration_id = v_registration.id
       where question.paper_version_id = version.id
    ), '[]'::jsonb),
    'paperOptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', option_version.id,
        'paperId', option_paper.id,
        'title', option_paper.title,
        'source', option_paper.source,
        'versionNo', option_version.version_no,
        'questionCount', option_version.question_count,
        'totalScore', option_version.total_score
      ) order by option_paper.source, option_paper.title, option_version.version_no desc)
        from public.assessment_paper_versions option_version
        join public.assessment_papers option_paper on option_paper.id = option_version.paper_id
       where option_version.status = 'published'
         and option_paper.archived_at is null
         and (v_grade is null or option_paper.grade_min is null or option_paper.grade_min <= v_grade)
         and (v_grade is null or option_paper.grade_max is null or option_paper.grade_max >= v_grade)
    ), '[]'::jsonb)
  ) into v_payload
    from (select 1) anchor
    left join public.assessment_paper_versions version
      on version.id = v_registration.assessment_paper_version_id
    left join public.assessment_papers paper on paper.id = version.paper_id;

  return v_payload;
end;
$$;

-- Aggregate entry must accept the total defined by a bound paper. Keep the
-- existing smallint RPC signature for callers, but remove the former 100-point
-- UI-era ceiling.
create or replace function public.save_activity_assessment_row(
  p_registration_id uuid,
  p_assessment_band text default null,
  p_score smallint default null,
  p_strengths text default '',
  p_focus_areas text default '',
  p_parent_concerns text default '',
  p_teacher_recommendation text default '',
  p_recommended_class text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  activity_title text;
  result_id uuid;
  is_new boolean;
begin
  if uid is null or not public.has_perm(uid, 'review.write') then raise exception 'FORBIDDEN'; end if;
  if (p_assessment_band is not null
       and p_assessment_band not in ('below_a', 'x_plus', 'g_plus', 'a', 'a_plus', 's', 'c'))
     or (p_score is not null and p_score not between 0 and 10000)
     or char_length(coalesce(p_strengths, '')) > 2000
     or char_length(coalesce(p_focus_areas, '')) > 2000
     or char_length(coalesce(p_parent_concerns, '')) > 2000
     or char_length(coalesce(p_teacher_recommendation, '')) > 2000
     or char_length(coalesce(p_recommended_class, '')) > 200 then
    raise exception 'INVALID_ASSESSMENT';
  end if;
  if p_assessment_band = 'below_a' and not exists (
    select 1 from public.assessment_results
     where activity_registration_id = p_registration_id and assessment_band = 'below_a'
  ) then raise exception 'INVALID_ASSESSMENT'; end if;
  perform public.begin_activity_assessment(p_registration_id);
  select registration.student_id, activity.title into sid, activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id and activity.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  is_new := not exists (select 1 from public.assessment_results where activity_registration_id = p_registration_id);
  insert into public.assessment_results(
    activity_registration_id, student_id, overall_level, assessment_band, score,
    strengths, focus_areas, parent_concerns, teacher_recommendation,
    recommended_class, assessed_by
  ) values (
    p_registration_id, sid, null, p_assessment_band, p_score,
    btrim(coalesce(p_strengths, '')), btrim(coalesce(p_focus_areas, '')),
    btrim(coalesce(p_parent_concerns, '')), btrim(coalesce(p_teacher_recommendation, '')),
    btrim(coalesce(p_recommended_class, '')), uid
  )
  on conflict (activity_registration_id) do update
    set assessment_band = excluded.assessment_band, score = excluded.score,
        strengths = excluded.strengths, focus_areas = excluded.focus_areas,
        parent_concerns = excluded.parent_concerns,
        teacher_recommendation = excluded.teacher_recommendation,
        recommended_class = excluded.recommended_class, assessed_by = excluded.assessed_by
  returning id into result_id;
  if is_new then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (sid, uid, '已填写测评记录：' || activity_title, 'activity');
  end if;
  return result_id;
end;
$$;

create or replace function public.save_invitation_assessment_row(
  p_invitation_id uuid,
  p_assessment_band text default null,
  p_score smallint default null,
  p_strengths text default '',
  p_focus_areas text default '',
  p_parent_concerns text default '',
  p_teacher_recommendation text default '',
  p_recommended_class text default ''
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_registration_id uuid;
  v_student_id uuid;
  v_lead_id uuid;
  v_activity_title text;
  v_result_id uuid;
  v_is_new boolean;
begin
  if v_uid is null or not public.has_perm(v_uid, 'review.write') then raise exception 'FORBIDDEN'; end if;
  if (p_assessment_band is not null
       and p_assessment_band not in ('below_a', 'x_plus', 'g_plus', 'a', 'a_plus', 's', 'c'))
     or (p_score is not null and p_score not between 0 and 10000)
     or char_length(coalesce(p_strengths, '')) > 2000
     or char_length(coalesce(p_focus_areas, '')) > 2000
     or char_length(coalesce(p_parent_concerns, '')) > 2000
     or char_length(coalesce(p_teacher_recommendation, '')) > 2000
     or char_length(coalesce(p_recommended_class, '')) > 200 then
    raise exception 'INVALID_ASSESSMENT';
  end if;
  v_registration_id := public.ensure_invitation_assessment_registration(p_invitation_id);
  if p_assessment_band = 'below_a' and not exists (
    select 1 from public.assessment_results
     where activity_registration_id = v_registration_id and assessment_band = 'below_a'
  ) then raise exception 'INVALID_ASSESSMENT'; end if;
  select registration.student_id, registration.lead_id, activity.title
    into v_student_id, v_lead_id, v_activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = v_registration_id and activity.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_is_new := not exists (select 1 from public.assessment_results where activity_registration_id = v_registration_id);
  insert into public.assessment_results(
    activity_registration_id, student_id, lead_id, overall_level, assessment_band, score,
    strengths, focus_areas, parent_concerns, teacher_recommendation, recommended_class, assessed_by
  ) values (
    v_registration_id, v_student_id, v_lead_id, null, p_assessment_band, p_score,
    btrim(coalesce(p_strengths, '')), btrim(coalesce(p_focus_areas, '')),
    btrim(coalesce(p_parent_concerns, '')), btrim(coalesce(p_teacher_recommendation, '')),
    btrim(coalesce(p_recommended_class, '')), v_uid
  )
  on conflict (activity_registration_id) do update
    set student_id = excluded.student_id, lead_id = excluded.lead_id,
        assessment_band = excluded.assessment_band, score = excluded.score,
        strengths = excluded.strengths, focus_areas = excluded.focus_areas,
        parent_concerns = excluded.parent_concerns,
        teacher_recommendation = excluded.teacher_recommendation,
        recommended_class = excluded.recommended_class, assessed_by = excluded.assessed_by
  returning id into v_result_id;
  if v_is_new and v_student_id is not null then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (v_student_id, v_uid, '已填写测评记录：' || v_activity_title, 'activity');
  end if;
  return jsonb_build_object('registrationId', v_registration_id, 'assessmentId', v_result_id);
end;
$$;

revoke all on function public.guard_published_assessment_paper_question() from public, anon, authenticated;
revoke all on function public.guard_published_assessment_paper_version() from public, anon, authenticated;
revoke all on function public.can_record_teacher_assessment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.assessment_band_for_score(uuid, smallint) from public, anon, authenticated;
revoke all on function public.start_invitation_teacher_assessment(uuid) from public, anon, authenticated;
revoke all on function public.bind_teacher_assessment_paper(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_teacher_assessment_question(uuid, uuid, text, smallint, text) from public, anon, authenticated;
revoke all on function public.save_teacher_assessment_observation(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_teacher_assessment(uuid) from public, anon, authenticated;
revoke all on function public.get_teacher_assessment_workbench(uuid) from public, anon, authenticated;

grant execute on function public.start_invitation_teacher_assessment(uuid) to authenticated;
grant execute on function public.bind_teacher_assessment_paper(uuid, uuid) to authenticated;
grant execute on function public.save_teacher_assessment_question(uuid, uuid, text, smallint, text) to authenticated;
grant execute on function public.save_teacher_assessment_observation(uuid, text) to authenticated;
grant execute on function public.complete_teacher_assessment(uuid) to authenticated;
grant execute on function public.get_teacher_assessment_workbench(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
