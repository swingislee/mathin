-- DEV-SCHOOL-OPS-1 / Phase 3: Course opportunity -> confirmed enrollment -> class assignment.
--
-- `public.enrollments` remains the teaching roster / class-membership fact.
-- A commercial enrollment is deliberately stored in `course_enrollments` and
-- reaches the roster only through an explicit, audited assignment RPC.

create table public.course_opportunities (
  id uuid primary key default gen_random_uuid(),
  source_activity_route_id uuid
    references public.activity_routes(id) on delete set null,
  student_id uuid references public.students(id) on delete restrict,
  lead_id uuid references public.leads(id) on delete restrict,
  origin_lead_id uuid references public.leads(id) on delete restrict,
  opportunity_type text not null default 'new'
    check (opportunity_type in ('new','renewal','upsell','reactivate','referral')),
  course_id uuid not null references public.courses(id) on delete restrict,
  term_id uuid not null references public.school_terms(id) on delete restrict,
  stage text not null default 'planning' check (stage in (
    'planning','contacted','considering','committed','payment_pending',
    'enrolled','not_enrolled','nurturing'
  )),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  next_action text not null default '' check (length(next_action) <= 500),
  next_action_at timestamptz,
  note text not null default '' check (length(note) <= 2000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_opportunities_subject_check check (
    num_nonnulls(student_id, lead_id) = 1
  )
);

create index course_opportunities_owner_stage_idx
  on public.course_opportunities(owner_id, stage, updated_at desc);
create index course_opportunities_student_idx
  on public.course_opportunities(student_id, updated_at desc)
  where student_id is not null;
create index course_opportunities_lead_idx
  on public.course_opportunities(lead_id, updated_at desc)
  where lead_id is not null;
create index course_opportunities_target_idx
  on public.course_opportunities(course_id, term_id, stage, updated_at desc);
create unique index course_opportunities_route_target_key
  on public.course_opportunities(
    source_activity_route_id, opportunity_type, course_id, term_id
  ) where source_activity_route_id is not null;
create unique index course_opportunities_student_target_key
  on public.course_opportunities(
    student_id, opportunity_type, course_id, term_id
  ) where student_id is not null;
create unique index course_opportunities_lead_target_key
  on public.course_opportunities(
    lead_id, opportunity_type, course_id, term_id
  ) where lead_id is not null;

create trigger course_opportunities_set_updated_at
  before update on public.course_opportunities
  for each row execute function public.set_updated_at();

create table public.course_opportunity_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.course_opportunities(id) on delete cascade,
  kind text not null check (kind in ('created','stage_changed','identity_linked')),
  from_stage text check (from_stage is null or from_stage in (
    'planning','contacted','considering','committed','payment_pending',
    'enrolled','not_enrolled','nurturing'
  )),
  to_stage text not null check (to_stage in (
    'planning','contacted','considering','committed','payment_pending',
    'enrolled','not_enrolled','nurturing'
  )),
  note text not null default '' check (length(note) <= 2000),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default now()
);

create index course_opportunity_events_timeline_idx
  on public.course_opportunity_events(opportunity_id, occurred_at desc, id desc);

create table public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null unique
    references public.course_opportunities(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  course_id uuid not null references public.courses(id) on delete restrict,
  term_id uuid not null references public.school_terms(id) on delete restrict,
  status text not null default 'active' check (status in ('active','cancelled')),
  note text not null default '' check (length(note) <= 2000),
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_enrollments_cancelled_shape_check check (
    (status = 'active' and cancelled_by is null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_by is not null and cancelled_at is not null)
  )
);

create unique index course_enrollments_one_active_target_idx
  on public.course_enrollments(student_id, course_id, term_id)
  where status = 'active';
create index course_enrollments_pending_idx
  on public.course_enrollments(status, confirmed_at desc, id desc);

create trigger course_enrollments_set_updated_at
  before update on public.course_enrollments
  for each row execute function public.set_updated_at();

create table public.course_enrollment_assignments (
  id uuid primary key default gen_random_uuid(),
  course_enrollment_id uuid not null
    references public.course_enrollments(id) on delete restrict,
  classroom_id uuid not null references public.classrooms(id) on delete restrict,
  classroom_membership_id uuid not null unique
    references public.enrollments(id) on delete restrict,
  status text not null default 'active'
    check (status in ('active','completed','transferred_out','withdrawn')),
  note text not null default '' check (length(note) <= 2000),
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  left_at timestamptz,
  constraint course_enrollment_assignments_status_shape_check check (
    (status = 'active' and left_at is null)
    or (status <> 'active' and left_at is not null)
  )
);

create unique index course_enrollment_assignments_one_active_idx
  on public.course_enrollment_assignments(course_enrollment_id)
  where status = 'active';
create index course_enrollment_assignments_classroom_idx
  on public.course_enrollment_assignments(classroom_id, status, assigned_at desc);

create table public.course_enrollment_events (
  id uuid primary key default gen_random_uuid(),
  course_enrollment_id uuid not null
    references public.course_enrollments(id) on delete restrict,
  kind text not null check (kind in (
    'confirmed','assigned','transferred','unassigned','cancelled',
    'membership_completed','membership_transferred_out','membership_withdrawn'
  )),
  from_classroom_id uuid references public.classrooms(id) on delete restrict,
  to_classroom_id uuid references public.classrooms(id) on delete restrict,
  note text not null default '' check (length(note) <= 2000),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default now()
);

create index course_enrollment_events_timeline_idx
  on public.course_enrollment_events(course_enrollment_id, occurred_at desc, id desc);

comment on table public.course_opportunities is
  'A concrete course-and-term intention for one Lead or Student. It is not a commercial enrollment.';
comment on table public.course_enrollments is
  'Confirmed commercial enrollment. Pending assignment means there is no active course_enrollment_assignment.';
comment on table public.course_enrollment_assignments is
  'Audited bridge from a commercial enrollment to the existing teaching-roster enrollment fact.';

