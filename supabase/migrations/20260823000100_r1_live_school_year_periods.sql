-- R1-Live：把“学年”从必须预先知道日期的学期行中拆出，并把运营周期固定为
-- 暑期 / 秋季 / 寒假 / 春季。学年创建不改学生年级；只有显式预览并确认
-- activate_school_year 才执行批量升年级。

-- ---------------------------------------------------------------------------
-- 1. 学年头部：年级归属的权威边界，不要求提前填写学期日期。
-- ---------------------------------------------------------------------------

create table public.school_years (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  start_year smallint not null check (start_year between 2000 and 2200),
  name text not null check (length(btrim(name)) between 1 and 100),
  status text not null default 'planning' check (status in ('planning', 'active', 'closed')),
  grade_effective_on date,
  activated_at timestamptz,
  closed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campus_id, start_year),
  check (
    (status = 'planning' and activated_at is null and closed_at is null)
    or (status = 'active' and activated_at is not null and closed_at is null)
    or (status = 'closed' and activated_at is not null and closed_at is not null)
  )
);

create trigger school_years_set_updated_at
  before update on public.school_years
  for each row execute function public.set_updated_at();

create unique index school_years_one_active_campus_idx
  on public.school_years(campus_id) where status = 'active';

alter table public.school_years enable row level security;
create policy school_years_read on public.school_years
  for select to authenticated using (true);
revoke all on public.school_years from anon, authenticated;
grant select on public.school_years to authenticated;

-- ---------------------------------------------------------------------------
-- 2. 既有 school_terms 变为学年内的四个运营周期；日期允许待定。
--    1=暑期、2=秋季、3=寒假、4=春季。暑期是新学年的第一个周期。
-- ---------------------------------------------------------------------------

alter table public.school_terms add column school_year_id uuid;
alter table public.school_terms alter column starts_on drop not null;
alter table public.school_terms alter column ends_on drop not null;
alter table public.school_terms drop constraint school_terms_dates;
alter table public.school_terms add constraint school_terms_dates check (
  (starts_on is null and ends_on is null)
  or (starts_on is not null and ends_on is not null and ends_on >= starts_on)
);

-- 历史 seed 把 year=2026/term=1 同时解释成自然年春季和“学年起始年第一学期”。
-- 产品负责人确认 2026 春季实际结束于 2026-06-29；按新合同它属于
-- 2025–2026 学年的春季（period=4）。精确匹配，避免猜测其他机构自建数据。
do $$
begin
  if exists (
    select 1
      from public.school_terms legacy
      join public.school_terms target
        on target.campus_id = legacy.campus_id
       and target.year = 2025
       and target.term = 4
     where legacy.name = '2026 春季学期'
       and legacy.year = 2026 and legacy.term = 1
       and legacy.starts_on = date '2026-02-01'
  ) then
    raise exception 'LEGACY_SPRING_TERM_TARGET_CONFLICT';
  end if;

  update public.school_terms
     set year = 2025,
         term = 4,
         name = '2025–2026 学年 · 春季',
         ends_on = date '2026-06-29'
   where name = '2026 春季学期'
     and year = 2026 and term = 1
     and starts_on = date '2026-02-01';
end
$$;

insert into public.school_years(
  campus_id, start_year, name, status, activated_at, created_at
)
select term_row.campus_id,
       term_row.year,
       term_row.year::text || '–' || (term_row.year + 1)::text || ' 学年',
       case when bool_or(term_row.is_current) then 'active' else 'planning' end,
       case when bool_or(term_row.is_current) then min(term_row.created_at) else null end,
       min(term_row.created_at)
  from public.school_terms term_row
 where term_row.campus_id is not null
 group by term_row.campus_id, term_row.year
on conflict (campus_id, start_year) do nothing;

update public.school_terms term_row
   set school_year_id = year_row.id
  from public.school_years year_row
 where year_row.campus_id = term_row.campus_id
   and year_row.start_year = term_row.year;

alter table public.school_terms
  alter column school_year_id set not null,
  add constraint school_terms_school_year_id_fkey
    foreign key (school_year_id) references public.school_years(id) on delete restrict,
  add constraint school_terms_school_year_period_key unique (school_year_id, term);

comment on table public.school_years is
  '学年是学生年级的年度归属；创建不要求运营周期日期，也不隐式升年级。';
comment on column public.school_terms.term is
  '学年内运营周期：1=暑期、2=秋季、3=寒假、4=春季；不是 courses.term 的课程版本字段。';
