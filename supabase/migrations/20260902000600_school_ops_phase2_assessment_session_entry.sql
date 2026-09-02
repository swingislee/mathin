-- DEV-SCHOOL-OPS-1 / Phase 2 UX correction: one assessment-session row may
-- write several structured facts, while assessment authorship remains a
-- review.write responsibility instead of being implied by roster management.

alter table public.activity_routes
  drop constraint if exists activity_routes_route_check;

alter table public.activity_routes
  add constraint activity_routes_route_check
  check (route in ('enrollment_pending', 'continue_follow_up', 'await_product', 'closed'));

create or replace function public.begin_activity_assessment(p_registration_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  activity_title text;
  participation_status text;
begin
  if uid is null or not public.has_perm(uid, 'review.write') then
    raise exception 'FORBIDDEN';
  end if;

  select registration.student_id, registration.status, activity.title
    into sid, participation_status, activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id
     and activity.deleted_at is null
   for update of registration;
  if not found then raise exception 'NOT_FOUND'; end if;
  if participation_status = 'cancelled' then raise exception 'PARTICIPATION_CANCELLED'; end if;
  if participation_status = 'attended' then return; end if;

  update public.activity_registrations
     set status = 'attended', operated_by = uid
   where id = p_registration_id;

  insert into public.student_follow_ups(student_id, author_id, content, kind)
  values (sid, uid, '活动到场：' || activity_title, 'activity');
end;
$$;

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
  if uid is null or not public.has_perm(uid, 'review.write') then
    raise exception 'FORBIDDEN';
  end if;
  if p_assessment_band is not null
       and p_assessment_band not in ('below_a', 'a', 'a_plus', 'g_plus', 's', 'x_plus')
     or p_score is not null and p_score not between 0 and 100
     or char_length(coalesce(p_strengths, '')) > 2000
     or char_length(coalesce(p_focus_areas, '')) > 2000
     or char_length(coalesce(p_parent_concerns, '')) > 2000
     or char_length(coalesce(p_teacher_recommendation, '')) > 2000
     or char_length(coalesce(p_recommended_class, '')) > 200 then
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
    activity_registration_id, student_id, overall_level, assessment_band, score,
    strengths, focus_areas, parent_concerns, teacher_recommendation,
    recommended_class, assessed_by
  ) values (
    p_registration_id, sid, null, p_assessment_band, p_score,
    btrim(coalesce(p_strengths, '')),
    btrim(coalesce(p_focus_areas, '')),
    btrim(coalesce(p_parent_concerns, '')),
    btrim(coalesce(p_teacher_recommendation, '')),
    btrim(coalesce(p_recommended_class, '')),
    uid
  )
  on conflict (activity_registration_id) do update
    set assessment_band = excluded.assessment_band,
        score = excluded.score,
        strengths = excluded.strengths,
        focus_areas = excluded.focus_areas,
        parent_concerns = excluded.parent_concerns,
        teacher_recommendation = excluded.teacher_recommendation,
        recommended_class = excluded.recommended_class,
        assessed_by = excluded.assessed_by
  returning id into result_id;

  if is_new then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (sid, uid, '已填写测评记录：' || activity_title, 'activity');
  end if;

  return result_id;
end;
$$;

create or replace function public.save_activity_route(
  p_registration_id uuid,
  p_route text,
  p_note text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  participation_status text;
  activity_title text;
  previous_route text;
  route_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'followup.write') then
    raise exception 'FORBIDDEN';
  end if;
  if p_route not in ('enrollment_pending', 'continue_follow_up', 'await_product', 'closed')
     or char_length(coalesce(p_note, '')) > 2000 then
    raise exception 'INVALID_ACTIVITY_ROUTE';
  end if;

  select registration.student_id, registration.status, activity.title
    into sid, participation_status, activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id
     and activity.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;
  if participation_status <> 'attended' then raise exception 'PARTICIPATION_NOT_ATTENDED'; end if;
  if not public.can_access_student(sid, uid) then raise exception 'FORBIDDEN_SCOPE'; end if;

  select route into previous_route
    from public.activity_routes
   where activity_registration_id = p_registration_id;

  insert into public.activity_routes (
    activity_registration_id, student_id, route, note, routed_by
  ) values (
    p_registration_id, sid, p_route, btrim(coalesce(p_note, '')), uid
  )
  on conflict (activity_registration_id) do update
    set route = excluded.route,
        note = excluded.note,
        routed_by = excluded.routed_by
  returning id into route_id;

  if previous_route is distinct from p_route then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (
      sid,
      uid,
      '到访后结果：' || activity_title || '；' || case p_route
        when 'enrollment_pending' then '当场确认报名，待录报名'
        when 'continue_follow_up' then '未报名，继续沟通'
        when 'await_product' then '待产品投放'
        else '本轮结束'
      end,
      'activity'
    );
  end if;

  return route_id;
end;
$$;

revoke all on function public.begin_activity_assessment(uuid)
  from public, anon, authenticated;
revoke all on function public.save_activity_assessment_row(uuid, text, smallint, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.save_activity_route(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.begin_activity_assessment(uuid)
  to authenticated;
grant execute on function public.save_activity_assessment_row(uuid, text, smallint, text, text, text, text, text)
  to authenticated;
grant execute on function public.save_activity_route(uuid, text, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