create or replace function public.can_access_course_opportunity_subject(
  p_student_id uuid,
  p_lead_id uuid,
  p_owner_id uuid,
  p_uid uuid
) returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p_uid is not null and (
    public.is_admin(p_uid)
    or public.has_perm(p_uid, 'enrollment.manage')
    or (
      public.has_perm(p_uid, 'followup.view')
      and (
        p_owner_id = p_uid
        or public.has_perm(p_uid, 'student.view.all')
        or (p_student_id is not null and public.can_access_student(p_student_id, p_uid))
        or (
          p_lead_id is not null
          and exists (
            select 1 from public.leads lead
             where lead.id = p_lead_id
               and (lead.owner_id is null or lead.owner_id = p_uid)
          )
        )
      )
    )
  )
$$;

alter table public.course_opportunities enable row level security;
alter table public.course_opportunity_events enable row level security;
alter table public.course_enrollments enable row level security;
alter table public.course_enrollment_assignments enable row level security;
alter table public.course_enrollment_events enable row level security;

create policy course_opportunities_select_scope on public.course_opportunities
  for select to authenticated using (
    public.can_access_course_opportunity_subject(
      student_id, lead_id, owner_id, (select auth.uid())
    )
  );

create policy course_opportunity_events_select_scope on public.course_opportunity_events
  for select to authenticated using (
    exists (
      select 1 from public.course_opportunities opportunity
       where opportunity.id = course_opportunity_events.opportunity_id
    )
  );

create policy course_enrollments_select_scope on public.course_enrollments
  for select to authenticated using (
    public.has_perm((select auth.uid()), 'enrollment.manage')
    or public.can_access_student(student_id, (select auth.uid()))
  );

create policy course_enrollment_assignments_select_scope on public.course_enrollment_assignments
  for select to authenticated using (
    exists (
      select 1 from public.course_enrollments enrollment
       where enrollment.id = course_enrollment_assignments.course_enrollment_id
    )
  );

create policy course_enrollment_events_select_scope on public.course_enrollment_events
  for select to authenticated using (
    exists (
      select 1 from public.course_enrollments enrollment
       where enrollment.id = course_enrollment_events.course_enrollment_id
    )
  );

revoke all on public.course_opportunities, public.course_opportunity_events,
  public.course_enrollments, public.course_enrollment_assignments,
  public.course_enrollment_events from public, anon, authenticated;
grant select on public.course_opportunities, public.course_opportunity_events,
  public.course_enrollments, public.course_enrollment_assignments,
  public.course_enrollment_events to authenticated;

create or replace function public.guard_phase3_enrollment_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'ENROLLMENT_HISTORY_APPEND_ONLY';
end
$$;

create trigger course_opportunity_events_immutable
  before update or delete on public.course_opportunity_events
  for each row execute function public.guard_phase3_enrollment_history();
create trigger course_enrollment_events_immutable
  before update or delete on public.course_enrollment_events
  for each row execute function public.guard_phase3_enrollment_history();

create or replace function public.course_opportunity_transition_allowed(
  p_from_stage text,
  p_to_stage text
) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select p_from_stage = p_to_stage or case p_from_stage
    when 'planning' then p_to_stage in (
      'contacted','considering','committed','nurturing','not_enrolled'
    )
    when 'contacted' then p_to_stage in (
      'considering','committed','payment_pending','nurturing','not_enrolled'
    )
    when 'considering' then p_to_stage in (
      'contacted','committed','payment_pending','nurturing','not_enrolled'
    )
    when 'committed' then p_to_stage in (
      'considering','payment_pending','nurturing','not_enrolled'
    )
    when 'payment_pending' then p_to_stage in (
      'committed','considering','nurturing','not_enrolled'
    )
    when 'not_enrolled' then p_to_stage in ('planning','nurturing')
    when 'nurturing' then p_to_stage in (
      'planning','contacted','considering','committed','not_enrolled'
    )
    else false
  end
$$;

