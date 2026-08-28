-- HOTFIX-20260829: a top-level administrator is also a real staff member and
-- may carry teacher/research job roles. Keep the self-elevation guard for
-- ordinary staff, while allowing an admin to manage their own job-role rows.

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
  if target = uid and not public.is_admin(uid) then
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
  if target = uid and not public.is_admin(uid) then
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

revoke all on function public.grant_staff_role(uuid, uuid) from public, anon, authenticated;
revoke all on function public.revoke_staff_role(uuid, uuid) from public, anon, authenticated;
grant execute on function public.grant_staff_role(uuid, uuid) to authenticated;
grant execute on function public.revoke_staff_role(uuid, uuid) to authenticated;

comment on function public.grant_staff_role(uuid, uuid) is
  'Grants a staff job role; only a top-level admin may target their own profile.';
comment on function public.revoke_staff_role(uuid, uuid) is
  'Revokes a staff job role; only a top-level admin may target their own profile.';
