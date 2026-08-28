-- DEV-ORG-1: organization-wide academic years and teaching calendar.
-- Campus remains only a room directory. Legacy campus_id columns and campus
-- RPC signatures remain for the rollback window, but V2 reads/writes use one
-- organization-wide academic axis.

begin;

-- ---------------------------------------------------------------------------
-- 1. Merge byte-for-business-identical duplicate years and reattach every FK.
-- The preceding migration already rejects content/date/status differences.
-- ---------------------------------------------------------------------------

alter table public.domain_events disable trigger domain_events_immutable;

do $$
declare
  duplicate_group record;
  canonical_year_id uuid;
  duplicate_year record;
  duplicate_term record;
  canonical_term_id uuid;
  canonical_signature jsonb;
  duplicate_signature jsonb;
begin
  for duplicate_group in
    select start_year from public.school_years group by start_year having count(*) > 1
  loop
    select id into canonical_year_id
      from public.school_years
     where start_year = duplicate_group.start_year
     order by created_at, id limit 1;

    select jsonb_build_object(
      'name', year_row.name,
      'status', year_row.status,
      'gradeEffectiveOn', year_row.grade_effective_on,
      'periods', coalesce((select jsonb_agg(jsonb_build_object(
        'term', term_row.term, 'name', term_row.name,
        'startsOn', term_row.starts_on, 'endsOn', term_row.ends_on,
        'isCurrent', term_row.is_current
      ) order by term_row.term) from public.school_terms term_row
       where term_row.school_year_id = year_row.id), '[]'::jsonb)
    ) into canonical_signature
    from public.school_years year_row where year_row.id = canonical_year_id;

    for duplicate_year in
      select * from public.school_years
       where start_year = duplicate_group.start_year and id <> canonical_year_id
       order by created_at, id
    loop
      select jsonb_build_object(
        'name', year_row.name,
        'status', year_row.status,
        'gradeEffectiveOn', year_row.grade_effective_on,
        'periods', coalesce((select jsonb_agg(jsonb_build_object(
          'term', term_row.term, 'name', term_row.name,
          'startsOn', term_row.starts_on, 'endsOn', term_row.ends_on,
          'isCurrent', term_row.is_current
        ) order by term_row.term) from public.school_terms term_row
         where term_row.school_year_id = year_row.id), '[]'::jsonb)
      ) into duplicate_signature
      from public.school_years year_row where year_row.id = duplicate_year.id;
      if duplicate_signature is distinct from canonical_signature then
        raise exception 'SCHOOL_YEAR_CONTENT_CONFLICT: %', duplicate_group.start_year;
      end if;

      if exists (
        select 1
          from public.student_school_year_grades duplicate_grade
          join public.student_school_year_grades canonical_grade
            on canonical_grade.student_id = duplicate_grade.student_id
           and canonical_grade.school_year_id = canonical_year_id
         where duplicate_grade.school_year_id = duplicate_year.id
           and (duplicate_grade.grade is distinct from canonical_grade.grade
             or duplicate_grade.effective_on is distinct from canonical_grade.effective_on)
      ) then raise exception 'SCHOOL_YEAR_GRADE_CONFLICT: %', duplicate_group.start_year; end if;

      delete from public.student_school_year_grades duplicate_grade
       using public.student_school_year_grades canonical_grade
       where duplicate_grade.school_year_id = duplicate_year.id
         and canonical_grade.school_year_id = canonical_year_id
         and canonical_grade.student_id = duplicate_grade.student_id;
      update public.student_school_year_grades
         set school_year_id = canonical_year_id
       where school_year_id = duplicate_year.id;

      for duplicate_term in
        select * from public.school_terms where school_year_id = duplicate_year.id order by term
      loop
        select id into canonical_term_id from public.school_terms
         where school_year_id = canonical_year_id and term = duplicate_term.term;
        if canonical_term_id is null then
          raise exception 'SCHOOL_YEAR_PERIOD_CONFLICT: %', duplicate_group.start_year;
        end if;

        if exists (
          select 1
            from public.student_grade_history duplicate_grade
            join public.student_grade_history canonical_grade
              on canonical_grade.student_id = duplicate_grade.student_id
             and canonical_grade.term_id = canonical_term_id
           where duplicate_grade.term_id = duplicate_term.id
             and duplicate_grade.grade is distinct from canonical_grade.grade
        ) then raise exception 'SCHOOL_TERM_GRADE_CONFLICT: %', duplicate_term.id; end if;

        delete from public.student_grade_history duplicate_grade
         using public.student_grade_history canonical_grade
         where duplicate_grade.term_id = duplicate_term.id
           and canonical_grade.term_id = canonical_term_id
           and canonical_grade.student_id = duplicate_grade.student_id;

        update public.classrooms set term_id = canonical_term_id where term_id = duplicate_term.id;
        update public.class_sessions set term_id = canonical_term_id where term_id = duplicate_term.id;
        update public.courses set term_id = canonical_term_id where term_id = duplicate_term.id;
        update public.enrollments set term_id = canonical_term_id where term_id = duplicate_term.id;
        update public.orders set term_id = canonical_term_id where term_id = duplicate_term.id;
        update public.activities set term_id = canonical_term_id where term_id = duplicate_term.id;
        update public.session_reviews set term_id = canonical_term_id where term_id = duplicate_term.id;
        update public.session_videos set term_id = canonical_term_id where term_id = duplicate_term.id;
        update public.student_grade_history set term_id = canonical_term_id where term_id = duplicate_term.id;
        update public.domain_events set term_id = canonical_term_id where term_id = duplicate_term.id;
        update public.session_changes set term_id = canonical_term_id where term_id = duplicate_term.id;
        update public.learning_result_heads set term_id = canonical_term_id where term_id = duplicate_term.id;
        delete from public.school_terms where id = duplicate_term.id;
      end loop;

      delete from public.school_years where id = duplicate_year.id;
    end loop;
  end loop;
