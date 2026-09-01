begin;

do $$
declare
  actor_id uuid;
  target_student_id uuid;
  activity_id uuid;
  registration_id uuid;
  booked_registration_id uuid;
  assessment_id uuid;
  opportunity_id uuid;
  rejected boolean := false;
begin
  select id into actor_id
    from public.profiles
   where role = 'admin' and is_active
   order by created_at
   limit 1;
  if actor_id is null then raise exception 'PHASE2_ADMIN_FIXTURE_REQUIRED'; end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  if not public.has_perm(actor_id, 'activity.register')
     or not public.has_perm(actor_id, 'followup.write') then
    raise exception 'PHASE2_ADMIN_PERMISSIONS_REQUIRED';
  end if;

  target_student_id := public.create_student(
    'Phase 2 assertion student', 5::smallint, '', '', 'phase2-assertion', '', '', ''
  );
  insert into public.activities(kind, title, scheduled_at, duration_min, location, created_by)
  values ('assessment_1v1', 'Phase 2 assertion activity', now(), 60, 'local assertion', actor_id)
  returning id into activity_id;
  insert into public.activity_registrations(activity_id, student_id, status, operated_by)
  values (activity_id, target_student_id, 'attended', actor_id)
  returning id into registration_id;

  assessment_id := public.save_activity_assessment(
    registration_id,
    'on_track',
    86::smallint,
    'Pattern recognition',
    'Written explanation',
    'Recommend the next level course'
  );
  if assessment_id is null or not exists (
    select 1 from public.assessment_results
     where id = assessment_id
       and activity_registration_id = registration_id
       and student_id = target_student_id
       and score = 86
  ) then
    raise exception 'PHASE2_ASSESSMENT_NOT_PERSISTED';
  end if;

  insert into public.activity_registrations(activity_id, student_id, status, operated_by)
  values (activity_id, public.create_student('Phase 2 booked student', 4::smallint, '', '', 'phase2-assertion', '', '', ''), 'booked', actor_id)
  returning id into booked_registration_id;
  begin
    perform public.save_activity_assessment(
      booked_registration_id, 'developing', null::smallint, '', '', 'Should be rejected'
    );
    raise exception 'PHASE2_NON_ATTENDEE_ACCEPTED';
  exception when others then
    if sqlerrm = 'PHASE2_NON_ATTENDEE_ACCEPTED' then raise; end if;
    if position('PARTICIPATION_NOT_ATTENDED' in sqlerrm) = 0 then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'PHASE2_NON_ATTENDEE_NOT_REJECTED'; end if;

  if not exists (
    select 1 from public.list_sales_opportunity_owners() where user_id = actor_id
  ) then
    raise exception 'PHASE2_OWNER_NOT_LISTED';
  end if;

  opportunity_id := public.create_activity_opportunity(
    registration_id,
    actor_id,
    'Explain assessment and recommend a course',
    now() + interval '1 day',
    'Created from the activity assertion'
  );
  if opportunity_id is null or not exists (
    select 1 from public.sales_opportunities
     where id = opportunity_id
       and source_registration_id = registration_id
       and student_id = target_student_id
       and stage = 'new'
  ) then
    raise exception 'PHASE2_OPPORTUNITY_NOT_PERSISTED';
  end if;
  if not exists (
    select 1 from public.students
     where id = target_student_id
       and assigned_to = actor_id
       and next_follow_up_at is not null
  ) then
    raise exception 'PHASE2_NEXT_ACTION_NOT_PROJECTED';
  end if;

  perform public.update_sales_opportunity(
    opportunity_id, 'won', actor_id, '', null::timestamptz, 'Confirmed sale'
  );
  if not exists (
    select 1 from public.sales_opportunities where id = opportunity_id and stage = 'won'
  ) or not exists (
    select 1 from public.students where id = target_student_id and next_follow_up_at is null
  ) then
    raise exception 'PHASE2_WON_TRANSITION_NOT_PERSISTED';
  end if;

  if not exists (
    select 1 from pg_class where oid = 'public.assessment_results'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_class where oid = 'public.sales_opportunities'::regclass and relrowsecurity
  ) then
    raise exception 'PHASE2_RLS_NOT_ENABLED';
  end if;
end;
$$;

rollback;