create or replace function public.save_course_opportunity(
  p_opportunity_id uuid,
  p_activity_route_id uuid,
  p_student_id uuid,
  p_lead_id uuid,
  p_opportunity_type text,
  p_course_id uuid,
  p_term_id uuid,
  p_stage text,
  p_owner_id uuid,
  p_next_action text,
  p_next_action_at timestamptz,
  p_note text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_opportunity public.course_opportunities%rowtype;
  v_student_id uuid;
  v_lead_id uuid;
  v_owner_id uuid;
  v_route_kind text;
  v_opportunity_id uuid;
  v_origin_lead_id uuid;
  v_next_action text := btrim(coalesce(p_next_action, ''));
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'followup.write') then raise exception 'FORBIDDEN'; end if;
  if p_opportunity_type not in ('new','renewal','upsell','reactivate','referral')
     or p_stage not in (
       'planning','contacted','considering','committed','payment_pending',
       'not_enrolled','nurturing'
     )
     or char_length(v_next_action) > 500
     or char_length(v_note) > 2000 then
    raise exception 'INVALID_OPPORTUNITY';
  end if;
  if not exists (
    select 1 from public.courses course
     where course.id = p_course_id
       and course.status = 'enabled'
       and course.purpose = 'production'
       and course.course_kind = 'curriculum'
       and course.trashed_at is null
  ) then raise exception 'COURSE_NOT_AVAILABLE'; end if;
  if not exists (select 1 from public.school_terms term where term.id = p_term_id) then
    raise exception 'TERM_NOT_FOUND';
  end if;

  if p_opportunity_id is null then
    if num_nonnulls(p_activity_route_id, p_student_id, p_lead_id) <> 1 then
      raise exception 'INVALID_OPPORTUNITY_SOURCE';
    end if;

    if p_activity_route_id is not null then
      select student.id,
             case when student.id is null then route.lead_id end,
             coalesce(student.assigned_to, lead.owner_id, route.routed_by, v_uid),
             route.route
        into v_student_id, v_lead_id, v_owner_id, v_route_kind
        from public.activity_routes route
        left join public.leads lead on lead.id = route.lead_id
        left join public.students student
          on student.id = coalesce(route.student_id, lead.student_id)
       where route.id = p_activity_route_id;
      if not found then raise exception 'ACTIVITY_ROUTE_NOT_FOUND'; end if;
      if v_route_kind = 'closed' then raise exception 'ACTIVITY_ROUTE_CLOSED'; end if;
    elsif p_student_id is not null then
      select student.id, student.assigned_to
        into v_student_id, v_owner_id
        from public.students student
       where student.id = p_student_id and student.deleted_at is null;
      if not found then raise exception 'STUDENT_NOT_AVAILABLE'; end if;
      if not public.can_access_student(v_student_id, v_uid) then
        raise exception 'FORBIDDEN_SCOPE';
      end if;
    else
      select lead.id, lead.owner_id
        into v_lead_id, v_owner_id
        from public.leads lead
       where lead.id = p_lead_id
         and lead.student_id is null
         and lead.status not in ('invalid','converted');
      if not found then raise exception 'LEAD_NOT_AVAILABLE'; end if;
    end if;

    -- Scope is checked against the subject's derived/current owner. A caller
    -- cannot gain access by nominating themselves as the replacement owner.
    if not public.can_access_course_opportunity_subject(
      v_student_id, v_lead_id, v_owner_id, v_uid
    ) then raise exception 'FORBIDDEN_SCOPE'; end if;
    if p_owner_id is not null and p_owner_id is distinct from v_owner_id
       and not public.has_perm(v_uid, 'student.assign') then
      raise exception 'FORBIDDEN_OWNER_ASSIGNMENT';
    end if;
    v_owner_id := coalesce(p_owner_id, v_owner_id, v_uid);
    v_origin_lead_id := v_lead_id;
    if not exists (
      select 1 from public.profiles profile
       where profile.id = v_owner_id
         and profile.role in ('staff','admin')
         and profile.is_active
         and public.has_perm(profile.id, 'followup.write')
    ) then raise exception 'OWNER_NOT_AVAILABLE'; end if;

    select opportunity.* into v_opportunity
      from public.course_opportunities opportunity
     where (
         p_activity_route_id is not null
         and opportunity.source_activity_route_id = p_activity_route_id
         and opportunity.opportunity_type = p_opportunity_type
         and opportunity.course_id = p_course_id
         and opportunity.term_id = p_term_id
       ) or (
         v_student_id is not null
         and opportunity.student_id = v_student_id
         and opportunity.opportunity_type = p_opportunity_type
         and opportunity.course_id = p_course_id
         and opportunity.term_id = p_term_id
       ) or (
         v_lead_id is not null
         and opportunity.lead_id = v_lead_id
         and opportunity.opportunity_type = p_opportunity_type
         and opportunity.course_id = p_course_id
         and opportunity.term_id = p_term_id
       )
     order by opportunity.created_at, opportunity.id
     limit 1
     for update;
    if found then return v_opportunity.id; end if;

    begin
      insert into public.course_opportunities(
        source_activity_route_id, student_id, lead_id, origin_lead_id, opportunity_type,
        course_id, term_id, stage, owner_id, next_action, next_action_at,
        note, created_by, updated_by
      ) values (
        p_activity_route_id, v_student_id, v_lead_id, v_origin_lead_id, p_opportunity_type,
        p_course_id, p_term_id, p_stage, v_owner_id, v_next_action,
        p_next_action_at, v_note, v_uid, v_uid
      ) returning id into v_opportunity_id;
    exception when unique_violation then
      select opportunity.id into v_opportunity_id
        from public.course_opportunities opportunity
       where (
           v_student_id is not null
           and opportunity.student_id = v_student_id
           and opportunity.opportunity_type = p_opportunity_type
           and opportunity.course_id = p_course_id
           and opportunity.term_id = p_term_id
         ) or (
           v_lead_id is not null
           and opportunity.lead_id = v_lead_id
           and opportunity.opportunity_type = p_opportunity_type
           and opportunity.course_id = p_course_id
           and opportunity.term_id = p_term_id
         ) or (
           p_activity_route_id is not null
           and opportunity.source_activity_route_id = p_activity_route_id
           and opportunity.opportunity_type = p_opportunity_type
           and opportunity.course_id = p_course_id
           and opportunity.term_id = p_term_id
         )
       limit 1;
      if v_opportunity_id is null then raise exception 'OPPORTUNITY_TARGET_CONFLICT'; end if;
      return v_opportunity_id;
    end;

    insert into public.course_opportunity_events(
      opportunity_id, kind, from_stage, to_stage, note, recorded_by
    ) values (v_opportunity_id, 'created', null, p_stage, v_note, v_uid);
  else
    if num_nonnulls(p_activity_route_id, p_student_id, p_lead_id) <> 0 then
      raise exception 'IMMUTABLE_OPPORTUNITY_SOURCE';
    end if;
    select * into v_opportunity
      from public.course_opportunities
     where id = p_opportunity_id
     for update;
    if not found then raise exception 'OPPORTUNITY_NOT_FOUND'; end if;
    if not public.can_access_course_opportunity_subject(
      v_opportunity.student_id, v_opportunity.lead_id,
      v_opportunity.owner_id, v_uid
    ) then raise exception 'FORBIDDEN_SCOPE'; end if;
    if v_opportunity.stage = 'enrolled' then raise exception 'OPPORTUNITY_ENROLLED'; end if;
    if not public.course_opportunity_transition_allowed(v_opportunity.stage, p_stage) then
      raise exception 'INVALID_OPPORTUNITY_TRANSITION';
    end if;

    v_owner_id := coalesce(p_owner_id, v_opportunity.owner_id);
    if p_owner_id is not null
       and p_owner_id is distinct from v_opportunity.owner_id
       and not public.has_perm(v_uid, 'student.assign') then
      raise exception 'FORBIDDEN_OWNER_ASSIGNMENT';
    end if;
    if not exists (
      select 1 from public.profiles profile
       where profile.id = v_owner_id
         and profile.role in ('staff','admin')
         and profile.is_active
         and public.has_perm(profile.id, 'followup.write')
    ) then raise exception 'OWNER_NOT_AVAILABLE'; end if;

    begin
      update public.course_opportunities
         set opportunity_type = p_opportunity_type,
             course_id = p_course_id,
             term_id = p_term_id,
             stage = p_stage,
             owner_id = v_owner_id,
             next_action = v_next_action,
             next_action_at = p_next_action_at,
             note = v_note,
             updated_by = v_uid
       where id = v_opportunity.id;
    exception when unique_violation then
      raise exception 'OPPORTUNITY_TARGET_CONFLICT';
    end;
    v_opportunity_id := v_opportunity.id;

    if v_opportunity.stage is distinct from p_stage then
      insert into public.course_opportunity_events(
        opportunity_id, kind, from_stage, to_stage, note, recorded_by
      ) values (
        v_opportunity.id, 'stage_changed', v_opportunity.stage,
        p_stage, v_note, v_uid
      );
    end if;
  end if;

  perform public.emit_domain_event(
    'course.opportunity.saved', 'course_opportunity', v_opportunity_id,
    jsonb_build_object(
      'courseId', p_course_id, 'termId', p_term_id,
      'type', p_opportunity_type, 'stage', p_stage
    ), null, '/dashboard/opportunities'
  );
  return v_opportunity_id;