end
$$;

alter table public.domain_events enable trigger domain_events_immutable;

create unique index if not exists school_years_start_year_org_unique_idx
  on public.school_years(start_year);
create unique index if not exists school_years_one_active_org_idx
  on public.school_years((1)) where status = 'active';
create unique index if not exists school_terms_one_current_org_idx
  on public.school_terms((1)) where is_current;

-- ---------------------------------------------------------------------------
-- 2. Organization-wide academic year functions. The optional campus argument
-- is retained only so the previous application can call the same signature.
-- ---------------------------------------------------------------------------

create or replace function public.current_school_year_id(p_campus_id uuid default null)
returns uuid language sql security definer stable
set search_path = public, pg_temp
as $$
  select year_row.id from public.school_years year_row
   where year_row.status = 'active'
   order by year_row.start_year desc limit 1
$$;

create or replace function public.current_school_term_id(p_campus_id uuid default null)
returns uuid language sql security definer stable
set search_path = public, pg_temp
as $$
  select term_row.id from public.school_terms term_row
   where term_row.is_current
   order by term_row.year desc, term_row.term desc limit 1
$$;

create or replace function public.create_school_year(p_start_year int)
returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); year_id uuid; compatibility_campus_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if p_start_year < 2020 or p_start_year > 2100 then raise exception 'INVALID_SCHOOL_YEAR'; end if;
  if exists(select 1 from public.school_years where start_year = p_start_year) then
    raise exception 'SCHOOL_YEAR_ALREADY_EXISTS';
  end if;
  compatibility_campus_id := public.default_campus_id();
  if compatibility_campus_id is null then raise exception 'COMPATIBILITY_CAMPUS_REQUIRED'; end if;

  insert into public.school_years(campus_id, start_year, name, status, created_by)
  values(compatibility_campus_id, p_start_year,
    p_start_year::text || '–' || (p_start_year + 1)::text || ' 学年', 'planning', uid)
  returning id into year_id;

  insert into public.school_terms(
    campus_id, school_year_id, year, term, name, starts_on, ends_on, is_current
  )
  select compatibility_campus_id, year_id, p_start_year, period.term,
         p_start_year::text || '–' || (p_start_year + 1)::text || ' 学年 · ' || period.label,
         null, null, false
    from (values (1::smallint, '暑期'), (2::smallint, '秋季'),
                 (3::smallint, '寒假'), (4::smallint, '春季')) period(term, label);

  perform public.emit_domain_event('school_year.created', 'school_year', year_id,
    jsonb_build_object('startYear', p_start_year, 'scope', 'organization'), null, null);
  return year_id;
end
$$;

