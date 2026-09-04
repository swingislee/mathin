-- DEV-SCHOOL-OPS-1 / Phase 2 aggregate assessment workbench.
--
-- A confirmed 1:1 invitation is still a Lead fact. It must be visible to the
-- assigned assessor without prematurely creating a Student identity. The first
-- assessment edit atomically materializes the private Activity/Participation,
-- marks it attended, closes the invitation handoff, and stores the assessment
-- against either the Lead or an already-confirmed Student. If that Lead is
-- converted later, the same facts are rebound instead of copied.

alter table public.activities
  add column source_invitation_id uuid unique
    references public.lead_invitation_threads(id) on delete set null;

comment on column public.activities.source_invitation_id is
  'Private 1:1 assessment activity materialized from a confirmed invitation when assessment entry begins.';

alter table public.activity_registrations
  add column lead_id uuid references public.leads(id) on delete cascade,
  alter column student_id drop not null,
  add constraint activity_registrations_subject_check check (
    num_nonnulls(student_id, lead_id) = 1
  );

create unique index activity_registrations_activity_lead_idx
  on public.activity_registrations(activity_id, lead_id)
  where lead_id is not null;
create index activity_registrations_lead_idx
  on public.activity_registrations(lead_id, updated_at desc)
  where lead_id is not null;

comment on column public.activity_registrations.lead_id is
  'Lead-side participant before identity confirmation. Exactly one of lead_id or student_id is present.';

alter table public.assessment_results
  add column lead_id uuid references public.leads(id) on delete cascade,
  alter column student_id drop not null,
  add constraint assessment_results_subject_check check (
    num_nonnulls(student_id, lead_id) = 1
  );

create index assessment_results_lead_idx
  on public.assessment_results(lead_id, updated_at desc)
  where lead_id is not null;

alter table public.activity_routes
  add column lead_id uuid references public.leads(id) on delete restrict,
  alter column student_id drop not null,
  add constraint activity_routes_subject_check check (
    num_nonnulls(student_id, lead_id) = 1
  );

create index activity_routes_lead_idx
  on public.activity_routes(lead_id, updated_at desc)
  where lead_id is not null;

-- Assigned assessors retain read access to the lead identity after the
-- invitation itself is closed by the first assessment write.
create policy leads_select_assessment_assessor on public.leads
  for select to authenticated using (
    public.has_perm((select auth.uid()), 'review.write')
    and exists (
      select 1
        from public.activities activity
        join public.lead_invitation_threads invitation
          on invitation.id = activity.source_invitation_id
       where invitation.lead_id = leads.id
         and invitation.assessor_id = (select auth.uid())
         and activity.deleted_at is null
    )
  );

create policy activity_routes_assessment_assessor_select on public.activity_routes
  for select to authenticated using (
    public.has_perm((select auth.uid()), 'review.write')
    and exists (
      select 1
        from public.activity_registrations registration
        join public.activities activity on activity.id = registration.activity_id
        join public.lead_invitation_threads invitation
          on invitation.id = activity.source_invitation_id
       where registration.id = activity_routes.activity_registration_id
         and invitation.assessor_id = (select auth.uid())
         and activity.deleted_at is null
    )
  );

