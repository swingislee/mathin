-- P4C-3（docs/plan/11 §8.1）：员工页与岗位权限页的读侧 + 角色 CRUD RPC。
-- 全部 security definer + set search_path，先 revoke 再按需 grant execute to authenticated。
-- auth.users 只在 security definer 内读，返回列白名单仅 email（10-§10 员工页层）。

-- 员工列表：姓名 / 邮箱 / 身份 / 岗位角色（staff.manage 可见）
create or replace function public.list_staff_members()
returns table (
  user_id uuid,
  display_name text,
  email text,
  identity text,
  role_ids uuid[],
  role_names text[]
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p.id,
         p.display_name,
         u.email::text,
         p.role,
         coalesce(r.role_ids, '{}'::uuid[]),
         coalesce(r.role_names, '{}'::text[])
    from public.profiles p
    join auth.users u on u.id = p.id
    left join lateral (
      select array_agg(sr.id order by sr.created_at) as role_ids,
             array_agg(sr.name order by sr.created_at) as role_names
        from public.staff_role_members m
        join public.staff_roles sr on sr.id = m.role_id
       where m.user_id = p.id
    ) r on true
   where p.role in ('staff', 'admin')
     and public.has_perm(auth.uid(), 'staff.manage')
   order by p.role desc, p.display_name;
$$;

-- 按邮箱精确查找档案（添加员工入口；精确匹配防枚举，查无返回空行集）
create or replace function public.find_profile_by_email(p text)
returns table (
  user_id uuid,
  display_name text,
  identity text
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select p2.id, p2.display_name, p2.role
    from auth.users u
    join public.profiles p2 on p2.id = u.id
   where u.email = p
     and public.has_perm(auth.uid(), 'staff.manage');
$$;

-- 新建自定义角色：key = 'custom_' || 8 位随机串，is_system=false
create or replace function public.create_staff_role(p_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(p_name, ''));
  new_id uuid;
begin
  if uid is null or not public.has_perm(uid, 'permission.configure') then
    raise exception 'FORBIDDEN';
  end if;
  if clean_name = '' or length(clean_name) > 32 then
    raise exception 'INVALID_NAME';
  end if;
  insert into public.staff_roles (key, name, is_system)
  values ('custom_' || substr(md5(gen_random_uuid()::text), 1, 8), clean_name, false)
  returning id into new_id;
  return new_id;
end;
$$;

-- 改名：system 角色也可改（种子名只是默认）
create or replace function public.rename_staff_role(role_id uuid, p_name text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  clean_name text := trim(coalesce(p_name, ''));
begin
  if uid is null or not public.has_perm(uid, 'permission.configure') then
    raise exception 'FORBIDDEN';
  end if;
  if clean_name = '' or length(clean_name) > 32 then
    raise exception 'INVALID_NAME';
  end if;
  update public.staff_roles set name = clean_name where id = role_id;
  if not found then
    raise exception 'ROLE_NOT_FOUND';
  end if;
end;
$$;

-- 删除：仅自定义角色；有成员则拒（先移除成员），不做级联
create or replace function public.delete_staff_role(role_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  target_is_system boolean;
begin
  if uid is null or not public.has_perm(uid, 'permission.configure') then
    raise exception 'FORBIDDEN';
  end if;
  select is_system into target_is_system from public.staff_roles where id = role_id;
  if target_is_system is null then
    raise exception 'ROLE_NOT_FOUND';
  end if;
  if target_is_system then
    raise exception 'SYSTEM_ROLE';
  end if;
  -- 参数与列同名：必须两侧都限定，否则 plpgsql 报 ambiguous
  if exists (select 1 from public.staff_role_members m where m.role_id = delete_staff_role.role_id) then
    raise exception 'ROLE_HAS_MEMBERS';
  end if;
  delete from public.staff_roles where id = role_id;
end;
$$;

revoke all on function public.list_staff_members() from public, anon, authenticated;
revoke all on function public.find_profile_by_email(text) from public, anon, authenticated;
revoke all on function public.create_staff_role(text) from public, anon, authenticated;
revoke all on function public.rename_staff_role(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_staff_role(uuid) from public, anon, authenticated;

grant execute on function public.list_staff_members() to authenticated;
grant execute on function public.find_profile_by_email(text) to authenticated;
grant execute on function public.create_staff_role(text) to authenticated;
grant execute on function public.rename_staff_role(uuid, text) to authenticated;
grant execute on function public.delete_staff_role(uuid) to authenticated;