create or replace function public.activate_school_term(p_term_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target public.school_terms; year_status text;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  select * into target from public.school_terms where id = p_term_id for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  select status into year_status from public.school_years where id = target.school_year_id;
  if year_status <> 'active' then raise exception 'SCHOOL_YEAR_NOT_ACTIVE'; end if;

  perform pg_advisory_xact_lock(hashtext('school-term:organization'));
  update public.school_terms set is_current = false where is_current and id <> target.id;
  update public.school_terms set is_current = true where id = target.id;
  insert into public.student_grade_history(student_id, term_id, grade, recorded_by)
  select id, target.id, grade, uid from public.students
   where deleted_at is null and grade is not null
  on conflict(student_id, term_id) do nothing;
  perform public.emit_domain_event('school_term.activated', 'school_term', target.id,
    jsonb_build_object('schoolYearId', target.school_year_id,
      'period', target.term, 'scope', 'organization'), null, null);
end
$$;

create or replace function public.get_school_year_activation_preview(p_school_year_id uuid)
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target public.school_years; current_year public.school_years;
        promote_count int; retained_count int;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  select * into target from public.school_years where id = p_school_year_id;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  select * into current_year from public.school_years where status = 'active' limit 1;
  select count(*) filter (where student_row.grade < 12),
         count(*) filter (where student_row.grade = 12)
    into promote_count, retained_count
    from public.students student_row
   where student_row.deleted_at is null
     and student_row.status not in ('alumni', 'invalid')
     and student_row.grade is not null;
  return jsonb_build_object(
    'schoolYearId', target.id,
    'status', target.status,
    'startYear', target.start_year,
    'currentStartYear', current_year.start_year,
    'promoteCount', coalesce(promote_count, 0),
    'retainedCount', coalesce(retained_count, 0),
    'canActivate', target.status = 'planning'
      and current_year.id is not null
      and target.start_year = current_year.start_year + 1
  );
end
$$;

create or replace function public.activate_school_year(
  p_school_year_id uuid,
  p_effective_on date,
  p_expected_promote_count int
) returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target public.school_years; current_year public.school_years;
        actual_promote_count int; summer_term_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if p_effective_on is null or p_expected_promote_count < 0 then raise exception 'VALIDATION'; end if;
  select * into target from public.school_years where id = p_school_year_id for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext('school-year:organization'));
  select * into current_year from public.school_years where status = 'active' for update;
  if target.status <> 'planning' then raise exception 'SCHOOL_YEAR_NOT_PLANNING'; end if;
  if current_year.id is null or target.start_year <> current_year.start_year + 1 then
    raise exception 'SCHOOL_YEAR_SEQUENCE_INVALID';
  end if;
  if extract(year from p_effective_on)::int <> target.start_year then
    raise exception 'SCHOOL_YEAR_EFFECTIVE_DATE_INVALID';
  end if;
  select count(*) into actual_promote_count from public.students student_row
   where student_row.deleted_at is null
     and student_row.status not in ('alumni', 'invalid')
     and student_row.grade between 1 and 11;
  if actual_promote_count <> p_expected_promote_count then raise exception 'SCHOOL_YEAR_PROMOTION_STALE'; end if;
  select id into summer_term_id from public.school_terms
   where school_year_id = target.id and term = 1 for update;
  if summer_term_id is null then raise exception 'SCHOOL_YEAR_PERIODS_INCOMPLETE'; end if;

  update public.school_years set status = 'closed', closed_at = now() where id = current_year.id;
  update public.school_years
     set status = 'active', grade_effective_on = p_effective_on, activated_at = now()
   where id = target.id;
  update public.school_terms set is_current = false where is_current;
  update public.school_terms set is_current = true where id = summer_term_id;
  update public.students set grade = grade + 1
   where deleted_at is null and status not in ('alumni', 'invalid') and grade between 1 and 11;
  insert into public.student_school_year_grades(
    student_id, school_year_id, grade, source, effective_on, recorded_by
  )
  select student_row.id, target.id, student_row.grade, 'promotion', p_effective_on, uid
    from public.students student_row
   where student_row.deleted_at is null
     and student_row.status not in ('alumni', 'invalid') and student_row.grade is not null
  on conflict (student_id, school_year_id) do update
    set grade = excluded.grade, source = excluded.source,
        effective_on = excluded.effective_on, recorded_by = excluded.recorded_by,
        recorded_at = now();
  perform public.emit_domain_event('school_year.activated', 'school_year', target.id,
    jsonb_build_object('previousSchoolYearId', current_year.id,
      'effectiveOn', p_effective_on, 'promotedStudentCount', actual_promote_count,
      'scope', 'organization'), null, null);
end
$$;

create or replace function public.list_school_years_v2()
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', year_row.id,
    'startYear', year_row.start_year,
    'name', year_row.name,
    'status', year_row.status,
    'gradeEffectiveOn', year_row.grade_effective_on,
    'activatedAt', year_row.activated_at,
    'closedAt', year_row.closed_at,
    'periods', coalesce((select jsonb_agg(jsonb_build_object(
      'id', term_row.id,
      'period', term_row.term,
      'name', term_row.name,
      'startsOn', term_row.starts_on,
      'endsOn', term_row.ends_on,
      'isCurrent', term_row.is_current
    ) order by term_row.term) from public.school_terms term_row
     where term_row.school_year_id = year_row.id), '[]'::jsonb)
  ) order by year_row.start_year desc) from public.school_years year_row), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Teaching calendar: organization entries plus campus room-group exception.
-- ---------------------------------------------------------------------------