create or replace function public.ensure_invitation_assessment_registration(
  p_invitation_id uuid
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_invitation public.lead_invitation_threads%rowtype;
  v_lead public.leads%rowtype;
  v_activity_id uuid;
  v_registration_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'review.write') then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_invitation
    from public.lead_invitation_threads
   where id = p_invitation_id
   for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_invitation.kind <> 'assessment_1v1' then raise exception 'INVALID_INVITATION'; end if;
  if v_invitation.assessor_id is distinct from v_uid
     and not public.has_perm(v_uid, 'student.view.all') then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  select registration.id
    into v_registration_id
    from public.activities activity
    join public.activity_registrations registration
      on registration.activity_id = activity.id
   where activity.source_invitation_id = v_invitation.id
     and activity.deleted_at is null
   limit 1;
  if v_registration_id is not null then return v_registration_id; end if;

  if v_invitation.state <> 'confirmed' or v_invitation.scheduled_at is null then
    raise exception 'INVITATION_NOT_CONFIRMED';
  end if;

  select * into v_lead from public.leads where id = v_invitation.lead_id;
  if not found then raise exception 'NOT_FOUND'; end if;

  insert into public.activities(
    kind, title, scheduled_at, location, remark, created_by, source_invitation_id
  ) values (
    'assessment_1v1',
    '1 对 1 测评',
    v_invitation.scheduled_at,
    v_invitation.location_text,
    '由已确认邀约自动进入测评登记',
    v_uid,
    v_invitation.id
  ) returning id into v_activity_id;

  insert into public.activity_registrations(
    activity_id, student_id, lead_id, status, operated_by
  ) values (
    v_activity_id,
    v_lead.student_id,
    case when v_lead.student_id is null then v_lead.id else null end,
    'attended',
    v_uid
  ) returning id into v_registration_id;

  update public.lead_invitation_threads
     set state = 'completed',
         updated_by = v_uid,
         closed_by = v_uid,
         closed_at = now()
   where id = v_invitation.id;

  insert into public.lead_invitation_events(
    invitation_id, from_state, to_state, channel, note, recorded_by
  ) values (
    v_invitation.id,
    v_invitation.state,
    'completed',
    'in_person',
    '已开始 1 对 1 测评登记',
    v_uid
  );

  perform public.emit_domain_event(
    'lead.assessment.started',
    'lead_invitation',
    v_invitation.id,
    jsonb_build_object(
      'leadId', v_invitation.lead_id,
      'activityId', v_activity_id,
      'registrationId', v_registration_id
    ),
    v_uid,
    null
  );

  return v_registration_id;
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

  v_registration_id := public.ensure_invitation_assessment_registration(p_invitation_id);

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

create or replace function public.save_invitation_assessment_route(
  p_invitation_id uuid,
  p_route text,
  p_note text default ''
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

  v_registration_id := public.ensure_invitation_assessment_registration(p_invitation_id);

  select registration.student_id, registration.lead_id, activity.title
    into v_student_id, v_lead_id, v_activity_title
    from public.activity_registrations registration
    join public.activities activity on activity.id = registration.activity_id
   where registration.id = v_registration_id
     and registration.status = 'attended'
     and activity.deleted_at is null;
  if not found then raise exception 'PARTICIPATION_NOT_ATTENDED'; end if;

  select route into v_previous_route
    from public.activity_routes
   where activity_registration_id = v_registration_id;

  insert into public.activity_routes(
    activity_registration_id, student_id, lead_id, route, note, routed_by
  ) values (
    v_registration_id, v_student_id, v_lead_id,
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
    'registrationId', v_registration_id,
    'routeId', v_route_id
  );
end;
$$;

-- Identity confirmation changes the subject pointer in place. Assessment and
-- routing history therefore appears in Student 360 without a duplicate copy.
create or replace function public.rebind_lead_assessment_history()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.student_id is null or new.student_id is not distinct from old.student_id then
    return new;
  end if;

  update public.assessment_results
     set student_id = new.student_id, lead_id = null
   where lead_id = new.id;
  update public.activity_routes
     set student_id = new.student_id, lead_id = null
   where lead_id = new.id;
  update public.activity_registrations
     set student_id = new.student_id, lead_id = null
   where lead_id = new.id;
  return new;
end;
$$;

create trigger leads_rebind_assessment_history
  after update of student_id on public.leads
  for each row
  when (new.student_id is not null and new.student_id is distinct from old.student_id)
  execute function public.rebind_lead_assessment_history();

revoke all on function public.ensure_invitation_assessment_registration(uuid)
  from public, anon, authenticated;
revoke all on function public.save_invitation_assessment_row(uuid, text, smallint, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.save_invitation_assessment_route(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.rebind_lead_assessment_history()
  from public, anon, authenticated;

grant execute on function public.save_invitation_assessment_row(uuid, text, smallint, text, text, text, text, text)
  to authenticated;
grant execute on function public.save_invitation_assessment_route(uuid, text, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
