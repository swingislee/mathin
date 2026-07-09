-- ============================================================================
-- P4B-2 学生档案（docs/plan/10-school-backend.md §5.3）
-- 本迁移先落 assigned/all 作用域；P4B-3 创建 enrollments 后再补 teacher_of_student。
-- ============================================================================

create table public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gender text not null default '',
  birthday date,
  phone text not null default '',
  wechat text not null default '',
  school text not null default '',
  grade smallint,
  status text not null default 'lead'
    check (status in ('lead', 'trialing', 'enrolled', 'paused', 'alumni', 'invalid')),
  source text not null default '',
  referrer text not null default '',
  tags text[] not null default '{}',
  parent_name text not null default '',
  parent_relation text not null default '',
  parent_phone text not null default '',
  assigned_to uuid references public.profiles (id) on delete set null,
  follow_up_status text not null default 'pending'
    check (follow_up_status in ('pending', 'following', 'invited', 'trialed', 'signed', 'lost')),
  last_follow_up_at timestamptz,
  next_follow_up_at timestamptz,
  user_id uuid unique references public.profiles (id) on delete set null,
  bind_code text not null unique,
  remark text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_guardians (
  student_id uuid not null references public.students (id) on delete cascade,
  guardian_id uuid not null references public.profiles (id) on delete cascade,
  relation text not null default '',
  created_at timestamptz not null default now(),
  primary key (student_id, guardian_id)
);

create table public.student_follow_ups (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  content text not null,
  kind text not null default 'note' check (kind in ('note', 'call', 'class', 'visit')),
  next_follow_up_at timestamptz,
  status_after text check (status_after is null or status_after in ('pending', 'following', 'invited', 'trialed', 'signed', 'lost')),
  created_at timestamptz not null default now()
);

create index students_assigned_idx on public.students (assigned_to);
create index students_status_idx on public.students (status, follow_up_status, grade);
create index students_user_idx on public.students (user_id);
create index student_guardians_guardian_idx on public.student_guardians (guardian_id);
create index followups_student_created_idx on public.student_follow_ups (student_id, created_at desc);

create trigger students_set_updated_at
  before update on public.students
  for each row execute function public.set_updated_at();

create or replace function public.generate_student_bind_code()
returns text
language plpgsql
as $$
declare
  code text;