alter table public.school_holidays
  add column if not exists schedule_mode text,
  add column if not exists mapped_weekday smallint;

do $$
begin
  if exists(select 1 from public.school_holidays
    where archived_at is null and kind in ('teaching', 'makeup') and starts_on <> ends_on) then
    raise exception 'MULTIDAY_TEACHING_CALENDAR_REQUIRES_MAPPING';
  end if;
  if exists (
    select 1 from public.school_holidays first_entry
    join public.school_holidays second_entry
      on second_entry.id > first_entry.id
     and second_entry.organization_id = first_entry.organization_id
     and second_entry.campus_id is not distinct from first_entry.campus_id
     and second_entry.archived_at is null and first_entry.archived_at is null
     and daterange(second_entry.starts_on, second_entry.ends_on, '[]')
         && daterange(first_entry.starts_on, first_entry.ends_on, '[]')
  ) then raise exception 'OVERLAPPING_TEACHING_CALENDAR_REQUIRES_MAPPING'; end if;
end
$$;

update public.school_holidays
   set schedule_mode = case when kind = 'closed' then null else 'mapped' end,
       mapped_weekday = case when kind = 'closed' then null else extract(dow from starts_on)::smallint end;

alter table public.school_holidays drop constraint if exists school_holidays_schedule_mode_check;
alter table public.school_holidays add constraint school_holidays_schedule_mode_check check (
  (kind = 'closed' and schedule_mode is null and mapped_weekday is null)
  or (kind in ('teaching', 'makeup') and starts_on = ends_on and schedule_mode = 'manual' and mapped_weekday is null)
  or (kind in ('teaching', 'makeup') and starts_on = ends_on and schedule_mode = 'mapped' and mapped_weekday between 0 and 6)
);

create or replace function public.validate_teaching_calendar_entry_v2()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'closed' then
    new.schedule_mode := null;
    new.mapped_weekday := null;
  elsif new.kind in ('teaching', 'makeup') then
    if new.starts_on <> new.ends_on then raise exception 'TEACHING_DAY_MUST_BE_SINGLE_DATE'; end if;
    new.schedule_mode := coalesce(new.schedule_mode, 'mapped');
    if new.schedule_mode = 'manual' then
      new.mapped_weekday := null;
    elsif new.schedule_mode = 'mapped' then
      new.mapped_weekday := coalesce(new.mapped_weekday, extract(dow from new.starts_on)::smallint);
      if new.mapped_weekday not between 0 and 6 then raise exception 'INVALID_MAPPED_WEEKDAY'; end if;
    else
      raise exception 'INVALID_SCHEDULE_MODE';
    end if;
  else
    raise exception 'INVALID_HOLIDAY';
  end if;
  if new.ends_on < new.starts_on then raise exception 'INVALID_HOLIDAY'; end if;
  if exists (
    select 1 from public.school_holidays existing
     where existing.id <> new.id
       and existing.organization_id = new.organization_id
       and existing.campus_id is not distinct from new.campus_id
       and existing.archived_at is null
       and daterange(existing.starts_on, existing.ends_on, '[]')
           && daterange(new.starts_on, new.ends_on, '[]')
  ) then raise exception 'CALENDAR_SCOPE_OVERLAP'; end if;
  return new;
end
$$;

drop trigger if exists school_holidays_validate_v2 on public.school_holidays;
create trigger school_holidays_validate_v2
  before insert or update of organization_id, campus_id, kind, starts_on, ends_on, schedule_mode, mapped_weekday, archived_at
  on public.school_holidays
  for each row execute function public.validate_teaching_calendar_entry_v2();

create index if not exists school_holidays_scope_range_v2_idx
  on public.school_holidays(organization_id, campus_id, starts_on, ends_on)
  where archived_at is null;

create or replace function public.get_teaching_calendar_v2(
  p_from date,
  p_to date
) returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare organization_id_value uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to > p_from + 730 then raise exception 'VALIDATION'; end if;
  select id into organization_id_value from public.organizations where singleton_key = 1;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', entry.id,
    'campusId', entry.campus_id,
    'campusName', campus_row.name,
    'name', entry.name,
    'kind', entry.kind,
    'startsOn', entry.starts_on,
    'endsOn', entry.ends_on,
    'scheduleMode', entry.schedule_mode,
    'mappedWeekday', entry.mapped_weekday,
    'createdAt', entry.created_at
  ) order by entry.starts_on, entry.ends_on, entry.campus_id nulls first, entry.id)
  from public.school_holidays entry
  left join public.campuses campus_row on campus_row.id = entry.campus_id
  where entry.organization_id = organization_id_value and entry.archived_at is null
    and entry.starts_on <= p_to and entry.ends_on >= p_from), '[]'::jsonb);
end
$$;

