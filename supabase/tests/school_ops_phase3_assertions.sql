-- Phase 3 opportunity -> commercial enrollment -> class-membership assertions.
-- Uses fixed development staff, creates transaction-local fixtures, and rolls back.

begin;

do $$
declare
  actor_id uuid;
  p3_course_id uuid;
  p3_term_id uuid;
  assigned_student_id uuid;
  cancelled_student_id uuid;
  legacy_student_id uuid;
  converted_student_id uuid;
  p3_lead_id constant uuid := 'f3000000-0000-4000-8000-000000000101';
  first_classroom_id constant uuid := 'f3000000-0000-4000-8000-000000000201';
  second_classroom_id constant uuid := 'f3000000-0000-4000-8000-000000000202';
  p3_opportunity_id uuid;
  p3_repeated_opportunity_id uuid;
  p3_cancellation_opportunity_id uuid;
  p3_legacy_opportunity_id uuid;
  p3_lead_opportunity_id uuid;
  p3_enrollment_id uuid;
  p3_cancellation_enrollment_id uuid;
  p3_legacy_enrollment_id uuid;
  p3_converted_enrollment_id uuid;
  first_membership_id uuid;
  second_membership_id uuid;
  legacy_membership_id uuid;
  first_effective_at timestamptz;
  transfer_effective_at timestamptz;
  student_status_before text;
  rejected boolean;
