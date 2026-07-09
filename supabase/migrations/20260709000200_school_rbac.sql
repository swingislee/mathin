-- ============================================================================
-- P4B-0 学校端 RBAC 基建（docs/plan/10-school-backend.md §5.1）
-- 身份类：profiles.role = student | parent | staff | admin
-- 岗位权限：staff_roles / role_permissions / staff_role_members
-- ============================================================================

do $$
declare
  constraint_name text;
begin
  select c.conname into constraint_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'profiles'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%role%';

  if constraint_name is not null then
    execute format('alter table public.profiles drop constraint %I', constraint_name);
  end if;
end $$;

create table public.staff_roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.staff_roles (id) on delete cascade,
  perm_key text not null,
  primary key (role_id, perm_key)
);

create table public.staff_role_members (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.staff_roles (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index staff_role_members_user_idx on public.staff_role_members (user_id);
create index role_permissions_perm_idx on public.role_permissions (perm_key, role_id);

insert into public.staff_roles (key, name, is_system)
values
  ('principal', '校长', true),
  ('director', '主管', true),
  ('research', '教研', true),
  ('teacher', '教师', true),
  ('sales', '学辅', true),
  ('part_time', '兼职', true)
on conflict (key) do update set name = excluded.name, is_system = excluded.is_system;

with teacher_role as (
  select id from public.staff_roles where key = 'teacher'
)
insert into public.staff_role_members (user_id, role_id)
select p.id, teacher_role.id
  from public.profiles p
 cross join teacher_role
 where p.role = 'teacher'
on conflict do nothing;

update public.profiles set role = 'staff' where role = 'teacher';

alter table public.profiles add constraint profiles_role_check
  check (role in ('student', 'parent', 'staff', 'admin'));

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.role(), '') in ('anon', 'authenticated')
     and current_setting('app.allow_profile_role_update', true) is distinct from '1' then
    raise exception 'profiles.role can only be changed by admin RPC';
  end if;
  return new;
end;
$$;

create or replace function public.school_permission_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'student.view.all',
    'student.view.assigned',
    'student.edit',
    'student.create',
    'student.assign',
    'followup.view',
    'followup.write',
    'course.view',
    'course.manage',
    'courseware.template.edit',
    'courseware.overlay.edit',
    'class.view.all',
    'class.view.mine',
    'class.create',
    'class.manage',
    'schedule.view.all',
    'attendance.mark',
    'grading.write',
    'report.view.all',
    'finance.order.view',
    'finance.order.create',
    'finance.payment.record',
    'finance.refund.request',
    'finance.refund.approve',
    'finance.coupon.manage',
    'finance.scholarship.grant',
    'finance.account.adjust',
    'finance.report.view',
    'staff.manage',
    'permission.configure'
  ]::text[];
$$;

create or replace function public.is_admin(uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p where p.id = uid and p.role = 'admin'
  );
$$;

create or replace function public.is_staff(uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p where p.id = uid and p.role in ('staff', 'admin')
  );
$$;

create or replace function public.has_perm(uid uuid, p_key text)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.is_admin(uid)
    or exists (
      select 1
        from public.staff_role_members m
        join public.role_permissions rp on rp.role_id = m.role_id
       where m.user_id = uid
         and rp.perm_key = p_key
    );
$$;

create or replace function public.staff_has_perm(uid uuid, p_key text)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.has_perm(uid, p_key);
$$;

