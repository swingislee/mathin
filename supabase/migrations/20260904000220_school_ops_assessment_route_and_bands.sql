-- DEV-SCHOOL-OPS-1 / Phase 2 review correction:
-- 1. A route selected from the aggregate assessment workbench is itself an
--    on-site assessment edit, so it atomically marks a booked row attended.
-- 2. The operational band order is X+ < G+ < A < A+ < S < C. The former
--    `below_a` value remains readable only for rows that already store it.

alter table public.assessment_results
  drop constraint if exists assessment_results_assessment_band_check;

alter table public.assessment_results
  add constraint assessment_results_assessment_band_check
  check (assessment_band in ('below_a', 'x_plus', 'g_plus', 'a', 'a_plus', 's', 'c'));

comment on column public.assessment_results.assessment_band is
  'Assessment band. New entry uses X+, G+, A, A+, S, C; below_a is retained only for legacy rows.';

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
  if (p_assessment_band is not null
       and p_assessment_band not in ('below_a', 'x_plus', 'g_plus', 'a', 'a_plus', 's', 'c'))
     or (p_score is not null and p_score not between 0 and 100)
     or char_length(coalesce(p_strengths, '')) > 2000
     or char_length(coalesce(p_focus_areas, '')) > 2000
     or char_length(coalesce(p_parent_concerns, '')) > 2000
     or char_length(coalesce(p_teacher_recommendation, '')) > 2000
     or char_length(coalesce(p_recommended_class, '')) > 200 then
    raise exception 'INVALID_ASSESSMENT';
  end if;
  if p_assessment_band = 'below_a'
     and not exists (
       select 1
         from public.assessment_results
        where activity_registration_id = p_registration_id
          and assessment_band = 'below_a'
     ) then
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
  if v_uid is null or not public.has_perm(v_uid, 'review.write') then
    raise exception 'FORBIDDEN';
  end if;
  if (p_assessment_band is not null
       and p_assessment_band not in ('below_a', 'x_plus', 'g_plus', 'a', 'a_plus', 's', 'c'))
     or (p_score is not null and p_score not between 0 and 100)
     or char_length(coalesce(p_strengths, '')) > 2000
     or char_length(coalesce(p_focus_areas, '')) > 2000
     or char_length(coalesce(p_parent_concerns, '')) > 2000
     or char_length(coalesce(p_teacher_recommendation, '')) > 2000
     or char_length(coalesce(p_recommended_class, '')) > 200 then
    raise exception 'INVALID_ASSESSMENT';
  end if;

  v_registration_id := public.ensure_invitation_assessment_registration(p_invitation_id);

  if p_assessment_band = 'below_a'
     and not exists (
       select 1
         from public.assessment_results
        where activity_registration_id = v_registration_id
          and assessment_band = 'below_a'
     ) then
    raise exception 'INVALID_ASSESSMENT';
  end if;

  select registration.student_id, registration.lead_id, activity.title
    into v_student_id, v_lead_id, v_activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = v_registration_id
     and activity.deleted_at is null;
  if not found then raise exception 'NOT_FOUND'; end if;

  v_is_new := not exists (
    select 1 from public.assessment_results
     where activity_registration_id = v_registration_id
  );

  insert into public.assessment_results(
    activity_registration_id, student_id, lead_id, overall_level,
    assessment_band, score, strengths, focus_areas, parent_concerns,
    teacher_recommendation, recommended_class, assessed_by
  ) values (
    v_registration_id, v_student_id, v_lead_id, null,
    p_assessment_band, p_score,
    btrim(coalesce(p_strengths, '')),
    btrim(coalesce(p_focus_areas, '')),
    btrim(coalesce(p_parent_concerns, '')),
    btrim(coalesce(p_teacher_recommendation, '')),
    btrim(coalesce(p_recommended_class, '')),
    v_uid
  )
  on conflict (activity_registration_id) do update
    set student_id = excluded.student_id,
        lead_id = excluded.lead_id,
        assessment_band = excluded.assessment_band,
        score = excluded.score,
        strengths = excluded.strengths,
        focus_areas = excluded.focus_areas,
        parent_concerns = excluded.parent_concerns,
        teacher_recommendation = excluded.teacher_recommendation,
        recommended_class = excluded.recommended_class,
        assessed_by = excluded.assessed_by
  returning id into v_result_id;

  if v_is_new and v_student_id is not null then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (v_student_id, v_uid, '已填写测评记录：' || v_activity_title, 'activity');
  end if;

  return jsonb_build_object(
    'registrationId', v_registration_id,
    'assessmentId', v_result_id
  );
end;
$$;

create or replace function public.save_assessment_workbench_route(
  p_registration_id uuid,
  p_route text,
  p_note text default ''
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_student_id uuid;
  v_lead_id uuid;
  v_status text;
  v_activity_kind text;
  v_activity_title text;
  v_previous_route text;
  v_route_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'review.write') then
    raise exception 'FORBIDDEN';
  end if;
  if p_route not in ('enrollment_pending', 'continue_follow_up', 'await_product', 'closed')
     or char_length(coalesce(p_note, '')) > 2000 then
    raise exception 'INVALID_ACTIVITY_ROUTE';
  end if;

  select registration.student_id, registration.lead_id, registration.status,
         activity.kind, activity.title
    into v_student_id, v_lead_id, v_status, v_activity_kind, v_activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = p_registration_id
     and activity.deleted_at is null
   for update of registration;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_activity_kind <> 'assessment_1v1' then raise exception 'INVALID_ACTIVITY_ROUTE'; end if;
  if v_status = 'cancelled' then raise exception 'PARTICIPATION_CANCELLED'; end if;

  if v_status <> 'attended' then
    update public.activity_registrations
       set status = 'attended', operated_by = v_uid
     where id = p_registration_id;

    if v_student_id is not null then
      insert into public.student_follow_ups(student_id, author_id, content, kind)
      values (v_student_id, v_uid, '活动到场：' || v_activity_title, 'activity');
    end if;
  end if;

  select route into v_previous_route
    from public.activity_routes
   where activity_registration_id = p_registration_id;

  insert into public.activity_routes(
    activity_registration_id, student_id, lead_id, route, note, routed_by
  ) values (
    p_registration_id, v_student_id, v_lead_id,
    p_route, btrim(coalesce(p_note, '')), v_uid
  )
  on conflict (activity_registration_id) do update
    set student_id = excluded.student_id,
        lead_id = excluded.lead_id,
        route = excluded.route,
        note = excluded.note,
        routed_by = excluded.routed_by
  returning id into v_route_id;

  if v_previous_route is distinct from p_route and v_student_id is not null then
    insert into public.student_follow_ups(student_id, author_id, content, kind)
    values (
      v_student_id,
      v_uid,
      '到访后结果：' || v_activity_title || '；' || case p_route
        when 'enrollment_pending' then '当场确认报名，待录报名'
        when 'continue_follow_up' then '未报名，继续沟通'
        when 'await_product' then '待产品投放'
        else '本轮结束'
      end,
      'activity'
    );
  end if;

  return jsonb_build_object(
    'registrationId', p_registration_id,
    'routeId', v_route_id
  );
end;
$$;

revoke all on function public.save_assessment_workbench_route(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.save_assessment_workbench_route(uuid, text, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