create or replace function public.list_teaching_calendar_entries_v2()
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', entry.id,
      'campusId', entry.campus_id,
      'campusName', campus_row.name,
      'name', entry.name,
      'kind', entry.kind,
      'startsOn', entry.starts_on,
      'endsOn', entry.ends_on,
      'scheduleMode', entry.schedule_mode,
      'mappedWeekday', entry.mapped_weekday,
      'createdAt', entry.created_at
    ) order by entry.starts_on, entry.ends_on, entry.campus_id nulls first, entry.id)
    from public.school_holidays entry
    left join public.campuses campus_row on campus_row.id = entry.campus_id
    where entry.organization_id = (select id from public.organizations where singleton_key = 1)
      and entry.archived_at is null), '[]'::jsonb);
end
$$;

create or replace function public.create_teaching_calendar_entry_v2(
  p_campus_id uuid,
  p_name text,
  p_kind text,
  p_starts_on date,
  p_ends_on date,
  p_schedule_mode text default null,
  p_mapped_weekday smallint default null
) returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); organization_id_value uuid; entry_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or p_kind not in ('closed', 'teaching', 'makeup') or p_starts_on is null or p_ends_on is null then
    raise exception 'INVALID_HOLIDAY';
  end if;
  if p_campus_id is not null and not exists (
    select 1 from public.campuses where id = p_campus_id and status = 'active'
  ) then raise exception 'INVALID_CAMPUS'; end if;
  select id into organization_id_value from public.organizations where singleton_key = 1;
  insert into public.school_holidays(
    organization_id, campus_id, name, kind, starts_on, ends_on,
    schedule_mode, mapped_weekday, created_by, updated_by
  ) values (
    organization_id_value, p_campus_id, btrim(p_name), p_kind, p_starts_on, p_ends_on,
    p_schedule_mode, p_mapped_weekday, uid, uid
  ) returning id into entry_id;
  perform public.emit_domain_event('teaching_calendar.created', 'school_holiday', entry_id,
    jsonb_build_object('campusId', p_campus_id, 'kind', p_kind,
      'startsOn', p_starts_on, 'endsOn', p_ends_on,
      'scheduleMode', p_schedule_mode, 'mappedWeekday', p_mapped_weekday), null, null);
  return entry_id;
end
$$;

create or replace function public.update_teaching_calendar_entry_v2(
  p_entry_id uuid,
  p_campus_id uuid,
  p_name text,
  p_kind text,
  p_starts_on date,
  p_ends_on date,
  p_schedule_mode text default null,
  p_mapped_weekday smallint default null
) returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target public.school_holidays;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or p_kind not in ('closed', 'teaching', 'makeup') or p_starts_on is null or p_ends_on is null then
    raise exception 'INVALID_HOLIDAY';
  end if;
  if p_campus_id is not null and not exists (
    select 1 from public.campuses where id = p_campus_id and status = 'active'
  ) then raise exception 'INVALID_CAMPUS'; end if;
  select * into target from public.school_holidays where id = p_entry_id and archived_at is null for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  update public.school_holidays
     set campus_id = p_campus_id, name = btrim(p_name), kind = p_kind,
         starts_on = p_starts_on, ends_on = p_ends_on,
         schedule_mode = p_schedule_mode, mapped_weekday = p_mapped_weekday,
         updated_by = uid
   where id = target.id;
  perform public.emit_domain_event('teaching_calendar.updated', 'school_holiday', target.id,
    jsonb_build_object('campusId', p_campus_id, 'kind', p_kind,
      'startsOn', p_starts_on, 'endsOn', p_ends_on,
      'scheduleMode', p_schedule_mode, 'mappedWeekday', p_mapped_weekday), null, null);
end
$$;