create or replace function public.admin_set_identity(target uuid, new_role text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or not public.is_admin(uid) then
    raise exception 'FORBIDDEN';
  end if;
  if target = uid then
    raise exception 'CANNOT_CHANGE_SELF';
  end if;
  if new_role not in ('student', 'parent', 'staff', 'admin') then
    raise exception 'INVALID_ROLE';
  end if;
  perform set_config('app.allow_profile_role_update', '1', true);
  update public.profiles set role = new_role where id = target;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if new_role not in ('staff', 'admin') then
    delete from public.staff_role_members where user_id = target;
  end if;
end;
$$;

create or replace function public.grant_staff_role(target uuid, p_role_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  role_has_configure boolean;
begin
  if uid is null or not public.has_perm(uid, 'staff.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if target = uid then
    raise exception 'CANNOT_GRANT_SELF';
  end if;
  if not public.is_staff(target) then
    raise exception 'TARGET_NOT_STAFF';
  end if;
  select exists (
    select 1 from public.role_permissions
     where role_id = p_role_id and perm_key = 'permission.configure'
  ) into role_has_configure;
  if role_has_configure and not public.is_admin(uid) then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.staff_role_members (user_id, role_id, granted_by)
  values (target, p_role_id, uid)
  on conflict do nothing;
end;
$$;

create or replace function public.revoke_staff_role(target uuid, p_role_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  role_has_configure boolean;
begin
  if uid is null or not public.has_perm(uid, 'staff.manage') then
    raise exception 'FORBIDDEN';
  end if;
  if target = uid then
    raise exception 'CANNOT_REVOKE_SELF';
  end if;
  select exists (
    select 1 from public.role_permissions
     where role_id = p_role_id and perm_key = 'permission.configure'
  ) into role_has_configure;
  if role_has_configure and not public.is_admin(uid) then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.staff_role_members where user_id = target and role_id = p_role_id;
end;
$$;

create or replace function public.set_role_permissions(p_role_id uuid, perm_keys text[])
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_keys text[];
  invalid_keys text[];
begin
  if uid is null or not public.has_perm(uid, 'permission.configure') then
    raise exception 'FORBIDDEN';
  end if;
  select array_agg(distinct key order by key)
    into clean_keys
    from unnest(coalesce(perm_keys, '{}'::text[])) as key;
  clean_keys := coalesce(clean_keys, '{}'::text[]);

  select array_agg(key)
    into invalid_keys
    from unnest(clean_keys) as key
   where not (key = any(public.school_permission_keys()));
  if invalid_keys is not null then
    raise exception 'INVALID_PERMISSION_KEYS';
  end if;

  if not exists (select 1 from public.staff_roles where id = p_role_id) then
    raise exception 'ROLE_NOT_FOUND';
  end if;

  delete from public.role_permissions where role_id = p_role_id;
  insert into public.role_permissions (role_id, perm_key)
  select p_role_id, key from unnest(clean_keys) as key;
end;
$$;

revoke all on function public.school_permission_keys() from public;
revoke all on function public.is_admin(uuid) from public;
revoke all on function public.is_staff(uuid) from public;
revoke all on function public.has_perm(uuid, text) from public;
revoke all on function public.staff_has_perm(uuid, text) from public;
revoke all on function public.admin_set_identity(uuid, text) from public;
revoke all on function public.grant_staff_role(uuid, uuid) from public;
revoke all on function public.revoke_staff_role(uuid, uuid) from public;
revoke all on function public.set_role_permissions(uuid, text[]) from public;

grant execute on function public.school_permission_keys() to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_staff(uuid) to authenticated;
grant execute on function public.has_perm(uuid, text) to authenticated;
grant execute on function public.staff_has_perm(uuid, text) to authenticated;
grant execute on function public.admin_set_identity(uuid, text) to authenticated;
grant execute on function public.grant_staff_role(uuid, uuid) to authenticated;
grant execute on function public.revoke_staff_role(uuid, uuid) to authenticated;
grant execute on function public.set_role_permissions(uuid, text[]) to authenticated;

with perms(role_key, perm_key) as (
  values
    ('principal', 'student.view.all'),
    ('principal', 'student.view.assigned'),
    ('principal', 'student.edit'),
    ('principal', 'student.create'),
    ('principal', 'student.assign'),
    ('principal', 'followup.view'),
    ('principal', 'followup.write'),
    ('principal', 'course.view'),
    ('principal', 'course.manage'),
    ('principal', 'courseware.template.edit'),
    ('principal', 'courseware.overlay.edit'),
    ('principal', 'class.view.all'),
    ('principal', 'class.view.mine'),
    ('principal', 'class.create'),
    ('principal', 'class.manage'),
    ('principal', 'schedule.view.all'),
    ('principal', 'attendance.mark'),
    ('principal', 'grading.write'),
    ('principal', 'report.view.all'),
    ('principal', 'finance.order.view'),
    ('principal', 'finance.order.create'),
    ('principal', 'finance.payment.record'),
    ('principal', 'finance.refund.request'),
    ('principal', 'finance.refund.approve'),
    ('principal', 'finance.coupon.manage'),
    ('principal', 'finance.scholarship.grant'),
    ('principal', 'finance.account.adjust'),
    ('principal', 'finance.report.view'),
    ('principal', 'staff.manage'),
    ('principal', 'permission.configure'),
    ('director', 'student.view.all'),
    ('director', 'student.edit'),
    ('director', 'student.create'),
    ('director', 'student.assign'),
    ('director', 'followup.view'),
    ('director', 'followup.write'),
    ('director', 'course.view'),
    ('director', 'class.view.all'),
    ('director', 'class.view.mine'),
    ('director', 'class.create'),
    ('director', 'class.manage'),
    ('director', 'schedule.view.all'),
    ('director', 'attendance.mark'),
    ('director', 'grading.write'),
    ('director', 'report.view.all'),
    ('director', 'finance.order.view'),
    ('director', 'finance.order.create'),
    ('director', 'finance.payment.record'),
    ('director', 'finance.report.view'),
    ('research', 'course.view'),
    ('research', 'course.manage'),
    ('research', 'courseware.template.edit'),
    ('research', 'report.view.all'),
    ('teacher', 'student.view.assigned'),
    ('teacher', 'followup.view'),
    ('teacher', 'followup.write'),
    ('teacher', 'course.view'),
    ('teacher', 'courseware.overlay.edit'),
    ('teacher', 'class.view.mine'),
    ('teacher', 'class.create'),
    ('teacher', 'class.manage'),
    ('teacher', 'attendance.mark'),
    ('teacher', 'grading.write'),
    ('sales', 'student.view.assigned'),
    ('sales', 'student.edit'),
    ('sales', 'student.create'),
    ('sales', 'student.assign'),
    ('sales', 'followup.view'),
    ('sales', 'followup.write'),
    ('sales', 'finance.order.view'),
    ('sales', 'finance.order.create'),
    ('sales', 'finance.payment.record'),
    ('part_time', 'class.view.mine'),
    ('part_time', 'attendance.mark')
)
insert into public.role_permissions (role_id, perm_key)
select r.id, p.perm_key
  from perms p
  join public.staff_roles r on r.key = p.role_key
on conflict do nothing;

alter table public.staff_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff_role_members enable row level security;

create policy "staff_roles_select_staff" on public.staff_roles
  for select to authenticated
  using (public.is_staff((select auth.uid())));

create policy "role_permissions_select_staff" on public.role_permissions
  for select to authenticated
  using (public.is_staff((select auth.uid())));

create policy "staff_role_members_select_self_or_manager" on public.staff_role_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_perm((select auth.uid()), 'staff.manage')
  );

revoke all on public.staff_roles from anon, authenticated;
revoke all on public.role_permissions from anon, authenticated;
revoke all on public.staff_role_members from anon, authenticated;
grant select on public.staff_roles to authenticated;
grant select on public.role_permissions to authenticated;
grant select on public.staff_role_members to authenticated;

create or replace function public.create_classroom(p_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
  code text;
  attempts int := 0;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if not public.is_staff(uid) then
    raise exception 'FORBIDDEN';
  end if;
  loop
    code := substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8);
    begin
      insert into public.classrooms (owner_id, name, invite_code)
      values (uid, coalesce(trim(p_name), ''), code)
      returning id into cid;
      exit;
    exception when unique_violation then
      attempts := attempts + 1;
      if attempts > 5 then raise; end if;
    end;
  end loop;
  insert into public.classroom_members (classroom_id, user_id, role)
  values (cid, uid, 'teacher');
  return cid;
end;
$$;

revoke all on function public.create_classroom(text) from public;
grant execute on function public.create_classroom(text) to authenticated;
