-- SCHOOL-OPS Phase 5: long-term operations around the canonical Phase 3
-- course_opportunities / course_enrollments model.
--
-- A renewal entry points back to the existing student and class membership.
-- Teacher signals and referrals are auditable hand-off facts; none of these
-- tables duplicates Student or creates a renewal-specific enrollment record.

-- ---------------------------------------------------------------------------
-- 1. Renewal cycles and their links to canonical course opportunities.
-- ---------------------------------------------------------------------------

create table public.renewal_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  source_term_id uuid not null references public.school_terms(id) on delete restrict,
  target_term_id uuid not null references public.school_terms(id) on delete restrict,
  status text not null default 'planning'
    check (status in ('planning', 'open', 'closed')),
  preparation_starts_on date,
  decision_due_on date,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campus_id, source_term_id, target_term_id),
  constraint renewal_cycles_distinct_terms check (source_term_id <> target_term_id),
  constraint renewal_cycles_dates_check check (
    preparation_starts_on is null
    or decision_due_on is null
    or decision_due_on >= preparation_starts_on
  )
);

create trigger renewal_cycles_set_updated_at
  before update on public.renewal_cycles
  for each row execute function public.set_updated_at();

create table public.renewal_cycle_entries (
  renewal_cycle_id uuid not null references public.renewal_cycles(id) on delete cascade,
  opportunity_id uuid references public.course_opportunities(id) on delete restrict,
  source_class_membership_id uuid not null references public.enrollments(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  eligible_at timestamptz not null default now(),
  prepared_at timestamptz,
  primary key (renewal_cycle_id, source_class_membership_id),
  constraint renewal_cycle_entries_prepared_check check (
    (opportunity_id is null and prepared_at is null)
    or (opportunity_id is not null and prepared_at is not null)
  )
);

create index renewal_cycle_entries_cycle_idx
  on public.renewal_cycle_entries(renewal_cycle_id, eligible_at desc);
create unique index renewal_cycle_entries_opportunity_idx
  on public.renewal_cycle_entries(opportunity_id) where opportunity_id is not null;

comment on table public.renewal_cycle_entries is
  'Bridge from an existing class membership into a canonical renewal opportunity; it is not a second renewal roster.';

-- ---------------------------------------------------------------------------
-- 2. Professional teaching signals handed to learning support.
-- ---------------------------------------------------------------------------

create table public.teacher_professional_signals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  source_class_membership_id uuid not null references public.enrollments(id) on delete restrict,
  classroom_id uuid not null references public.classrooms(id) on delete restrict,
  source_session_id uuid references public.class_sessions(id) on delete restrict,
  signal_type text not null
    check (signal_type in (
      'renewal_recommendation', 'upsell_recommendation',
      'churn_risk', 'reactivation_recommendation'
    )),
  recommendation text not null check (length(btrim(recommendation)) between 1 and 2000),
  suggested_course_id uuid references public.courses(id) on delete restrict,
  target_term_id uuid references public.school_terms(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'dismissed')),
  opportunity_id uuid references public.course_opportunities(id) on delete restrict,
  source_teacher_id uuid not null references public.profiles(id) on delete restrict,
  resolved_by uuid references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint teacher_professional_signals_resolution_check check (
    (status = 'pending' and opportunity_id is null and resolved_by is null and resolved_at is null)
    or (status = 'accepted' and opportunity_id is not null and resolved_by is not null and resolved_at is not null)
    or (status = 'dismissed' and opportunity_id is null and resolved_by is not null and resolved_at is not null)
  )
);

create index teacher_professional_signals_queue_idx
  on public.teacher_professional_signals(status, occurred_at desc);
create index teacher_professional_signals_student_idx
  on public.teacher_professional_signals(student_id, occurred_at desc);

create unique index teacher_professional_signals_one_pending_context_idx
  on public.teacher_professional_signals(
    source_class_membership_id,
    coalesce(source_session_id, '00000000-0000-0000-0000-000000000000'::uuid),
    signal_type
  ) where status = 'pending';

create trigger teacher_professional_signals_set_updated_at
  before update on public.teacher_professional_signals
  for each row execute function public.set_updated_at();

comment on table public.teacher_professional_signals is
  'Structured professional advice crossing from teaching delivery to learning-support operations.';

-- ---------------------------------------------------------------------------
-- 3. Referrals preserve the referring student and point at a Lead seed.
-- ---------------------------------------------------------------------------