create or replace function public.archive_teaching_calendar_entry_v2(p_entry_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target public.school_holidays;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  select * into target from public.school_holidays where id = p_entry_id and archived_at is null for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  update public.school_holidays set archived_at = now(), updated_by = uid where id = target.id;
  perform public.emit_domain_event('teaching_calendar.archived', 'school_holiday', target.id,
    jsonb_build_object('name', target.name, 'startsOn', target.starts_on, 'endsOn', target.ends_on), null, null);
end
$$;

create or replace function public.get_effective_calendar_day_v2(p_day date, p_room_id uuid default null)
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare organization_id_value uuid; campus_id_value uuid; entry public.school_holidays;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_day is null then raise exception 'VALIDATION'; end if;
  select id into organization_id_value from public.organizations where singleton_key = 1;
  if p_room_id is not null then
    select campus_id into campus_id_value from public.campus_rooms where id = p_room_id;
    if campus_id_value is null then raise exception 'INVALID_ROOM'; end if;
  end if;
  select * into entry from public.school_holidays holiday_row
   where holiday_row.organization_id = organization_id_value
     and holiday_row.archived_at is null
     and holiday_row.starts_on <= p_day and holiday_row.ends_on >= p_day
     and (holiday_row.campus_id is null or holiday_row.campus_id = campus_id_value)
   order by (holiday_row.campus_id is not null) desc, holiday_row.created_at desc
   limit 1;
  return jsonb_build_object(
    'day', p_day,
    'roomId', p_room_id,
    'campusId', campus_id_value,
    'locationPending', p_room_id is null,
    'entry', case when entry.id is null then null else jsonb_build_object(
      'id', entry.id,
      'campusId', entry.campus_id,
      'name', entry.name,
      'kind', entry.kind,
      'scheduleMode', entry.schedule_mode,
      'mappedWeekday', entry.mapped_weekday
    ) end
  );
end
$$;

create or replace function public.get_class_build_calendar_preview_v2(p_room_id uuid, p_slots jsonb)
returns jsonb language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); timezone_value text; slot record; local_day date;
        calendar_result jsonb; result jsonb := '[]'::jsonb;
begin
  if uid is null or not public.has_perm(uid, 'class.create') then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(coalesce(p_slots, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_slots, '[]'::jsonb)) > 200 then
    raise exception 'INVALID_SCHEDULE';
  end if;
  select timezone into timezone_value from public.organizations where singleton_key = 1;
  for slot in
    select value ->> 'key' as slot_key, (value ->> 'scheduled_at')::timestamptz as scheduled_at
      from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb))
  loop
    if nullif(slot.slot_key, '') is null or slot.scheduled_at is null then raise exception 'INVALID_SCHEDULE'; end if;
    local_day := (slot.scheduled_at at time zone timezone_value)::date;
    calendar_result := public.get_effective_calendar_day_v2(local_day, p_room_id);
    result := result || jsonb_build_array(jsonb_build_object(
      'key', slot.slot_key,
      'day', local_day,
      'locationPending', (calendar_result ->> 'locationPending')::boolean,
      'entry', calendar_result -> 'entry'
    ));
  end loop;
  return result;
exception when invalid_text_representation then
  raise exception 'INVALID_SCHEDULE';
end
$$;

create or replace function public.validate_class_build_calendar_sessions_v2(p_room_id uuid, p_sessions jsonb)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare timezone_value text; session_input record; local_day date; calendar_result jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  if jsonb_typeof(coalesce(p_sessions, '[]'::jsonb)) <> 'array' then raise exception 'INVALID_SCHEDULE'; end if;
  select timezone into timezone_value from public.organizations where singleton_key = 1;
  for session_input in
    select * from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
      as item(scheduled_at timestamptz, closed_day_reason text)
  loop
    if session_input.scheduled_at is null then raise exception 'INVALID_SCHEDULE'; end if;
    local_day := (session_input.scheduled_at at time zone timezone_value)::date;
    calendar_result := public.get_effective_calendar_day_v2(local_day, p_room_id);
    if calendar_result #>> '{entry,kind}' = 'closed'
       and char_length(btrim(coalesce(session_input.closed_day_reason, ''))) not between 1 and 500 then
      raise exception 'CLOSED_DAY_CONFIRMATION_REQUIRED';
    end if;
  end loop;
end
$$;

create or replace function public.emit_class_build_closed_day_events_v2(
  p_classroom_id uuid,
  p_room_id uuid,
  p_sessions jsonb
) returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare timezone_value text; session_input record; local_day date; calendar_result jsonb;
        session_id_value uuid; emitted_ids uuid[] := '{}';
begin
  select timezone into timezone_value from public.organizations where singleton_key = 1;
  for session_input in
    select * from jsonb_to_recordset(coalesce(p_sessions, '[]'::jsonb))
      as item(lecture_id uuid, title text, scheduled_at timestamptz, closed_day_reason text)
  loop
    local_day := (session_input.scheduled_at at time zone timezone_value)::date;
    calendar_result := public.get_effective_calendar_day_v2(local_day, p_room_id);
    if calendar_result #>> '{entry,kind}' = 'closed' then
      select session_row.id into session_id_value
        from public.class_sessions session_row
       where session_row.classroom_id = p_classroom_id
         and session_row.scheduled_at = session_input.scheduled_at
         and session_row.title = btrim(session_input.title)
         and session_row.lecture_id is not distinct from session_input.lecture_id
         and not (session_row.id = any(emitted_ids))
       order by session_row.created_at, session_row.id
       limit 1;
      if session_id_value is null then raise exception 'SESSION_NOT_FOUND'; end if;
      emitted_ids := array_append(emitted_ids, session_id_value);
      perform public.emit_domain_event('session.closed_day.override_confirmed', 'class_session', session_id_value,
        jsonb_build_object('day', local_day, 'roomId', p_room_id,
          'calendarEntryId', calendar_result #>> '{entry,id}',
          'reason', btrim(session_input.closed_day_reason), 'source', 'class_creation'), null, null);
    end if;
  end loop;