begin
  select id into actor_id
    from public.profiles
   where role = 'admin' and is_active
   order by created_at
   limit 1;
  if actor_id is null then raise exception 'PHASE3_ADMIN_FIXTURE_REQUIRED'; end if;

  perform set_config('request.jwt.claim.sub', actor_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  if not public.has_perm(actor_id, 'followup.write')
     or not public.has_perm(actor_id, 'enrollment.manage') then
    raise exception 'PHASE3_ADMIN_PERMISSIONS_REQUIRED';
  end if;

  select course.id into p3_course_id
    from public.courses course
   where course.status = 'enabled'
     and course.purpose = 'production'
     and course.course_kind = 'curriculum'
     and course.trashed_at is null
   order by course.created_at, course.id
   limit 1;
  select term.id into p3_term_id
    from public.school_terms term
   order by term.is_current desc, term.starts_on desc nulls last, term.id
   limit 1;
  if p3_course_id is null or p3_term_id is null then
    raise exception 'PHASE3_COURSE_TERM_FIXTURES_REQUIRED';
  end if;

  insert into public.classrooms(
    id, owner_id, name, invite_code, course_id, term_id,
    grade, capacity, purpose, offering_type, operational_status
  )
  select first_classroom_id, actor_id, 'Phase 3 assertion A', 'p3asserta',
         course.id, p3_term_id, course.grade, 10, 'production', 'long_term_formal', 'active'
    from public.courses course where course.id = p3_course_id;
  insert into public.classrooms(
    id, owner_id, name, invite_code, course_id, term_id,
    grade, capacity, purpose, offering_type, operational_status
  )
  select second_classroom_id, actor_id, 'Phase 3 assertion B', 'p3assertb',
         course.id, p3_term_id, course.grade, 10, 'production', 'long_term_formal', 'active'
    from public.courses course where course.id = p3_course_id;

  assigned_student_id := public.create_student(
    'Phase 3 assigned student', 5::smallint, '', '', 'phase3-assigned', '', '', ''
  );
  select status into student_status_before from public.students where id = assigned_student_id;
  p3_opportunity_id := public.save_course_opportunity(
    null, null, assigned_student_id, null, 'new', p3_course_id, p3_term_id,
    'committed', null, 'Confirm enrollment', clock_timestamp(), 'Phase 3 assertion'
  );
  p3_repeated_opportunity_id := public.save_course_opportunity(
    null, null, assigned_student_id, null, 'new', p3_course_id, p3_term_id,
    'committed', null, 'Repeated request', clock_timestamp(), 'Idempotency assertion'
  );
  if p3_repeated_opportunity_id is distinct from p3_opportunity_id then
    raise exception 'PHASE3_OPPORTUNITY_NOT_IDEMPOTENT';
  end if;

  p3_enrollment_id := public.confirm_course_enrollment(p3_opportunity_id, 'Commercially confirmed');
  if public.confirm_course_enrollment(p3_opportunity_id, 'Idempotent confirmation')
     is distinct from p3_enrollment_id then
    raise exception 'PHASE3_CONFIRMATION_NOT_IDEMPOTENT';
  end if;
  if not exists (
    select 1 from public.course_enrollments enrollment
     where enrollment.id = p3_enrollment_id
       and enrollment.opportunity_id = p3_opportunity_id
       and enrollment.student_id = assigned_student_id
       and enrollment.status = 'active'
  ) or exists (
    select 1 from public.enrollments roster where roster.student_id = assigned_student_id
  ) then raise exception 'PHASE3_CONFIRMATION_FACT_BOUNDARY_BROKEN'; end if;
  if (select status from public.students where id = assigned_student_id)
     is distinct from student_status_before then
    raise exception 'PHASE3_CONFIRMATION_MUTATED_STUDENT_LIFECYCLE';
  end if;

  first_effective_at := clock_timestamp();
  first_membership_id := public.assign_course_enrollment(
    p3_enrollment_id, first_classroom_id, 'Initial class assignment', first_effective_at
  );
  if not exists (
    select 1
      from public.course_enrollment_assignments bridge
      join public.enrollments roster on roster.id = bridge.classroom_membership_id
     where bridge.course_enrollment_id = p3_enrollment_id
       and bridge.classroom_id = first_classroom_id
       and bridge.status = 'active'
       and bridge.assigned_at = first_effective_at
       and roster.id = first_membership_id
       and roster.status = 'active'
       and roster.joined_at = first_effective_at
  ) then raise exception 'PHASE3_ASSIGNMENT_BRIDGE_BROKEN'; end if;

  rejected := false;
  begin
    perform public.cancel_course_enrollment(
      p3_enrollment_id, 'Assigned enrollment cannot be cancelled', clock_timestamp()
    );
  exception when others then
    if position('ENROLLMENT_STILL_ASSIGNED' in sqlerrm) = 0 then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'PHASE3_ASSIGNED_CANCELLATION_ALLOWED'; end if;

  transfer_effective_at := clock_timestamp() + interval '1 second';
  second_membership_id := public.transfer_course_enrollment(
    p3_enrollment_id, second_classroom_id, 'Move to target class', transfer_effective_at
  );
  if not exists (
    select 1 from public.enrollments roster
     where roster.id = first_membership_id
       and roster.status = 'transferred_out'
       and roster.left_at = transfer_effective_at
  ) or not exists (
    select 1
      from public.course_enrollment_assignments bridge
      join public.enrollments roster on roster.id = bridge.classroom_membership_id
     where bridge.course_enrollment_id = p3_enrollment_id
       and bridge.classroom_id = second_classroom_id
       and bridge.status = 'active'
       and bridge.assigned_at = transfer_effective_at
       and roster.id = second_membership_id
       and roster.status = 'active'
       and roster.joined_at = transfer_effective_at
  ) then raise exception 'PHASE3_TRANSFER_INTERVAL_BROKEN'; end if;
  if not exists (
    select 1 from public.course_enrollment_events event
     where event.course_enrollment_id = p3_enrollment_id
       and event.kind = 'membership_transferred_out'
       and event.occurred_at = transfer_effective_at
  ) or not exists (
    select 1 from public.course_enrollment_events event
     where event.course_enrollment_id = p3_enrollment_id
       and event.kind = 'transferred'
       and event.occurred_at = transfer_effective_at
  ) then raise exception 'PHASE3_TRANSFER_AUDIT_BROKEN'; end if;

  cancelled_student_id := public.create_student(
    'Phase 3 cancelled student', 5::smallint, '', '', 'phase3-cancelled', '', '', ''
  );
  p3_cancellation_opportunity_id := public.save_course_opportunity(
    null, null, cancelled_student_id, null, 'new', p3_course_id, p3_term_id,
    'payment_pending', null, 'Awaiting final confirmation', clock_timestamp(), ''
  );
  p3_cancellation_enrollment_id := public.confirm_course_enrollment(p3_cancellation_opportunity_id, 'Confirmed');
  perform public.cancel_course_enrollment(
    p3_cancellation_enrollment_id, 'Family changed plans', clock_timestamp()
  );
  if not exists (
    select 1 from public.course_enrollments enrollment
     where enrollment.id = p3_cancellation_enrollment_id
       and enrollment.status = 'cancelled'
       and enrollment.cancelled_by = actor_id
       and enrollment.cancelled_at is not null
  ) or not exists (
    select 1 from public.course_opportunities opportunity
     where opportunity.id = p3_cancellation_opportunity_id
       and opportunity.stage = 'not_enrolled'
  ) or exists (
    select 1 from public.enrollments roster where roster.student_id = cancelled_student_id
  ) then raise exception 'PHASE3_PENDING_CANCELLATION_BROKEN'; end if;
  if not exists (
    select 1 from jsonb_array_elements(public.get_course_enrollment_workbench()) row
     where row ->> 'id' = p3_cancellation_enrollment_id::text
       and row ->> 'status' = 'cancelled'
  ) then raise exception 'PHASE3_CANCELLED_HISTORY_HIDDEN'; end if;

  legacy_student_id := public.create_student(
    'Phase 3 legacy roster student', 5::smallint, '', '', 'phase3-legacy', '', '', ''
  );
  insert into public.enrollments(
    classroom_id, student_id, status, joined_at, term_id, remark, operated_by
  ) values (
    first_classroom_id, legacy_student_id, 'active', clock_timestamp() - interval '1 day',
    p3_term_id, 'Compatible legacy roster row', actor_id
  ) returning id into legacy_membership_id;
  p3_legacy_opportunity_id := public.save_course_opportunity(
    null, null, legacy_student_id, null, 'referral', p3_course_id, p3_term_id,
    'committed', null, 'Confirm legacy bridge', clock_timestamp(), ''
  );
  p3_legacy_enrollment_id := public.confirm_course_enrollment(p3_legacy_opportunity_id, 'Confirmed');
  if public.assign_course_enrollment(
    p3_legacy_enrollment_id, first_classroom_id, 'Claim existing membership', clock_timestamp()
  ) is distinct from legacy_membership_id then
    raise exception 'PHASE3_LEGACY_MEMBERSHIP_NOT_CLAIMED';
  end if;
  if (select count(*) from public.enrollments roster
       where roster.student_id = legacy_student_id and roster.classroom_id = first_classroom_id) <> 1 then
    raise exception 'PHASE3_LEGACY_MEMBERSHIP_DUPLICATED';
  end if;

  insert into public.leads(
    id, provisional_student_name, normalized_name, phone, phone_normalized,
    grade_hint, status, owner_id, created_by
  ) values (
    p3_lead_id, 'Phase 3 lead', 'phase 3 lead', '13900030101', '13900030101',
    5, 'contacted', actor_id, actor_id
  );
  p3_lead_opportunity_id := public.save_course_opportunity(
    null, null, null, p3_lead_id, 'new', p3_course_id, p3_term_id,
    'committed', null, 'Confirm identity first', clock_timestamp(), ''
  );
  rejected := false;
  begin
    perform public.confirm_course_enrollment(p3_lead_opportunity_id, 'Must not convert implicitly');
  exception when others then
    if position('IDENTITY_NOT_CONFIRMED' in sqlerrm) = 0 then raise; end if;
    rejected := true;
  end;
  if not rejected or exists (
    select 1 from public.course_enrollments enrollment
     where enrollment.opportunity_id = p3_lead_opportunity_id
  ) then raise exception 'PHASE3_LEAD_IDENTITY_BOUNDARY_BROKEN'; end if;

  converted_student_id := public.create_student(
    'Phase 3 converted student', 5::smallint, '', '', 'phase3-converted', '', '', ''
  );
  update public.leads
     set student_id = converted_student_id,
         identity_confirmed_by = actor_id,
         identity_confirmed_at = clock_timestamp(),
         status = 'converted'
   where id = p3_lead_id;
  if not exists (
    select 1 from public.course_opportunities opportunity
     where opportunity.id = p3_lead_opportunity_id
       and opportunity.student_id = converted_student_id
       and opportunity.lead_id is null
       and opportunity.origin_lead_id = p3_lead_id
  ) or not exists (
    select 1 from public.course_opportunity_events event
     where event.opportunity_id = p3_lead_opportunity_id
       and event.kind = 'identity_linked'
  ) then raise exception 'PHASE3_EXPLICIT_IDENTITY_REBIND_BROKEN'; end if;
  p3_converted_enrollment_id := public.confirm_course_enrollment(
    p3_lead_opportunity_id, 'Identity now explicitly confirmed'
  );
  if not exists (
    select 1 from public.course_enrollments enrollment
     where enrollment.id = p3_converted_enrollment_id
       and enrollment.student_id = converted_student_id
  ) then raise exception 'PHASE3_REBOUND_ENROLLMENT_BROKEN'; end if;

  rejected := false;
  begin
    update public.course_enrollment_events
       set note = 'History must stay immutable'
     where course_enrollment_id = p3_enrollment_id;
  exception when others then
    if position('ENROLLMENT_HISTORY_APPEND_ONLY' in sqlerrm) = 0 then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'PHASE3_HISTORY_UPDATE_ALLOWED'; end if;
  if has_table_privilege('authenticated', 'public.course_enrollments', 'INSERT')
     or has_table_privilege('authenticated', 'public.course_enrollments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.course_enrollment_events', 'INSERT') then
    raise exception 'PHASE3_DIRECT_MUTATION_GRANT_PRESENT';
  end if;
end;
$$;

rollback;