comment on column public.school_terms.starts_on is
  '运营周期实际开始日；未知时与 ends_on 同时为空，临近后补。';

-- 历史学年也补齐四个周期，避免管理界面出现“旧学年只有春季”的半套结构；
-- 已存在周期及其日期保持原样，缺少的周期只建立日期待定占位。
insert into public.school_terms(
  campus_id, school_year_id, year, term, name, starts_on, ends_on, is_current
)
select year_row.campus_id, year_row.id, year_row.start_year, period.term,
       year_row.start_year::text || '–' || (year_row.start_year + 1)::text || ' 学年 · ' || period.label,
       null, null, false
  from public.school_years year_row
 cross join (values (1::smallint, '暑期'), (2::smallint, '秋季'), (3::smallint, '寒假'), (4::smallint, '春季')) period(term, label)
on conflict (school_year_id, term) do nothing;

-- 已确认的新学年先以 planning 建立，四个周期日期均可待定。
insert into public.school_years(campus_id, start_year, name, status, created_by)
select public.default_campus_id(), 2026, '2026–2027 学年', 'planning', null
where public.default_campus_id() is not null
on conflict (campus_id, start_year) do nothing;

insert into public.school_terms(
  campus_id, school_year_id, year, term, name, starts_on, ends_on, is_current
)
select year_row.campus_id, year_row.id, year_row.start_year, period.term,
       year_row.start_year::text || '–' || (year_row.start_year + 1)::text || ' 学年 · ' || period.label,
       null, null, false
  from public.school_years year_row
 cross join (values (1::smallint, '暑期'), (2::smallint, '秋季'), (3::smallint, '寒假'), (4::smallint, '春季')) period(term, label)
 where year_row.campus_id = public.default_campus_id()
   and year_row.start_year = 2026
on conflict (school_year_id, term) do nothing;

-- 现有正式班的课次均在 2026-09-05～2026-12-12，不能继续挂在
-- 2026-06-29 已结束的春季。只迁移“旧春季引用 + 全部课次晚于春季结束”的
-- production 班级；不改班级状态、教师、课次时间或学生年级。
do $$
declare legacy_term_id uuid; autumn_term_id uuid; classroom_row record;
begin
  select term_row.id into legacy_term_id
    from public.school_terms term_row
   where term_row.year = 2025 and term_row.term = 4
     and term_row.starts_on = date '2026-02-01'
     and term_row.ends_on = date '2026-06-29'
     and term_row.campus_id = public.default_campus_id()
   limit 1;

  select term_row.id into autumn_term_id
    from public.school_terms term_row
   where term_row.year = 2026 and term_row.term = 2
     and term_row.campus_id = public.default_campus_id()
   limit 1;

  if legacy_term_id is not null and autumn_term_id is not null then
    for classroom_row in
      select classroom.id
        from public.classrooms classroom
       where classroom.term_id = legacy_term_id
         and classroom.purpose = 'production'
         and exists (
           select 1 from public.class_sessions session_row
            where session_row.classroom_id = classroom.id
              and session_row.deleted_at is null
         )
         and not exists (
           select 1 from public.class_sessions session_row
            where session_row.classroom_id = classroom.id
              and session_row.deleted_at is null
              and session_row.scheduled_at::date <= date '2026-06-29'
         )
    loop
      update public.class_sessions
         set term_id = autumn_term_id
       where classroom_id = classroom_row.id;
      update public.enrollments
         set term_id = autumn_term_id
       where classroom_id = classroom_row.id;
      update public.classrooms
         set term_id = autumn_term_id
       where id = classroom_row.id;
    end loop;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. 年级按学年留痕；既有按 term 的历史表继续兼容读取。
-- ---------------------------------------------------------------------------

create table public.student_school_year_grades (
  student_id uuid not null references public.students(id) on delete cascade,
  school_year_id uuid not null references public.school_years(id) on delete restrict,
  grade smallint not null check (grade between 1 and 12),
  source text not null default 'manual' check (source in ('migration', 'manual', 'promotion')),
  effective_on date,
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (student_id, school_year_id)
);

