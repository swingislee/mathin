-- DEV-SCHOOL-OPS-1 / Phase 2: entering a score is an explicit attendance signal.
-- Reviewers can start an assessment without first needing activity.register.

create or replace function public.begin_activity_assessment(p_registration_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  activity_kind text;
  activity_title text;
  participation_status text;
  current_follow text;
begin
  if uid is null or not (
    public.has_perm(uid, 'activity.register')
    or public.has_perm(uid, 'review.write')
  ) then
    raise exception 'FORBIDDEN';
  end if;

  select registration.student_id, registration.status, activity.kind, activity.title
    into sid, participation_status, activity_kind, activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id
     and activity.deleted_at is null
   for update of registration;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not public.has_perm(uid, 'review.write')
     and not public.can_access_student(sid, uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  if participation_status = 'attended' then return; end if;

  update public.activity_registrations
     set status = 'attended', operated_by = uid
   where id = p_registration_id;

  select follow_up_status into current_follow
    from public.students
   where id = sid;
  if activity_kind in ('trial_class', 'assessment_1v1', 'sanbanfu') then
    if current_follow = 'pending' then
      update public.students set follow_up_status = 'following' where id = sid;
      current_follow := 'following';
    end if;
    if current_follow = 'following' then
      update public.students set follow_up_status = 'invited' where id = sid;
      current_follow := 'invited';
    end if;
    if current_follow = 'invited' then
      update public.students set follow_up_status = 'trialed' where id = sid;
    end if;
  end if;

  insert into public.student_follow_ups(student_id, author_id, content, kind)
  values (sid, uid, '活动到场：' || activity_title, 'activity');
end;
$$;

-- Keep the existing manual booking and attendance controls on the same legal
-- lifecycle edges as the score-driven shortcut.
create or replace function public.book_activity(
  p_activity_id uuid,
  p_student_id uuid
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cap smallint;
  used integer;
  activity_title text;
  registration_id uuid;
  current_follow text;
begin
  if uid is null or not public.has_perm(uid, 'activity.register') then raise exception 'FORBIDDEN'; end if;
  if not public.can_access_student(p_student_id, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  select capacity, title into cap, activity_title
    from public.activities
   where id = p_activity_id and deleted_at is null
   for update;
  if activity_title is null then raise exception 'ACTIVITY_NOT_FOUND'; end if;
  select count(*) into used
    from public.activity_registrations
   where activity_id = p_activity_id and status in ('booked', 'attended');
  if cap is not null and used >= cap and not exists (
    select 1 from public.activity_registrations
     where activity_id = p_activity_id
       and student_id = p_student_id
       and status in ('booked', 'attended')
  ) then
    raise exception 'ACTIVITY_FULL';
  end if;

  insert into public.activity_registrations(activity_id, student_id, status, operated_by)
  values (p_activity_id, p_student_id, 'booked', uid)
  on conflict(activity_id, student_id) do update
    set status = 'booked', outcome = '', operated_by = uid
  returning id into registration_id;

  select follow_up_status into current_follow from public.students where id = p_student_id;
  if current_follow = 'pending' then
    update public.students set follow_up_status = 'following' where id = p_student_id;
    current_follow := 'following';
  end if;
  if current_follow = 'following' then
    update public.students set follow_up_status = 'invited' where id = p_student_id;
  end if;

  insert into public.student_follow_ups(student_id, author_id, content, kind)
  values (p_student_id, uid, '报名活动：' || activity_title, 'activity');
  return registration_id;
end;
$$;

create or replace function public.mark_activity_result(
  p_registration_id uuid,
  p_status text,
  p_outcome text default ''
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  activity_kind text;
  activity_title text;
  current_follow text;
begin
  if uid is null or not public.has_perm(uid, 'activity.register') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('attended', 'no_show', 'cancelled') then raise exception 'INVALID_STATUS'; end if;
  select registration.student_id, activity.kind, activity.title
    into sid, activity_kind, activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id;
  if sid is null then raise exception 'NOT_FOUND'; end if;
  if not public.can_access_student(sid, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;

  update public.activity_registrations
     set status = p_status,
         outcome = left(btrim(coalesce(p_outcome, '')), 1000),
         operated_by = uid
   where id = p_registration_id;

  select follow_up_status into current_follow from public.students where id = sid;
  if p_status = 'attended' and activity_kind in ('trial_class', 'assessment_1v1', 'sanbanfu') then
    if current_follow = 'pending' then
      update public.students set follow_up_status = 'following' where id = sid;
      current_follow := 'following';
    end if;
    if current_follow = 'following' then
      update public.students set follow_up_status = 'invited' where id = sid;
      current_follow := 'invited';
    end if;
    if current_follow = 'invited' then
      update public.students set follow_up_status = 'trialed' where id = sid;
    end if;
  end if;

  insert into public.student_follow_ups(student_id, author_id, content, kind)
  values (
    sid,
    uid,
    case p_status
      when 'attended' then '活动到场：'
      when 'no_show' then '活动爽约：'
      else '取消活动：'
    end || activity_title || case
      when btrim(coalesce(p_outcome, '')) <> '' then '；' || left(btrim(p_outcome), 1000)
      else ''
    end,
    'activity'
  );
end;
$$;

create or replace function public.save_activity_assessment(
  p_registration_id uuid,
  p_overall_level text,
  p_score smallint default null,
  p_strengths text default '',
  p_focus_areas text default '',
  p_teacher_recommendation text default ''
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
  if uid is null or not (
    public.has_perm(uid, 'activity.register')
    or public.has_perm(uid, 'review.write')
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if p_overall_level not in ('needs_support', 'developing', 'on_track', 'advanced')
     or p_score is not null and p_score not between 0 and 100
     or btrim(coalesce(p_teacher_recommendation, '')) = ''
     or char_length(coalesce(p_strengths, '')) > 2000
     or char_length(coalesce(p_focus_areas, '')) > 2000
     or char_length(coalesce(p_teacher_recommendation, '')) > 2000 then
    raise exception 'INVALID_ASSESSMENT';
  end if;

  perform public.begin_activity_assessment(p_registration_id);

  select registration.student_id, activity.title
    into sid, activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id
     and activity.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;

  is_new := not exists (
    select 1 from public.assessment_results
     where activity_registration_id = p_registration_id
  );

  insert into public.assessment_results (
    activity_registration_id, student_id, overall_level, score, strengths,
    focus_areas, teacher_recommendation, assessed_by
  ) values (
    p_registration_id, sid, p_overall_level, p_score,
    btrim(coalesce(p_strengths, '')),
    btrim(coalesce(p_focus_areas, '')),
    btrim(p_teacher_recommendation), uid
  )
  on conflict (activity_registration_id) do update
    set overall_level = excluded.overall_level,
        score = excluded.score,
        strengths = excluded.strengths,
        focus_areas = excluded.focus_areas,
        teacher_recommendation = excluded.teacher_recommendation,
        assessed_by = excluded.assessed_by
  returning id into result_id;

  if is_new then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (
      sid,
      uid,
      '测评结果：' || activity_title || '；' || btrim(p_teacher_recommendation),
      'activity'
    );
  end if;

  return result_id;
end;
$$;

revoke all on function public.begin_activity_assessment(uuid)
  from public, anon, authenticated;
grant execute on function public.begin_activity_assessment(uuid)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