create table public.student_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_student_id uuid not null references public.students(id) on delete restrict,
  referrer_family_id uuid references public.families(id) on delete restrict,
  referrer_contact_id uuid references public.contacts(id) on delete restrict,
  referred_lead_id uuid not null references public.leads(id) on delete restrict,
  referred_source_record_id uuid references public.lead_source_records(id) on delete restrict,
  relationship text not null default '' check (length(relationship) <= 120),
  note text not null default '' check (length(note) <= 2000),
  opportunity_id uuid references public.course_opportunities(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (referrer_student_id, referred_lead_id)
);

create index student_referrals_referrer_idx
  on public.student_referrals(referrer_student_id, created_at desc);
comment on table public.student_referrals is
  'Source-attribution bridge from a stable existing student to a Lead seed. Lead owns CRM status/owner; canonical opportunity owns product progress.';

-- ---------------------------------------------------------------------------
-- 4. RLS: readable work queues, RPC-only writes.
-- ---------------------------------------------------------------------------

alter table public.renewal_cycles enable row level security;
alter table public.renewal_cycle_entries enable row level security;
alter table public.teacher_professional_signals enable row level security;
alter table public.student_referrals enable row level security;

create policy renewal_cycles_staff_read on public.renewal_cycles
  for select to authenticated using (
    public.is_staff((select auth.uid()))
    and (
      public.has_perm((select auth.uid()), 'followup.view')
      or public.has_perm((select auth.uid()), 'review.write')
      or public.has_perm((select auth.uid()), 'enrollment.manage')
    )
  );

create policy renewal_cycle_entries_staff_read on public.renewal_cycle_entries
  for select to authenticated using (
    public.is_staff((select auth.uid()))
    and public.has_perm((select auth.uid()), 'followup.view')
    and exists (
      select 1
        from public.enrollments source_membership
       where source_membership.id = source_class_membership_id
         and public.can_access_student(source_membership.student_id, (select auth.uid()))
    )
  );

create policy teacher_professional_signals_scope_read on public.teacher_professional_signals
  for select to authenticated using (
    source_teacher_id = (select auth.uid())
    or (
      public.has_perm((select auth.uid()), 'followup.view')
      and public.can_access_student(student_id, (select auth.uid()))
    )
  );

create policy student_referrals_scope_read on public.student_referrals
  for select to authenticated using (
    created_by = (select auth.uid())
    or (
      public.has_perm((select auth.uid()), 'followup.view')
      and (
        public.can_access_student(referrer_student_id, (select auth.uid()))
        or exists (
          select 1
            from public.leads referred_lead
           where referred_lead.id = referred_lead_id
             and (
               referred_lead.owner_id is null
               or referred_lead.owner_id = (select auth.uid())
               or public.has_perm((select auth.uid()), 'student.view.all')
             )
        )
      )
    )
  );

revoke all on public.renewal_cycles, public.renewal_cycle_entries,
  public.teacher_professional_signals, public.student_referrals
  from public, anon, authenticated;
grant select on public.renewal_cycles, public.renewal_cycle_entries,
  public.teacher_professional_signals, public.student_referrals
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Stable lifecycle and source-attribution writes.
-- ---------------------------------------------------------------------------

create or replace function public.create_renewal_cycle(
  p_name text,
  p_source_term_id uuid,
  p_target_term_id uuid,
  p_preparation_starts_on date default null,
  p_decision_due_on date default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_source_key integer;
  v_target_key integer;
  v_source_campus_id uuid;
  v_target_campus_id uuid;
  v_cycle_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'followup.write') then
    raise exception 'FORBIDDEN';
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 160
     or p_source_term_id is null
     or p_target_term_id is null
     or (p_preparation_starts_on is not null and p_decision_due_on is not null
         and p_decision_due_on < p_preparation_starts_on) then
    raise exception 'VALIDATION';
  end if;

  select school_year.start_year * 10 + term_row.term, term_row.campus_id
    into v_source_key, v_source_campus_id
    from public.school_terms term_row
    join public.school_years school_year on school_year.id = term_row.school_year_id
   where term_row.id = p_source_term_id;
  select school_year.start_year * 10 + term_row.term, term_row.campus_id
    into v_target_key, v_target_campus_id
    from public.school_terms term_row
    join public.school_years school_year on school_year.id = term_row.school_year_id
   where term_row.id = p_target_term_id;

  if v_source_key is null or v_target_key is null
     or v_source_campus_id is null or v_target_campus_id is null
     or v_source_campus_id is distinct from v_target_campus_id
     or v_target_key <= v_source_key then
    raise exception 'INVALID_TERM_SEQUENCE';
  end if;

  insert into public.renewal_cycles(
    name, campus_id, source_term_id, target_term_id, preparation_starts_on,
    decision_due_on, created_by
  ) values (
    btrim(p_name), v_source_campus_id, p_source_term_id, p_target_term_id,
    p_preparation_starts_on, p_decision_due_on, v_uid
  ) returning id into v_cycle_id;

  return v_cycle_id;