end
$$;

-- The location V2 wrappers are redefined after the calendar exists so class
-- creation can validate every generated/manual session atomically.
create or replace function public.create_class_v2(
  p_name text,
  p_course_id uuid default null,
  p_capacity smallint default null,
  p_room_id uuid default null,
  p_primary_teacher_id uuid default null,
  p_learning_support_id uuid default null,
  p_term_id uuid default null,
  p_purpose text default 'production',
  p_sessions jsonb default '[]'::jsonb,
  p_activate boolean default false,
  p_offering_type text default 'long_term_formal'
) returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare classroom_id_value uuid;
begin
  if p_room_id is not null and not exists (
    select 1 from public.campus_rooms room_row
    join public.campuses campus_row on campus_row.id = room_row.campus_id
    where room_row.id = p_room_id and room_row.status = 'active' and campus_row.status = 'active'
  ) then raise exception 'INVALID_ROOM'; end if;
  perform public.validate_class_build_calendar_sessions_v2(p_room_id, p_sessions);
  classroom_id_value := public.create_class(
    p_name => p_name, p_course_id => p_course_id, p_capacity => p_capacity, p_room => '',
    p_primary_teacher_id => p_primary_teacher_id, p_learning_support_id => p_learning_support_id,
    p_term_id => p_term_id, p_purpose => p_purpose, p_sessions => p_sessions,
    p_activate => p_activate, p_offering_type => p_offering_type
  );
  update public.classrooms set default_room_id = p_room_id where id = classroom_id_value;
  update public.class_sessions set room_id = p_room_id, room_assignment_origin = 'class_default'
   where classroom_id = classroom_id_value;
  perform public.emit_class_build_closed_day_events_v2(classroom_id_value, p_room_id, p_sessions);
  return classroom_id_value;
end
$$;

create or replace function public.create_free_class_with_sessions_v2(
  p_name text,
  p_capacity smallint default null,
  p_room_id uuid default null,
  p_primary_teacher_id uuid default null,
  p_learning_support_id uuid default null,
  p_term_id uuid default null,
  p_purpose text default 'production',
  p_sessions jsonb default '[]'::jsonb,
  p_activate boolean default false,
  p_offering_type text default 'long_term_formal'
) returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare classroom_id_value uuid;
begin
  if p_room_id is not null and not exists (
    select 1 from public.campus_rooms room_row
    join public.campuses campus_row on campus_row.id = room_row.campus_id
    where room_row.id = p_room_id and room_row.status = 'active' and campus_row.status = 'active'
  ) then raise exception 'INVALID_ROOM'; end if;
  perform public.validate_class_build_calendar_sessions_v2(p_room_id, p_sessions);
  classroom_id_value := public.create_free_class_with_sessions(
    p_name => p_name, p_capacity => p_capacity, p_room => '',
    p_primary_teacher_id => p_primary_teacher_id, p_learning_support_id => p_learning_support_id,
    p_term_id => p_term_id, p_purpose => p_purpose, p_sessions => p_sessions,
    p_activate => p_activate, p_offering_type => p_offering_type
  );
  update public.classrooms set default_room_id = p_room_id where id = classroom_id_value;
  update public.class_sessions set room_id = p_room_id, room_assignment_origin = 'class_default'
   where classroom_id = classroom_id_value;
  perform public.emit_class_build_closed_day_events_v2(classroom_id_value, p_room_id, p_sessions);
  return classroom_id_value;
end
$$;

-- Manual scheduling on an effective closed date needs an explicit reason.
create or replace function public.create_managed_class_session_v2(
  p_classroom_id uuid,
  p_title text,
  p_scheduled_at timestamptz,
  p_duration_min smallint,
  p_confirm_closed_day boolean default false,
  p_closed_day_reason text default ''
) returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare timezone_value text; local_day date; calendar_result jsonb; entry_kind text;
        default_room_id_value uuid; session_id_value uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  select default_room_id into default_room_id_value from public.classrooms where id = p_classroom_id;
  select timezone into timezone_value from public.organizations where singleton_key = 1;
  local_day := (p_scheduled_at at time zone timezone_value)::date;
  calendar_result := public.get_effective_calendar_day_v2(local_day, default_room_id_value);
  entry_kind := calendar_result #>> '{entry,kind}';
  if entry_kind = 'closed' and (
    not coalesce(p_confirm_closed_day, false)
    or char_length(btrim(coalesce(p_closed_day_reason, ''))) not between 1 and 500
  ) then raise exception 'CLOSED_DAY_CONFIRMATION_REQUIRED'; end if;

  session_id_value := public.create_managed_class_session(
    p_classroom_id, p_title, p_scheduled_at, p_duration_min
  );
  if entry_kind = 'closed' then
    perform public.emit_domain_event('session.closed_day.override_confirmed', 'class_session', session_id_value,
      jsonb_build_object('day', local_day, 'roomId', default_room_id_value,
        'calendarEntryId', calendar_result #>> '{entry,id}',
        'reason', btrim(p_closed_day_reason)), null, null);
  end if;
  return session_id_value;