alter table public.student_school_year_grades enable row level security;
create policy student_school_year_grades_scope on public.student_school_year_grades
  for select to authenticated using (
    public.can_access_student(student_id, (select auth.uid()))
    or exists (
      select 1 from public.students student_row
       where student_row.id = student_id
         and (
           student_row.user_id = (select auth.uid())
           or exists (
             select 1 from public.student_guardians guardian_row
              where guardian_row.student_id = student_row.id
                and guardian_row.guardian_id = (select auth.uid())
           )
         )
    )
  );
revoke all on public.student_school_year_grades from anon, authenticated;
grant select on public.student_school_year_grades to authenticated;

insert into public.student_school_year_grades(
  student_id, school_year_id, grade, source, effective_on, recorded_by, recorded_at
)
select student_row.id, year_row.id, student_row.grade, 'migration', year_row.grade_effective_on, null, now()
  from public.students student_row
 cross join public.school_years year_row
 where student_row.deleted_at is null
   and student_row.grade is not null
   and year_row.status = 'active'
   and year_row.campus_id = public.default_campus_id()
on conflict (student_id, school_year_id) do nothing;

create or replace function public.current_school_year_id(p_campus_id uuid default null)
returns uuid language sql security definer stable set search_path = public, pg_temp
as $$
  select year_row.id
    from public.school_years year_row
   where year_row.campus_id = coalesce(p_campus_id, public.default_campus_id())
     and year_row.status = 'active'
   limit 1
$$;

create or replace function public.capture_student_grade_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare year_id uuid; term_id_value uuid;
begin
  if tg_op = 'UPDATE' and new.grade is not distinct from old.grade then return new; end if;

  year_id := public.current_school_year_id();
  if year_id is not null and new.grade is not null then
    insert into public.student_school_year_grades(
      student_id, school_year_id, grade, source, effective_on, recorded_by
    )
    select new.id, year_row.id, new.grade, 'manual', year_row.grade_effective_on, auth.uid()
      from public.school_years year_row where year_row.id = year_id
    on conflict (student_id, school_year_id) do update
      set grade = excluded.grade,
          source = excluded.source,
          effective_on = excluded.effective_on,
          recorded_by = excluded.recorded_by,
          recorded_at = now();
  end if;

  -- 保留旧 term 级历史读模型；年级提升前会先把新学年的暑期设为 current，
  -- 因此不会再把新年级覆写进已结束的春季。
  term_id_value := public.current_school_term_id();
  if term_id_value is not null then
    insert into public.student_grade_history(student_id, term_id, grade, recorded_by)
    values(new.id, term_id_value, new.grade, auth.uid())
    on conflict(student_id, term_id) do update
      set grade = excluded.grade, recorded_by = excluded.recorded_by, recorded_at = now();
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. 写入口：创建学年、后补周期日期、切换周期、预览并显式确认升年级。
-- ---------------------------------------------------------------------------

create or replace function public.create_campus_school_year(
  p_campus_id uuid, p_start_year int
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); year_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if p_start_year < 2020 or p_start_year > 2100 then raise exception 'INVALID_SCHOOL_YEAR'; end if;
  -- 学生档案当前没有 campus 归属；R1-Live 只能由默认校区驱动一次全机构升年级，
  -- 避免多校区各自启用学年时把同一学生重复晋级。
  if p_campus_id is distinct from public.default_campus_id() then raise exception 'NON_DEFAULT_CAMPUS_SCHOOL_YEAR'; end if;
  if not exists(select 1 from public.campuses where id = p_campus_id and status = 'active') then
    raise exception 'INVALID_CAMPUS';
  end if;
  if exists(select 1 from public.school_years where campus_id = p_campus_id and start_year = p_start_year) then
    raise exception 'SCHOOL_YEAR_ALREADY_EXISTS';
  end if;

  insert into public.school_years(campus_id, start_year, name, status, created_by)
  values(p_campus_id, p_start_year, p_start_year::text || '–' || (p_start_year + 1)::text || ' 学年', 'planning', uid)
  returning id into year_id;

  insert into public.school_terms(
    campus_id, school_year_id, year, term, name, starts_on, ends_on, is_current
  )
  select p_campus_id, year_id, p_start_year, period.term,
         p_start_year::text || '–' || (p_start_year + 1)::text || ' 学年 · ' || period.label,
         null, null, false
    from (values (1::smallint, '暑期'), (2::smallint, '秋季'), (3::smallint, '寒假'), (4::smallint, '春季')) period(term, label);

  perform public.emit_domain_event('school_year.created', 'school_year', year_id,
    jsonb_build_object('campusId', p_campus_id, 'startYear', p_start_year), null, null);
  return year_id;
