-- R1-Live Gate 1: restore the narrowly scoped role-change bypass used by
-- trusted identity RPCs without weakening the other protected profile fields.

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
as $$
declare
  role_update_allowed boolean :=
    coalesce(current_setting('app.allow_profile_role_update', true), '') = '1';
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if new.role is distinct from old.role and not role_update_allowed then
      raise exception 'protected profile fields can only be changed by a trusted operation';
    end if;

    if new.privacy_consented_at is distinct from old.privacy_consented_at
       or new.children_privacy_consented_at is distinct from old.children_privacy_consented_at
       or new.account_status is distinct from old.account_status
       or new.account_locked_at is distinct from old.account_locked_at
       or new.account_locked_by is distinct from old.account_locked_by
       or new.account_lock_reason is distinct from old.account_lock_reason then
      raise exception 'protected profile fields can only be changed by a trusted operation';
    end if;
  end if;

  return new;
end
$$;