end
$$;

-- Consume the identity domain's frozen Lead -> Student decision without ever
-- creating or selecting a Student inside Phase 3.
create or replace function public.rebind_course_opportunity_identity()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_opportunity public.course_opportunities%rowtype;
  v_actor_id uuid := coalesce(new.identity_confirmed_by, auth.uid());
begin
  if new.student_id is null or new.student_id is not distinct from old.student_id then
    return new;
  end if;

  for v_opportunity in
    select * from public.course_opportunities
     where lead_id = new.id
     order by created_at, id
     for update
  loop
    if exists (
      select 1 from public.course_opportunities existing
       where existing.id <> v_opportunity.id
         and existing.student_id = new.student_id
         and existing.opportunity_type = v_opportunity.opportunity_type
         and existing.course_id = v_opportunity.course_id
         and existing.term_id = v_opportunity.term_id
    ) then
      raise exception 'COURSE_OPPORTUNITY_IDENTITY_CONFLICT';
    end if;

    update public.course_opportunities
       set student_id = new.student_id,
           lead_id = null,
           origin_lead_id = coalesce(origin_lead_id, new.id),
           updated_by = v_actor_id
     where id = v_opportunity.id;
    insert into public.course_opportunity_events(
      opportunity_id, kind, from_stage, to_stage, note, recorded_by
    ) values (
      v_opportunity.id, 'identity_linked', v_opportunity.stage,
      v_opportunity.stage, 'Lead identity linked to confirmed Student', v_actor_id
    );
  end loop;
  return new;
end
$$;

create trigger leads_rebind_course_opportunity_identity
  after update of student_id on public.leads
  for each row
  when (new.student_id is not null and new.student_id is distinct from old.student_id)
  execute function public.rebind_course_opportunity_identity();

