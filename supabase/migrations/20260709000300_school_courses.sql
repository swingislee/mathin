-- ============================================================================
-- P4B-1 课程框架（docs/plan/10-school-backend.md §5.2）
-- ============================================================================

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  product_code text unique,
  grade smallint not null check (grade between 1 and 9),
  term smallint not null check (term between 1 and 4),
  class_type text not null default '',
  status text not null default 'enabled' check (status in ('enabled', 'disabled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_lectures (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  no smallint not null,
  name text not null,
  objectives text not null default '',
  courseware_template jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  unique (course_id, no),
  constraint course_lectures_template_cap check (octet_length(courseware_template::text) <= 1048576)
);

create index courses_filter_idx on public.courses (status, grade, term, class_type);
create index course_lectures_course_no_idx on public.course_lectures (course_id, no);

create trigger courses_set_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();

create trigger course_lectures_set_updated_at
  before update on public.course_lectures
  for each row execute function public.set_updated_at();

alter table public.courses enable row level security;
alter table public.course_lectures enable row level security;

create policy "courses_select_course_view" on public.courses
  for select to authenticated
  using (
    public.has_perm((select auth.uid()), 'course.view')
    and (status = 'enabled' or public.has_perm((select auth.uid()), 'course.manage'))
  );

create policy "courses_insert_manage" on public.courses
  for insert to authenticated
  with check (public.has_perm((select auth.uid()), 'course.manage'));

create policy "courses_update_manage" on public.courses
  for update to authenticated
  using (public.has_perm((select auth.uid()), 'course.manage'))
  with check (public.has_perm((select auth.uid()), 'course.manage'));

create policy "courses_delete_manage" on public.courses
  for delete to authenticated
  using (public.has_perm((select auth.uid()), 'course.manage'));

create policy "lectures_select_course_view" on public.course_lectures
  for select to authenticated
  using (
    public.has_perm((select auth.uid()), 'course.view')
    and exists (
      select 1 from public.courses c
       where c.id = course_id
         and (c.status = 'enabled' or public.has_perm((select auth.uid()), 'course.manage'))
    )
  );

create policy "lectures_insert_manage" on public.course_lectures
  for insert to authenticated
  with check (public.has_perm((select auth.uid()), 'course.manage'));

create policy "lectures_update_manage" on public.course_lectures
  for update to authenticated
  using (public.has_perm((select auth.uid()), 'course.manage'))
  with check (public.has_perm((select auth.uid()), 'course.manage'));

create policy "lectures_delete_manage" on public.course_lectures
  for delete to authenticated
  using (public.has_perm((select auth.uid()), 'course.manage'));

revoke all on public.courses from anon, authenticated;
revoke all on public.course_lectures from anon, authenticated;

grant select on public.courses to authenticated;
grant insert (title, product_code, grade, term, class_type, status, created_by) on public.courses to authenticated;
grant update (title, product_code, grade, term, class_type, status) on public.courses to authenticated;
grant delete on public.courses to authenticated;

grant select on public.course_lectures to authenticated;
grant insert (course_id, no, name, objectives) on public.course_lectures to authenticated;
grant update (no, name, objectives) on public.course_lectures to authenticated;
grant delete on public.course_lectures to authenticated;
