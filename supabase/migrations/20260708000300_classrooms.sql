-- ============================================================================
-- P4-3 教室结构（docs/plan/08-§4、03-§3.4）
-- 教室 = 轻量师生空间：教师建室（服务端校验 profiles.role），学生凭 8 位码加入。
-- 建室/加入一律走 SECURITY DEFINER RPC（无直接 insert 权限）；
-- invite_code 不进列级 select，教师经 RPC 读取。
-- ============================================================================

create table public.classrooms (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null default '',
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

comment on table public.classrooms is '教室；owner 必为教师，invite_code 为学生加入凭据';

create table public.classroom_members (
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null check (role in ('teacher', 'student')),
  created_at   timestamptz not null default now(),
  primary key (classroom_id, user_id)
);

comment on table public.classroom_members is '教室成员；owner 由建室 RPC 自动写入 teacher 行';

create index classroom_members_user_idx on public.classroom_members (user_id);

-- RLS 互查辅助（security definer 防策略递归）
create function public.is_classroom_member(cid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.classroom_members m
     where m.classroom_id = cid and m.user_id = uid
  );
$$;

create function public.is_classroom_teacher(cid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.classroom_members m
     where m.classroom_id = cid and m.user_id = uid and m.role = 'teacher'
  );
$$;

create function public.is_classroom_owner(cid uuid, uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.classrooms c
     where c.id = cid and c.owner_id = uid
  );
$$;

revoke all on function public.is_classroom_member(uuid, uuid) from public;
revoke all on function public.is_classroom_teacher(uuid, uuid) from public;
revoke all on function public.is_classroom_owner(uuid, uuid) from public;
grant execute on function public.is_classroom_member(uuid, uuid) to authenticated;
grant execute on function public.is_classroom_teacher(uuid, uuid) to authenticated;
grant execute on function public.is_classroom_owner(uuid, uuid) to authenticated;

-- 建室：服务端校验教师身份；生成 8 位邀请码，碰撞重试
create function public.create_classroom(p_name text)
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
  if not exists (select 1 from public.profiles p where p.id = uid and p.role in ('teacher', 'admin')) then
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

-- 加入：凭码入室，幂等；返回教室 id（码无效返回 null）
create function public.join_classroom(p_code text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  cid uuid;
begin
  if uid is null or p_code is null or trim(p_code) = '' then
    return null;
  end if;
  select c.id into cid from public.classrooms c where c.invite_code = lower(trim(p_code));
  if cid is null then
    return null;
  end if;
  insert into public.classroom_members (classroom_id, user_id, role)
  values (cid, uid, 'student')
  on conflict (classroom_id, user_id) do nothing;
  return cid;
end;
$$;

-- 教师读邀请码
create function public.get_classroom_invite(cid uuid)
returns text
language sql security definer stable
set search_path = public, pg_temp
as $$
  select c.invite_code
    from public.classrooms c
   where c.id = cid
     and public.is_classroom_teacher(cid, auth.uid());
$$;

revoke all on function public.create_classroom(text) from public;
revoke all on function public.join_classroom(text) from public;
revoke all on function public.get_classroom_invite(uuid) from public;
grant execute on function public.create_classroom(text) to authenticated;
grant execute on function public.join_classroom(text) to authenticated;
grant execute on function public.get_classroom_invite(uuid) to authenticated;

alter table public.classrooms enable row level security;

create policy "classrooms_select_member" on public.classrooms
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.is_classroom_member(id, (select auth.uid()))
  );
create policy "classrooms_update_owner" on public.classrooms
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "classrooms_delete_owner" on public.classrooms
  for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.classrooms from anon, authenticated;
grant select (id, owner_id, name, created_at) on public.classrooms to authenticated;
grant update (name) on public.classrooms to authenticated;
grant delete on public.classrooms to authenticated;

alter table public.classroom_members enable row level security;

create policy "cls_members_select_member" on public.classroom_members
  for select to authenticated
  using (public.is_classroom_member(classroom_id, (select auth.uid())));
-- 退出教室（owner 不可退出自己的教室）或教师移除学生（不可移除 owner）
create policy "cls_members_delete" on public.classroom_members
  for delete to authenticated
  using (
    not public.is_classroom_owner(classroom_id, user_id)
    and (
      user_id = (select auth.uid())
      or public.is_classroom_teacher(classroom_id, (select auth.uid()))
    )
  );

revoke all on public.classroom_members from anon, authenticated;
grant select, delete on public.classroom_members to authenticated;
