\set ON_ERROR_STOP on
-- R1-Live：学年建立不升年级；四周期日期可待定；只有预览后显式启用才晋级。
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as student_id from public.students where deleted_at is null order by created_at limit 1 \gset
\if :{?admin_id}
\else
  \echo R1 school-year fixtures missing: 测试-管理员
  select 1 / 0;
\endif
\if :{?student_id}
\else
  \echo R1 school-year fixtures missing: student
  select 1 / 0;
\endif

do $$
declare failures text[] := '{}'; default_campus uuid := public.default_campus_id();
begin
  if (select count(*) from public.school_years where campus_id = default_campus and status = 'active') <> 1 then
    failures := array_append(failures, 'default campus must have exactly one active academic year');
  end if;
  if exists(
    select 1 from public.school_years year_row
     where year_row.campus_id = default_campus
       and (select count(*) from public.school_terms term_row where term_row.school_year_id = year_row.id) <> 4
  ) then failures := array_append(failures, 'academic year does not have four operating periods'); end if;
  if exists(select 1 from public.school_terms where (starts_on is null) <> (ends_on is null)) then
    failures := array_append(failures, 'operating period has a partial date pair');
  end if;
  if exists(
    select 1 from public.school_terms term_row
      join public.school_years year_row on year_row.id = term_row.school_year_id
     where term_row.is_current and year_row.status <> 'active'
  ) then failures := array_append(failures, 'current period belongs to a non-active academic year'); end if;
  if has_table_privilege('authenticated', 'public.school_years', 'INSERT')
     or has_table_privilege('authenticated', 'public.school_years', 'UPDATE')
     or has_table_privilege('authenticated', 'public.student_school_year_grades', 'UPDATE') then
    failures := array_append(failures, 'direct academic-year writes granted to authenticated');
  end if;
  if cardinality(failures) > 0 then
    raise exception 'R1-Live school-year structure assertions failed: %', array_to_string(failures, ', ');
  end if;
end
$$;

-- 给匿名夹具一个可观察的年级；整个文件最终 rollback，不污染任何目标。
update public.students set grade = 5 where id = :'student_id'::uuid;
select grade as grade_before from public.students where id = :'student_id'::uuid \gset
select start_year as active_start_year
  from public.school_years
 where campus_id = public.default_campus_id() and status = 'active' \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true);

-- 创建一个更远的学年，只验证“建头部 + 四周期”，不允许顺手改学生年级。
select coalesce(max(start_year), :active_start_year::int) + 1 as new_start_year
  from public.school_years where campus_id = public.default_campus_id() \gset
select public.create_school_year(:new_start_year) as created_year_id \gset
select (
  (select count(*) = 4 from public.school_terms where school_year_id = :'created_year_id'::uuid)
  and (select count(*) = 4 from public.school_terms where school_year_id = :'created_year_id'::uuid and starts_on is null and ends_on is null)
  and (select grade = :grade_before from public.students where id = :'student_id'::uuid)
) as creation_is_non_promoting \gset
\if :creation_is_non_promoting
\else
  \echo R1-Live academic-year creation changed grades or omitted periods
  select 1 / 0;
\endif

select id as next_year_id
  from public.school_years
 where campus_id = public.default_campus_id()
   and start_year = :active_start_year::int + 1
 limit 1 \gset
\if :{?next_year_id}
\else
  select public.create_school_year(:active_start_year::int + 1) as next_year_id \gset
\endif

select public.get_school_year_activation_preview(:'next_year_id'::uuid) as preview \gset
select (
  (:'preview'::jsonb ->> 'canActivate')::boolean
  and (:'preview'::jsonb ->> 'promoteCount')::int >= 1
) as preview_is_actionable \gset
\if :preview_is_actionable
\else
  \echo R1-Live academic-year activation preview is not actionable
  select 1 / 0;
\endif

select public.activate_school_year(
  :'next_year_id'::uuid,
  make_date(:active_start_year::int + 1, 7, 1),
  (:'preview'::jsonb ->> 'promoteCount')::int
);

select (
  (select grade = :grade_before + 1 from public.students where id = :'student_id'::uuid)
  and (select status = 'active' from public.school_years where id = :'next_year_id'::uuid)
  and (select count(*) = 1 from public.school_terms where school_year_id = :'next_year_id'::uuid and term = 1 and is_current)
  and (select grade = :grade_before + 1 and source = 'promotion'
         from public.student_school_year_grades
        where student_id = :'student_id'::uuid and school_year_id = :'next_year_id'::uuid)
) as explicit_activation_promotes_once \gset
\if :explicit_activation_promotes_once
\else
  \echo R1-Live explicit academic-year activation contract failed
  select 1 / 0;
\endif

rollback;
\echo R1-Live school-year assertions passed