begin
  loop
    code := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8);
    exit when not exists (select 1 from public.students s where s.bind_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.assigned_of_student(sid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.students s
     where s.id = sid and s.assigned_to = uid
  );
$$;

create or replace function public.can_access_student(sid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.is_admin(uid)
    or public.staff_has_perm(uid, 'student.view.all')
    or (public.staff_has_perm(uid, 'student.view.assigned') and public.assigned_of_student(sid, uid));
$$;

create or replace function public.touch_student_follow_up()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.students
     set last_follow_up_at = new.created_at,
         next_follow_up_at = new.next_follow_up_at,
         follow_up_status = coalesce(new.status_after, follow_up_status)
   where id = new.student_id;
  return new;
end;
$$;

create trigger student_followups_touch_student
  after insert on public.student_follow_ups
  for each row execute function public.touch_student_follow_up();

create or replace function public.create_student(
  p_name text,
  p_grade smallint default null,
  p_phone text default '',
  p_parent_name text default '',
  p_parent_phone text default ''
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null or not public.has_perm(uid, 'student.create') then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.students (name, grade, phone, parent_name, parent_phone, assigned_to, created_by, bind_code)
  values (trim(p_name), p_grade, coalesce(p_phone, ''), coalesce(p_parent_name, ''), coalesce(p_parent_phone, ''), uid, uid, public.generate_student_bind_code())
  returning id into sid;
  return sid;
end;
$$;

create or replace function public.assign_student(p_student_id uuid, p_staff_user_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(), 'student.assign') then
    raise exception 'FORBIDDEN';
  end if;
  if not public.is_staff(p_staff_user_id) then
    raise exception 'TARGET_NOT_STAFF';
  end if;
  update public.students set assigned_to = p_staff_user_id where id = p_student_id;
end;
$$;

create or replace function public.change_student_status(p_student_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_perm(auth.uid(), 'student.edit') then
    raise exception 'FORBIDDEN';
  end if;
  if p_status not in ('lead', 'trialing', 'enrolled', 'paused', 'alumni', 'invalid') then
    raise exception 'INVALID_STATUS';
  end if;
  update public.students set status = p_status where id = p_student_id and public.can_access_student(id, auth.uid());
end;
$$;

create or replace function public.claim_student_account(p_code text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  update public.students
     set user_id = uid
   where bind_code = lower(trim(p_code))
     and user_id is null
  returning id into sid;
  if sid is null then
    raise exception 'INVALID_BIND_CODE';
  end if;
  return sid;
end;
$$;

create or replace function public.bind_guardian(p_code text, p_relation text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  select id into sid from public.students where bind_code = lower(trim(p_code));
  if sid is null then
    raise exception 'INVALID_BIND_CODE';
  end if;
  insert into public.student_guardians (student_id, guardian_id, relation)
  values (sid, uid, coalesce(trim(p_relation), ''))
  on conflict (student_id, guardian_id) do update set relation = excluded.relation;
  perform set_config('app.allow_profile_role_update', '1', true);
  update public.profiles set role = 'parent' where id = uid and role = 'student';
  return sid;
end;
$$;

create or replace function public.get_my_students()
returns table(id uuid, name text, grade smallint, status text)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select s.id, s.name, s.grade, s.status
    from public.students s
   where s.user_id = auth.uid()
  union
  select s.id, s.name, s.grade, s.status
    from public.students s
    join public.student_guardians g on g.student_id = s.id
   where g.guardian_id = auth.uid();
$$;

revoke all on function public.generate_student_bind_code() from public;
revoke all on function public.assigned_of_student(uuid, uuid) from public;
revoke all on function public.can_access_student(uuid, uuid) from public;
revoke all on function public.create_student(text, smallint, text, text, text) from public;
revoke all on function public.assign_student(uuid, uuid) from public;
revoke all on function public.change_student_status(uuid, text) from public;
revoke all on function public.claim_student_account(text) from public;
revoke all on function public.bind_guardian(text, text) from public;
revoke all on function public.get_my_students() from public;

grant execute on function public.assigned_of_student(uuid, uuid) to authenticated;
grant execute on function public.can_access_student(uuid, uuid) to authenticated;
grant execute on function public.create_student(text, smallint, text, text, text) to authenticated;
grant execute on function public.assign_student(uuid, uuid) to authenticated;
grant execute on function public.change_student_status(uuid, text) to authenticated;
grant execute on function public.claim_student_account(text) to authenticated;
grant execute on function public.bind_guardian(text, text) to authenticated;
grant execute on function public.get_my_students() to authenticated;

alter table public.students enable row level security;
alter table public.student_guardians enable row level security;
alter table public.student_follow_ups enable row level security;

create policy "students_select_staff_scope" on public.students
  for select to authenticated
  using (public.can_access_student(id, (select auth.uid())));

create policy "students_update_basic_staff_scope" on public.students
  for update to authenticated
  using (public.has_perm((select auth.uid()), 'student.edit') and public.can_access_student(id, (select auth.uid())))
  with check (public.has_perm((select auth.uid()), 'student.edit') and public.can_access_student(id, (select auth.uid())));

create policy "guardians_select_staff_or_self" on public.student_guardians
  for select to authenticated
  using (
    guardian_id = (select auth.uid())
    or public.can_access_student(student_id, (select auth.uid()))
  );

create policy "followups_select_staff_scope" on public.student_follow_ups
  for select to authenticated
  using (
    public.has_perm((select auth.uid()), 'followup.view')
    and public.can_access_student(student_id, (select auth.uid()))
  );

create policy "followups_insert_staff_scope" on public.student_follow_ups
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.has_perm((select auth.uid()), 'followup.write')
    and public.can_access_student(student_id, (select auth.uid()))
  );

revoke all on public.students from anon, authenticated;
revoke all on public.student_guardians from anon, authenticated;
revoke all on public.student_follow_ups from anon, authenticated;

grant select on public.students to authenticated;
grant update (name, gender, birthday, phone, wechat, school, grade, parent_name, parent_relation, parent_phone, remark, tags) on public.students to authenticated;
grant select on public.student_guardians to authenticated;
grant select on public.student_follow_ups to authenticated;
grant insert (student_id, author_id, content, kind, next_follow_up_at, status_after) on public.student_follow_ups to authenticated;