exception
  when unique_violation then raise exception 'INVALID_CYCLE_STATE';
end
$$;

create or replace function public.set_renewal_cycle_status(
  p_cycle_id uuid,
  p_status text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_current text;
begin
  if v_uid is null or not public.has_perm(v_uid, 'followup.write') then
    raise exception 'FORBIDDEN';
  end if;
  if p_status not in ('planning', 'open', 'closed') then raise exception 'VALIDATION'; end if;

  select status into v_current
    from public.renewal_cycles
   where id = p_cycle_id
   for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_current = p_status then return; end if;
  if not ((v_current = 'planning' and p_status = 'open')
      or (v_current = 'open' and p_status = 'closed')) then
    raise exception 'INVALID_CYCLE_STATE';
  end if;

  update public.renewal_cycles set status = p_status where id = p_cycle_id;
end
$$;

create or replace function public.guard_closed_renewal_cycle()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'closed' then raise exception 'INVALID_CYCLE_STATE'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger renewal_cycles_closed_immutable
  before update or delete on public.renewal_cycles
  for each row execute function public.guard_closed_renewal_cycle();

create or replace function public.guard_renewal_cycle_entry_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cycle_id uuid := case when tg_op = 'DELETE' then old.renewal_cycle_id else new.renewal_cycle_id end;
begin
  if exists (select 1 from public.renewal_cycles where id = v_cycle_id and status = 'closed') then
    raise exception 'INVALID_CYCLE_STATE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger renewal_cycle_entries_closed_guard
  before insert or update or delete on public.renewal_cycle_entries
  for each row execute function public.guard_renewal_cycle_entry_write();

create or replace function public.snapshot_renewal_cycle_memberships(p_cycle_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_cycle public.renewal_cycles;
  v_added integer;
  v_eligible integer;
begin
  if v_uid is null or not public.has_perm(v_uid, 'followup.write') then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_cycle from public.renewal_cycles where id = p_cycle_id for update;
  if v_cycle.id is null then raise exception 'NOT_FOUND'; end if;
  if v_cycle.status = 'closed' then raise exception 'INVALID_CYCLE_STATE'; end if;

  insert into public.renewal_cycle_entries(
    renewal_cycle_id, source_class_membership_id, created_by
  )
  select v_cycle.id, membership.id, v_uid
    from public.enrollments membership
    join public.students student on student.id = membership.student_id
   where membership.term_id = v_cycle.source_term_id
     and membership.status = 'active'
     and student.deleted_at is null
     and public.can_access_student(student.id, v_uid)
  on conflict (renewal_cycle_id, source_class_membership_id) do nothing;
  get diagnostics v_added = row_count;

  select count(*) into v_eligible
    from public.renewal_cycle_entries
   where renewal_cycle_id = v_cycle.id;

  return jsonb_build_object('added', v_added, 'eligible', v_eligible);
end
$$;

create or replace function public.create_teacher_professional_signal(
  p_student_id uuid,
  p_source_membership_id uuid,
  p_source_session_id uuid,
  p_signal_type text,
  p_recommendation text,
  p_suggested_course_id uuid default null,
  p_target_term_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_membership public.enrollments;
  v_session public.class_sessions;
  v_signal_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'review.write') then
    raise exception 'FORBIDDEN';
  end if;
  if p_signal_type not in (
       'renewal_recommendation', 'upsell_recommendation',
       'churn_risk', 'reactivation_recommendation'
     )
     or length(btrim(coalesce(p_recommendation, ''))) not between 1 and 2000 then
    raise exception 'VALIDATION';
  end if;

  select membership.* into v_membership
    from public.enrollments membership
   where membership.id = p_source_membership_id
     and membership.student_id = p_student_id;
  if not found then raise exception 'INVALID_MEMBERSHIP'; end if;

  if p_source_session_id is not null then
    select session_row.* into v_session
      from public.class_sessions session_row
     where session_row.id = p_source_session_id
       and session_row.classroom_id = v_membership.classroom_id
       and session_row.deleted_at is null
       and session_row.cancelled_by is null
       and session_row.voided_at is null;
    if not found then raise exception 'INVALID_MEMBERSHIP'; end if;

    if not (
      (
        coalesce(v_session.started_at, v_session.scheduled_at) is not null
        and v_membership.joined_at <= coalesce(v_session.started_at, v_session.scheduled_at)
        and (
          v_membership.left_at is null
          or v_membership.left_at > coalesce(v_session.started_at, v_session.scheduled_at)
        )
      )
      or (
        coalesce(v_session.started_at, v_session.scheduled_at) is null
        and v_membership.status = 'active'
        and v_membership.left_at is null
      )
    ) then
      raise exception 'INVALID_MEMBERSHIP';
    end if;

    if not public.is_admin(v_uid)
       and not public.is_classroom_teacher(v_membership.classroom_id, v_uid)
       and not (v_session.teacher_override = v_uid and public.is_staff(v_uid)) then
      raise exception 'FORBIDDEN_SCOPE';
    end if;
  else
    if v_membership.status not in ('active', 'completed') then
      raise exception 'INVALID_MEMBERSHIP';
    end if;
    if not public.is_admin(v_uid)
       and not public.is_classroom_teacher(v_membership.classroom_id, v_uid) then
      raise exception 'FORBIDDEN_SCOPE';
    end if;
  end if;
  if p_suggested_course_id is not null and not exists (
    select 1 from public.courses course where course.id = p_suggested_course_id
  ) then raise exception 'NOT_FOUND'; end if;
  if p_target_term_id is not null and not exists (
    select 1 from public.school_terms term_row where term_row.id = p_target_term_id
  ) then raise exception 'NOT_FOUND'; end if;

  insert into public.teacher_professional_signals(
    student_id, source_class_membership_id, classroom_id, source_session_id,
    signal_type, recommendation, suggested_course_id, target_term_id,
    source_teacher_id
  ) values (
    p_student_id, p_source_membership_id, v_membership.classroom_id, p_source_session_id,
    p_signal_type, btrim(p_recommendation), p_suggested_course_id,
    p_target_term_id, v_uid
  ) returning id into v_signal_id;

  return v_signal_id;
exception
  when unique_violation then raise exception 'SIGNAL_ALREADY_HANDLED';
end
$$;

create or replace function public.attach_student_referral_source(
  p_referrer_student_id uuid,
  p_referrer_family_id uuid,
  p_referrer_contact_id uuid,
  p_referred_lead_id uuid,
  p_referred_source_record_id uuid,
  p_new_lead_name text default null,
  p_new_lead_phone text default null,
  p_new_lead_grade_hint smallint default null,
  p_relationship text default '',
  p_note text default ''
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_lead_student_id uuid;
  v_lead_status text;
  v_name_key text;
  v_phone_key text;
  v_referral_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'followup.write') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.can_access_student(p_referrer_student_id, v_uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;
  if length(coalesce(p_relationship, '')) > 120 or length(coalesce(p_note, '')) > 2000 then
    raise exception 'VALIDATION';
  end if;

  if (p_referred_lead_id is null) <> (
    length(btrim(coalesce(p_new_lead_name, ''))) > 0
    or length(btrim(coalesce(p_new_lead_phone, ''))) > 0
    or p_new_lead_grade_hint is not null
  ) then
    raise exception 'VALIDATION';
  end if;

  if p_referred_lead_id is null then
    v_name_key := public.normalize_lead_name(p_new_lead_name);
    v_phone_key := public.normalize_school_ops_phone(p_new_lead_phone);
    if length(btrim(coalesce(p_new_lead_name, ''))) not between 1 and 100
       or length(btrim(coalesce(p_new_lead_phone, ''))) not between 6 and 40
       or v_phone_key !~ '^[0-9]{6,20}$'
       or (p_new_lead_grade_hint is not null and p_new_lead_grade_hint not between 1 and 12) then
      raise exception 'VALIDATION';
    end if;

    perform pg_advisory_xact_lock(hashtext('lead-seed:' || v_phone_key || ':' || v_name_key));
    select lead.id into p_referred_lead_id
      from public.leads lead
     where lead.phone_normalized = v_phone_key
       and lead.normalized_name = v_name_key
     limit 1;

    if p_referred_lead_id is null then
      insert into public.leads(
        provisional_student_name, normalized_name, phone, phone_normalized,
        grade_hint, grade_text, status, owner_id, created_by
      ) values (
        btrim(p_new_lead_name), v_name_key, btrim(p_new_lead_phone), v_phone_key,
        p_new_lead_grade_hint, '', 'uncontacted', null, v_uid
      )
      on conflict (phone_normalized, normalized_name) do nothing
      returning id into p_referred_lead_id;

      if p_referred_lead_id is null then
        select lead.id into p_referred_lead_id
          from public.leads lead
         where lead.phone_normalized = v_phone_key
           and lead.normalized_name = v_name_key
         limit 1;
      end if;
    end if;
  end if;

  select student_id, status into v_lead_student_id, v_lead_status
    from public.leads where id = p_referred_lead_id;
  if not found or v_lead_status = 'invalid' then raise exception 'NOT_FOUND'; end if;
  if not (
    exists (
      select 1 from public.leads scoped_lead
       where scoped_lead.id = p_referred_lead_id
         and (
           scoped_lead.owner_id is null
           or scoped_lead.owner_id = v_uid
           or public.has_perm(v_uid, 'student.view.all')
         )
    )
  ) then raise exception 'LEAD_SCOPE_MISMATCH'; end if;
  if v_lead_student_id = p_referrer_student_id then raise exception 'VALIDATION'; end if;
  if p_referrer_family_id is not null and not exists (
    select 1 from public.family_students family_student
     where family_student.family_id = p_referrer_family_id
       and family_student.student_id = p_referrer_student_id
  ) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if p_referrer_contact_id is not null and not exists (
    select 1
      from public.family_contacts family_contact
      join public.family_students family_student
        on family_student.family_id = family_contact.family_id
       and family_student.student_id = p_referrer_student_id
     where family_contact.contact_id = p_referrer_contact_id
       and (p_referrer_family_id is null or family_contact.family_id = p_referrer_family_id)
  ) then raise exception 'FORBIDDEN_SCOPE'; end if;
  if p_referred_source_record_id is not null and not exists (
    select 1 from public.lead_source_records source_record
     where source_record.id = p_referred_source_record_id
       and source_record.lead_id = p_referred_lead_id
  ) then raise exception 'NOT_FOUND'; end if;

  insert into public.student_referrals(
    referrer_student_id, referrer_family_id, referrer_contact_id,
    referred_lead_id, referred_source_record_id, relationship, note, created_by
  ) values (
    p_referrer_student_id, p_referrer_family_id, p_referrer_contact_id,
    p_referred_lead_id, p_referred_source_record_id,
    btrim(coalesce(p_relationship, '')), btrim(coalesce(p_note, '')), v_uid
  ) returning id into v_referral_id;
  return v_referral_id;
exception
  when unique_violation then raise exception 'LEAD_ALREADY_REFERRED';
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Opportunity orchestration. Every canonical mutation goes through the
-- Phase 3 save_course_opportunity contract; Phase 5 only adds source links.
-- ---------------------------------------------------------------------------

create or replace function public.prepare_renewal_opportunities(
  p_cycle_id uuid,
  p_membership_ids uuid[],
  p_owner_id uuid,
  p_next_action text,
  p_next_action_at timestamptz
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_cycle public.renewal_cycles;
  v_membership record;
  v_opportunity_id uuid;
  v_existing_id uuid;
  v_created integer := 0;
  v_reused integer := 0;
begin
  if v_uid is null or not public.has_perm(v_uid, 'followup.write') then
    raise exception 'FORBIDDEN';
  end if;
  if coalesce(array_length(p_membership_ids, 1), 0) not between 1 and 200
     or length(btrim(coalesce(p_next_action, ''))) not between 1 and 500
     or p_next_action_at is null then raise exception 'VALIDATION'; end if;

  select * into v_cycle from public.renewal_cycles where id = p_cycle_id for update;
  if v_cycle.id is null then raise exception 'NOT_FOUND'; end if;
  if v_cycle.status <> 'open' then raise exception 'INVALID_CYCLE_STATE'; end if;

  perform public.snapshot_renewal_cycle_memberships(v_cycle.id);

  for v_membership in
    select membership.id,
           membership.student_id,
           classroom.course_id
      from unnest(p_membership_ids) requested(id)
      join public.renewal_cycle_entries entry
        on entry.renewal_cycle_id = v_cycle.id
       and entry.source_class_membership_id = requested.id
      join public.enrollments membership
        on membership.id = entry.source_class_membership_id
      join public.classrooms classroom on classroom.id = membership.classroom_id
     where membership.term_id = v_cycle.source_term_id
       and membership.status = 'active'
     order by membership.id
     for update of entry
  loop
    if v_membership.course_id is null then raise exception 'COURSE_REQUIRED'; end if;
    if not public.can_access_student(v_membership.student_id, v_uid) then
      raise exception 'FORBIDDEN_SCOPE';
    end if;

    select opportunity.id into v_existing_id
      from public.course_opportunities opportunity
     where opportunity.student_id = v_membership.student_id
       and opportunity.opportunity_type = 'renewal'
       and opportunity.course_id = v_membership.course_id
       and opportunity.term_id = v_cycle.target_term_id
     limit 1;

    v_opportunity_id := public.save_course_opportunity(
      null,
      null,
      v_membership.student_id,
      null,
      'renewal',
      v_membership.course_id,
      v_cycle.target_term_id,
      'planning',
      p_owner_id,
      btrim(p_next_action),
      p_next_action_at,
      'Renewal cycle: ' || v_cycle.name
    );

    update public.renewal_cycle_entries
       set opportunity_id = v_opportunity_id,
           prepared_at = coalesce(prepared_at, now())
     where renewal_cycle_id = v_cycle.id
       and source_class_membership_id = v_membership.id;

    if v_existing_id is null then v_created := v_created + 1;
    else v_reused := v_reused + 1;
    end if;
  end loop;

  if v_created + v_reused <> cardinality(p_membership_ids) then
    raise exception 'INVALID_MEMBERSHIP';
  end if;

  return jsonb_build_object('created', v_created, 'reused', v_reused);
end
$$;

create or replace function public.resolve_teacher_professional_signal(
  p_signal_id uuid,
  p_resolution text,
  p_course_id uuid,
  p_term_id uuid,
  p_owner_id uuid,
  p_next_action text,
  p_next_action_at timestamptz,
  p_note text default ''
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_signal public.teacher_professional_signals;
  v_opportunity_type text;
  v_opportunity_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'followup.write') then
    raise exception 'FORBIDDEN';
  end if;
  if p_resolution not in ('accept', 'dismiss') or length(coalesce(p_note, '')) > 2000 then
    raise exception 'VALIDATION';
  end if;

  select * into v_signal
    from public.teacher_professional_signals
   where id = p_signal_id
   for update;
  if v_signal.id is null then raise exception 'NOT_FOUND'; end if;
  if v_signal.status <> 'pending' then raise exception 'SIGNAL_ALREADY_HANDLED'; end if;
  if not public.can_access_student(v_signal.student_id, v_uid) then
    raise exception 'FORBIDDEN_SCOPE';
  end if;

  if p_resolution = 'dismiss' then
    update public.teacher_professional_signals
       set status = 'dismissed', resolved_by = v_uid, resolved_at = now()
     where id = v_signal.id;
    return null;
  end if;

  if p_course_id is null or p_term_id is null or p_owner_id is null
     or p_next_action_at is null
     or length(btrim(coalesce(p_next_action, ''))) not between 1 and 500 then
    raise exception 'SIGNAL_CONTEXT_REQUIRED';
  end if;

  v_opportunity_type := case v_signal.signal_type
    when 'upsell_recommendation' then 'upsell'
    when 'reactivation_recommendation' then 'reactivate'
    else 'renewal'
  end;

  v_opportunity_id := public.save_course_opportunity(
    null,
    null,
    v_signal.student_id,
    null,
    v_opportunity_type,
    p_course_id,
    p_term_id,
    'planning',
    p_owner_id,
    btrim(p_next_action),
    p_next_action_at,
    left(
      case when btrim(coalesce(p_note, '')) = '' then v_signal.recommendation
           else v_signal.recommendation || E'\n' || btrim(p_note)
      end,
      2000
    )
  );

  update public.teacher_professional_signals
     set status = 'accepted',
         opportunity_id = v_opportunity_id,
         resolved_by = v_uid,
         resolved_at = now()
   where id = v_signal.id;
  return v_opportunity_id;
end
$$;

create or replace function public.convert_student_referral_to_opportunity(
  p_referral_id uuid,
  p_course_id uuid,
  p_term_id uuid,
  p_owner_id uuid,
  p_next_action text,
  p_next_action_at timestamptz,
  p_note text default ''
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_referral public.student_referrals;
  v_student_id uuid;
  v_lead_status text;
  v_confirmed_at timestamptz;
  v_opportunity_id uuid;
begin
  if v_uid is null or not public.has_perm(v_uid, 'followup.write') then
    raise exception 'FORBIDDEN';
  end if;
  if length(btrim(coalesce(p_next_action, ''))) not between 1 and 500
     or p_next_action_at is null or length(coalesce(p_note, '')) > 2000 then
    raise exception 'VALIDATION';
  end if;

  select * into v_referral from public.student_referrals where id = p_referral_id for update;
  if v_referral.id is null then raise exception 'NOT_FOUND'; end if;
  if v_referral.opportunity_id is not null then return v_referral.opportunity_id; end if;
  if not public.can_access_student(v_referral.referrer_student_id, v_uid)
     and v_referral.created_by <> v_uid then raise exception 'FORBIDDEN_SCOPE'; end if;

  select lead.student_id, lead.status, lead.identity_confirmed_at
    into v_student_id, v_lead_status, v_confirmed_at
    from public.leads lead
   where lead.id = v_referral.referred_lead_id;
  if v_student_id is null or v_lead_status <> 'converted' or v_confirmed_at is null then
    raise exception 'LEAD_IDENTITY_REQUIRED';
  end if;

  v_opportunity_id := public.save_course_opportunity(
    null,
    null,
    v_student_id,
    null,
    'referral',
    p_course_id,
    p_term_id,
    'planning',
    p_owner_id,
    btrim(p_next_action),
    p_next_action_at,
    left(concat_ws(
      E'\n',
      nullif('Referral relationship: ' || btrim(v_referral.relationship), 'Referral relationship: '),
      nullif(btrim(v_referral.note), ''),
      nullif(btrim(coalesce(p_note, '')), '')
    ), 2000)
  );

  update public.student_referrals
     set opportunity_id = v_opportunity_id
   where id = v_referral.id;
  return v_opportunity_id;
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Execute surface and schema reload.
-- ---------------------------------------------------------------------------

revoke all on function public.guard_closed_renewal_cycle() from public, anon, authenticated;
revoke all on function public.guard_renewal_cycle_entry_write() from public, anon, authenticated;
revoke all on function public.create_renewal_cycle(text,uuid,uuid,date,date) from public, anon, authenticated;
revoke all on function public.set_renewal_cycle_status(uuid,text) from public, anon, authenticated;
revoke all on function public.snapshot_renewal_cycle_memberships(uuid) from public, anon, authenticated;
revoke all on function public.create_teacher_professional_signal(uuid,uuid,uuid,text,text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.attach_student_referral_source(uuid,uuid,uuid,uuid,uuid,text,text,smallint,text,text) from public, anon, authenticated;
revoke all on function public.prepare_renewal_opportunities(uuid,uuid[],uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_teacher_professional_signal(uuid,text,uuid,uuid,uuid,text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.convert_student_referral_to_opportunity(uuid,uuid,uuid,uuid,text,timestamptz,text) from public, anon, authenticated;

grant execute on function public.create_renewal_cycle(text,uuid,uuid,date,date) to authenticated;
grant execute on function public.set_renewal_cycle_status(uuid,text) to authenticated;
grant execute on function public.snapshot_renewal_cycle_memberships(uuid) to authenticated;
grant execute on function public.create_teacher_professional_signal(uuid,uuid,uuid,text,text,uuid,uuid) to authenticated;
grant execute on function public.attach_student_referral_source(uuid,uuid,uuid,uuid,uuid,text,text,smallint,text,text) to authenticated;
grant execute on function public.prepare_renewal_opportunities(uuid,uuid[],uuid,text,timestamptz) to authenticated;
grant execute on function public.resolve_teacher_professional_signal(uuid,text,uuid,uuid,uuid,text,timestamptz,text) to authenticated;
grant execute on function public.convert_student_referral_to_opportunity(uuid,uuid,uuid,uuid,text,timestamptz,text) to authenticated;

select pg_notify('pgrst', 'reload schema');
