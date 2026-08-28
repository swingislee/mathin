\set ON_ERROR_STOP on
-- Admin self-assignment hotfix. All fixture changes roll back.
begin;

select id as admin_id from public.profiles where display_name = '测试-管理员' limit 1 \gset
select id as staff_id from public.profiles where display_name = '测试-教师' limit 1 \gset
select id as principal_role_id from public.staff_roles where key = 'principal' \gset
select id as part_time_role_id from public.staff_roles where key = 'part_time' \gset

\if :{?admin_id}
\else
  \echo admin self-role fixtures missing: admin
  select 1 / 0;
\endif
\if :{?staff_id}
\else
  \echo admin self-role fixtures missing: staff
  select 1 / 0;
\endif

-- Remove any existing admin teacher/research rows inside this transaction so
-- the RPC must create them, then prove the admin can also revoke them.
delete from public.staff_role_members member
using public.staff_roles role
where member.role_id = role.id
  and member.user_id = :'admin_id'
  and role.key in ('teacher', 'research');

set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin_id', true) as jwt_subject \gset
select public.grant_staff_role(:'admin_id', id)
from public.staff_roles
where key in ('teacher', 'research')
order by key;

select (
  (select role from public.profiles where id = :'admin_id') = 'admin'
  and (
    select count(*) = 2
    from public.staff_role_members member
    join public.staff_roles role on role.id = member.role_id
    where member.user_id = :'admin_id'
      and member.granted_by = :'admin_id'
      and role.key in ('teacher', 'research')
  )
) as admin_self_grant_ok \gset
\if :admin_self_grant_ok
\else
  \echo admin self-role grant failed
  select 1 / 0;
\endif

select public.revoke_staff_role(:'admin_id', id)
from public.staff_roles
where key in ('teacher', 'research')
order by key;

select not exists (
  select 1
  from public.staff_role_members member
  join public.staff_roles role on role.id = member.role_id
  where member.user_id = :'admin_id'
    and role.key in ('teacher', 'research')
) as admin_self_revoke_ok \gset
\if :admin_self_revoke_ok
\else
  \echo admin self-role revoke failed
  select 1 / 0;
\endif
reset role;

-- A non-admin with staff.manage must still be unable to grant or revoke their
-- own roles, so this hotfix cannot become an ordinary staff escalation path.
insert into public.staff_role_members(user_id, role_id, granted_by)
values (:'staff_id', :'principal_role_id', :'admin_id')
on conflict do nothing;
delete from public.staff_role_members
where user_id = :'staff_id' and role_id = :'part_time_role_id';

set local role authenticated;
select set_config('request.jwt.claim.sub', :'staff_id', true) as jwt_subject \gset
select public.has_perm(:'staff_id', 'staff.manage') as staff_can_manage \gset
\if :staff_can_manage
\else
  \echo non-admin self-role fixture lacks staff.manage
  select 1 / 0;
\endif

select set_config('admin_self_roles.part_time_role_id', :'part_time_role_id', true) as role_setting \gset
do $$
begin
  begin
    perform public.grant_staff_role(
      auth.uid(),
      current_setting('admin_self_roles.part_time_role_id')::uuid
    );
    raise exception 'NON_ADMIN_SELF_GRANT_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CANNOT_GRANT_SELF' then raise; end if;
  end;
end
$$;
reset role;

insert into public.staff_role_members(user_id, role_id, granted_by)
values (:'staff_id', :'part_time_role_id', :'admin_id')
on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', :'staff_id', true) as jwt_subject \gset
do $$
begin
  begin
    perform public.revoke_staff_role(
      auth.uid(),
      current_setting('admin_self_roles.part_time_role_id')::uuid
    );
    raise exception 'NON_ADMIN_SELF_REVOKE_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CANNOT_REVOKE_SELF' then raise; end if;
  end;
end
$$;

select exists (
  select 1 from public.staff_role_members
  where user_id = :'staff_id' and role_id = :'part_time_role_id'
) as non_admin_guard_ok \gset
\if :non_admin_guard_ok
\else
  \echo non-admin self-role guard failed
  select 1 / 0;
\endif
reset role;

rollback;