end
$$;

create or replace function public.update_managed_class_session_v2(
  p_session_id uuid,
  p_title text,
  p_scheduled_at timestamptz,
  p_duration_min smallint,
  p_room_id uuid default null,
  p_confirm_closed_day boolean default false,
  p_closed_day_reason text default ''
) returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
declare timezone_value text; local_day date; calendar_result jsonb; entry_kind text;
        current_room_id uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHENTICATED'; end if;
  select room_id into current_room_id from public.class_sessions where id = p_session_id;
  select timezone into timezone_value from public.organizations where singleton_key = 1;
  local_day := (p_scheduled_at at time zone timezone_value)::date;
  calendar_result := public.get_effective_calendar_day_v2(local_day, p_room_id);
  entry_kind := calendar_result #>> '{entry,kind}';
  if entry_kind = 'closed' and (
    not coalesce(p_confirm_closed_day, false)
    or char_length(btrim(coalesce(p_closed_day_reason, ''))) not between 1 and 500
  ) then raise exception 'CLOSED_DAY_CONFIRMATION_REQUIRED'; end if;

  perform public.update_managed_class_session(p_session_id, p_title, p_scheduled_at, p_duration_min);
  -- Editing title/time must not silently convert a frozen class-default assignment
  -- into a session override when the selected room did not change.
  if current_room_id is distinct from p_room_id then
    perform public.set_class_session_room_v2(p_session_id, p_room_id);
  end if;
  if entry_kind = 'closed' then
    perform public.emit_domain_event('session.closed_day.override_confirmed', 'class_session', p_session_id,
      jsonb_build_object('day', local_day, 'roomId', p_room_id,
        'calendarEntryId', calendar_result #>> '{entry,id}',
        'reason', btrim(p_closed_day_reason)), null, null);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. ACL.
-- ---------------------------------------------------------------------------

revoke all on function public.validate_teaching_calendar_entry_v2() from public, anon, authenticated;
revoke all on function public.list_school_years_v2() from public, anon, authenticated;
revoke all on function public.get_teaching_calendar_v2(date, date) from public, anon, authenticated;
revoke all on function public.list_teaching_calendar_entries_v2() from public, anon, authenticated;
revoke all on function public.create_teaching_calendar_entry_v2(uuid, text, text, date, date, text, smallint) from public, anon, authenticated;
revoke all on function public.update_teaching_calendar_entry_v2(uuid, uuid, text, text, date, date, text, smallint) from public, anon, authenticated;
revoke all on function public.archive_teaching_calendar_entry_v2(uuid) from public, anon, authenticated;
revoke all on function public.get_effective_calendar_day_v2(date, uuid) from public, anon, authenticated;
revoke all on function public.get_class_build_calendar_preview_v2(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.validate_class_build_calendar_sessions_v2(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.emit_class_build_closed_day_events_v2(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_managed_class_session_v2(uuid, text, timestamptz, smallint, boolean, text) from public, anon, authenticated;
revoke all on function public.update_managed_class_session_v2(uuid, text, timestamptz, smallint, uuid, boolean, text) from public, anon, authenticated;

grant execute on function public.list_school_years_v2() to authenticated;
grant execute on function public.get_teaching_calendar_v2(date, date) to authenticated;
grant execute on function public.list_teaching_calendar_entries_v2() to authenticated;
grant execute on function public.create_teaching_calendar_entry_v2(uuid, text, text, date, date, text, smallint) to authenticated;
grant execute on function public.update_teaching_calendar_entry_v2(uuid, uuid, text, text, date, date, text, smallint) to authenticated;
grant execute on function public.archive_teaching_calendar_entry_v2(uuid) to authenticated;
grant execute on function public.get_effective_calendar_day_v2(date, uuid) to authenticated;
grant execute on function public.get_class_build_calendar_preview_v2(uuid, jsonb) to authenticated;
grant execute on function public.create_managed_class_session_v2(uuid, text, timestamptz, smallint, boolean, text) to authenticated;
grant execute on function public.update_managed_class_session_v2(uuid, text, timestamptz, smallint, uuid, boolean, text) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
