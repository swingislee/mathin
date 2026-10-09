-- Administrative authority follows the same account-state boundary as staff
-- permissions. Keep is_staff's distinction between the current actor and an
-- assignment target that has not yet completed its initial password change.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select public.is_staff(uid)
    and exists(select 1 from public.profiles p where p.id = uid and p.role = 'admin');
$$;

-- profiles_update_own permits ordinary profile edits. Activation is an account
-- administration fact: only a checked SECURITY DEFINER operation or a trusted
-- service/database role may change it. SECURITY INVOKER is essential here so
-- a direct authenticated UPDATE is distinguishable from deactivate_staff.
create function public.protect_profile_active_state()
returns trigger
language plpgsql security invoker
set search_path = public, pg_temp
as $$
begin
  if new.is_active is distinct from old.is_active
    and current_user in ('anon', 'authenticated') then
    raise exception 'PROFILE_ACTIVE_STATE_TRUSTED_OPERATION_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_profile_active_state() from public, anon, authenticated, service_role;

create trigger profiles_protect_active_state
before update of is_active on public.profiles
for each row execute function public.protect_profile_active_state();

notify pgrst, 'reload schema';