end
$$;

create or replace function public.create_school_year(p_start_year int)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return public.create_campus_school_year(public.default_campus_id(), p_start_year);
end
$$;

create or replace function public.update_school_term_dates(
  p_term_id uuid, p_starts_on date default null, p_ends_on date default null
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target public.school_terms;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if (p_starts_on is null) <> (p_ends_on is null) then raise exception 'TERM_DATES_INCOMPLETE'; end if;
  if p_starts_on is not null and p_ends_on < p_starts_on then raise exception 'TERM_DATES_INVALID'; end if;

  select * into target from public.school_terms where id = p_term_id for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  update public.school_terms
     set starts_on = p_starts_on, ends_on = p_ends_on
   where id = target.id;
  perform public.emit_domain_event('school_term.dates_updated', 'school_term', target.id,
    jsonb_build_object('schoolYearId', target.school_year_id, 'period', target.term,
      'startsOn', p_starts_on, 'endsOn', p_ends_on), null, null);
end
$$;

create or replace function public.activate_school_term(p_term_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target public.school_terms; year_status text;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  select * into target from public.school_terms where id = p_term_id for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  select status into year_status from public.school_years where id = target.school_year_id;
  if year_status <> 'active' then raise exception 'SCHOOL_YEAR_NOT_ACTIVE'; end if;

  perform pg_advisory_xact_lock(hashtext('school-term:' || target.campus_id::text));
  update public.school_terms
     set is_current = false
   where campus_id = target.campus_id and is_current and id <> target.id;
  update public.school_terms set is_current = true where id = target.id;

  insert into public.student_grade_history(student_id, term_id, grade, recorded_by)
  select id, target.id, grade, uid
    from public.students
   where deleted_at is null and grade is not null
  on conflict(student_id, term_id) do nothing;

  perform public.emit_domain_event('school_term.activated', 'school_term', target.id,
    jsonb_build_object('schoolYearId', target.school_year_id, 'period', target.term), null, null);
end
$$;

create or replace function public.get_school_year_activation_preview(p_school_year_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target public.school_years; current_year public.school_years;
        promote_count int; retained_count int;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  select * into target from public.school_years where id = p_school_year_id;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  select * into current_year from public.school_years
   where campus_id = target.campus_id and status = 'active' limit 1;

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
      and target.campus_id = public.default_campus_id()
      and current_year.id is not null
      and target.start_year = current_year.start_year + 1
  );
end
$$;

create or replace function public.activate_school_year(
  p_school_year_id uuid, p_effective_on date, p_expected_promote_count int
) returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); target public.school_years; current_year public.school_years;
        actual_promote_count int; summer_term_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if p_effective_on is null or p_expected_promote_count < 0 then raise exception 'VALIDATION'; end if;

  select * into target from public.school_years where id = p_school_year_id for update;
  if target.id is null then raise exception 'NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtext('school-year:' || target.campus_id::text));
  select * into current_year from public.school_years
   where campus_id = target.campus_id and status = 'active' for update;

  if target.status <> 'planning' then raise exception 'SCHOOL_YEAR_NOT_PLANNING'; end if;
  if target.campus_id is distinct from public.default_campus_id() then
    raise exception 'NON_DEFAULT_CAMPUS_SCHOOL_YEAR';
  end if;
  if current_year.id is null or target.start_year <> current_year.start_year + 1 then
    raise exception 'SCHOOL_YEAR_SEQUENCE_INVALID';
  end if;
  if extract(year from p_effective_on)::int <> target.start_year then
    raise exception 'SCHOOL_YEAR_EFFECTIVE_DATE_INVALID';
  end if;

  select count(*) into actual_promote_count
    from public.students student_row
   where student_row.deleted_at is null
     and student_row.status not in ('alumni', 'invalid')
     and student_row.grade between 1 and 11;
  if actual_promote_count <> p_expected_promote_count then raise exception 'SCHOOL_YEAR_PROMOTION_STALE'; end if;

  select id into summer_term_id from public.school_terms
   where school_year_id = target.id and term = 1 for update;
  if summer_term_id is null then raise exception 'SCHOOL_YEAR_PERIODS_INCOMPLETE'; end if;

  update public.school_years
     set status = 'closed', closed_at = now()
   where id = current_year.id;
  update public.school_years
     set status = 'active', grade_effective_on = p_effective_on, activated_at = now()
   where id = target.id;
  update public.school_terms set is_current = false
   where campus_id = target.campus_id and is_current;
  update public.school_terms set is_current = true where id = summer_term_id;

  update public.students
     set grade = grade + 1
   where deleted_at is null
     and status not in ('alumni', 'invalid')
     and grade between 1 and 11;

  insert into public.student_school_year_grades(
    student_id, school_year_id, grade, source, effective_on, recorded_by
  )
  select student_row.id, target.id, student_row.grade, 'promotion', p_effective_on, uid
    from public.students student_row
   where student_row.deleted_at is null
     and student_row.status not in ('alumni', 'invalid')
     and student_row.grade is not null
  on conflict (student_id, school_year_id) do update
    set grade = excluded.grade,
        source = excluded.source,
        effective_on = excluded.effective_on,
        recorded_by = excluded.recorded_by,
        recorded_at = now();

  perform public.emit_domain_event('school_year.activated', 'school_year', target.id,
    jsonb_build_object('previousSchoolYearId', current_year.id, 'effectiveOn', p_effective_on,
      'promotedStudentCount', actual_promote_count), null, null);
end
$$;

-- 旧单周期创建 RPC 保留兼容，但语义改为“已存在学年内补一个周期”；正常 UI
-- 只调用 create_school_year，一次建立四个日期待定周期。
create or replace function public.create_campus_school_term(
  p_campus_id uuid, p_year int, p_term smallint, p_name text, p_starts_on date, p_ends_on date
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := auth.uid(); year_id uuid; term_id_value uuid;
begin
  if uid is null or not public.has_perm(uid, 'schedule.manage') then raise exception 'FORBIDDEN'; end if;
  if p_term not between 1 and 4 or btrim(coalesce(p_name, '')) = '' then raise exception 'INVALID_TERM'; end if;
  if (p_starts_on is null) <> (p_ends_on is null) or (p_starts_on is not null and p_ends_on < p_starts_on) then
    raise exception 'INVALID_TERM';
  end if;
  select id into year_id from public.school_years
   where campus_id = p_campus_id and start_year = p_year;
  if year_id is null then raise exception 'SCHOOL_YEAR_NOT_FOUND'; end if;
  if exists(select 1 from public.school_terms where school_year_id = year_id and term = p_term) then
    raise exception 'SCHOOL_PERIOD_ALREADY_EXISTS';
  end if;
  insert into public.school_terms(campus_id, school_year_id, year, term, name, starts_on, ends_on, is_current)
  values(p_campus_id, year_id, p_year, p_term, left(btrim(p_name), 100), p_starts_on, p_ends_on, false)
  returning id into term_id_value;
  perform public.emit_domain_event('school_term.created', 'school_term', term_id_value,
    jsonb_build_object('schoolYearId', year_id, 'period', p_term), null, null);
  return term_id_value;
end
$$;

create or replace function public.create_school_term(
  p_year int, p_term smallint, p_name text, p_starts_on date, p_ends_on date
) returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return public.create_campus_school_term(
    public.default_campus_id(), p_year, p_term, p_name, p_starts_on, p_ends_on
  );
end
$$;

revoke all on function public.current_school_year_id(uuid) from public, anon, authenticated;
revoke all on function public.create_campus_school_year(uuid, int) from public, anon, authenticated;
revoke all on function public.create_school_year(int) from public, anon, authenticated;
revoke all on function public.update_school_term_dates(uuid, date, date) from public, anon, authenticated;
revoke all on function public.get_school_year_activation_preview(uuid) from public, anon, authenticated;
revoke all on function public.activate_school_year(uuid, date, int) from public, anon, authenticated;
revoke all on function public.activate_school_term(uuid) from public, anon, authenticated;
revoke all on function public.create_campus_school_term(uuid, int, smallint, text, date, date) from public, anon, authenticated;
revoke all on function public.create_school_term(int, smallint, text, date, date) from public, anon, authenticated;

grant execute on function public.current_school_year_id(uuid) to authenticated;
grant execute on function public.create_school_year(int) to authenticated;
grant execute on function public.update_school_term_dates(uuid, date, date) to authenticated;
grant execute on function public.get_school_year_activation_preview(uuid) to authenticated;
grant execute on function public.activate_school_year(uuid, date, int) to authenticated;
grant execute on function public.activate_school_term(uuid) to authenticated;
grant execute on function public.create_school_term(int, smallint, text, date, date) to authenticated;