create or replace function public.confirm_course_enrollment(
  p_opportunity_id uuid,
  p_note text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_opportunity public.course_opportunities%rowtype;
  v_enrollment_id uuid;
  v_enrollment_status text;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if char_length(v_note) > 2000 then raise exception 'INVALID_ENROLLMENT'; end if;

  select * into v_opportunity
    from public.course_opportunities
   where id = p_opportunity_id
   for update;
  if not found then raise exception 'OPPORTUNITY_NOT_FOUND'; end if;
  if v_opportunity.student_id is null then raise exception 'IDENTITY_NOT_CONFIRMED'; end if;

  select enrollment.id, enrollment.status into v_enrollment_id, v_enrollment_status
    from public.course_enrollments enrollment
   where enrollment.opportunity_id = v_opportunity.id;
  if v_enrollment_id is not null then
    if v_enrollment_status = 'active' then return v_enrollment_id; end if;
    raise exception 'ENROLLMENT_CANCELLED';
  end if;
  if v_opportunity.stage not in ('committed','payment_pending') then
    raise exception 'OPPORTUNITY_NOT_CONFIRMABLE';
  end if;

  begin
    insert into public.course_enrollments(
      opportunity_id, student_id, course_id, term_id, note, confirmed_by
    ) values (
      v_opportunity.id, v_opportunity.student_id,
      v_opportunity.course_id, v_opportunity.term_id, v_note, v_uid
    ) returning id into v_enrollment_id;
  exception when unique_violation then
    raise exception 'ALREADY_ENROLLED_FOR_COURSE';
  end;

  insert into public.course_enrollment_events(
    course_enrollment_id, kind, note, recorded_by
  ) values (v_enrollment_id, 'confirmed', v_note, v_uid);
  insert into public.course_opportunity_events(
    opportunity_id, kind, from_stage, to_stage, note, recorded_by
  ) values (
    v_opportunity.id, 'stage_changed', v_opportunity.stage,
    'enrolled', v_note, v_uid
  );
  update public.course_opportunities
     set stage = 'enrolled', note = case when v_note <> '' then v_note else note end,
         updated_by = v_uid
   where id = v_opportunity.id;
  perform public.emit_domain_event(
    'course.enrollment.confirmed', 'course_enrollment', v_enrollment_id,
    jsonb_build_object(
      'opportunityId', v_opportunity.id, 'studentId', v_opportunity.student_id,
      'courseId', v_opportunity.course_id, 'termId', v_opportunity.term_id
    ), null, '/dashboard/enrollments'
  );
  return v_enrollment_id;
end
$$;

-- Cancellation is intentionally limited to the pending-assignment state. Once
-- a teaching membership exists, the operator must first use the explicit
-- roster withdrawal/transfer workflow; money/refund facts remain in finance.
create or replace function public.cancel_course_enrollment(
  p_course_enrollment_id uuid,
  p_note text,
  p_effective_at timestamptz default now()
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_enrollment public.course_enrollments%rowtype;
  v_opportunity public.course_opportunities%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_effective_at timestamptz := p_effective_at;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if v_note = '' or char_length(v_note) > 2000 then raise exception 'INVALID_ENROLLMENT'; end if;

  select * into v_enrollment from public.course_enrollments
   where id = p_course_enrollment_id for update;
  if not found then raise exception 'ENROLLMENT_NOT_FOUND'; end if;
  if v_enrollment.status = 'cancelled' then return v_enrollment.id; end if;
  if v_effective_at is null
     or v_effective_at < v_enrollment.confirmed_at
     or v_effective_at > now() + interval '5 minutes' then
    raise exception 'INVALID_EFFECTIVE_AT';
  end if;
  if exists (
    select 1 from public.course_enrollment_assignments assignment
     where assignment.course_enrollment_id = v_enrollment.id
       and assignment.status = 'active'
  ) then raise exception 'ENROLLMENT_STILL_ASSIGNED'; end if;

  select * into v_opportunity from public.course_opportunities
   where id = v_enrollment.opportunity_id for update;
  update public.course_enrollments
     set status = 'cancelled', cancelled_by = v_uid,
         cancelled_at = v_effective_at,
         note = case when v_note <> '' then v_note else note end
   where id = v_enrollment.id;
  insert into public.course_enrollment_events(
    course_enrollment_id, kind, note, recorded_by, occurred_at
  ) values (v_enrollment.id, 'cancelled', v_note, v_uid, v_effective_at);
  insert into public.course_opportunity_events(
    opportunity_id, kind, from_stage, to_stage, note, recorded_by, occurred_at
  ) values (
    v_opportunity.id, 'stage_changed', v_opportunity.stage,
    'not_enrolled', v_note, v_uid, v_effective_at
  );
  update public.course_opportunities
     set stage = 'not_enrolled',
         note = case when v_note <> '' then v_note else note end,
         updated_by = v_uid
   where id = v_opportunity.id;

  perform public.emit_domain_event(
    'course.enrollment.cancelled', 'course_enrollment', v_enrollment.id,
    jsonb_build_object(
      'studentId', v_enrollment.student_id,
      'effectiveAt', v_effective_at,
      'financeMutation', false
    ), null, '/dashboard/enrollments'
  );
  return v_enrollment.id;
end
$$;

create or replace function public.assign_course_enrollment(
  p_course_enrollment_id uuid,
  p_classroom_id uuid,
  p_note text,
  p_effective_at timestamptz default now()
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_enrollment public.course_enrollments%rowtype;
  v_classroom public.classrooms%rowtype;
  v_assignment public.course_enrollment_assignments%rowtype;
  v_membership_id uuid;
  v_membership_joined_at timestamptz;
  v_linked_enrollment_id uuid;
  v_active_count integer;
  v_note text := btrim(coalesce(p_note, ''));
  v_effective_at timestamptz := p_effective_at;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if char_length(v_note) > 2000 then raise exception 'INVALID_ASSIGNMENT'; end if;

  select * into v_enrollment
    from public.course_enrollments
   where id = p_course_enrollment_id
   for update;
  if not found or v_enrollment.status <> 'active' then raise exception 'ENROLLMENT_NOT_ACTIVE'; end if;
  if v_effective_at is null
     or v_effective_at < v_enrollment.confirmed_at
     or v_effective_at > now() + interval '5 minutes' then
    raise exception 'INVALID_EFFECTIVE_AT';
  end if;

  select * into v_assignment
    from public.course_enrollment_assignments
   where course_enrollment_id = v_enrollment.id and status = 'active'
   for update;
  if found then
    if v_assignment.classroom_id = p_classroom_id then return v_assignment.classroom_membership_id; end if;
    raise exception 'ENROLLMENT_ALREADY_ASSIGNED';
  end if;

  select * into v_classroom from public.classrooms where id = p_classroom_id for update;
  if not found or v_classroom.archived_at is not null or v_classroom.trashed_at is not null
     or v_classroom.operational_status not in ('planning','active')
     or v_classroom.purpose <> 'production'
     or v_classroom.offering_type <> 'long_term_formal' then
    raise exception 'CLASS_NOT_AVAILABLE';
  end if;
  if not public.can_manage_classroom(v_classroom.id, v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if v_classroom.course_id is distinct from v_enrollment.course_id
     or v_classroom.term_id is distinct from v_enrollment.term_id then
    raise exception 'CLASS_TARGET_MISMATCH';
  end if;

  select roster.id, roster.joined_at into v_membership_id, v_membership_joined_at
    from public.enrollments roster
   where roster.classroom_id = v_classroom.id
     and roster.student_id = v_enrollment.student_id
     and roster.status = 'active'
   limit 1;
  if v_membership_id is not null then
    if not exists (
      select 1 from public.enrollments roster
       where roster.id = v_membership_id
         and roster.term_id is not distinct from v_enrollment.term_id
    ) then raise exception 'CLASS_TARGET_MISMATCH'; end if;
    select bridge.course_enrollment_id into v_linked_enrollment_id
      from public.course_enrollment_assignments bridge
     where bridge.classroom_membership_id = v_membership_id;
    if v_linked_enrollment_id is not null then
      raise exception 'MEMBERSHIP_ALREADY_LINKED';
    end if;
    if v_membership_joined_at > v_effective_at then
      raise exception 'INVALID_EFFECTIVE_AT';
    end if;
  else
    if v_classroom.capacity is not null then
      select count(*) into v_active_count
        from public.enrollments roster
       where roster.classroom_id = v_classroom.id and roster.status = 'active';
      if v_active_count >= v_classroom.capacity then raise exception 'CLASS_FULL'; end if;
    end if;
    insert into public.enrollments(
      classroom_id, student_id, status, joined_at, term_id, remark, operated_by
    ) values (
      v_classroom.id, v_enrollment.student_id, 'active', v_effective_at,
      v_enrollment.term_id, v_note, v_uid
    ) returning id into v_membership_id;
  end if;

  insert into public.course_enrollment_assignments(
    course_enrollment_id, classroom_id, classroom_membership_id,
    note, assigned_by, assigned_at
  ) values (
    v_enrollment.id, v_classroom.id, v_membership_id, v_note, v_uid,
    v_effective_at
  );
  insert into public.course_enrollment_events(
    course_enrollment_id, kind, to_classroom_id, note, recorded_by, occurred_at
  ) values (
    v_enrollment.id, 'assigned', v_classroom.id, v_note, v_uid, v_effective_at
  );

  perform public.emit_domain_event(
    'course.enrollment.assigned', 'course_enrollment', v_enrollment.id,
    jsonb_build_object(
      'studentId', v_enrollment.student_id,
      'classroomId', v_classroom.id,
      'classroomMembershipId', v_membership_id,
      'effectiveAt', v_effective_at
    ), null, '/dashboard/enrollments'
  );
  return v_membership_id;
end
$$;

create or replace function public.sync_course_enrollment_assignment_from_membership()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_course_enrollment_id uuid;
  v_classroom_id uuid;
  v_recorded_by uuid;
begin
  if old.status = 'active' and new.status <> 'active' then
    update public.course_enrollment_assignments
       set status = new.status,
           left_at = coalesce(new.left_at, now())
     where classroom_membership_id = new.id and status = 'active'
     returning course_enrollment_id, classroom_id, assigned_by
      into v_course_enrollment_id, v_classroom_id, v_recorded_by;
    if v_course_enrollment_id is not null then
      insert into public.course_enrollment_events(
        course_enrollment_id, kind, from_classroom_id, note,
        recorded_by, occurred_at
      ) values (
        v_course_enrollment_id,
        case new.status
          when 'completed' then 'membership_completed'
          when 'transferred_out' then 'membership_transferred_out'
          else 'membership_withdrawn'
        end,
        v_classroom_id,
        left(coalesce(new.remark, ''), 2000),
        coalesce(new.operated_by, v_recorded_by),
        coalesce(new.left_at, now())
      );
    end if;
  end if;
  return new;
end
$$;

create trigger enrollments_sync_course_assignment
  after update of status on public.enrollments
  for each row
  when (old.status is distinct from new.status)
  execute function public.sync_course_enrollment_assignment_from_membership();

create or replace function public.transfer_course_enrollment(
  p_course_enrollment_id uuid,
  p_to_classroom_id uuid,
  p_note text,
  p_effective_at timestamptz default now()
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_enrollment public.course_enrollments%rowtype;
  v_assignment public.course_enrollment_assignments%rowtype;
  v_target public.classrooms%rowtype;
  v_membership_id uuid;
  v_membership_joined_at timestamptz;
  v_linked_enrollment_id uuid;
  v_active_count integer;
  v_note text := btrim(coalesce(p_note, ''));
  v_effective_at timestamptz := p_effective_at;
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'enrollment.manage') then raise exception 'FORBIDDEN'; end if;
  if char_length(v_note) > 2000 then raise exception 'INVALID_ASSIGNMENT'; end if;

  select * into v_enrollment from public.course_enrollments
   where id = p_course_enrollment_id for update;
  if not found or v_enrollment.status <> 'active' then raise exception 'ENROLLMENT_NOT_ACTIVE'; end if;
  select * into v_assignment from public.course_enrollment_assignments
   where course_enrollment_id = v_enrollment.id and status = 'active'
   for update;
  if not found then raise exception 'ENROLLMENT_NOT_ASSIGNED'; end if;
  if v_effective_at is null
     or v_effective_at < v_assignment.assigned_at
     or v_effective_at > now() + interval '5 minutes' then
    raise exception 'INVALID_EFFECTIVE_AT';
  end if;
  if v_assignment.classroom_id = p_to_classroom_id then raise exception 'SAME_CLASSROOM'; end if;
  if not public.can_manage_classroom(v_assignment.classroom_id, v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;

  select * into v_target from public.classrooms where id = p_to_classroom_id for update;
  if not found or v_target.archived_at is not null or v_target.trashed_at is not null
     or v_target.operational_status not in ('planning','active')
     or v_target.purpose <> 'production'
     or v_target.offering_type <> 'long_term_formal' then
    raise exception 'CLASS_NOT_AVAILABLE';
  end if;
  if not public.can_manage_classroom(v_target.id, v_uid) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if v_target.course_id is distinct from v_enrollment.course_id
     or v_target.term_id is distinct from v_enrollment.term_id then
    raise exception 'CLASS_TARGET_MISMATCH';
  end if;

  select roster.id, roster.joined_at into v_membership_id, v_membership_joined_at
    from public.enrollments roster
   where roster.classroom_id = v_target.id
     and roster.student_id = v_enrollment.student_id
     and roster.status = 'active'
   limit 1;
  if v_membership_id is not null then
    if not exists (
      select 1 from public.enrollments roster
       where roster.id = v_membership_id
         and roster.term_id is not distinct from v_enrollment.term_id
    ) then raise exception 'CLASS_TARGET_MISMATCH'; end if;
    select bridge.course_enrollment_id into v_linked_enrollment_id
      from public.course_enrollment_assignments bridge
     where bridge.classroom_membership_id = v_membership_id;
    if v_linked_enrollment_id is not null then
      raise exception 'MEMBERSHIP_ALREADY_LINKED';
    end if;
    if v_membership_joined_at > v_effective_at then
      raise exception 'INVALID_EFFECTIVE_AT';
    end if;
  else
    if v_target.capacity is not null then
      select count(*) into v_active_count from public.enrollments roster
       where roster.classroom_id = v_target.id and roster.status = 'active';
      if v_active_count >= v_target.capacity then raise exception 'CLASS_FULL'; end if;
    end if;
  end if;

  update public.enrollments
     set status = 'transferred_out', left_at = v_effective_at,
         remark = case when v_note <> '' then v_note else remark end,
         operated_by = v_uid
   where id = v_assignment.classroom_membership_id and status = 'active';
  if not found then raise exception 'CLASS_MEMBERSHIP_NOT_ACTIVE'; end if;

  if v_membership_id is null then
    insert into public.enrollments(
      classroom_id, student_id, status, joined_at, term_id, remark, operated_by
    ) values (
      v_target.id, v_enrollment.student_id, 'active', v_effective_at,
      v_enrollment.term_id, v_note, v_uid
    ) returning id into v_membership_id;
  end if;

  insert into public.course_enrollment_assignments(
    course_enrollment_id, classroom_id, classroom_membership_id,
    note, assigned_by, assigned_at
  ) values (
    v_enrollment.id, v_target.id, v_membership_id, v_note, v_uid,
    v_effective_at
  );
  insert into public.course_enrollment_events(
    course_enrollment_id, kind, from_classroom_id, to_classroom_id,
    note, recorded_by, occurred_at
  ) values (
    v_enrollment.id, 'transferred', v_assignment.classroom_id,
    v_target.id, v_note, v_uid, v_effective_at
  );

  perform public.emit_domain_event(
    'course.enrollment.transferred', 'course_enrollment', v_enrollment.id,
    jsonb_build_object(
      'studentId', v_enrollment.student_id,
      'fromClassroomId', v_assignment.classroom_id,
      'toClassroomId', v_target.id,
      'classroomMembershipId', v_membership_id,
      'effectiveAt', v_effective_at
    ), null, '/dashboard/enrollments'
  );
  return v_membership_id;
end
$$;

create or replace function public.assign_course_enrollments(
  p_course_enrollment_ids uuid[],
  p_classroom_id uuid,
  p_note text,
  p_effective_at timestamptz default now()
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_enrollment_id uuid;
  v_count integer := 0;
begin
  select array_agg(distinct requested.id) into v_ids
    from unnest(coalesce(p_course_enrollment_ids, '{}'::uuid[])) requested(id)
   where requested.id is not null;
  if coalesce(cardinality(v_ids), 0) = 0 or cardinality(v_ids) > 200 then
    raise exception 'INVALID_ASSIGNMENT_BATCH';
  end if;
  foreach v_enrollment_id in array v_ids loop
    perform public.assign_course_enrollment(
      v_enrollment_id, p_classroom_id, p_note, p_effective_at
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

create or replace function public.get_course_opportunity_workbench()
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (
    public.has_perm(v_uid, 'followup.view')
    or public.has_perm(v_uid, 'enrollment.manage')
  ) then raise exception 'FORBIDDEN'; end if;

  return jsonb_build_object(
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', source.id,
        'registrationId', source.registration_id,
        'route', source.route,
        'routeNote', source.route_note,
        'studentId', source.student_id,
        'leadId', source.lead_id,
        'name', source.subject_name,
        'phone', source.subject_phone,
        'grade', source.subject_grade,
        'gradeText', source.grade_text,
        'activityTitle', source.activity_title,
        'activityAt', source.activity_at,
        'suggestedStudentId', source.suggested_student_id,
        'suggestedStudentName', source.suggested_student_name,
        'updatedAt', source.updated_at
      ) order by source.updated_at desc, source.id)
      from (
        select route.id,
               route.activity_registration_id as registration_id,
               route.route,
               route.note as route_note,
               student.id as student_id,
               case when student.id is null then route.lead_id end as lead_id,
               coalesce(student.name, lead.provisional_student_name) as subject_name,
               coalesce(student.phone, lead.phone, '') as subject_phone,
               coalesce(student.grade, lead.grade_hint) as subject_grade,
               coalesce(nullif(lead.grade_text, ''), '') as grade_text,
               activity.title as activity_title,
               activity.scheduled_at as activity_at,
               lead.suggested_student_id,
               suggested.name as suggested_student_name,
               route.updated_at
          from public.activity_routes route
          join public.activity_registrations registration
            on registration.id = route.activity_registration_id
          join public.activities activity on activity.id = registration.activity_id
          left join public.leads lead on lead.id = route.lead_id
          left join public.students student
            on student.id = coalesce(route.student_id, lead.student_id)
          left join public.students suggested
            on suggested.id = lead.suggested_student_id and suggested.deleted_at is null
         where route.route <> 'closed'
           and activity.deleted_at is null
           and public.can_access_course_opportunity_subject(
             student.id, case when student.id is null then route.lead_id end,
             coalesce(student.assigned_to, lead.owner_id, route.routed_by), v_uid
           )
      ) source
    ), '[]'::jsonb),
    'opportunities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', opportunity.id,
        'sourceActivityRouteId', opportunity.source_activity_route_id,
        'studentId', opportunity.student_id,
        'leadId', opportunity.lead_id,
        'originLeadId', opportunity.origin_lead_id,
        'name', coalesce(student.name, lead.provisional_student_name),
        'phone', coalesce(student.phone, lead.phone, ''),
        'grade', coalesce(student.grade, lead.grade_hint),
        'gradeText', coalesce(nullif(lead.grade_text, ''), ''),
        'suggestedStudentId', lead.suggested_student_id,
        'suggestedStudentName', suggested.name,
        'sourceActivityTitle', source_activity.title,
        'teacherRecommendation', coalesce(source_assessment.teacher_recommendation, ''),
        'opportunityType', opportunity.opportunity_type,
        'courseId', opportunity.course_id,
        'courseTitle', course.title,
        'termId', opportunity.term_id,
        'termName', term.name,
        'stage', opportunity.stage,
        'ownerId', opportunity.owner_id,
        'ownerName', owner.display_name,
        'nextAction', opportunity.next_action,
        'nextActionAt', opportunity.next_action_at,
        'note', opportunity.note,
        'courseEnrollmentId', enrollment.id,
        'courseEnrollmentStatus', enrollment.status,
        'createdAt', opportunity.created_at,
        'updatedAt', opportunity.updated_at
      ) order by opportunity.updated_at desc, opportunity.id)
        from public.course_opportunities opportunity
        join public.courses course on course.id = opportunity.course_id
        join public.school_terms term on term.id = opportunity.term_id
        join public.profiles owner on owner.id = opportunity.owner_id
        left join public.students student on student.id = opportunity.student_id
        left join public.leads lead on lead.id = opportunity.lead_id
        left join public.students suggested
          on suggested.id = lead.suggested_student_id and suggested.deleted_at is null
        left join public.activity_routes source_route
          on source_route.id = opportunity.source_activity_route_id
        left join public.activity_registrations source_registration
          on source_registration.id = source_route.activity_registration_id
        left join public.activities source_activity
          on source_activity.id = source_registration.activity_id
        left join public.assessment_results source_assessment
          on source_assessment.activity_registration_id = source_registration.id
        left join public.course_enrollments enrollment
          on enrollment.opportunity_id = opportunity.id
       where public.can_access_course_opportunity_subject(
         opportunity.student_id, opportunity.lead_id,
         opportunity.owner_id, v_uid
       )
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.get_course_enrollment_workbench()
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not public.has_perm(v_uid, 'enrollment.manage') then raise exception 'FORBIDDEN'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', enrollment.id,
      'opportunityId', enrollment.opportunity_id,
      'studentId', enrollment.student_id,
      'studentName', student.name,
      'studentPhone', student.phone,
      'courseId', enrollment.course_id,
      'courseTitle', course.title,
      'termId', enrollment.term_id,
      'termName', term.name,
      'status', enrollment.status,
      'note', enrollment.note,
      'confirmedAt', enrollment.confirmed_at,
      'confirmedByName', confirmer.display_name,
      'cancelledAt', enrollment.cancelled_at,
      'cancelledByName', canceller.display_name,
      'assignmentId', assignment.id,
      'classroomId', assignment.classroom_id,
      'classroomName', assignment.classroom_name,
      'membershipId', assignment.classroom_membership_id,
      'assignedAt', assignment.assigned_at,
      'claimableClassroomIds', claimable.classroom_ids,
      'updatedAt', enrollment.updated_at
    ) order by enrollment.confirmed_at desc, enrollment.id)
      from public.course_enrollments enrollment
      join public.students student on student.id = enrollment.student_id
      join public.courses course on course.id = enrollment.course_id
      join public.school_terms term on term.id = enrollment.term_id
      join public.profiles confirmer on confirmer.id = enrollment.confirmed_by
      left join public.profiles canceller on canceller.id = enrollment.cancelled_by
      left join lateral (
        select bridge.id, bridge.classroom_id, bridge.classroom_membership_id,
               bridge.assigned_at, classroom.name as classroom_name
          from public.course_enrollment_assignments bridge
          join public.classrooms classroom on classroom.id = bridge.classroom_id
         where bridge.course_enrollment_id = enrollment.id
           and bridge.status = 'active'
         limit 1
      ) assignment on true
      left join lateral (
        select coalesce(
          jsonb_agg(roster.classroom_id order by roster.classroom_id),
          '[]'::jsonb
        ) as classroom_ids
          from public.enrollments roster
          join public.classrooms classroom on classroom.id = roster.classroom_id
          left join public.course_enrollment_assignments linked
            on linked.classroom_membership_id = roster.id
         where roster.student_id = enrollment.student_id
           and roster.status = 'active'
           and roster.term_id is not distinct from enrollment.term_id
           and classroom.course_id = enrollment.course_id
           and classroom.term_id is not distinct from enrollment.term_id
           and linked.id is null
      ) claimable on true
  ), '[]'::jsonb);
end
$$;

create or replace function public.get_phase3_enrollment_options()
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'UNAUTHENTICATED'; end if;
  if not (
    public.has_perm(v_uid, 'followup.view')
    or public.has_perm(v_uid, 'enrollment.manage')
  ) then raise exception 'FORBIDDEN'; end if;

  return jsonb_build_object(
    'courses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', course.id,
        'title', course.title,
        'productCode', course.product_code,
        'grade', course.grade,
        'classType', course.class_type
      ) order by course.grade, course.title, course.id)
        from public.courses course
       where course.status = 'enabled'
         and course.purpose = 'production'
         and course.course_kind = 'curriculum'
         and course.trashed_at is null
    ), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', term.id,
        'name', term.name,
        'isCurrent', term.is_current,
        'startsOn', term.starts_on,
        'endsOn', term.ends_on
      ) order by term.is_current desc, term.starts_on desc nulls last, term.id)
        from public.school_terms term
    ), '[]'::jsonb),
    'classrooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', classroom.id,
        'name', classroom.name,
        'courseId', classroom.course_id,
        'termId', classroom.term_id,
        'capacity', classroom.capacity,
        'activeCount', (
          select count(*) from public.enrollments roster
           where roster.classroom_id = classroom.id and roster.status = 'active'
        ),
        'operationalStatus', classroom.operational_status
      ) order by classroom.name, classroom.id)
        from public.classrooms classroom
       where public.has_perm(v_uid, 'enrollment.manage')
         and classroom.archived_at is null
         and classroom.trashed_at is null
         and classroom.operational_status in ('planning','active')
         and classroom.purpose = 'production'
         and classroom.offering_type = 'long_term_formal'
         and classroom.course_id is not null
         and classroom.term_id is not null
         and public.can_manage_classroom(classroom.id, v_uid)
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.can_access_course_opportunity_subject(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.guard_phase3_enrollment_history()
  from public, anon, authenticated;
revoke all on function public.course_opportunity_transition_allowed(text,text)
  from public, anon, authenticated;
revoke all on function public.save_course_opportunity(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,text,timestamptz,text)
  from public, anon, authenticated;
revoke all on function public.rebind_course_opportunity_identity()
  from public, anon, authenticated;
revoke all on function public.confirm_course_enrollment(uuid,text)
  from public, anon, authenticated;
revoke all on function public.cancel_course_enrollment(uuid,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.assign_course_enrollment(uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.sync_course_enrollment_assignment_from_membership()
  from public, anon, authenticated;
revoke all on function public.transfer_course_enrollment(uuid,uuid,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.assign_course_enrollments(uuid[],uuid,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_course_opportunity_workbench()
  from public, anon, authenticated;
revoke all on function public.get_course_enrollment_workbench()
  from public, anon, authenticated;
revoke all on function public.get_phase3_enrollment_options()
  from public, anon, authenticated;

grant execute on function public.can_access_course_opportunity_subject(uuid,uuid,uuid,uuid)
  to authenticated;
grant execute on function public.save_course_opportunity(uuid,uuid,uuid,uuid,text,uuid,uuid,text,uuid,text,timestamptz,text)
  to authenticated;
grant execute on function public.confirm_course_enrollment(uuid,text)
  to authenticated;
grant execute on function public.cancel_course_enrollment(uuid,text,timestamptz)
  to authenticated;
grant execute on function public.assign_course_enrollment(uuid,uuid,text,timestamptz)
  to authenticated;
grant execute on function public.transfer_course_enrollment(uuid,uuid,text,timestamptz)
  to authenticated;
grant execute on function public.assign_course_enrollments(uuid[],uuid,text,timestamptz)
  to authenticated;
grant execute on function public.get_course_opportunity_workbench()
  to authenticated;
grant execute on function public.get_course_enrollment_workbench()
  to authenticated;
grant execute on function public.get_phase3_enrollment_options()
  to authenticated;

select pg_notify('pgrst', 'reload schema');
